# Incident Response

## Severity levels

- **SEV-1 (critical):** service-wide outage, confirmed or strongly suspected data breach/secret leakage, or complete loss of a production data store without a validated backup.
- **SEV-2 (significant):** single-customer-impacting outage or security issue (e.g. one organization cannot access their data, a suspected credential compromise scoped to one integration), degraded performance affecting scan ingestion or dashboard availability.
- **SEV-3 (minor):** isolated bug affecting a non-critical workflow (e.g. a single finding misclassification, a missing GitHub check for one repository) with a workaround available.
- **SEV-4 (cosmetic/informational):** documentation gaps, minor UI issues, feature requests.

## Process

### Detection

- Automated: health/readiness check failures, elevated error rates, webhook processing failures, scan ingestion failures (see [docs/PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md) for current monitoring gaps - alerting hooks are provider-neutral interfaces today, not a configured live monitoring provider).
- Manual: customer report via the support channel, internal review of `GET /api/admin/commercial` trends.

### Containment

- SEV-1: consider taking the affected component out of rotation (e.g. pausing webhook processing, disabling a compromised integration) rather than a full shutdown when a partial mitigation is available.
- Rotate any credential implicated in a security incident immediately (see [docs/SUPPORT-RUNBOOK.md](SUPPORT-RUNBOOK.md#credential-compromise-procedure)); containment is not complete until rotation is confirmed.

### Investigation

- Use `GET /api/audit` / `GET /api/organizations/:id/audit/export` for the affected organization(s) and the structured request-ID-tagged server logs (never raw evidence/secrets, which are not logged - see [DATA-FLOW.md](DATA-FLOW.md)).
- Reproduce with synthetic data where possible (see the pilot-simulation and failure-simulation test suites) rather than operating directly on customer data during investigation.

### Communication

- SEV-1/SEV-2: notify affected organizations with known facts, current mitigation status, and a next-update time. Do not speculate about root cause or data-loss extent before it is confirmed.
- Do not make unsupported legal or regulatory notification promises (e.g. specific breach-notification law compliance) in customer communication - route those determinations to the organization's actual legal/compliance process.

### Recovery

- Restore from a validated backup only after containment is confirmed (see [docs/DISASTER-RECOVERY.md](DISASTER-RECOVERY.md)); never restore over a live database as the first recovery attempt - restore into an isolated instance and validate first.
- Re-enable any paused component only after the root cause is mitigated, not merely "the errors stopped."

### Postmortem

- Every SEV-1 and SEV-2 incident gets a written postmortem: timeline, root cause, impact (scope, duration, data involved), what worked, what did not, and concrete follow-up items with owners.
- Postmortems must not include complete secrets, tokens, or raw customer evidence, even internally - reference redacted identifiers (finding ID, request ID, organization ID) instead.
- Track follow-up items to closure; do not let a postmortem become a list of good intentions with no owner or deadline.
