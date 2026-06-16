#!/bin/sh
exec /nix/store/6iz1r9hwaw56kdwbagxh3f27dfyzqa47-gjs-1.88.0/bin/gjs -m "$(dirname "$0")/oneswitch-browser.js" "$@"
