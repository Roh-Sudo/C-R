# Analytics Privacy

Pilot analytics collect scan metadata, rule IDs, severity, confidence, timings, finding status, review classification, and AI component metadata. They do not collect source code, raw secrets, complete credentials, prompts, responses, or unredacted sensitive data.

Metrics are workflow and product-quality measurements, not employee performance rankings. Precision uses only findings explicitly classified as true positives or false positives; unreviewed findings are excluded.

## Commercial and product-adoption analytics

Phase 9 adds commercial events (`ORGANIZATION_CREATED`, `PROJECT_CREATED`, `REPOSITORY_CONNECTED`, `FIRST_SCAN_COMPLETED`, `FIRST_FINDING_DETECTED`, `FIRST_FINDING_RESOLVED`, `AI_SYSTEM_DISCOVERED`, `SHADOW_AI_DETECTED`, `PILOT_STARTED`, `PILOT_COMPLETED`, `TRIAL_STARTED`, `SUBSCRIPTION_STARTED`) and usage metering (`repositoriesConnected`, `activeRepositories`, `scansCompleted`, `prScans`, `filesScanned`, `aiSystemsTracked`, `members`, `apiRequests`).

These records contain only: an event type, an organization identifier, a timestamp, and small numeric/string metadata (for example a plan ID or a count). They never contain:

- source code or file contents
- raw secrets, credentials, or evidence strings
- complete AI prompts or model responses
- customer sensitive records (SSNs, payment data, etc.)

Usage metering never inspects scanned content; it only counts events that already crossed the API boundary as structured metadata (see [DATA-FLOW.md](DATA-FLOW.md)). Billing audit events (`TRIAL_STARTED`, `TRIAL_EXPIRED`, `SUBSCRIPTION_STARTED`, `PLAN_CHANGED`, `SUBSCRIPTION_CANCELLED`) never store payment card data or raw payment-provider webhook payloads - only plan IDs and organization identifiers.

Time-to-first-value and activation metrics (`docs/DEMO.md`-adjacent internal dashboards) are computed only from timestamps already present in the store; percentile statistics (P50/P95) are withheld when the sample size is below 5 records to avoid misleading conclusions from tiny samples.

The internal admin commercial dashboard (`GET /api/admin/commercial`) exposes only aggregate counts across organizations (trial counts, activation counts, scan volume, plan distribution) and is never accessible using a tenant `OWNER`/`ADMIN` role - it requires a separate system administrator token.
