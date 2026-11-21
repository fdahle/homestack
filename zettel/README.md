# Zettel

Self-hosted notes that work offline. Write on the phone in the train, on the laptop at home: every device keeps all your notes and syncs when it's online. The tasks that used to live here are going to their own app.

- **Write with formatting, keep Markdown.** Headings, lists, **checklists**, quotes, code, links: from the toolbar or typed as Markdown (`- [ ] ` starts a checklist, `# ` a heading). What's stored is plain Markdown.
- **Pictures and files** on a note: pick them, paste them or drop them on the note. Phone photos are made smaller first (longest side 2400 px).
- **Labels** to sort notes, **pin** the important ones to the top, **archive** what you're done with, a **trash** that empties itself after 30 days, and undo after archiving or deleting.
- **Search** across titles, text, labels and file names, on the device, so it's instant and works offline (`/` jumps to it, `N` writes a new note).
- **Offline first.** The app itself and all notes are on the device. Changes made offline wait and are sent when the device is back online; the cloud in the top bar shows how many are waiting.
- **Share into Zettel** from other apps on the phone (once it's installed to the home screen), and **export** everything as Markdown files in a ZIP.
- On a computer a note opens beside the list, with your labels in the sidebar. German and English interface.

## How the sync works

Each device writes to its own copy first (IndexedDB in the browser) and puts the change into an outbox. `POST /api/sync` sends the outbox and gets back everything that changed since the device last asked; every change on the server gets the next number of one counter, so "since" is a number. Notes get their ids on the device, so a note written offline already exists before the server hears of it. Files picked offline are kept on the device and uploaded after their note.

When two devices change the text of the same note before either has synced, nothing is overwritten: the second text becomes a copy of the note, and the app says so. For everything else (title, labels, pinned, archived) the latest change wins. The details are in `server/notes.js` (server) and `web/src/store/notes.js` (device).

The service worker (`web/sw.js`) keeps the app's files so it opens without a network, and keeps every attached file once it has been shown.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD and maybe PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); offline use and installing it as an app both need HTTPS. The first start creates the account `ADMIN_USER`.

**Update:** `docker compose up -d --build`. The data lives in the `zettel-data` volume (`zettel.db` plus `files/`).

**Backup:** back up `zettel.db` with `sqlite3 zettel.db ".backup …"`, along with the `files/` folder from the volume. The export in the settings gives you readable Markdown as well.

**Behind Authelia:** set `AUTH_PROXY_SECRET` (see [deploy/](../deploy/README.md#one-login-for-all-apps)). Offline, the app opens with the account it last saw; when the Authelia login has run out, the next sync online sends you to its login page.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of Zettel's own account |
| `MAX_FILE_MB` | 25 | The largest file you can attach (nginx's `client_max_body_size` must allow it) |
| `TRASH_DAYS` | 30 | Days before a note in the trash is deleted for good (0: never) |
| `PORT` | 3070 | |
| `DATA_DIR` | `/data` | Where `zettel.db` and `files/` live |

Notes belong to the account that wrote them, so with Authelia each person gets their own.

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD and DATA_DIR=./data
npm run dev            # API on :3070, reads .env
npm run dev:web        # Vue with hot reload on :5170
npm test               # sync and merging, export, the ZIP writer, the Markdown preview
```

`npm run build` builds the frontend into `dist/` (with `dist/sw.js`), which the server serves when it exists. The service worker only runs in the build, not with `dev:web`.

Code map: `server/notes.js` holds the notes' SQL and the sync, `server/server.js` the routes, `server/export.js` and `server/zip.js` the export. In `web/src`, `store/notes.js` is the device's copy and the sync, `store/idb.js` the IndexedDB helpers, `session.js` lets the app start offline with the last known account, `components/NoteEditor.vue` the editor ([Tiptap](https://tiptap.dev) with [tiptap-markdown](https://github.com/aguingand/tiptap-markdown)), `lib/markdown.js` the previews in the list. `npm run icons` regenerates the app icons.

The old Zettel (notes and tasks on CouchDB, with end-to-end encryption) is in the git history before this version.
