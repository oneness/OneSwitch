# OneSwitch GNOME Port — Phase 5: Indicator, Preferences & NixOS Packaging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-bar indicator (Open switcher / Preferences / About), a Preferences window with a hotkey **recorder** that writes the GSettings `hotkey`, and declarative **NixOS** packaging — a flake (extension, native host, dev shell) plus a home-manager module that installs the extension, the native host, and the browser native-messaging manifests.

**Architecture:** `indicator.js` adds a `PanelMenu.Button` wired in `extension.js`. `prefs.js` is a GTK4/Adw preferences window using `Gtk.ShortcutController`/key-capture to record a combo and store it via `this.getSettings().set_strv('hotkey', …)`. The flake builds the extension (schema compiled) and a wrapped host binary; the home-manager module enables the extension and writes the native-messaging manifests with the real host path substituted.

**Tech Stack:** GJS (St/`PanelMenu`), GTK4 + libadwaita (`prefs.js`), Nix flakes, home-manager, `glib-compile-schemas`.

**Prerequisite:** Phases 1–4 complete.

---

## File Structure (Phase 5)

```
gnome/oneswitch@oneness.health/
  lib/indicator.js     # NEW  PanelMenu.Button + menu
  extension.js         # MOD  construct/destroy the indicator
  prefs.js             # NEW  Adw preferences: hotkey recorder
nix/
  flake.nix            # NEW  packages.{extension,host}, devShell
  home-module.nix      # NEW  home-manager module wiring it all together
gnome/README.md        # MOD  packaging + install section
```

---

### Task 1: `indicator.js` — top-bar menu

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/indicator.js`
- Modify: `gnome/oneswitch@oneness.health/extension.js`

- [ ] **Step 1: Write `indicator.js`**

`gnome/oneswitch@oneness.health/lib/indicator.js`:

```js
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// onOpen: () => void   onPrefs: () => void
export const OneSwitchIndicator = GObject.registerClass(
class OneSwitchIndicator extends PanelMenu.Button {
  _init(onOpen, onPrefs) {
    super._init(0.0, 'OneSwitch');
    this.add_child(new St.Icon({
      icon_name: 'view-app-grid-symbolic',
      style_class: 'system-status-icon',
    }));

    const open = new PopupMenu.PopupMenuItem('Open switcher');
    open.connect('activate', () => onOpen());
    this.menu.addMenuItem(open);

    const prefs = new PopupMenu.PopupMenuItem('Preferences');
    prefs.connect('activate', () => onPrefs());
    this.menu.addMenuItem(prefs);
  }
});
```

- [ ] **Step 2: Wire it into `extension.js`**

In `extension.js`, import and construct/destroy the indicator. Replace `enable()`/`disable()` with:

```js
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { SwitcherPopup } from './lib/switcher.js';
import { OneSwitchIndicator } from './lib/indicator.js';

export default class OneSwitchExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._popup = new SwitcherPopup();

    this._indicator = new OneSwitchIndicator(
      () => this._popup.toggle(),
      () => this.openPreferences());
    Main.panel.addToStatusArea('oneswitch', this._indicator);

    Main.wm.addKeybinding(
      'hotkey', this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
      () => this._popup.toggle());
  }

  disable() {
    Main.wm.removeKeybinding('hotkey');
    if (this._indicator) { this._indicator.destroy(); this._indicator = null; }
    if (this._popup) { this._popup.destroy(); this._popup = null; }
    this._settings = null;
  }
}
```

- [ ] **Step 3: Acceptance — indicator appears**

Run: `cd gnome && make install && make nested` → enable the extension. A grid icon appears in the top bar; its menu has **Open switcher** (opens the popup) and **Preferences** (opens the prefs window, built next).
Expected: indicator + menu work; "Open switcher" toggles the popup.

- [ ] **Step 4: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/indicator.js gnome/oneswitch@oneness.health/extension.js
git commit -m "feat(gnome): top-bar indicator with Open/Preferences menu"
```

---

### Task 2: `prefs.js` — hotkey recorder

**Files:**
- Create: `gnome/oneswitch@oneness.health/prefs.js`

- [ ] **Step 1: Write `prefs.js`**

`gnome/oneswitch@oneness.health/prefs.js`:

