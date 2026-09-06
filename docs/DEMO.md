# Controlled private customer demo

Target: 10–15 minutes. Branch: `codex/private-demo-setup`.

**THIS BUILD IS FOR CONTROLLED PRIVATE DEMONSTRATION ONLY.**

Current identity uses fictional `user_owner` / development headers, not production authentication. Use localhost on a trusted machine; do not expose the API/dashboard to the public internet or run this build on a public-facing host. No tunnels, public port forwarding, or real customer source code. Synthetic data only unless separately approved. Never display project tokens during screen sharing.

Positioning: “Compliance-as-Code continuously detects technical compliance and AI-governance risks inside the software delivery workflow and produces actionable technical evidence.” Findings and mappings support engineering review; they do not guarantee compliance, certify a framework, or replace auditors or legal advice.

## Assets and scope

Use `examples/vulnerable-app`: two synthetic files, already validated through CLI, PostgreSQL, API, browser, and restart persistence. `examples/clean-app` is a separate comparison fixture, not the remediation rescan target. AI examples live in `examples/ai-vulnerable-app` and `examples/ai-clean-app`. Benchmark fixtures live in `benchmarks/fixtures`.

The existing `npm run seed` / `npm run demo:seed` populates fictional platform records, but is unnecessary for this runbook. Do not seed or reset the database between presentations. Existing background reading: `docs/PILOT.md`, `docs/AI-GOVERNANCE.md`, `.github/workflows/compliance.yml`, `compliance.config.json`, and `ai-governance.yml`. Some older pilot/deployment paragraphs describe superseded persistence/policy behavior; use the commands below for this branch.

The main fixture has no AI integration. The core story therefore works without an AI Inventory segment. Do not invent an AI result for this project.

## A. Pre-demo startup (before the customer joins)

Run from the repository root on the demo Mac:

```bash
cd /Users/roh/Documents/Projects/C-R
source "$HOME/.nvm/nvm.sh"
nvm use 22
node --version
npm --version
git status --short --branch
npm ci
npm run build
```

The repository has no `.nvmrc`; package engines require `>=20.12`. Node 22.23.2 was used for private-demo validation. If Node 22 is absent, run `nvm install 22` before `nvm use 22`.

Keep the existing ignored root `.env`. Required demo settings are `DATABASE_URL` pointing to the local demo database at `127.0.0.1:5432`, `PERSISTENCE=postgres`, `PILOT_MODE=true`, `NODE_ENV=development`, `PORT=8787`, `APP_URL=http://localhost:5173`, and `CORS_ORIGIN=http://localhost:5173`. Keep database credentials only in the ignored local configuration. No additional application `.env` files are needed. Do not print `.env` or upload it.

Start Docker Desktop if needed, then:

```bash
docker compose up -d postgres
docker compose exec -T postgres pg_isready -U compliance -d compliance
node --env-file=.env scripts/db-migrate.mjs status
```

If migrations are pending, apply the existing additive migrations, then recheck status:

```bash
node --env-file=.env scripts/db-migrate.mjs deploy
node --env-file=.env scripts/db-migrate.mjs status
```

These commands invoke the existing migration runner with Node’s explicit `--env-file=.env` option. The migration npm scripts do not automatically load `.env`; API/seed scripts do. Do not apply migrations to an unknown database.

In a dedicated terminal from the same repository root, with Node 22 active:

```bash
npm run api
```

In another dedicated terminal, with Node 22 active:

```bash
npx vite --config apps/web/vite.config.ts --host 127.0.0.1 --strictPort
```

Keep these terminals open. If services already run, inspect their listeners instead of starting duplicates. `npm run dev` exists, but separate terminals provide explicit dashboard binding and simple shutdown for this demonstration.

## B. Health gate

```bash
docker compose exec -T postgres pg_isready -U compliance -d compliance
docker compose port postgres 5432
curl --fail --silent --show-error http://127.0.0.1:8787/health
curl --fail --silent --show-error http://127.0.0.1:8787/ready
curl --fail --silent --show-error --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:5173/
lsof -nP -iTCP:8787 -iTCP:5173 -sTCP:LISTEN
git check-ignore -v .env
git ls-files -- .env
```

