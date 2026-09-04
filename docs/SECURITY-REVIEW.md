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
