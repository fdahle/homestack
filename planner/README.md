# Planner

A self-hosted personal planner / note-taking PWA with offline support, optional
end-to-end encryption, and web push notifications.

Three services wired together: a Vue 3 SPA, an Express API (auth + push only),
and CouchDB (notes sync directly via PouchDB). See [CLAUDE.md](CLAUDE.md) for the
full architecture.

## Features

- Notes & tasks with due dates/times, priorities, recurrence, reminders
- Multiple layouts: masonry, list, Kanban board, and a **month calendar**
- Hierarchical views/labels, smart views (Today, Upcoming, Overdue, All Tasks)
- **Global search** across every note (titles, content, labels, attachments)
- **Note templates**, **archive** (separate from trash), and undo on delete
- Offline-first sync, optional end-to-end encryption (envelope-based)
- Web push + an optional **daily digest**, installable PWA with share-target,
  app shortcuts, and an overdue-count badge
- Admin user management (roles, password reset, deletion)

## Development

Requires Node 20+ and Docker (for CouchDB).

```bash
cp .env.example .env                       # then fill in values
cp couchdb/local.ini.example couchdb/local.ini   # set admin password + secrets
npm install
npm run dev          # CouchDB in Docker + API and client with hot reload
npm run stop         # stop the CouchDB container
```

- Client: http://localhost:5173
- API: http://localhost:3000
- CouchDB: http://localhost:5984 (bound to loopback only)

### Tests

```bash
npm --prefix client test   # Vitest: crypto, date logic, markdown sanitizer
npm --prefix api    test   # node:test: input validators
```

## Production deployment

```bash
npm --prefix client run build   # outputs to client/dist/
docker compose up -d            # nginx + api + couchdb
```

The bundled `nginx` listens on **port 80 only** and does **not** terminate TLS.
Run it behind your own HTTPS reverse proxy (Caddy, Traefik, Cloudflare, etc.).

**TLS requirements** — the app sets the auth cookie with the `Secure` flag in
production, so it only works over HTTPS:

- Terminate TLS at your upstream proxy and forward to nginx on port 80.
- Forward the standard headers, especially `X-Forwarded-Proto: https`
  (Express runs with `trust proxy = 1`).
- Keep `NODE_ENV=production` set for the API (already set in `docker-compose.yml`).

**Do not expose CouchDB (5984) publicly.** It is bound to `127.0.0.1` in
`docker-compose.yml`; all production traffic must go through nginx, which rate
limits and blocks the CouchDB admin paths.

### Configuration

See [.env.example](.env.example) for all variables. Notable ones:

| Variable | Purpose |
|----------|---------|
| `COUCHDB_USER` / `COUCHDB_PASSWORD` | CouchDB admin credentials (must match `couchdb/local.ini`) |
| `ENCRYPTION_ENABLED` | Client-side E2E encryption of note fields |
| `ALLOW_SIGNUP` | Set `false` to disable registration after initial setup |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push (generate with `npx web-push generate-vapid-keys`) |

### A note on end-to-end encryption

When `ENCRYPTION_ENABLED=true`, note fields and attachments are encrypted in the
browser with a key derived from your password — the server never sees plaintext.
Consequences:

- **There is no password recovery.** If you forget your password, the notes are
  unrecoverable by design.
- Notes are encrypted with a random data key that is itself wrapped by your
  password (envelope encryption). Changing your password only re-wraps that key —
  it's instant and never re-encrypts your notes.
- Exported backups are written in **plaintext** (so they remain restorable).
