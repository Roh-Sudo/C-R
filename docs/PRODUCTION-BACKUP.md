# Production Backup Strategy

This document describes the recommended backup approach once the database migration (see [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md), item B1) is complete. It does not claim that automated backups are currently configured in this repository - none are.

## What must be backed up

- The production Postgres database: organizations, users, memberships, projects (excluding plaintext tokens - only hashes are ever stored), scans, findings, AI inventory, audit events, subscriptions, usage records, leads.
- Application configuration is not a backup concern - it is redeployed from source control and a secret manager, never restored from a database backup.

## Recommended frequency and retention

- **Full snapshot:** at least daily, automated (e.g. the hosting provider's managed snapshot feature for Postgres).
- **Point-in-time recovery (PITR):** enabled via continuous WAL archiving if the hosting provider supports it, to minimize data loss between snapshots.
- **Retention:** at least 30 days of daily snapshots for an initial pilot; extend per the organization's configured `auditRetentionDays`/`scanHistoryDays` entitlement once those are enforced against real history windows.

## Encryption expectations

- Backups must be encrypted at rest using the hosting provider's default encryption (e.g. AES-256) at minimum.
- Backup access must be restricted to the same operators who can access production credentials - never broader.

## Restore procedure (outline)

1. Provision a new, isolated Postgres instance (never restore over a live production database as a first step).
2. Restore the selected snapshot/PITR point into the isolated instance.
3. Run `npm run db:migrate:status` against the restored instance to confirm the schema matches the expected migration state.
4. Validate row counts and a sample of recent records (organizations, projects, findings) against pre-incident expectations.
5. Only after validation, cut the application over to the restored instance (update `DATABASE_URL`) and redeploy.

## Restore validation

A restore is not considered successful until:

- `npm run db:migrate:status` reports no pending migrations.
- A synthetic read-only smoke check (see [docs/SUPPORT-RUNBOOK.md](SUPPORT-RUNBOOK.md)) succeeds against the restored instance before it is promoted to serve production traffic.

See [docs/DISASTER-RECOVERY.md](DISASTER-RECOVERY.md) for the local/staging restore test that was actually run during this phase, and its results.

## Responsibility boundary

- **Hosting provider is responsible for:** underlying storage durability, snapshot mechanics, and infrastructure-level encryption, if a managed Postgres service is used.
- **Compliance-as-Code operator is responsible for:** configuring the backup schedule and retention, testing restores on a defined cadence (recommended: quarterly), and maintaining this document as the actual configuration changes.
- This document does not claim any hosting provider's backup feature is currently enabled. It must be explicitly configured and verified before it can be relied upon.
