import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory } from '../packages/compliance-core/src/index.js';

// Proves the architecture's central privacy claim: SOURCE CODE STAYS LOCAL.
// The scanner's ScanResult is the only object ever serialized for upload
// (apps/api/src/index.ts POST /api/scans consumes exactly this shape). This
// test asserts that shape never contains complete source, arbitrary source
// blocks, complete prompts, or complete AI responses - only the fields the
// architecture claims leave the environment.
describe('source-code privacy boundary', () => {
  it('never includes complete source file contents in the scan upload payload', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-fixture-'));
    try {
      const sourceLine = 'const apiKey = "sk_live_realsecretvaluethatmustneverleaveline123456";';
      const surroundingContext = [
        '// This is unrelated context above the secret line that must never be uploaded verbatim.',
        'function connect() {',
        sourceLine,
        '  return fetch("https://internal.example.com/api", { headers: { Authorization: apiKey } });',
        '}',
        '// This is unrelated context below the secret line that must never be uploaded verbatim.'
      ].join('\n');
      await fs.writeFile(path.join(fixtureDir, 'app.ts'), surroundingContext);

      const result = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
      const serialized = JSON.stringify(result);

      // The complete file content must never appear anywhere in the upload payload.
      expect(serialized).not.toContain(surroundingContext);
      // Unrelated context lines (arbitrary source blocks) must never appear.
      expect(serialized).not.toContain('This is unrelated context above');
      expect(serialized).not.toContain('This is unrelated context below');
      expect(serialized).not.toContain('function connect()');
      // The complete secret value must never appear (redaction boundary).
      expect(serialized).not.toContain('sk_live_realsecretvaluethatmustneverleaveline123456');

      // What the payload IS allowed to contain: file path, line number, rule metadata, redacted evidence.
      expect(result.findings.length).toBeGreaterThan(0);
      const finding = result.findings[0];
      expect(finding.filePath).toContain('app.ts');
      expect(typeof finding.line).toBe('number');
      expect(finding.evidence.length).toBeLessThan(surroundingContext.length);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('never includes a complete AI prompt or complete AI model response', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-ai-fixture-'));
    try {
      const completePrompt = 'You are a helpful assistant. The customer said their account number is 4111-1111-1111-1111 and asked to close their account immediately due to fraud concerns discovered on their statement.';
      const completeResponse = 'I understand your concern about the fraudulent charges on account 4111-1111-1111-1111. I have flagged this for immediate review by our fraud team and initiated a temporary hold.';
      const content = [
        "import OpenAI from 'openai';",
        'const client = new OpenAI();',
        `const prompt = "${completePrompt}";`,
        'async function respond() {',
        '  const completion = await client.chat.completions.create({ model: "gpt-4", messages: [{ role: "user", content: prompt }] });',
        `  console.log("${completeResponse}");`,
        '  return completion;',
        '}'
      ].join('\n');
      await fs.writeFile(path.join(fixtureDir, 'support-bot.ts'), content);

      const result = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain(completePrompt);
      expect(serialized).not.toContain(completeResponse);
      expect(serialized).not.toContain('4111-1111-1111-1111');

      // AI discovery metadata is allowed: provider/technology/file/line, never the prompt content.
      expect(result.aiComponents.some(component => component.provider === 'OpenAI')).toBe(true);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('documents exactly what leaves the environment via the CLI --upload payload shape', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'privacy-shape-fixture-'));
    try {
      await fs.writeFile(path.join(fixtureDir, 'config.ts'), 'const password = "hunter2hunter2";');
      const result = await scanDirectory(fixtureDir, { failOn: 'HIGH' });

      // The upload payload (ScanResult) only ever contains these top-level keys - no raw-content field exists.
      const allowedKeys = ['metadata', 'scannedPath', 'filesScanned', 'skippedFiles', 'malformedSuppressions', 'durationMs', 'rulesExecuted', 'aiComponents', 'findings', 'suppressedFindings', 'baselineFindings', 'severityCounts', 'status'];
      expect(Object.keys(result).sort()).toEqual([...allowedKeys].sort());

      // Each finding only ever contains metadata fields - no "sourceContent"/"fileContent"/"rawLine" field exists.
      const findingKeys = ['ruleId', 'ruleVersion', 'ruleStatus', 'title', 'description', 'severity', 'category', 'filePath', 'line', 'evidence', 'remediation', 'frameworks', 'confidence', 'fingerprint', 'detectorSignals'];
      for (const finding of result.findings) {
        expect(Object.keys(finding).every(key => findingKeys.includes(key))).toBe(true);
      }
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
