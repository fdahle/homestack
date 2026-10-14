# ── Stage 1: build the Vue client ────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

COPY client/package*.json ./client/
RUN npm ci --prefix client

COPY client/ ./client/
COPY shared/ ./shared/
RUN npm run --prefix client build

# ── Stage 2: run the API (which serves the built client) ─────────────────────
FROM node:22-alpine AS runner

ENV NODE_ENV=production

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
# Alpine images have no curl; Node's http module does the job.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
CMD ["node", "--no-warnings", "api/index.js"]
