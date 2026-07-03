# --- Stage 1: build the Vue SPA ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: serve the built assets with nginx ---
# nginx.conf is bind-mounted by docker-compose, so it isn't copied here.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
