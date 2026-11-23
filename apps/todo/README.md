# To-do

Self-hosted tasks that are as quick to write down as a note, and work offline. One field, type, Enter, done.

- **Quick add.** The field is at the top of every page and stays ready for the next task. Dates, times, priority, list and repeats can go right into the text, in German or English, and show up as chips before you press Enter (tap a chip to keep those words as text):
  - `Milch kaufen morgen` → due tomorrow
  - `Zahnarzt Fr 14:30 !!` → Friday 14:30, medium priority (`!` low, `!!` medium, `!!!` high)
  - `Müll rausbringen jeden Montag #haushalt` → weekly on Mondays, in the list Haushalt
  - `Geschenke 24.12.`, `in 2 Wochen`, `nächste Woche`, `übermorgen`, `um 9`, `3pm`, `täglich`, `werktags`, `alle 3 Tage`, …

  Or set them with the three buttons under the field. New tasks take the page's day or list.
- **Subtasks**, folding open right in the list, ticked off there or on the task's page (Enter makes the next one, like a checklist).
- **Priorities**: none, low, medium, high, shown as the colour of the tick circle; the most important come first.
- **Repeats**: daily, weekdays, weekly, every 2 weeks, monthly, yearly, or your own (every n days/weeks/months/years, chosen weekdays), counted from the due date or from the day you did it. Ticking one off moves it to its next date and keeps a done copy. "Monthly on the 31st" stays on the 31st after a short month.
- **Today** (overdue on top, with one tap to move them all to today), **Upcoming** day by day or as a month, **Lists** with colours and the inbox, a search across everything. Ticking off and deleting can be undone.
- **Reminders** as push notifications at a task's time, and a morning overview of the day (or not, in the settings).
- **Calendar feed**: a secret address your phone's calendar subscribes to, so open tasks with a date show up next to Stammtisch's plans.
- **Offline first**, like Notizbuch: all tasks are on the device, changes wait and sync when it's online. On a computer a task opens beside the list, and a list's page has all your lists as chips at the top, one click apart. German and English.

## How the sync works

Each device writes to its own copy first (IndexedDB) and puts the change into an outbox. `POST /api/sync` sends the outbox and gets back everything changed since the device last asked (a number from one counter on the server). Ids are made on the device, so tasks written offline already exist. Changes are per field, and the latest change to a field wins. Ticking off a repeating task is done on the device (the next date comes from `web/src/lib/repeat.js`), so it works offline too. Details in `server/tasks.js` and `web/src/store/tasks.js`.

## Deploy

```sh
cp .env.example .env        # set ADMIN_PASSWORD and maybe PORT, TZ
docker compose up -d --build
```

The app listens on `127.0.0.1:$PORT`. Put nginx in front of it with HTTPS (see `deploy/`); offline use, reminders and installing it as an app all need HTTPS. The first start creates the account `ADMIN_USER`. Reminders need no setup: the push keys are made on the first start and kept in the database.

**Update:** `docker compose up -d --build`. Everything lives in the `todo-data` volume (`todo.db`). **Backup:** `sqlite3 todo.db ".backup …"`. After putting a backup back, each device notices on its next sync: it fetches everything again and sends back the tasks and lists the backup is missing ([kit](../../kit/README.md#offline-notizbuch-to-do)).

**Behind Authelia:** set `AUTH_PROXY_SECRET` (see [deploy/](../../deploy/README.md#one-login-for-all-apps)), and let `/ics/` through without a login (calendar apps can't log in; the address itself is the secret), like Stammtisch's rule in [authelia.yml](../../deploy/authelia.yml).

## Configuration

| Variable | Default | |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / – | Your account, created when there is none |
| `AUTH_PROXY_SECRET` | – | Log in through Authelia instead of To-do's own account |
| `TZ` | `Europe/Berlin` | Due dates, times and reminders are in this time zone |
| `TRASH_DAYS` | 7 | Days a deleted task can come back on other devices before it's gone for good |
| `VAPID_SUBJECT` | – | A `mailto:` for the push services (optional) |
| `PORT` | 3073 | |
| `DATA_DIR` | `/data` | Where `todo.db` lives |

Tasks belong to the account that wrote them, so with Authelia each person has their own.

## Developing

Needs Node 24 or newer (it uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env    # set ADMIN_PASSWORD and DATA_DIR=./data
npm run dev            # API on :3073, reads .env
npm run dev:web        # Vue with hot reload on :5173
npm test               # sync, reminders, the calendar feed, repeats, quick add
```

`npm run build` builds the frontend into `dist/` (with `dist/sw.js`), which the server serves when it exists. The service worker (offline and reminders) only runs in the build.

Code map: `server/tasks.js` holds the SQL and the sync, `server/reminders.js` the push reminders, `server/ics.js` the calendar feed, `server/server.js` the routes. In `web/src`, `store/tasks.js` is the device's copy and the sync, `lib/quick.js` reads dates and the rest out of a quick-add line, `lib/repeat.js` works out the next date of a repeating task, `components/QuickAdd.vue` and `components/TaskRow.vue` are the field and the rows. `npm run icons` regenerates the app icons.
