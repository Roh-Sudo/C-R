# Dashboard UI/API Integration Audit

| UI location | Action | Current behavior | Required API endpoint | Integration status |
| --- | --- | --- | --- | --- |
| Sidebar | Dashboard, Projects, Scans, Findings, AI Inventory, Reports navigation | Changes the client view only | None | NOT_REQUIRED_FOR_MVP |
| Sidebar | Organization selector | Selects an authenticated organization for export | `GET /api/organizations` | CONNECTED |
| Dashboard and Projects | Add project and form submission | Creates after backend `201`, reloads project state, exposes one-time token | `POST /api/projects`, `GET /api/projects` | CONNECTED |
| Projects | Revoke or rotate scanner token | Persists action then reloads; rotation displays token once | `POST /api/projects/:id/revoke-token`, `POST /api/projects/:id/rotate-token` | CONNECTED |
| Scans | Scan history | Lists CLI/CI uploads; no fake run-scan control | `GET /api/scans` | CONNECTED |
| Findings | List and detail | Lists tenant findings and retrieves selected full detail | `GET /api/findings`, `GET /api/findings/:id` | CONNECTED |
| Findings | Resolve, Reopen, Suppress, Accept risk | Persists status then reloads; risk/suppression require reason | `PATCH /api/findings/:id` | CONNECTED |
| AI Inventory | Discovered components list | Lists scanner-discovered components | `GET /api/ai-components` | CONNECTED |
| Reports | Export report | Downloads the real tenant-scoped server export | `GET /api/organizations/:id/export` | CONNECTED |
| Removed prior controls | Rules, Frameworks, Settings, Register system, pricing/billing controls | No pilot-critical route or not a complete workflow | No applicable endpoint | NOT_REQUIRED_FOR_MVP |

## Network Verification

Representative requests: `GET /api/projects` (`200`), `POST /api/projects` (`201`), `GET /api/scans` (`200`), `GET /api/findings/:id` (`200`), `PATCH /api/findings/:id` (`200`), and `GET /api/organizations/:id/export` (`200`). Do not log scanner tokens.

Policies are `MISSING_API`: there is no policy read/update route in the existing API, so the dashboard has no editor or false persistence state.