import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { ScanResult } from '../packages/compliance-core/src/index.js';

// A finding that a later scan of the same project no longer observes is closed
// automatically. These tests pin the guard rails: scope, explicit statuses,
// suppressed/baseline retention, and scans that did not actually cover the code.
describe('automatic finding resolution on rescan', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  const owner = `lifecycle_owner_${randomBytes(4).toString('hex')}`;
  const intruder = `lifecycle_beta_${randomBytes(4).toString('hex')}`;
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

  function finding(fingerprint: string) {
    return { ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'synthetic fixture', severity: 'HIGH', category: 'SECRET', filePath: `src/${fingerprint}.ts`, line: 3, evidence: 'const apiKey=[REDACTED];', remediation: 'rotate', frameworks: [], confidence: 'HIGH', fingerprint };
  }

  function scanResult(fingerprints: string[], overrides: Partial<{ filesScanned: number; rulesExecuted: number; suppressed: string[]; baseline: string[] }> = {}): ScanResult {
    return {
      metadata: { scanner: 'compliance-as-code', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'synthetic fixture' },
      scannedPath: 'examples/vulnerable-app',
      filesScanned: overrides.filesScanned ?? 3,
      skippedFiles: 0,
      malformedSuppressions: 0,
      durationMs: 5,
      rulesExecuted: overrides.rulesExecuted ?? 4,
      aiComponents: [],
      findings: fingerprints.map(finding),
      suppressedFindings: (overrides.suppressed ?? []).map(fingerprint => ({ ...finding(fingerprint), suppression: { ruleId: 'SEC-001', reason: 'synthetic', filePath: `src/${fingerprint}.ts`, line: 3 } })),
      baselineFindings: (overrides.baseline ?? []).map(finding),
      severityCounts: { LOW: 0, MEDIUM: 0, HIGH: fingerprints.length, CRITICAL: 0 },
      status: fingerprints.length ? 'FAILED' : 'PASS'
    } as unknown as ScanResult;
  }

  async function upload(token: string, project: string, result: ScanResult) {
    return call('POST', '/api/scans', { body: { projectId: project, result }, token });
  }

  async function statuses(): Promise<Record<string, string>> {
    const list = (await call('GET', '/api/findings', { userId: owner })).body as { fingerprint: string; status: string; projectId: string }[];
    return Object.fromEntries(list.filter(item => item.projectId === projectId).map(item => [item.fingerprint, item.status]));
  }

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-lifecycle-${randomBytes(6).toString('hex')}.json`);
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    const organizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner })).body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Vulnerable Demo', repositoryName: 'alpha/vulnerable-demo' }, userId: owner });
    projectId = project.body.project.id as string;
    projectToken = project.body.token as string;
    const betaOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: intruder })).body.id as string;
    const betaProject = await call('POST', '/api/projects', { body: { organizationId: betaOrg, name: 'Beta App', repositoryName: 'beta/app' }, userId: intruder });
    betaProjectId = betaProject.body.project.id as string;
    betaToken = betaProject.body.token as string;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
  });

  it('resolves only the findings a later scan no longer reports, and counts them', async () => {
    const first = await upload(projectToken, projectId, scanResult(['fp_a', 'fp_b', 'fp_c']));
    expect(first.status).toBe(201);
    expect(first.body.scan.newFindings).toBe(3);
    expect(first.body.scan.resolvedFindings).toBe(0);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'OPEN', fp_c: 'OPEN' });

    const second = await upload(projectToken, projectId, scanResult(['fp_a', 'fp_c']));
    expect(second.status).toBe(201);
    expect(second.body.scan.newFindings).toBe(0);
    expect(second.body.scan.resolvedFindings).toBe(1);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'RESOLVED', fp_c: 'OPEN' });
    expect(second.body.riskScore).toBeGreaterThan(first.body.riskScore);
  });

  it('keeps the resolution after an API restart', async () => {
    await new Promise(resolve => server.close(resolve));
    await start();
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'RESOLVED', fp_c: 'OPEN' });
    const history = (await call('GET', '/api/scans', { userId: owner })).body as { projectId: string; resolvedFindings: number }[];
    expect(history.filter(item => item.projectId === projectId).map(item => item.resolvedFindings)).toEqual([0, 1]);
  });

  it('reopens a resolved finding when a later scan reports it again', async () => {
    const third = await upload(projectToken, projectId, scanResult(['fp_a', 'fp_b', 'fp_c']));
    expect(third.status).toBe(201);
    expect(third.body.scan.newFindings).toBe(0);
    expect(third.body.scan.resolvedFindings).toBe(0);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'OPEN', fp_c: 'OPEN' });
  });

  it('does not resolve findings from a scan that covered no files or ran no rules', async () => {
    const noFiles = await upload(projectToken, projectId, scanResult([], { filesScanned: 0 }));
    expect(noFiles.status).toBe(201);
    expect(noFiles.body.scan.resolvedFindings).toBe(0);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'OPEN', fp_c: 'OPEN' });

    const noRules = await upload(projectToken, projectId, scanResult([], { rulesExecuted: 0 }));
    expect(noRules.body.scan.resolvedFindings).toBe(0);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'OPEN', fp_c: 'OPEN' });
  });

  it('does not resolve findings the scan still observed but filtered out', async () => {
    const filtered = await upload(projectToken, projectId, scanResult(['fp_a'], { suppressed: ['fp_b'], baseline: ['fp_c'] }));
    expect(filtered.body.scan.resolvedFindings).toBe(0);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'OPEN', fp_c: 'OPEN' });
  });

  it('never overwrites an explicit suppression or accepted risk', async () => {
    const list = (await call('GET', '/api/findings', { userId: owner })).body as { id: string; fingerprint: string; projectId: string }[];
    const own = list.filter(item => item.projectId === projectId);
    const suppressed = own.find(item => item.fingerprint === 'fp_b')!.id;
    const accepted = own.find(item => item.fingerprint === 'fp_c')!.id;
    expect((await call('PATCH', `/api/findings/${suppressed}`, { body: { status: 'SUPPRESSED', reason: 'known fixture' }, userId: owner })).status).toBe(200);
    expect((await call('PATCH', `/api/findings/${accepted}`, { body: { status: 'ACCEPTED_RISK', reason: 'accepted for pilot' }, userId: owner })).status).toBe(200);

    const rescan = await upload(projectToken, projectId, scanResult(['fp_a']));
    expect(rescan.body.scan.resolvedFindings).toBe(0);
    expect(await statuses()).toEqual({ fp_a: 'OPEN', fp_b: 'SUPPRESSED', fp_c: 'ACCEPTED_RISK' });
  });

  it('cannot resolve another tenant findings that share the same fingerprints', async () => {
    expect((await upload(betaToken, betaProjectId, scanResult(['fp_a', 'fp_b']))).status).toBe(201);
    const betaBefore = (await call('GET', '/api/findings', { userId: intruder })).body as { fingerprint: string; status: string; projectId: string }[];
    expect(betaBefore.every(item => item.projectId === betaProjectId && item.status === 'OPEN')).toBe(true);

    const alphaRescan = await upload(projectToken, projectId, scanResult([]));
    expect(alphaRescan.body.scan.resolvedFindings).toBe(1);

    const betaAfter = (await call('GET', '/api/findings', { userId: intruder })).body as { fingerprint: string; status: string; projectId: string }[];
    expect(betaAfter.map(item => item.status)).toEqual(betaBefore.map(item => item.status));
    expect(betaAfter.every(item => item.status === 'OPEN')).toBe(true);
    expect(await statuses()).toEqual({ fp_a: 'RESOLVED', fp_b: 'SUPPRESSED', fp_c: 'ACCEPTED_RISK' });
  });
});