Require PostgreSQL accepting connections, published `127.0.0.1:5432`, health `ok:true`, readiness `ready:true` with `postgresql-normalized-scans+runtime-state`, dashboard HTTP 200, and API/dashboard listeners only on `127.0.0.1`. No `0.0.0.0`, wildcard, or `::` application listener. `git ls-files -- .env` must print nothing. Stop if these checks fail.

## C. Predictable demo setup

Prefer a new project named `Compliance Demo YYYY-MM-DD session-N` for each presentation in the existing **Acme Pilot** organization. Use a unique session suffix, within existing project entitlement limits. This preserves previous evidence without resetting PostgreSQL. If the project limit is reached, reuse a known demo project and explain that history accumulates; do not bypass the limit or delete records.

For a fresh database, list organizations through the existing development identity:

```bash
curl --fail --silent --show-error -H 'x-user-id: user_owner' http://127.0.0.1:8787/api/organizations
```

Only if Acme Pilot does not exist, create it through the supported API:

```bash
curl --fail --silent --show-error -X POST http://127.0.0.1:8787/api/organizations \
  -H 'x-user-id: user_owner' -H 'content-type: application/json' \
  --data '{"name":"Acme Pilot"}'
```

Reload the dashboard at `http://127.0.0.1:5173`, select **Acme Pilot**, then **Projects → Add project**. Enter the unique project name and repository name `synthetic/vulnerable-app`; repository URL is optional. Create the project before sharing your screen. Save its one-time token only in the scan terminal environment; close the token notice before presenting. The organization selector governs creation/export; dashboard metrics/listings can include all projects accessible to this demo user. Use the unique project name to distinguish this presentation and never present aggregate counts as project-specific.

Use this prompt-based setup in the scan terminal (zsh), without placing the token in shell history:

```bash
export COMPLIANCE_API_URL=http://127.0.0.1:8787
curl --fail --silent --show-error -H 'x-user-id: user_owner' "$COMPLIANCE_API_URL/api/projects"
read 'COMPLIANCE_PROJECT_ID?Project ID from the project list: '
export COMPLIANCE_PROJECT_ID
read -s 'COMPLIANCE_API_TOKEN?One-time project token (hidden): '
printf '\n'
export COMPLIANCE_API_TOKEN
```

If the token is lost, use the existing Projects token controls to revoke/rotate it deliberately, then capture the new token privately. Do not copy another project's token or change authorization code.

Before each presentation inspect `git diff -- examples/vulnerable-app/application.properties`. The only expected previous demo edit is `debug=true` → `debug=false`. Only after confirming there are no other edits to that file, restore that fixture alone:

```bash
git restore --source=HEAD --worktree -- examples/vulnerable-app/application.properties
```

Never use a broad restore/reset/clean. Verify line 3 is `debug=true`. Keep `compliance.config.json` unchanged (high threshold, no disabled rules). Record this project's existing scan/finding counts from the API if reusing it; a new project should start with zero.

## D. Initial real scan

Here “baseline” means the first presentation scan, not the CLI's baseline-suppression feature. Do not pass `--baseline`, suppress rules, or alter policy for this flow.

```bash
node dist/apps/cli/src/index.js examples/vulnerable-app --format console --fail-on high --upload
```

Validated initial result: two files, 64 reported rule executions, 12 findings (2 critical, 7 high, 3 medium), scanner `FAILED` / exit 1. Exit 1 is expected enforcement, not an upload failure. Exit 2 or an upload-error message means stop and diagnose. Do not chain the command with `&&` to required presentation steps because the expected exit 1 prevents the next command.

Reload the dashboard after each upload; do not assume live polling. Open **Scans** and identify the project/timestamp. Use **Findings** to open the corresponding records.

## E. Three findings to explain

| Finding | Existing evidence/location | Remediation and mapping | Customer relevance |
| --- | --- | --- | --- |
| SEC-006, HIGH: hardcoded password assignment | `app.ts:4`; `const password=[REDACTED];` | Environment injection or managed secret store. NIST-CSF-2.0 `PR.AA`, related. | A developer gets an actionable location while the secret value stays redacted. |
| LOG-002, HIGH: token/API key logged | `app.ts:13`; logging expression `logger.info(apiKey);` | Remove tokens from logs and rotate exposed credentials. NIST-CSF-2.0 `PR.DS`, related. | Helps prevent sensitive values spreading into logs and support tooling. |
| CFG-003, MEDIUM: debug mode enabled | `application.properties:3`; `debug=true` | Disable debug mode in production. NIST-CSF-2.0 `PR.PS`, related. | A small configuration correction provides a clear detected → fixed → verified story. |

