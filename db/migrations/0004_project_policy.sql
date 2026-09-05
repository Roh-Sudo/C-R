-- Migration 0004: persist the project scanner policy and record which policy a
-- scan was evaluated under.
--
-- `enforcementMode` already existed on the project but only inside the
-- `runtime_state` document. These columns put the policy on the normalized
-- project reference row that scan ingestion already maintains, and stamp each
-- scan with the policy that applied so a result can be explained later.
--
-- Destructive: NO. Only adds columns. Rollback: drop the added columns.

BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS enforcement_mode text NOT NULL DEFAULT 'BLOCK';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS policy_fail_on text NOT NULL DEFAULT 'HIGH';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS policy_disabled_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS policy_updated_at timestamptz;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS policy_enforcement_mode text;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS policy_fail_on text;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS policy_updated_at timestamptz;

COMMIT;
