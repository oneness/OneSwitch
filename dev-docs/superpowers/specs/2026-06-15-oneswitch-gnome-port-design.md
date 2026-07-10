# OneSwitch for GNOME (NixOS / Wayland) — Design Spec

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation planning
**Target:** NixOS, GNOME **47**, **Wayland** session
**Language:** Plain **GJS** (GNOME 47 ESM modules — no TypeScript / no build step)

## 1. Goal

Port the macOS OneSwitch — a Spotlight-style window/tab switcher **and** launcher
triggered by a global hotkey — to GNOME on NixOS, at full feature parity for v1.

Press the hotkey (default **Control+Tab**) → a centered popup opens with the *previous*
window preselected → type to filter → navigate with the keyboard → Enter switches to the
window/tab (or launches an app that isn't running). Press the hotkey again to dismiss.
The list is most-recently-used first.

The v1 feature set (all in scope):

- App windows, listed individually, with app icons.
- Installed-but-not-running apps (`.desktop`), shown while searching; Enter launches.
- **Browser tabs** for Chrome and Firefox, listed individually with favicons.
- Recency sorting + previous-window preselect for an Enter "bounce".
- Orderless fuzzy search with ranking.
- **Command mode** (`> cmd`): run a shell command, show output, copy it to the clipboard,
  with a shell-history picker.
- A top-bar indicator + a Preferences window to configure the hotkey.

## 2. The platform constraint that drives everything

On **GNOME Wayland**, a normal application **cannot**:

- enumerate or activate other applications' windows,
- grab a global hotkey,
- show an override-redirect / always-on-top surface that grabs the keyboard
  (Mutter does **not** implement `wlr-layer-shell`, and Wayland forbids global input
  grabs for ordinary clients).

The only code that can do all three is code running **inside GNOME Shell** — i.e. a
**Shell extension** (GJS running in the `gnome-shell` process). GNOME's own Alt-Tab and
overview search are built this way. Therefore the entire interactive core is a Shell
extension; this is not a convenience choice, it is the only architecture where the popup
behaves like the macOS app.

The one thing the Shell cannot do is read browser tabs — that requires the browser's
cooperation, handled by a separate **browser bridge** (Section 5).

## 3. Architecture overview

```
┌───────────────────────── GNOME Shell (Mutter) ─────────────────────────┐
│  OneSwitch extension (GJS, ESM)                                        │
│   • HotKey    → global.display.add_keybinding (GSettings-backed)       │
│   • Popup     → St/Clutter modal (Main.pushModal): search + list       │
│   • Windows   → Meta / Shell.WindowTracker: list, MRU, activate        │
│   • Launcher  → Gio.AppInfo (.desktop), app.launch()                   │
│   • Command   → Gio.Subprocess, St.Clipboard, shell-history parse      │
│   • Indicator → PanelMenu.Button; Preferences → prefs.js (GTK4/Adw)    │
└───────────▲────────────────────────────────────────────────────────────┘
            │  Unix socket $XDG_RUNTIME_DIR/oneswitch-browser-<browser>.sock
            │  (JSON: tab list in, activate(tabId,windowId) out)
┌───────────┴───────────┐   stdio (native messaging)   ┌──────────────────┐
│ native host           │◄────────────────────────────►│ WebExtension     │
│ (oneswitch-browser,   │                              │ (Chrome MV3 +    │
│  GJS)                 │                              │  Firefox)        │
└───────────────────────┘                              └──────────────────┘
```

Three deliverables: **(1)** the Shell extension, **(2)** the native-messaging host, **(3)**
the WebExtension. All packaged together for NixOS (Section 7).

## 4. The Shell extension

GNOME 47 extension layout (ESM):

```
oneswitch@oneness.health/
  metadata.json                 # uuid, shell-version ["47"], settings-schema
  extension.js                  # enable()/disable(): hotkey, indicator, wiring
  prefs.js                      # GTK4/Adw preferences: hotkey recorder
  stylesheet.css                # St styling for the popup
  schemas/
    org.gnome.shell.extensions.oneswitch.gschema.xml
  lib/
    switcher.js                 # SwitcherPopup: St modal, search field, list, keynav
    model.js                    # item model: search filter + ranking (PURE, testable)
    windows.js                  # window enumeration (MRU) + activation
    apps.js                     # .desktop catalog + launch
    command.js                  # command-mode runner + clipboard
    history.js                  # shell-history reader/parse (PURE, testable)
    browser.js                  # client for the native host socket (tabs + activate)
    favicons.js                 # two-tier favicon cache
    recency.js                  # MRU helpers / previous-window preselect (PURE)
  test/                         # unit tests for PURE modules (gjs/node runner)
```

### 4.1 Units (single responsibility each)

- **`extension.js`** — lifecycle only. On `enable()`: bind the hotkey, add the panel
  indicator, construct the `SwitcherPopup` (lazily). On `disable()`: unbind, destroy,
  drop all signal handlers. No business logic.
- **`switcher.js` — `SwitcherPopup`** — the St modal. Owns: the centered container, the
  search entry, the scrollable result list, selection highlight, and key handling
  (Tab/Shift-Tab, ↑/↓, Ctrl-N/Ctrl-P, Enter, Ctrl-J, Esc). Pushes a modal with
  `Main.pushModal()` and grabs the keyboard like Alt-Tab; releases on close. Asks
  `model.js` for filtered/ranked rows; renders icon + title + subtitle per row. Knows
  nothing about *how* items are sourced.
- **`model.js`** (PURE) — given the raw item set (windows, apps, tabs, command/history
  rows) and the query string, returns the filtered + ranked + ordered list. Direct port
  of macOS `SwitcherModel`: orderless space-separated tokens (every token must match
  title or app name), ranked by title match / prefix / word-boundary / shorter-title.
  Handles `>`-prefix to switch into command mode. No GNOME imports → unit-tested.
- **`windows.js`** — wraps Mutter. `list()` returns windows from
  `global.display.get_tab_list(Meta.TabList.NORMAL, null)` (already MRU-ordered),
  filtered to normal windows; each carries title, the owning `Shell.App` (for name +
  icon), and the `Meta.Window`. `activate(metaWindow)` → `Main.activateWindow()`.
- **`apps.js`** — `Gio.AppInfo.get_all()` filtered to `should_show()`, minus apps that
  already have a window open; each row carries the themed `Gio.Icon`. `launch(appInfo)`.
- **`command.js`** — runs `bash -lc <cmd>` via `Gio.Subprocess` (PIPE stdout+stderr),
  reports combined output + exit code, copies the full output to the CLIPBOARD selection
  with `St.Clipboard`. Holds the running subprocess so **Esc** can `force_exit()` it. No
  TTY (sudo / interactive commands are out — same as macOS).
- **`history.js`** (PURE) — reads `~/.bash_history` / `~/.zsh_history`, de-dupes, returns
  matches for the typed command fragment. Pure parsing → unit-tested.
- **`browser.js`** — connects to each present native-host Unix socket
  (`$XDG_RUNTIME_DIR/oneswitch-browser-<browser>.sock`); pulls the current tab list (title, url,
  windowId, tabId, favicon host) and sends `activate(tabId, windowId)`. Degrades
  silently to "no tabs" when the socket is absent (browser not running / bridge not
  installed).
- **`favicons.js`** — two-tier cache (in-memory Map + on-disk `~/.cache/oneswitch/
  favicons/<host>`), resolved off the UI path. Port of macOS `FaviconCache`. Seeded from
  the tab's `favIconUrl`; non-web tabs (`chrome://…`) show the browser's app icon.
- **`recency.js`** (PURE) — helpers over the MRU list: ordering, and computing the
  preselect index (the *previous* window — the second MRU entry — skipping rows that
  belong to the currently focused window, e.g. its own tabs), reproducing the macOS
  "Control+Tab, Enter bounces between your two most recent windows" behavior.

### 4.2 Tab activation

Switching to a browser tab is two steps, both required:

1. `browser.js` → host → WebExtension: `tabs.update(tabId,{active:true})` +
   `windows.update(windowId,{focused:true})` (selects the tab *inside* the browser).
2. `windows.js`: raise the browser's `Meta.Window` with `Main.activateWindow()` (moves
   OS-level focus to the right browser window). Without this, the tab changes but the
   window may not come forward.

