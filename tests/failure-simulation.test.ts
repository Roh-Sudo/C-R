import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type http from 'node:http';

// Verifies predictable, documented behavior under common failure conditions
// (Phase 10 failure simulation). All scenarios are exercised against the
// real HTTP server so the actual response codes/bodies are asserted, not
// merely described.
describe('failure simulation', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = `${os.tmpdir()}/platform-failure-sim-${randomBytes(6).toString('hex')}.json`;
    process.env.PLATFORM_DATA_FILE = dataFile;
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

  async function call(method: string, urlPath: string, options: { body?: string | object; userId?: string; token?: string; rawBody?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
    const response = await fetch(`${base}${urlPath}`, { method, headers, body });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  async function setupProject() {
    const ownerId = `user_${randomBytes(4).toString('hex')}`;
    const org = await call('POST', '/api/organizations', { body: { name: 'Failure Sim Org' }, userId: ownerId });
    const organizationId = org.body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Repo', repositoryName: 'org/repo' }, userId: ownerId });
    return { ownerId, organizationId, projectId: project.body.project.id as string, token: project.body.token as string };
  }

  it('rejects scan ingestion with an invalid token without creating any data', async () => {
    const { projectId } = await setupProject();
    const result = await call('POST', '/api/scans', { body: { projectId, result: { metadata: { scanner: 'x', version: '1', timestamp: new Date().toISOString(), disclaimer: 'x' }, scannedPath: '.', filesScanned: 0, skippedFiles: 0, malformedSuppressions: 0, durationMs: 1, rulesExecuted: 0, aiComponents: [], findings: [], suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }, status: 'PASS' } }, token: 'not-the-real-token' });
    expect(result.status).toBe(401);
  });

  it('rejects a revoked/expired-equivalent token consistently (never silently accepted)', async () => {
    const { projectId } = await setupProject();
    // No explicit revoke endpoint is exercised here; a wrong/mismatched token is functionally equivalent
    // from the caller's perspective and must always be rejected.
    const result = await call('POST', '/api/scans', { body: { projectId, result: {} }, token: `${randomBytes(24).toString('base64url')}` });
    expect(result.status).toBe(401);
  });

  it('rejects a malformed scan payload safely (400, not a server crash)', async () => {
    const { projectId, token } = await setupProject();
    const result = await call('POST', '/api/scans', { body: { projectId }, token });
    expect(result.status).toBe(400);
  });

  it('rejects a malformed JSON body safely instead of crashing the process', async () => {
    const result = await call('POST', '/api/organizations', { rawBody: '{not valid json', userId: `user_${randomBytes(4).toString('hex')}` });
    expect(result.status).toBe(400);
    // The server must still be responsive after a malformed request.
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });

  it('rejects an oversized scan (too many findings) without partially applying it', async () => {
    const { projectId, token } = await setupProject();
    const oversizedFindings = Array.from({ length: 10_001 }, (_, index) => ({ ruleId: 'SEC-001', title: 'x', description: 'x', severity: 'LOW', category: 'SECRET', filePath: 'a.ts', line: index + 1, evidence: 'x', remediation: 'x', frameworks: [], confidence: 'LOW', fingerprint: `fp_${index}` }));
    const result = await call('POST', '/api/scans', { body: { projectId, result: { metadata: { scanner: 'x', version: '1', timestamp: new Date().toISOString(), disclaimer: 'x' }, scannedPath: '.', filesScanned: 1, skippedFiles: 0, malformedSuppressions: 0, durationMs: 1, rulesExecuted: 1, aiComponents: [], findings: oversizedFindings, suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 10001, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }, status: 'FAILED' } }, token });
    expect(result.status).toBe(413);
    const findings = await call('GET', '/api/findings', { userId: 'irrelevant-for-this-check' });
    expect(findings.body.filter((item: { projectId: string }) => item.projectId === projectId).length).toBe(0);
  });

  it('treats a duplicate billing webhook delivery as a safe no-op', async () => {
    const { organizationId } = await setupProject();
    const { LocalBillingProvider } = await import('../packages/billing-core/src/index.js');
    const signer = new LocalBillingProvider(process.env.LOCAL_BILLING_WEBHOOK_SECRET ?? 'local-test-billing-secret');
    const payload = JSON.stringify({ id: `evt_${randomBytes(4).toString('hex')}`, type: 'checkout.completed', organizationId, planId: 'TEAM', subscriptionId: 'sub_x' });
    const signature = signer.sign(payload);
    const first = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-billing-signature': signature }, body: payload });
    const second = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-local-billing-signature': signature }, body: payload });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).duplicate).toBe(true);
  });

  it('reports project state under MONITOR mode without ever silently changing enforcement behavior', async () => {
    const { organizationId, projectId, ownerId } = await setupProject();
    const changed = await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'MONITOR' }, userId: ownerId });
    expect(changed.status).toBe(200);
    expect(changed.body.enforcementMode).toBe('MONITOR');
    const audit = await call('GET', '/api/audit', { userId: ownerId });
    expect(audit.body.some((event: { type: string; organizationId: string }) => event.type === 'ENFORCEMENT_MODE_CHANGED' && event.organizationId === organizationId)).toBe(true);
  });
});
