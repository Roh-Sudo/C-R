# Production Blockers

Categorized gap list produced during the Phase 10 production-readiness review. Every `BLOCKER` must be resolved (or explicitly descoped by the customer contract) before onboarding a paying, production customer with real sensitive data. `HIGH`/`MEDIUM`/`LOW` items should be scheduled but do not, by themselves, prevent a controlled pilot with a cooperative first customer using synthetic or low-sensitivity data.

`npm run production:check` fails the overall readiness gate while any `BLOCKER` below remains `OPEN`.

## BLOCKER

### B1. No production database - the API still persists to a local JSON file

- **Description:** `apps/api/src/index.ts` reads/writes `.data/platform.json` (or `PLATFORM_DATA_FILE`). A Postgres schema is prepared (`db/migrations/0001_init.sql`) and a migration runner exists (`scripts/db-migrate.mjs`), but the API does not read or write Postgres at runtime.
- **Impact:** No encryption at rest, no concurrent-writer safety, no meaningful backup/restore story, and a single-process memory model that cannot scale past one API instance.
- **Owner:** _unassigned_
- **Resolution:** Wire the API's `readStore`/`writeStore` (and all direct array mutations) to the Postgres schema, behind the same function signatures so route handlers do not change. Add integration tests against a real Postgres instance (already validated manually in this phase; see `scripts/db-migrate.mjs`).
- **Status:** OPEN

### B2. No production authentication - `x-user-id` is an unauthenticated header

- **Description:** The only "authentication" today is a bare `x-user-id` request header trusted at face value; there is no password, session, or identity provider.
- **Impact:** Anyone who can reach the API can act as any user by guessing/observing a user ID. This is acceptable only for local development and demos, never for a deployment reachable outside a trusted network.
- **Owner:** _unassigned_
- **Resolution:** Integrate a real OIDC/session provider (e.g. GitHub/Google OAuth or an enterprise IdP), issue secure `HttpOnly`/`Secure`/`SameSite=Lax` session cookies, and add CSRF protection for browser-originated state-changing requests (see `docs/SECURITY-REVIEW.md`).
- **Status:** OPEN

## HIGH

### H1. No live payment provider

- **Description:** `packages/billing-core`'s `LocalBillingProvider` simulates checkout/subscription/webhook flows; no real payment processor (e.g. Stripe) is integrated, and no credentials exist in this environment.
- **Impact:** Cannot charge a customer automatically. A pilot that stays outside self-service billing (sales-assisted, invoiced) is unaffected.
- **Owner:** _unassigned_
- **Resolution:** Implement a `BillingProvider` backed by a real processor; wire its webhook signature verification into `POST /api/billing/webhook` (the idempotency/duplicate-event logic already there is provider-agnostic).
- **Status:** OPEN

### H2. CSRF protection is not yet applicable, but must not be forgotten once cookies exist

- **Description:** Because there are no session cookies today, there is currently no CSRF attack surface for browser requests. This will change the moment B2 is resolved.
- **Impact:** If a session/cookie mechanism ships without CSRF protection, browser-based state-changing requests (billing, member invites, plan changes) become forgeable.
- **Owner:** _unassigned_
- **Resolution:** Add CSRF tokens or a double-submit-cookie pattern at the same time real sessions are introduced. API-token-authenticated endpoints (`Bearer` scan ingestion) are a separate class and do not need CSRF protection.
- **Status:** OPEN (tracked, not yet applicable)

### H3. Rate limiting is per-process, in-memory

- **Description:** `createServer()`'s rate limiter (and the lead-capture limiter) use an in-memory `Map` scoped to a single Node process.
- **Impact:** Running more than one API instance (for availability or load) allows an attacker to multiply their effective request budget by hitting different instances.
- **Owner:** _unassigned_
- **Resolution:** Move rate-limit counters to a shared store (Redis or the production database) once more than one instance is deployed. Not required for a single-instance pilot.
- **Status:** OPEN

## MEDIUM

### M1. `/ready` does not verify a real dependency

- **Description:** `readStore()` never throws (it falls back to an empty store on any read error), so the readiness check always reports `ready: true` regardless of actual storage health.
- **Impact:** A broken storage layer would not be visible through `/ready`, delaying detection of an outage.
- **Owner:** _unassigned_
- **Resolution:** Once B1 lands, `/ready` should perform a real `SELECT 1`-equivalent query and return `503` on failure.
- **Status:** OPEN

### M2. No automated backup execution

- **Description:** `docs/PRODUCTION-BACKUP.md` documents the recommended backup/retention/restore procedure, but no automation (cron job, managed snapshot schedule) is configured in this repository.
- **Impact:** Backups will not exist unless an operator configures them manually per the documented procedure.
- **Owner:** _unassigned_
- **Resolution:** Configure managed database backups (e.g. the hosting provider's automated snapshot feature) as part of B1's rollout.
- **Status:** OPEN

### M3. No live enterprise SSO provider

- **Description:** Domain-restriction enforcement (`isEmailDomainAllowed`) is implemented and tested; no SAML/OIDC identity provider is actually wired up.
- **Impact:** Enterprise customers requiring SSO cannot self-serve; sales-assisted onboarding without SSO is still possible.
- **Owner:** _unassigned_
- **Resolution:** Integrate a standards-compliant SAML/OIDC library against a specific customer's IdP when the first such deal requires it.
- **Status:** OPEN

## LOW

### L1. Container build/runtime security hardening is baseline, not exhaustive

- **Description:** Both Dockerfiles use multi-stage builds, prune dev dependencies, and run as non-root; they have not been scanned with a dedicated container image scanner (e.g. Trivy/Grype).
- **Impact:** Base-image CVEs may go unnoticed between manual reviews.
- **Owner:** _unassigned_
- **Resolution:** Add an image-scanning step to CI once a scanning provider is selected.
- **Status:** OPEN

### L2. Accessibility and cross-browser validation is manual only

- **Description:** No automated accessibility (axe) or cross-browser test suite exists for the dashboard.
- **Impact:** Low risk of missed accessibility regressions on customer-facing flows.
- **Owner:** _unassigned_
- **Resolution:** Add a lightweight automated accessibility check if the customer base requires it before a controlled pilot; not a pilot blocker.
- **Status:** OPEN
