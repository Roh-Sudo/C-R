import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type http from 'node:http';

describe('authorization role matrix', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = `${os.tmpdir()}/platform-rbac-${randomBytes(6).toString('hex')}.json`;
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

  it('enforces the documented role matrix and rejects role escalation', async () => {
    const ownerId = `user_owner_${randomBytes(4).toString('hex')}`;
    const adminId = `user_admin_${randomBytes(4).toString('hex')}`;
    const developerId = `user_developer_${randomBytes(4).toString('hex')}`;
    const viewerId = `user_viewer_${randomBytes(4).toString('hex')}`;
    const org = await call('POST', '/api/organizations', { body: { name: 'RBAC Test Organization' }, userId: ownerId });
    const organizationId = org.body.id as string;
    const now = new Date().toISOString();
    const store = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { users: unknown[]; memberships: unknown[] };
    store.users.push(
      { id: adminId, email: `${adminId}@example.test`, displayName: 'Test Admin', createdAt: now },
      { id: developerId, email: `${developerId}@example.test`, displayName: 'Test Developer', createdAt: now },
      { id: viewerId, email: `${viewerId}@example.test`, displayName: 'Test Viewer', createdAt: now }
    );
    store.memberships.push(
      { organizationId, userId: adminId, role: 'ADMIN' },
      { organizationId, userId: developerId, role: 'DEVELOPER' },
      { organizationId, userId: viewerId, role: 'VIEWER' }
    );
    await fs.writeFile(dataFile, `${JSON.stringify(store)}\n`);

    const ownerProject = await call('POST', '/api/projects', { body: { organizationId, name: 'Owner Repo', repositoryName: 'rbac/owner' }, userId: ownerId });
    expect(ownerProject.status).toBe(201);
    const projectId = ownerProject.body.project.id as string;
    const scanResult = {
      metadata: { scanner: 'compliance-check', version: '0.2.0', timestamp: now, disclaimer: 'test' },
      scannedPath: '.', filesScanned: 1, skippedFiles: 0, malformedSuppressions: 0, durationMs: 1, rulesExecuted: 1,
      aiComponents: [], findings: [{ ruleId: 'SEC-001', title: 'Synthetic finding', description: 'test', severity: 'HIGH', category: 'SECRET', filePath: 'a.ts', line: 1, evidence: 'sk_test_****rbac', remediation: 'rotate', frameworks: [], confidence: 'HIGH', fingerprint: 'fp_rbac' }],
      suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 }, status: 'FAILED'
    };
    const scan = await call('POST', '/api/scans', { body: { projectId, result: scanResult }, token: ownerProject.body.token });
    const findingId = scan.body.scan.findingIds[0] as string;

    expect((await call('POST', '/api/projects', { body: { organizationId, name: 'Admin Repo', repositoryName: 'rbac/admin' }, userId: adminId })).status).toBe(201);
    expect((await call('POST', '/api/projects', { body: { organizationId, name: 'Developer Repo', repositoryName: 'rbac/developer' }, userId: developerId })).status).toBe(403);
    expect((await call('POST', '/api/projects', { body: { organizationId, name: 'Viewer Repo', repositoryName: 'rbac/viewer', role: 'OWNER' }, userId: viewerId })).status).toBe(403);

    expect((await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'MONITOR' }, userId: adminId })).status).toBe(200);
    expect((await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'BLOCK' }, userId: developerId })).status).toBe(403);
    expect((await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'BLOCK' }, userId: viewerId })).status).toBe(403);

    expect((await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'RESOLVED' }, userId: developerId })).status).toBe(200);
    expect((await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'OPEN' }, userId: viewerId })).status).toBe(403);

    expect((await call('POST', '/api/pilots', { body: { organizationId, name: 'Admin Pilot', projectIds: [projectId] }, userId: adminId })).status).toBe(201);
    expect((await call('POST', '/api/pilots', { body: { organizationId, name: 'Developer Pilot', projectIds: [projectId] }, userId: developerId })).status).toBe(403);
    expect((await call('POST', '/api/organizations/' + organizationId + '/members', { body: { userId: developerId, role: 'OWNER' }, userId: viewerId })).status).toBe(403);

    expect((await call('GET', `/api/organizations/${organizationId}/billing`, { userId: viewerId })).status).toBe(200);
    expect((await call('POST', `/api/organizations/${organizationId}/billing/change-plan`, { body: { planId: 'BUSINESS' }, userId: developerId })).status).toBe(403);
    expect((await call('POST', `/api/organizations/${organizationId}/billing/cancel`, { userId: adminId })).status).toBe(200);
  });
});
