// Normalized PostgreSQL persistence for the scan ingestion path.
//
// The rest of the API still reads and writes the whole-store `runtime_state`
// JSONB document. Scan ingestion cannot: two CI uploads that land at the same
// time would each read the full store, mutate a copy, and overwrite the other.
// Scans, findings, and AI components therefore live in the normalized tables
// from migrations 0001/0003 and are written inside a single transaction, so
// concurrent uploads are serialized by PostgreSQL rather than by this process.

import type { AIComponent, Category, Confidence, Finding, FrameworkMapping, Severity } from '../../../packages/compliance-core/src/index.js';
import type { CommercialEvent, UsageRecord } from '../../../packages/billing-core/src/index.js';

export type FindingStatus = 'OPEN' | 'RESOLVED' | 'SUPPRESSED' | 'ACCEPTED_RISK';
export type StoredFinding = Finding & { id: string; organizationId: string; projectId: string; scanId: string; status: FindingStatus; firstDetected: string; lastDetected: string; reason?: string; classification?: string; classifiedBy?: string; classifiedAt?: string; classificationReason?: string };
export type StoredAI = AIComponent & { organizationId: string; projectId: string };
export type StoredScan = { id: string; organizationId: string; projectId: string; status: string; branch?: string; commitSha?: string; repository?: string; pullRequest?: string; workflowRun?: string; timestamp: string; durationMs: number; filesScanned: number; scannerVersion: string; findingIds: string[]; newFindings: number; resolvedFindings: number; suppressedFindings: number; aiComponents: number; policyEnforcementMode?: string; policyFailOn?: string; policyUpdatedAt?: string };
export type AuditEvent = { id: string; type: string; actorId?: string; organizationId: string; resource?: string; timestamp: string; metadata?: Record<string, string> };

export type OrganizationRef = { id: string; name: string; createdAt: string };
export type ProjectRef = { id: string; organizationId: string; name: string; repositoryName: string; repositoryUrl?: string; defaultBranch: string; tokenHash: string; tokenPrefix: string; tokenName?: string; tokenCreatedAt: string; tokenRevokedAt?: string; createdAt: string; updatedAt: string; enforcementMode: string; failOn: string; disabledRules: string[]; policyUpdatedAt: string };

export type NormalizedState = { scans: StoredScan[]; findings: StoredFinding[]; aiComponents: StoredAI[]; audit: AuditEvent[]; usageRecords: UsageRecord[]; commercialEvents: CommercialEvent[] };

type PoolLike = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>; connect: () => Promise<ClientLike>; end: () => Promise<void> };
type ClientLike = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>; release: () => void };

let pool: PoolLike | undefined;

/** A single shared pool; opening a connection per request made ingestion latency dominated by TCP setup. */
export async function getPool(): Promise<PoolLike> {
 if (!process.env.DATABASE_URL) throw new Error('PostgreSQL persistence requires DATABASE_URL');
 if (!pool) {
  // @ts-expect-error pg is a runtime dependency without bundled declarations.
  const { Pool } = await import('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PGPOOL_MAX ?? 10) }) as PoolLike;
 }
 return pool;
}

export async function closePool(): Promise<void> { const current = pool; pool = undefined; if (current) await current.end(); }

const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);
const optional = (value: unknown): string | undefined => value === null || value === undefined ? undefined : String(value);

function toScan(row: any, findingIds: string[]): StoredScan {
 return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, status: row.status, branch: optional(row.branch), commitSha: optional(row.commit_sha), repository: optional(row.repository), pullRequest: optional(row.pull_request), workflowRun: optional(row.workflow_run), timestamp: iso(row.timestamp), durationMs: row.duration_ms, filesScanned: row.files_scanned, scannerVersion: row.scanner_version, findingIds, newFindings: row.new_findings, resolvedFindings: row.resolved_findings, suppressedFindings: row.suppressed_findings, aiComponents: row.ai_components, policyEnforcementMode: optional(row.policy_enforcement_mode), policyFailOn: optional(row.policy_fail_on), policyUpdatedAt: row.policy_updated_at ? iso(row.policy_updated_at) : undefined };
}

function toFinding(row: any): StoredFinding {
 return { id: row.id, organizationId: row.organization_id, projectId: row.project_id, scanId: row.scan_id, ruleId: row.rule_id, ruleVersion: row.rule_version ?? undefined, ruleStatus: optional(row.rule_status) as StoredFinding['ruleStatus'], title: row.title, description: row.description, severity: row.severity as Severity, category: row.category as Category, confidence: row.confidence as Confidence, filePath: row.file_path, line: row.line, evidence: row.evidence, remediation: row.remediation, frameworks: (row.frameworks ?? []) as FrameworkMapping[], detectorSignals: row.detector_signals ?? undefined, fingerprint: row.fingerprint, status: row.status as FindingStatus, reason: optional(row.reason), firstDetected: iso(row.first_detected), lastDetected: iso(row.last_detected), classification: optional(row.classification), classifiedBy: optional(row.classified_by), classifiedAt: row.classified_at ? iso(row.classified_at) : undefined, classificationReason: optional(row.classification_reason) };
}

