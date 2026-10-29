#!/bin/sh
# Point Firefox's per-user native messaging manifest at this checkout's debug
# host. The per-user manifest shadows the NixOS system one, so no rebuild and no
# root access are needed.
#
#   ./install.sh          install, then restart Firefox to spawn it
#   ./install.sh remove   drop the override; restart Firefox to go back
set -eu

here=$(cd "$(dirname "$0")" && pwd)
dest=$HOME/.mozilla/native-messaging-hosts/health.oneness.oneswitch.json

case "${1:-install}" in
install)
  chmod +x "$here/dev-host.sh"
  mkdir -p "$(dirname "$dest")"
  cat >"$dest" <<EOF
{
  "name": "health.oneness.oneswitch",
  "description": "OneSwitch tab bridge (debug build from $here)",
  "path": "$here/dev-host.sh",
  "type": "stdio",
  "allowed_extensions": ["oneswitch@birkey.co"]
}
EOF
  echo "wrote $dest"
  echo "  -> $here/dev-host.sh"
  echo "Restart Firefox to spawn it; the host already running keeps going until then."
  ;;
remove)
  rm -f "$dest"
  echo "removed $dest"
  echo "Restart Firefox to go back to the installed host."
  ;;
*)
  echo "usage: $0 [install|remove]" >&2
  exit 2
  ;;
esac