These registry rules are BETA and have HIGH detector confidence. Severity describes potential impact; confidence is separate. Mappings identify related technical outcomes, not proof of framework implementation or certification. The fixture uses fake values; never substitute a real secret to make the demo convincing.

## F. Presenter script and walkthrough (15 minutes)

**0–2 minutes — problem and positioning.** “Teams often gather technical evidence after a change has shipped. We bring these checks into the engineering workflow, with a concrete file location and a correction the developer can review.” Use the positioning sentence above. Ask which evidence is hardest for this customer to produce.

**2–4 minutes — project and development workflow.** Show the project and the synthetic fixture in the editor. Briefly show `.github/workflows/compliance.yml`: it demonstrates the existing PR/CI integration. “Today we run the same CLI locally against fake code. We are not opening a live pull request or connecting your source.” Explain that the dashboard is reading persisted API data.

**4–7 minutes — real scan.** Run the initial CLI command. “The scanner runs locally; the upload contains redacted findings and metadata rather than complete source files.” Show the result, reload the dashboard, and open the new scan. Explain why high-severity findings produce a blocking exit code.

**7–10 minutes — findings and evidence.** Open SEC-006, then LOG-002 briefly. Show location, redacted evidence, severity, remediation, and mapping. “This is a technical signal for review. The mapping helps your team connect engineering evidence to a control discussion; it is not a certificate.” Open CFG-003 and record its finding ID/status from the API before the fix if needed.

**10–12 minutes — fix and verify.** In the editor change only `debug=true` to `debug=false` in `examples/vulnerable-app/application.properties`. Do not delete the line or alter other fixture content. Run the identical command against the entire directory:

```bash
node dist/apps/cli/src/index.js examples/vulnerable-app --format console --fail-on high --upload
```

Expected: two files, same 64 reported rule executions, 11 findings (2 critical, 7 high, 2 medium), zero new findings on the second scan, one resolution. Remaining high/critical findings still produce exit 1. Reload the dashboard, open Scans, then the debug finding: the original ID should be RESOLVED while other findings remain OPEN. Do not click Resolve manually. “The new scan no longer sees the issue. We retain the original evidence and both scans so you can review what happened.” No dedicated resolved-at timestamp is exposed; the scan timestamp and resolution count provide the observation context.

Both runs MUST use the same full fixture, flags, rule selection, and project. Never scan only the edited file or switch to `clean-app`. Precise partial-scan scope is not modeled; absence from a narrower scan is not safe evidence of resolution. `docs/PILOT.md` documents this limitation.

**12–14 minutes — persistent evidence/export (AI optional).** Open Reports, confirm the selected organization, and use **Export report** for the existing organization JSON export. Its implemented endpoint is `/api/organizations/:id/export`. It includes organization-wide persisted evidence, not just the selected presentation project. Open the downloaded JSON locally; show the matching project/scan/finding records. Export audit log (CSV) is also available. “This is evidence you can review and carry into your process, not an attestation.” If the export fails, show the actual error and use the recovery section; never claim a download succeeded. These controls are connected in source and covered by existing export tests; rehearse the actual download before a customer call.

Optional AI segment, only if pre-rehearsed: use a SEPARATE project bound to `examples/ai-vulnerable-app`, with that project's ID/token in a separate terminal. Run:

```bash
node dist/apps/cli/src/index.js examples/ai-vulnerable-app --format console --fail-on high --upload
```

This scans the fictional OpenAI import; do not execute the fixture program or install/call an AI provider. Reload AI Inventory and show observed provider/file/discovery method. Never upload this different scope to the main lifecycle project. “We discover technical AI usage. Declarations in `ai-governance.yml` remain manual; automatic declared-versus-discovered drift alerts are not implemented. Inventory is historical: removing code leaves an older lastDetected record; retirement is a human decision.” Omit this segment if there is no verified inventory result; export evidence is sufficient for the main demo.

**14–15 minutes — pilot discussion.** “For a controlled pilot, which repository and which review would make this useful first? We would agree on the findings to review and the evidence you need before deciding what should block delivery.” Select two discovery questions below and agree on an engineering owner and follow-up.

