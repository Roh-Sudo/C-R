# Compliance-as-Code

Compliance-as-Code is a local, engineering-native scanner for finding potential sensitive-data, secret, logging, and insecure-configuration risks before code reaches production. It produces technical control findings for review by qualified engineering, security, compliance, and legal professionals. It does not certify legal or regulatory compliance.

## Architecture

```text
Developer
	|
Pull Request
	|
GitHub Actions
	|
Compliance Scanner
	|
Rules Engine
	+----------------------------+
	| PII | Secrets | Security    |
	| Logging | NIST Mappings     |
	+----------------------------+
	|
Findings
	|
PASS / WARN / FAIL
```

The scanner is fully local: it does not upload source code, store scanned files, use external APIs, collect telemetry, or add analytics.

## Installation and Quick Start

```bash
npm install
npm run build
npm test
npm run compliance:scan
```

Scan the intentionally unsafe fake fixture:

```bash
node dist/apps/cli/src/index.js examples/vulnerable-app --format console --fail-on high
node dist/apps/cli/src/index.js examples/clean-app --format console
```

The first command returns a non-zero exit code and reports multiple potential findings. All credentials and personal data in that fixture are fake.

Current MVP scope: 22 deterministic rules across TypeScript, JavaScript, JSON, YAML, Python, Java, and Java properties files.

## Platform Quick Start

The optional platform adds a local API and React dashboard backed by persistent JSON storage in `.data/platform.json`:

```bash
npm run seed
npm run api                 # API: http://localhost:8787
npx vite --config apps/web/vite.config.ts  # Dashboard: http://localhost:5173
```

The dashboard consumes `/api/projects`, `/api/findings`, `/api/rules`, and `/api/frameworks`; it is not populated by hardcoded dashboard metrics. The `dev` script starts both processes with `concurrently`.

For a production deployment, replace the file repository with PostgreSQL behind the same API boundary. The current adapter is intentionally dependency-light for an immediately runnable founder demo and is not a multi-process production database.

Phase 6 adds organization-scoped records, owner/admin/developer/viewer role primitives, development-session login, project-scoped upload tokens, audit events, HMAC-verified GitHub webhook architecture, request limits, CORS configuration, health/readiness endpoints, and an AI Inventory pilot view. Use [docs/PILOT.md](docs/PILOT.md) for a 2–4 week pilot workflow.

Phase 7 adds a measurable pilot layer. Create a pilot through `POST /api/pilots`, inspect `/api/pilots/:id/metrics`, classify findings through `/api/findings/:id/classification`, and generate `/api/pilots/:id/report` as JSON or HTML. False-positive rate and rule precision use only explicitly classified findings; unreviewed findings are excluded. See [docs/PILOT-RUNBOOK.md](docs/PILOT-RUNBOOK.md) and [docs/ANALYTICS-PRIVACY.md](docs/ANALYTICS-PRIVACY.md).

The local development identity is fictional (`user_owner`) and is not production authentication. Before handling internet-facing customer data, connect the session boundary to OIDC (Google/GitHub/enterprise SSO), replace the JSON adapter with PostgreSQL migrations and indexes, add secure cookies/CSRF protection, and configure TLS, shared rate limiting, encryption, backups, and retention jobs.

## CLI

```text
compliance-check [path]
  --format console|json|sarif
  --fail-on low|medium|high|critical
  --output <file>
  --ignore <path-or-glob>
	--config <file>
	--baseline <file>
	--create-baseline <file>
	--quiet
	--upload

compliance-check rules [RULE-ID]
compliance-check --help
compliance-check --version
```

The generated JSON includes scanner metadata, timestamp, scanned path, file count, findings, severity counts, and status. SARIF 2.1.0 includes rule metadata, severity levels, locations, and remediation messages for code-scanning workflows.

Upload only redacted result metadata to the local API with `COMPLIANCE_API_URL`, `COMPLIANCE_PROJECT_ID`, and `COMPLIANCE_API_TOKEN`, then `compliance-check . --upload`. GitHub metadata is limited to repository, branch, commit, pull request, and workflow identifiers; source files and complete secrets are never sent.

## Platform API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET/POST | `/api/projects` | List or create projects; creation returns a token once |
| GET | `/api/projects/:id` | Read project metadata |
| GET | `/api/scans` and `/api/scans/:id` | Read scan history |
| POST | `/api/scans` | Authenticated scan ingestion |
| GET | `/api/findings` and `/api/findings/:id` | Read findings |
| PATCH | `/api/findings/:id` | Change finding status and reason |
| GET | `/api/rules` | Rule registry metadata |
| GET | `/api/frameworks` | Framework mapping metadata |

Project tokens are generated with cryptographic randomness and stored as SHA-256 hashes. They are returned completely only when a project is created. The local API also applies request-size limits, CORS headers, `nosniff`, and frame protections. Authentication is project-scoped; production deployments still need TLS, rate limiting, CSRF strategy, and a real database adapter.

## Commercialization (Phase 9)

