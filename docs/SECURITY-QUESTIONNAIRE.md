# Security Questionnaire

This document answers common customer security-review questions. It describes the current implementation honestly, including known limitations. It is not a certification and does not claim compliance with any specific regulatory framework or industry standard (SOC 2, ISO 27001, PCI-DSS, HIPAA, etc.).

## Does source code leave the customer environment?

No, unless the customer explicitly runs the CLI with `--upload`. The scanner (`packages/compliance-core`) always runs locally against the customer's own filesystem or CI runner. Only redacted finding metadata (rule ID, severity, file path, line number, redacted evidence snippet, remediation text) and scan/AI-inventory metadata are transmitted to the API when `--upload` is used. See [DATA-FLOW.md](DATA-FLOW.md) for the full data-flow diagram and [PRIVACY.md](PRIVACY.md) for the itemized list of what does and does not leave the environment.

## What data is uploaded?

- Redacted finding metadata: rule ID, title, severity, category, confidence, file path, line number, a redacted evidence string, remediation guidance, and framework mapping references.
- AI component inventory: provider, technology, model identifier (when observable), file/line, discovery method, confidence, status.
- Scan metadata: timestamp, duration, files scanned, branch/commit/PR/workflow identifiers if supplied, scanner version.
- Commercial/usage counters: see [ANALYTICS-PRIVACY.md](ANALYTICS-PRIVACY.md).

Complete source files, raw secret values, unredacted sensitive records, and complete AI prompts/responses are never uploaded.

## How are secrets redacted?

`packages/compliance-core`'s `redact()` and `redactEvidence()` functions mask credential-shaped values before a `Finding` is constructed - masking happens before the evidence string is ever stored or transmitted, not as a later filter. Database URLs, provider API-key prefixes (`sk_live_`, `AKIA...`), bearer tokens, generic `password=`/`secret=`/`token=` assignments, SSNs, and card-number-shaped values are pattern-matched and replaced with fixed redaction markers (for example `[REDACTED]`, `[SSN-REDACTED]`, `[CARD-REDACTED]`) or truncated to a short prefix/suffix. `tests/core.test.ts` asserts that redaction happens for every secret/PII/logging rule with true-positive fixtures.

## How are API tokens stored?

Project upload tokens are generated with `crypto.randomBytes(24)` and only their SHA-256 hash (`tokenHash`) is persisted; the plaintext token is returned exactly once, at creation time, and is never stored or logged afterward. Scan submission compares the SHA-256 hash of the presented bearer token against the stored hash. Tokens can be revoked (`tokenRevokedAt`).

## How is tenant isolation enforced?

Every stored resource (`Project`, `Scan`, `Finding`, `AIComponent`, `Pilot`, `AuditEvent`, `Subscription`, usage records, leads is organization-scoped by design) carries an `organizationId`. All read/write endpoints resolve the caller's membership via `membership(store, organizationId, request)` and enforce role checks with a single centralized helper, `can(member, roles)`, rather than ad hoc checks scattered per-route. `tests/commercial-flow.test.ts` includes an explicit tenant-isolation test asserting that a user without a membership record cannot change another organization's billing plan. The current data store is a single local JSON file (see below); production deployment requires a database with row-level tenant scoping and connection-level access controls, as described in [docs/DEPLOYMENT.md](DEPLOYMENT.md).

## What is logged?

The API writes a single structured line per request to stderr containing: request ID, route, HTTP status, and duration in milliseconds. It does not log authorization headers, cookies, `x-user-id` values, webhook signatures, request bodies, or finding evidence. Application-level audit events (`store.audit`) record an actor ID, event type, organization ID, and a small metadata object - never full request/response payloads.

## How are backups handled?

The current reference implementation persists to a local JSON file (`.data/platform.json`) intended for local development and pilots only. It is not backed up, replicated, or encrypted at rest by this project. Production deployment requires migrating to an encrypted, backed-up database (e.g. PostgreSQL with automated snapshots) as documented in [docs/DEPLOYMENT.md](DEPLOYMENT.md) and [docs/BACKUP-RECOVERY.md](BACKUP-RECOVERY.md). Do not treat the local JSON adapter as production-ready storage.

## What authentication is supported?

Today: a development-mode `x-user-id` header (no password, no session, no MFA) and GitHub webhook HMAC-SHA256 signature verification (`verifySignature()`, constant-time comparison). This is explicitly a development/demo mechanism. Enterprise SSO (SAML/OIDC) architecture is defined (see `docs/DATA-FLOW.md` and the SSO section of `docs/RULE-DEVELOPMENT.md`-adjacent enterprise docs) but not wired to a live identity provider; it requires real IdP configuration before it can be considered functional. Do not deploy the current auth mechanism to a shared or internet-facing environment.

## How are vulnerabilities reported?

See [SECURITY.md](../SECURITY.md) at the repository root for the disclosure process. Known open items are tracked in [docs/SECURITY-REVIEW.md](SECURITY-REVIEW.md) and must be resolved before any production/shared deployment.

## Does the product claim regulatory certification?

No. Findings, framework mappings (NIST-CSF-2.0, EU AI Act), and pilot/compliance reports are explicitly labeled as technical analysis for engineering review, not legal advice, certification, or attestation. See the disclaimer text rendered in `packages/pilot-core`'s report output.

## Billing and payment data

The reference billing provider (`LocalBillingProvider` in `packages/billing-core`) is a local/test simulation: it never transmits, stores, or processes real payment card data, and there is no integration with a live payment processor in this repository. See [remaining production blockers](#remaining-production-blockers-summary) below and the final Phase 9 report for what is required before charging real customers.

### Remaining production blockers (summary)

- No production database (local JSON file only).
- No live payment provider integration (Stripe or equivalent) - only a local/test billing provider.
- No production session/OIDC authentication provider.
- No live enterprise SSO (SAML/OIDC) provider wiring.
- No automated backup/retention enforcement beyond documented policy.
