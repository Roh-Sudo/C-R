import { describe, expect, it } from 'vitest';
import { createBaseline, discoverAIComponents, renderJson, renderSarif, rules, scanDirectory } from '../packages/compliance-core/src/index.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('compliance scanner', () => {
  it('detects and redacts fake secrets and sensitive logging', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); const file = join(directory, 'sample.ts');
    await writeFile(file, "const apiKey = 'sk_test_1234567890abcdef';\nconsole.log(user.ssn);\n");
    const result = await scanDirectory(directory); await rm(directory, { recursive: true, force: true });
    expect(result.findings.map(item => item.ruleId)).toEqual(expect.arrayContaining(['SEC-001', 'LOG-003', 'CFG-005']));
    expect(JSON.stringify(result)).not.toContain('1234567890abcdef'); expect(JSON.stringify(result)).not.toContain('fake-password'); expect(result.findings[0].line).toBe(1);
  });
  it('respects ignored directories and thresholds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); await writeFile(join(directory, 'app.ts'), 'const ssn = "123-45-6789";');
    await writeFile(join(directory, 'ignored.ts'), 'const key = "sk_live_1234567890";');
    const result = await scanDirectory(directory, { failOn: 'CRITICAL', ignore: ['ignored.ts'] }); await rm(directory, { recursive: true, force: true });
    expect(result.findings.every(item => item.ruleId !== 'SEC-001')).toBe(true); expect(result.status).toBe('PASS');
  });
  it('emits machine-readable JSON and SARIF', async () => {
    const result = { metadata: { scanner: 'Compliance-as-Code', version: '0.2.0', timestamp: 'now', disclaimer: 'review' }, scannedPath: '.', filesScanned: 0, skippedFiles: 0, malformedSuppressions: 0, durationMs: 0, rulesExecuted: 0, aiComponents: [], findings: [], suppressedFindings: [], baselineFindings: [], severityCounts: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }, status: 'PASS' as const };
    expect(JSON.parse(renderJson(result)).status).toBe('PASS'); expect(JSON.parse(renderSarif(result)).version).toBe('2.1.0');
  });
  it('has stable rule identifiers and an expanded governance registry', () => { expect(rules.length).toBeGreaterThanOrEqual(30); expect(rules.length).toBeLessThanOrEqual(40); expect(rules.every(item => /^[A-Z]+-\d{3}$/.test(item.id))).toBe(true); });

  it('ignores documentation comments and tracks suppressions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); const file = join(directory, 'sample.ts');
    await writeFile(file, '// password = "documentation only"\n// compliance-ignore SEC-006 reason: synthetic fixture\nconst password = "fake-value";\n');
    const result = await scanDirectory(directory); await rm(directory, { recursive: true, force: true });
    expect(result.findings.some(item => item.ruleId === 'SEC-006')).toBe(false); expect(result.suppressedFindings).toHaveLength(1); expect(result.suppressedFindings[0].suppression.reason).toContain('synthetic');
  });

  it('reports malformed suppressions without suppressing findings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); const file = join(directory, 'sample.ts'); await writeFile(file, '// compliance-ignore not-a-rule\nconst password = "fake-value";');
    const result = await scanDirectory(directory); await rm(directory, { recursive: true, force: true });
    expect(result.malformedSuppressions).toBe(1); expect(result.findings.some(item => item.ruleId === 'SEC-006')).toBe(true); expect(result.suppressedFindings).toHaveLength(0);
  });

  it('creates a baseline that suppresses known findings without raw evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); const file = join(directory, 'sample.ts'); await writeFile(file, 'const password = "fake-value";');
    const initial = await scanDirectory(directory); const baseline = createBaseline(initial); const next = await scanDirectory(directory, {}, baseline); await rm(directory, { recursive: true, force: true });
    expect(next.findings).toHaveLength(0); expect(next.baselineFindings.length).toBe(initial.findings.length); expect(JSON.stringify(baseline)).not.toContain('fake-value');
  });

  it('skips oversized files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); await writeFile(join(directory, 'large.ts'), 'x'.repeat(100)); const result = await scanDirectory(directory, { maxFileSize: 10 }); await rm(directory, { recursive: true, force: true });
    expect(result.filesScanned).toBe(0); expect(result.skippedFiles).toBe(1);
  });

  it('discovers AI providers and detects sensitive AI flows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'compliance-')); const file = join(directory, 'ai.ts');
    await writeFile(file, "import OpenAI from 'openai';\nconst response = client.invoke(customer.ssn);\nconsole.log(prompt);\n");
    const result = await scanDirectory(directory); await rm(directory, { recursive: true, force: true });
    expect(discoverAIComponents("import OpenAI from 'openai';", 'ai.ts')[0].provider).toBe('OpenAI');
    expect(result.aiComponents).toHaveLength(1); expect(result.findings.map(item => item.ruleId)).toEqual(expect.arrayContaining(['AI-001', 'AI-003', 'AI-007']));
  });
});