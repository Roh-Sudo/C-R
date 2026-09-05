import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';

// Contract the Projects UI (apps/web/src/main.tsx) depends on end to end:
// list, create, persistence across an API restart, authorization, and the JSON
// error shape the frontend `api()` helper renders.
describe('project management workflow (Projects UI contract)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  const owner = 'workflow_owner';
  const viewer = 'workflow_viewer';
  const beta = 'workflow_beta';
  let organizationId: string;

  async function start(): Promise<void> {
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind to a port');
    base = `http://127.0.0.1:${address.port}`;
  }

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-project-workflow-${randomBytes(6).toString('hex')}.json`);
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    const organization = await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner });
    organizationId = organization.body.id as string;
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

  it('serves the project list the UI renders, without leaking the token hash', async () => {
    const empty = await call('GET', '/api/projects', { userId: owner });
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const created = await call('POST', '/api/projects', { body: { organizationId, name: 'Customer Portal', repositoryName: 'alpha/customer-portal', defaultBranch: 'main' }, userId: owner });
    expect(created.status).toBe(201);
    expect(typeof created.body.token).toBe('string');
    expect(created.body.project.tokenHash).toBeUndefined();

    const listed = await call('GET', '/api/projects', { userId: owner });
    expect(listed.status).toBe(200);
    const project = listed.body.find((item: { id: string }) => item.id === created.body.project.id);
    expect(project).toMatchObject({ name: 'Customer Portal', repositoryName: 'alpha/customer-portal', defaultBranch: 'main', tokenPrefix: created.body.project.tokenPrefix });
    expect(project.score).toBe(100);
    expect(project.openFindings).toBe(0);
    expect(project.tokenHash).toBeUndefined();
  });

  it('keeps a created project after the API restarts', async () => {
    const created = await call('POST', '/api/projects', { body: { organizationId, name: 'Persisted Project', repositoryName: 'alpha/persisted' }, userId: owner });
    expect(created.status).toBe(201);
    const projectId = created.body.project.id as string;

    await new Promise(resolve => server.close(resolve));
    await start();

    const listed = await call('GET', '/api/projects', { userId: owner });
    expect(listed.body.some((item: { id: string }) => item.id === projectId)).toBe(true);
    const detail = await call('GET', `/api/projects/${projectId}`, { userId: owner });
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe('Persisted Project');
  });

  it('returns a JSON error body the UI can display instead of a fake success', async () => {
    const missingFields = await call('POST', '/api/projects', { body: { organizationId, repositoryName: 'alpha/no-name' }, userId: owner });
    expect(missingFields.status).toBe(400);
    expect(missingFields.body.error).toBe('name and repositoryName are required');

    const unknownOrganization = await call('POST', '/api/projects', { body: { organizationId: 'org_does_not_exist', name: 'Ghost', repositoryName: 'alpha/ghost' }, userId: owner });
    expect(unknownOrganization.status).toBe(403);
    expect(typeof unknownOrganization.body.error).toBe('string');

    const created = (await call('GET', '/api/projects', { userId: owner })).body as { id: string }[];
    expect(created.length).toBeGreaterThan(0);
  });

  it('enforces role and tenant authorization on project reads and mutations', async () => {
    const project = (await call('GET', '/api/projects', { userId: owner })).body[0] as { id: string };

    await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: beta });
    expect((await call('GET', '/api/projects', { userId: beta })).body).toEqual([]);
    expect((await call('GET', `/api/projects/${project.id}`, { userId: beta })).status).toBe(404);
    expect((await call('PATCH', `/api/projects/${project.id}/enforcement`, { body: { enforcementMode: 'MONITOR' }, userId: beta })).status).toBe(404);
    expect((await call('POST', `/api/projects/${project.id}/revoke-token`, { userId: beta })).status).toBe(404);
    expect((await call('POST', '/api/projects', { body: { organizationId, name: 'Beta Steals Alpha', repositoryName: 'beta/steal' }, userId: beta })).status).toBe(403);

    const stored = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { projects: { name: string }[] };
    expect(stored.projects.some(item => item.name === 'Beta Steals Alpha')).toBe(false);

    expect((await call('GET', `/api/projects/${project.id}`, { userId: viewer })).status).toBe(404);
  });
});