```js
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class OneSwitchPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({ title: 'Hotkey' });
    page.add(group);

    const row = new Adw.ActionRow({
      title: 'Open switcher',
      subtitle: current(settings) || 'Disabled — click Record',
    });
    const button = new Gtk.Button({ label: 'Record', valign: Gtk.Align.CENTER });
    row.add_suffix(button);
    group.add(row);
    window.add(page);

    button.connect('clicked', () => {
      button.set_label('Press a combo…');
      const ctl = new Gtk.EventControllerKey();
      window.add_controller(ctl);
      ctl.connect('key-pressed', (_c, keyval, _code, state) => {
        const mods = state & Gtk.accelerator_get_default_mod_mask();
        if (keyval === Gdk.KEY_Escape) { reset(); return true; }
        // Ignore lone modifier presses.
        if ([Gdk.KEY_Control_L, Gdk.KEY_Control_R, Gdk.KEY_Shift_L,
             Gdk.KEY_Shift_R, Gdk.KEY_Alt_L, Gdk.KEY_Super_L].includes(keyval)) return true;
        const accel = Gtk.accelerator_name(keyval, mods);
        settings.set_strv('hotkey', [accel]);
        row.set_subtitle(accel);
        reset();
        window.remove_controller(ctl);
        return true;
      });
      function reset() { button.set_label('Record'); }
    });
  }
}

function current(settings) {
  const v = settings.get_strv('hotkey');
  return v && v.length ? v[0] : '';
}
```

- [ ] **Step 2: Acceptance — record a hotkey**

Run: `cd gnome && make install`, then open Preferences (from the indicator, or `gnome-extensions prefs oneswitch@oneness.health`). Click **Record**, press e.g. `<Super>space`; the subtitle updates and the new combo toggles the popup (after the extension re-reads the binding — toggle the extension off/on if needed).
Expected: recorded combo persists in GSettings and works.

- [ ] **Step 3: Commit**

```bash
git add gnome/oneswitch@oneness.health/prefs.js
git commit -m "feat(gnome): preferences window with a hotkey recorder"
```

---

### Task 3: `flake.nix` — package the extension + host + dev shell

**Files:**
- Create: `nix/flake.nix`

- [ ] **Step 1: Write `flake.nix`**

`nix/flake.nix`:

```nix
{
  description = "OneSwitch for GNOME (Wayland)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
      uuid = "oneswitch@oneness.health";
      src = ../gnome;
    in {
      packages.${system} = {
        extension = pkgs.stdenv.mkDerivation {
          pname = "oneswitch-gnome-extension";
          version = "1.0";
          src = src;
          nativeBuildInputs = [ pkgs.glib ];
          installPhase = ''
            dest=$out/share/gnome-shell/extensions/${uuid}
            mkdir -p $dest
            cp -r ${uuid}/. $dest/
            glib-compile-schemas $dest/schemas
          '';
        };

        host = pkgs.stdenv.mkDerivation {
          pname = "oneswitch-browser-host";
          version = "1.0";
          src = src;
          nativeBuildInputs = [ pkgs.makeWrapper ];
          buildInputs = [ pkgs.gjs ];
          installPhase = ''
            mkdir -p $out/libexec/oneswitch
            cp native-host/oneswitch-browser.js native-host/framing.js $out/libexec/oneswitch/
            chmod +x $out/libexec/oneswitch/oneswitch-browser.js
            makeWrapper ${pkgs.gjs}/bin/gjs $out/bin/oneswitch-browser \
              --add-flags "-m $out/libexec/oneswitch/oneswitch-browser.js"
          '';
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [ gjs nodejs glib gnome-shell zip eslint ];
      };
    };
}
```

- [ ] **Step 2: Verify the flake evaluates and builds**

Run (on the NixOS box, from `nix/`): `nix build .#extension && nix build .#host`
Expected: both build; `result/share/gnome-shell/extensions/oneswitch@oneness.health/schemas/gschemas.compiled` exists; `result/bin/oneswitch-browser` exists for the host.

- [ ] **Step 3: Commit**

```bash
git add nix/flake.nix
git commit -m "feat(nix): flake packaging the extension, native host, and dev shell"
```

---

### Task 4: `home-module.nix` — declarative install + native-messaging manifests

**Files:**
- Create: `nix/home-module.nix`

- [ ] **Step 1: Write the home-manager module**

`nix/home-module.nix`:

