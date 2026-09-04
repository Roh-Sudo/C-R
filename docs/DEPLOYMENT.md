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
