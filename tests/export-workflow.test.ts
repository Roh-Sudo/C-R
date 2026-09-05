import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import type { ScanResult } from '../packages/compliance-core/src/index.js';

const CANARY_SECRET = 'sk_live_EXPORTCANARY9d2f1a7b3c5e';
const CANARY_PII = '987-65-4321';
const FORBIDDEN_CLAIMS = ['is compliant', 'fully compliant', 'certified', 'certification of', 'guaranteed compliance', 'SOC 2 compliant', 'legally compliant'];

// The Reports page downloads what these endpoints generate, so the export must
// reflect the recorded PostgreSQL-backed state exactly: real findings, their
// current lifecycle status, redacted evidence, and nothing from another tenant.
describe('report and export workflow', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  const owner = `export_owner_${randomBytes(4).toString('hex')}`;
  const viewer = `export_viewer_${randomBytes(4).toString('hex')}`;
  const intruder = `export_beta_${randomBytes(4).toString('hex')}`;
  let organizationId: string;
  let betaOrganizationId: string;
  let projectId: string;
  let projectToken: string;
  let scanId: string;
  let findingIds: string[] = [];

  async function start(): Promise<void> {
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind to a port');
    base = `http://127.0.0.1:${address.port}`;
  }

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string; accept?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.accept) headers.accept = options.accept;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const raw = await response.text();
    let parsed: any;
    try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = undefined; }
    return { status: response.status, body: parsed, raw, contentType: response.headers.get('content-type') ?? '', disposition: response.headers.get('content-disposition') ?? '' };
  }

  function scanResult(fingerprints: string[]): ScanResult {
    return {
      metadata: { scanner: 'compliance-as-code', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'synthetic fixture' },
      scannedPath: 'examples/vulnerable-app',
      filesScanned: 3,
      skippedFiles: 0,
      malformedSuppressions: 0,
      durationMs: 8,
      rulesExecuted: 4,
      aiComponents: [{ id: `ai_${randomBytes(4).toString('hex')}`, provider: 'OpenAI', technology: 'OpenAI SDK', modelIdentifier: 'gpt-4o-mini', filePath: 'src/bot.ts', lineNumber: 4, discoveryMethod: 'active-import-or-config', confidence: 'HIGH', status: 'REVIEW_REQUIRED', firstDetected: new Date().toISOString(), lastDetected: new Date().toISOString() }],
      // Evidence is redacted by the scanner before upload; the canaries must never reach the export.
      findings: fingerprints.map((fingerprint, index) => ({ ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'A provider-style secret is assigned in source.', severity: 'CRITICAL', category: 'SECRET', filePath: `src/app-${index}.ts`, line: index + 2, evidence: 'const apiKey=[REDACTED];', remediation: 'Revoke and rotate the value, then load it from a managed secret store.', frameworks: [{ framework: 'NIST-CSF-2.0', control: 'PR.AA', relationship: 'related', explanation: 'This finding relates to identity and access protection.' }], confidence: 'HIGH', fingerprint })),
      suppressedFindings: [],
      baselineFindings: [],
      severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: fingerprints.length },
      status: 'FAILED'
    } as unknown as ScanResult;
  }

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-export-${randomBytes(6).toString('hex')}.json`);
    process.env.PLATFORM_DATA_FILE = dataFile;
    process.env.PERSISTENCE = 'json';
    await start();
    organizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner })).body.id as string;
    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Export Demo', repositoryName: 'alpha/export-demo' }, userId: owner });
    projectId = project.body.project.id as string;
    projectToken = project.body.token as string;
    const upload = await call('POST', '/api/scans', { body: { projectId, result: scanResult(['exp_open', 'exp_resolved', 'exp_suppressed']), metadata: { repository: 'alpha/export-demo', branch: 'main' } }, token: projectToken });
    scanId = upload.body.scan.id as string;
    findingIds = upload.body.scan.findingIds as string[];

    betaOrganizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta Secret Name' }, userId: intruder })).body.id as string;
    const betaProject = await call('POST', '/api/projects', { body: { organizationId: betaOrganizationId, name: 'Beta Confidential Repo', repositoryName: 'beta/confidential' }, userId: intruder });
    await call('POST', '/api/scans', { body: { projectId: betaProject.body.project.id, result: scanResult(['beta_only_fingerprint']) }, token: betaProject.body.token as string });

    const store = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { users: unknown[]; memberships: unknown[] };
    store.users.push({ id: viewer, email: `${viewer}@example.test`, displayName: 'Read Only', createdAt: new Date().toISOString() });
    store.memberships.push({ organizationId, userId: viewer, role: 'VIEWER' });
    await fs.writeFile(dataFile, `${JSON.stringify(store)}\n`);
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataFile, { force: true });
  });

  it('generates a downloadable export built from the recorded project, scan, findings, and AI inventory', async () => {
    const exported = await call('GET', `/api/organizations/${organizationId}/export`, { userId: owner });
    expect(exported.status).toBe(200);
    expect(exported.contentType).toContain('application/json');
    expect(exported.disposition).toContain(`filename="${organizationId}-export.json"`);
    expect(exported.raw.length).toBeGreaterThan(0);

    expect(exported.body.organization).toMatchObject({ id: organizationId, name: 'Organization Alpha' });
    expect(exported.body.projects).toHaveLength(1);
    expect(exported.body.projects[0]).toMatchObject({ id: projectId, name: 'Export Demo', repositoryName: 'alpha/export-demo' });
    expect(exported.body.projects[0].tokenHash).toBeUndefined();
    expect(exported.body.scans.map((item: { id: string }) => item.id)).toEqual([scanId]);
    expect(exported.body.scans[0]).toMatchObject({ projectId, repository: 'alpha/export-demo', branch: 'main' });
    expect(exported.body.findings).toHaveLength(3);
    expect(exported.body.aiComponents).toHaveLength(1);
    expect(exported.body.aiComponents[0]).toMatchObject({ provider: 'OpenAI', discoveryMethod: 'active-import-or-config', status: 'REVIEW_REQUIRED' });
    expect(exported.body.auditEvents.some((item: { type: string }) => item.type === 'SCAN_COMPLETED')).toBe(true);
    expect(Number.isNaN(Date.parse(exported.body.exportedAt))).toBe(false);

    const finding = exported.body.findings[0];
    expect(finding).toMatchObject({ ruleId: 'SEC-001', severity: 'CRITICAL', confidence: 'HIGH', projectId, scanId, organizationId });
    expect(finding.remediation).toBe('Revoke and rotate the value, then load it from a managed secret store.');
    expect(finding.frameworks).toEqual([{ framework: 'NIST-CSF-2.0', control: 'PR.AA', relationship: 'related', explanation: 'This finding relates to identity and access protection.' }]);
    expect(finding.evidence).toBe('const apiKey=[REDACTED];');

    const stored = JSON.parse(await fs.readFile(dataFile, 'utf8')) as { findings: { id: string; organizationId: string }[]; scans: { id: string; organizationId: string }[] };
    expect(exported.body.findings.map((item: { id: string }) => item.id).sort()).toEqual(stored.findings.filter(item => item.organizationId === organizationId).map(item => item.id).sort());
    expect(exported.body.scans.map((item: { id: string }) => item.id)).toEqual(stored.scans.filter(item => item.organizationId === organizationId).map(item => item.id));
  });

  it('reports the current lifecycle state of every finding, not a stale snapshot', async () => {
    const before = await call('GET', `/api/organizations/${organizationId}/export`, { userId: owner });
    expect((before.body.findings as { status: string }[]).every(item => item.status === 'OPEN')).toBe(true);

    expect((await call('PATCH', `/api/findings/${findingIds[1]}`, { body: { status: 'RESOLVED' }, userId: owner })).status).toBe(200);
    expect((await call('PATCH', `/api/findings/${findingIds[2]}`, { body: { status: 'ACCEPTED_RISK', reason: 'Accepted for the pilot' }, userId: owner })).status).toBe(200);

    const after = await call('GET', `/api/organizations/${organizationId}/export`, { userId: owner });
    const byId = new Map((after.body.findings as { id: string; status: string; reason?: string }[]).map(item => [item.id, item]));
    expect(byId.get(findingIds[0])!.status).toBe('OPEN');
    expect(byId.get(findingIds[1])!.status).toBe('RESOLVED');
    expect(byId.get(findingIds[2])).toMatchObject({ status: 'ACCEPTED_RISK', reason: 'Accepted for the pilot' });
    expect((after.body.findings as { status: string }[]).filter(item => item.status === 'OPEN')).toHaveLength(1);
  });

  it('states the limits of the export instead of claiming compliance', async () => {
    const exported = await call('GET', `/api/organizations/${organizationId}/export`, { userId: owner });
    expect(exported.body.disclaimer).toContain('does not constitute legal advice, certification, attestation, or proof of regulatory compliance');
    const lowered = exported.raw.toLowerCase();
    for (const claim of FORBIDDEN_CLAIMS) expect(lowered).not.toContain(claim.toLowerCase());
  });

  it('exports the audit trail as CSV without leaking anything beyond the recorded events', async () => {
    const csv = await call('GET', `/api/organizations/${organizationId}/audit/export?format=csv`, { userId: owner });
    expect(csv.status).toBe(200);
    expect(csv.contentType).toContain('text/csv');
    expect(csv.disposition).toContain(`filename="${organizationId}-audit.csv"`);
    expect(csv.raw.split('\n')[0]).toBe('id,type,actorId,resource,timestamp');
    expect(csv.raw).toContain('SCAN_COMPLETED');
    expect(csv.raw).toContain('FINDING_STATUS_CHANGED');
    expect(csv.raw).not.toContain(betaOrganizationId);
    expect(csv.raw).not.toContain('Beta Confidential Repo');
  });

  it('never carries raw secrets or personal data into any export', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'export-canary-'));
    try {
      const { scanDirectory } = await import('../packages/compliance-core/src/index.js');
      await fs.writeFile(path.join(directory, 'app.ts'), `const apiKey = "${CANARY_SECRET}";\nconst customer = { ssn: "${CANARY_PII}" };\nconsole.log(customer.ssn);\n`);
      const result = await scanDirectory(directory);
      expect(result.findings.length).toBeGreaterThan(0);
      expect((await call('POST', '/api/scans', { body: { projectId, result }, token: projectToken })).status).toBe(201);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }

    const dataExport = await call('GET', `/api/organizations/${organizationId}/export`, { userId: owner });
    const auditCsv = await call('GET', `/api/organizations/${organizationId}/audit/export?format=csv`, { userId: owner });
    const auditJson = await call('GET', `/api/organizations/${organizationId}/audit/export`, { userId: owner });
    const persisted = await fs.readFile(dataFile, 'utf8');
    for (const payload of [dataExport.raw, auditCsv.raw, auditJson.raw, persisted]) {
      expect(payload).not.toContain(CANARY_SECRET);
      expect(payload).not.toContain(CANARY_PII);
    }
    expect((dataExport.body.findings as { evidence: string }[]).every(item => !item.evidence.includes('sk_live_'))).toBe(true);
  });

  it('keeps every export tenant-scoped and denies a foreign or unauthorized request', async () => {
    const alpha = await call('GET', `/api/organizations/${organizationId}/export`, { userId: owner });
    expect(alpha.raw).not.toContain(betaOrganizationId);
    expect(alpha.raw).not.toContain('Organization Beta Secret Name');
    expect(alpha.raw).not.toContain('Beta Confidential Repo');
    expect(alpha.raw).not.toContain('beta_only_fingerprint');

    expect((await call('GET', `/api/organizations/${betaOrganizationId}/export`, { userId: owner })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${betaOrganizationId}/audit/export?format=csv`, { userId: owner })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${organizationId}/export`, { userId: intruder })).status).toBe(403);
    expect((await call('GET', `/api/organizations/${organizationId}/export`)).status).toBe(403);

    const beta = await call('GET', `/api/organizations/${betaOrganizationId}/export`, { userId: intruder });
    expect(beta.status).toBe(200);
    expect(beta.body.projects.map((item: { name: string }) => item.name)).toEqual(['Beta Confidential Repo']);
  });

  it('denies a read-only member and produces no file for an unknown organization', async () => {
    const viewerDenied = await call('GET', `/api/organizations/${organizationId}/export`, { userId: viewer });
    expect(viewerDenied.status).toBe(403);
    expect(viewerDenied.body.error).toBe('owner or admin role required');
    expect(viewerDenied.body.organization).toBeUndefined();

    const unknown = await call('GET', '/api/organizations/org_does_not_exist/export', { userId: owner });
    expect(unknown.status).toBe(403);
    expect(unknown.contentType).toContain('application/json');
    expect(unknown.body.projects).toBeUndefined();
    expect(unknown.raw).not.toContain(organizationId);
  });

  it('generates an empty but valid export for an organization with no scans', async () => {
    const emptyOrg = (await call('POST', '/api/organizations', { body: { name: 'Organization Empty' }, userId: owner })).body.id as string;
    const exported = await call('GET', `/api/organizations/${emptyOrg}/export`, { userId: owner });
    expect(exported.status).toBe(200);
    expect(exported.body).toMatchObject({ projects: [], scans: [], findings: [], aiComponents: [] });
    expect(exported.body.disclaimer).toContain('does not constitute legal advice');
    expect(exported.body.organization.id).toBe(emptyOrg);
  });
});
