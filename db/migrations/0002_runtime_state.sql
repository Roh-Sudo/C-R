-- Migration 0002: PostgreSQL runtime state adapter.
-- The API keeps its existing domain Store shape while persisting the complete
-- state atomically as JSONB in PostgreSQL; backups therefore cover live state.
BEGIN;

CREATE TABLE IF NOT EXISTS runtime_state (
  id text PRIMARY KEY CHECK (id = 'singleton'),
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
