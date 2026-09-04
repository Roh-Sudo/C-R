import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { scanDirectory } from '../packages/compliance-core/src/index.js';

// Production blocker check: a fake but realistic-looking secret must never
// survive, in complete form, past the local scanner's redaction boundary -
// not in the database file, audit events, dashboard-facing API responses,
// JSON/CSV exports, or server logs.
describe('canary secret leakage regression', () => {
  const canarySecret = `sk_live_${randomBytes(18).toString('hex')}`;
  let fixtureDir: string;
  let dataFile: string;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'canary-fixture-'));
    await fs.writeFile(path.join(fixtureDir, 'config.ts'), `const apiKey = "${canarySecret}";\nexport default apiKey;\n`);
    dataFile = path.join(os.tmpdir(), `platform-canary-${randomBytes(6).toString('hex')}.json`);
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
    await fs.rm(fixtureDir, { recursive: true, force: true });
  });

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, text, body: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined };
  }

  it('never exposes the complete canary secret anywhere past the local scanner', async () => {
    const result = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
    expect(JSON.stringify(result)).not.toContain(canarySecret);
    expect(result.findings.some(finding => finding.ruleId === 'SEC-001')).toBe(true);

    const userId = `user_${randomBytes(4).toString('hex')}`;
    const org = await call('POST', '/api/organizations', { body: { name: 'Canary Test Org' }, userId });
    const organizationId = org.body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Canary Repo', repositoryName: 'org/canary' }, userId });
    const projectId = project.body.project.id as string;
    const token = project.body.token as string;

    const scan = await call('POST', '/api/scans', { body: { projectId, result }, token });
    expect(scan.status).toBe(201);
    expect(scan.text).not.toContain(canarySecret);

    const findings = await call('GET', '/api/findings', { userId });
    expect(findings.text).not.toContain(canarySecret);

    const dataExport = await call('GET', `/api/organizations/${organizationId}/export`, { userId });
    expect(dataExport.text).not.toContain(canarySecret);

    const auditExportJson = await call('GET', `/api/organizations/${organizationId}/audit/export?format=json`, { userId });
    expect(auditExportJson.text).not.toContain(canarySecret);

    const auditExportCsv = await fetch(`${base}/api/organizations/${organizationId}/audit/export?format=csv`, { headers: { 'x-user-id': userId } });
    expect(await auditExportCsv.text()).not.toContain(canarySecret);

    const rawStore = await fs.readFile(dataFile, 'utf8');
    expect(rawStore).not.toContain(canarySecret);
  });
});