export async function readNormalizedState(): Promise<NormalizedState> {
 const pooled = await getPool();
 const client = await pooled.connect();
 try {
  // Sequential on one connection: a parallel fan-out here would hold several
  // pool slots per request and starve concurrent ingestion transactions.
  const scans = await client.query('SELECT * FROM scans');
  const links = await client.query('SELECT scan_id, finding_id FROM scan_findings ORDER BY scan_id, position');
  const findings = await client.query('SELECT * FROM findings');
  const aiComponents = await client.query('SELECT * FROM ai_components');
  const audit = await client.query('SELECT * FROM audit_events');
  const usage = await client.query('SELECT * FROM usage_records');
  const commercial = await client.query('SELECT * FROM commercial_events');
  const byScan = new Map<string, string[]>();
  for (const link of links.rows) { const list = byScan.get(link.scan_id) ?? []; list.push(link.finding_id); byScan.set(link.scan_id, list); }
  return {
   scans: scans.rows.map(row => toScan(row, byScan.get(row.id) ?? [])).sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
   findings: findings.rows.map(toFinding),
   aiComponents: aiComponents.rows.map(row => ({ id: row.id, organizationId: row.organization_id, projectId: row.project_id, provider: row.provider, technology: row.technology, modelIdentifier: optional(row.model_identifier), filePath: row.file_path, lineNumber: row.line_number, discoveryMethod: row.discovery_method, confidence: row.confidence as Confidence, status: row.status, firstDetected: iso(row.first_detected), lastDetected: iso(row.last_detected) })),
   audit: audit.rows.map(row => ({ id: row.id, type: row.type, actorId: optional(row.actor_id), organizationId: row.organization_id, resource: optional(row.resource), timestamp: iso(row.timestamp), metadata: row.metadata ?? undefined })),
   usageRecords: usage.rows.map(row => ({ id: row.id, organizationId: row.organization_id, metric: row.metric, quantity: row.quantity, period: row.period, timestamp: iso(row.timestamp) })),
   commercialEvents: commercial.rows.map(row => ({ id: row.id, organizationId: row.organization_id, type: row.type, timestamp: iso(row.timestamp), metadata: row.metadata ?? undefined }))
  };
 } finally { client.release(); }
}

/** Organizations and projects still live in `runtime_state`; these reference rows exist so the scan/finding foreign keys hold. */
async function syncReferences(client: ClientLike, organization: OrganizationRef, project: ProjectRef): Promise<void> {
 await client.query('INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name', [organization.id, organization.name, organization.createdAt]);
 await client.query(
  `INSERT INTO projects (id, organization_id, name, repository_name, repository_url, default_branch, token_hash, token_prefix, token_name, token_created_at, token_revoked_at, created_at, updated_at, enforcement_mode, policy_fail_on, policy_disabled_rules, policy_updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
   ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, repository_name = EXCLUDED.repository_name, repository_url = EXCLUDED.repository_url, default_branch = EXCLUDED.default_branch, token_hash = EXCLUDED.token_hash, token_prefix = EXCLUDED.token_prefix, token_revoked_at = EXCLUDED.token_revoked_at, updated_at = EXCLUDED.updated_at, enforcement_mode = EXCLUDED.enforcement_mode, policy_fail_on = EXCLUDED.policy_fail_on, policy_disabled_rules = EXCLUDED.policy_disabled_rules, policy_updated_at = EXCLUDED.policy_updated_at`,
  [project.id, project.organizationId, project.name, project.repositoryName, project.repositoryUrl ?? null, project.defaultBranch, project.tokenHash, project.tokenPrefix, project.tokenName ?? null, project.tokenCreatedAt, project.tokenRevokedAt ?? null, project.createdAt, project.updatedAt, project.enforcementMode, project.failOn, JSON.stringify(project.disabledRules ?? []), project.policyUpdatedAt]
 );
}

export type IngestInput = {
 organization: OrganizationRef;
 project: ProjectRef;
 scan: Omit<StoredScan, 'findingIds' | 'newFindings' | 'resolvedFindings' | 'aiComponents'>;
 findings: Finding[];
 /** Fingerprints the scan still observed but filtered out (inline suppressions, baseline); they must not be auto-resolved. */
 retainedFingerprints: string[];
 /** False when the scan did not actually cover the project, which must never mass-resolve findings. */
 autoResolve: boolean;
 aiComponents: AIComponent[];
 reportedAIComponents: number;
 timestamp: string;
 newFindingId: () => string;
 auditEvent: AuditEvent;
 usageRecords: UsageRecord[];
 commercialEvent: (type: 'FIRST_SCAN_COMPLETED' | 'FIRST_FINDING_DETECTED' | 'AI_SYSTEM_DISCOVERED', metadata?: Record<string, string>) => CommercialEvent;
};

