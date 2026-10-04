# Mapper

A personal map bookmarking app. Save places, organise them into categories and collections, plan trips, and share views with others via share links.

Built for my own use — but feel free to use it, fork it, or adapt it however you like.

---

## Features

- Add markers to a map with labels, descriptions, photos, ratings, and more
- Organise markers into **categories** (by type) and **collections** (by trip or theme)
- **Trip mode** — order stops, draw routes via OSRM or OpenRouteService
- **Persons** — associate places with people and store their addresses
- **Share links** — share a filtered view (read-only) with optional password and expiry
- Import from Google Maps CSV exports or generic JSON; export/backup to JSON
- Single-user, self-hosted, no external accounts required

## Tech stack

- **Backend:** Node.js 22, Express, SQLite (built-in `node:sqlite`)
- **Frontend:** Vue 3, Pinia, Leaflet
- **Auth:** bcrypt + JWT in HttpOnly cookies
- **Build:** Vite (client), Docker (deployment)

---

## Self-hosting

### Requirements

- Docker + Docker Compose
- A reverse proxy handling HTTPS (nginx, Caddy, etc.)

### Setup

```bash
git clone https://github.com/your-username/mapMarker.git
cd mapMarker

# Generate a strong secret
echo "SESSION_SECRET=$(openssl rand -base64 32)" > .env

# Build and start
docker compose up -d
```

The app listens on port **3063**, bound to `127.0.0.1` so it is only reachable through the reverse proxy on the same host. Point your reverse proxy at `localhost:3063`.

If your proxy runs elsewhere (another host or container), set `BIND_ADDRESS` in `.env` and make sure `TRUST_PROXY` matches the number of proxies in front of the app. Never expose the port directly while `TRUST_PROXY` is set: clients could then fake their IP address and bypass the sign-in rate limit.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example;

    location / {
        proxy_pass http://localhost:3063;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # The app does not compress responses itself.
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
```

### Data persistence

The SQLite database is stored in `./data/mapper.db` (mounted as a Docker volume). For a live backup, use Settings → Backup. JSON backups include markers, categories, collections, persons, and trip routes; they exclude the account, share links, and browser preferences. Restoring revokes existing share links.

For a complete database backup including the account and share links, stop the app (`docker compose stop`), copy the entire `data` directory (including any SQLite WAL files), then restart it (`docker compose start`). Do not copy just the main database file while the app is writing to it.

### Forgotten password

```bash
docker compose exec app node api/reset-password.js
```

This removes the account (markers and all other data stay). Open the app right away and set a new password; until then, anyone who can reach the app could claim it.

### Updates

```bash
git pull
docker compose up -d --build
```

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Random string ≥ 32 characters, used to sign JWT tokens |
| `PORT` | No | API port inside the container (default: `3000`) |
| `NODE_ENV` | No | Set to `production` in production (enables Secure cookie flag) |
| `BIND_ADDRESS` | No | Host address docker-compose publishes port 3063 on (default: `127.0.0.1`) |
| `TRUST_PROXY` | No | Number of reverse proxies in front of the app, or `false` when there is none (default: `1`) |

---

## License

Do whatever you want with it.

## Development checks

Use Node.js 22.13+ or 24+. Install dependencies with `npm ci`, `npm ci --prefix api`, and `npm ci --prefix client`. Run `npm run check` for linting, regression tests, a production build and an isolated HTTP smoke test. Tests use an in-memory database and never open `data/mapper.db`.

Stop the app before running `npm run reset`; this deletes the local database. Database upgrades run transactionally and are recorded in `schema_migrations`. Existing sessions are invalidated once on this upgrade and whenever the password is changed or reset.

Shared maps include the selected markers and all their associated category/collection/person names. Person address references are excluded. Treat marker descriptions and images as public to anyone holding the link.
