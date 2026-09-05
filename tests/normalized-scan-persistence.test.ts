import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type http from 'node:http';
// @ts-expect-error pg is a runtime dependency without bundled declarations.
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);

// Scan ingestion must not read-modify-write the whole runtime_state document:
// concurrent uploads would silently overwrite each other. These tests exercise
// the normalized scans/findings tables directly.
suite('normalized scan persistence under concurrency', () => {
  let server: http.Server;
  let base: string;
  let client: Client;
  const owner = `norm_owner_${randomBytes(4).toString('hex')}`;
  const intruder = `norm_intruder_${randomBytes(4).toString('hex')}`;
  let organizationId: string;
  let betaOrganizationId: string;
  const projects: { id: string; token: string }[] = [];
  let betaProject: { id: string; token: string };

  async function start(): Promise<void> {
    const mod = await import('../apps/api/src/index.js');
    server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind');
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

  function result(fingerprints: string[], overrides: { line?: number } = {}) {
    return {
      metadata: { scanner: 'compliance-as-code', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'synthetic fixture' },
      scannedPath: 'examples/vulnerable-app',
      filesScanned: 3,
      skippedFiles: 0,
      malformedSuppressions: 0,
      durationMs: 7,
      rulesExecuted: 4,
      aiComponents: [],
      findings: fingerprints.map((fingerprint, index) => ({ ruleId: 'SEC-001', title: 'Hardcoded credential', description: 'synthetic fixture finding', severity: 'HIGH', category: 'SECRET', filePath: `src/app-${index}.ts`, line: overrides.line ?? index + 1, evidence: 'sk_live_****redacted', remediation: 'rotate the credential', frameworks: [{ framework: 'NIST-CSF-2.0', control: 'PR.DS-01', relationship: 'related', explanation: 'informational' }], confidence: 'HIGH', fingerprint })),
      suppressedFindings: [],
      baselineFindings: [],
      severityCounts: { LOW: 0, MEDIUM: 0, HIGH: fingerprints.length, CRITICAL: 0 },
      status: 'FAILED'
    };
  }

  beforeAll(async () => {
    process.env.PERSISTENCE = 'postgres';
    process.env.NODE_ENV = 'test';
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query('TRUNCATE runtime_state, scan_findings, findings, scans, ai_components, audit_events, usage_records, commercial_events, projects, organizations CASCADE');
    await start();
    organizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Alpha' }, userId: owner })).body.id as string;
    betaOrganizationId = (await call('POST', '/api/organizations', { body: { name: 'Organization Beta' }, userId: intruder })).body.id as string;
    for (let index = 0; index < 4; index++) {
      const created = await call('POST', '/api/projects', { body: { organizationId, name: `Service ${index}`, repositoryName: `alpha/service-${index}` }, userId: owner });
      projects.push({ id: created.body.project.id as string, token: created.body.token as string });
    }
    const beta = await call('POST', '/api/projects', { body: { organizationId: betaOrganizationId, name: 'Beta Service', repositoryName: 'beta/service' }, userId: intruder });
    betaProject = { id: beta.body.project.id as string, token: beta.body.token as string };
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    const mod = await import('../apps/api/src/index.js');
    await (mod as unknown as { createServer: unknown });
    await client.end();
  });

  it('writes scans and findings to the normalized tables, not the runtime_state document', async () => {
    const upload = await call('POST', '/api/scans', { body: { projectId: projects[0].id, result: result(['norm_fp_1', 'norm_fp_2']), metadata: { repository: 'alpha/service-0', branch: 'main', commitSha: 'a'.repeat(40) } }, token: projects[0].token });
    expect(upload.status).toBe(201);

    const scanRow = await client.query('SELECT * FROM scans WHERE id = $1', [upload.body.scan.id]);
    expect(scanRow.rows).toHaveLength(1);
    expect(scanRow.rows[0].organization_id).toBe(organizationId);
    expect(scanRow.rows[0].project_id).toBe(projects[0].id);
    expect(scanRow.rows[0].repository).toBe('alpha/service-0');
    expect(scanRow.rows[0].new_findings).toBe(2);

    const findingRows = await client.query('SELECT * FROM findings WHERE project_id = $1 ORDER BY fingerprint', [projects[0].id]);
    expect(findingRows.rows).toHaveLength(2);
    expect(findingRows.rows[0]).toMatchObject({ organization_id: organizationId, project_id: projects[0].id, scan_id: upload.body.scan.id, rule_id: 'SEC-001', severity: 'HIGH', category: 'SECRET', confidence: 'HIGH', status: 'OPEN', title: 'Hardcoded credential', remediation: 'rotate the credential' });
    expect(findingRows.rows[0].frameworks[0].framework).toBe('NIST-CSF-2.0');
    expect(findingRows.rows[0].evidence).toBe('sk_live_****redacted');
    expect((await client.query('SELECT * FROM scan_findings WHERE scan_id = $1', [upload.body.scan.id])).rows).toHaveLength(2);

    const document = await client.query('SELECT state FROM runtime_state WHERE id = $1', ['singleton']);
    expect(document.rows[0].state.scans).toEqual([]);
    expect(document.rows[0].state.findings).toEqual([]);
  });

  it('keeps every concurrent upload and all of its findings', async () => {
    const before = (await client.query('SELECT count(*)::int AS total FROM scans')).rows[0].total as number;
    const uploads = Array.from({ length: 12 }, (_value, index) => {
      const project = projects[index % projects.length];
      return call('POST', '/api/scans', { body: { projectId: project.id, result: result([`conc_${index}_a`, `conc_${index}_b`, `conc_${index}_c`]), metadata: { repository: 'alpha/concurrent', branch: `worker-${index}` } }, token: project.token });
    });
    const responses = await Promise.all(uploads);
    expect(responses.every(item => item.status === 201)).toBe(true);
    const scanIds = responses.map(item => item.body.scan.id as string);
    expect(new Set(scanIds).size).toBe(12);

    const stored = await client.query('SELECT id FROM scans WHERE id = ANY($1)', [scanIds]);
    expect(stored.rows).toHaveLength(12);
    expect((await client.query('SELECT count(*)::int AS total FROM scans')).rows[0].total).toBe(before + 12);

    for (const scanId of scanIds) {
      const links = await client.query('SELECT finding_id FROM scan_findings WHERE scan_id = $1', [scanId]);
      expect(links.rows).toHaveLength(3);
    }
    const concurrentFindings = await client.query("SELECT count(*)::int AS total FROM findings WHERE fingerprint LIKE 'conc\\_%'");
    expect(concurrentFindings.rows[0].total).toBe(36);
    const ownership = await client.query('SELECT DISTINCT organization_id FROM scans WHERE id = ANY($1)', [scanIds]);
    expect(ownership.rows.map((row: { organization_id: string }) => row.organization_id)).toEqual([organizationId]);
  });

  it('deduplicates a fingerprint exactly once when the same scan is uploaded concurrently', async () => {
    const project = projects[1];
    const payload = { projectId: project.id, result: result(['race_fp_1', 'race_fp_2']), metadata: { repository: 'alpha/race' } };
    const responses = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/api/scans', { body: payload, token: project.token })));
    expect(responses.every(item => item.status === 201)).toBe(true);
    const rows = await client.query("SELECT fingerprint, count(*)::int AS total FROM findings WHERE project_id = $1 AND fingerprint LIKE 'race\\_%' GROUP BY fingerprint", [project.id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row: { total: number }) => row.total === 1)).toBe(true);
    expect(responses.reduce((total, item) => total + (item.body.scan.newFindings as number), 0)).toBe(2);
  });

  it('rolls back the whole scan when persisting a finding fails', async () => {
    const project = projects[2];
    const before = (await client.query('SELECT count(*)::int AS total FROM scans WHERE project_id = $1', [project.id])).rows[0].total as number;
    // 2^40 overflows the findings.line integer column, so the insert aborts mid-transaction.
    const rejected = await call('POST', '/api/scans', { body: { projectId: project.id, result: result(['rollback_fp_1', 'rollback_fp_2'], { line: 2 ** 40 }), metadata: { repository: 'alpha/rollback' } }, token: project.token });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toContain('rolled back');
    expect(rejected.body.error).not.toContain('sk_live');

    expect((await client.query('SELECT count(*)::int AS total FROM scans WHERE project_id = $1', [project.id])).rows[0].total).toBe(before);
    expect((await client.query("SELECT * FROM findings WHERE fingerprint LIKE 'rollback\\_%'")).rows).toHaveLength(0);
    expect((await client.query("SELECT * FROM scans WHERE repository = 'alpha/rollback'")).rows).toHaveLength(0);
    expect((await call('GET', '/api/scans', { userId: owner })).body.some((item: { repository?: string }) => item.repository === 'alpha/rollback')).toBe(false);
  });

  it('serves scan history and findings from the normalized tables across an API restart', async () => {
    const beforeScans = (await call('GET', '/api/scans', { userId: owner })).body as { id: string }[];
    const beforeFindings = (await call('GET', '/api/findings', { userId: owner })).body as { id: string }[];
    expect(beforeScans.length).toBeGreaterThan(0);
    expect(beforeFindings.length).toBeGreaterThan(0);

    await new Promise(resolve => server.close(resolve));
    await start();

    const afterScans = (await call('GET', '/api/scans', { userId: owner })).body as { id: string; findingIds: string[] }[];
    const afterFindings = (await call('GET', '/api/findings', { userId: owner })).body as { id: string }[];
    expect(afterScans.map(item => item.id).sort()).toEqual(beforeScans.map(item => item.id).sort());
    expect(afterFindings.map(item => item.id).sort()).toEqual(beforeFindings.map(item => item.id).sort());
    expect(afterScans.every(item => item.findingIds.length > 0)).toBe(true);

    const detail = await call('GET', `/api/findings/${afterFindings[0].id}`, { userId: owner });
    expect(detail.status).toBe(200);
    expect(detail.body.frameworks[0].framework).toBe('NIST-CSF-2.0');

    const resolved = await call('PATCH', `/api/findings/${afterFindings[0].id}`, { body: { status: 'RESOLVED' }, userId: owner });
    expect(resolved.status).toBe(200);
    expect((await client.query('SELECT status FROM findings WHERE id = $1', [afterFindings[0].id])).rows[0].status).toBe('RESOLVED');
  });

  it('keeps normalized scans and findings tenant-scoped', async () => {
    const betaUpload = await call('POST', '/api/scans', { body: { projectId: betaProject.id, result: result(['beta_fp_1']), metadata: { repository: 'beta/service' } }, token: betaProject.token });
    expect(betaUpload.status).toBe(201);

    expect((await call('POST', '/api/scans', { body: { projectId: betaProject.id, result: result(['beta_fp_2']) }, token: projects[0].token })).status).toBe(401);

    const alphaScans = (await call('GET', '/api/scans', { userId: owner })).body as { id: string; organizationId: string }[];
    expect(alphaScans.some(item => item.id === betaUpload.body.scan.id)).toBe(false);
    expect(alphaScans.every(item => item.organizationId === organizationId)).toBe(true);
    const alphaFindings = (await call('GET', '/api/findings', { userId: owner })).body as { organizationId: string; fingerprint: string }[];
    expect(alphaFindings.some(item => item.fingerprint === 'beta_fp_1')).toBe(false);
    expect(alphaFindings.every(item => item.organizationId === organizationId)).toBe(true);

    const betaFindingId = (await call('GET', '/api/findings', { userId: intruder })).body[0].id as string;
    expect((await call('GET', `/api/findings/${betaFindingId}`, { userId: owner })).status).toBe(404);
    expect((await call('PATCH', `/api/findings/${betaFindingId}`, { body: { status: 'RESOLVED' }, userId: owner })).status).toBe(404);
    expect((await client.query('SELECT status FROM findings WHERE id = $1', [betaFindingId])).rows[0].status).toBe('OPEN');
  });

  it('stores only redacted evidence and no source content', async () => {
    const rows = await client.query('SELECT evidence FROM findings');
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.evidence).toContain('****');
      expect(row.evidence.length).toBeLessThanOrEqual(20_000);
    }
    const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'findings'")).rows.map((row: { column_name: string }) => row.column_name);
    expect(columns).not.toContain('source');
    expect(columns).not.toContain('file_content');
  });

  it('writes discovered AI components to the normalized table, scoped to the project', async () => {
    const project = projects[0];
    const component = { id: `ai_${randomBytes(4).toString('hex')}`, provider: 'OpenAI', technology: 'OpenAI SDK', modelIdentifier: 'gpt-4o-mini', filePath: 'src/support-bot.ts', lineNumber: 5, discoveryMethod: 'active-import-or-config', confidence: 'HIGH', status: 'REVIEW_REQUIRED', firstDetected: new Date().toISOString(), lastDetected: new Date().toISOString() };
    const upload = await call('POST', '/api/scans', { body: { projectId: project.id, result: { ...result(['ai_fp_1']), aiComponents: [component] } }, token: project.token });
    expect(upload.status).toBe(201);
    expect(upload.body.scan.aiComponents).toBe(1);

    const row = (await client.query('SELECT * FROM ai_components WHERE id = $1 AND project_id = $2', [component.id, project.id])).rows[0];
    expect(row).toMatchObject({ organization_id: organizationId, project_id: project.id, provider: 'OpenAI', technology: 'OpenAI SDK', model_identifier: 'gpt-4o-mini', file_path: 'src/support-bot.ts', line_number: 5, discovery_method: 'active-import-or-config', status: 'REVIEW_REQUIRED', confidence: 'HIGH' });
    expect((await client.query('SELECT state FROM runtime_state WHERE id = $1', ['singleton'])).rows[0].state.aiComponents).toEqual([]);

    const inventory = (await call('GET', '/api/ai-components', { userId: owner })).body as { id: string; projectId: string }[];
    expect(inventory.some(item => item.id === component.id && item.projectId === project.id)).toBe(true);
    expect(((await call('GET', '/api/ai-components', { userId: intruder })).body as unknown[])).toEqual([]);
  });

  it('auto-resolves fixed findings inside the ingestion transaction without touching other tenants', async () => {
    const project = projects[3];
    const stale = (await client.query("SELECT count(*)::int AS total FROM findings WHERE project_id = $1 AND status = 'OPEN'", [project.id])).rows[0].total as number;
    const first = await call('POST', '/api/scans', { body: { projectId: project.id, result: result(['auto_a', 'auto_b', 'auto_c']) }, token: project.token });
    expect(first.body.scan.resolvedFindings).toBe(stale);

    const betaBefore = (await client.query("SELECT status FROM findings WHERE project_id = $1 AND fingerprint = 'auto_b'", [betaProject.id])).rows;
    expect((await call('POST', '/api/scans', { body: { projectId: betaProject.id, result: result(['auto_b']) }, token: betaProject.token })).status).toBe(201);
    expect(betaBefore).toHaveLength(0);

    const second = await call('POST', '/api/scans', { body: { projectId: project.id, result: result(['auto_a', 'auto_c']) }, token: project.token });
    expect(second.status).toBe(201);
    expect(second.body.scan.resolvedFindings).toBe(1);

    const rows = await client.query("SELECT fingerprint, status FROM findings WHERE project_id = $1 AND fingerprint LIKE 'auto\\_%' ORDER BY fingerprint", [project.id]);
    expect(rows.rows).toEqual([{ fingerprint: 'auto_a', status: 'OPEN' }, { fingerprint: 'auto_b', status: 'RESOLVED' }, { fingerprint: 'auto_c', status: 'OPEN' }]);
    expect((await client.query('SELECT resolved_findings FROM scans WHERE id = $1', [second.body.scan.id])).rows[0].resolved_findings).toBe(1);
    expect((await client.query("SELECT status FROM findings WHERE project_id = $1 AND fingerprint = 'auto_b'", [betaProject.id])).rows[0].status).toBe('OPEN');

    // A scan that covered no files must never mass-resolve.
    const empty = await call('POST', '/api/scans', { body: { projectId: project.id, result: { ...result([]), filesScanned: 0 } }, token: project.token });
    expect(empty.body.scan.resolvedFindings).toBe(0);
    expect((await client.query("SELECT count(*)::int AS total FROM findings WHERE project_id = $1 AND status = 'OPEN'", [project.id])).rows[0].total).toBeGreaterThan(0);
  });
});