## G. Discovery questions

1. Which compliance review currently requires engineers to find source/configuration evidence manually, and how long does it take?
2. Who owns correcting a technical finding: repository maintainers, security, or a compliance team? Where does that handoff stall?
3. What would an auditor or internal reviewer need alongside a scan finding to accept it as useful technical evidence?
4. Which recurring false positives cause developers to ignore your current scanning tools?
5. Which severity/confidence combination could block a PR, and who must be able to approve an exception?
6. Which framework/control discussions are active for this particular system, and which are irrelevant?
7. Where is AI SDK usage reviewed today, and who owns declared-versus-discovered inventory discrepancies?
8. Must scanning and evidence storage stay inside your network? What authentication and retention requirements would gate a pilot?
9. Which CI provider and repository permission model would a pilot need to fit?
10. Which existing issue/evidence system would need the finding output before anyone changes their workflow?
11. Who evaluates a pilot's engineering value, who approves security access, and who owns budget for continued use?
12. What measurable result after two to four weeks would justify expanding beyond one repository?

## H. Failure recovery

Never manually insert rows into PostgreSQL to fake success. Never substitute fake JSON for a failed scanner upload. Stop at the failed step, record the exact command/error, and diagnose before changing code.

| Symptom | Safe first checks and response |
| --- | --- |
| PostgreSQL unavailable | Check Docker Desktop, `docker compose ps postgres`, `docker compose logs --tail=50 postgres`, then `docker compose up -d postgres` and `pg_isready`. Never delete the volume. |
| API unhealthy | Read its terminal error; verify `.env` locally, database readiness and migration status. `/ready` must identify PostgreSQL. Restart only the API terminal. Do not fall back to JSON. |
| Dashboard unavailable | Check its Vite terminal and the 5173 listener. Use the explicit localhost command above; `--strictPort` prevents silently moving to another port. Check API health and `/api` proxy errors. |
| Scanner upload fails | Read the CLI error; verify API URL and matching project ID/token without printing the token. Use existing token rotation privately if lost/revoked. Do not fabricate a success response. |
| No findings appear | Confirm exact fixture path, `debug=true` initial state, unchanged configuration, project name, and scan timestamp. Reload the browser. Do not use a suppression baseline for this demo. Review API project/scans/findings readback. |
| Debug finding stays OPEN | Verify `debug=false`, the same full directory and project, same rules, and successful ingestion. Check new scan links/resolution count and original finding ID. Stop; do not manually resolve or change lifecycle logic. |
| Project quota blocks creation | Use a known synthetic project with clearly explained history, or defer setup. Do not bypass entitlements or remove tenant records. |

The validated local identity for API readback is `x-user-id: user_owner`. Existing reads include `/api/projects`, `/api/projects/:id`, `/api/scans`, `/api/findings`, and `/api/findings/:id`. The scans endpoint returns history; locate the matching scan ID in it.

## I. Cleanup without data loss

Stop API and Vite with Ctrl-C in their dedicated terminals. Stop PostgreSQL, retaining its named volume:

```bash
docker compose stop postgres
unset COMPLIANCE_API_TOKEN COMPLIANCE_PROJECT_ID COMPLIANCE_API_URL
```

Do not run `docker compose down -v`, database truncation, or broad process kills. Keep `.env`, migrations, and demo evidence. Review the fixture-only diff and, if it is exactly the demonstrated debug toggle, restore only that file with the command in section C. Do not immediately rescan the old project after restoring: the reintroduced violation correctly reopens its resolved finding. Start the next presentation with a new project or explicitly describe that recurrence.

Exports are local synthetic artifacts; keep them out of Git. Verify `git status` before proposing any documentation commit. No helper startup script is needed for this runbook; none is created.

## Verification basis and limits

Commands/paths were checked against package scripts, CLI parsing, Vite configuration, Compose, API handlers, and the actual rule registry. The same core fixture scan and full comparable debug remediation were previously validated against PostgreSQL and the real browser, including restart persistence. Final branch checks passed build/typecheck and 119 tests (11 database-dependent tests skipped to avoid destructive setup against demo data). This documentation task does not rerun those mutations. Optional AI and customer export download steps must be rehearsed before inclusion; they are not represented as browser-verified by this documentation-only update.