```nix
{ config, lib, pkgs, oneswitch, ... }:
# `oneswitch` = { extension, host } from the flake's packages.
let
  hostPath = "${oneswitch.host}/bin/oneswitch-browser";
  hostName = "health.oneness.oneswitch";

  chromeManifest = builtins.toJSON {
    name = hostName;
    description = "OneSwitch tab bridge";
    path = hostPath;
    type = "stdio";
    # Replace with your unpacked extension id, or use a published id.
    allowed_origins = [ "chrome-extension://CHANGE_ME_CHROME_EXT_ID/" ];
  };
  firefoxManifest = builtins.toJSON {
    name = hostName;
    description = "OneSwitch tab bridge";
    path = hostPath;
    type = "stdio";
    allowed_extensions = [ "oneswitch@oneness.health" ];
  };
in {
  # Install + enable the Shell extension.
  home.packages = [ oneswitch.extension oneswitch.host ];
  dconf.settings."org/gnome/shell".enabled-extensions =
    lib.mkAfter [ "oneswitch@oneness.health" ];

  # Optional: set the hotkey declaratively.
  dconf.settings."org/gnome/shell/extensions/oneswitch".hotkey = [ "<Control>Tab" ];

  # Native-messaging manifests for Chrome + Firefox.
  home.file.".config/google-chrome/NativeMessagingHosts/${hostName}.json".text = chromeManifest;
  home.file.".config/chromium/NativeMessagingHosts/${hostName}.json".text = chromeManifest;
  home.file.".mozilla/native-messaging-hosts/${hostName}.json".text = firefoxManifest;
}
```

- [ ] **Step 2: Document usage in `gnome/README.md`**

Append a "NixOS install" section to `gnome/README.md`:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add nix/home-module.nix gnome/README.md
git commit -m "feat(nix): home-manager module installing extension, host, and browser manifests"
```

---

### Task 5: Full acceptance on the real session

**Files:** none.

- [ ] **Step 1: Install declaratively + relogin**

Apply the home-manager config (`home-manager switch`), then log out and back in (Wayland session). Confirm the extension is enabled: `gnome-extensions list --enabled | grep oneswitch`.

- [ ] **Step 2: Verify the full feature set in the real session**

- Hotkey opens the popup centered; previous window preselected; Enter bounces between the two most-recent windows.
- Search filters windows + (while typing) apps; Enter launches a closed app.
- `>` command mode runs commands, shows output, copies to clipboard; Esc kills.
- Chrome + Firefox tabs list and switch (window raised).
- Indicator menu opens the switcher + preferences; the recorder changes the hotkey.

Expected: all pass on the real GNOME 47 Wayland session.

- [ ] **Step 3: Commit any fixes + tag**

```bash
git add -A gnome/ nix/
git commit -m "fix(gnome): Phase 5 acceptance fixes"
git tag gnome-v1.0
```

---

## Self-Review

**Spec coverage (Phase 5 slice):** top-bar indicator (menu-bar equivalent) → Task 1 ✅; preferences hotkey recorder → Task 2 ✅; NixOS flake packaging (extension w/ compiled schema + wrapped host + dev shell) → Task 3 ✅; home-manager module enabling the extension, installing the host, writing Chrome/Firefox native-messaging manifests, optional dconf hotkey → Task 4 ✅; the two intentional N/As (launch-at-login, quit) need no work — documented in the spec parity table. Full-session acceptance → Task 5 ✅.

**Placeholder scan:** `CHANGE_ME_CHROME_EXT_ID` is a required user value (the unpacked extension id), documented in the module comment and README — an install-time input, not a plan gap. No TODO/TBD.

**Type consistency:** `OneSwitchIndicator(onOpen, onPrefs)` (Task 1) constructed with `(() => this._popup.toggle(), () => this.openPreferences())` in `extension.js` (Task 1 Step 2). `prefs.js` reads/writes the same `hotkey` `as` key defined in Phase 1's schema and consumed by `addKeybinding`. Flake outputs `packages.{extension,host}` (Task 3) are exactly the `oneswitch.{extension,host}` the home module expects (Task 4). Host wrapper flags (`-m … oneswitch-browser.js`) match the host's `#!/usr/bin/env -S gjs -m` ESM entry and its `import('./framing.js')` sibling (Phase 4 Task 3). ✅
```
