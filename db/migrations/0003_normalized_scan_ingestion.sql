-- Migration 0003: activate the normalized scan ingestion path.
--
-- Migration 0001 created `scans`, `findings`, and `ai_components` but the API
-- never wrote to them; scan ingestion went through the whole-store
-- `runtime_state` JSONB blob, so concurrent uploads could overwrite each other.
-- This migration completes those tables so the ingestion path can write them
-- transactionally, and adds the join/event tables the path needs.
--
-- Destructive: NO. Only adds columns, tables, and indexes. The unique index on
-- (project_id, fingerprint) is what makes finding deduplication safe under
-- concurrency; it is created CONCURRENTLY-safe here because these tables have
-- never been written to by the application. Rollback: drop the added objects.

BEGIN;

ALTER TABLE findings ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN IF NOT EXISTS remediation text NOT NULL DEFAULT '';
ALTER TABLE findings ADD COLUMN IF NOT EXISTS frameworks jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS rule_version integer;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS rule_status text;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS detector_signals jsonb;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS classification text;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS classified_by text;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS classified_at timestamptz;
ALTER TABLE findings ADD COLUMN IF NOT EXISTS classification_reason text;

-- Deduplication key: one stored finding per project + fingerprint. Concurrent
-- uploads rely on this for ON CONFLICT instead of read-modify-write.
CREATE UNIQUE INDEX IF NOT EXISTS uq_findings_project_id_fingerprint ON findings(project_id, fingerprint);

ALTER TABLE ai_components ADD COLUMN IF NOT EXISTS file_path text NOT NULL DEFAULT '';
ALTER TABLE ai_components ADD COLUMN IF NOT EXISTS line_number integer NOT NULL DEFAULT 0;
ALTER TABLE ai_components ADD COLUMN IF NOT EXISTS discovery_method text NOT NULL DEFAULT '';

-- A scan reports every finding it observed, including findings first detected by
-- an earlier scan, so the membership cannot be derived from findings.scan_id.
CREATE TABLE IF NOT EXISTS scan_findings (
  scan_id text NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  finding_id text NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (scan_id, finding_id)
);
CREATE INDEX IF NOT EXISTS idx_scan_findings_finding_id ON scan_findings(finding_id);

CREATE TABLE IF NOT EXISTS commercial_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL,
  type text NOT NULL,
  timestamp timestamptz NOT NULL,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS idx_commercial_events_organization_id ON commercial_events(organization_id);

-- Organizations remain authoritative in `runtime_state` for now, and the audit
-- log legitimately records the sentinel tenant 'unassigned' (unrouted webhook
-- deliveries). These append-only event logs therefore record the tenant id
-- without a foreign key. `scans` and `findings` keep their foreign keys.
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_organization_id_fkey;
ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_organization_id_fkey;

COMMIT;
