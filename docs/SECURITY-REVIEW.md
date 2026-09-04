# Security Review

| Area | Severity | Status | Notes |
| --- | --- | --- | --- |
| Scanner source exfiltration | High | Fixed | Upload sends result metadata only; evidence is redacted locally. |
| API token storage | High | Fixed | Random tokens, SHA-256 hashes, one-time display, project scope. |
| Tenant authorization | Critical | Partial | Organization and membership checks are present on user reads/writes; coverage and a real session provider remain required. |
| IDOR | High | Partial | Project/finding reads check membership; all future endpoints must use the centralized membership helper. |
| Webhook forgery | High | Fixed | HMAC SHA-256 signature verification and delivery-id duplicate check. |
| Request exhaustion | High | Fixed | 5 MB body, 10,000 finding, 20 KB evidence, and in-memory request limits. |
| CORS | Medium | Fixed | Configured origin is used; local default is localhost dashboard. |
| XSS | High | Partial | React escapes rendered values; production CSP and output sanitization need deployment-level verification. |
| CSRF/session security | High | Open | Dev identity path is not production authentication; use OIDC and secure same-site cookies before pilot data is internet-facing. |
| Database security | High | Open | Current adapter is local JSON despite the optional PostgreSQL compose service. |
| Dependency vulnerabilities | Medium | Review | Run `npm audit`; development tooling may report advisories. |

No production readiness claim is made while the open items remain. The API logs request ID, route, status, and duration only; it does not log authorization headers, cookies, source, or raw evidence.

## Phase 10 practical production security review

| Area | Finding |
| --- | --- |
| Authentication | Dev-mode `x-user-id` header only; see B2 in [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md). No production auth exists yet. |
| Authorization | Centralized `can()`/`membership()` helpers on every route; verified with a dedicated Organization Alpha vs. Organization Beta regression covering projects, findings, scans, AI components, pilots, audit, billing, exports, and membership (`tests/tenant-isolation.test.ts`). |
| IDOR | Every resource-ID-accepting endpoint resolves the owning organization server-side before returning or mutating data; direct-ID access by a non-member returns `404`/`403`, not the resource (same regression test). |
| Tenant isolation | Pass - see above. The internal admin commercial dashboard additionally requires a separate `x-admin-token`, independent of any tenant role (`tests/commercial-flow.test.ts`). |
| SQL injection | Not applicable today - the application does not execute SQL at runtime (local JSON store only). The prepared migration tooling (`scripts/db-migrate.mjs`) uses parameterized queries (`pg` client, `$1`-style placeholders) for all dynamic values. |
| XSS | React escapes all rendered scanner/finding content by default; no `dangerouslySetInnerHTML` is used for scanner-derived data. |
| CSRF | Not currently applicable (no session cookies exist); tracked as H2 in [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md) to implement alongside real sessions. |
| SSRF | The API does not fetch arbitrary customer-supplied URLs server-side; scan results are pushed by the client, not pulled by the server. |
| Command injection | The API never shells out based on request input; `scripts/db-migrate.mjs` and `scripts/production-check.mjs` run fixed commands, not request-derived strings. |
| Path traversal | Scan ingestion stores structured JSON fields, not file paths written to disk; the local data file path is derived from a trusted environment variable, not request input. |
| Webhook forgery | GitHub (HMAC-SHA256 + duplicate delivery-ID check) and billing (HMAC + duplicate event-ID check) webhooks both verified and tested (`tests/api-security.test.ts`, `tests/commercial-flow.test.ts`). |
| Token leakage | Project tokens are hashed at rest, shown once, never logged; verified no complete secret survives the scan→API→export→logs path (`tests/canary-secret.test.ts`). |
| Session fixation | Not applicable - no sessions exist yet. |
| Rate limiting | Global (120 req/min/IP) plus a dedicated stricter limit (5/hour/IP) on the public lead-capture endpoint; documented as in-memory/per-process (H3 in PRODUCTION-BLOCKERS.md) until a shared store is needed. |
| Request-size abuse | 5 MB body cap, 10,000 findings/scan, 20 KB evidence/finding, enforced before processing. |
| Sensitive logging | Structured one-line-per-request logs (request ID, route, status, duration) only; verified no canary secret appears in server-visible output during the regression test. |
| Secrets | `.env.example` contains placeholders only; production startup rejects missing critical secrets (`apps/api/src/env.ts`); no real credentials found in the repository during the Phase 10 secret-leakage scan (`npm run production:check`). |
| Container security | Multi-stage builds, `npm prune --omit=dev` in the API image, non-root user (API: dedicated `compliance` user; web: `nginx-unprivileged` base), health checks, verified to build and run (see `docker/`). |
| Dependencies | `npm audit --omit=dev --audit-level=high` reports 0 findings; the only current advisories are in `vite`/`esbuild`/`vitest` (devDependencies, dev-server only), not shipped in either production image. |

No new `Critical`/`High` findings were introduced by Phase 10 work. The pre-existing `Open` items above (tenant authorization's remaining session-provider dependency, CSRF/session security, database security) are unchanged in substance and remain tracked in [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md) as `BLOCKER`/`HIGH` items.

