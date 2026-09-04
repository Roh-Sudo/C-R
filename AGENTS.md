# Compliance-as-Code Agent Guide

## Architecture

The CLI in `apps/cli` parses arguments and delegates to `packages/compliance-core`. The core owns typed models, recursive file collection, rule registration, scanning, redaction, and reporters. Keep detection logic in rules and presentation logic in reporters/CLI.

## Commands

- `npm install` installs workspace dependencies.
- `npm run build` compiles TypeScript to `dist`.
- `npm test` runs Vitest.
- `npm run lint` runs the strict TypeScript check without emitting files.
- `npm run compliance:scan:vulnerable` scans the fake vulnerable fixture.

## Rule conventions

Use IDs such as `PII-001`, `SEC-001`, `LOG-001`, and `CFG-001`. Every rule must provide a title, plain technical description, category, severity, confidence, remediation, and defensible NIST mapping where applicable. Findings are potential risks for review, never proof of a regulatory violation.

## Security constraints

The scanner runs locally, sends no source or telemetry anywhere, and must never print or serialize complete secrets. Add tests for true positives, likely false positives, and evidence redaction for every secret-related rule. Demo values must be fake.

## Coding conventions

Use strict TypeScript, small deterministic functions, existing Node APIs, and focused Vitest tests. Avoid external APIs and vague AI-generated findings. Update README documentation when adding a rule or user-facing option.