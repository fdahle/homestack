# Regal

A self-hosted list of your books, with covers: what you're reading, what you've read, what you want to read and what you gave up on. It reads your Calibre library on its own, so the e-books are there without typing them in. For one person; nobody else sees it.

- **Look a book up, add it in two taps.** Search [Open Library](https://openlibrary.org) and [Google Books](https://books.google.com) by title, author or ISBN, or scan the barcode on the back with the phone's camera. Tap a result and pick *Will ich lesen*, *Lese ich* or *Gelesen*. Title, authors, series, year, publisher, pages, ISBN, language, description and the cover come along. Books neither catalog knows can be entered by hand.
- **Your Calibre library, kept in step.** Regal reads the library every few hours and shows which books are *E-Book in Calibre*, with a link to Calibre-Web. It never writes to the library (details below).
- **Your entries per book.** Status, a rating in half stars, when you started and finished (a year or month is enough for old books), the page you're on while reading, notes and your own cover photo. Everything saves as you change it. Starting a book fills in today as the start date, finishing one you were reading fills in the end date.
- **Library** as a cover grid, with what you're reading now (and how far) at the top, filters for status, author and Calibre, search (`/` jumps to it) and several sort orders. On a computer a book opens beside the list.
- **Stats:** books and pages read, per year, your most-read authors, your rating distribution, top-rated books and, if you set one, how your yearly reading goal is going.
- German and English interface, JSON export, installable on the phone's home screen.

## Calibre

Regal and Calibre-Web run on the same server and use the same library folder (the one with `metadata.db` in it). The sync goes one way, Calibre → Regal:

- Calibre-Web also writes to `metadata.db`, so Regal never opens it: it copies `metadata.db` into its data folder, reads the copy and deletes it again. The library is mounted read-only into the container.
- Books are matched by Calibre's uuid. A Calibre book that isn't in Regal yet is first matched against books you added yourself, by ISBN (or by title and first author when neither has an ISBN), and linked to that one instead of added twice. Otherwise it's added with the status set in the settings (*Will ich lesen* unless you change it).
- Later syncs update what Calibre knows (title, authors, series and number, year, publisher, ISBNs, language, description, tags, formats, the cover). A field Calibre leaves empty keeps what Regal has. Your own entries (status, rating, dates, page, notes, your cover photo) are never touched. A page count comes from a custom column labelled `pages` (the *Count Pages* plugin's) if there is one.
- Books that disappear from Calibre stay in Regal, marked *Nicht mehr in Calibre*. If they come back, the mark goes away.
- A Calibre book you delete in Regal stays out of later syncs; *Wieder aufnehmen* in the settings undoes that.

It runs at every start, every `CALIBRE_SYNC_HOURS` hours and from *Jetzt abgleichen* in the settings, which also shows the last result.

With Docker, mount the library next to `docker-compose.yml` in a `docker-compose.override.yml` (Docker Compose reads it on its own; without it Regal simply runs without Calibre):

```yaml
services:
  regal:
    environment:
      CALIBRE_LIBRARY: /calibre
    volumes:
      - /srv/docker/calibre-web/books:/calibre:ro
```

The container runs as user `node` (uid 1000), which needs read access to the library. Set `CALIBRE_WEB_URL` in `.env` to get an *In Calibre-Web öffnen* link on each book (`<url>/book/<calibre id>`).

## Book data

Open Library needs no key. Search asks Open Library for the edition in your interface's language, and Google Books at the same time; Google's results that aren't already in Open Library's list come after them. When an Open Library edition lacks a cover, description or page count, Regal fills the gaps from Google Books by ISBN. Covers are stored by Regal, and search thumbnails go through the server, so your browser only ever talks to Regal.

Google Books works without a key, but the keyless quota is shared by everyone and is often used up; after a refusal Regal leaves Google alone for an hour. A key of your own is free: in the [Google Cloud console](https://console.cloud.google.com), enable the *Books API* and create an API key, then set `GOOGLE_BOOKS_API_KEY`.

The ISBN scanner needs HTTPS and camera access for the site (the nginx config in `deploy/` allows it). Chrome on Android reads barcodes itself; other browsers load a small WebAssembly reader when the camera starts.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, PORT, maybe GOOGLE_BOOKS_API_KEY and CALIBRE_WEB_URL
# for Calibre: docker-compose.override.yml as above
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); installing it as an app and the camera both need HTTPS. The first start creates the account `ADMIN_USER`.

**Update:** `docker compose up -d --build`. The data lives in the `regal-data` volume (`regal.db` plus `covers/`).

**Backup:** back up `regal.db` with `sqlite3 regal.db ".backup …"`, along with the `covers/` folder from the volume. Covers copied from Calibre come back with the next sync anyway.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of Regal's own account (see [deploy/](../deploy/README.md#one-login-for-all-apps)) |
| `GOOGLE_BOOKS_API_KEY` | – | Your own Google Books quota (see above) |
| `CALIBRE_LIBRARY` | – | The Calibre library folder; `/calibre` with the override above. Empty: no sync |
| `CALIBRE_SYNC_HOURS` | 6 | How often the library is read (0: only at start and by hand) |
| `CALIBRE_WEB_URL` | – | Your Calibre-Web, for the link on each book |
| `PORT` | 3072 | |
| `DATA_DIR` | `/data` | Where `regal.db` and `covers/` live |
| `TZ` | `Europe/Berlin` | Decides what "today" is for start and finish dates |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD, DATA_DIR=./data and maybe CALIBRE_LIBRARY
npm run dev            # API on :3072, reads .env
npm run dev:web        # Vue with hot reload on :5172
npm test               # input checks, ISBNs, catalog mapping, the Calibre reader and sync
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/db.js` holds all SQL, `server/server.js` the routes. `server/catalog.js` talks to Open Library and Google Books, `server/books.js` checks what the app sends and turns the catalogs' answers into books, `server/isbn.js` handles ISBNs. `server/calibre.js` reads a Calibre library and works out what a sync changes, `server/sync.js` applies it and copies the covers; `server/calibre-fixture.js` builds a small Calibre library for the tests. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts); the library and the stats work on the full book list in the browser. `npm run icons` regenerates the app icons.

Book data and covers come from [Open Library](https://openlibrary.org) and [Google Books](https://books.google.com).
