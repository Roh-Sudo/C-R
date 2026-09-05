# Database Migration and Recovery Validation

This validation used only the repository's local PostgreSQL 16 container and synthetic Alpha/Beta data. No production database was contacted.

## Actual architecture

- Database technology: PostgreSQL 16 (`postgres:16-alpine`)
- Client: `pg`
- Migration runner: `scripts/db-migrate.mjs`
- Migration command: `DATABASE_URL=... npm run db:migrate:deploy`
- Status command: `DATABASE_URL=... npm run db:migrate:status`
- Backup/restore tools: PostgreSQL `pg_dump` and `pg_restore`
- Runtime persistence: the API uses PostgreSQL when `PERSISTENCE=postgres` or when `DATABASE_URL` is configured outside test mode. The existing domain `Store` is persisted as one JSONB runtime-state row so all current API resources share the same PostgreSQL backup/restore boundary. The JSON adapter remains available only for explicit local/test use.

The current migration contains only additive `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` operations. No `DROP TABLE`, `DROP COLUMN`, destructive type change, unsafe `NOT NULL` backfill, or data rewrite was found. Foreign keys and role/status checks are present.

The schema includes organizations, users, memberships, projects/repositories, scans, findings/evidence, AI components, audit events, subscriptions, usage records, leads, and processed webhook events. Policies and pilots are API/JSON-store concepts only and do not have PostgreSQL tables in the current migration.

## Validation commands

Fresh database migration:

```bash
DATABASE_URL=postgres://compliance:compliance@localhost:5432/compliance npm run db:migrate:deploy
DATABASE_URL=postgres://compliance:compliance@localhost:5432/compliance npm run db:migrate:status
```

The fresh run applied `0001_init.sql`; status reported no pending migrations.

Populated upgrade simulation:

1. Applied the migration to the local database.
2. Inserted deterministic synthetic Alpha/Beta records across every existing SQL model.
3. Recorded counts and relationships.
4. Removed only the `schema_migrations` ledger row to simulate a pending migration against an already populated schema.
5. Ran the actual `db:migrate:deploy` command again.
6. Compared counts, tenant ownership, finding status, memberships, constraints, and token-safe storage.

Pre- and post-migration counts were identical:

| Table | Rows |
|---|---:|
| organizations | 2 |
| users | 2 |
| memberships | 2 |
| projects | 2 |
| scans | 2 |
| findings | 2 |
| ai_components | 1 |
| audit_events | 2 |
| subscriptions | 2 |
| usage_records | 2 |
| leads | 1 |
| processed_webhook_events | 1 |

Alpha retained `proj_alpha` / `scan_alpha` / `finding_alpha` with `OPEN` status. Beta retained `proj_beta` / `scan_beta` / `finding_beta` with `RESOLVED` status. Membership roles remained `OWNER` for both organizations. Stored project token hashes did not match any plaintext synthetic token.

Backup and actual restore:

```bash
docker compose up -d postgres
docker compose exec -T postgres pg_dump -U compliance -d compliance -Fc > /tmp/c-r-mvp-backup.dump
docker compose exec -T postgres psql -U compliance -d postgres -c "DROP DATABASE IF EXISTS compliance_restore_test;"
docker compose exec -T postgres createdb -U compliance compliance_restore_test
cat /tmp/c-r-mvp-backup.dump | docker compose exec -T postgres pg_restore -U compliance -d compliance_restore_test --exit-on-error
DATABASE_URL=postgres://compliance:compliance@localhost:5432/compliance_restore_test npm test -- tests/database-recovery.test.ts
```

The source test database was deliberately corrupted by deleting Beta's finding and renaming Alpha's organization. Restore ran into a separate database and recovered the original organization name and deleted finding. The automated restored-integrity test passed with all expected counts, relationships, statuses, migration ledger state, and token-safe storage.

The runtime integration test then created Alpha/Beta organizations, a project, a scan, a finding, membership state, and audit state through the HTTP API. It verified the `runtime_state` row, stopped and restarted the API, backed up the populated PostgreSQL database, destroyed/recreated the database, restored with `pg_restore`, restarted the API, and retrieved the same project and resolved finding through the normal API. The readiness endpoint reported `postgresql-runtime-state`, and an Alpha request did not expose Beta data.

## Failure and rollback procedure

A stopped local database was used as a controlled migration failure. `db:migrate:deploy` returned exit code `1` and did not report success. Recovery is to restore database reachability, rerun status, and rerun deploy. The runner does not provide automatic transaction rollback across multiple migration files; PostgreSQL statement/transaction behavior and a verified backup are the recovery controls.

For a destructive deployment incident, restore into a new isolated PostgreSQL database with `pg_restore`, validate counts and application compatibility, then point a separately deployed application at the restored `DATABASE_URL`. Do not restore over the only live copy as the first action.

## Persistence selection and failure behavior

- `PERSISTENCE=postgres` explicitly selects PostgreSQL.
- A configured `DATABASE_URL` selects PostgreSQL by default outside `NODE_ENV=test`.
- `PERSISTENCE=json` explicitly selects the local JSON adapter for development/test workflows.
- `PILOT_MODE=true` and production startup require `DATABASE_URL` and reject JSON fallback.
- PostgreSQL connection or query failures return an unavailable readiness state/request error; they never silently switch to JSON.

## Checklist

- [x] Fresh migration applied successfully
- [x] Populated schema migration rerun successfully
- [x] Pre/post row counts and relationships compared
- [x] Alpha/Beta ownership preserved
- [x] Backup created with `pg_dump -Fc`
- [x] Backup restored with `pg_restore` into a separate database
- [x] Restored database integrity test passed
- [x] Migration failure returned nonzero
- [x] Application reads restored PostgreSQL data through the runtime adapter
- [ ] Automated production backup scheduling: not provided by this repository

This is a local synthetic validation, not proof of production backup durability or end-to-end PostgreSQL application readiness.
