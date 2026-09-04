import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';

// Production blocker check: two organizations must never be able to read or
// write each other's data through any resource-ID-accepting endpoint.
describe('tenant isolation regression (Organization Alpha vs Organization Beta)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-tenant-${randomBytes(6).toString('hex')}.json`);
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

  it('denies Organization Beta access to every Organization Alpha resource type', async () => {
    const alphaUser = `user_alpha_${randomBytes(4).toString('hex')}`;
    const betaUser = `user_beta_${randomBytes(4).toString('hex')}`;

    const alphaOrg = await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: alphaUser });
    const alphaOrgId = alphaOrg.body.id as string;
    await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: betaUser });

    const project = await call('POST', '/api/projects', { body: { organizationId: alphaOrgId, name: 'Alpha Repo', repositoryName: 'alpha/repo' }, userId: alphaUser });
    const projectId = project.body.project.id as string;
    const token = project.body.token as string;

    const scanResult = {
      metadata: { scanner: 'compliance-check', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'test' },
      scannedPath: '.', filesScanned: 1, skippedFiles: 0, malformedSuppressions: 0, durationMs: 1, rulesExecuted: 1,
      aiComponents: [{ id: 'ai_1', provider: 'OpenAI', technology: 'openai-sdk', filePath: 'a.ts', lineNumber: 1, discoveryMethod: 'pattern', confidence: 'HIGH', status: 'DISCOVERED', firstDetected: new Date().toISOString(), lastDetected: new Date().toISOString() }],
      findings: [{ ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'test', severity: 'HIGH', category: 'SECRET', filePath: 'a.ts', line: 1, evidence: 'sk_test_****xyz', remediation: 'rotate it', frameworks: [], confidence: 'HIGH', fingerprint: 'fp_alpha' }],
      suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 }, status: 'FAILED'
    };
    const scan = await call('POST', '/api/scans', { body: { projectId, result: scanResult }, token });
    const scanId = scan.body.scan.id as string;
    const findingId = scan.body.scan.findingIds[0] as string;

    await call('POST', '/api/pilots', { body: { name: 'Alpha Pilot', projectIds: [projectId] }, userId: alphaUser });

    // Cross-tenant reads through the general list endpoints must never include Alpha's data for Beta.
    const betaProjects = await call('GET', '/api/projects', { userId: betaUser });
    expect(betaProjects.body.some((item: { id: string }) => item.id === projectId)).toBe(false);

    const betaFindings = await call('GET', '/api/findings', { userId: betaUser });
    expect(betaFindings.body.some((item: { id: string }) => item.id === findingId)).toBe(false);

    const betaScans = await call('GET', '/api/scans', { userId: betaUser });
    expect(betaScans.body.some((item: { id: string }) => item.id === scanId)).toBe(false);

    const betaAI = await call('GET', '/api/ai-components', { userId: betaUser });
    expect(betaAI.body.length).toBe(0);

    const betaPilots = await call('GET', '/api/pilots', { userId: betaUser });
    expect(betaPilots.body.length).toBe(0);

    const betaAudit = await call('GET', '/api/audit', { userId: betaUser });
    expect(betaAudit.body.some((item: { organizationId: string }) => item.organizationId === alphaOrgId)).toBe(false);

    // Direct resource-ID access (IDOR-style) must also be denied, not merely absent from list views.
    expect((await call('GET', `/api/projects/${projectId}`, { userId: betaUser })).status).toBe(404);
    expect((await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'RESOLVED' }, userId: betaUser })).status).toBe(404);
    expect((await call('POST', `/api/findings/${findingId}/classification`, { body: { classification: 'FALSE_POSITIVE' }, userId: betaUser })).status).toBe(404);
    expect((await call('GET', `/api/organizations/${alphaOrgId}/billing`, { userId: betaUser })).status).toBe(404);
    expect((await call('POST', `/api/organizations/${alphaOrgId}/billing/change-plan`, { body: { planId: 'ENTERPRISE' }, userId: betaUser })).status).toBe(403);
    expect((await call('POST', `/api/organizations/${alphaOrgId}/billing/cancel`, { userId: betaUser })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${alphaOrgId}/usage`, { userId: betaUser })).status).toBe(404);
    expect((await call('GET', `/api/organizations/${alphaOrgId}/export`, { userId: betaUser })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${alphaOrgId}/audit/export`, { userId: betaUser })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${alphaOrgId}/members`, { userId: betaUser })).status).toBe(404);
    expect((await call('POST', `/api/organizations/${alphaOrgId}/members`, { body: { userId: betaUser }, userId: betaUser })).status).toBe(404);

    // Alpha can still access its own data (isolation must not be over-broad).
    expect((await call('GET', `/api/projects/${projectId}`, { userId: alphaUser })).status).toBe(200);
  });
});
