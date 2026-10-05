#!/bin/sh
set -e
git config --system --add safe.directory '*'
mkdir -p /srv/git
# the repositories to create, separated by spaces (default: one called "config")
for name in ${REPOS:-config}; do
  if [ ! -d "/srv/git/$name.git" ]; then
    git init --bare --initial-branch=main "/srv/git/$name.git" >/dev/null
    git -C "/srv/git/$name.git" config http.receivepack true
  fi
done
rm -f /run/fcgiwrap.sock
spawn-fcgi -s /run/fcgiwrap.sock -M 0666 /usr/bin/fcgiwrap
exec nginx -g 'daemon off;'
