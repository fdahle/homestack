# Apps

Small self-hosted apps I run for myself and my family. Each folder is a separate, self-contained app with its own `package.json`, Dockerfile, `docker-compose.yml` and README, so you can use any one of them on its own. They share no code.

| Folder | App |
|---|---|
| [backlog/](backlog/) | Tracks which blog posts you have read |
| [fernweh/](fernweh/) | Map bookmarks: save places, sort them into collections, plan trips, share views |
| [stammbaum/](stammbaum/) | A pocket who-is-who for family gatherings |
| [stapel/](stapel/) | Tracks a comic collection: owned, read, missing |
| [zettel/](zettel/) | Notes and tasks as a PWA: works offline, optional end-to-end encryption, push reminders |

## Ports

Each app has its own port, so all of them can run side by side on one machine, in Docker or in development. Inside the containers nothing changes.

| App | Docker (`127.0.0.1:…`) | API without Docker | Vite dev server |
|---|---|---|---|
| fernweh | 3063 | 3063 | 5163 |
| stammbaum | 3065 | 3065 | 5165 |
| backlog | 3066 | 3066 | – |
| stapel | 3067 | 3067 | 5167 |
| zettel | 3070 (CouchDB 5984) | 3070 | 5170 |

`PORT` in an app's `.env` overrides its Docker port.

## Running them on a server

Each app's README explains how to run it with Docker. To keep a server up to date on its own after every push, see [autodeploy/](autodeploy/).

## Credits and licence

Stammbaum was created by [Maximilian Pierzyna](https://github.com/maxiimilian) in [maxiimilian/stammbaum](https://github.com/maxiimilian/stammbaum) and continued here. It stays under the GPL-3.0 (see [stammbaum/LICENSE](stammbaum/LICENSE)), and his commits are part of this repository's history. More in [stammbaum/README.md](stammbaum/README.md#credits).