### 4.3 Indicator & preferences (the menu-bar equivalent)

- A `PanelMenu.Button` in the top bar with the OneSwitch icon and a menu: **Open
  switcher**, **Preferences**, **About**.
- **`prefs.js`** (runs in a separate GTK4/Adw process) hosts the **hotkey recorder** — a
  row that captures the next key combo and writes it to the GSettings `hotkey` key.
- **Intentional differences from macOS** (documented, not bugs):
  - **Launch at login** — N/A. A Shell extension runs whenever you are logged in.
  - **Quit** — N/A. You disable the extension (Extensions app / `gnome-extensions
    disable`) instead.

## 5. Browser-tabs bridge

### 5.1 WebExtension (one codebase, Chrome MV3 + Firefox)

- Maintains the live tab list and pushes it to the native host on `tabs.onUpdated`,
  `onActivated`, `onRemoved`, `windows.onFocusChanged`. Payload per tab:
  `{tabId, windowId, title, url, favIconUrl}`.
- Handles inbound `activate(tabId, windowId)` → `tabs.update` + `windows.update`.
- Connects to the host with `runtime.connectNative("health.oneness.oneswitch")`.

### 5.2 Native host (`oneswitch-browser`, GJS)

- Launched by the browser over **stdio native messaging** (length-prefixed JSON).
- Bridges that stdio stream to a **Unix domain socket** at
  `$XDG_RUNTIME_DIR/oneswitch-browser.sock` that the Shell extension reads/writes.
