# Threat Model

Methodology: a lightweight STRIDE-informed walkthrough of each component in [DATA-FLOW.md](DATA-FLOW.md). Each row lists an asset, a credible threat, an attack path, the impact if realized, the current mitigation, and the residual risk that remains. This is an engineering threat model, not a certification of any regulatory control.

## Scanner (CLI, `packages/compliance-core`)

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Local source code | Disclosure | A future rule or a malicious dependency exfiltrates file contents instead of a redacted finding | Full source/secret leak | Scanner is offline-by-default; upload requires an explicit `--upload` flag and only sends `Finding`/`ScanResult` objects, never raw file contents | Depends on rule authors not introducing an exfiltration path; enforced today by code review and `tests/core.test.ts` redaction assertions, not by a sandbox |
| Findings/evidence | Disclosure via evidence string | A rule captures more of the surrounding line than intended | Partial secret leak in "redacted" evidence | `redactEvidence()` runs on every evidence string before a `Finding` is created; evidence length is capped (20 KB) at upload | Regex-based redaction can miss novel secret formats; see [RULE-DEVELOPMENT.md](RULE-DEVELOPMENT.md) |

## CI environment

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Project upload token | Spoofing / credential theft | Token committed to a public repo or leaked in CI logs | Attacker uploads forged scan results or exhausts a project's usage/scan quota | Tokens are opaque random values, hashed at rest, never re-displayed after creation, and revocable | No automatic secret-scanning of the CI configuration itself is performed by this project; customers must protect their own CI secret store |

## API (`apps/api`)

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Cross-tenant data | Tampering / information disclosure | A user forges an `organizationId` in a request body to read/write another tenant's data | Cross-tenant data breach | Every mutating/reading endpoint resolves `membership(store, organizationId, request)` server-side; role checks centralized in `can()`; covered by `tests/commercial-flow.test.ts` tenant-isolation test | Some endpoints (e.g. legacy list endpoints) filter by the caller's membership list rather than a single resource ID; a systematic per-route audit is recommended before production |
| Request volume | Denial of service | Repeated large requests exhaust memory/CPU | Service degradation for all tenants | Global rate limit (120 req/min/IP), 5 MB body cap, 10,000 findings/scan cap, 20 KB evidence cap, dedicated tighter rate limit (5/hour/IP) on the public lead-capture endpoint | Rate limiting is in-memory per process; a multi-instance deployment needs a shared limiter (e.g. Redis) |
| Session/auth | Spoofing | The `x-user-id` header is a bare, unauthenticated claim in the current dev-mode implementation | Full account takeover if exposed | Documented as dev-only in [SECURITY-REVIEW.md](SECURITY-REVIEW.md); production requires OIDC/session cookies | This is an open, known blocker - do not deploy the current auth mechanism to a shared or internet-facing environment |

## Authentication / Enterprise SSO

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Enterprise identity | Spoofing | A forged SAML/OIDC assertion is accepted | Full account/organization takeover | Architecture requires a standards-compliant SAML/OIDC library (never a custom parser); no live IdP is wired in this repository | SSO is not yet functional; treat as design/readiness only until a real IdP is integrated and tested |
| Approved domains | Elevation of privilege | A user signs up with a look-alike email domain to bypass an organization's domain restriction | Unauthorized org access | `isEmailDomainAllowed()` is enforced server-side on membership creation, not merely in the UI | Does not yet cover self-service signup flows that create a brand-new organization; only enforced on the invite/membership endpoint |

## GitHub integration

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Webhook ingestion | Spoofing / repudiation | An attacker posts a forged webhook payload | Fake audit events, fake scan triggers | HMAC-SHA256 signature verification, constant-time comparison, duplicate-delivery-ID detection | Webhook secret must be provisioned and rotated by the operator; no automatic rotation is implemented |

## Billing webhooks

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Subscription state | Tampering | An attacker posts a forged or replayed billing webhook to grant themselves a paid plan | Free access to paid entitlements, revenue loss | Signature verification (`BillingProvider.processWebhook()`), duplicate event-ID tracking (`processedWebhookEventIds`), server never trusts a client-supplied plan value directly | The local/test provider's HMAC scheme is illustrative; a production payment provider integration must use that provider's real signature verification and event ordering guarantees |
| Plan/entitlement data | Elevation of privilege | A non-member or non-admin org member calls `change-plan`/`cancel` | Unauthorized billing change | Role check (`OWNER`/`ADMIN` only) plus membership check on every billing mutation endpoint | None known beyond the general auth caveats above |

## Database / persistence

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| All tenant data | Disclosure | The local JSON data file is world-readable or copied off-host | Full data breach across all tenants | File lives under `.data/`, excluded from version control | The local JSON adapter is explicitly documented as unsuitable for production (see [DEPLOYMENT.md](DEPLOYMENT.md)); no encryption at rest, no access control beyond filesystem permissions |

## Dashboard

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Session/user data | Cross-site scripting | A stored finding/evidence value renders unescaped in the dashboard | Session hijack, data theft | React escapes rendered text by default; the dashboard never uses `dangerouslySetInnerHTML` for scanner-derived content | No dedicated CSP has been verified for the deployed dashboard build; tracked in [SECURITY-REVIEW.md](SECURITY-REVIEW.md) |

## Exports (data export, audit export)

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Exported organization data | Disclosure | A non-admin member triggers an export and exfiltrates more than they should see | Data leak within/across roles | Export endpoints require `OWNER`/`ADMIN` role and are organization-scoped; secrets/tokens are stripped (`safeProject()`) before export | Exports are generated synchronously in the API process; a very large organization's export could increase request latency - documented as a scaling limitation, not a security gap |

## Multi-tenancy (cross-cutting)

| Asset | Threat | Attack path | Impact | Mitigation | Remaining risk |
|---|---|---|---|---|---|
| Tenant boundary | Elevation of privilege | A tenant `OWNER`/`ADMIN` attempts to access the internal admin commercial dashboard | Cross-tenant aggregate metrics disclosure | `GET /api/admin/commercial` and `GET /api/admin/leads` require a separate system admin token (`x-admin-token`, constant-time compared), independent of any organization role; covered by `tests/commercial-flow.test.ts` | Admin token is a single shared secret in this reference implementation; production should use per-operator credentials with audit logging of admin access |
