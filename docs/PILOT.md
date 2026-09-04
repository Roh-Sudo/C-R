# Pilot Setup

## Suggested pilot

Run a 2–4 week pilot with 1–3 repositories, an engineering lead, a security/compliance representative, and participating developers.

```bash
npm install
npm run build
npm run seed
npm run api
npx vite --config apps/web/vite.config.ts
```

Open `http://localhost:5173`. The local demo uses fictional Acme Financial Demo data and stores records in `.data/platform.json`. A PostgreSQL container is available with `docker compose up -d`, but this MVP's API adapter is still the local file adapter.

## Workflow

1. Create or select an organization and project.
2. Generate a project token once and store it in a secret manager.
3. Run `compliance-check . --format sarif --fail-on high` locally.
4. Configure CI with `COMPLIANCE_API_URL`, `COMPLIANCE_PROJECT_ID`, and `COMPLIANCE_API_TOKEN`.
5. Add `--upload` to submit only redacted finding metadata and safe GitHub metadata.
6. Review findings, suppressions, accepted risks, and AI inventory with an owner.

## Success metrics

- Repositories and pull requests scanned
- New risks caught before merge
- False-positive rate
- Median time to remediation
- Shadow AI components discovered and registered
- Controls receiving technical evidence
- Developer feedback and adoption

Do not use this pilot to make legal compliance or AI system classification claims. Findings and mappings require qualified review.
