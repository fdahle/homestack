# Deploy

Every push to `main` updates the server: the [Deploy workflow](../.github/workflows/deploy.yml) logs in over SSH with a key that can do exactly one thing, start `homestack-deploy.service`. The server then fetches this repository itself, fast-forwards its checkout and rebuilds only the apps whose folder changed. If a build fails, the old version keeps running and the workflow run turns red.

GitHub never gets a shell or Docker on the server: a leaked key could only start a deploy of what is already on GitHub.

## Server setup

One checkout for all apps, owned by a normal user (git runs as that user, docker as root):

```sh
git clone https://github.com/fdahle/homestack.git /srv/docker/homestack
```

Next to each app you run, put what belongs to your server only. Git ignores all of it:

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

## Day to day

- `journalctl -u homestack-deploy` shows what was deployed and why something failed.
- Re-run a failed workflow on GitHub to try the same commit again, or run `homestack-deploy --all` on the server to rebuild every app (after a base image update, for example).
- nginx configs (each app's `deploy/`) aren't applied automatically. Copy them yourself when they change.

## One login for all apps

Authelia's session cookie is set for `fdahle.de`, so it covers every subdomain: log in once and each app behind it knows you. With "remember me" the login lasts a year (`remember_me` in [authelia.yml](authelia.yml)); the sensitive apps ask for the second factor once per login, not every time.

**Server, once:**

1. Merge [authelia.yml](authelia.yml) into Authelia's configuration (adjust the domains marked "yours") and put yourself into the `me` group. Restart Authelia.
2. `install -m 644 deploy/nginx/homestack-authelia.conf /etc/nginx/snippets/` (next to Authelia's own `authelia-location.conf` and `authelia-authrequest.conf`, which Stammbaum already uses).
3. `install -d -m 750 -o root -g www-data /etc/nginx/homestack-secrets`

**Per app** that uses the [design kit](../design/README.md#login) (Checkpoint, Flimmer, Regal, Leute) or follows it (Fernweh, conf `fernweh/deploy/places.fdahle.de.conf`), shown for Checkpoint:

```sh
secret=$(openssl rand -hex 32)
echo "AUTH_PROXY_SECRET=$secret" >> /srv/docker/homestack/checkpoint/.env
echo "proxy_set_header X-Auth-Proxy-Secret \"$secret\";" > /etc/nginx/homestack-secrets/checkpoint.conf
chmod 640 /etc/nginx/homestack-secrets/checkpoint.conf
cp checkpoint/deploy/games.fdahle.de.conf /etc/nginx/sites-available/   # the Authelia version
nginx -t && systemctl reload nginx
cd /srv/docker/homestack/checkpoint && docker compose up -d
```

The app then has no login page of its own: it takes the user from Authelia and makes an account for them the first time. The apps are for one person and their data doesn't belong to an account, so nothing is lost when you switch; only the language setting starts again at German. Fernweh simply treats whoever Authelia lets in as its one user. When the Authelia login runs out, the app reloads itself and lands on Authelia's login page.

**Where each app stands:**

| App | Behind Authelia |
|---|---|
| Checkpoint, Flimmer, Regal, Leute, Fernweh | Ready: only Authelia's login (steps above) |
| Stammbaum | Already, with its own `STAMMBAUM_PROXY_SECRET` |
| Stapel, Backlog | Possible now, but they still ask for their own password once per device afterwards (their sessions last 400 days). Gone once they move to the design kit |
| Zettel | Authelia in front for the second factor; Zettel keeps its own login on purpose, since that unlocks your notes database and encryption key |

## Apps that talk to each other

Some apps fetch data from each other directly, container to container, never through nginx or Authelia. They meet on a shared Docker network, made once:

```sh
docker network create homestack
```

Each app that takes part joins it in its `docker-compose.override.yml` (next to its `docker-compose.yml`, ignored by git):

```yaml
services:
  leute:              # the service name from the app's docker-compose.yml (Fernweh's is `app`)
    networks: [default, homestack]
networks:
  homestack:
    external: true
```

The apps then reach each other by container name, e.g. `http://leute:3000`. Each link has its own secret token on both sides.

| Link | Settings |
|---|---|
| Fernweh places your friends' addresses from Leute on the map (collection "Freunde"); "Auf der Karte" in Leute, "Open in Leute" in Fernweh | Leute: `LINK_TOKEN`, `FERNWEH_URL=https://places.fdahle.de`. Fernweh: `LEUTE_URL=http://leute:3000`, `LEUTE_LINK_TOKEN` (the same token), `LEUTE_PUBLIC_URL=https://friends.fdahle.de` |
