# syntax=docker/dockerfile:1
# Multi-stage build for the Compliance-as-Code API. Build context is the repo root
# (a workspaces monorepo), e.g.: docker build -f docker/api.Dockerfile -t compliance-api .

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/cli/package.json apps/cli/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/compliance-core/package.json packages/compliance-core/package.json
COPY packages/pilot-core/package.json packages/pilot-core/package.json
COPY packages/billing-core/package.json packages/billing-core/package.json
RUN npm install
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S compliance && adduser -S compliance -G compliance
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
USER compliance
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/apps/api/src/index.js"]
