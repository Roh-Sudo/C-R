import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { getRules, scanDirectory } from '../packages/compliance-core/src/index.js';

// The dashboard policy must be the same policy the scanner applies: these tests
// read it back through the API and then feed it into a real scan of a synthetic
// fixture to prove the persisted values change the outcome.
describe('project policy workflow', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  let fixture: string;
  const owner = `policy_owner_${randomBytes(4).toString('hex')}`;
  const viewer = `policy_viewer_${randomBytes(4).toString('hex')}`;
  const intruder = `policy_beta_${randomBytes(4).toString('hex')}`;
  let organizationId: string;
  let projectId: string;
  let projectToken: string;
  let betaProjectId: string;
  let betaToken: string;

  async function start(): Promise<void> {
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind to a port');
    base = `http://127.0.0.1:${address.port}`;
  }

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  /** Runs the real scanner with the policy the API returns, exactly as `--remote-policy` does. */
  async function scanWithPersistedPolicy(token: string, project: string) {
    const policy = await call('GET', `/api/projects/${project}/policy`, { token });
    expect(policy.status).toBe(200);
    const config = { failOn: policy.body.failOn, rules: Object.fromEntries((policy.body.disabledRules as string[]).map(ruleId => [ruleId, 'off' as const])) };
    const result = await scanDirectory(fixture, config);
    return { policy: policy.body, result, blocking: result.status === 'FAILED' && policy.body.enforcementMode === 'BLOCK' };
  }

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-policy-${randomBytes(6).toString('hex')}.json`);
    fixture = path.join(os.tmpdir(), `policy-fixture-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(fixture, { recursive: true });
    // Synthetic fixture: one HIGH/CRITICAL secret finding and nothing else.
    await fs.writeFile(path.join(fixture, 'app.ts'), 'export const apiKey = "sk_live_51ceb99a4d0f2e7b8c1dAAAA";\n');
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    organizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner })).body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Policy Demo', repositoryName: 'alpha/policy-demo' }, userId: owner });
    projectId = project.body.project.id as string;
    projectToken = project.body.token as string;
    const betaOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: intruder })).body.id as string;
    const betaProject = await call('POST', '/api/projects', { body: { organizationId: betaOrg, name: 'Beta App', repositoryName: 'beta/app' }, userId: intruder });
    betaProjectId = betaProject.body.project.id as string;
    betaToken = betaProject.body.token as string;
    const store = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { users: unknown[]; memberships: unknown[] };
    store.users.push({ id: viewer, email: `${viewer}@example.test`, displayName: 'Read Only', createdAt: new Date().toISOString() });
    store.memberships.push({ organizationId, userId: viewer, role: 'VIEWER' });
    await fs.writeFile(dataFile, `${JSON.stringify(store)}\n`);
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
    await fs.rm(fixture, { recursive: true, force: true });
  });

  it('serves the persisted default policy to the dashboard and to the scanner token', async () => {
    const forDashboard = await call('GET', `/api/projects/${projectId}/policy`, { userId: owner });
    expect(forDashboard.status).toBe(200);
    expect(forDashboard.body).toMatchObject({ projectId, enforcementMode: 'BLOCK', failOn: 'HIGH', disabledRules: [] });
    const forScanner = await call('GET', `/api/projects/${projectId}/policy`, { token: projectToken });
    expect(forScanner.body).toEqual(forDashboard.body);
    expect((await call('GET', `/api/projects/${projectId}/policy`)).status).toBe(404);
  });

  it('saves a policy and keeps it after an API restart', async () => {
    const saved = await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'WARN', failOn: 'CRITICAL', disabledRules: ['CFG-005'] }, userId: owner });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ enforcementMode: 'WARN', failOn: 'CRITICAL', disabledRules: ['CFG-005'] });

    const persisted = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { projects: { id: string; enforcementMode: string; failOn: string; disabledRules: string[] }[] };
    expect(persisted.projects.find(item => item.id === projectId)).toMatchObject({ enforcementMode: 'WARN', failOn: 'CRITICAL', disabledRules: ['CFG-005'] });

    await new Promise(resolve => server.close(resolve));
    await start();
    expect((await call('GET', `/api/projects/${projectId}/policy`, { userId: owner })).body).toMatchObject({ enforcementMode: 'WARN', failOn: 'CRITICAL', disabledRules: ['CFG-005'] });
    expect((await call('GET', '/api/audit', { userId: owner })).body.some((event: { type: string }) => event.type === 'POLICY_UPDATED')).toBe(true);
  });

  it('changes the scan outcome when the persisted policy changes', async () => {
    await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'BLOCK', failOn: 'CRITICAL', disabledRules: [] }, userId: owner });
    const strict = await scanWithPersistedPolicy(projectToken, projectId);
    expect(strict.result.findings.some(item => item.ruleId === 'SEC-001')).toBe(true);
    expect(strict.result.status).toBe('FAILED');
    expect(strict.blocking).toBe(true);

    // Same fixture, same findings: only the persisted enforcement mode changes.
    await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'MONITOR', failOn: 'CRITICAL', disabledRules: [] }, userId: owner });
    const monitored = await scanWithPersistedPolicy(projectToken, projectId);
    expect(monitored.result.findings.length).toBe(strict.result.findings.length);
    expect(monitored.result.status).toBe('FAILED');
    expect(monitored.blocking).toBe(false);
  });

  it('applies the persisted rule disable list to the scanner', async () => {
    await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'BLOCK', failOn: 'CRITICAL', disabledRules: [] }, userId: owner });
    const enabled = await scanWithPersistedPolicy(projectToken, projectId);
    expect(enabled.result.findings.some(item => item.ruleId === 'SEC-001')).toBe(true);
    expect(enabled.blocking).toBe(true);

    await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'BLOCK', failOn: 'CRITICAL', disabledRules: ['SEC-001'] }, userId: owner });
    const disabled = await scanWithPersistedPolicy(projectToken, projectId);
    expect(getRules({ rules: { 'SEC-001': 'off' } }).some(rule => rule.id === 'SEC-001')).toBe(false);
    expect(disabled.result.findings.some(item => item.ruleId === 'SEC-001')).toBe(false);
    expect(disabled.blocking).toBe(false);

    await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'BLOCK', failOn: 'CRITICAL', disabledRules: [] }, userId: owner });
    expect((await scanWithPersistedPolicy(projectToken, projectId)).result.findings.some(item => item.ruleId === 'SEC-001')).toBe(true);
  });

  it('records the applied policy on the ingested scan', async () => {
    await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'WARN', failOn: 'MEDIUM', disabledRules: [] }, userId: owner });
    const { result } = await scanWithPersistedPolicy(projectToken, projectId);
    const upload = await call('POST', '/api/scans', { body: { projectId, result }, token: projectToken });
    expect(upload.status).toBe(201);
    expect(upload.body.scan).toMatchObject({ policyEnforcementMode: 'WARN', policyFailOn: 'MEDIUM' });
    expect((await call('GET', '/api/scans', { userId: owner })).body.find((item: { id: string }) => item.id === upload.body.scan.id)).toMatchObject({ policyEnforcementMode: 'WARN', policyFailOn: 'MEDIUM' });
  });

  it('rejects an invalid policy and leaves the stored policy untouched', async () => {
    const before = (await call('GET', `/api/projects/${projectId}/policy`, { userId: owner })).body;
    const cases: [unknown, string][] = [
      [{ enforcementMode: 'NOT_A_MODE', failOn: 'HIGH', disabledRules: [] }, 'enforcementMode must be MONITOR, WARN, or BLOCK'],
      [{ enforcementMode: 'BLOCK', failOn: 'EXTREME', disabledRules: [] }, 'failOn must be LOW, MEDIUM, HIGH, or CRITICAL'],
      [{ enforcementMode: 'BLOCK', failOn: 'HIGH', disabledRules: 'SEC-001' }, 'disabledRules must be an array of rule identifiers'],
      [{ enforcementMode: 'BLOCK', failOn: 'HIGH', disabledRules: ['NOT-A-RULE'] }, 'unknown rule identifiers: NOT-A-RULE']
    ];
    for (const [body, message] of cases) {
      const rejected = await call('PUT', `/api/projects/${projectId}/policy`, { body, userId: owner });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toBe(message);
    }
    expect((await call('GET', `/api/projects/${projectId}/policy`, { userId: owner })).body).toEqual(before);
  });

  it('denies policy changes to a read-only member and to another tenant', async () => {
    const before = (await call('GET', `/api/projects/${projectId}/policy`, { userId: owner })).body;

    expect((await call('GET', `/api/projects/${projectId}/policy`, { userId: viewer })).status).toBe(200);
    const viewerDenied = await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'MONITOR', failOn: 'LOW', disabledRules: [] }, userId: viewer });
    expect(viewerDenied.status).toBe(403);
    expect(viewerDenied.body.error).toBe('owner or admin role required');

    expect((await call('GET', `/api/projects/${projectId}/policy`, { userId: intruder })).status).toBe(404);
    expect((await call('GET', `/api/projects/${projectId}/policy`, { token: betaToken })).status).toBe(404);
    expect((await call('PUT', `/api/projects/${projectId}/policy`, { body: { enforcementMode: 'MONITOR', failOn: 'LOW', disabledRules: [] }, userId: intruder })).status).toBe(404);

    expect((await call('GET', `/api/projects/${projectId}/policy`, { userId: owner })).body).toEqual(before);
    expect((await call('GET', `/api/projects/${betaProjectId}/policy`, { userId: intruder })).body).toMatchObject({ enforcementMode: 'BLOCK', failOn: 'HIGH', disabledRules: [] });
  });
});
