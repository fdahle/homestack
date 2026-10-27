# Fernweh

A personal map bookmarking app. Save places, organise them into categories and collections, plan trips, and share views with others via share links.

Built for my own use — but feel free to use it, fork it, or adapt it however you like.

---

## Features

- Add markers to a map with labels, descriptions, photos, ratings, favorites, websites and more; move them by dragging
- **Wishlist** — give places a planned date; favorites and planned places get their own lists
- Organise markers into **categories** (by type) and **collections** (by trip or theme)
- **Trip mode** — order stops, draw walking/cycling/driving routes via OSRM or OpenRouteService, see distance and travel time, export as GPX
- **Persons** — associate places with people and store their addresses
- **Share links** — share a filtered view (read-only, including trip routes) with optional password and expiry
- Save places found on the map with their website and Wikipedia image
- **Add from Google Maps** — paste a place's "Share" link into the search bar (or, on Android, share it straight to the installed app); it opens at that spot with Google's name, matched to the OpenStreetMap place when there is one
- Search across names, notes, addresses and groups (accent-insensitive)
- **Trash** — deleted markers can be undone or restored for 30 days
- Import places from Google Maps (saved-list CSV, Takeout "Saved Places.json"), Google My Maps / Google Earth (KML, KMZ; folders can become collections or categories), GPX waypoints and GeoJSON, or from a Fernweh JSON export; export/backup to JSON or download the full database
- Installable on phones (PWA); "locate me"; sign out of all devices
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
- A reverse proxy handling HTTPS (nginx, Caddy, etc.). HTTPS is required: in production the sign-in cookie is `Secure` and the app sends HSTS and `upgrade-insecure-requests`, so over plain HTTP you cannot sign in and the page's assets fail to load.

### Setup

```bash
git clone https://github.com/your-username/mapMarker.git
cd mapMarker

# Generate a strong secret
echo "SESSION_SECRET=$(openssl rand -base64 32)" > .env

# The container runs as uid 1000 and needs to write the database here
mkdir -p data && sudo chown 1000:1000 data

# Build and start
docker compose up -d
```

Then open the app through your proxy and choose the password; the first visitor sets it. To set it from the shell instead (before exposing the app), run the password command from [Forgotten password](#forgotten-password).

If the log says `Cannot open the database`, the `data` directory is not writable by uid 1000 (Docker creates a missing one as root): run `sudo chown -R 1000:1000 data` and start again.

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

For a complete database backup including the account and share links, use Settings → Data → "Download the complete database" (a consistent snapshot taken while the app runs), or stop the app (`docker compose stop`) and copy the entire `data` directory (including any SQLite WAL files). Do not copy just the main database file while the app is writing to it. To restore a database file, stop the app, replace `data/mapper.db` (and delete any `mapper.db-wal`/`mapper.db-shm`), then start it again.

### Forgotten password

```bash
docker compose exec app node api/reset-password.js
```

It asks for a new password (typed input is hidden), stores it and signs out every device. Markers and all other data stay. To script it: `printf '%s
' 'new password' | docker compose exec -T app node api/reset-password.js`.

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
| `PORT` | No | Port the app listens on without Docker (default: `3063`; the container always uses 3000) |
| `NODE_ENV` | No | Set to `production` in production (Secure cookie, so HTTPS is required) |
| `BIND_ADDRESS` | No | Host address docker-compose publishes port 3063 on (default: `127.0.0.1`) |
| `TRUST_PROXY` | No | Number of reverse proxies in front of the app, `false` when there is none, or a list of proxy addresses such as `loopback, 10.0.0.0/8` (default: `false`; docker-compose sets `1`) |
| `MAPPER_DB_PATH` | No | SQLite file when running without Docker (default: `data/mapper.db`) |

Sessions last 30 days and are renewed while you use the app; "Sign out of all devices" and password changes end every session.

---

## License

Do whatever you want with it.

## Development checks

Use Node.js 22.13+ or 24+. Install dependencies with `npm ci`, `npm ci --prefix api`, and `npm ci --prefix client`. Run `npm run check` for linting, regression tests, a production build and an isolated HTTP smoke test. Tests use an in-memory database and never open `data/mapper.db`.

Stop the app before running `npm run reset`; this deletes the local database. Database upgrades run transactionally and are recorded in `schema_migrations`. Existing sessions are invalidated once on this upgrade and whenever the password is changed or reset.

Shared maps include the selected markers with their descriptions, images, addresses, links and visited dates, but not ratings, favorites or planned dates. Only the categories, collections and persons the link selects are shown (a link to all markers shows all categories and collections, but no persons); trip routes appear for shared trips only. Person address references are excluded. Treat everything shown as public to anyone holding the link.
