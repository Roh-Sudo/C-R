# Support Runbook

Practical responses for the most common first-customer support scenarios. Each includes a suggested escalation severity (see [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) for the full severity model: `SEV-1` critical/customer-wide, `SEV-2` significant/single-customer, `SEV-3` minor, `SEV-4` cosmetic/informational).

## "My scan failed"

**Severity:** SEV-3 (SEV-2 if it blocks a release).

1. Check the CI job log for the CLI's own error output (`compliance-check` exits with code `2` on a scanner error, not `1` which means findings exceeded the threshold).
2. Confirm the project token is valid and not revoked (`tokenRevokedAt` unset) - a `401` from `POST /api/scans` means an invalid/revoked/mismatched token.
3. Confirm the payload is within limits: 10,000 findings and 20 KB evidence per finding, 5 MB total body - a `413` means a limit was exceeded; this does not lose the local scan output, only the upload step.
4. If the API itself was unreachable, confirm the organization's fail-open/fail-closed policy for that project's enforcement mode (see [PILOT.md](PILOT.md#fail-open-vs-fail-closed-ci-behavior)).

## "A finding seems wrong"

**Severity:** SEV-4 (SEV-3 if it is blocking a release the customer disagrees with).

1. Confirm the rule ID and read its `remediation`/`frameworks` explanation (`GET /api/rules`).
2. Classify the finding via `POST /api/findings/:id/classification` (`FALSE_POSITIVE`/`NEEDS_REVIEW`) so pilot precision metrics reflect reality.
3. If it should not block CI going forward, suppress it with a reason (`PATCH /api/findings/:id`, `status: SUPPRESSED`) or add a `compliance-ignore` comment with a reviewed reason at the source line.
4. If the underlying rule has a systemic false-positive problem, file it against the rule per [docs/RULE-DEVELOPMENT.md](RULE-DEVELOPMENT.md); do not silently disable the rule for one customer without recording why.

## "The GitHub check is missing"

**Severity:** SEV-2.

1. Confirm the CI workflow actually ran (branch protection/required-check configuration issue is more common than a scanner bug).
2. Confirm `COMPLIANCE_API_URL`/`COMPLIANCE_PROJECT_ID`/`COMPLIANCE_API_TOKEN` are set as CI secrets, not plaintext in the workflow file.
3. Confirm the webhook secret (`GITHUB_WEBHOOK_SECRET`) matches on both sides if webhook-driven automation is in use; a signature mismatch is silently rejected with `401` and logged as such server-side (never logged with the actual payload/signature value).

## "The dashboard is missing a scan"

**Severity:** SEV-3.

1. Confirm the scan actually reached `POST /api/scans` successfully (check the CI job's HTTP response, not just its own exit code).
2. Confirm the person looking is a member of the correct organization - dashboards only ever show organization-scoped data (see [THREAT-MODEL.md](THREAT-MODEL.md)).
3. Confirm no rate limit (`429`) was hit during a burst of CI runs; rate limits are documented and configurable, not silent.

## "My token is invalid"

**Severity:** SEV-3.

1. Confirm the token was not revoked (rotation is a normal ownership-change event, not necessarily an incident).
2. Reissue a new project token; the old plaintext value can never be recovered by design (only its hash is stored).
3. If token compromise is suspected, follow the [Credential Compromise Procedure](#credential-compromise-procedure) below immediately - this is at least SEV-2.

## "I can't log in"

**Severity:** SEV-2.

Today, local/pilot deployments use a development-mode identity mechanism (`x-user-id`), not a production login flow; a customer-facing login issue implies a real OIDC/session provider is in use, which is a [documented production blocker](PRODUCTION-BLOCKERS.md) (B2) until resolved. Once resolved: confirm the identity provider's status page, confirm the customer's account exists and has at least one organization membership, and confirm no domain restriction (`isEmailDomainAllowed`) is unexpectedly blocking a legitimate email domain.

## "The service is unavailable"

**Severity:** SEV-1.

1. Check `/health` and `/ready`.
2. Follow [docs/INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) SEV-1 process immediately; do not wait for a customer report to start the runbook if internal monitoring already detected the outage.

## "I suspect a secret leaked"

**Severity:** SEV-1.

1. Do not attempt to "clean up" evidence yourself first - preserve it for investigation.
2. Confirm whether the value in question ever reached the API in complete form; the [canary secret regression test](../tests/canary-secret.test.ts) validates this cannot happen through the normal scan-upload path, so first determine whether the value bypassed that path (e.g. pasted directly into a comment/description field rather than detected from source).
3. Rotate the exposed credential immediately, regardless of where the investigation lands.
4. Follow the [Credential Compromise Procedure](#credential-compromise-procedure).

## Credential Compromise Procedure

1. **Rotate immediately:** `AUTH_SECRET`, database credentials, GitHub App credentials/private key, `GITHUB_WEBHOOK_SECRET`, billing webhook secret, and any affected project API tokens (revoke via setting `tokenRevokedAt`, then issue a new token - the old one can never be un-revoked or recovered).
2. **Invalidate sessions:** once real sessions exist (see B2 in [PRODUCTION-BLOCKERS.md](PRODUCTION-BLOCKERS.md)), force a global session invalidation for the affected identity provider realm.
3. **Audit:** review `GET /api/organizations/:id/audit/export` for the affected organization(s) around the suspected compromise window.
4. **Communicate:** notify affected organizations per [docs/INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) communication guidance - do not make unsupported legal notification promises; follow the organization's actual legal/compliance process for that determination.

## Customer Offboarding

Distinguish **cancelling a subscription** from **deleting an organization**:

1. Cancel the subscription (`POST /api/organizations/:id/billing/cancel`) - this stops future billing only; it never deletes data.
2. Disable integrations: revoke the GitHub webhook/App installation on the customer's side, revoke all project API tokens.
3. Offer a full data export (`GET /api/organizations/:id/export`, `GET /api/organizations/:id/audit/export`) before any deletion.
4. Retain or delete data per the organization's configured retention policy and the terms of the commercial agreement - never destroy data automatically as a side effect of cancellation.