export type IngestResult = { scan: StoredScan; newFindings: number; resolvedFindings: number; newAIComponents: number; projectFindings: StoredFinding[] };

/**
 * One transaction: scan row, findings (deduplicated by the unique
 * (project_id, fingerprint) index), scan/finding links, AI components, and the
 * bookkeeping events. Any failure rolls the whole thing back, so a partially
 * ingested scan is never visible.
 */
export async function ingestScan(input: IngestInput): Promise<IngestResult> {
 const pooled = await getPool();
 const client = await pooled.connect();
 try {
  await client.query('BEGIN');
  await syncReferences(client, input.organization, input.project);

  const firstScan = (await client.query('SELECT 1 FROM scans WHERE organization_id = $1 LIMIT 1', [input.organization.id])).rows.length === 0;
  const firstFinding = (await client.query('SELECT 1 FROM findings WHERE organization_id = $1 LIMIT 1', [input.organization.id])).rows.length === 0;

  const scan = input.scan;
  await client.query(
   `INSERT INTO scans (id, organization_id, project_id, status, branch, commit_sha, repository, pull_request, workflow_run, timestamp, duration_ms, files_scanned, scanner_version, new_findings, resolved_findings, suppressed_findings, ai_components, policy_enforcement_mode, policy_fail_on, policy_updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,$14,0,$15,$16,$17)`,
   [scan.id, scan.organizationId, scan.projectId, scan.status, scan.branch ?? null, scan.commitSha ?? null, scan.repository ?? null, scan.pullRequest ?? null, scan.workflowRun ?? null, scan.timestamp, scan.durationMs, scan.filesScanned, scan.scannerVersion, scan.suppressedFindings, input.project.enforcementMode, input.project.failOn, input.project.policyUpdatedAt]
  );

  const findingIds: string[] = [];
  let newFindings = 0;
  for (const finding of input.findings) {
   // `xmax = 0` is true only when this statement inserted the row, which is how
   // a concurrent upload of the same fingerprint is told apart from a new one.
   const upserted = await client.query(
    `INSERT INTO findings (id, organization_id, project_id, scan_id, rule_id, rule_version, rule_status, title, description, severity, category, confidence, file_path, line, evidence, remediation, frameworks, detector_signals, fingerprint, status, first_detected, last_detected)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,'OPEN',$20,$20)
     ON CONFLICT (project_id, fingerprint) DO UPDATE
       SET last_detected = EXCLUDED.last_detected,
           status = CASE WHEN findings.status = 'RESOLVED' THEN 'OPEN' ELSE findings.status END
     RETURNING id, (xmax = 0) AS inserted`,
    [input.newFindingId(), scan.organizationId, scan.projectId, scan.id, finding.ruleId, finding.ruleVersion ?? null, finding.ruleStatus ?? null, finding.title, finding.description, finding.severity, finding.category, finding.confidence, finding.filePath, finding.line, finding.evidence, finding.remediation, JSON.stringify(finding.frameworks ?? []), finding.detectorSignals ? JSON.stringify(finding.detectorSignals) : null, finding.fingerprint, input.timestamp]
   );
   const row = upserted.rows[0];
   findingIds.push(row.id);
   if (row.inserted) newFindings++;
  }

  for (const [position, findingId] of findingIds.entries()) {
   await client.query('INSERT INTO scan_findings (scan_id, finding_id, position) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [scan.id, findingId, position]);
  }

  let newAIComponents = 0;
  for (const component of input.aiComponents) {
   const upserted = await client.query(
    `INSERT INTO ai_components (id, organization_id, project_id, provider, technology, model_identifier, file_path, line_number, discovery_method, status, confidence, first_detected, last_detected)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
     ON CONFLICT (project_id, id) DO UPDATE SET last_detected = EXCLUDED.last_detected
     RETURNING (xmax = 0) AS inserted`,
    [component.id, scan.organizationId, scan.projectId, component.provider, component.technology, component.modelIdentifier ?? null, component.filePath, component.lineNumber, component.discoveryMethod, component.status, component.confidence, input.timestamp]
   );
   if (upserted.rows[0].inserted) newAIComponents++;
  }

  // Findings the scan no longer observes are closed automatically. Scoped to this
  // project only, and only OPEN rows: SUPPRESSED and ACCEPTED_RISK are explicit
  // decisions the scanner must not overwrite.
  let resolvedFindings = 0;
  if (input.autoResolve) {
   const observed = [...new Set([...input.findings.map(finding => finding.fingerprint), ...input.retainedFingerprints])];
   const closed = await client.query(
    `UPDATE findings SET status = 'RESOLVED' WHERE project_id = $1 AND status = 'OPEN' AND NOT (fingerprint = ANY($2::text[])) RETURNING id`,
    [scan.projectId, observed]
   );
   resolvedFindings = closed.rows.length;
  }

  await client.query('UPDATE scans SET new_findings = $2, resolved_findings = $3, ai_components = $4 WHERE id = $1', [scan.id, newFindings, resolvedFindings, input.reportedAIComponents]);

  await client.query('INSERT INTO audit_events (id, organization_id, type, actor_id, resource, timestamp, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING', [input.auditEvent.id, input.auditEvent.organizationId, input.auditEvent.type, input.auditEvent.actorId ?? null, input.auditEvent.resource ?? null, input.auditEvent.timestamp, input.auditEvent.metadata ? JSON.stringify(input.auditEvent.metadata) : null]);
  for (const record of input.usageRecords) {
   await client.query('INSERT INTO usage_records (id, organization_id, metric, quantity, period, timestamp) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [record.id, record.organizationId, record.metric, record.quantity, record.period, record.timestamp]);
  }
  const commercial: CommercialEvent[] = [];
  if (firstScan) commercial.push(input.commercialEvent('FIRST_SCAN_COMPLETED'));
  if (firstFinding && newFindings > 0) commercial.push(input.commercialEvent('FIRST_FINDING_DETECTED'));
  if (newAIComponents > 0) commercial.push(input.commercialEvent('AI_SYSTEM_DISCOVERED', { count: String(newAIComponents) }));
  for (const event of commercial) {
   await client.query('INSERT INTO commercial_events (id, organization_id, type, timestamp, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO NOTHING', [event.id, event.organizationId, event.type, event.timestamp, event.metadata ? JSON.stringify(event.metadata) : null]);
  }

  await client.query('COMMIT');
  const projectFindings = (await client.query('SELECT * FROM findings WHERE project_id = $1', [scan.projectId])).rows.map(toFinding);
  return { scan: { ...scan, findingIds, newFindings, resolvedFindings, aiComponents: input.reportedAIComponents, policyEnforcementMode: input.project.enforcementMode, policyFailOn: input.project.failOn, policyUpdatedAt: input.project.policyUpdatedAt }, newFindings, resolvedFindings, newAIComponents, projectFindings };
 } catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  // The underlying driver message can echo submitted values; keep evidence out of the response.
  throw new ScanIngestionError(error instanceof Error ? error.name : 'unknown');
 } finally {
  client.release();
 }
}

export class ScanIngestionError extends Error {
 constructor(readonly cause: string) { super('scan ingestion failed and was rolled back; no partial scan was stored'); this.name = 'ScanIngestionError'; }
}

export async function updateFindingRow(finding: StoredFinding): Promise<void> {
 const client = await getPool();
 await client.query(
  `UPDATE findings SET status = $2, reason = $3, classification = $4, classified_by = $5, classified_at = $6, classification_reason = $7 WHERE id = $1`,
  [finding.id, finding.status, finding.reason ?? null, finding.classification ?? null, finding.classifiedBy ?? null, finding.classifiedAt ?? null, finding.classificationReason ?? null]
 );
}

/** Append-only bookkeeping written by non-scan handlers, which still build their rows in the runtime_state document. */
export async function appendEvents(audit: AuditEvent[], usageRecords: UsageRecord[], commercialEvents: CommercialEvent[]): Promise<void> {
 const pooled = await getPool();
 const client = await pooled.connect();
 try {
  await client.query('BEGIN');
  for (const event of audit) await client.query('INSERT INTO audit_events (id, organization_id, type, actor_id, resource, timestamp, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING', [event.id, event.organizationId, event.type, event.actorId ?? null, event.resource ?? null, event.timestamp, event.metadata ? JSON.stringify(event.metadata) : null]);
  for (const record of usageRecords) await client.query('INSERT INTO usage_records (id, organization_id, metric, quantity, period, timestamp) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [record.id, record.organizationId, record.metric, record.quantity, record.period, record.timestamp]);
  for (const event of commercialEvents) await client.query('INSERT INTO commercial_events (id, organization_id, type, timestamp, metadata) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO NOTHING', [event.id, event.organizationId, event.type, event.timestamp, event.metadata ? JSON.stringify(event.metadata) : null]);
  await client.query('COMMIT');
 } catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
 } finally {
  client.release();
 }
}
