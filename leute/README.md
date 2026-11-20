# Leute

A self-hosted notebook for your friends: who they are, what you did together, what you have planned. For one person; nobody else sees it.

- **Friends** with photo, birthday (the year is optional), address with a Google Maps link, how you met, circles ("Uni", "Klettern") and things worth knowing such as "partner: Lisa", "vegetarian", "shoe size 44", grouped into family, work, hobbies, food and other.
- **Everything you do together** in one list: meetups, calls, trips, parties, and notes about their lives ("got a new job"). Each one is an *idea* (no date yet), *planned*, *happened* or *cancelled*. A plan whose day has passed asks on the home page whether it happened.
- **Timeline** across all friends, or per friend, filterable by friend, circle, kind and text. The home page shows what is coming up, birthdays in the next 30 days, who you wanted to get in touch with more often, and what happened on this day in earlier years.
- **Gift ideas** per friend, and what you already gave them.
- **WhatsApp**: copy or share messages into Leute and get a pre-filled event. Date, time and people are guessed ("Samstag 19 Uhr", "morgen", "am 24.11.", "tomorrow at 7pm").
- **Reminders** as push notifications: birthdays a week before (with your gift ideas) and on the day, plans the day before, and friends you haven't been in touch with for longer than you set.
- **Calendar feed**: a secret ICS address with plans, the last two years and birthdays for your phone's calendar.
- **On a computer** the tabs become a sidebar, the home page puts plans, birthdays and friends to get in touch with side by side, and a friend or an event opens beside the list (friends, timeline, home) so you keep your place. `/` jumps to the search, `Esc` closes what's open beside it. Copied WhatsApp messages can be pasted anywhere with Ctrl+V.
- **Fernweh**: with [Fernweh](../fernweh/) set up, your friends appear on its map, and a friend's page links to them there (see below).
- German and English interface, JSON export.

## WhatsApp

WhatsApp has no API for personal accounts, so Leute works with what the app offers:

| | How | What you get |
|---|---|---|
| Copy on the phone | Long-press messages in a chat, select more, *Copy*, then *Aus WhatsApp* → *Einfügen* in Leute | A draft event. With more than one message the copy includes date and sender, so "morgen" counts from when it was written and the sender becomes the friend |
| Copy on the computer | In WhatsApp Web or Desktop, select messages with the mouse, Ctrl+C, then Ctrl+V anywhere in Leute (outside a text field) | The same. On a friend's page that friend is added |
| Share | Install Leute on an Android phone (browser menu → *Add to home screen*), then share text to *Leute* | The same, straight from the share menu |

Senders are matched to friends by full name, nickname, a first name only one friend has, or the phone number. Your own messages are recognised by your display name and the names under Settings → WhatsApp. iPhones can't share to web apps; copying and pasting works there.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, VAPID_SUBJECT, PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); push notifications and installing the app need HTTPS. The first start creates the account `ADMIN_USER`.

