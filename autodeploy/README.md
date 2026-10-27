# Autodeploy

Keeps a server in step with this repository, without giving GitHub any access to it: a systemd timer on the server checks the repository every 5 minutes, fast-forwards its checkout and rebuilds only the apps whose folder changed. If a build fails, the old version keeps running and the commit isn't tried again until the next push.

## Setup

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
install -m 755 autodeploy/homestack-deploy /usr/local/sbin/
install -m 644 autodeploy/homestack-deploy.service autodeploy/homestack-deploy.timer /etc/systemd/system/
install -m 600 autodeploy/homestack-deploy.conf.example /etc/homestack-deploy.conf   # list your apps in APPS
homestack-deploy --all
systemctl daemon-reload && systemctl enable --now homestack-deploy.timer
```

The script is copied rather than run from the checkout, so a push can't change what runs as root. After changing it here, install it again.

## Day to day

- `journalctl -u homestack-deploy` shows what was deployed and why something failed.
- `homestack-deploy --all` rebuilds every app, for example after a failed build or a base image update.
- nginx configs (each app's `deploy/`) aren't applied automatically. Copy them yourself when they change.
- Anyone who can push to the repository can run code on the server. That's true of any automatic deploy; protect the GitHub account (2FA).
