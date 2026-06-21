# OneSwitch for GNOME

GNOME Shell extension (GNOME 47–50, Wayland) — a Spotlight-style window/tab switcher and launcher on a global hotkey.

## What it does

Press **Control+Tab** (configurable) to open a centered popup. Type to filter, navigate with the keyboard, and press Enter to go there.

### Window switcher & app launcher

- Lists every open window MRU-first with app icons.
- The previous window is preselected, so Control+Tab → Enter bounces between your two most recent windows.
- Typing a query also surfaces installed-but-not-running apps; Enter launches them.
- Orderless token search: space-separated terms match in any order against window title and app name.

### Browser tabs

Chrome and Firefox tabs appear inline with page favicons. Favicons are fetched from DuckDuckGo's favicon service and cached on disk. Requires the WebExtension and native host bridge (see [Browser tabs setup](#browser-tabs-setup)).

### Command mode

Type `>` to enter command mode. Matching shell history entries appear as you type; Enter runs the selected one, Ctrl+J runs exactly what you typed. Output (stdout + stderr) is shown in the popup and copied to the clipboard. Esc kills a running command.

### Title bar management

Optionally hide window title bars on maximized/tiled windows (Unite-style):

- **GTK/Wayland (CSD) apps** — injects CSS into `~/.config/gtk-{3,4}.0/gtk.css`; GTK picks it up live via inotify.
- **XWayland (SSD) apps** — sets Motif WM hints via `xprop` and toggles `window.decorated`.
- **Modes** — *When maximized* (default), *When tiled or maximized*, *Always*.

When title bars are hidden, the focused window's title appears in the top panel, with optional close/minimize/maximize buttons.

### Panel indicator

A right-panel grid icon opens a menu: *Open switcher*, *Hide/Show title bars*, *Preferences*.

### Preferences

Open via the indicator → *Preferences*, or:

```sh
gnome-extensions prefs oneswitch@birkey.co
```

- **Hotkey** — click *Record* and press any combo to replace Control+Tab.
- **Title bar** — master toggle, hide mode (maximized/tiled/always), show window title in panel, show window buttons in panel.

## Keys

| Key | Action |
|---|---|
| **Control+Tab** | Toggle the switcher (previous window preselected) |
| **Tab** / **Shift+Tab** | Move selection down / up |
| **↓ / ↑** or **Ctrl+N / Ctrl+P** | Move selection down / up |
| **Return** | Activate — switch to window, launch app, or run command |
| **Ctrl+J** | In `>` mode — run exactly what is typed |
| **Esc** | Dismiss (kills a running command first) |
| Click | Activate that row |

## Getting started (NixOS flake)

The extension, native host, and WebExtension are all built from the `nix/` flake. Here is a complete example of what a `~/.dotfiles/flake.nix` looks like with OneSwitch wired in:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    oneswitch = {
      url = "github:oneness/OneSwitch?dir=nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, oneswitch, ... }: {
    nixosConfigurations.myhostname = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      specialArgs = { inherit oneswitch; };
      modules = [
        ./configuration.nix
      ];
    };
  };
}
```

Then in `configuration.nix` (or any module it imports):

```nix
{ oneswitch, pkgs, ... }: {
  # Install and auto-enable the GNOME Shell extension
  programs.gnome-shell = {
    enable = true;
    extensions = [
      { package = oneswitch.packages.${pkgs.system}.extension; }
    ];
  };

  # Optional: native messaging host for browser tab support
  programs.firefox.nativeMessagingHosts.packages = [
    oneswitch.packages.${pkgs.system}.host
  ];
}
```

After `sudo nixos-rebuild switch`, log out and back in. The extension loads automatically — no manual `gnome-extensions enable` needed when installed this way.

### Available flake packages

| Package | What it builds |
|---|---|
| `extension` | The GNOME Shell extension (installs into `share/gnome-shell/extensions/`) |
| `host` | Native messaging host binary + Firefox manifest |
| `webext` | Packed `.xpi` at `share/oneswitch/oneswitch@birkey.co.xpi` |

### Browser tabs (optional)

**Native host** is covered above via `programs.firefox.nativeMessagingHosts.packages`.

**WebExtension** — install the `.xpi` from the `webext` package, or load unpacked in developer mode (see [Browser tabs setup](#browser-tabs-setup)).

Once both are running a Unix socket appears at `$XDG_RUNTIME_DIR/oneswitch-browser-{chrome,firefox}.sock` and tabs show up in the switcher automatically.

## Browser tabs setup

**Chrome:** `chrome://extensions` → Developer mode → *Load unpacked* → `gnome/webext/`

**Firefox:** `about:debugging` → This Firefox → *Load Temporary Add-on* → `gnome/webext/manifest.json`

## Dev loop (no logout needed)

```sh
make test      # run pure-module unit tests (Node)
make install   # copy extension + compile schema into ~/.local/share
make nested    # launch a nested GNOME Shell (Wayland)
```

Inside the nested shell:

```sh
gnome-extensions enable oneswitch@birkey.co
```

Logs: `make logs` (or Alt+F2 → `lg` for Looking Glass).

```sh
nix develop    # devShell: gjs, glib-compile-schemas, gnome-shell, node, zip, eslint
```

## Extension UUID

`oneswitch@birkey.co`
