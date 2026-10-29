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

Chrome and Firefox tabs appear inline with page favicons. Icons come from the browser (`favIconUrl`), are cached on disk per host, and are normalised at ingest by the native host: sites that serve `.ico` files get their largest embedded PNG frame extracted (`native-host/favicon-format.js`), because gdk-pixbuf's ICO loader rejects the PNG-compressed frames modern `.ico` files use. Sites with no usable icon at all get a generic globe, so a row never loses its icon slot. Requires the WebExtension and native host bridge (see [Browser tabs setup](#browser-tabs-setup)).

### Command mode

Type `>` to enter command mode. Matching shell history entries appear as you type, followed by matching executables from `$PATH` (marked with a binary icon); Enter runs the selected one, Ctrl+J runs exactly what you typed. Output (stdout + stderr) is shown in the popup and copied to the clipboard. Esc kills a running command.

### Web search mode

Type `?` followed by a query; Enter opens a Google search for it in the default browser.

### Light & dark

The popup follows the system appearance — light on GNOME's light style, dark on the dark one — and re-paints the moment you flip *Settings → Appearance*, even while it is open. The shell chooses its own stylesheet from `org.gnome.desktop.interface`'s `color-scheme`, so the extension mirrors that setting (`lib/theme.js`) and swaps the `.oneswitch-light` overrides in `stylesheet.css`.

Every popup colour is set explicitly per palette rather than inherited — row titles, subtitles, command output and the search entry — because a label inside a light popup must not keep the shell's white foreground, and the entry must not keep the shell's dark bar. The entry's focus ring is re-declared `!important` for the light palette, since the shell's own ring rule is important too and tuned for a dark popup. The panel title label is the exception: it sits inside a panel button, so it inherits the panel's theme colour instead of hard-coding white, and its buttons use neutral grey hover overlays so they read the same on either panel.

Note that GNOME Shell itself stays dark for `color-scheme 'default'` (the user session mode resolves to the dark variant unless the preference is `prefer-light`), so a light popup is a deliberate choice to match the *GTK* appearance, not the shell chrome.

### Title bar management

Optionally hide window title bars on maximized/tiled windows (Unite-style):

- **GTK/Wayland (CSD) apps** — injects CSS into `~/.config/gtk-{3,4}.0/gtk.css`; GTK picks it up live via inotify.
- **XWayland (SSD) apps** — sets Motif WM hints via `xprop` and toggles `window.decorated`.
- **Modes** — *When maximized* (default), *When tiled or maximized*, *Always*.

When title bars are hidden, the focused window's title appears in the top panel, with optional close/minimize/maximize buttons.

### Keep awake

A *Keep awake* switch in the indicator menu stops the machine from suspending, blanking, or locking on idle — a caffeine toggle. It holds an `org.gnome.SessionManager` inhibitor (suspend + idle) for as long as it is on; the panel icon turns amber while it is held.

The inhibitor is released when you switch it off, when the extension is disabled, and automatically if GNOME Shell exits — so it can never get stuck on. The state is not remembered across shell restarts.

### Panel indicator

A right-panel grid icon opens a menu: *Open switcher*, *Keep awake*, *Preferences*.

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
| **Return** | Activate — switch to window, launch app, run command, or open web search |
| **Ctrl+J** | In `>` mode — run exactly what is typed |
| **Esc** | Dismiss (kills a running command first) |
| Click | Activate that row |

## Getting started (NixOS flake)

The extension, native host, and WebExtension are all built from the flake at the repo root. Here is a complete example of what a `~/.dotfiles/flake.nix` looks like with OneSwitch wired in:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    oneswitch = {
      url = "github:oneness/OneSwitch";
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

### Upgrading

```sh
nix flake update oneswitch   # in your dotfiles/flake directory
make kpocket                 # or make kbook
```

Then log out and back in — GNOME Shell on Wayland only picks up extension code on session restart.

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
gnome/scripts/reload    # copy extension + compile schema into ~/.local/share
                        # (uses the flake devShell for glib-compile-schemas)
```

Then, from `gnome/` inside the devShell:

```sh
nix develop    # devShell: gjs, glib-compile-schemas, gnome-shell, node, zip, eslint

npm test       # run pure-module unit tests (Node)

# launch a nested GNOME Shell (Wayland)
dbus-run-session -- gnome-shell --nested --wayland
```

Inside the nested shell:

```sh
gnome-extensions enable oneswitch@birkey.co
```

Logs: `journalctl --user -f -o cat | grep -i oneswitch` (or Alt+F2 → `lg` for Looking Glass).

## Extension UUID

`oneswitch@birkey.co`
