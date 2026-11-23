# Fernweh

A personal map bookmarking app. Save places, organise them into categories and collections, plan trips, and share views with others via share links.

Built for my own use — but feel free to use it, fork it, or adapt it however you like. Part of the homestack apps: it wears their look (the [design kit](../../kit/README.md)'s colours, type and icon style, in Fernweh's plum), can sign in through their shared Authelia login, and shows your friends from [Stammtisch](../stammtisch/) on the map.

---

## Features

- Add markers to a map with labels, descriptions, photos, ratings, favorites, websites and more; move them by dragging
- **Wishlist** — give places a planned date; favorites and planned places get their own lists
- Organise markers into **categories** (by type) and **collections** (by trip or theme)
- **Trip mode** — order stops, draw walking/cycling/driving routes via OSRM or OpenRouteService, see distance and travel time, export as GPX
- **Persons** — associate places with people and store their addresses
- **Friends from Stammtisch** — your friends and where they live, imported from [Stammtisch](#friends-from-stammtisch) and kept up to date
- **Share links** — share a filtered view (read-only, including trip routes) with optional password and expiry
- Save places found on the map with their website and Wikipedia image
- **Add from Google Maps** — paste a place's "Share" link into the search bar (or, on Android, share it straight to the installed app); it opens at that spot with Google's name, matched to the OpenStreetMap place when there is one
- Search across names, notes, addresses and groups (accent-insensitive)
- **Trash** — deleted markers can be undone or restored for 30 days
- Import places from Google Maps (saved-list CSV, Takeout "Saved Places.json"), Google My Maps / Google Earth (KML, KMZ; folders can become collections or categories), GPX waypoints and GeoJSON, or from a Fernweh JSON export; export/backup to JSON or download the full database
- Installable on phones (PWA); "locate me"; sign out of all devices; light and dark follow the system (or pick one in Settings → Appearance)
- Single-user, self-hosted, no external accounts required; optionally behind the homestack login (Authelia)

## Tech stack

- **Backend:** Node.js 24, Express 5, SQLite (built-in `node:sqlite`)
- **Frontend:** Vue 3, Pinia, Leaflet; colours and sizes from the homestack kit (`client/src/kit/tokens.css`, Fernweh's own in `client/src/theme.css`)
- **Auth:** bcrypt + JWT in HttpOnly cookies, or the homestack login proxy (`AUTH_PROXY_SECRET`)
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

Then open the app through your proxy and choose the password. The first visit also asks for a set-up code, so a stranger who finds the fresh instance first cannot claim it: the app prints it to its log on start (`docker compose logs app`, the line `Set-up code for the first visit: …`). It is kept in memory only, a restart makes a new one, and once a password is set there is none. To set the password from the shell instead (before exposing the app), run the password command from [Forgotten password](#forgotten-password).

If the log says `Cannot open the database`, the `data` directory is not writable by uid 1000 (Docker creates a missing one as root): run `sudo chown -R 1000:1000 data` and start again.

The app listens on port **3063**, bound to `127.0.0.1` so it is only reachable through the reverse proxy on the same host. Point your reverse proxy at `localhost:3063`.

If your proxy runs elsewhere (another host or container), set `BIND_ADDRESS` in `.env` and make sure `TRUST_PROXY` matches the number of proxies in front of the app. Never expose the port directly while `TRUST_PROXY` is set: clients could then fake their IP address and bypass the sign-in rate limit.

### nginx

[deploy/places.fdahle.de.conf](deploy/places.fdahle.de.conf) is the configuration behind the homestack Authelia login (see [below](#sign-in-through-the-homestack-login)). Without Authelia, a plain one:

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

### Sign in through the homestack login

Behind Authelia (see [deploy/README.md](../../deploy/README.md#one-login-for-all-apps)), Fernweh doesn't ask for its own password: nginx asks Authelia, then passes the user in `Remote-User` together with a shared secret in `X-Auth-Proxy-Secret`.

```sh
secret=$(openssl rand -hex 32)
echo "AUTH_PROXY_SECRET=$secret" >> /srv/docker/homestack/fernweh/.env
echo "proxy_set_header X-Auth-Proxy-Secret \"$secret\";" > /etc/nginx/homestack-secrets/fernweh.conf
chmod 640 /etc/nginx/homestack-secrets/fernweh.conf
cp fernweh/deploy/places.fdahle.de.conf /etc/nginx/sites-available/
nginx -t && systemctl reload nginx
cd /srv/docker/homestack/fernweh && docker compose up -d
```

With `AUTH_PROXY_SECRET` set, the API trusts `Remote-User` only together with the right secret (compared in constant time) and then treats the request as Fernweh's one owner. Fernweh has a single owner, so everyone Authelia lets through shares the same map; to narrow that down, list the logins that may use it in `AUTH_PROXY_USERS` (for example `AUTH_PROXY_USERS=felix`, comma-separated, any case), and others get a 403. Every other request to the API gets a 403, a session cookie alone included. The login page, signing out and the password change disappear (Settings → Account says you're signed in through the server's login). When the Authelia login runs out, the app reloads itself (at most once a minute) and lands on Authelia's login page. Shared map views stay public: Authelia must let `/share/…`, `/api/public/share/…`, the built files under `/assets/`, and the icons, `manifest.webmanifest` and `sw.js` through without a login (a bypass rule for places.fdahle.de in [deploy/authelia.yml](../../deploy/authelia.yml)). Your places and the password set before stay; leave `AUTH_PROXY_SECRET` empty again and Fernweh asks for that password as before.

### Friends from Stammtisch

With [Stammtisch](../stammtisch/README.md#fernweh) on the same server, Fernweh imports your friends and their addresses, one way: Stammtisch is where you keep them, Fernweh shows them on the map.

1. In Stammtisch's `.env` set `LINK_TOKEN` (`openssl rand -hex 32`), the same value here as `STAMMTISCH_LINK_TOKEN`.
2. Fernweh reaches Stammtisch over the shared Docker network `homestack` (`docker network create homestack` once; Stammtisch joins it as described in its README). Put a `docker-compose.override.yml` next to Fernweh's `docker-compose.yml`:

   ```yaml
   services:
     app:
       networks: [default, homestack]
   networks:
     homestack:
       external: true
   ```

3. In Fernweh's `.env`: `STAMMTISCH_URL=http://stammtisch:3000`, `STAMMTISCH_LINK_TOKEN=…`, and `STAMMTISCH_PUBLIC_URL=https://friends.fdahle.de` for the links to Stammtisch. Then `docker compose up -d`.

Without `STAMMTISCH_URL` and `STAMMTISCH_LINK_TOKEN` none of this is there. With them, the sync runs at start, every `STAMMTISCH_SYNC_HOURS` (6), and from **Settings → Data → Sync now**, which also shows the last result (added, linked, moved, unchanged, gone, addresses not found, errors). The rules:

- Every friend in Stammtisch who isn't archived and has an address or a city becomes a person here, named as in Stammtisch. A person with the same name (ignoring case) who isn't linked yet is linked instead of duplicated, and keeps their address pin if they have one.
- The address (or the city when there is none) is looked up with OpenStreetMap's Nominatim, from the server: one request a second, cached by the address text. It becomes the person's address pin, in the collection **Freunde** (made when needed; rename it as you like, Fernweh keeps using it). An address Nominatim doesn't know leaves the person without a pin and is listed in the result (and asked again after a month).
- A pin moves only when the address changes in Stammtisch, so a pin you moved by hand stays where you put it. Your label, notes, categories and everything else you edit here stay too; only the name follows Stammtisch. A pin that is also another person's address isn't moved: the friend gets a new one.
- Nothing is deleted because of Stammtisch: a friend who is gone or archived there stays here, marked as no longer linked (and named in the result). A person you delete here isn't imported again.
- A linked person has **Open in Stammtisch** (in the person's list on the map, the person editor, and on their address pin). Stammtisch's *Auf der Karte* links to `/?stammtisch=<id>`, which opens Fernweh at that friend's pin (after signing in).

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
| `SESSION_SECRET` | Yes | Random string ≥ 32 characters, used to sign JWT tokens (the app refuses the example value from `.env.example`) |
| `PORT` | No | Port the app listens on without Docker, and the host port docker-compose publishes (default: `3063`; inside the container always 3000) |
| `NODE_ENV` | No | Set to `production` in production (Secure cookie, so HTTPS is required) |
| `BIND_ADDRESS` | No | Host address docker-compose publishes the port on (default: `127.0.0.1`) |
| `TRUST_PROXY` | No | Number of reverse proxies in front of the app, `false` when there is none, or a list of proxy addresses such as `loopback, 10.0.0.0/8` (default: `false`; docker-compose sets `1`) |
| `MAPPER_DB_PATH` | No | SQLite file when running without Docker (default: `data/mapper.db`) |
| `AUTH_PROXY_SECRET` | No | Sign in through the homestack login (Authelia) instead of the password: the secret nginx sends in `X-Auth-Proxy-Secret` ([above](#sign-in-through-the-homestack-login)) |
| `AUTH_PROXY_USERS` | No | With `AUTH_PROXY_SECRET`: the logins that may use Fernweh, comma-separated, any case (default: everyone Authelia lets through) |
| `STAMMTISCH_URL` | No | Stammtisch's address server to server, normally `http://stammtisch:3000` over the `homestack` network ([above](#friends-from-stammtisch)) |
| `STAMMTISCH_LINK_TOKEN` | No | The secret Stammtisch's link API expects (`LINK_TOKEN` there) |
| `STAMMTISCH_PUBLIC_URL` | No | Stammtisch's address in the browser, e.g. `https://friends.fdahle.de`, for "Open in Stammtisch" |
| `STAMMTISCH_SYNC_HOURS` | No | Hours between syncs with Stammtisch (default: `6`) |

Sessions last 30 days and are renewed while you use the app; "Sign out of all devices" and password changes end every session.

---

## License

Do whatever you want with it.

## Development checks

Use Node.js 24. Install dependencies with `npm ci`, `npm ci --prefix api`, and `npm ci --prefix client`. Run `npm run check` for linting, regression tests (including the Stammtisch sync against a fake Stammtisch and geocoder, and the login through the proxy), a production build and an isolated HTTP smoke test. Tests use an in-memory database and never open `data/mapper.db`.

The homestack design kit is copied in by `node kit/sync.mjs fernweh` (from the repository root) to `client/src/kit`, `api/kit` and `scripts/kit`; don't edit those copies. Fernweh, a full-screen map, takes the kit's tokens (`kit/tokens.css`, mapped to Fernweh's own variable names in `client/src/theme.css`) and icon style, not its page layout. `npm run icons` redraws the app icon (a white map pin on plum, `scripts/make-icons.js`) into `client/public/`.

Stop the app before running `npm run reset`; this deletes the local database. Database upgrades run transactionally and are recorded in `schema_migrations`. Existing sessions are invalidated once on this upgrade and whenever the password is changed or reset.

Shared maps include the selected markers with their descriptions, images, addresses, links and visited dates, but not ratings, favorites or planned dates. Only the categories, collections and persons the link selects are shown (a link to all markers shows all categories and collections, but no persons); trip routes appear for shared trips only. Person address references are excluded. Treat everything shown as public to anyone holding the link.
