# Deploy

Every push to `main` updates the server: the [Deploy workflow](../.github/workflows/deploy.yml) logs in over SSH with a key that can do exactly one thing, start `homestack-deploy.service`. The server then fetches this repository itself, fast-forwards its checkout and rebuilds only the apps whose folder changed. If a build fails, the old version keeps running and the workflow run turns red.

GitHub never gets a shell or Docker on the server: a leaked key could only start a deploy of what is already on GitHub.

## Server setup

One checkout for all apps, owned by a normal user (git runs as that user, docker as root):

```sh
git clone https://github.com/fdahle/homestack.git /srv/docker/homestack
```

In each app's folder (`apps/<app>/`), put what belongs to your server only. Git ignores all of it:

- `.env`: the app's settings (see its `.env.example`). If the app ran before from a folder with another name, add `COMPOSE_PROJECT_NAME=<old folder name>` so Docker keeps using the same volumes and container names.
- `docker-compose.override.yml`: changes to the app's `docker-compose.yml` for your server (limits, volumes, ports). Compose reads it on its own.
- the app's data folder, where it has one.

Then, as root:

```sh
install -m 755 deploy/homestack-deploy /usr/local/sbin/
install -m 644 deploy/homestack-deploy.service /etc/systemd/system/
install -m 600 deploy/homestack-deploy.conf.example /etc/homestack-deploy.conf   # list your apps in APPS
systemctl daemon-reload
homestack-deploy --all

# A user that may only start the deploy
useradd --system --create-home --shell /bin/sh ghdeploy
usermod -p '*' ghdeploy   # no password, but not "locked": with UsePAM no, sshd refuses locked accounts even with a key
echo 'ghdeploy ALL=(root) NOPASSWD: /usr/bin/systemctl start homestack-deploy.service' > /etc/sudoers.d/homestack-deploy
chmod 440 /etc/sudoers.d/homestack-deploy
install -d -m 755 -o root ~ghdeploy/.ssh
# One line, with the public half of the key below:
# restrict,command="sudo -n /usr/bin/systemctl start homestack-deploy.service" ssh-ed25519 AAAA... github-actions
nano ~ghdeploy/.ssh/authorized_keys
```

The script is copied rather than run from the checkout, so a push can't change what runs as root. After changing it here, install it again.

## GitHub

