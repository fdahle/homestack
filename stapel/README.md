# Stapel

A self-hosted tracker for a comic collection: which comics you own, which you've read, and what's missing from a series. Made for German comics (albums, Taschenbücher, Hefte), and it works for American ones too. There is no reader; it only keeps track.

- **Add a series, see the gaps.** Search the [Grand Comics Database](https://www.comics.org) (GCD), add a series, and get its full issue list. Tap through the grid to mark what you own or have read, and the app shows what's missing ("Es fehlen 12: 3, 7–9, 21–28").
- **Bulk entry for big collections.** Select by number range ("1-150, 152") and mark everything at once. A list view has one-tap toggles per issue.
- **Barcode scanner.** Scan with the phone camera. Known issues are found directly. For an unknown ISBN, the German National Library (DNB) or Open Library supplies title, volume and cover; you pick the matching GCD series once, and the code is remembered. Continuous mode marks known issues as owned and moves straight on to the next scan.
- **Several people, one catalog.** Everyone shares the catalog but has their own owned/read/wanted marks. An issue page shows when the other person owns it too.
- **Variants and reprints** count towards their number. Owning any printing of #5 counts as owning #5. You can show them separately with the "Varianten" switch.
- Continue reading (the next unread issue you own, per series), wishlist, gaps across all series, ratings, notes, cover photos, CSV/JSON export.
- German and English interface, chosen per user.

## Where the data comes from

| | Source | Notes |
|---|---|---|
| Series, issue lists, details, credits | GCD API | Free and maintained by volunteers. Data under CC BY-SA 4.0. |
| ISBN lookups | DNB, Open Library | No account needed |
| Covers | GCD (shown by your browser), DNB and Open Library (stored), your own photos | GCD doesn't allow servers to download its scans, so Stapel only stores links to them |

**GCD rate limits.** GCD throttles hard. In testing, anonymous requests were blocked for about 40 minutes after roughly 50 requests in an hour. With an account the limits are reportedly 20 per minute, 200 per hour and 2000 per day. **Create a free account** at comics.org and put it in `.env` as `GCD_EMAIL`/`GCD_PASSWORD`. Stapel counts its own requests and stays below the limits. Searches are cached for 3 days, and series lists are refreshed weekly. The issue details behind the covers load in the background, one request every 10 seconds, with the issues you own going first. When the limit is reached, the app says when GCD is available again. Your collection keeps working in the meantime.

Adding a series costs **one** request, however many issues it has. Searching costs 1–5 requests, because GCD can't filter by language: Stapel reads its result pages until it has enough matches in the chosen languages.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, GCD_EMAIL, GCD_PASSWORD, PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`). HTTPS is required for the camera. The first start creates the account `ADMIN_USER`. Add more people under Settings → Users.

**Update:** `docker compose up -d --build`. The data lives in the `stapel-data` volume (`stapel.db` plus `covers/`).

**Backup:** back up `stapel.db` with `sqlite3 stapel.db ".backup …"`, along with the `covers/` folder from the volume.

## Using it

**Entering an existing collection.** For each series: search it under "Suchen", add it, switch "Antippen" to *Besitz*, and tap what you own. For long runs, use the select button (☑) with a range like `1-200`. Scanning is the faster way to enter albums and books that have an ISBN.

**When GCD doesn't have a series:** "Selbst anlegen" creates a series by hand with numbers like `1-50`. Any series can get extra issues from its ⋯ menu.

**Covers:** GCD covers come with the issue details, which load in the background. "Cover laden" in a series' ⋯ menu moves that series to the front of the queue. Issues with an ISBN get a stored cover from the DNB. "Foto" on an issue page takes your own.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | First account, created when there are no users |
| `GCD_EMAIL` / `GCD_PASSWORD` | – | GCD account for higher rate limits (recommended) |
| `GCD_PER_MINUTE` / `_HOUR` / `_DAY` | 20 / 200 / 2000 | GCD limits Stapel stays under |
| `RESYNC_DAYS` | 7 | How often collected series are checked for new issues |
| `PORT` | 3000 | |
| `DATA_DIR` | `/data` | Where `stapel.db` and `covers/` live |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
ADMIN_PASSWORD=testtest DATA_DIR=./data npm run dev   # API on :3000
npm run dev:web                                       # Vue with hot reload on :5173
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/gcd.js` is the rate-limited, cached GCD client. `server/catalog.js` imports series and issues and runs the background worker. `server/isbn.js` does the DNB/Open Library lookups. `server/db.js` holds all SQL, and `server/server.js` the routes. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts). `npm run icons` regenerates the app icons.
