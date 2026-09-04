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