Make a key pair just for this (`ssh-keygen -t ed25519 -N '' -f deploy-key`). The public half goes into `authorized_keys` above. Then add four repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | the private half (`deploy-key`), then delete the file |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan -p <port> <host>`, checked against the server's own host keys |
| `DEPLOY_HOST` | the server's address |
| `DEPLOY_PORT` | its SSH port |

## Once: the apps moved into apps/

The apps used to sit at the top of the repository; now they're in `apps/`, the design kit is `kit/`, and Flimmer, Zettel, Haken and Leute are called Watchlist, Notizbuch, To-do and Stammtisch. After the push with that change, the installed deploy script can't find the apps and leaves the running containers alone. Then, on the server:

```sh
git -C /srv/docker/homestack pull                    # as the checkout's owner
sudo sh /srv/docker/homestack/deploy/move-to-apps.sh
```

It moves each app's `.env`, `docker-compose.override.yml` and data folder (Fernweh's and Stammbaum's `data/`, after stopping them) into `apps/<app>/`, renames the four apps in `APPS`, installs the new deploy script and rebuilds everything.

Stammtisch and Watchlist drop their old names in Docker too. The script stops and removes the old containers (Docker projects `bande` and `flimmer`) and copies their volumes into new ones, `stammtisch_stammtisch-data` and `watchlist_watchlist-data`, renaming `bande.db` and `flimmer.db` on the way. The old volumes stay as a backup: `docker volume rm bande_bande-data flimmer_flimmer-data` once everything works. It also renames the nginx secret `leute.conf` to `stammtisch.conf` (and the include in the installed site config), `LEUTE_…` to `STAMMTISCH_…` in Fernweh's `.env`, and the service `leute` to `stammtisch` in the `docker-compose.override.yml` files. The login cookies have new names, so you log in once more; Stammtisch's calendar events get new ids. Fernweh renames its own database columns when it starts.

The old Zettel's containers stop, because Notizbuch uses its port; its CouchDB volume stays until you remove it. In Notizbuch's `.env`, `ADMIN_USERNAME` is now called `ADMIN_USER`.

The nginx configs only changed in their comments and Stammtisch's secret file name (which the script fixes in the installed copy); the ports are the same.

## Day to day

- `journalctl -u homestack-deploy` shows what was deployed and why something failed.
- Re-run a failed workflow on GitHub to try the same commit again, or run `homestack-deploy --all` on the server to rebuild every app (after a base image update, for example).
- nginx configs (each app's `deploy/`) aren't applied automatically. Copy them yourself when they change.

## One login for all apps

Authelia's session cookie is set for `fdahle.de`, so it covers every subdomain: log in once and each app behind it knows you. With "remember me" the login lasts a year (`remember_me` in [authelia.yml](authelia.yml)); the sensitive apps ask for the second factor once per login, not every time.

**Server, once:**

1. Merge [authelia.yml](authelia.yml) into Authelia's configuration (adjust the domains marked "yours") and put yourself into the `admin` group. Restart Authelia.
2. `install -m 644 deploy/nginx/homestack-authelia.conf /etc/nginx/snippets/` (next to Authelia's own `authelia-location.conf` and `authelia-authrequest.conf`, which Stammbaum already uses).
3. `install -d -m 750 -o root -g www-data /etc/nginx/homestack-secrets`

**Per app** that uses the [design kit](../kit/README.md#login) (Backlog, Checkpoint, Watchlist, Regal, Stammtisch, Stapel, Notizbuch, To-do) or follows it (Fernweh), shown for Stammtisch:

```sh
secret=$(openssl rand -hex 32)
echo "AUTH_PROXY_SECRET=$secret" >> /srv/docker/homestack/apps/stammtisch/.env
echo "proxy_set_header X-Auth-Proxy-Secret \"$secret\";" > /etc/nginx/homestack-secrets/stammtisch.conf
chmod 640 /etc/nginx/homestack-secrets/stammtisch.conf
cp apps/stammtisch/deploy/friends.fdahle.de.conf /etc/nginx/sites-available/   # the Authelia version
nginx -t && systemctl reload nginx
cd /srv/docker/homestack/apps/stammtisch && docker compose up -d
```

The app then has no login page of its own: it takes the user from Authelia and makes an account for them the first time. The apps are for one person and their data doesn't belong to an account, so nothing is lost when you switch; only the language setting starts again at German. Fernweh simply treats whoever Authelia lets in as its one user. That's why the apps with one shared library (Watchlist, Checkpoint, Regal, Backlog, Fernweh) need an Authelia rule for you alone, plus `AUTH_PROXY_USERS=felix` in their `.env` (names separated by commas): with it the app lets nobody else in, even if a rule is too wide. [authelia.yml](authelia.yml) has the rules ready. When the Authelia login runs out, the app reloads itself and lands on Authelia's login page.

**Where each app stands:**

| App | Login |
|---|---|
| Stammtisch | Behind Authelia with a second factor (only you, group `admin`) |
| Stammbaum | Behind Authelia, with its own `STAMMBAUM_PROXY_SECRET` |
| Checkpoint, Watchlist, Regal | Their own password (`ADMIN_PASSWORD`); ready for Authelia with the steps above whenever you want |
| Fernweh | Its own password; ready for Authelia too (`AUTH_PROXY_SECRET`, conf in its `deploy/`) |
| Stapel | Its own password; ready for Authelia with the steps above (the first account is the admin who can add people; behind Authelia everyone gets an account by logging in there) |
| Backlog | Its own password (`ADMIN_PASSWORD`); ready for Authelia with the steps above. The Android share target and the bookmarklet go through the login like everything else |
| Notizbuch | Its own password (`ADMIN_PASSWORD`); ready for Authelia with the steps above. Opens offline with the account it last saw |
| To-do | Its own password (`ADMIN_PASSWORD`); ready for Authelia with the steps above, with a bypass for `/ics/` like Stammtisch's. Opens offline with the account it last saw |

## Apps that talk to each other

Some apps fetch data from each other directly, container to container, never through nginx or Authelia. They meet on a shared Docker network, made once:

```sh
docker network create homestack
```

Each app that takes part joins it in its `docker-compose.override.yml` (next to its `docker-compose.yml`, ignored by git):

```yaml
services:
  stammtisch:         # the service name from the app's docker-compose.yml (Fernweh's is `app`)
    networks: [default, homestack]
networks:
  homestack:
    external: true
```

The apps then reach each other by container name, e.g. `http://stammtisch:3000`. Each link has its own secret token on both sides.

| Link | Settings |
|---|---|
| Fernweh places your friends' addresses from Stammtisch on the map (collection "Freunde"); "Auf der Karte" in Stammtisch, "Open in Stammtisch" in Fernweh | Stammtisch: `LINK_TOKEN`, `FERNWEH_URL=https://places.fdahle.de`. Fernweh: `STAMMTISCH_URL=http://stammtisch:3000`, `STAMMTISCH_LINK_TOKEN` (the same token), `STAMMTISCH_PUBLIC_URL=https://friends.fdahle.de` |
