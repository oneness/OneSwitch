#!/bin/sh
# OneSwitch debug native-messaging host.
#
# Runs the *in-repo* GJS host (gnome/native-host/oneswitch-browser.js) so its
# diagnostics are live, instead of the installed copy from the Nix store. Nothing
# outside your home directory is modified; ./install.sh remove undoes it.
#
# Firefox invokes a native messaging host as:  <host> <manifestPath> <extId>
# and the host infers which browser launched it from argv[0]. The NixOS system
# manifest happens to live under a path containing "firefox"; a per-user
# manifest does not, so the marker is injected explicitly here.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
host_js=$here/../../native-host/oneswitch-browser.js
[ -f "$host_js" ] || { echo "missing $host_js" >&2; exit 1; }

find_gjs() {
  if [ -n "${ONESWITCH_GJS:-}" ]; then
    [ -x "$ONESWITCH_GJS" ] || { echo "ONESWITCH_GJS is not executable: $ONESWITCH_GJS" >&2; return 1; }
    echo "$ONESWITCH_GJS"; return 0
  fi
  if command -v gjs >/dev/null 2>&1; then command -v gjs; return 0; fi
  # NixOS: reuse the interpreter the installed host wrapper was built with.
  for m in /run/current-system/sw/lib/mozilla/native-messaging-hosts/health.oneness.oneswitch.json \
           "$HOME/.nix-profile/lib/mozilla/native-messaging-hosts/health.oneness.oneswitch.json"; do
    [ -f "$m" ] || continue
    p=$(sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$m" | head -1)
    [ -n "$p" ] && [ -f "$p" ] || continue
    g=$(sed -n 's/^exec "\([^"]*gjs[^"]*\)".*/\1/p' "$p" | head -1)
    [ -n "$g" ] && [ -x "$g" ] && { echo "$g"; return 0; }
  done
  return 1
}

gjs=$(find_gjs) || { echo "no gjs found: install gjs or set ONESWITCH_GJS" >&2; exit 1; }
exec "$gjs" -m "$host_js" firefox "$@"
