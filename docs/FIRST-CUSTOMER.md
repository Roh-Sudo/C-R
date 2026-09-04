# First Customer Onboarding

This is the exact process for onboarding the first controlled-pilot customer. It assumes the environment has been configured per [docs/LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) and that known [production blockers](PRODUCTION-BLOCKERS.md) have been reviewed with the customer (a controlled pilot can proceed with synthetic/low-sensitivity data even while `HIGH`/`MEDIUM` items remain open; `BLOCKER` items must be explicitly acknowledged and scoped out, e.g. no real production database yet means pilot data lives in the documented local-adapter/staging environment, not a customer's regulated production system).

## Process

1. **Create the customer organization.** `POST /api/organizations` with the customer's chosen name, authenticated as the person who will be the initial `OWNER`.
2. **Assign an owner.** The creating user becomes `OWNER` automatically; add any additional owners via `POST /api/organizations/:id/members` with `role: "OWNER"`.
3. **Create a project.** `POST /api/projects` for the first repository. Store the returned token immediately in the customer's secret manager - it is shown exactly once.
4. **Connect the repository.** Configure the customer's CI (GitHub Actions or equivalent) with `COMPLIANCE_API_URL`, `COMPLIANCE_PROJECT_ID`, and `COMPLIANCE_API_TOKEN`.
5. **Configure policy.** Agree on the [starter enforcement policy](PILOT.md#starter-enforcement-policy) and set the project's `enforcementMode` (default `BLOCK`; use `WARN` or `MONITOR` if the customer wants a softer rollout).
6. **Run a baseline scan.** Follow [baseline-first deployment](PILOT.md#baseline-first-deployment-for-existing-repositories) so legacy findings do not immediately block CI.
7. **Review findings.** Walk through the baseline and any new findings with the customer's engineering lead and security/compliance representative.
8. **Tune obvious false positives.** Classify findings (`POST /api/findings/:id/classification`) and suppress reviewed non-issues with a documented reason.
9. **Enable PR checks.** Turn on the CI job for pull requests once the baseline is accepted, using the agreed `--fail-on` threshold.
10. **Start pilot measurement.** Create a `Pilot` record (`POST /api/pilots`) with goals and success criteria; review `/api/pilots/:id/metrics` and `/api/pilots/:id/report` on a regular cadence (see [docs/PILOT-RUNBOOK.md](PILOT-RUNBOOK.md)).

## Rollback / offboarding

If the pilot needs to pause or stop:

- **Disable enforcement without losing history:** set `enforcementMode` to `MONITOR` or `WARN` rather than deleting the project.
- **Revoke access:** revoke the project's upload token (sets `tokenRevokedAt`); this stops new scan ingestion without deleting existing findings/history.
- **Full offboarding:** see [Customer Offboarding](SUPPORT-RUNBOOK.md#customer-offboarding) - cancelling a subscription (`POST /api/organizations/:id/billing/cancel`) never deletes organization data; only an explicit, authorized data-deletion request does, and only after an export has been offered.
