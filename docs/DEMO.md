# Compliance-as-Code Demo

This 3–5 minute demo uses only fake data.

1. Build the scanner: `npm install && npm run build`.
2. Show the intentionally unsafe app: `examples/vulnerable-app/app.ts`.
3. Run `node dist/apps/cli/src/index.js examples/vulnerable-app --fail-on high`.
4. Point out critical/high findings, redacted evidence, remediation, and NIST mappings.
5. Run `node dist/apps/cli/src/index.js examples/vulnerable-app --format json --output /tmp/report.json` to show machine-readable output.
6. Add a suppression comment such as `// compliance-ignore SEC-006 reason: synthetic demo fixture` only when the finding is understood and owned.
7. Create a baseline with `--create-baseline compliance-baseline.json`, then rerun using `--baseline compliance-baseline.json` to show known findings no longer fail the build.
8. Compare `node dist/apps/cli/src/index.js examples/clean-app`; it passes.
9. Show `.github/workflows/compliance.yml` for pull request scanning and report artifacts.

The scanner detects technical risk signals. It does not certify compliance or replace professional review.

## AI Governance Demo (5–7 minutes)

1. Open `examples/ai-vulnerable-app/app.ts` and point out the fictional OpenAI integration.
2. Run `node dist/apps/cli/src/index.js examples/ai-vulnerable-app --format console --fail-on high`.
3. Show AI provider discovery, sensitive customer data passed to an AI call, prompt logging, and unsafe output execution.
4. Explain that evidence is redacted locally and mappings are informational, not legal classifications.
5. Upload the result with the demo project token and open **AI Inventory** in the dashboard.
6. Compare `examples/ai-clean-app`, which uses a governance registration marker, bounded input, and output validation.
7. Fix the vulnerable flow and rescan. The API fingerprint updates the existing finding rather than creating duplicates; a later passing scan can resolve it.

The EU AI Act view is intentionally framed as technical readiness. Static analysis cannot determine legal system classification, prohibited use, or conformity assessment.
