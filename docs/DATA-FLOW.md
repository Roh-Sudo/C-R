# Data Flow

This document traces data from a developer's repository through the system to the dashboard, and identifies the trust boundaries the data crosses.

```mermaid
flowchart LR
  A[Developer repository<br/>source files] -->|local filesystem read only| B[Local scanner<br/>packages/compliance-core]
  B -->|redact() / redactEvidence()<br/>before any Finding is created| C[Redaction]
  C --> D[Finding / ScanResult metadata<br/>no source, no raw secrets]
  D -->|--upload flag only, Bearer project token, TLS in production| E[API<br/>apps/api]
  E -->|organization-scoped writes| F[(Data store<br/>local JSON today / Postgres in production)]
  F --> E
  E -->|x-user-id dev auth today / OIDC session in production| G[Dashboard<br/>apps/web]
  E -->|HMAC-verified webhook| H[GitHub webhook]
  E -->|HMAC-verified webhook, local/test provider| I[Billing provider]
```

## Stages and trust boundaries

### 1. Developer repository -> Local scanner (trust boundary: none - stays on the same machine)

The CLI (`apps/cli`) and `scanDirectory()` in `packages/compliance-core` read files from the local filesystem or CI runner. No network call happens at this stage. This is the only stage that ever sees complete source file contents.

### 2. Local scanner -> Redaction (trust boundary: none - still local, but this is where sensitive content is destroyed)

Before a `Finding` object is constructed, `redact()` and `redactEvidence()` mask credential-shaped and PII-shaped substrings. This happens inside the scanner process, before any data is serialized for transport. Evidence that is not redacted (an evidence string not matching a redaction pattern) is still capped in length and is a single matched line, not a file.

### 3. Redaction -> Finding/ScanResult metadata (trust boundary: none - still an in-memory local object)

The `ScanResult` produced locally contains: redacted findings, AI component inventory entries, severity counts, and scan metadata (duration, files scanned, scanner version). It never contains raw file contents.

### 4. Finding metadata -> API (trust boundary: developer machine/CI runner -> network -> compliance platform)

This is the primary trust boundary. Data only crosses it when the CLI is invoked with `--upload`, authenticated with a per-project Bearer token (SHA-256 hash comparison; see [SECURITY-QUESTIONNAIRE.md](SECURITY-QUESTIONNAIRE.md)). In production this connection must be TLS-terminated. The API enforces request size limits (5 MB body, 10,000 findings, 20 KB evidence per finding) to bound the blast radius of a misbehaving or malicious client.

### 5. API -> Data store (trust boundary: application code -> persistence layer)

Every write is tagged with an `organizationId` derived from server-side membership lookups, never from client-supplied trust. The reference implementation persists to a local JSON file (`.data/platform.json`) for local development and pilots; production deployment requires an encrypted database with equivalent tenant scoping (see [docs/DEPLOYMENT.md](DEPLOYMENT.md)).

### 6. API -> Dashboard (trust boundary: compliance platform -> browser)

The dashboard (`apps/web`) reads data through the same organization-scoped API endpoints a human or CI client would use. Today, authentication is a development-mode `x-user-id` header; production deployment requires a real session/OIDC provider with secure, HTTP-only cookies and CSRF protection (tracked in [docs/SECURITY-REVIEW.md](SECURITY-REVIEW.md)).

### 7. GitHub webhook -> API (trust boundary: GitHub -> compliance platform)

Inbound GitHub webhooks are verified with HMAC-SHA256 (`verifySignature()`, constant-time comparison) before any data is trusted or persisted; unsigned or incorrectly signed payloads are rejected with `401`.

### 8. Billing provider webhook -> API (trust boundary: billing provider -> compliance platform)

Billing state changes (checkout completion, plan change, cancellation) only apply after the `BillingProvider.processWebhook()` implementation verifies a signature. The local/test provider (`LocalBillingProvider`) signs with an HMAC secret; a production payment provider integration must use that provider's native signature verification. Duplicate event IDs are tracked (`store.processedWebhookEventIds`) so a replayed webhook is a no-op. The server never trusts a client-supplied subscription/plan value directly - only values derived from a verified webhook event or an authorized organization role change (`OWNER`/`ADMIN`) are applied.

## What never crosses a boundary

- Complete source file contents (stops at stage 1).
- Raw secret/credential values (destroyed at stage 2).
- Complete AI prompts or model responses.
- Payment card data (the reference billing provider never collects it; see [SECURITY-QUESTIONNAIRE.md](SECURITY-QUESTIONNAIRE.md)).
