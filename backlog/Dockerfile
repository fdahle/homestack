FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
