# Bande

A self-hosted notebook for your friends: who they are, what you did together, what you have planned. For one person; nobody else sees it.

- **Friends** with photo, birthday (the year is optional), where they live, how you met, circles ("Uni", "Klettern") and free notes such as "partner: Lisa", "vegetarian", "shoe size 44".
- **Everything you do together** in one list: meetups, calls, trips, parties, and notes about their lives ("got a new job"). Each one is an *idea* (no date yet), *planned*, *happened* or *cancelled*. A plan whose day has passed asks on the home page whether it happened.
- **Timeline** across all friends, or per friend, filterable by friend, circle, kind and text. The home page shows what is coming up, birthdays in the next 30 days, who you wanted to get in touch with more often, and what happened on this day in earlier years.
- **Gift ideas** per friend, and what you already gave them.
- **WhatsApp**: copy or share messages into Bande and get a pre-filled event. Date, time and people are guessed ("Samstag 19 Uhr", "morgen", "am 24.11.", "tomorrow at 7pm"). Importing an exported chat shows how much you write each month and lists the messages that look like plans.
- **Reminders** as push notifications: birthdays a week before (with your gift ideas) and on the day, plans the day before, and friends you haven't been in touch with for longer than you set.
- **Calendar feed**: a secret ICS address with plans, the last two years and birthdays for your phone's calendar.
- German and English interface, JSON export.

## WhatsApp

WhatsApp has no API for personal accounts, so Bande works with what the app offers:

| | How | What you get |
|---|---|---|
| Copy messages | Long-press messages in a chat, select more, *Copy*, then *Aus WhatsApp* → *Einfügen* in Bande | A draft event. With more than one message the copy includes date and sender, so "morgen" counts from when it was written and the sender becomes the friend |
| Share | Install Bande on an Android phone (browser menu → *Add to home screen*), then share text to *Bande* | The same, straight from the share menu |
| Export a chat | In the chat: ⋮ → More → *Export chat* → *Without media* → share to *Bande*, or save the file and pick it under *Chat importieren* | Messages per month on the friend's page, "last in touch" from the chat, and plan-like messages to take over as events |

On import you tell Bande once who is who; it remembers the names (and your own) for later imports and copied messages. Only the number of messages per month is stored, never the messages. Importing the same chat again replaces the old counts. iPhones can't share to web apps; copying and pasting works there.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD, VAPID_SUBJECT, PORT
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); push notifications and installing the app need HTTPS. The first start creates the account `ADMIN_USER`.

**Update:** `docker compose up -d --build`. The data lives in the `bande-data` volume (`bande.db` plus `photos/`).

**Backup:** back up `bande.db` with `sqlite3 bande.db ".backup …"`, along with the `photos/` folder from the volume.

## Using it

**Reminders** are switched on per device under Settings → *Erinnerungen*. On a phone, install Bande to the home screen first. They go out once a day from `REMINDER_HOUR`. The keys for web push are made on the first start and kept in the database.

**Calendar:** Settings → *Kalender* shows the feed's address. Subscribe to it in your calendar app (Google Calendar: *Other calendars* → *From URL*). Anyone with the address can read it; *Neue Adresse* replaces it.

**"Get in touch every …"** on a friend counts meetups, calls, trips, parties and one-to-one WhatsApp chats as contact. A plan with them stops the reminder.

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `REMINDER_HOUR` | 9 | Push reminders go out from this hour on (server time, `TZ`) |
| `VAPID_SUBJECT` | `mailto:bande@localhost` | Contact address for the browsers' push services (`mailto:` or `https:`) |
| `PORT` | 3068 | |
| `DATA_DIR` | `/data` | Where `bande.db` and `photos/` live |
| `TZ` | `Europe/Berlin` | Decides what "today" is |

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
ADMIN_PASSWORD=testtest DATA_DIR=./data npm run dev   # API on :3068
npm run dev:web                                       # Vue with hot reload on :5168
npm test                                              # date, WhatsApp and birthday parsing
```

`npm run build` builds the frontend into `dist/`, which the server serves when it exists.

Code map: `server/db.js` holds all SQL, `server/server.js` the routes. `server/dates.js` finds dates and times in German and English text, `server/whatsapp.js` reads chats (text, copied messages, zip exports), matches senders to friends and builds draft events. `server/friends.js` works out birthdays and who is overdue, `server/reminders.js` sends the push notifications, `server/ics.js` writes the calendar feed. The Vue app is in `web/src` (`views/` per page, `i18n.js` for the German and English texts); `web/public/sw.js` receives shares and push messages. `npm run icons` regenerates the app icons.
