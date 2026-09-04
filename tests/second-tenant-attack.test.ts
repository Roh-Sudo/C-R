import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type http from 'node:http';

// Dedicated adversarial second-tenant-attack pass (Phase 11, sections 5 & 28).
// "First Customer Dry Run" (victim) vs "Attacker Tenant". Every mutating and
// exporting endpoint that accepts a foreign resource ID must deny access.
describe('adversarial second-tenant attack (Attacker Tenant vs First Customer Dry Run)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = `${os.tmpdir()}/platform-attacker-${randomBytes(6).toString('hex')}.json`;
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

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  it('denies every attempted cross-tenant read, write, and export', async () => {
    const victimOwner = `user_victim_${randomBytes(4).toString('hex')}`;
    const attacker = `user_attacker_${randomBytes(4).toString('hex')}`;

    const victimOrg = await call('POST', '/api/organizations', { body: { name: 'First Customer Dry Run' }, userId: victimOwner });
    const victimOrgId = victimOrg.body.id as string;
    await call('POST', '/api/organizations', { body: { name: 'Attacker Tenant' }, userId: attacker });

    const project = await call('POST', '/api/projects', { body: { organizationId: victimOrgId, name: 'payments-service', repositoryName: 'victim/payments-service' }, userId: victimOwner });
    const projectId = project.body.project.id as string;
    const victimToken = project.body.token as string;

    const scanResult = {
      metadata: { scanner: 'compliance-check', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'test' },
      scannedPath: '.', filesScanned: 2, skippedFiles: 0, malformedSuppressions: 0, durationMs: 5, rulesExecuted: 10,
      aiComponents: [{ id: 'ai_victim', provider: 'OpenAI', technology: 'openai-sdk', filePath: 'a.ts', lineNumber: 1, discoveryMethod: 'pattern', confidence: 'HIGH', status: 'DISCOVERED', firstDetected: new Date().toISOString(), lastDetected: new Date().toISOString() }],
      findings: [{ ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'test', severity: 'HIGH', category: 'SECRET', filePath: 'a.ts', line: 1, evidence: 'sk_test_****xyz', remediation: 'rotate it', frameworks: [], confidence: 'HIGH', fingerprint: 'fp_victim' }],
      suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 }, status: 'FAILED'
    };
    const scan = await call('POST', '/api/scans', { body: { projectId, result: scanResult }, token: victimToken });
    const findingId = scan.body.scan.findingIds[0] as string;
    const pilot = await call('POST', '/api/pilots', { body: { organizationId: victimOrgId, name: 'Victim Pilot', projectIds: [projectId] }, userId: victimOwner });
    expect(pilot.status).toBe(201);

    // ATTACKER READ attempts (list endpoints must never include victim data).
    expect((await call('GET', '/api/projects', { userId: attacker })).body.some((p: { id: string }) => p.id === projectId)).toBe(false);
    expect((await call('GET', '/api/findings', { userId: attacker })).body.some((f: { id: string }) => f.id === findingId)).toBe(false);
    expect((await call('GET', '/api/ai-components', { userId: attacker })).body.length).toBe(0);
    expect((await call('GET', '/api/pilots', { userId: attacker })).body.length).toBe(0);
    expect((await call('GET', '/api/audit', { userId: attacker })).body.some((e: { organizationId: string }) => e.organizationId === victimOrgId)).toBe(false);

    // ATTACKER direct-ID (IDOR) reads.
    expect((await call('GET', `/api/projects/${projectId}`, { userId: attacker })).status).toBe(404);
    expect((await call('GET', `/api/organizations/${victimOrgId}/billing`, { userId: attacker })).status).toBe(404);
    expect((await call('GET', `/api/organizations/${victimOrgId}/usage`, { userId: attacker })).status).toBe(404);
    expect((await call('GET', `/api/organizations/${victimOrgId}/members`, { userId: attacker })).status).toBe(404);

    // ATTACKER WRITE/PATCH attempts.
    expect((await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'RESOLVED' }, userId: attacker })).status).toBe(404);
    expect((await call('POST', `/api/findings/${findingId}/classification`, { body: { classification: 'FALSE_POSITIVE' }, userId: attacker })).status).toBe(404);
    expect((await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'MONITOR' }, userId: attacker })).status).toBe(404);
    expect((await call('POST', `/api/projects/${projectId}/revoke-token`, { userId: attacker })).status).toBe(404);
    expect((await call('POST', `/api/projects/${projectId}/rotate-token`, { userId: attacker })).status).toBe(404);
    expect((await call('POST', `/api/organizations/${victimOrgId}/billing/change-plan`, { body: { planId: 'ENTERPRISE' }, userId: attacker })).status).toBe(403);
    expect((await call('POST', `/api/organizations/${victimOrgId}/billing/cancel`, { userId: attacker })).status).toBe(403);
    expect((await call('POST', `/api/organizations/${victimOrgId}/members`, { body: { userId: attacker }, userId: attacker })).status).toBe(404);

    // ATTACKER EXPORT attempts.
    expect((await call('GET', `/api/organizations/${victimOrgId}/export`, { userId: attacker })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${victimOrgId}/audit/export`, { userId: attacker })).status).toBe(403);

    // ATTACKER attempting to forge scan ingestion with a guessed/empty token must fail.
    expect((await call('POST', '/api/scans', { body: { projectId, result: scanResult }, token: 'guessed-token' })).status).toBe(401);

    // Victim's own token and access must still work after the attack attempts (isolation is not over-broad).
    expect((await call('GET', `/api/projects/${projectId}`, { userId: victimOwner })).status).toBe(200);
    const revoked = await call('POST', `/api/projects/${projectId}/revoke-token`, { userId: victimOwner });
    expect(revoked.status).toBe(200);
    // Once revoked by the legitimate owner, even the legitimate token must be rejected.
    expect((await call('POST', '/api/scans', { body: { projectId, result: scanResult }, token: victimToken })).status).toBe(401);
  });
});