- Holds the latest tab snapshot in memory; answers the extension's "list tabs" and
  relays "activate" back to the WebExtension. Lives as long as the browser keeps the
  native-messaging port open.
- Multiple browsers (Chrome **and** Firefox) each spawn their own host instance; the
  socket name is suffixed per browser (`…-chrome.sock`, `…-firefox.sock`) and the
  extension reads all present sockets.

### 5.3 Manifests

Native-messaging host manifests are installed at the browser-specific paths (handled by
the home-manager module, Section 7):

- Chrome/Chromium: `~/.config/<browser>/NativeMessagingHosts/health.oneness.oneswitch.json`
- Firefox: `~/.mozilla/native-messaging-hosts/health.oneness.oneswitch.json`

Each manifest points at the `oneswitch-browser` binary and lists the allowed extension
id / origin.

### 5.4 Out of scope

Safari/Arc do not exist on Linux. Other Chromium channels (Brave, etc.) work if their
manifest path is added; documented but not shipped by default.

## 6. Config & persistence

- **Hotkey** — a **GSettings schema** key `hotkey` of type `as`, default `['<Control>Tab']`.
  Required: `global.display.add_keybinding()` only accepts a GSettings-backed key.
  Same global-grab caveat as macOS (the combo stops reaching apps that use it).
- **Recency** — use Mutter's MRU (`get_tab_list`) directly; no persistence needed within
  a session. (No cross-session recency in v1 — Mutter already survives the session.)
- **Favicons** — `~/.cache/oneswitch/favicons/`.

## 7. NixOS packaging

A **flake** at the repo root with:

- `packages.oneswitch-extension` — installs `oneswitch@oneness.health/` to the extension
  share path; compiles the GSettings schema with `glib-compile-schemas`.
- `packages.oneswitch-browser-host` — the `oneswitch-browser` GJS host as a wrapped
  executable (gjs on PATH via the Nix wrapper).
- `packages.oneswitch-webext` — the built WebExtension `.zip` (Chrome + Firefox).
- `devShells.default` — `gjs`, `nodejs`, `glib` (for `glib-compile-schemas`),
  `gnome-shell` (nested-shell testing), `zip`, `eslint`.
- A **home-manager module** that:
  - enables the extension (`programs.gnome-shell.extensions` or installs + adds the uuid
    to `enabled-extensions`),
  - installs the native host + writes the native-messaging manifests into the Chrome and
    Firefox config dirs via `home.file`,
  - (optionally) sets the hotkey via `dconf`.

