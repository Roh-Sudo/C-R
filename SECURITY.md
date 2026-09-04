# Security

Security contact: `security@example.invalid` (placeholder; replace before public release).

Compliance-as-Code processes source locally in the scanner and uploads only redacted findings, AI component metadata, and safe repository/CI metadata when explicitly configured. API tokens are generated with `crypto.randomBytes`, displayed on creation, and stored as SHA-256 hashes. Tokens are project-scoped and never logged.

The API includes organization and role fields, centralized authorization helpers, request size limits, JSON-only responses, CORS origin configuration, `nosniff`, frame protection, request IDs, and webhook HMAC verification architecture. The dashboard does not render raw evidence.

The MVP does not claim a formal certification. Before production use, replace the local JSON adapter with PostgreSQL, add a maintained session/OIDC provider, secure cookies, TLS/HSTS, CSRF protections, rate limiting backed by shared storage, encrypted secrets, backups, and a complete independent penetration test.

Report suspected vulnerabilities privately through the security contact. Do not include real credentials, personal data, prompts, or source code in reports.