Phase 9 adds a billing/entitlement architecture in `packages/billing-core`: centralized `PLANS` (Free, Team, Business, Enterprise), a capability-based entitlement engine (`canUse()`/`getLimit()` instead of scattered `plan === 'BUSINESS'` checks), usage metering, monthly billing periods, soft/hard limit enforcement, a 14-day trial lifecycle, a `BillingProvider` abstraction with a fully functional `LocalBillingProvider` for local/test simulation, billing audit events, a privacy-safe commercial event model, activation/time-to-first-value helpers, and a minimal sales-lead model.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/billing/plans` | Public plan catalog (pricing page) |
| GET | `/api/organizations/:id/billing` | Subscription, trial status, and usage snapshot |
| POST | `/api/organizations/:id/billing/checkout` | Start a simulated checkout session |
| POST | `/api/billing/webhook` | Signed, idempotent billing provider webhook |
| POST | `/api/organizations/:id/billing/change-plan` | Upgrade/downgrade (data is never deleted) |
| POST | `/api/organizations/:id/billing/cancel` | Cancel at period end (distinct from deleting the org) |
| GET | `/api/organizations/:id/usage` | Usage dashboard data with plan limits |
| GET/POST | `/api/organizations/:id/members` | List/invite members (enforces the member limit and approved domains) |
| POST | `/api/leads` | Rate-limited enterprise pilot request capture |
| GET/PATCH | `/api/admin/leads`, GET `/api/admin/commercial` | Internal admin views, protected by a separate `x-admin-token`, never by tenant role |
| GET | `/api/organizations/:id/export` | Organization data export (JSON), secrets excluded |
| GET | `/api/organizations/:id/audit/export` | Audit export (JSON or CSV, date-filterable) |

No real payment provider is connected. See [docs/SECURITY-QUESTIONNAIRE.md](docs/SECURITY-QUESTIONNAIRE.md), [docs/DATA-FLOW.md](docs/DATA-FLOW.md), and [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) for the security architecture, and the dashboard's Billing/Pricing pages for the customer-facing experience.

## Dashboard Pages

The responsive dashboard includes Dashboard, Projects, Scans, Findings, Rules, Frameworks, and Settings navigation. Dashboard metrics are derived from API project/finding data and include a technical Compliance Risk Score, severity distribution, project posture, recent findings, and risk trend presentation. The score is a transparent demo heuristic: `100 - (critical × 30 + high × 12 + medium × 4 + low × 1)`, clamped to 0–100. It is not an industry standard or legal compliance score.

## Configuration

Create `compliance.config.json`:

```json
{
  "failOn": "high",
  "ignore": ["generated", "fixtures"],
  "rules": { "PII-001": "warning", "SEC-002": "off" }
}
```

The `rules` map supports `warning`, `error`, and `off`; `off` disables a rule. CLI flags override the configured failure threshold. Default ignored directories are `node_modules`, `.git`, `dist`, `build`, `coverage`, and `vendor`.

## Supported MVP Rules

| ID | Finding | Severity |
| --- | --- | --- |
| SEC-001..006 | Provider secret, AWS key, private key, bearer token, database URL, password | High/Critical |
| PII-001..005 | SSN, payment card, plaintext field, exposed config, DOB | Medium/High |
| LOG-001..005 | Password, token, SSN, payment, and user-object logging | Medium/High |
| CFG-001..006 | TLS, CORS, debug, HTTP, credentials, public cloud access | Medium/High |

Regex matches are signals and can be false positives. Evidence is redacted before output, and review is recommended.

Suppress a reviewed finding on the following line with an explicit rule ID: `// compliance-ignore SEC-006 reason: synthetic demo fixture`. Malformed suppression comments are counted and never suppress findings. Adoption teams can create a redacted baseline with `--create-baseline compliance-baseline.json` and apply it with `--baseline compliance-baseline.json`; only new findings affect the threshold.

## GitHub Actions

The reusable workflow at `.github/workflows/compliance.yml` runs on pushes to `main` and pull requests, fails on high or critical findings, and uploads SARIF as an artifact. GitHub code-scanning upload may require `security-events: write`; the base workflow deliberately does not assume that permission.

## Demo and Sample Reports

Follow [docs/DEMO.md](docs/DEMO.md) for the short product demonstration. Real generated console, JSON, and SARIF examples live under `docs/examples/`.

## NIST CSF 2.0 Mapping

Findings include informative mappings such as `PR.DS` for data protection, `PR.AA` for identity/access protection, and `PR.PS` for platform protection. A mapping identifies a related technical outcome only; a detected finding or an empty result does not establish full NIST CSF implementation or certification.

## Security, Privacy, and Limitations

The MVP never intentionally exposes complete secrets, does not transmit source code, and does not claim to determine whether data is legally regulated. It skips binary, symlink, and over-sized files (1 MiB default; configurable), does not follow symlinks outside the root, and uses bounded line regexes rather than runtime data-flow analysis. It cannot validate value authenticity, replace secret rotation, or prove GDPR, CCPA, HIPAA, CMMC, FedRAMP, EU AI Act, SOC 2, or PCI DSS compliance.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for staged MVP, V1, V2, and future work.

## How to Add a Rule

Add a typed `Rule` to the registry in `packages/compliance-core/src/index.ts`, use a stable category ID, keep detection deterministic, redact evidence through the shared path, provide remediation and a defensible mapping, then add true-positive, false-positive, and output tests in `tests/`.

## Disclaimer

Compliance-as-Code is an engineering risk-detection layer. Findings are potential compliance risks and technical control observations for qualified review. It is not a law firm, auditor, certification authority, or guarantee of regulatory compliance.
