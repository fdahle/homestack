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
