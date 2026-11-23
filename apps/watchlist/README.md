# Watchlist

A self-hosted log of the films and series you watch: what's on your watchlist, what you've seen, how far you are in each show, and what comes next. For one person; nobody else sees it. Films and series are kept apart everywhere: two libraries, two ways of adding, two sets of stats. A switch at the top (in the sidebar on a computer) takes you from one to the other, and the series side has a bluer accent, so you always see where you are.

- **Look a title up, add it in two taps.** Search [TMDB](https://www.themoviedb.org) by title, tap a result and pick a status. Poster, year, runtime, genres, the country it comes from, director or creators, cast, description (in English when TMDB has no German one) and where to stream it come along; for series every season and episode. Titles TMDB doesn't know can be entered by hand.
- **Films:** *Merkliste*, *Gesehen* or *Abgebrochen*, a rating in half stars, notes, and a watch log: each time you watched it, as precise as you remember (a year is enough). Marking a film as watched notes today; *Noch mal gesehen* adds a rewatch.
- **Series:** *Merkliste*, *Schaue ich*, *Pausiert*, *Fertig* or *Abgebrochen*, rating and notes, and the episodes season by season: tick one, a whole season, or everything up to an episode. Ticking the first episode of a show on your watchlist moves it to *Schaue ich*; seeing the last aired episode of a show that has ended moves it to *Fertig* (with *Rückgängig* in case you didn't mean to).
- **Als Nächstes:** for every show you're watching, the next episode with a one-tap *Gesehen*, and *Demnächst*: the coming air dates of the shows you follow. Shows that are still running get TMDB's data once a day, so new episodes show up by themselves (or right away with the refresh button on the show's page).
- **Library** per side as a poster grid, with the shows you're watching at the top, filters for status, genre and country, search and several sort orders (the last one you picked is remembered; *Zufällig* shuffles once a day, at 04:00). On a computer the title opens beside the list.
- **Stats** per side: films seen and how often, hours watched, per year, genres, countries, decades, directors, your ratings and top-rated; for series also episodes per year and where the hours went.
- **Where to stream it** (subscription, free, rent, buy) for the country you pick in the settings, from JustWatch through TMDB.
- A one-time import from Watcharr (on the server), your own poster photos, German and English interface, JSON export, installable on the phone's home screen.

## TMDB

The film and series data come from TMDB's API, which is free for personal use:

1. Create an account at [themoviedb.org](https://www.themoviedb.org/signup), then under *Settings → API* request an API key (type *Developer*, personal use).
2. Copy the *API Read Access Token* into `.env` as `TMDB_TOKEN`. The older *API Key* works too, as `TMDB_API_KEY`.

Watchlist asks TMDB one request at a time, at least 150 ms apart (TMDB allows about 40 a second). Adding a film costs one request, a series two or three (all episodes come in batches of 20 seasons). Posters are stored by Watchlist; search thumbnails and streaming logos go through the server, so your browser only ever talks to Watchlist. Streaming offers are fetched again when you open a title whose offers are more than three days old. Without a token, search is off and you enter titles by hand.

`TMDB_LANGUAGE` (default `de-DE`) decides the language of titles, genres and descriptions; the country whose streaming services are shown is picked in the settings (*Wo du schaust*); `WATCH_REGION` (default `DE`) is only where it starts.

## Moving over from Watcharr

Watchlist reads what [Watcharr](https://github.com/sbondCo/Watcharr) keeps per title: status, rating, thoughts, the activity log (when you watched something) and the watched seasons and episodes of shows. Every title is looked up on TMDB again, so the import needs `TMDB_TOKEN` or `TMDB_API_KEY`. It's a one-time move, so it isn't in the app's settings but a command on the server:

`npm run import:watcharr -- /path/to/watcharr.db` reads Watcharr's SQLite file, read-only (stop Watcharr first, so everything it wrote is in that file). With several Watcharr accounts in one database, add `--user <name>`. The same command also takes Watcharr's export file (*Profile → Export*, a `watcharr-export.json`). In Docker:

  ```sh
  docker compose cp /srv/docker/watcharr/data/watcharr.db watchlist:/data/watcharr.db
  docker compose exec watchlist node --disable-warning=ExperimentalWarning server/import-watcharr.js /data/watcharr.db
  ```

Films and series end up on their own sides whichever Watcharr they came from, so two Watcharr instances (one for films, one for series) are simply imported one after the other. Running an import again adds nothing twice: titles already in Watchlist only get watch dates and episodes they don't have yet, and a rating or notes where they have none. Statuses you set in Watchlist stay.

| Watcharr | Film | Series |
|---|---|---|
| `PLANNED` | Merkliste | Merkliste |
| `WATCHING` | Gesehen if Watcharr has a watch date, else Merkliste | Schaue ich |
| `HOLD` | like `WATCHING` | Pausiert |
| `FINISHED` | Gesehen | Fertig, all aired episodes ticked |
| `DROPPED` | Abgebrochen | Abgebrochen |

- **Watch dates of films:** each play in Watcharr's activity (`countAsPlay`, or a change to `FINISHED`, or an imported watch date) becomes a watch, one per day, with the custom date where you set one. A finished film without any date gets one undated watch.
- **Episodes:** episodes and whole seasons marked as finished are ticked with the day Watcharr last changed them; for a finished show the remaining aired episodes get the day it was marked as finished (or no date). Specials (season 0) are left out, as everywhere in Watchlist.
- **Ratings** are out of 10 in both apps; Watcharr's decimals are rounded. **Thoughts** become notes.
- Games, single episodes and entries without a TMDB id are skipped and listed in the report.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, TMDB_TOKEN, PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); installing it as an app needs HTTPS. The first start creates the account `ADMIN_USER`.

**Update:** `docker compose up -d --build`. The data lives in the `watchlist-data` volume (`watchlist.db` plus `posters/`).

**Backup:** back up `watchlist.db` with `sqlite3 watchlist.db ".backup …"`, along with the `posters/` folder from the volume.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of Watchlist's own account (see [deploy/](../../deploy/README.md#one-login-for-all-apps)) |
| `TMDB_TOKEN` or `TMDB_API_KEY` | – | TMDB's API Read Access Token, or the v3 API key (see above) |
| `TMDB_LANGUAGE` | `de-DE` | Language of titles, genres and descriptions |
| `WATCH_REGION` | `DE` | Country for "where to stream" until one is picked in the settings |
| `PORT` | 3071 | |
| `DATA_DIR` | `/data` | Where `watchlist.db` and `posters/` live |
| `TZ` | `Europe/Berlin` | Decides what "today" is for watch dates and air dates |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD, DATA_DIR=./data and TMDB_TOKEN
npm run dev            # API on :3071, reads .env
npm run dev:web        # Vue with hot reload on :5171
npm test               # input checks, TMDB mapping, episode logic, Watcharr mapping
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/db.js` holds all SQL, `server/server.js` the routes. `server/tmdb.js` is the TMDB client (request spacing, search, details, images), `server/titles.js` checks what the app sends and turns TMDB's answers into films and series, `server/progress.js` works out next episodes, progress and the automatic status, and `server/catalog.js` adds and refreshes titles with their posters. `server/watcharr.js` maps Watcharr's data, `server/importer.js` brings it in, `server/import-watcharr.js` is the command line import. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts); the libraries and stats work on the full lists in the browser. `npm run icons` regenerates the app icons.

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming offers are provided by [JustWatch](https://www.justwatch.com) through TMDB.
