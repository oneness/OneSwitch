# OneSwitch for GNOME (Wayland)

GNOME 47 Shell extension. Spotlight-style window/tab switcher and launcher triggered by a global hotkey.

## Features

- **Window switcher** — lists open windows MRU-first; previous window preselected so Control+Tab → Enter bounces between your two most recent windows.
- **App launcher** — installed-but-not-running apps appear while searching; Enter launches.
- **Command mode** — type `>` then a shell command; shell-history picker; Enter or Ctrl+J runs it; output shown + copied to clipboard; Esc kills a running command.
- **Browser tabs** — Chrome and Firefox tabs with favicons (Phase 4).
- **Indicator + Preferences** — top-bar menu and hotkey recorder (Phase 5).

## Dev loop (no logout needed)

```
make test        # run pure-module unit tests (Node)
make install     # copy extension + compile schema into ~/.local/share
make nested      # launch a nested GNOME Shell (Wayland)
```

Inside the nested shell:
```
gnome-extensions enable oneswitch@birkey.oneness
```

Press **Control+Tab** to open the switcher.

Logs: `make logs` (or Alt-F2 → `lg` for Looking Glass).

## Acceptance checklist

### Phase 1 — Core switcher
- [ ] Control+Tab opens a centered popup; the **previous** window is preselected.
- [ ] Typing filters; Tab/↓/Ctrl-N and Shift-Tab/↑/Ctrl-P move selection.
- [ ] Enter activates the selected window; Esc dismisses.
- [ ] Control+Tab → Enter bounces between the two most-recent windows.

### Phase 2 — App launcher
- [ ] Empty query: only open windows, no apps.
- [ ] With a query: matching apps appear below windows, with icons.
- [ ] Enter on an app row launches it.

### Phase 3 — Command mode
- [ ] Typing `>` switches to command mode; shell-history entries filter as you type.
- [ ] Enter on a history row runs it; output + `[exit N]` shows in the popup.
- [ ] Ctrl+J runs the typed command (not a history selection).
- [ ] Output is copied to clipboard.
- [ ] Esc kills a running command and closes the popup.

## NixOS devShell

```
nix develop       # provides gjs, glib-compile-schemas, gnome-shell, node, zip, eslint
```

## Extension UUID

`oneswitch@birkey.oneness`

## NixOS install (declarative)

In your home-manager config:

```nix
{ inputs, ... }:
let oneswitch = inputs.oneswitch.packages.x86_64-linux;
in {
  imports = [ (import ./path/to/nix/home-module.nix { inherit (oneswitch) extension host; }) ];
}
```

Then load the WebExtension once per browser (unpacked from `gnome/webext/`), set
`allowed_origins` in the Chrome manifest to your unpacked extension id, and log out/in
(or restart GNOME Shell) so the extension and keybinding load. The browser
native-messaging manifests are written automatically.

## Browser tabs setup

1. Chrome: `chrome://extensions` → Developer mode → Load unpacked → `gnome/webext/`
   - Note the extension id; the Chrome native-messaging manifest will need it as `allowed_origins`.
2. Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `gnome/webext/manifest.json`

Once the WebExtension is running and the native host is installed, a socket appears at
`$XDG_RUNTIME_DIR/oneswitch-browser-{chrome,firefox}.sock` and tabs show up in the switcher.
