# Deployment

For local development:

```bash
docker compose up -d
npm install
npm run build
npm run seed
npm run api
npx vite --config apps/web/vite.config.ts
```

The dashboard is served at `http://localhost:5173`; the API is at `http://localhost:8787`.

For production, deploy web and API as separate processes, put both behind TLS, configure `CORS_ORIGIN` to the exact web origin, set `AUTH_SECRET`, webhook secrets, and GitHub App credentials through the hosting secret manager, and add PostgreSQL with migrations, indexes, encrypted backups, and connection pooling. Run the API behind a reverse proxy with HSTS, access logs that exclude authorization data, health checks at `/health` and `/ready`, and a process supervisor.

The current implementation deliberately uses a local JSON adapter for a zero-setup pilot demo. Do not expose that adapter to multiple replicas or internet traffic until replaced by PostgreSQL and a maintained OIDC/session provider.

## Minimal production architecture

```text
Internet
  |
TLS / Reverse proxy / platform edge
  |
Web application (static build, docker/web.Dockerfile)
  |
API (Node process, docker/api.Dockerfile)
  |
PostgreSQL (db/migrations/, not yet wired into the API at runtime - see docs/PRODUCTION-BLOCKERS.md)

Optional: Worker / job processor (none exists today; not required at current scale)

Integrations: GitHub (webhook, HMAC-verified) · Billing provider (local/test today) · Authentication provider (not yet integrated)
```

Kubernetes is not required at this scale: a single API process, a single web static-file host, and a managed Postgres instance are sufficient for an initial pilot. Introduce an orchestrator only when real multi-instance scaling requirements exist.

## Deployment target abstraction

The product is not locked to one hosting provider. Requirements for any target:

- **Runtime:** Node.js 20+ (see `engines` in `package.json`).
- **CPU/memory:** modest for a pilot - a single vCPU / 512 MB instance comfortably runs the API process at pilot scale; scale up only after a real load test against production traffic.
- **Database:** PostgreSQL 16+ (matches `docker-compose.yml`'s `postgres:16-alpine`); not yet required at runtime, but provisioned ahead of B1's resolution.
- **Environment variables:** see `.env.example` and `apps/api/src/env.ts` for the full, validated list.
- **Persistent storage:** the Postgres data volume only; the API process itself is stateless once wired to Postgres (today it depends on a local file, which does not survive a container replacement - another reason B1 blocks true production readiness).
- **Network:** the API must be reachable by the web application's origin (`CORS_ORIGIN`) and by GitHub's webhook IP ranges if webhook delivery is used; the database should not be publicly reachable.
- **TLS:** required in production; `APP_URL` must be `https://` (enforced by `apps/api/src/env.ts`).

### Reference deployment (one practical example, not a requirement)

A small managed-container platform (e.g. a container-as-a-service provider) running the two images in `docker/`, backed by that provider's managed Postgres and a managed TLS-terminating load balancer, satisfies all of the above with minimal operational overhead for a first pilot. Any platform meeting the requirements above is equally valid.

## HTTPS

- Production must run behind TLS; `apps/api/src/env.ts` rejects a non-`https://` `APP_URL` in production.
- Cookies (once a real session mechanism exists) must be `Secure`, `HttpOnly`, and `SameSite=Lax` at minimum.
- Webhook endpoints (GitHub, billing) must be configured with `https://` URLs at the provider.
- Local development over `http://localhost` remains supported and is not required to use TLS.

