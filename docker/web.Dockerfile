# syntax=docker/dockerfile:1
# Static build for the Compliance-as-Code dashboard. Build context is the repo root:
# docker build -f docker/web.Dockerfile -t compliance-web .

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
RUN npm install
COPY tsconfig.json ./
COPY apps/web ./apps/web
RUN npx vite build --config apps/web/vite.config.ts

# nginx-unprivileged listens on 8080 as a non-root user by default.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/ >/dev/null || exit 1
