# OneSwitch

A lightweight macOS app/window/tab switcher **and launcher** triggered by **Control+Tab**
(configurable from the menu bar).
Press the hotkey to open a Spotlight-style popup, type to filter, navigate with the
keyboard, and press Enter to go there — switching to the window or tab, or, for an app
that isn't running, launching it. Press Control+Tab again to dismiss it. The list is
sorted most-recently-used first.

It lists:

- **Google Chrome tabs** individually, with per-page favicons (via pid-addressed Apple
  Events — see Diagnostics for why not AppleScript)
- **Firefox tabs** individually (via the Accessibility API: each tab is an `AXTabButton`;
  pressing it switches. No URLs in the AX tree, so rows show the Firefox icon, not favicons)
- **Every app's windows** individually, with titles and app icons (via the Accessibility API)
- **Installed apps** (`/Applications`, `~/Applications`, `/System/Applications`) that are
  not running — they appear only while searching, ranked below open windows/tabs, and
  Enter launches them

Runs as a background accessory app: no Dock icon, just a menu bar item.

> **Linux / GNOME:** a GNOME Shell port (GNOME 47–50, Wayland, NixOS flake install)
> lives in [`gnome/`](gnome/README.md).

## Features

- **Recency-sorted** — windows ordered most-recently-used first (tracked via the
  Accessibility API + app-activation notifications).
- **Instant toggle** — the switcher opens with the *previous* window already highlighted
  (skipping other rows of the current window, e.g. its own tabs), so Control+Tab, Enter
  bounces between your two most recent windows. Chrome windows participate via their
  active-tab row.
- **Orderless fuzzy search** — type space-separated tokens in any order; every token must
  appear in the title or app name. Results are ranked (title matches, prefix/word-boundary
  matches, and shorter titles score higher).
- **App launcher** — Enter on an installed-but-not-running app launches it, so "switch to
  an app" works whether or not it is already open. One key, one meaning: take me there.
- **Command mode** — type `>` followed by a shell command; matching shell history appears
  for selection. Enter runs the selected history command, while Ctrl+J runs exactly what
  is typed (`bash -lc`, your login environment, home directory). Output appears in the
  panel (stdout+stderr, exit code shown) and is copied to the clipboard in full. Esc kills
  a running command. No TTY, so interactive commands and sudo are out.
- **Real icons** — app icons for windows, page favicons for Chrome tabs. Favicons are
  keyed by host, fetched from DuckDuckGo's favicon service with a fallback to the site's
  own `/favicon.ico` (covers intranet/private hosts), and cached two-tier (in-memory +
  on-disk under `~/Library/Caches`), so they survive relaunches with no re-fetch.
  Non-web tabs (`chrome://…`) show the Chrome icon.
- **Menu bar item** — change the hotkey (a recorder panel captures the next combo you
  press), toggle **Launch at Login**, and quit from the status bar (the app has no Dock
  icon, so this is also the only quit affordance). The hotkey persists in UserDefaults.

### Keys

| Key | Action |
| --- | --- |
| **Control+Tab** | Open the switcher (previous window preselected); press again to dismiss |
| **Tab** / **Shift+Tab** | Move selection down / up |
| **↓ / ↑** | Move selection down / up |
| **Ctrl+N / Ctrl+P** | Move selection down / up |
| **Return** | Switch to the selected window or tab; launch the selected app if not running; run the selected shell history command in `>` mode |
| **Ctrl+J** | In `>` mode, run exactly what is typed |
| **Esc** | Dismiss |
| Click a row | Switch to it; command history rows run that command |

## Requirements

- macOS 13+
- Swift toolchain (Xcode or Swift 5.9+)

## Build & run

One-time: create the stable self-signed code-signing identity. Signing with a fixed
identity means macOS permission grants survive rebuilds (an unsigned/adhoc binary's
code hash changes every build, which would otherwise revoke the grant each time).

```sh
scripts/setup-signing.sh
```

Build and sign the app bundle:

```sh
scripts/build-app.sh          # release build -> OneSwitch.app
scripts/build-app.sh debug    # faster debug build
```

Install and launch:

```sh
cp -R OneSwitch.app /Applications/
open /Applications/OneSwitch.app
```

## Permissions

On first launch macOS will prompt for two permissions:

1. **Accessibility** (System Settings ▸ Privacy & Security ▸ Accessibility) — required
   to list and raise individual windows, and to track window recency. Without it, the list
   degrades to one entry per app.
