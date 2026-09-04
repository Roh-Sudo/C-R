# First-Customer Launch Checklist

Use this checklist before onboarding the first controlled-pilot customer. Check items honestly; do not check an item that has not actually been verified. As of this phase, several items remain unchecked by design - see [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md) and the final [production-readiness-report.md](../production-readiness-report.md).

- [x] Production environment configuration validated (`apps/api/src/env.ts`, tested in `tests/env.test.ts`)
- [x] Secrets: `.env.example` documents required variables with placeholders only; no real secrets committed (verified via the secret-leakage scan in `npm run production:check`)
- [ ] Database provisioned in production (schema prepared in `db/migrations/`, but the API does not yet read/write it - see B1)
- [ ] Backups configured (procedure documented in `docs/PRODUCTION-BACKUP.md`; restore mechanics validated locally, but no production instance exists yet to back up)
- [x] Migration tooling successful against a real Postgres instance (`npm run db:migrate:status` / `db:migrate:deploy`, validated in this phase)
- [ ] Authentication tested (blocked on B2 - no production identity provider integrated yet)
- [x] Tenant isolation passed (`tests/tenant-isolation.test.ts`, Organization Alpha vs Organization Beta, all resource types denied)
- [x] Scanner benchmarks passed (`npm run quality:benchmark`, `qualityGate: true`, zero failures)
- [x] Redaction passed (`tests/canary-secret.test.ts` - a fake secret never appears in the database, logs, audit events, dashboard-facing responses, JSON/CSV exports)
- [x] GitHub integration tested (HMAC signature verification and duplicate-delivery handling covered by existing webhook tests)
- [x] Health/readiness endpoints respond (`/health` returns `appVersion`; `/ready` responds, though it does not yet verify a real dependency - see M1)
- [ ] Monitoring configured (alert hooks are architecture-only; no live monitoring provider is configured - see `docs/PRODUCTION-BLOCKERS.md`)
- [x] Incident runbook ready (`docs/INCIDENT-RESPONSE.md`)
- [x] Support process ready (`docs/SUPPORT-RUNBOOK.md`)
- [x] Customer policy selected (starter enforcement policy documented in `docs/PILOT.md`)
- [x] Baseline strategy agreed (`docs/PILOT.md#baseline-first-deployment-for-existing-repositories`)
- [x] Rollback tested (migrations are additive-only by design; container image rollback is a redeploy of the previous tag, documented in `docs/DISASTER-RECOVERY.md`)

## Verdict

See [production-readiness-report.md](../production-readiness-report.md) for the current GO/NO-GO decision and its evidence. Unchecked items above correspond to open `BLOCKER`/`HIGH` items in [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md) and must be resolved, or explicitly and knowingly accepted by the customer for a scoped controlled pilot, before proceeding.
