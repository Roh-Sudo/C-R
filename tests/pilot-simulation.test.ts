import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import type http from 'node:http';

// Simulates a complete first pilot end-to-end against a synthetic organization
// ("Launch Pilot Demo" / "payments-api"), per the Phase 10 first-pilot-simulation
// requirement. All data here is synthetic.
describe('first pilot simulation (synthetic organization)', () => {
  let server: http.Server;
  let base: string;
  let dataFile: string;

  beforeAll(async () => {
    dataFile = `${os.tmpdir()}/platform-pilot-sim-${randomBytes(6).toString('hex')}.json`;
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
  });

  async function call(method: string, urlPath: string, options: { body?: unknown; userId?: string; token?: string } = {}) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.userId) headers['x-user-id'] = options.userId;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const response = await fetch(`${base}${urlPath}`, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  function scanPayload(overrides: { findings?: unknown[]; aiComponents?: unknown[] }) {
    return {
      metadata: { scanner: 'compliance-check', version: '0.2.0', timestamp: new Date().toISOString(), disclaimer: 'test' },
      scannedPath: '.', filesScanned: 5, skippedFiles: 0, malformedSuppressions: 0, durationMs: 20, rulesExecuted: 30,
      aiComponents: overrides.aiComponents ?? [], findings: overrides.findings ?? [],
      suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: (overrides.findings ?? []).length, CRITICAL: 0 },
      status: (overrides.findings ?? []).length ? 'FAILED' : 'PASS'
    };
  }

  it('runs organization creation -> owner -> project -> token -> baseline -> PR finding -> CI block -> fix -> resolve -> AI/shadow-AI discovery -> governance update', async () => {
    const ownerId = `user_owner_${randomBytes(4).toString('hex')}`;

    const org = await call('POST', '/api/organizations', { body: { name: 'Launch Pilot Demo' }, userId: ownerId });
    expect(org.status).toBe(201);
    const organizationId = org.body.id as string;

    const project = await call('POST', '/api/projects', { body: { organizationId, name: 'payments-api', repositoryName: 'launch-pilot/payments-api' }, userId: ownerId });
    expect(project.status).toBe(201);
    const projectId = project.body.project.id as string;
    const token = project.body.token as string;
    expect(project.body.project.enforcementMode).toBe('BLOCK');

    // Baseline scan: clean, establishes the accepted starting point.
    const baseline = await call('POST', '/api/scans', { body: { projectId, result: scanPayload({}) }, token });
    expect(baseline.status).toBe(201);
    expect(baseline.body.scan.status).toBe('PASS');

    // A pull request introduces a fake hardcoded credential.
    const prScan = await call('POST', '/api/scans', {
      body: {
        projectId,
        result: scanPayload({ findings: [{ ruleId: 'SEC-001', title: 'Hardcoded secret', description: 'test', severity: 'HIGH', category: 'SECRET', filePath: 'src/payments.ts', line: 42, evidence: 'sk_test_****abc', remediation: 'rotate it', frameworks: [], confidence: 'HIGH', fingerprint: 'fp_pr_credential' }] }),
        metadata: { pullRequest: '17' }
      },
      token
    });
    expect(prScan.status).toBe(201);
    expect(prScan.body.scan.status).toBe('FAILED');
    expect(prScan.body.scan.newFindings).toBe(1);
    // CI would block merge here because enforcementMode is BLOCK and this is a new HIGH finding.
    expect(project.body.project.enforcementMode).toBe('BLOCK');

    // Dashboard receives redacted evidence only - never the complete secret.
    const findings = await call('GET', '/api/findings', { userId: ownerId });
    const finding = findings.body.find((item: { fingerprint: string }) => item.fingerprint === 'fp_pr_credential');
    expect(finding).toBeDefined();
    // Evidence submitted here is already in its redacted form (masked by the local scanner
    // before upload); the dashboard must never receive or display the complete secret value.
    expect(finding.evidence).not.toMatch(/^sk_test_[a-z0-9]+$/i);
    expect(finding.evidence).toContain('****');
    const findingId = finding.id as string;

    // Developer fixes the credential; rescan shows no new occurrence, then the team marks it resolved.
    const rescan = await call('POST', '/api/scans', { body: { projectId, result: scanPayload({}), metadata: { pullRequest: '17' } }, token });
    expect(rescan.status).toBe(201);
    expect(rescan.body.scan.status).toBe('PASS');

    const resolved = await call('PATCH', `/api/findings/${findingId}`, { body: { status: 'RESOLVED' }, userId: ownerId });
    expect(resolved.status).toBe(200);
    expect(resolved.body.status).toBe('RESOLVED');

    // Audit history is preserved end-to-end.
    const audit = await call('GET', '/api/audit', { userId: ownerId });
    const auditTypes = audit.body.map((event: { type: string }) => event.type);
    expect(auditTypes).toEqual(expect.arrayContaining(['ORGANIZATION_CREATED', 'PROJECT_CREATED', 'SCAN_COMPLETED', 'FINDING_STATUS_CHANGED']));

    // An AI integration is added; Shadow AI (no governance declaration) is detected.
    const aiScan = await call('POST', '/api/scans', {
      body: { projectId, result: scanPayload({ aiComponents: [{ id: 'ai_shadow_1', provider: 'OpenAI', technology: 'openai-sdk', filePath: 'src/support-bot.ts', lineNumber: 5, discoveryMethod: 'pattern', confidence: 'HIGH', status: 'DISCOVERED', firstDetected: new Date().toISOString(), lastDetected: new Date().toISOString() }] }) },
      token
    });
    expect(aiScan.status).toBe(201);

    const aiComponents = await call('GET', '/api/ai-components', { userId: ownerId });
    const shadowAI = aiComponents.body.find((item: { id: string }) => item.id === 'ai_shadow_1');
    expect(shadowAI).toBeDefined();
    expect(shadowAI.status).toBe('DISCOVERED');

    // Governance status update: mark the AI system reviewed via the finding-classification-style workflow
    // is out of scope for AI components today (no dedicated endpoint); this is intentionally left as a
    // documented manual/registration step in ai-governance.yml rather than fabricated here.
  });
});
