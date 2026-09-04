# Changelog

Meaningful customer-facing changes. Internal vulnerability details are not disclosed here before remediation; see [SECURITY.md](SECURITY.md) for the disclosure process.

## Unreleased - Phase 10: Production Launch Readiness

### Added

- Typed environment validation (`apps/api/src/env.ts`): production startup now fails fast on missing `DATABASE_URL`/`APP_URL`/`AUTH_SECRET` or a wildcard `CORS_ORIGIN`, instead of silently falling back to development defaults.
- Graceful shutdown on `SIGTERM`/`SIGINT`.
- `appVersion` exposed on `GET /health`.
- Project-level enforcement modes (`MONITOR`/`WARN`/`BLOCK`) with an authorized, audited kill switch (`PATCH /api/projects/:id/enforcement`).
- Prepared Postgres schema (`db/migrations/0001_init.sql`) and migration tooling (`npm run db:migrate:status` / `db:migrate:deploy`), validated against a real Postgres instance including a genuine backup/restore test (see `docs/DISASTER-RECOVERY.md`).
- `npm run production:check`: automated production-readiness gate covering build, lint, tests, scanner quality, environment schema, secret-leakage scanning, dependency vulnerabilities, database migration status, and container builds.
- Production container images (`docker/api.Dockerfile`, `docker/web.Dockerfile`): multi-stage, non-root, health-checked; verified to build and run.
- Demo-seed safeguard: `--seed` refuses to run when `NODE_ENV=production` unless explicitly overridden.
- New regression tests: environment validation, tenant isolation (Organization Alpha vs. Organization Beta across every resource type), canary secret leakage, CORS production configuration, enforcement mode, and the full commercial/pilot lifecycle.
- New documentation: `docs/SECURITY-QUESTIONNAIRE.md`, `docs/DATA-FLOW.md`, `docs/THREAT-MODEL.md`, `docs/PRODUCTION-BLOCKERS.md`, `docs/PRODUCTION-BACKUP.md`, `docs/DISASTER-RECOVERY.md`, `docs/FIRST-CUSTOMER.md`, `docs/SUPPORT-RUNBOOK.md`, `docs/INCIDENT-RESPONSE.md`, `docs/LAUNCH-CHECKLIST.md`.

### Changed

- `benchmarks/scripts/run.ts` now also fails its exit code when `qualityGate` is false (previously only failed on a per-case mismatch).

### Known limitations (see `docs/PRODUCTION-BLOCKERS.md`)

- The API still persists to a local JSON file; the prepared Postgres schema is not yet wired into request handling.
- Authentication remains a development-mode `x-user-id` header; no production identity provider is integrated.
- Billing uses a local/test provider only; no live payment processor is integrated.

## Phase 9: Commercialization, Billing Architecture & Enterprise Readiness

- Added `packages/billing-core`: plans, entitlements, usage metering, billing periods, soft/hard limits, trial lifecycle, `BillingProvider` abstraction with a local/test implementation, billing audit events, commercial event model, activation/time-to-first-value helpers, sales-lead model.
- Added billing/usage/leads/admin-commercial endpoints to the API, gated by organization role or a separate system-admin token.
- Added Billing, Pricing, and Enterprise Pilot Request pages to the dashboard.

## Phase 8 and earlier

- Local compliance scanner with secrets/PII/logging/security-configuration rules, NIST-CSF-2.0 informative mappings, AI governance and Shadow AI discovery, scanner quality benchmarks, pilot analytics, and organization/project/role primitives. See `ROADMAP.md` for the original phase-by-phase plan.