**Login through Authelia:** `deploy/friends.fdahle.de.conf` is the version behind the homestack Authelia login (with a second factor, see [deploy/README.md](../deploy/README.md#one-login-for-all-apps)). Set `AUTH_PROXY_SECRET` in `.env` and the same value in `/etc/nginx/homestack-secrets/leute.conf`. Leute then takes the user from Authelia and makes an account for them the first time; your friends and everything else don't belong to an account, so they all stay. Only the language and display name start fresh (set them under Settings), and push reminders use the language of the newest account. The calendar feed `/ics/…` stays reachable for calendar apps through Authelia's bypass rule for it ([deploy/authelia.yml](../deploy/authelia.yml)).

**Renamed from Bande:** on a server that ran it as `bande/`, after the update pulls the new folder:

```sh
cd /srv/docker/homestack
mv bande/.env bande/docker-compose.override.yml leute/ 2>/dev/null
echo "COMPOSE_PROJECT_NAME=bande" >> leute/.env   # keeps the Docker volume, and with it all data
rm -rf bande                                       # what's left there is ignored by git
```

and `bande` → `leute` in `APPS` in `/etc/homestack-deploy.conf`, then `homestack-deploy --all`. If `.env` already had a `COMPOSE_PROJECT_NAME`, keep that one instead. The nginx secret file becomes `/etc/nginx/homestack-secrets/leute.conf`. The database file, the login cookie and the calendar feed keep their old names, so you stay logged in and calendar subscriptions keep working.

**Update:** `docker compose up -d --build`. The data lives in the `bande-data` volume (`bande.db` plus `photos/`).

**Backup:** back up `bande.db` with `sqlite3 bande.db ".backup …"`, along with the `photos/` folder from the volume.

## Using it

**Reminders** are switched on per device under Settings → *Erinnerungen*. On a phone, install Leute to the home screen first. They go out once a day from `REMINDER_HOUR`. The keys for web push are made on the first start and kept in the database.

**Calendar:** Settings → *Kalender* shows the feed's address. Subscribe to it in your calendar app (Google Calendar: *Other calendars* → *From URL*). Anyone with the address can read it; *Neue Adresse* replaces it.

**"Get in touch every …"** on a friend counts meetups, calls, trips and parties as contact. A plan with them stops the reminder.

## Fernweh

[Fernweh](../fernweh/) (your saved places) can show your friends on its map. It asks Leute for them over a small API, server to server:

`GET /api/link/people` with `Authorization: Bearer <LINK_TOKEN>` answers `{ "people": [{ "id", "name", "nickname", "city", "address", "archived", "updated_at" }] }` for all friends. Nothing else leaves Leute: no phone numbers, e-mail addresses, birthdays or notes. Without `LINK_TOKEN` the API isn't there (404); a missing or wrong token gets a 401. It doesn't go through the login (Fernweh has none in Leute), so the token is the only key: make it long.

1. Make a secret, `openssl rand -hex 32`, and put it into Leute's `.env` as `LINK_TOKEN` and into Fernweh's as `LEUTE_LINK_TOKEN`.
2. Fernweh reaches Leute over a shared Docker network, not through nginx. Create it once, `docker network create homestack`, and put a `docker-compose.override.yml` next to Leute's `docker-compose.yml`:

   ```yaml
   services:
     leute:
       networks: [default, homestack]
   networks:
     homestack:
       external: true
   ```

   Fernweh joins the same network and calls `http://leute:3000`.
3. Set `FERNWEH_URL` (e.g. `https://places.fdahle.de`) in Leute's `.env`: a friend's page with an address or city then links *Auf der Karte* to `$FERNWEH_URL/?leute=<id>`, which opens them on Fernweh's map.
4. `docker compose up -d` in both.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `REMINDER_HOUR` | 9 | Push reminders go out from this hour on (server time, `TZ`) |
| `VAPID_SUBJECT` | `mailto:leute@localhost` | Contact address for the browsers' push services (`mailto:` or `https:`) |
| `PORT` | 3068 | |
| `DATA_DIR` | `/data` | Where `bande.db` and `photos/` live |
| `TZ` | `Europe/Berlin` | Decides what "today" is |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of Leute's own account (see [design/](../design/README.md#login)) |
| `LINK_TOKEN` | – | Shared secret for Fernweh's link API (`LEUTE_LINK_TOKEN` there); unset = no API |
| `FERNWEH_URL` | – | Fernweh's address, for the *Auf der Karte* link on a friend's page; unset = no link |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD and DATA_DIR=./data
npm run dev            # API on :3068, reads .env
npm run dev:web        # Vue with hot reload on :5168
npm test               # dates, WhatsApp, birthdays, the Fernweh link API, the kit's login
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/db.js` holds all SQL, `server/server.js` the routes. `server/dates.js` finds dates and times in German and English text, `server/whatsapp.js` reads copied messages, matches senders to friends and builds draft events. `server/friends.js` works out birthdays and who is overdue, `server/reminders.js` sends the push notifications, `server/ics.js` writes the calendar feed, `server/link.js` is the API for Fernweh. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts); `web/public/sw.js` shows push messages; shares arrive as `/share?text=…` (see the manifest). `npm run icons` regenerates the app icons.

The layout, login and common components come from the homestack [design kit](../design/): the files in `web/src/kit/`, `server/kit/` and `scripts/kit/` are copies. Change them in `design/` and run `node design/sync.mjs` from the repository root.