2. **Automation → Google Chrome** — required to list/switch Chrome tabs.

Grant once; the signed identity keeps them valid across rebuilds.

## Architecture

- `WindowManager` — enumerates Chrome tabs (via `ChromeScripting`), Firefox tabs
  (Accessibility API tab buttons), and app windows (Accessibility API); picks the user's
  real Chrome among multiple instances, and activates a selected item.
- `ChromeScripting` — pid-addressed raw Apple Events to one specific Chrome process:
  list windows/tabs, read or set the active tab, raise a window (2s timeout per event).
- `AppLog` — timestamped diagnostics to `~/Library/Logs/OneSwitch.log` (the app runs
  headless, so stderr alone would be lost).
- `AppCatalog` — scans the application directories for launchable .app bundles (cached,
  rescanned when a directory's mtime changes).
- `WindowHistory` — tracks most-recently-used windows by `CGWindowID` (via app-activation
  notifications + explicit recording) so the list can sort by recency and the switcher can
  preselect the previous window for the Enter toggle.
- `FaviconCache` — two-tier (memory + disk) favicon cache, resolved off the main thread.
- `HotKeyManager` — registers the global Control+Tab hotkey (Carbon).
- `SwitcherPanelController` / `SwitcherView` / `SwitcherModel` — the popup panel, its SwiftUI
  view, and the observable state (search filtering, ranking, selection).
- `StatusBarController` — the menu bar item, Launch-at-Login toggle (`SMAppService`), and Quit.
- `main.swift` — wires it together as an accessory `NSApplication`.

## Known limitations

- **The hotkey is grabbed globally**, so the chosen combo no longer reaches apps that use
  it themselves (e.g. Control+Tab switches tabs in browsers and terminals). Pick a combo
  you don't need elsewhere; modifier-only combos (like double-tap Ctrl) aren't possible
  with the Carbon hotkey API.
- **Firefox tabs** come from the AX tree, which exposes no URLs — so no per-tab favicons,
  and a Firefox UI overhaul could require adjusting the lookup (if that happens, Firefox
  windows transparently fall back to one-row-per-window).
- **Gecko builds its AX tree lazily**: a freshly launched Firefox exposes only a bare
  window until an assistive client announces itself. OneSwitch sets
  `AXEnhancedUserInterface` on Firefox (at startup, on Firefox launch, and whenever tab
  enumeration comes up empty) to trigger the build; the tree appears within a few seconds,
  and the open panel refreshes in place (0.6s/1.8s) to pick it up.
- Tab-level support covers **Chrome and Firefox** (Safari/Arc not yet implemented).
- Switching between two windows of the *same* app (without changing apps) fires no activation
  notification, so intra-app recency can lag until the switcher is next opened.

## Diagnostics

Errors (Apple Events failures, timeouts, permission problems) are appended to
`~/Library/Logs/OneSwitch.log` — the app runs headless, so this is the place to look
when Chrome tabs go missing from the switcher. `--dump` marks each window's active
tab with `*`.

```sh
.build/debug/OneSwitch --dump              # print the item list as the switcher sees it
.build/debug/OneSwitch --focus-tab <id>    # focus a Chrome tab by id (ids shown by --dump)
.build/debug/OneSwitch --focus-fftab <id>  # press a Firefox tab button (e.g. fftab-0-1)
.build/debug/OneSwitch --ax-dump <App>     # print an app's AX tree (web content pruned)
.build/debug/OneSwitch --run-cmd "<cmd>"   # exercise command mode's runner (replaces clipboard)
```

Chrome queries are sent as **pid-addressed raw Apple Events** (`ChromeScripting`), not
AppleScript. `tell application "Google Chrome"` addresses by bundle id, and when a second
Chrome process is running — e.g. the headless `--headless --user-data-dir=…` instance that
browser-automation tooling spawns — macOS routes those events to an arbitrary instance,
silently listing the wrong browser's tabs. OneSwitch picks the real instance itself
(`activationPolicy == .regular`, longest-running) and addresses it by pid, which
AppleScript cannot express. Events carry a 2s timeout so a wedged Chrome can't hang the
switcher.

AppleScript gotchas (for posterity): Chrome declares window/tab `id` as *text* in its
sdef, but a single tab's `id of t` arrives as an *integer* — `"123" is 123` is false, so
compare ids `as string`. And the `abso` ordinal in a raw object specifier keeps its OSType
payload in native byte order.
