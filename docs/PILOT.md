# Pilot Setup

## Suggested pilot

Run a 2–4 week pilot with 1–3 repositories, an engineering lead, a security/compliance representative, and participating developers.

```bash
npm install
npm run build
npm run seed
npm run api
npx vite --config apps/web/vite.config.ts
```

Open `http://localhost:5173`. The local demo uses fictional Acme Financial Demo data and stores records in `.data/platform.json`. A PostgreSQL container is available with `docker compose up -d`, but this MVP's API adapter is still the local file adapter.

## Workflow

1. Create or select an organization and project.
2. Generate a project token once and store it in a secret manager.
3. Run `compliance-check . --format sarif --fail-on high` locally.
4. Configure CI with `COMPLIANCE_API_URL`, `COMPLIANCE_PROJECT_ID`, and `COMPLIANCE_API_TOKEN`.
5. Add `--upload` to submit only redacted finding metadata and safe GitHub metadata.
6. Review findings, suppressions, accepted risks, and AI inventory with an owner.

## First-customer dry run

The validated synthetic scenario is **Acme Technologies**. The dry run creates an organization, an owner, a project/repository, a project upload token, and a pilot, then scans the synthetic vulnerable repository before rescanning a remediated copy. It also exercises a redacted baseline, one new post-baseline violation, AI inventory, pilot metrics/report output, a clean repository scan, and organization export.

The customer-facing dashboard is available at `http://localhost:5173` after `npm run dev`. The API and dashboard load successfully, but login is still the fictional development identity/header model; this is not production authentication.

## Recommended pilot configuration

- Use `MONITOR` while the repository baseline and findings are reviewed.
- Create a redacted baseline with `--create-baseline`, review it with the customer, then scan with `--baseline ... --fail-on high`.
- Move to `WARN` after the team understands the finding volume and remediation workflow.
- Use `BLOCK` only for explicitly configured high-confidence policy findings after review; the default project mode remains conservative and owner/admin controlled.
- Keep all repositories and values synthetic during this MVP dry-run stage.

## Supported scope and blockers

The pilot API must run with `DATABASE_URL` and PostgreSQL persistence. Set `PERSISTENCE=postgres` explicitly (or rely on the configured `DATABASE_URL` outside test mode), run migrations, and verify `/ready` reports `postgresql-runtime-state`. The JSON adapter is retained only for explicit local/test use via `PERSISTENCE=json`; production and `PILOT_MODE=true` reject silent JSON fallback. Use `pg_dump`/`pg_restore` against the same PostgreSQL database used by the API.

There is no API policy-selection or AI-governance update endpoint yet. Scanner policy is configured through `compliance.config.json`, and AI governance status is reviewed through the existing inventory/manual `ai-governance.yml` process.

## Success metrics

- Repositories and pull requests scanned
- New risks caught before merge
- False-positive rate
- Median time to remediation
- Shadow AI components discovered and registered
- Controls receiving technical evidence
- Developer feedback and adoption

Do not use this pilot to make legal compliance or AI system classification claims. Findings and mappings require qualified review.

## Baseline-first deployment for existing repositories

Do not immediately block on hundreds of legacy findings in an existing repository. Recommended sequence:

1. Run a baseline scan: `compliance-check . --create-baseline compliance-baseline.json`.
2. Review the baseline with the repository owner; confirm it reflects known, accepted legacy risk.
3. Commit the baseline file and apply it on every subsequent scan: `compliance-check . --baseline compliance-baseline.json --fail-on high`.
4. Only *new* findings (not present in the baseline) affect the pass/fail threshold; legacy findings remain visible in the dashboard for tracking but do not block CI.
5. Periodically review and shrink the baseline as legacy findings are remediated.

## Starter enforcement policy

For a first customer, use a conservative starter policy rather than blocking everything immediately:

- **Block:** new `CRITICAL` and `HIGH` findings from `STABLE` rules.
- **Warn:** `MEDIUM`, `LOW`, and any finding from a `BETA`/`EXPERIMENTAL` rule.
- **AI:** warn when a new AI integration is discovered; require registration in `ai-governance.yml` where the organization has configured that requirement.
- Never block on experimental rules while they are still being validated for a given customer's codebase.

## Enforcement modes and the CI kill switch

Every project has an `enforcementMode`, changeable by an organization `OWNER`/`ADMIN` via `PATCH /api/projects/:id/enforcement` (recorded as an `ENFORCEMENT_MODE_CHANGED` audit event):

- **`BLOCK`** (default): findings above the configured threshold fail the CI check.
- **`WARN`**: findings are reported and visible in the dashboard, but never fail CI.
- **`MONITOR`**: scanning still runs and records findings, but CI is never blocked - use this as an authorized, audited kill switch during a pilot incident (e.g. an unexpected false-positive spike) without turning scanning off entirely.

## Fail-open vs. fail-closed CI behavior

Define, per organization, what should happen when the Compliance-as-Code API is unreachable during a CI run:

- **Recommended default for `MONITOR` mode: fail open.** If the service is unavailable, do not block the pipeline; the scan simply cannot be recorded centrally, and the local CLI still reports results in the CI log.
- **For `BLOCK` mode, the organization chooses:** fail open (never block merges on an infrastructure outage) or fail closed (treat an unreachable compliance service as a blocking condition, prioritizing enforcement over availability). This choice has real security/velocity trade-offs and must be made explicitly by the customer, not assumed by default.
- Never silently change this behavior between runs; the CLI's `--fail-on` and `--upload` flags make the configured behavior visible in the CI configuration itself, not hidden in a remote setting.

