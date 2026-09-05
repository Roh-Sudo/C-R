import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
// @ts-expect-error pg is a runtime dependency without bundled declarations.
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);

suite('PostgreSQL runtime persistence', () => {
  let server: http.Server;
  let base: string;
  let client: Client;

  beforeAll(async () => {
    process.env.PERSISTENCE = 'postgres';
    process.env.NODE_ENV = 'test';
    const mod = await import('../apps/api/src/index.js');
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('TRUNCATE runtime_state');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await client.end();
  });

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  it('writes API-created customer state to PostgreSQL and preserves it across API restart', async () => {
    const alphaUser = `pg_alpha_${randomBytes(4).toString('hex')}`;
    const betaUser = `pg_beta_${randomBytes(4).toString('hex')}`;
    const alpha = await call('POST', '/api/organizations', { body: { name: 'Postgres Alpha' }, userId: alphaUser });
    const beta = await call('POST', '/api/organizations', { body: { name: 'Postgres Beta' }, userId: betaUser });
    const alphaId = alpha.body.id as string;
    const betaId = beta.body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId: alphaId, name: 'Alpha Project', repositoryName: 'alpha/project' }, userId: alphaUser });
    const projectId = project.body.project.id as string;
    const token = project.body.token as string;
    const result = { metadata: { scanner: 'test', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'synthetic' }, scannedPath: '.', filesScanned: 1, skippedFiles: 0, malformedSuppressions: 0, durationMs: 1, rulesExecuted: 1, aiComponents: [], findings: [{ ruleId: 'SEC-001', title: 'Synthetic secret', description: 'test', severity: 'HIGH', category: 'SECRET', filePath: 'app.ts', line: 1, evidence: 'sk_test_****safe', remediation: 'rotate', frameworks: [], confidence: 'HIGH', fingerprint: `pg_${randomBytes(4).toString('hex')}` }], suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 0 }, status: 'FAILED' as const };
    const scan = await call('POST', '/api/scans', { body: { projectId, result }, token });
    const findingId = scan.body.scan.findingIds[0] as string;
    await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'RESOLVED' }, userId: alphaUser });

    const stored = await client.query<{ state: any }>('SELECT state FROM runtime_state WHERE id = $1', ['singleton']);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].state.organizations.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([alphaId, betaId]));
    expect(stored.rows[0].state.projects.find((item: { id: string }) => item.id === projectId).tokenHash).not.toBe(token);
    expect(stored.rows[0].state.findings.find((item: { id: string }) => item.id === findingId).status).toBe('RESOLVED');

    await new Promise<void>(resolve => server.close(() => resolve()));
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not rebind');
    base = `http://127.0.0.1:${address.port}`;
    const afterRestart = await call('GET', '/api/projects', { userId: alphaUser });
    expect(afterRestart.status).toBe(200);
    expect(afterRestart.body.some((item: { id: string }) => item.id === projectId)).toBe(true);
    expect((await call('GET', '/api/projects', { userId: betaUser })).body.some((item: { id: string }) => item.id === projectId)).toBe(false);
  });
});
