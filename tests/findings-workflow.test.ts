import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { ScanResult } from '../packages/compliance-core/src/index.js';

const CANARY_SECRET = 'sk_live_CANARY0d4f1a9c3b7e2d6f8a1b';
const CANARY_PII = 'canary.person@example.test';

// Contract for the Findings UI (apps/web/src/main.tsx): list, detail, lifecycle
// mutation, persistence across an API restart, tenant and role authorization,
// and the guarantee that raw canary values never reach any findings response.
describe('findings workflow (Findings UI contract)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  const owner = `findings_owner_${randomBytes(4).toString('hex')}`;
  const viewer = `findings_viewer_${randomBytes(4).toString('hex')}`;
  const intruder = `findings_intruder_${randomBytes(4).toString('hex')}`;
  let organizationId: string;
  let projectId: string;
  let scanId: string;
  let betaFindingId: string;
  let findingIds: string[] = [];

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
    return { status: response.status, body: text ? JSON.parse(text) : undefined, raw: text };
  }

  // Evidence is redacted by the scanner before upload; the canary values below
  // must therefore never appear in any stored or returned finding.
  function scanResult(fingerprints: string[]): ScanResult {
    return {
      metadata: { scanner: 'compliance-as-code', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'synthetic fixture' },
      scannedPath: 'examples/vulnerable-app',
      filesScanned: 2,
      skippedFiles: 0,
      malformedSuppressions: 0,
      durationMs: 9,
      rulesExecuted: 4,
      aiComponents: [],
      findings: fingerprints.map((fingerprint, index) => ({ ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'A provider-style secret is assigned in source.', severity: 'CRITICAL', category: 'SECRET', filePath: `src/app-${index}.ts`, line: index + 4, evidence: 'const apiKey=[REDACTED];', remediation: 'Revoke and rotate the value, then load it from a managed secret store.', frameworks: [{ framework: 'NIST-CSF-2.0', control: 'PR.AA', relationship: 'related', explanation: 'This finding relates to identity and access protection.' }], confidence: 'HIGH', fingerprint })),
      suppressedFindings: [],
      baselineFindings: [],
      severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: fingerprints.length },
      status: 'FAILED'
    } as unknown as ScanResult;
  }

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-findings-${randomBytes(6).toString('hex')}.json`);
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    organizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner })).body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Vulnerable Demo', repositoryName: 'alpha/vulnerable-demo' }, userId: owner });
    projectId = project.body.project.id as string;
    const upload = await call('POST', '/api/scans', { body: { projectId, result: scanResult(['find_fp_1', 'find_fp_2', 'find_fp_3']), metadata: { repository: 'alpha/vulnerable-demo', branch: 'main' } }, token: project.body.token as string });
    scanId = upload.body.scan.id as string;

    const betaOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: intruder })).body.id as string;
    const betaProject = await call('POST', '/api/projects', { body: { organizationId: betaOrg, name: 'Beta App', repositoryName: 'beta/app' }, userId: intruder });
    await call('POST', '/api/scans', { body: { projectId: betaProject.body.project.id, result: scanResult(['beta_fp_1']) }, token: betaProject.body.token as string });
    betaFindingId = (await call('GET', '/api/findings', { userId: intruder })).body[0].id as string;

    const store = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { users: unknown[]; memberships: unknown[] };
    store.users.push({ id: viewer, email: `${viewer}@example.test`, displayName: 'Read Only', createdAt: new Date().toISOString() });
    store.memberships.push({ organizationId, userId: viewer, role: 'VIEWER' });
    await fs.writeFile(dataFile, `${JSON.stringify(store)}\n`);
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
  });

  it('lists the findings created by the uploaded scan', async () => {
    const list = await call('GET', '/api/findings', { userId: owner });
    expect(list.status).toBe(200);
    const own = (list.body as { projectId: string; id: string }[]).filter(item => item.projectId === projectId);
    expect(own).toHaveLength(3);
    findingIds = own.map(item => item.id);
    expect(own.every(item => (item as unknown as { organizationId: string }).organizationId === organizationId)).toBe(true);
    expect((list.body as { scanId: string }[]).every(item => item.scanId !== undefined)).toBe(true);
  });

  it('returns every detail field the finding panel renders', async () => {
    const detail = await call('GET', `/api/findings/${findingIds[0]}`, { userId: owner });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      ruleId: 'SEC-001',
      title: 'Hardcoded secret',
      description: 'A provider-style secret is assigned in source.',
      severity: 'CRITICAL',
      confidence: 'HIGH',
      category: 'SECRET',
      status: 'OPEN',
      projectId,
      scanId,
      organizationId,
      remediation: 'Revoke and rotate the value, then load it from a managed secret store.'
    });
    expect(detail.body.filePath).toBe('src/app-0.ts');
    expect(detail.body.line).toBe(4);
    expect(detail.body.evidence).toBe('const apiKey=[REDACTED];');
    expect(detail.body.frameworks).toEqual([{ framework: 'NIST-CSF-2.0', control: 'PR.AA', relationship: 'related', explanation: 'This finding relates to identity and access protection.' }]);
  });

  it('applies the supported lifecycle transitions and keeps them after an API restart', async () => {
    const resolved = await call('PATCH', `/api/findings/${findingIds[0]}`, { body: { status: 'RESOLVED' }, userId: owner });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');

    expect((await call('PATCH', `/api/findings/${findingIds[1]}`, { body: { status: 'SUPPRESSED' }, userId: owner })).status).toBe(400);
    const suppressed = await call('PATCH', `/api/findings/${findingIds[1]}`, { body: { status: 'SUPPRESSED', reason: 'Synthetic fixture' }, userId: owner });
    expect(suppressed.status).toBe(200);
    expect(suppressed.body).toMatchObject({ status: 'SUPPRESSED', reason: 'Synthetic fixture' });

    const accepted = await call('PATCH', `/api/findings/${findingIds[2]}`, { body: { status: 'ACCEPTED_RISK', reason: 'Accepted for the pilot' }, userId: owner });
    expect(accepted.body.status).toBe('ACCEPTED_RISK');
    expect((await call('PATCH', `/api/findings/${findingIds[0]}`, { body: { status: 'INVENTED' }, userId: owner })).status).toBe(400);

    await new Promise(resolve => server.close(resolve));
    await start();

    const afterRestart = (await call('GET', '/api/findings', { userId: owner })).body as { id: string; status: string; reason?: string }[];
    expect(afterRestart.find(item => item.id === findingIds[0])!.status).toBe('RESOLVED');
    expect(afterRestart.find(item => item.id === findingIds[1])).toMatchObject({ status: 'SUPPRESSED', reason: 'Synthetic fixture' });
    expect(afterRestart.find(item => item.id === findingIds[2])!.status).toBe('ACCEPTED_RISK');
    expect((await call('GET', `/api/findings/${findingIds[0]}`, { userId: owner })).body.status).toBe('RESOLVED');
  });

  it('reopens a resolved finding when a later scan detects it again', async () => {
    const project = await call('GET', `/api/projects/${projectId}`, { userId: owner });
    expect(project.status).toBe(200);
    const rotated = await call('POST', `/api/projects/${projectId}/rotate-token`, { userId: owner });
    const upload = await call('POST', '/api/scans', { body: { projectId, result: scanResult(['find_fp_1']) }, token: rotated.body.token as string });
    expect(upload.status).toBe(201);
    expect(upload.body.scan.newFindings).toBe(0);
    expect((await call('GET', `/api/findings/${findingIds[0]}`, { userId: owner })).body.status).toBe('OPEN');
    expect((await call('GET', `/api/findings/${findingIds[1]}`, { userId: owner })).body.status).toBe('SUPPRESSED');
  });

  it('denies cross-tenant read and mutation of a finding', async () => {
    expect((await call('GET', `/api/findings/${betaFindingId}`, { userId: owner })).status).toBe(404);
    expect((await call('PATCH', `/api/findings/${betaFindingId}`, { body: { status: 'RESOLVED' }, userId: owner })).status).toBe(404);
    expect((await call('GET', '/api/findings', { userId: owner })).body.some((item: { id: string }) => item.id === betaFindingId)).toBe(false);
    expect((await call('GET', `/api/findings/${betaFindingId}`, { userId: intruder })).body.status).toBe('OPEN');
    expect((await call('GET', `/api/findings/${findingIds[0]}`)).status).toBe(404);
  });

  it('denies a read-only member any lifecycle mutation', async () => {
    expect((await call('GET', '/api/findings', { userId: viewer })).status).toBe(200);
    expect((await call('GET', `/api/findings/${findingIds[0]}`, { userId: viewer })).status).toBe(200);
    for (const status of ['RESOLVED', 'OPEN', 'SUPPRESSED', 'ACCEPTED_RISK']) {
      const denied = await call('PATCH', `/api/findings/${findingIds[0]}`, { body: { status, reason: 'attempt' }, userId: viewer });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe('insufficient role');
    }
    expect((await call('GET', `/api/findings/${findingIds[0]}`, { userId: owner })).body.status).toBe('OPEN');
  });

  it('never returns raw canary secret or PII values through any findings response', async () => {
    const list = await call('GET', '/api/findings', { userId: owner });
    const detail = await call('GET', `/api/findings/${findingIds[0]}`, { userId: owner });
    const mutation = await call('PATCH', `/api/findings/${findingIds[0]}`, { body: { status: 'RESOLVED' }, userId: owner });
    const stored = await fs.readFile(dataFile, 'utf8');
    for (const payload of [list.raw, detail.raw, mutation.raw, stored]) {
      expect(payload).not.toContain(CANARY_SECRET);
      expect(payload).not.toContain(CANARY_PII);
      expect(payload).not.toContain('sk_live_');
    }
    expect((list.body as { evidence: string }[]).every(item => item.evidence.includes('[REDACTED]'))).toBe(true);
  });
});
