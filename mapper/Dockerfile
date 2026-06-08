# ── Stage 1: build the Vue client ────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

COPY client/package*.json ./client/
RUN npm ci --prefix client

COPY client/ ./client/
RUN npm run --prefix client build

# ── Stage 2: run the API (which serves the built client) ─────────────────────
FROM node:22-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY api/package*.json ./api/
RUN npm ci --prefix api --omit=dev

COPY api/ ./api/
COPY --from=builder /build/client/dist ./client/dist

RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "--no-warnings", "api/index.js"]
