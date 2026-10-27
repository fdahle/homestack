# Backlog

A small self-hosted "Podcast Addict for blogs": it imports the **full** post history of the blogs you follow, and keeps track of which posts you have read.

- Finds every post via the WordPress API, the Substack API, the sitemap, the RSS feed, or by scraping archive pages
- Oldest-first lists, an unread filter, a progress bar per blog, and a "Continue" button that opens the next unread post
- Asks "Finished reading?" when you come back from an article
- "Mark this and all older as read" for catching up on blogs you already partly read
- Mark posts read straight from the blog: Android share sheet, a bookmarklet, or an iOS Shortcut
- Read-later stars, a "New posts" section, hiding non-posts, JSON export and import
- **Discover**: suggests new blogs based on what your blogs link to, Substack recommendations, and (optionally) Claude
- Rescans every blog every 12 h (configurable)

## Deploy

On the server:

```sh
git clone <this repo> backlog && cd backlog
cp .env.example .env        # set APP_PASSWORD
docker compose up -d --build
```

The app listens on `127.0.0.1:3000`. Put nginx in front of it with HTTPS. HTTPS is needed to install the app on a phone.

```nginx
server {
    listen 443 ssl http2;
    server_name backlog.example.com;
    # ssl_certificate / ssl_certificate_key, e.g. from certbot

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;   # testing a big blog's settings can take a while
    }
}
```

If nginx runs in Docker too, put both containers in the same network and use `proxy_pass http://backlog:3000;`. In that case, remove the `ports:` section.

**Update:** `git pull && docker compose up -d --build`. The data lives in the `backlog-data` volume, so rebuilding keeps it.

**Backup:** Tools → Export, or copy `backlog.db` out of the volume.

## Using it

**Add a blog:** use the + button and paste the address. Backlog picks the best source on its own:

| Blog runs on | Source used | Full history? |
|---|---|---|
| WordPress (e.g. acoup.blog) | WordPress REST API | yes |
| Substack (e.g. astralcodexten.com) | Substack archive API | yes |
| Most other blogs | sitemap.xml | yes; titles are fetched page by page in the background |
| Only a feed | RSS/Atom | no, only what's in the feed. Set up archive scraping for the rest |
| Nothing | archive scraping | you set the CSS selectors |

**Archive scraping** (blog settings → Advanced): set the page that lists the posts, a CSS selector for the post links, and optionally a selector for the "older posts" link. Use **Test without saving** to see what it finds before you save. Example for paulgraham.com, whose feed stopped updating in 2023:

- Archive page URL: `https://paulgraham.com/articles.html`
- Post link selector: `font a`
- Only URLs matching: `paulgraham\.com/\w+\.html$`
- Skip URLs matching: `/rss\.html`

**Getting rid of junk:** if a sitemap includes pages that aren't posts, either use "⋯ → Hide" on each one, or add a skip pattern in the settings. Existing entries that no longer match are hidden on the next scan.

**Already read part of a blog?** Open the post you got to, then "⋯ → Mark this and all older as read".

**Marking posts as read while on the blog:**
- *Android:* open Backlog in Chrome → menu → "Add to home screen" / "Install". After that, *Share → Backlog* on any post marks it read and offers the next one.
- *Desktop:* drag the bookmarklet from the Tools page to your bookmarks bar.
- *iPhone:* make a Shortcut that accepts URLs from the share sheet and opens `https://your-host/mark?url=` plus the URL (use "URL Encode" on it first).

## Discover

The compass icon on the home screen opens a list of suggested blogs. Suggestions come from:

1. **What your blogs link to.** In the background, Backlog visits each post once (one request per second) and records which other sites it links to. A site gets a high score when many posts link to it, when several of your blogs agree, and especially when the linking posts are ones you've read.
2. **Substack recommendations** from the Substacks you follow.
3. **Claude** (optional, set `ANTHROPIC_API_KEY`). The "Ask Claude" box sends the names of your blogs and the titles of the posts you read recently. You can add what you're in the mood for ("Byzantine history"). It runs only when you press the button. It uses Claude Opus 5.5 with Anthropic's server-side fallback switched on: if a safety check declines the request, another model answers instead.

Before a suggestion is shown, its site is checked once. It needs posts in a feed or on Substack, no more than ~2 posts a day (to filter out news sites), and to be written in one of `READ_LANGUAGES`. This also drops blogs Claude might have made up. "Not interested" hides a site for good. The list refreshes weekly, or when you press Refresh.

The very first suggestions appear once about a quarter of your posts have been visited. With a few thousand posts, that takes about an hour.

## Configuration

| Variable | Default | |
|---|---|---|
| `APP_PASSWORD` | – | Login password. If empty, the app has no login (e.g. if nginx does basic auth) |
| `SCAN_INTERVAL_HOURS` | 12 | How often each blog is rescanned |
| `REQUEST_DELAY_MS` | 1000 | Pause between requests to the same site |
| `HARVEST_LINKS` | 1 | Set to `0` to stop visiting posts for links (sitemap titles are still fetched) |
| `DISCOVER_INTERVAL_DAYS` | 7 | How often suggestions refresh on their own |
| `READ_LANGUAGES` | `en,de` | Languages you read; suggestions in others are skipped |
| `ANTHROPIC_API_KEY` | – | Enables "Ask Claude" on the Discover page |
| `AI_MODEL` | `claude-opus-5-5` | Model used for "Ask Claude" |
| `USER_AGENT` | `Mozilla/5.0 (compatible; Backlog/1.0; …)` | |
| `DATA_DIR` | `/data` | Where `backlog.db` lives |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
APP_PASSWORD=test DATA_DIR=./data npm start   # http://localhost:3000
```

Code map: `src/discover.js` finds posts (one function per strategy), `src/scanner.js` queues and schedules scans and runs the background post visits, `src/suggest.js` builds the Discover suggestions, `src/db.js` holds all SQL, `src/views.js` holds the HTML, `public/app.js` holds the client-side interactions. `npm run icons` regenerates the app icons.
