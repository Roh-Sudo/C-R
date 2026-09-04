import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { LocalBillingProvider } from '../packages/billing-core/src/index.js';

// This suite exercises the real HTTP server end-to-end against an isolated,
// disposable data file so it never touches local developer/demo data.
describe('end-to-end commercial flow', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  const adminToken = 'test-admin-token';
  const webhookSecret = 'test-webhook-secret';
  const webhookSigner = new LocalBillingProvider(webhookSecret);

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-${randomBytes(6).toString('hex')}.json`);
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.ADMIN_TOKEN = adminToken;
    process.env.LOCAL_BILLING_WEBHOOK_SECRET = webhookSecret;
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind to a port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
  });

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string; adminToken?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.adminToken) headers['x-admin-token'] = options.adminToken;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  it('exposes the pricing catalog publicly with no invented enterprise price', async () => {
    const { status, body } = await call('GET', '/api/billing/plans');
    expect(status).toBe(200);
    const enterprise = body.find((plan: { id: string }) => plan.id === 'ENTERPRISE');
    expect(enterprise.priceMonthlyUsd).toBeNull();
    expect(enterprise.selfServiceCheckout).toBe(false);
  });

  it('runs signup -> trial -> repository -> scan -> value -> upgrade -> entitlements -> downgrade -> cancel while preserving history', async () => {
    const userId = `user_${randomBytes(4).toString('hex')}`;

    // SIGNUP -> ORGANIZATION
    const org = await call('POST', '/api/organizations', { body: { name: 'Flow Test Org' }, userId });
    expect(org.status).toBe(201);
    const organizationId = org.body.id as string;

    // TRIAL starts lazily on first billing lookup
    const billing = await call('GET', `/api/organizations/${organizationId}/billing`, { userId });
    expect(billing.status).toBe(200);
    expect(billing.body.subscription.status).toBe('TRIALING');
    expect(billing.body.trialDaysRemaining).toBe(14);

    // Force the org onto FREE (repositories: 1) to exercise the hard limit safely.
    const toFree = await call('POST', `/api/organizations/${organizationId}/billing/change-plan`, { body: { planId: 'FREE' }, userId });
    expect(toFree.status).toBe(200);
    expect(toFree.body.planId).toBe('FREE');

    // CONNECT REPOSITORY (1st repo succeeds)
    const project1 = await call('POST', '/api/projects', { body: { organizationId, name: 'Repo One', repositoryName: 'org/repo-one' }, userId });
    expect(project1.status).toBe(201);
    const token = project1.body.token as string;
    const projectId = project1.body.project.id as string;

    // A second repository is blocked by the FREE plan's hard limit; no data is created or lost.
    const project2Blocked = await call('POST', '/api/projects', { body: { organizationId, name: 'Repo Two', repositoryName: 'org/repo-two' }, userId });
    expect(project2Blocked.status).toBe(402);
    expect(project2Blocked.body.code).toBe('LIMIT_REACHED');
    expect(project2Blocked.body.capability).toBe('repositories');

    // UPGRADE (simulated self-service checkout + provider webhook activates the subscription)
    const checkout = await call('POST', `/api/organizations/${organizationId}/billing/checkout`, { body: { planId: 'BUSINESS' }, userId });
    expect(checkout.status).toBe(200);
    expect(checkout.body.url).toMatch(/^local-billing:\/\//);

    const webhookPayload = { id: `evt_${randomBytes(4).toString('hex')}`, type: 'checkout.completed', organizationId, planId: 'BUSINESS', subscriptionId: `sub_${randomBytes(4).toString('hex')}` };
    const raw = JSON.stringify(webhookPayload);
    const signature = webhookSigner.sign(raw);
    const webhookResponse = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-billing-signature': signature }, body: raw });
    expect(webhookResponse.status).toBe(200);
    expect((await webhookResponse.json()).received).toBe(true);

    // ENTITLEMENTS UPDATED: the previously blocked repository can now be connected.
    const project2 = await call('POST', '/api/projects', { body: { organizationId, name: 'Repo Two', repositoryName: 'org/repo-two' }, userId });
    expect(project2.status).toBe(201);

    const billingAfterUpgrade = await call('GET', `/api/organizations/${organizationId}/billing`, { userId });
    expect(billingAfterUpgrade.body.subscription.status).toBe('ACTIVE');
    expect(billingAfterUpgrade.body.subscription.planId).toBe('BUSINESS');

    // FIRST SCAN (never dropped even near a limit; usage is reported alongside the result)
    const scanResult = {
      metadata: { scanner: 'compliance-check', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'test' },
      scannedPath: '.', filesScanned: 3, skippedFiles: 0, malformedSuppressions: 0, durationMs: 12, rulesExecuted: 10,
      aiComponents: [], findings: [{ ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'test', severity: 'HIGH', category: 'SECRET', filePath: 'a.ts', line: 1, evidence: 'sk_test_****xyz', remediation: 'rotate it', frameworks: [], confidence: 'HIGH', fingerprint: 'fp1' }],
      suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 }, status: 'FAILED'
    };
    const scan = await call('POST', '/api/scans', { body: { projectId, result: scanResult }, token });
    expect(scan.status).toBe(201);
    expect(scan.body.usage.capability).toBe('monthlyScans');

    // VALUE DISCOVERED
    const findings = await call('GET', '/api/findings', { userId });
    expect(findings.status).toBe(200);
    expect(findings.body.length).toBe(1);
    const findingId = findings.body[0].id as string;

    const resolved = await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'RESOLVED' }, userId });
    expect(resolved.status).toBe(200);

    // Usage dashboard reflects plan limits.
    const usage = await call('GET', `/api/organizations/${organizationId}/usage`, { userId });
    expect(usage.status).toBe(200);
    expect(usage.body.plan).toBe('BUSINESS');
    expect(usage.body.repositories.used).toBe(2);

    // TEAM ADOPTION: data export preserves everything captured so far.
    const beforeDowngradeExport = await call('GET', `/api/organizations/${organizationId}/export`, { userId });
    expect(beforeDowngradeExport.status).toBe(200);
    expect(beforeDowngradeExport.body.projects.length).toBe(2);
    expect(beforeDowngradeExport.body.scans.length).toBe(1);
    expect(beforeDowngradeExport.body.findings.length).toBe(1);

    // DOWNGRADE: historical data must remain even though usage now exceeds the new plan's limits.
    const downgrade = await call('POST', `/api/organizations/${organizationId}/billing/change-plan`, { body: { planId: 'FREE' }, userId });
    expect(downgrade.status).toBe(200);
    expect(downgrade.body.planId).toBe('FREE');

    const afterDowngradeExport = await call('GET', `/api/organizations/${organizationId}/export`, { userId });
    expect(afterDowngradeExport.body.projects.length).toBe(2);
    expect(afterDowngradeExport.body.scans.length).toBe(1);
    expect(afterDowngradeExport.body.findings.length).toBe(1);

    // A third repository is blocked again under FREE, but nothing existing was deleted.
    const project3Blocked = await call('POST', '/api/projects', { body: { organizationId, name: 'Repo Three', repositoryName: 'org/repo-three' }, userId });
    expect(project3Blocked.status).toBe(402);

    // CANCEL SUBSCRIPTION (distinct from deleting the organization): scheduled for period end, data intact.
    const cancel = await call('POST', `/api/organizations/${organizationId}/billing/cancel`, { userId });
    expect(cancel.status).toBe(200);
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);

    const afterCancelProjects = await call('GET', '/api/projects', { userId });
    expect(afterCancelProjects.body.length).toBe(2);
  });

  it('rejects forged and replayed billing webhooks (server remains authoritative)', async () => {
    const userId = `user_${randomBytes(4).toString('hex')}`;
    const org = await call('POST', '/api/organizations', { body: { name: 'Webhook Test Org' }, userId });
    const organizationId = org.body.id as string;

    const payload = { id: `evt_${randomBytes(4).toString('hex')}`, type: 'checkout.completed', organizationId, planId: 'TEAM', subscriptionId: 'sub_x' };
    const raw = JSON.stringify(payload);
    const validSignature = webhookSigner.sign(raw);

    const forged = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-billing-signature': 'forged-signature' }, body: raw });
    expect(forged.status).toBe(401);

    const unsigned = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    expect(unsigned.status).toBe(401);

    const first = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-billing-signature': validSignature }, body: raw });
    expect(first.status).toBe(200);
    expect((await first.json()).received).toBe(true);

    // Replay / duplicate event id must be a no-op, never double-applied.
    const replay = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-billing-signature': validSignature }, body: raw });
    expect(replay.status).toBe(200);
    expect((await replay.json()).duplicate).toBe(true);
  });

  it('never allows a client to change plan for an organization it is not a member of', async () => {
    const ownerId = `user_${randomBytes(4).toString('hex')}`;
    const outsiderId = `user_${randomBytes(4).toString('hex')}`;
    const org = await call('POST', '/api/organizations', { body: { name: 'Tenant Isolation Org' }, userId: ownerId });
    const organizationId = org.body.id as string;
    const attempt = await call('POST', `/api/organizations/${organizationId}/billing/change-plan`, { body: { planId: 'ENTERPRISE' }, userId: outsiderId });
    expect(attempt.status).toBe(403);
  });

  it('protects the admin commercial dashboard from tenant-level access', async () => {
    const userId = `user_${randomBytes(4).toString('hex')}`;
    await call('POST', '/api/organizations', { body: { name: 'Admin Metrics Org' }, userId });
    const asTenant = await call('GET', '/api/admin/commercial', { userId });
    expect(asTenant.status).toBe(403);
    const asAdmin = await call('GET', '/api/admin/commercial', { adminToken });
    expect(asAdmin.status).toBe(200);
    expect(typeof asAdmin.body.organizations).toBe('number');
  });

  it('captures sales-assisted enterprise leads with validation and rate limiting, isolated from public read access', async () => {
    const valid = await call('POST', '/api/leads', { body: { name: 'Jane Doe', workEmail: 'jane@example.com', company: 'Example Corp', role: 'CISO', companySize: '500-1000', repositoriesExpected: 80, useCase: 'AI Governance' } });
    expect(valid.status).toBe(201);

    const invalid = await call('POST', '/api/leads', { body: { name: 'A', workEmail: 'not-an-email', company: '', role: '', companySize: '', repositoriesExpected: -1, useCase: 'nope' } });
    expect(invalid.status).toBe(400);

    const publicList = await call('GET', '/api/admin/leads');
    expect(publicList.status).toBe(403);

    const adminList = await call('GET', '/api/admin/leads', { adminToken });
    expect(adminList.status).toBe(200);
    expect(Array.isArray(adminList.body)).toBe(true);
  });
});
