import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { ScanResult } from '../packages/compliance-core/src/index.js';

// Contract for the CLI --upload -> POST /api/scans -> GET /api/scans -> Scans
// page flow: ingestion, persistence, tenant/token authorization, and the fields
// the scan history row renders.
describe('scan ingestion and scan history workflow', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  const alphaUser = 'scan_alpha_owner';
  const betaUser = 'scan_beta_owner';
  let alphaProjectId: string;
  let alphaToken: string;
  let betaProjectId: string;

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

  function scanResult(fingerprints: string[]): ScanResult {
    return {
      metadata: { scanner: 'compliance-as-code', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'synthetic fixture' },
      scannedPath: 'examples/vulnerable-app',
      filesScanned: 2,
      skippedFiles: 0,
      malformedSuppressions: 0,
      durationMs: 12,
      rulesExecuted: 4,
      aiComponents: [],
      findings: fingerprints.map((fingerprint, index) => ({ ruleId: 'SEC-001', title: 'Hardcoded credential', description: 'synthetic', severity: 'HIGH', category: 'SECRET', filePath: 'app.ts', line: index + 1, evidence: 'sk_test_****redacted', remediation: 'rotate', frameworks: [], confidence: 'HIGH', fingerprint })),
      suppressedFindings: [],
      baselineFindings: [],
      severityCounts: { LOW: 0, MEDIUM: 0, HIGH: fingerprints.length, CRITICAL: 0 },
      status: 'FAILED'
    } as unknown as ScanResult;
  }

  const uploadMetadata = { repository: 'alpha/vulnerable-demo', branch: 'main', commitSha: 'abc123def4567890' };

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-scan-workflow-${randomBytes(6).toString('hex')}.json`);
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    const alphaOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: alphaUser })).body.id as string;
    const betaOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: betaUser })).body.id as string;
    const alphaProject = await call('POST', '/api/projects', { body: { organizationId: alphaOrg, name: 'Vulnerable Demo', repositoryName: 'alpha/vulnerable-demo' }, userId: alphaUser });
    alphaProjectId = alphaProject.body.project.id as string;
    alphaToken = alphaProject.body.token as string;
    betaProjectId = (await call('POST', '/api/projects', { body: { organizationId: betaOrg, name: 'Beta App', repositoryName: 'beta/app' }, userId: betaUser })).body.project.id as string;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
  });

  it('ingests an authenticated scanner upload and links it to the organization, project, and findings', async () => {
    expect((await call('GET', '/api/scans', { userId: alphaUser })).body).toEqual([]);

    const upload = await call('POST', '/api/scans', { body: { projectId: alphaProjectId, result: scanResult(['fp_a', 'fp_b', 'fp_c']), metadata: uploadMetadata }, token: alphaToken });
    expect(upload.status).toBe(201);
    expect(upload.body.scan.projectId).toBe(alphaProjectId);
    expect(upload.body.scan.findingIds).toHaveLength(3);
    expect(upload.body.scan.newFindings).toBe(3);

    const stored = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { scans: Record<string, unknown>[]; findings: { scanId: string; projectId: string; organizationId: string }[]; projects: { id: string; organizationId: string }[] };
    const persisted = stored.scans.find(item => item.id === upload.body.scan.id) as { organizationId: string; projectId: string; repository: string; branch: string };
    const project = stored.projects.find(item => item.id === alphaProjectId)!;
    expect(persisted.projectId).toBe(alphaProjectId);
    expect(persisted.organizationId).toBe(project.organizationId);
    expect(persisted.repository).toBe(uploadMetadata.repository);
    expect(persisted.branch).toBe(uploadMetadata.branch);
    expect(stored.findings.filter(item => item.scanId === upload.body.scan.id)).toHaveLength(3);
    expect(stored.findings.every(item => item.projectId === alphaProjectId && item.organizationId === project.organizationId)).toBe(true);
  });

  it('returns the scan history fields the dashboard renders and keeps them after an API restart', async () => {
    await new Promise(resolve => server.close(resolve));
    await start();

    const history = await call('GET', '/api/scans', { userId: alphaUser });
    expect(history.status).toBe(200);
    expect(history.body).toHaveLength(1);
    const scan = history.body[0];
    expect(scan).toMatchObject({ projectId: alphaProjectId, status: 'FAILED', repository: uploadMetadata.repository, branch: uploadMetadata.branch, commitSha: uploadMetadata.commitSha, filesScanned: 2, scannerVersion: '0.2.0', newFindings: 3, resolvedFindings: 0, aiComponents: 0 });
    expect(Number.isNaN(Date.parse(scan.timestamp as string))).toBe(false);
    expect((await call('GET', '/api/projects', { userId: alphaUser })).body.some((item: { id: string }) => item.id === scan.projectId)).toBe(true);
  });

  it('records a re-upload as a new scan without duplicating already known findings', async () => {
    const retry = await call('POST', '/api/scans', { body: { projectId: alphaProjectId, result: scanResult(['fp_a', 'fp_b', 'fp_c']), metadata: uploadMetadata }, token: alphaToken });
    expect(retry.status).toBe(201);
    expect(retry.body.scan.newFindings).toBe(0);
    expect(retry.body.scan.findingIds).toHaveLength(3);
    expect((await call('GET', '/api/findings', { userId: alphaUser })).body).toHaveLength(3);
    expect((await call('GET', '/api/scans', { userId: alphaUser })).body).toHaveLength(2);
  });

  it('rejects uploads with a foreign, missing, invalid, or revoked token and persists nothing', async () => {
    const before = (await call('GET', '/api/scans', { userId: alphaUser })).body.length as number;

    expect((await call('POST', '/api/scans', { body: { projectId: betaProjectId, result: scanResult(['fp_x']) }, token: alphaToken })).status).toBe(401);
    expect((await call('POST', '/api/scans', { body: { projectId: alphaProjectId, result: scanResult(['fp_x']) } })).status).toBe(401);
    expect((await call('POST', '/api/scans', { body: { projectId: alphaProjectId, result: scanResult(['fp_x']) }, token: 'not-a-real-token' })).status).toBe(401);
    expect((await call('POST', '/api/scans', { body: { projectId: alphaProjectId }, token: alphaToken })).status).toBe(400);

    expect((await call('POST', `/api/projects/${alphaProjectId}/revoke-token`, { userId: alphaUser })).status).toBe(200);
    const revoked = await call('POST', '/api/scans', { body: { projectId: alphaProjectId, result: scanResult(['fp_x']) }, token: alphaToken });
    expect(revoked.status).toBe(401);
    expect(typeof revoked.body.error).toBe('string');
    expect(revoked.body.error).not.toContain(alphaToken);

    expect((await call('GET', '/api/scans', { userId: alphaUser })).body).toHaveLength(before);
    expect((await call('GET', '/api/scans', { userId: betaUser })).body).toEqual([]);
    const stored = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { findings: { fingerprint: string }[] };
    expect(stored.findings.some(item => item.fingerprint === 'fp_x')).toBe(false);
  });
});
