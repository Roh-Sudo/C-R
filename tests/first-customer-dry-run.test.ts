import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { createBaseline, scanDirectory } from '../packages/compliance-core/src/index.js';

describe('first customer dry run (Acme Technologies)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;
  let fixtureDir: string;

  beforeAll(async () => {
    dataFile = path.join(os.tmpdir(), `platform-acme-dry-run-${Date.now()}.json`);
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'acme-vulnerable-repository-'));
    await fs.copyFile('examples/vulnerable-app/app.ts', path.join(fixtureDir, 'app.ts'));
    await fs.copyFile('examples/vulnerable-app/application.properties', path.join(fixtureDir, 'application.properties'));
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
    let body: unknown;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    return { status: response.status, text, body };
  }

  it('completes onboarding, baseline, remediation, AI review, and reporting with synthetic data', async () => {
    const ownerId = `acme_owner_${Date.now()}`;
    const organization = await call('POST', '/api/organizations', { body: { name: 'Acme Technologies' }, userId: ownerId });
    expect(organization.status).toBe(201);
    const organizationId = (organization.body as { id: string }).id;

    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'Acme Payments', repositoryName: 'acme-technologies/payments' }, userId: ownerId });
    expect(project.status).toBe(201);
    const projectBody = project.body as { project: { id: string; enforcementMode: string }; token: string };
    expect(projectBody.project.enforcementMode).toBe('BLOCK');

    const pilot = await call('POST', '/api/pilots', { body: { organizationId, name: 'Acme Technologies Pilot', projectIds: [projectBody.project.id], goals: ['Reduce technical risk'] }, userId: ownerId });
    expect(pilot.status).toBe(201);
    const pilotId = (pilot.body as { id: string }).id;

    const vulnerable = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
    expect(vulnerable.findings.length).toBeGreaterThan(0);
    const firstScan = await call('POST', '/api/scans', { body: { projectId: projectBody.project.id, result: vulnerable }, token: projectBody.token });
    expect(firstScan.status).toBe(201);
    const firstScanBody = firstScan.body as { scan: { status: string; findingIds: string[] } };
    expect(firstScanBody.scan.status).toBe('FAILED');

    const findings = await call('GET', '/api/findings', { userId: ownerId });
    expect(findings.status).toBe(200);
    const findingList = findings.body as Array<{ id: string; severity: string; confidence: string; ruleId: string; evidence: string; remediation: string; frameworks: unknown[] }>;
    const representative = findingList.find(item => item.severity === 'CRITICAL' || item.severity === 'HIGH');
    expect(representative).toBeDefined();
    expect(representative?.ruleId).toMatch(/^[A-Z]+-\d{3}$/);
    expect(representative?.confidence).toBeTruthy();
    expect(representative?.remediation).toBeTruthy();
    expect(representative?.frameworks.length).toBeGreaterThan(0);
    expect(representative?.evidence).not.toContain('CorrectHorse');

    const baseline = createBaseline(vulnerable);
    const baselineScan = await scanDirectory(fixtureDir, { failOn: 'HIGH' }, baseline);
    expect(baselineScan.status).toBe('PASS');
    expect(baselineScan.findings).toHaveLength(0);
    expect(baselineScan.baselineFindings.length).toBe(vulnerable.findings.length);
    const baselineUpload = await call('POST', '/api/scans', { body: { projectId: projectBody.project.id, result: baselineScan }, token: projectBody.token });
    expect(baselineUpload.status).toBe(201);

    await fs.rm(path.join(fixtureDir, 'app.ts'));
    await fs.rm(path.join(fixtureDir, 'application.properties'));
    const fixed = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
    expect(fixed.status).toBe('PASS');
    const fixedUpload = await call('POST', '/api/scans', { body: { projectId: projectBody.project.id, result: fixed }, token: projectBody.token });
    expect(fixedUpload.status).toBe(201);
    const resolved = await call('PATCH', `/api/findings/${representative?.id}`, { body: { status: 'RESOLVED' }, userId: ownerId });
    expect(resolved.status).toBe(200);

    await fs.writeFile(path.join(fixtureDir, 'new-change.ts'), 'const apiKey = "sk_live_acmenewsyntheticviolation123";');
    const newFindingScan = await scanDirectory(fixtureDir, { failOn: 'HIGH' }, baseline);
    expect(newFindingScan.status).toBe('FAILED');
    expect(newFindingScan.findings.some(item => item.ruleId === 'SEC-001')).toBe(true);
    const newUpload = await call('POST', '/api/scans', { body: { projectId: projectBody.project.id, result: newFindingScan }, token: projectBody.token });
    expect(newUpload.status).toBe(201);

    const ai = await scanDirectory('examples/ai-vulnerable-app', { failOn: 'HIGH' });
    expect(ai.aiComponents.length).toBeGreaterThan(0);
    const aiUpload = await call('POST', '/api/scans', { body: { projectId: projectBody.project.id, result: ai }, token: projectBody.token });
    expect(aiUpload.status).toBe(201);
    const inventory = await call('GET', '/api/ai-components', { userId: ownerId });
    expect(inventory.status).toBe(200);
    expect((inventory.body as unknown[]).length).toBeGreaterThan(0);

    const metrics = await call('GET', `/api/pilots/${pilotId}/metrics`, { userId: ownerId });
    expect(metrics.status).toBe(200);
    const report = await call('GET', `/api/pilots/${pilotId}/report`, { userId: ownerId });
    expect(report.status).toBe(200);
    expect(report.text).not.toContain('certified');

    const clean = await scanDirectory('examples/clean-app', { failOn: 'HIGH' });
    expect(clean.status).toBe('PASS');
    expect(clean.findings).toHaveLength(0);
    const exportResult = await call('GET', `/api/organizations/${organizationId}/export`, { userId: ownerId });
    expect(exportResult.status).toBe(200);
    expect(exportResult.text).toContain('Acme Technologies');
  });
});
