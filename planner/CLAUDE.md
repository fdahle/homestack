# Planner — Project Overview

A self-hosted personal planner / note-taking PWA with offline support, optional end-to-end encryption, and web push notifications.

## Architecture

Three services wired together via Docker Compose:

```
Browser (Vue 3 SPA)
  ↕  /api/*        → Express API (Node.js, port 3000)
  ↕  /db/*         → CouchDB 3 (port 5984) via nginx reverse proxy
Nginx (port 80) — serves built SPA, proxies API & CouchDB, blocks admin paths
```

- **Client** syncs notes directly with CouchDB via PouchDB (offline-first). The Express API is only used for auth and push notifications — not for note CRUD.
- **Per-user databases**: each user gets their own `notes_<username>` CouchDB database, locked down via a security doc so only that user can access it.

## Directory Structure

```
planner/
├── api/                    Express API server
│   ├── index.js            Entry point: startup, push scheduler (runs every minute)
│   ├── routes/
│   │   ├── auth.js         /api/auth — register, login, logout, /me, /config
│   │   └── push.js         /api/push — subscribe/unsubscribe web push
│   └── lib/
│       └── couchdb.js      CouchDB helper (admin auth, user/db management, push subscription CRUD)
├── client/                 Vue 3 + Vite SPA
│   └── src/
│       ├── views/
│       │   ├── AppView.vue     Main app shell (authenticated)
│       │   └── LoginView.vue   Login / register
│       ├── components/         NoteCard, NoteModal, TrelloBoard, SideMenu, …
│       ├── stores/
│       │   ├── notes.js        Pinia store — PouchDB sync, note CRUD, smart views
│       │   └── auth.js         Pinia store — session state
│       ├── composables/        usePushNotifications.js, …
│       ├── utils/              crypto.js (optional E2E encryption)
│       └── router/index.js     Two routes: /login and / (requiresAuth)
├── couchdb/
│   └── local.ini           CouchDB config (bind address, CORS, etc.)
├── docker/
│   └── nginx.conf          Nginx reverse proxy config
├── docker-compose.yml      Production stack (nginx + api + couchdb)
└── package.json            Root dev script: starts couchdb + api + client concurrently
```

## Development

```bash
# Start everything (CouchDB in Docker, API + client with hot reload)
npm run dev

# Stop CouchDB container
npm run stop
```

Requires a `.env` file in the project root:
```
COUCHDB_USER=admin
COUCHDB_PASSWORD=yourpassword
ENCRYPTION_ENABLED=false       # set true to enable client-side E2E encryption
ALLOW_SIGNUP=true
VAPID_PUBLIC_KEY=...           # generate with: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

## Production Deployment

```bash
npm --prefix client run build   # outputs to client/dist/
docker compose up -d            # starts nginx + api + couchdb
```

## Key Concepts

- **Offline-first**: PouchDB in the browser syncs with CouchDB. Notes work without a network connection.
- **Optional encryption**: when `ENCRYPTION_ENABLED=true`, note fields are encrypted client-side (`utils/crypto.js`) before being stored in CouchDB. The API never sees plaintext.
- **Push notifications**: the API polls each user's notes DB every minute for notes with a `notificationAt` timestamp in the past window and sends a web push if not already sent (dedup via `sentKeys`).
- **Smart views**: the notes store derives filtered lists (Today, Upcoming, etc.) at read time — no separate DB queries.
- **First user = admin**: the first registered user is automatically granted the `admin` role in CouchDB.
- **Signup control**: set `ALLOW_SIGNUP=false` in env to prevent new registrations after initial setup.

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account + auto-login |
| POST | `/api/auth/login` | Login, sets `AuthSession` cookie |
| POST | `/api/auth/logout` | Clears session |
| GET  | `/api/auth/me` | Returns current user or 401 |
| GET  | `/api/auth/config` | Returns `encryptionEnabled`, `allowSignup`, `setupRequired` |
| POST | `/api/push/subscribe` | Save web push subscription |
| DELETE | `/api/push/unsubscribe` | Remove push subscription |
| GET  | `/api/health` | Health check |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3, Pinia, Vue Router, Vite |
| Rich text | Tiptap (with markdown extension) |
| Sync | PouchDB ↔ CouchDB |
| Backend | Node.js, Express, helmet, express-rate-limit |
| Push | web-push (VAPID), node-cron |
| DB | CouchDB 3 (Docker) |
| Proxy | Nginx (Docker) |
| PWA | vite-plugin-pwa, service worker (`sw.js`) |
