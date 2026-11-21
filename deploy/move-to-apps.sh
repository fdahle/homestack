#!/bin/sh
# Once, on the server, after the apps moved into apps/ and three got new names
# (Flimmer → Watchlist, Zettel → Notizbuch, Haken → To-do). Git moved the files it tracks;
# this moves what git ignores (.env, docker-compose.override.yml, data folders) into the new
# folders, renames the apps in /etc/homestack-deploy.conf, installs the new deploy script and
# rebuilds everything. Docker keeps the same project names, so containers and volumes stay.
#
#   git -C /srv/docker/homestack pull      (as the checkout's owner)
#   sudo sh /srv/docker/homestack/deploy/move-to-apps.sh
set -eu
REPO=${1:-/srv/docker/homestack}
CONF=/etc/homestack-deploy.conf
cd "$REPO"
[ -d apps ] || { echo "No apps/ in $REPO yet: pull first (git -C $REPO pull)"; exit 1; }

# Containers of a Docker Compose project
stop_project() {
  ids=$(docker ps -q --filter "label=com.docker.compose.project=$1")
  [ -n "$ids" ] && docker stop $ids >/dev/null && echo "  stopped the $1 containers" || true
}

# Everything left in the old folder (only what git ignores is still there) into apps/<new>
move() {
  old=$1
  new=apps/$2
  [ -d "$old" ] || return 0
  echo "$old → $new"
  for item in "$old"/* "$old"/.[!.]*; do
    [ -e "$item" ] || continue
    name=$(basename "$item")
    case $name in node_modules|dist|dist-server) continue ;; esac
    if [ -e "$new/$name" ]; then
      echo "  left $item: $new/$name exists already"
      continue
    fi
    mv "$item" "$new/"
    echo "  moved $name"
  done
  rmdir "$old" 2>/dev/null || echo "  $old isn't empty (see above); remove it when you're sure"
}

# Fernweh and Stammbaum keep their data in a folder next to docker-compose.yml: stop them first
stop_project fernweh
stop_project stammbaum
for app in backlog checkpoint fernweh leute regal stammbaum stapel; do move "$app" "$app"; done
move flimmer watchlist
move haken todo

# The old Zettel (CouchDB) ran on the port Notizbuch now uses. Its containers stop; its data
# volume stays until you remove it (docker volume ls | grep zettel). Only its .env moves:
# ADMIN_PASSWORD carries over, ADMIN_USERNAME is called ADMIN_USER now.
if [ -d zettel ]; then
  stop_project zettel
  echo "zettel → apps/notizbuch"
  for f in .env docker-compose.override.yml; do
    if [ -f "zettel/$f" ] && [ ! -e "apps/notizbuch/$f" ]; then mv "zettel/$f" "apps/notizbuch/$f" && echo "  moved $f"; fi
  done
  echo "  the rest of zettel/ (couchdb/ …) belongs to the old app; remove it when you're sure"
fi

# The new names in the list of apps this server runs
if [ -f "$CONF" ]; then
  sed -i -E 's/\bflimmer\b/watchlist/; s/\bzettel\b/notizbuch/; s/\bhaken\b/todo/' "$CONF"
  echo "$CONF: $(grep '^APPS=' "$CONF")"
fi

install -m 755 deploy/homestack-deploy /usr/local/sbin/
echo "installed the deploy script that looks in apps/"
homestack-deploy --all
