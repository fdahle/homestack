# ── Stage 1: build the Vue client ────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /build

COPY client/package*.json ./client/
RUN npm ci --prefix client

COPY client/ ./client/
COPY shared/ ./shared/
RUN npm run --prefix client build

# ── Stage 2: run the API (which serves the built client) ─────────────────────
FROM node:24-alpine AS runner

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY api/package*.json ./api/
RUN npm ci --prefix api --omit=dev

COPY api/ ./api/
COPY shared/ ./shared/
COPY --from=builder /build/client/dist ./client/dist

# A bind-mounted ./data must be writable by this user (uid 1000); see README.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
# Up is up: /api/health answers without a login (and through AUTH_PROXY_SECRET too) and says nothing else
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--no-warnings", "api/index.js"]
