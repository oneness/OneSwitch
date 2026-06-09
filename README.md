# OneSwitch

A lightweight macOS app/window/tab switcher triggered by **Control+Tab**. Press the
hotkey to open a Spotlight-style popup, type to filter, navigate with the keyboard, and
press Enter to switch. Press Control+Tab again to dismiss it. The list is sorted
most-recently-used first.

It lists:

- **Google Chrome tabs** individually, with per-page favicons (via AppleScript)
- **Every app's windows** individually, with titles and app icons (via the Accessibility API)

Runs as a background accessory app: no Dock icon, just a menu bar item.

## Features

- **Recency-sorted** — windows ordered most-recently-used first (tracked via the
  Accessibility API + app-activation notifications).
- **Orderless fuzzy search** — type space-separated tokens in any order; every token must
  appear in the title or app name. Results are ranked (title matches, prefix/word-boundary
  matches, and shorter titles score higher).
- **Real icons** — app icons for windows, page favicons for Chrome tabs. Favicons are fetched
  from DuckDuckGo and cached two-tier (in-memory + on-disk under `~/Library/Caches`), so they
  survive relaunches with no re-fetch.
- **Menu bar item** — toggle **Launch at Login** and quit from the status bar (the app has no
  Dock icon, so this is also the only quit affordance).

### Keys

| Key | Action |
| --- | --- |
| **Control+Tab** | Open the switcher; press again to dismiss |
| **Tab** / **Shift+Tab** | Move selection down / up |
| **↓ / ↑** | Move selection down / up |
| **Ctrl+N / Ctrl+P** | Move selection down / up |
| **Return** | Switch to the selected window or tab |
| **Esc** | Dismiss |
| Click a row | Switch to it |

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

- `WindowManager` — enumerates Chrome tabs (AppleScript) + app windows (Accessibility
  API), and activates a selected item.
- `WindowHistory` — tracks most-recently-used windows by `CGWindowID` (via app-activation
  notifications + explicit recording) so the list can sort by recency.
- `FaviconCache` — two-tier (memory + disk) favicon cache, resolved off the main thread.
- `HotKeyManager` — registers the global Control+Tab hotkey (Carbon).
- `SwitcherPanelController` / `SwitcherView` / `SwitcherModel` — the popup panel, its SwiftUI
  view, and the observable state (search filtering, ranking, selection).
- `StatusBarController` — the menu bar item, Launch-at-Login toggle (`SMAppService`), and Quit.
- `main.swift` — wires it together as an accessory `NSApplication`.

## Known limitations

- **Control+Tab is grabbed globally**, so it no longer switches tabs inside apps that use
  it (browsers, terminals). The hotkey is not configurable.
- **Firefox** exposes no per-tab scripting; its windows are listed via the Accessibility
  API instead (so no tab-level switching for Firefox).
- Only **Chrome** has tab-level support so far (Safari/Arc not yet implemented).
- Switching between two windows of the *same* app (without changing apps) fires no activation
  notification, so intra-app recency can lag until the switcher is next opened.

## Diagnostics

```sh
.build/debug/OneSwitch --dump   # print the tab/window list and permission status
```