Result: the whole thing is installed declaratively from the user's NixOS / home-manager
config; no imperative steps beyond loading the WebExtension into each browser once
(unpacked in dev; via store/policy later).

## 8. Dev loop & testing

- **Iterate without logging out:** run a nested shell —
  `dbus-run-session -- gnome-shell --nested --wayland` — install the extension into the
  nested instance, toggle it, watch logs with
  `journalctl -f -o cat /usr/bin/gnome-shell`, and use **Looking Glass** (Alt-F2 → `lg`).
- **Unit tests** (the safety net) for the **pure** modules with no GNOME imports:
  `model.js` (search/ranking, `>` parsing), `history.js` (history parse/de-dupe),
  `recency.js` (MRU ordering + preselect index), `favicons.js` (host-key logic). Run with
  a GJS or Node test runner in CI / the devShell. **eslint** across all JS.
- **Manual acceptance** in the nested shell for the Shell-integrated paths (hotkey,
  modal grab, window activation, tab switching, command output, clipboard).

## 9. Implementation phases (all v1, in build order)

1. **Skeleton & core switch** — extension scaffold, GSettings hotkey, modal St popup,
   window list/activate (`get_tab_list` MRU), search (`model.js`), recency + previous-
   window preselect, full keyboard navigation. *Usable switcher.*
2. **Launcher & icons** — `.desktop` catalog, launch-if-not-running, app icons in rows.
3. **Command mode** — `>` runner via `Gio.Subprocess`, output panel, clipboard copy,
   shell-history picker, Esc-to-kill.
4. **Browser tabs** — WebExtension, native host, socket bridge, favicons, two-step
   activation. Chrome first, then Firefox.
5. **Polish & packaging** — top-bar indicator, `prefs.js` hotkey recorder, the flake +
   home-manager module, eslint + unit tests wired up, README.

## 10. Risks & mitigations

- **GNOME version churn** — extensions can break on major GNOME upgrades. Target GNOME 47,
  pin `gnome-shell` in the flake, keep Shell-API usage thin and centralized in
  `windows.js` / `switcher.js` so a bump touches few files.
- **Tab-activation focus crossing** — always raise the `Meta.Window` in addition to the
  in-browser `tabs.update` (Section 4.2).
- **Native-messaging manifest paths** differ per browser/channel — the home-manager
  module owns the path matrix; documented for manual installs.
- **St ≠ SwiftUI** — the popup will look GNOME-native (St + CSS subset), not pixel-identical
  to the macOS panel. Accepted; embrace GNOME styling.
- **Firefox tab access** — unlike macOS (AX tree, no URLs), the WebExtension gives Firefox
  **full** tab data including favicons — actually *better* than the macOS Firefox path.

## 11. Non-goals (v1)

- X11 session support (Wayland only; an X11 path is a possible later fallback).
- Safari/Arc tabs (don't exist on Linux).
- Cross-session persistent recency.
- Pixel-identical replication of the macOS SwiftUI panel.
- Distribution via extensions.gnome.org review (local/flake install for now).

## 12. Parity checklist vs macOS

| macOS feature | GNOME port | Mechanism |
| --- | --- | --- |
| Global hotkey (Control+Tab) | ✅ | `add_keybinding` + GSettings |
| Centered modal popup, keyboard grab | ✅ | St modal, `Main.pushModal` |
| App windows, individually | ✅ | `get_tab_list` (MRU) |
| Recency + previous-window preselect | ✅ | Mutter MRU + `recency.js` |
| Orderless fuzzy search + ranking | ✅ | `model.js` (port) |
| App launcher (not-running apps) | ✅ | `Gio.AppInfo` |
| Chrome tabs + favicons | ✅ | WebExtension + native host |
| Firefox tabs + favicons | ✅ (better) | WebExtension + native host |
| Command mode + shell history | ✅ | `Gio.Subprocess`, `St.Clipboard` |
| App icons / favicons | ✅ | `WindowTracker` icons / favicon cache |
| Menu bar: change hotkey | ✅ | `prefs.js` recorder |
| Menu bar: launch at login | ⛔ N/A | extension always runs when logged in |
| Menu bar: quit | ⛔ N/A | disable the extension |
