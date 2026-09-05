# MVP Readiness

## Decision

**GO for a controlled first-customer pilot using the documented PostgreSQL runtime configuration.**

The final independent verification confirmed that API-created state is stored in PostgreSQL, survives API restart, survives database replacement and `pg_restore`, and is returned through both the API and dashboard proxy after restore. No P0 or pilot-blocking P1 remains.

## Evidence

| Area | Result | Evidence |
|---|---|---|
| Build and type validation | PASS | `npm run build`, `npm run lint` |
| Core scanner correctness | PASS | Core and positive-detection tests pass |
| Scanner accuracy | PASS_WITH_LIMITATIONS | Synthetic false-positive validation and vulnerable fixture preserve intended findings |
| False-positive validation | PASS | Clean adversarial corpus has zero blocking findings |
| Performance | PASS_WITH_LIMITATIONS | 10,000-file synthetic scan completed; peak RSS 69.38 MB |
| Source-code privacy | PASS | Source privacy suite passes; upload result contains metadata/redacted evidence only |
| Redaction | PASS | Redaction attack corpus passes across reports, API, exports, storage, logs, and error response |
| Authorization | PASS | Role matrix and authorization tests pass |
| Tenant isolation | PASS | Cross-tenant read/write/export/token attacks denied; nested IDOR regressions fixed |
| Fresh database migration | PASS | PostgreSQL 16 migrations `0001_init.sql` and `0002_runtime_state.sql` applied to an empty local database |
| Populated database migration | PASS | Current migrations applied and status verified against the runtime database; API-created state remained intact |
| Backup and restore mechanics | PASS | `pg_dump -Fc` and `pg_restore` replaced the runtime database and recovered API-created state |
| CI workflow | PASS | Corrected quiet invocation runs locally; console, JSON, and SARIF paths work |
| Acme customer dry run | PASS | Onboarding, first scan, baseline, remediation, new finding, AI inventory, metrics, report, clean scan, and export pass |
| Dashboard/API startup | PASS | Vite HTML, API readiness, and dashboard proxy returned restored PostgreSQL-backed project data |
| Failure simulation | PASS | Invalid/revoked tokens, malformed payloads, oversized scans, and unavailable API behavior are covered |
| Restart persistence | PASS | PostgreSQL API-created project/finding state survived API restart |

## Synthetic Acme dry run

The automated Acme Technologies flow completed in approximately 0.36 seconds inside the test process. This is an engineering measurement of the automated path, not a customer onboarding or marketing time estimate. The manual steps remain: install dependencies, build, start the API/dashboard, create the project token, configure scanner policy, run the baseline, and review findings with an owner.

Representative findings expose rule ID, severity, confidence, file/line location, remediation, and technical framework mappings. Evidence is redacted. The clean repository produced no findings. AI SDK usage populated inventory metadata; governance updates remain manual because no update endpoint exists.

## Blockers and limitations

### P1 blockers

- None remaining for the controlled PostgreSQL-backed pilot.

### P2 limitations

- Development identity uses `x-user-id`; production authentication/OIDC is not integrated.
- There is no API policy-selection endpoint; scanner policy is file-based through `compliance.config.json`.
- AI governance status updates are manual through inventory/`ai-governance.yml`.
- Automated production backup scheduling is not provided by this repository.

### P3 backlog

- Project deletion and member removal endpoints are not implemented.
- The explicit JSON adapter remains unsuitable for multi-process production use.
- Browser-level visual and interaction automation is not installed in the container.

## Final verification

The final verification ran build/lint, 29 scanner/security regressions, PostgreSQL migrations, 9 PostgreSQL/customer integration tests, a real API-created `pg_dump`/database replacement/`pg_restore` cycle, post-restore API and dashboard proxy queries, tenant isolation, clean/vulnerable fixture scans, the 100/1,000/10,000-file performance benchmark, and the corrected CI quiet scan command.

The PostgreSQL runtime configuration is required for the pilot: set `PERSISTENCE=postgres` and `DATABASE_URL`, apply migrations, and confirm `/ready` reports `postgresql-normalized-scans+runtime-state`.
