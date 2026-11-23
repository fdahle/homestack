#!/bin/sh
# Once, on the server, after the apps moved into apps/ and four got new names
# (Flimmer → Watchlist, Zettel → Notizbuch, Haken → To-do, Leute → Stammtisch). Git moved the files it tracks;
# this moves what git ignores (.env, docker-compose.override.yml, data folders) into the new
# folders, renames the apps in /etc/homestack-deploy.conf, installs the new deploy script and
# rebuilds everything. Stammtisch and Watchlist get new Docker volumes with a copy of their data;
# the old volumes stay as a backup.
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
for app in backlog checkpoint fernweh regal stammbaum stapel; do move "$app" "$app"; done
move leute stammtisch
move apps/leute stammtisch
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

# Stammtisch (first Bande, then Leute) and Watchlist (Flimmer) drop their old names in Docker too.
# Their old containers go, and their data is copied into new volumes with the database file
# renamed. The old volumes stay as a backup until you remove them:
#   docker volume rm bande_bande-data flimmer_flimmer-data
remove_project() {
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$1")
  [ -n "$ids" ] && docker rm -f $ids >/dev/null && echo "  removed the $1 containers" || true
}
# copy_volume <old volume> <project> <volume> <old database> <new database>
copy_volume() {
  new=$2_$3
  docker volume inspect "$1" >/dev/null 2>&1 || return 1
  if docker volume inspect "$new" >/dev/null 2>&1; then
    echo "  $new exists already: left as it is"
    return 0
  fi
  docker volume create --label "com.docker.compose.project=$2" --label "com.docker.compose.volume=$3" "$new" >/dev/null
  if ! docker run --rm -v "$1:/from:ro" -v "$new:/to" alpine sh -c \
    'cp -a /from/. /to/ && cd /to && for f in "$1"*; do if [ -e "$f" ]; then mv "$f" "$2${f#"$1"}"; fi; done' \
    sh "$4" "$5"; then
    echo "  copying $1 → $new failed: nothing changed in $1, see above"
    exit 1
  fi
  echo "  copied $1 → $new ($4 → $5)"
}
echo "Docker names"
for project in bande leute flimmer; do remove_project "$project"; done
# Leute ran as project bande (COMPOSE_PROJECT_NAME in .env), or as leute if that was never set
copy_volume bande_bande-data stammtisch stammtisch-data bande.db stammtisch.db \
  || copy_volume leute_bande-data stammtisch stammtisch-data bande.db stammtisch.db \
  || echo "  no Stammtisch volume found: it starts empty"
copy_volume flimmer_flimmer-data watchlist watchlist-data flimmer.db watchlist.db \
  || echo "  no Watchlist volume found: it starts empty"
for app in stammtisch watchlist; do
  if [ -f "apps/$app/.env" ]; then sed -i '/^COMPOSE_PROJECT_NAME=/d' "apps/$app/.env"; fi
done
# The service is called stammtisch now (the override puts it on the homestack network), and
# Fernweh finds it under that name
if [ -f apps/stammtisch/docker-compose.override.yml ]; then
  sed -i -E 's/^(\s+)leute:/\1stammtisch:/' apps/stammtisch/docker-compose.override.yml
fi
if [ -f apps/fernweh/.env ]; then
  sed -i -E 's/^LEUTE_/STAMMTISCH_/; s#http://leute:3000#http://stammtisch:3000#' apps/fernweh/.env
fi
# Stammtisch's Authelia secret for nginx, and the installed site configs that read it
secrets=/etc/nginx/homestack-secrets
if [ -f "$secrets/leute.conf" ] && [ ! -e "$secrets/stammtisch.conf" ]; then
  mv "$secrets/leute.conf" "$secrets/stammtisch.conf"
  for site in $(grep -l "homestack-secrets/leute.conf" /etc/nginx/sites-available/* /etc/nginx/conf.d/* 2>/dev/null || true); do
    sed -i --follow-symlinks 's#homestack-secrets/leute\.conf#homestack-secrets/stammtisch.conf#' "$site"
    echo "  $site reads stammtisch.conf now"
  done
  if nginx -t; then systemctl reload nginx; else echo "  nginx -t failed: look at the site configs before reloading"; fi
fi

# The new names in the list of apps this server runs
if [ -f "$CONF" ]; then
  sed -i -E 's/\bflimmer\b/watchlist/; s/\bzettel\b/notizbuch/; s/\bhaken\b/todo/; s/\bleute\b/stammtisch/' "$CONF"
  echo "$CONF: $(grep '^APPS=' "$CONF")"
fi

install -m 755 deploy/homestack-deploy /usr/local/sbin/
echo "installed the deploy script that looks in apps/"
homestack-deploy --all
