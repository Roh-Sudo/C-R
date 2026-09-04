-- Migration 0001: initial production schema mirroring the current local JSON
-- store shape (apps/api/src/index.ts `Store` type). This schema is prepared
-- for a future migration off the local JSON adapter; the API does not yet
-- read/write Postgres at runtime. Applying this migration does not change
-- application behavior until the API is wired to use it.
--
-- Destructive: NO. This migration only creates tables; it never drops or
-- truncates existing data. Rollback: drop the tables listed below, in
-- reverse dependency order, if this migration must be reverted before any
-- data has been written to them.

BEGIN;

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  organization_id text NOT NULL REFERENCES organizations(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER')),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  repository_name text NOT NULL,
  repository_url text,
  default_branch text NOT NULL,
  token_hash text NOT NULL,
  token_prefix text NOT NULL,
  token_name text,
  token_created_at timestamptz NOT NULL,
  token_revoked_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_organization_id ON projects(organization_id);

CREATE TABLE IF NOT EXISTS scans (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  status text NOT NULL,
  branch text,
  commit_sha text,
  repository text,
  pull_request text,
  workflow_run text,
  timestamp timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  files_scanned integer NOT NULL,
  scanner_version text NOT NULL,
  new_findings integer NOT NULL,
  resolved_findings integer NOT NULL,
  suppressed_findings integer NOT NULL,
  ai_components integer NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scans_organization_id ON scans(organization_id);
CREATE INDEX IF NOT EXISTS idx_scans_project_id_timestamp ON scans(project_id, timestamp);

CREATE TABLE IF NOT EXISTS findings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  scan_id text NOT NULL REFERENCES scans(id),
  rule_id text NOT NULL,
  severity text NOT NULL,
  category text NOT NULL,
  confidence text NOT NULL,
  file_path text NOT NULL,
  line integer NOT NULL,
  evidence text NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED', 'SUPPRESSED', 'ACCEPTED_RISK')),
  reason text,
  first_detected timestamptz NOT NULL,
  last_detected timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_findings_organization_id ON findings(organization_id);
CREATE INDEX IF NOT EXISTS idx_findings_project_id_status ON findings(project_id, status);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
CREATE INDEX IF NOT EXISTS idx_findings_fingerprint ON findings(fingerprint);

CREATE TABLE IF NOT EXISTS ai_components (
  id text NOT NULL,
  organization_id text NOT NULL REFERENCES organizations(id),
  project_id text NOT NULL REFERENCES projects(id),
  provider text NOT NULL,
  technology text NOT NULL,
  model_identifier text,
  status text NOT NULL,
  confidence text NOT NULL,
  first_detected timestamptz NOT NULL,
  last_detected timestamptz NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_ai_components_organization_id ON ai_components(organization_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  type text NOT NULL,
  actor_id text,
  resource text,
  timestamp timestamptz NOT NULL,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS idx_audit_events_organization_id_timestamp ON audit_events(organization_id, timestamp);

CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  organization_id text NOT NULL UNIQUE REFERENCES organizations(id),
  plan_id text NOT NULL,
  status text NOT NULL,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz,
  external_customer_id text,
  external_subscription_id text,
  limit_overrides jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_records (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  metric text NOT NULL,
  quantity integer NOT NULL,
  period text NOT NULL,
  timestamp timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_records_org_metric_period ON usage_records(organization_id, metric, period);

CREATE TABLE IF NOT EXISTS leads (
  id text PRIMARY KEY,
  name text NOT NULL,
  work_email text NOT NULL,
  company text NOT NULL,
  role text NOT NULL,
  company_size text NOT NULL,
  repositories_expected integer NOT NULL,
  use_case text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
