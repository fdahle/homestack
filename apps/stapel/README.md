# Stapel

A self-hosted tracker for a comic collection: which comics you own, which you've read, and what's missing from a series. Made for German comics (albums, Taschenbücher, Hefte), and it works for American ones too. There is no reader; it only keeps track.

- **Add a series, see the gaps.** Search the [Grand Comics Database](https://www.comics.org) (GCD), add a series, and get its full issue list. Tap through the grid to mark what you own or have read, and the app shows what's missing ("Es fehlen 12: 3, 7–9, 21–28").
- **Bulk entry for big collections.** Select by number range ("1-150, 152") and mark everything at once. A list view has one-tap toggles per issue.
- **Barcode scanner.** Scan with the phone camera: from the top of *Hinzufügen*, or on the phone from the scan icon at the top of *Start* and *Sammlung*. Known issues are found directly. For an unknown ISBN, the German National Library (DNB) or Open Library supplies title, volume and cover; you pick the matching GCD series once, and the code is remembered. Continuous mode marks known issues as owned and moves straight on to the next scan.
- **Several people, one catalog.** Everyone shares the catalog but has their own owned/read/wanted marks. An issue page shows when the other person owns it too.
- **Variants and reprints** count towards their number. Owning any printing of #5 counts as owning #5. You can show them separately with the "Varianten" switch.
- **The collection** with chips for gaps, complete and unread series (with counts), and publisher, language and format behind the filter button.
- Continue reading (the next unread issue you own, per series), wishlist, gaps across all series, ratings, notes, cover photos, CSV/JSON export.
- German and English interface, chosen per user.

## Where the data comes from

| | Source | Notes |
|---|---|---|
| Series, issue lists, details, credits | GCD API | Free and maintained by volunteers. Data under CC BY-SA 4.0. |
| ISBN lookups | DNB, Open Library | No account needed |
| Covers | Comic Vine API, DNB and Open Library by ISBN, your own photos | All stored by Stapel. Comic Vine needs a free API key. GCD's scans can't be used: GCD doesn't allow servers to download them, and its image server forbids showing them on other sites (`Cross-Origin-Resource-Policy`) |

**GCD rate limits.** GCD throttles hard. In testing, anonymous requests were blocked for about 40 minutes after roughly 50 requests in an hour. With an account the limits are reportedly 20 per minute, 200 per hour and 2000 per day. **Create a free account** at comics.org and put it in `.env` as `GCD_EMAIL`/`GCD_PASSWORD`. Stapel counts its own requests and stays below the limits. Searches are cached for 3 days, and series lists are refreshed weekly.

Issue details (date, price, ISBN, credits) come from a waiting list that is worked through slowly in the background: at most 25 requests an hour without an account (100 with one, set with `GCD_BACKGROUND_PER_HOUR`), spread evenly over the hour. Your own searches count towards that, so the more you search, the slower it goes. Issues you own go first, then wanted ones; "Details dieser Serie zuerst" in a series' ⋯ menu moves that series to the front. A series page shows how many issues are still waiting and roughly when they'll be done, and waiting issues have an hourglass. Issues whose details bring an ISBN get their cover from the DNB or Open Library. A big series takes a while: Lustiges Taschenbuch's ~600 numbers take about a day without an account. When GCD's limit is reached anyway, the app says when GCD is available again. Your collection keeps working in the meantime.

Adding a series costs **one** request, however many issues it has. Searching costs 1–5 requests, because GCD can't filter by language: Stapel reads its result pages until it has enough matches in the chosen languages.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, COMICVINE_API_KEY, GCD_EMAIL, GCD_PASSWORD, PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`). HTTPS is required for the camera. The first start creates the account `ADMIN_USER`, which is the admin. Add more people under Settings → Users. Behind Authelia (`AUTH_PROXY_SECRET`, see the [design kit](../../kit/README.md#login)) everyone gets an account by logging in there, and the first one is the admin.

**Update:** `docker compose up -d --build`. The data lives in the `stapel-data` volume (`stapel.db` plus `covers/`).

**Backup:** back up `stapel.db` with `sqlite3 stapel.db ".backup …"`, along with the `covers/` folder from the volume.

## Using it

**Entering an existing collection.** For each series: search it under *Hinzufügen*, add it, switch "Antippen" to *Besitz*, and tap what you own. For long runs, use the select button (☑) with a range like `1-200`. Scanning is the faster way to enter albums and books that have an ISBN.

**When GCD doesn't have a series:** "Selbst anlegen" creates a series by hand with numbers like `1-50`. Any series can get extra issues from its ⋯ menu.

**Covers:** come from [Comic Vine](https://comicvine.gamespot.com/api/) (free API key as `COMICVINE_API_KEY`). Each series is linked to a Comic Vine series: automatically when one clearly fits (same start year, similar number of issues, same publisher), otherwise pick it on the series page ("Auswählen", or "Comic-Vine-Serie für Cover" in the ⋯ menu). Covers are matched by number and downloaded in the background, about one every 2 seconds, so Lustiges Taschenbuch's 616 covers take about 20 minutes. Reprints and variants keep a placeholder. Issues without a Comic Vine cover but with an ISBN get one from the DNB or Open Library. "Foto" on an issue page takes your own, and it is never replaced.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | First account, created when there are no users |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of Stapel's own accounts |
| `GCD_EMAIL` / `GCD_PASSWORD` | – | GCD account for higher rate limits (recommended) |
| `COMICVINE_API_KEY` | – | Comic Vine API key for covers (recommended) |
| `GCD_PER_MINUTE` / `_HOUR` / `_DAY` | 20 / 200 / 2000 (without account: 10 / 40 / 400) | GCD limits Stapel stays under |
| `GCD_BACKGROUND_PER_HOUR` | 100 (without account: 25) | Requests per hour for covers and refreshes in the background, your searches included |
| `RESYNC_DAYS` | 7 | How often collected series are checked for new issues |
| `PORT` | 3067 | |
| `DATA_DIR` | `/data` | Where `stapel.db` and `covers/` live |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD, DATA_DIR=./data and your GCD account
npm run dev            # API on :3067, reads .env
npm run dev:web        # Vue with hot reload on :5167
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/gcd.js` is the rate-limited, cached GCD client. `server/catalog.js` imports series and issues and runs the background worker. `server/isbn.js` does the DNB/Open Library lookups. `server/comicvine.js` is the Comic Vine client and `server/covers.js` links series to it and downloads covers. `server/db.js` holds all SQL, and `server/server.js` the routes. Login, accounts, the frame with its navigation and the base styles come from the [design kit](../../kit/README.md) (`server/kit`, `web/src/kit`, copied by `node kit/sync.mjs`); Stapel adds admins and its own pages. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts). `npm run icons` regenerates the app icons.
