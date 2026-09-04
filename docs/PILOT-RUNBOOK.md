# Pilot Runbook

## Before pilot

Confirm a fictional or approved organization, 1–3 repositories, owner/admin participants, `CORS_ORIGIN`, API token handling, backup ownership, and retention expectations.

## Kickoff and setup

Run `npm install`, `npm run build`, `npm run demo:seed`, start the API and dashboard, create a project token, and run a baseline scan. Explain that results are technical findings for review.

## Weekly review

Review scans, new/high/critical findings, false-positive classifications, AI inventory, Shadow AI signals, remediation time, evidence coverage, scanner failures, and developer feedback. Tune declarative policy only with an audit record.

## Closeout

Export findings, evidence metadata, AI inventory, audit events, and pilot metrics. Complete the exit survey, record feature requests, review limitations, and request deletion only after confirming retention obligations. Generate the JSON or HTML report from `/api/pilots/:id/report`.
