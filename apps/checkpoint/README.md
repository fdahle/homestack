# Checkpoint

A self-hosted log of the games you play: what you're playing now, what you finished, what you dropped, and what's waiting in the backlog. For one person; nobody else sees it.

- **Look a game up, add it in two taps.** Search [IGDB](https://www.igdb.com) by name, tap a result, and pick *Spiele ich*, *Durchgespielt*, *Backlog* or *Wunschliste*. Cover, release date, platforms, genres, developer, series and IGDB's time to beat come along. Games IGDB doesn't know can be entered by hand.
- **Your progress per game.** Status (wishlist, backlog, playing, finished, 100 %, dropped), a rating in half stars, the platforms you played it on (tick the ones IGDB lists for the game, or add another such as *Steam Deck*), when you started and finished (a year or month is enough for old games) and notes. Everything saves as you change it. Marking a backlog game as *playing* fills in today as the start date, and finishing a game you were playing fills in the end date.
- **Library** as a cover grid, with what you're playing now at the top, status chips, platform and genre behind the filter button, search and several sort orders.
- **What to play next:** a random pick from your backlog, filtered by platform, length (from IGDB's time for the main story) and genre. *Ein anderes* goes through all matching games before repeating one; *Spiel ich jetzt* moves it to *playing*.
- **Stats:** games played and finished, how many you see through, your average rating, games finished per year, by status, platform and genre, your rating distribution, top-rated games and roughly how many hours of story sit in your backlog.
- **Your Steam library, kept in step** (optional): play time, the platform and *Spiele ich* for what you're playing, and the Steam games that aren't in Checkpoint yet to pick from (details below).
- **On a computer** the tabs move into a bar across the top and a game opens beside the library, so you can go through your games without losing your place. `/` jumps to the search, `Esc` closes the game.
- Your own cover photos, German and English interface, JSON export, installable on the phone's home screen.

## IGDB

IGDB belongs to Twitch, so the game data needs a (free) Twitch application:

1. Log in at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) (with two-factor authentication on your Twitch account) and register an application. Name: anything, OAuth redirect URL: `http://localhost`, category: *Website Integration*, client type: *Confidential*.
2. Copy its *Client ID*, create a *New Secret*, and put both into `.env` as `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`.

Checkpoint gets a token from Twitch on its own and renews it. It stays below IGDB's limit of 4 requests a second. Adding a game costs three requests (details, time to beat, cover). Covers are stored by Checkpoint, and search thumbnails go through the server, so your browser only ever talks to Checkpoint. Without the two variables, search is off and you enter games by hand.

## Steam

Checkpoint can read your Steam library. It never changes anything on Steam.

1. Get a Web API key at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (any domain name will do) and put it into `.env` as `STEAM_API_KEY`.
2. Put your Steam ID into `STEAM_ID`: the long number (SteamID64), or the name in your profile's address if it is `steamcommunity.com/id/<name>`.
3. In Steam, under *Profile → Edit profile → Privacy settings*, set *Game details* to public. Otherwise Steam answers with an empty library.

The sync runs at every start, every `STEAM_SYNC_HOURS` hours and from *Jetzt abgleichen* on the Steam page. Each Steam game is matched to its IGDB game by its Steam app id (IGDB keeps those), so it is recognised even under another name; a Steam game IGDB doesn't know is recognised by its name.

- **Games already in Checkpoint** get your Steam play time and the day you last played (on the game's page, with a link to the Steam store). *Gespielt auf* gets *PC*, or *Steam Deck*, when Steam first counts time there; if you untick it, it stays unticked.
- A game you **haven't started** (*Backlog* or *Wunschliste*) that you played on Steam in the last two weeks moves to *Spiele ich*, with that day as its start if it has none. It only happens when Steam saw you play since the last sync, so putting it back yourself sticks. A *Wunschliste* game you now own on Steam moves to *Backlog*. Nothing else about your entries changes.
- **Steam games not in Checkpoint** wait on the Steam page (*Hinzufügen → Aus Steam übernehmen*, or the settings): tick the ones you want, or *Alle gespielten wählen*, and bring them in. They come with IGDB's details and cover, as *Backlog* (*Spiele ich* if you played them in the last two weeks). Games IGDB doesn't know come with their name. Hide the ones you never want here; a Steam game you delete in Checkpoint is hidden too, and *Ausgeblendete* shows them again.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); installing it as an app needs HTTPS. The first start creates the account `ADMIN_USER`.

**Update:** `docker compose up -d --build`. The data lives in the `checkpoint-data` volume (`checkpoint.db` plus `covers/`). Changes to the data happen once, at the first start of a new version: with several platforms per game, each game's one *Gespielt auf* became a list of one.

**Backup:** back up `checkpoint.db` with `sqlite3 checkpoint.db ".backup …"`, along with the `covers/` folder from the volume.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `IGDB_CLIENT_ID` / `IGDB_CLIENT_SECRET` | – | Twitch application for IGDB (see above) |
| `STEAM_API_KEY` / `STEAM_ID` | – | Your Steam library (see above). Empty: no Steam |
| `STEAM_SYNC_HOURS` | 6 | How often the Steam library is read (0: only at start and by hand) |
| `PORT` | 3069 | |
| `DATA_DIR` | `/data` | Where `checkpoint.db` and `covers/` live |
| `TZ` | `Europe/Berlin` | Decides what "today" is for start and finish dates |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of Checkpoint's own account (see the [design kit](../../kit/README.md#login)) |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD, DATA_DIR=./data and the IGDB keys
npm run dev            # API on :3069, reads .env
npm run dev:web        # Vue with hot reload on :5169
npm test               # input checks, dates, IGDB mapping
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/db.js` holds all SQL, `server/server.js` the routes. `server/igdb.js` is the IGDB client (token, request spacing, search, details, images), `server/steam.js` reads your Steam library and holds the sync's rules, `server/steamsync.js` applies them and brings games in, `server/games.js` checks what the app sends and turns IGDB's answers into games. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts); the library, the picker and the stats work on the full game list in the browser. `npm run icons` regenerates the app icons.

The layout, login and common components come from the homestack [design kit](../../kit/): the files in `web/src/kit/`, `server/kit/` and `scripts/kit/` are copies. Change them in `kit/` and run `node kit/sync.mjs` from the repository root.

Game data and covers come from [IGDB.com](https://www.igdb.com).
