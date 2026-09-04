import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type http from 'node:http';

// Production readiness: an authorized project-level kill switch (MONITOR /
// WARN / BLOCK) must exist, be role-gated, and be recorded in the audit log.
describe('project enforcement mode (CI kill switch)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = `${os.tmpdir()}/platform-enforcement-${randomBytes(6).toString('hex')}.json`;
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

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  it('defaults new projects to BLOCK, allows an owner to change mode, and records it in the audit log', async () => {
    const ownerId = `user_${randomBytes(4).toString('hex')}`;
    const viewerId = `user_${randomBytes(4).toString('hex')}`;
    const org = await call('POST', '/api/organizations', { body: { name: 'Enforcement Test Org' }, userId: ownerId });
    const organizationId = org.body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Repo', repositoryName: 'org/repo' }, userId: ownerId });
    expect(project.body.project.enforcementMode).toBe('BLOCK');
    const projectId = project.body.project.id as string;

    const denied = await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'MONITOR' }, userId: viewerId });
    expect(denied.status).toBe(404); // viewer is not even a member of this org in this test

    const changed = await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'MONITOR' }, userId: ownerId });
    expect(changed.status).toBe(200);
    expect(changed.body.enforcementMode).toBe('MONITOR');

    const invalid = await call('PATCH', `/api/projects/${projectId}/enforcement`, { body: { enforcementMode: 'NOT_A_MODE' }, userId: ownerId });
    expect(invalid.status).toBe(400);

    const audit = await call('GET', '/api/audit', { userId: ownerId });
    expect(audit.body.some((event: { type: string; metadata?: { to?: string } }) => event.type === 'ENFORCEMENT_MODE_CHANGED' && event.metadata?.to === 'MONITOR')).toBe(true);
  });
});
