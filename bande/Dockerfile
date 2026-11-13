# Build the Vue frontend
FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js ./
COPY web ./web
RUN npm run build

# Run the server
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY --from=web /app/dist ./dist

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", "server/server.js"]
