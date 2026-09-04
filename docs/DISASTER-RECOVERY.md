# Disaster Recovery

This document covers response plans for major failure scenarios once the production database (see [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md), item B1) is live, plus a restore test that was actually executed against a local Postgres instance during this phase.

## Restore test (actually executed, local `docker-compose` Postgres - not production)

**Date:** 2026-09-04. **Environment:** local `postgres:16-alpine` container started via `docker compose up -d postgres`, schema applied with `npm run db:migrate:deploy`.

Steps performed:

1. Applied `db/migrations/0001_init.sql` to a fresh container.
2. Inserted a synthetic organization, user, project, scan, and finding (`org_restore_test`, `proj_restore_test`, `scan_restore_test`, `finding_restore_test`) directly via `psql`.
3. Took a real backup: `pg_dump -U compliance -d compliance -F c -f backup.dump` inside the container, copied out with `docker cp`.
4. Simulated data loss: deleted `finding_restore_test` and renamed the organization to `CORRUPTED`.
5. Created a new, isolated database (`compliance_restore_test` - never restored over the live database) and ran `pg_restore` into it.
6. Verified: the restored database's `organizations.name` for `org_restore_test` read `Restore Test Org` (the original value, not `CORRUPTED`), and `finding_restore_test` was present again (`count = 1`).

**Result: PASS.** The backup/restore mechanism (`pg_dump`/`pg_restore`, standard PostgreSQL tooling - no custom backup code was written) recovers both updated and deleted rows when restored into a separate database, as expected. The test environment (containers, volumes, temporary dump file) was torn down afterward; no artifacts were left running.

**Caveat:** this validates the mechanics of Postgres backup/restore in isolation. It does not validate an end-to-end production restore, because the API does not yet read/write Postgres at runtime (see B1). Re-run this test against the live schema once the API is wired to Postgres, and again after any schema migration that changes table shapes.

## Database failure

- **Detection:** `/ready` should report unhealthy once wired to a real dependency check (tracked as M1 in [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md)).
- **Response:** Fail over to the most recent verified backup per [PRODUCTION-BACKUP.md](PRODUCTION-BACKUP.md); do not attempt ad hoc schema repairs on the live instance.
- **Communication:** Notify affected organizations via the status channel described in `docs/SUPPORT-RUNBOOK.md` once available; do not speculate on data loss extent before the restore is validated.

## Bad deployment

- **Detection:** Elevated error rates or failed health checks after a release.
- **Response:** Roll back the application to the previous container image/tag (see [SECURITY-REVIEW.md](SECURITY-REVIEW.md) and the rollback section of `docs/DEPLOYMENT.md`). Application rollbacks never require a destructive database rollback unless the release included a destructive migration - see the migration-compatibility guidance below.
- **Migration compatibility:** All migrations in `db/migrations/` are additive (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`); none drop or alter existing columns destructively. This keeps a previous application version compatible with a newer schema during a rollback window.

## Credential compromise

See the dedicated procedure in `docs/SUPPORT-RUNBOOK.md`/`docs/INCIDENT-RESPONSE.md` for rotating `AUTH_SECRET`, database credentials, GitHub App credentials, webhook secrets, billing secrets, and revoking API tokens.

## GitHub integration outage

- **Impact:** New webhook deliveries queue on GitHub's side and retry per GitHub's own policy; scans already in flight via direct API upload are unaffected.
- **Response:** No action required beyond monitoring; GitHub redelivers webhooks automatically. Confirm no duplicate processing occurred once service resumes (idempotency is enforced via delivery ID deduplication).

## Authentication outage

- **Impact:** New logins fail; existing sessions are unaffected until they expire.
- **Response:** Once a real OIDC provider is integrated, monitor its status page and communicate proactively; there is no bypass mechanism, by design.

## Billing/payment provider outage

- **Impact:** Checkout, plan-change, and cancellation actions fail; existing entitlements are unaffected because plan state is stored locally and only updated on a successful, verified webhook.
- **Response:** Queue affected requests for manual retry once the provider recovers; never grant entitlements without a verified event.

## Scanner API outage (upload endpoint unavailable)

- **Impact:** Local/CI scans still run and produce local reports (JSON/SARIF/console); only the `--upload` step fails.
- **Response:** CI behavior depends on the organization's configured enforcement mode (`MONITOR`/`WARN`/`BLOCK`) and fail-open/fail-closed policy - see the Enforcement section added to `docs/PILOT.md`. No customer scan results are lost locally; only the upload step needs to be retried once the API recovers.
