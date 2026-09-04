import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanDirectory, createBaseline } from '../packages/compliance-core/src/index.js';

// Validates the baseline-first adoption workflow customers rely on for
// existing repositories with pre-existing risk (Phase 11, section 17).
describe('baseline-first workflow for existing repositories', () => {
  function legacyFixtureContent(count: number): string {
    // 50 legacy hardcoded-password-style findings, each on its own line with a unique value.
    const lines: string[] = [];
    for (let index = 0; index < count; index++) lines.push(`const password = "LegacySecretValue${index}!";`);
    return lines.join('\n');
  }

  it('tracks 50 legacy findings in a baseline, still detects a new HIGH finding, and CI fails only on the new finding', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baseline-workflow-'));
    try {
      await fs.writeFile(path.join(fixtureDir, 'legacy.ts'), legacyFixtureContent(50));

      // Step 1: baseline scan of the existing repository (50 legacy source lines;
      // some lines legitimately trigger more than one rule, which is realistic).
      const baselineScan = await scanDirectory(fixtureDir, { failOn: 'HIGH' });
      const legacyCount = baselineScan.findings.length;
      expect(legacyCount).toBeGreaterThanOrEqual(50);

      // Step 2: create and persist the baseline.
      const baseline = createBaseline(baselineScan);
      expect(baseline.fingerprints.length).toBe(legacyCount);

      // Step 3: re-scan with the baseline applied - CI must pass; all legacy findings are now tracked, not active.
      const rescanClean = await scanDirectory(fixtureDir, { failOn: 'HIGH' }, baseline);
      expect(rescanClean.status).toBe('PASS');
      expect(rescanClean.findings.length).toBe(0);
      expect(rescanClean.baselineFindings.length).toBe(legacyCount);

      // Step 4: a pull request introduces one new hardcoded-secret change (realistically
      // this single line can legitimately trigger more than one rule, e.g. SEC-001 and CFG-005).
      await fs.writeFile(path.join(fixtureDir, 'new-change.ts'), 'const apiKey = "sk_live_brandnewleakedkeyabcdefgh";');
      const rescanWithNewFinding = await scanDirectory(fixtureDir, { failOn: 'HIGH' }, baseline);
      expect(rescanWithNewFinding.status).toBe('FAILED');
      expect(rescanWithNewFinding.findings.length).toBeGreaterThan(0);
      expect(rescanWithNewFinding.findings.some(finding => finding.ruleId === 'SEC-001')).toBe(true);
      expect(rescanWithNewFinding.baselineFindings.length).toBe(legacyCount);

      // Step 5: the developer removes the new finding - CI passes again, legacy findings remain tracked, not lost.
      await fs.rm(path.join(fixtureDir, 'new-change.ts'));
      const rescanFixed = await scanDirectory(fixtureDir, { failOn: 'HIGH' }, baseline);
      expect(rescanFixed.status).toBe('PASS');
      expect(rescanFixed.findings.length).toBe(0);
      expect(rescanFixed.baselineFindings.length).toBe(legacyCount);
    } finally {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
