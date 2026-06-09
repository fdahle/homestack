# MapMarker

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

The app listens on port **3082**. Point your reverse proxy at `localhost:3082`.

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name your-domain.example;

    location / {
        proxy_pass http://localhost:3082;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Data persistence

The SQLite database is stored in `./data/mapper.db` (mounted as a Docker volume). Back it up by copying that file.

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

---

## License

Do whatever you want with it.
