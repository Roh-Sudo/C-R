import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { scanDirectory } from '../packages/compliance-core/src/index.js';

describe('false-positive stress corpus', () => {
  it('has no unjustified blocking findings in the synthetic clean corpus', async () => {
    const corpusPath = path.resolve('benchmarks/fixtures/false-positive-clean');
    const result = await scanDirectory(corpusPath, { failOn: 'HIGH' });
    const blocking = result.findings.filter(item => item.severity === 'HIGH' || item.severity === 'CRITICAL');

    expect(result.filesScanned).toBe(4);
    expect(blocking).toHaveLength(0);
    expect(result.aiComponents).toHaveLength(0);
    expect(result.findings.map(item => item.ruleId).sort()).toEqual(['CFG-002', 'CFG-003']);
    expect(result.status).toBe('PASS');
  });

  it('keeps intended positive detections active', async () => {
    const fixtureDir = await fs.mkdtemp(path.join('/tmp', 'positive-regression-'));
    try {
      await fs.writeFile(path.join(fixtureDir, 'active.ts'), [
        'import OpenAI from "openai";',
        'const apiKey = "sk_live_positivecanary123456";',
        'const response = client.invoke(customer.ssn);',
        'console.log(prompt);'
      ].join('\n'));
      const result = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
      const ruleIds = result.findings.map(item => item.ruleId);

      expect(ruleIds).toEqual(expect.arrayContaining(['SEC-001', 'AI-001', 'AI-003', 'AI-007']));
      expect(result.aiComponents.some(item => item.provider === 'OpenAI')).toBe(true);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
