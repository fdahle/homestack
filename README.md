# Apps

Small self-hosted apps I run for myself and my family. Each folder in `apps/` is a separate, self-contained app with its own `package.json`, Dockerfile, `docker-compose.yml` and README, so you can use any one of them on its own. Next to them: `kit/`, the design kit they share, and `deploy/`, how the server runs them.

The newer apps share a look and some code through the [design kit](kit/): one set of colours, components, login and icon style, made for the phone and for a computer. The kit is copied into each app that uses it (`node kit/sync.mjs`), so every app still builds from its own folder.

| Folder | App |
|---|---|
| [backlog/](apps/backlog/) | Tracks which blog posts you have read |
| [checkpoint/](apps/checkpoint/) | Games you play: playing, finished, dropped, backlog; ratings, stats and a pick for what to play next |
| [fernweh/](apps/fernweh/) | Map bookmarks: save places, sort them into collections, plan trips, share views |
| [notizbuch/](apps/notizbuch/) | Notes that work offline: Markdown with checklists, labels, pictures and files, synced across your devices |
| [regal/](apps/regal/) | Your books with covers: want to read, reading, read; synced from Calibre |
| [stammbaum/](apps/stammbaum/) | A pocket who-is-who for family gatherings |
| [stammtisch/](apps/stammtisch/) | Stammtisch: your friends, what you did together, what you have planned; events from WhatsApp messages, reminders, calendar feed |
| [stapel/](apps/stapel/) | Tracks a comic collection: owned, read, missing |
| [todo/](apps/todo/) | To-do: tasks as quick as a note, with due dates, repeats, priorities, subtasks, reminders and a calendar feed; works offline |
| [watchlist/](apps/watchlist/) | Films and series, kept apart: watchlist, what you watched, episodes, what's next |

## Ports

Each app has its own port, so all of them can run side by side on one machine, in Docker or in development. Inside the containers nothing changes.

| App | Docker (`127.0.0.1:…`) | API without Docker | Vite dev server |
|---|---|---|---|
| fernweh | 3063 | 3063 | 5163 |
| stammbaum | 3065 | 3065 | 5165 |
| backlog | 3066 | 3066 | – |
| stapel | 3067 | 3067 | 5167 |
| stammtisch | 3068 | 3068 | 5168 |
| checkpoint | 3069 | 3069 | 5169 |
| notizbuch | 3070 | 3070 | 5170 |
| watchlist | 3071 | 3071 | 5171 |
| regal | 3072 | 3072 | 5172 |
| todo | 3073 | 3073 | 5173 |

`PORT` in an app's `.env` overrides its Docker port.

## How an app is built

So that every app runs, deploys and gets maintained the same way:

- **Folders:** `server/` (Express 5, the built-in `node:sqlite`), `web/` (Vue 3 + Vite) with the [design kit](kit/) copied into `web/src/kit` and `server/kit`, `scripts/make-icons.js`, `deploy/<domain>.conf` (nginx), `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`.
- **Commands:** `npm start` (the server, reads `.env`), `npm run dev` (the server with restarts), `npm run dev:web` (Vite with hot reload), `npm run build`, `npm test`, `npm run icons`.
- **Settings:** `ADMIN_USER` / `ADMIN_PASSWORD` (your account), `AUTH_PROXY_SECRET` (login through Authelia instead), `DATA_DIR` (`/data` in Docker), `PORT` (the table above), `TZ`.
- **Login and look:** from the kit: one account per person, light/dark/automatic, phone and computer layouts, an icon in the shared style.
- **Server:** `GET /healthz` answers without a login (Docker's health check); `node:24-alpine`, the server runs as the user `node`, data in the volume `/data`, the port only on `127.0.0.1`.
- **Offline apps** (Notizbuch, To-do) keep everything on the device and sync through the kit (`offline.js`, `sync.js`).

Exceptions, on purpose: **Fernweh** (`client/` and `api/`, its own login with a password chosen on the first visit), **Stammbaum** (TypeScript; the kit's colours and a Vue frame like the others, its pages still drawn by its own code; no login of its own: it sits behind Authelia).

## Trying them on your computer

```sh
node try.mjs              # which apps there are
node try.mjs todo         # one app (or several: node try.mjs todo notizbuch)
node try.mjs all          # all of them
node try.mjs todo --sample           # with sample data, on port + 1000 (To-do: 4073)
node try.mjs todo --sample --fresh   # the sample data made again from scratch
```

It installs what's missing, builds each app like the server does (service worker included, so offline works too) and starts it on its port. An app without a `.env` gets a local one with the account `felix` and a password, both printed at the end; an existing `.env` is used as it is. Data stays in each app's `data/` folder. Ctrl+C stops everything.

**Sample data:** with `--sample`, an app runs on `data-sample/` instead, filled once by its `scripts/sample.js`: entries for the awkward cases too (overdue, empty, very long, a list with 200 items), with dates relative to today. It's on its own port, so the browser keeps the sample's offline copy and login apart from your own. `--fresh` throws `data-sample/` away and fills it again, e.g. after a change to the schema. The script only runs locally, never on the server, and the sample stays off the network: no TMDB, IGDB, Comic Vine or geocoding, made-up blogs that are never scanned, and Regal reads a small Calibre library of its own in `data-sample/calibre/`. Logins are the usual ones from `.env`, except Fernweh (`fernweh-sample`) and Stapel's two extra accounts (`anna` / `local-anna`, `tom` / `local-tom`), all printed at the end.

## Running them on a server

Each app's README explains how to run it with Docker. To update a server on every push to GitHub, see [deploy/](deploy/).

## Credits and licence

Stammbaum was created by [Maximilian Pierzyna](https://github.com/maxiimilian) in [maxiimilian/stammbaum](https://github.com/maxiimilian/stammbaum) and continued here. It stays under the GPL-3.0 (see [apps/stammbaum/LICENSE](apps/stammbaum/LICENSE)), and his commits are part of this repository's history. More in [apps/stammbaum/README.md](apps/stammbaum/README.md#credits).
