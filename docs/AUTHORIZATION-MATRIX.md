# Authorization Matrix

Backend enforcement (`can()`/`membership()` in `apps/api/src/index.ts`) is authoritative. This matrix documents actual implementation, verified against the route handlers, not an aspirational design. `-` means the action does not exist for that resource today.

Roles: `OWNER`, `ADMIN`, `DEVELOPER`, `VIEWER`. A blank cell for a non-member (no membership row at all) is always **DENIED** for every action and every resource below - verified by `tests/tenant-isolation.test.ts` and `tests/second-tenant-attack.test.ts`.

| Resource | Action | OWNER | ADMIN | DEVELOPER | VIEWER |
|---|---|---|---|---|---|
| Organization | CREATE (self, becomes OWNER) | ✅ (any authenticated user) | ✅ | ✅ | ✅ |
| Organization | READ (own org, via list) | ✅ | ✅ | ✅ | ✅ |
| Project | READ | ✅ | ✅ | ✅ | ✅ |
| Project | CREATE | ✅ | ✅ | ❌ | ❌ |
| Project | UPDATE enforcement mode | ✅ | ✅ | ❌ | ❌ |
| Project | Revoke token | ✅ | ✅ | ❌ | ❌ |
| Project | Rotate token | ✅ | ✅ | ❌ | ❌ |
| Project | DELETE | - | - | - | - |
| Scan | READ | ✅ | ✅ | ✅ | ✅ |
| Scan | CREATE (ingestion) | project token, not a user role | project token, not a user role | project token, not a user role | project token, not a user role |
| Finding | READ | ✅ | ✅ | ✅ | ✅ |
| Finding | UPDATE status (resolve/suppress/accept risk) | ✅ | ✅ | ✅ | ❌ |
| Finding | Classification (true/false positive) | ✅ | ✅ | ✅ | ❌ |
| AI component (inventory) | READ | ✅ | ✅ | ✅ | ✅ |
| AI component | UPDATE (registration/governance status) | - | - | - | - |
| Framework/report data | READ | ✅ (public, no auth) | ✅ | ✅ | ✅ |
| Pilot | READ | ✅ | ✅ | ✅ | ✅ |
| Pilot | CREATE | ✅ | ✅ | ❌ | ❌ |
| Members | READ | ✅ | ✅ | ✅ | ✅ |
| Members | CREATE (invite) | ✅ | ✅ | ❌ | ❌ |
| Members | DELETE (remove) | - | - | - | - |
| API tokens | CREATE (project creation) | ✅ | ✅ | ❌ | ❌ |
| API tokens | Revoke/rotate | ✅ | ✅ | ❌ | ❌ |
| Audit log | READ | ✅ | ✅ | ✅ | ✅ |
| Audit log | EXPORT (JSON/CSV) | ✅ | ✅ | ❌ | ❌ |
| Billing/subscription | READ | ✅ | ✅ | ✅ | ✅ |
| Billing/subscription | Checkout / change plan / cancel | ✅ | ✅ | ❌ | ❌ |
| Usage | READ | ✅ | ✅ | ✅ | ✅ |
| Organization data export | READ (export) | ✅ | ✅ | ❌ | ❌ |
| Feedback | CREATE | ✅ | ✅ | ✅ | ✅ |
| Feature requests | READ | ✅ | ✅ | ✅ | ✅ |

## Gaps found and fixed during this review

- **API token revocation had no endpoint.** `tokenRevokedAt` was checked at scan-ingestion time but nothing could ever set it, meaning a "revoked" token could never actually exist. Fixed: added `POST /api/projects/:id/revoke-token` and `POST /api/projects/:id/rotate-token`, both `OWNER`/`ADMIN` only, both audited (`TOKEN_REVOKED`/`TOKEN_ROTATED`), both covered by `tests/second-tenant-attack.test.ts` (a revoked token is rejected on the next scan attempt).

## Gaps identified but intentionally out of pilot scope (not fixed - see PILOT-SCOPE.md)

- **No member removal endpoint.** A member can be invited but not removed via the API today. For a single-organization controlled pilot with a small, trusted team, this is acceptable; it is listed as a P2 in `docs/RELEASE-CANDIDATE-STATUS.md`.
- **No project deletion endpoint.** Consistent with the "never silently discard data" principle from Phase 9, but means a mistakenly created project cannot be removed, only left inactive. P3 - not a pilot blocker.
- **No AI component registration/governance-status-update endpoint.** AI inventory is currently read-only via the API; governance registration is a manual `ai-governance.yml` step (see `docs/AI-GOVERNANCE.md`). Documented in `docs/PILOT-SCOPE.md` as not-yet-supported.

## Cross-tenant verification

Every `✅`/`❌` above was exercised through the actual HTTP API by two independent regression suites using two synthetic organizations (`tests/tenant-isolation.test.ts`: Organization Alpha vs. Organization Beta; `tests/second-tenant-attack.test.ts`: First Customer Dry Run vs. Attacker Tenant). Both suites pass as of this phase.
