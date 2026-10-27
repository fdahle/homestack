# Apps

Small self-hosted apps I run for myself and my family. Each folder is a separate, self-contained app with its own `package.json`, Dockerfile, `docker-compose.yml` and README, so you can use any one of them on its own. They share no code.

| Folder | App |
|---|---|
| [backlog/](backlog/) | Tracks which blog posts you have read |
| [mapper/](mapper/) | Map bookmarks: save places, sort them into collections, plan trips, share views |
| [planner/](planner/) | Planner and notes PWA: works offline, optional end-to-end encryption, push reminders |
| [stammbaum/](stammbaum/) | A pocket who-is-who for family gatherings |
| [stapel/](stapel/) | Tracks a comic collection: owned, read, missing |

## Ports

Each app has its own port, so all of them can run side by side on one machine, in Docker or in development. Inside the containers nothing changes.

| App | Docker (`127.0.0.1:…`) | API without Docker | Vite dev server |
|---|---|---|---|
| mapper | 3063 | 3063 | 5163 |
| stammbaum | 3065 | 3065 | 5165 |
| backlog | 3066 | 3066 | – |
| stapel | 3067 | 3067 | 5167 |
| planner | 3070 (CouchDB 5984) | 3070 | 5170 |

`PORT` in an app's `.env` overrides its Docker port.

## Credits and licence

Stammbaum was created by [Maximilian Pierzyna](https://github.com/maxiimilian) in [maxiimilian/stammbaum](https://github.com/maxiimilian/stammbaum) and continued here. It stays under the GPL-3.0 (see [stammbaum/LICENSE](stammbaum/LICENSE)), and his commits are part of this repository's history. More in [stammbaum/README.md](stammbaum/README.md#credits).

The history of every app, including its earlier repository, is kept in this one.
