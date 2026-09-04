import { describe, expect, it } from 'vitest';
import { calculatePilotMetrics, calculateRuleQuality, renderPilotReport, type Pilot, type PilotFinding, type PilotScan } from '../packages/pilot-core/src/index.js';

const pilot: Pilot = { id: 'pilot-alpha', organizationId: 'org-alpha', name: 'Alpha Pilot', status: 'ACTIVE', startDate: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', projectIds: ['project-payments'], goals: ['measure precision'], successCriteria: ['review findings'] };
const findings: PilotFinding[] = [
 { id: 'f1', pilotId: pilot.id, projectId: 'project-payments', ruleId: 'SEC-001', category: 'SECRET', severity: 'CRITICAL', status: 'RESOLVED', firstDetected: '2026-01-01T00:00:00Z', resolvedAt: '2026-01-03T00:00:00Z', classification: 'TRUE_POSITIVE', classifiedAt: '2026-01-02T00:00:00Z' },
 { id: 'f2', pilotId: pilot.id, projectId: 'project-payments', ruleId: 'PII-002', category: 'PII', severity: 'HIGH', status: 'OPEN', firstDetected: '2026-01-02T00:00:00Z', classification: 'FALSE_POSITIVE', classifiedAt: '2026-01-03T00:00:00Z' },
 { id: 'f3', pilotId: pilot.id, projectId: 'project-payments', ruleId: 'PII-002', category: 'PII', severity: 'HIGH', status: 'OPEN', firstDetected: '2026-01-02T00:00:00Z' }
];
const scans: PilotScan[] = [{ id: 's1', pilotId: pilot.id, projectId: 'project-payments', status: 'PASS', timestamp: '2026-01-03T00:00:00Z', durationMs: 100, filesScanned: 20, rulesExecuted: 640, pullRequest: '7', newFindings: 3, aiSystemsDiscovered: 1, shadowAISystems: 1, controlsWithEvidence: 3 }];

describe('pilot analytics', () => {
 it('derives pilot metrics and excludes unreviewed findings from false-positive rate', () => { const metrics = calculatePilotMetrics(pilot, scans, findings); expect(metrics.repositoriesScanned).toBe(1); expect(metrics.falsePositiveRate).toBe(0.5); expect(metrics.medianRemediationHours).toBe(48); expect(metrics.shadowAISystems).toBe(1); });
 it('creates rule quality scorecards from classified findings', () => { const quality = calculateRuleQuality(pilot.id, findings); expect(quality.find(item => item.ruleId === 'PII-002')?.precision).toBe(0); expect(quality.find(item => item.ruleId === 'PII-002')?.reviewedFindings).toBe(1); });
 it('renders a disclaimer in pilot reports', () => { const report = renderPilotReport(pilot, calculatePilotMetrics(pilot, scans, findings), calculateRuleQuality(pilot.id, findings)); expect(report.json).toContain('does not constitute legal advice'); expect(report.html).toContain('Executive Summary'); });
});
