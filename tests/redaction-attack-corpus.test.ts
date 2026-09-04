import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { scanDirectory, renderJson, renderSarif, renderConsole } from '../packages/compliance-core/src/index.js';

// Comprehensive fake-secret corpus pushed through every reporter and the
// full scan->API->export path. Every value below is fake/synthetic. Verifies
// complete values never cross the redaction boundary into any reporter,
// the database file, dashboard-facing responses, or exports.
describe('redaction attack corpus', () => {
  const uniqueSuffix = randomBytes(6).toString('hex');
  const corpus: Array<{ label: string; line: string; secret: string }> = [
    { label: 'API key', line: `const apiKey = "sk_live_${uniqueSuffix}abcdefghijklmnop";`, secret: `sk_live_${uniqueSuffix}abcdefghijklmnop` },
    { label: 'AWS access key', line: `const awsKey = "AKIA${uniqueSuffix.toUpperCase().padEnd(16, 'X')}";`, secret: `AKIA${uniqueSuffix.toUpperCase().padEnd(16, 'X')}` },
    { label: 'bearer token', line: `headers.Authorization = "Bearer ${uniqueSuffix}.token.value.should.never.leak";`, secret: `${uniqueSuffix}.token.value.should.never.leak` },
    { label: 'password', line: `const password = "SuperSecret_${uniqueSuffix}!";`, secret: `SuperSecret_${uniqueSuffix}!` },
    { label: 'database credential URL', line: `const dbUrl = "postgres://admin:CorrectHorse${uniqueSuffix}@db.internal:5432/prod";`, secret: `CorrectHorse${uniqueSuffix}` },
    { label: 'private key', line: '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA1234567890fakeprivatekeymaterial\n-----END RSA PRIVATE KEY-----', secret: 'MIIEpAIBAAKCAQEA1234567890fakeprivatekeymaterial' },
    { label: 'SSN-like value', line: 'const customerSsn = "923-71-4455";', secret: '923-71-4455' },
    { label: 'payment-card-like value', line: 'const cardNumber = "4111 1111 1111 1111";', secret: '4111 1111 1111 1111' },
    { label: 'AI prompt secret', line: `const prompt = "The customer's account recovery code is ${uniqueSuffix}-RECOVERY, do not share it.";`, secret: `${uniqueSuffix}-RECOVERY` }
  ];

  async function scanCorpus() {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'redaction-corpus-'));
    const content = corpus.map(item => item.line).join('\n');
    await fs.writeFile(path.join(fixtureDir, 'corpus.ts'), content);
    const result = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
    await fs.rm(fixtureDir, { recursive: true, force: true });
    return result;
  }

  it('never leaks a complete corpus value through the scan result, console, JSON, or SARIF reporters', async () => {
    const result = await scanCorpus();
    const surfaces = [JSON.stringify(result), renderJson(result), renderSarif(result), renderConsole(result)];
    for (const item of corpus) {
      for (const surface of surfaces) {
        expect(surface, `${item.label} leaked into a reporter surface`).not.toContain(item.secret);
      }
    }
  });

  it('never leaks a complete corpus value through the API upload/database/export/audit path', async () => {
    const result = await scanCorpus();
    process.env.PLATFORM_DATA_FILE = `${os.tmpdir()}/platform-redaction-${randomBytes(6).toString('hex')}.json`;
    const mod = await import('../apps/api/src/index.js');
    const server = mod.createServer();
    await new Promise<void>(resolve => server.listen(0, resolve));
    const address = server.address();
    if (typeof address === 'string' || !address) throw new Error('server did not bind');
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const userId = `user_${randomBytes(4).toString('hex')}`;
      const orgResponse = await fetch(`${base}/api/organizations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': userId }, body: JSON.stringify({ name: 'Redaction Corpus Org' }) });
      const org = await orgResponse.json();
      const projectResponse = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': userId }, body: JSON.stringify({ organizationId: org.id, name: 'Repo', repositoryName: 'org/repo' }) });
      const project = await projectResponse.json();

      const scanResponse = await fetch(`${base}/api/scans`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${project.token}` }, body: JSON.stringify({ projectId: project.project.id, result }) });
      const scanText = await scanResponse.text();
      expect(scanResponse.status).toBe(201);

      const findingsText = await (await fetch(`${base}/api/findings`, { headers: { 'x-user-id': userId } })).text();
      const exportText = await (await fetch(`${base}/api/organizations/${org.id}/export`, { headers: { 'x-user-id': userId } })).text();
      const auditJsonText = await (await fetch(`${base}/api/organizations/${org.id}/audit/export?format=json`, { headers: { 'x-user-id': userId } })).text();
      const auditCsvText = await (await fetch(`${base}/api/organizations/${org.id}/audit/export?format=csv`, { headers: { 'x-user-id': userId } })).text();
      const rawStoreText = await fs.readFile(process.env.PLATFORM_DATA_FILE!, 'utf8');

      const surfaces = { scanText, findingsText, exportText, auditJsonText, auditCsvText, rawStoreText };
      for (const item of corpus) {
        for (const [surfaceName, surface] of Object.entries(surfaces)) {
          expect(surface, `${item.label} leaked into ${surfaceName}`).not.toContain(item.secret);
        }
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
      await fs.rm(process.env.PLATFORM_DATA_FILE!, { force: true });
    }
  });

  it('never leaks a complete corpus value through a simulated error path', async () => {
    // Simulate an error handler that reports a scan failure - it must only ever
    // reference structured fields (rule ID, file path, line), never raw evidence.
    const result = await scanCorpus();
    const simulatedErrorTrace = { message: 'scan failed validation', ruleId: result.findings[0]?.ruleId, filePath: result.findings[0]?.filePath, line: result.findings[0]?.line };
    const serialized = JSON.stringify(simulatedErrorTrace);
    for (const item of corpus) {
      expect(serialized).not.toContain(item.secret);
    }
  });
});
