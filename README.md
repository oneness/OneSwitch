# OneSwitch

**Version 1.0**

A lightweight macOS/GNOME (> 50) app/window/tab switcher **and launcher** triggered by **Control+Tab**
(configurable from the menu bar).
Press the hotkey to open a Spotlight-style popup, type to filter, navigate with the
keyboard, and press Enter to go there — switching to the window or tab, or, for an app
that isn't running, launching it. Press Control+Tab again to dismiss it. The list is
sorted most-recently-used first. Pressing the trigger key toggles
between last two windows.

It lists:

- **Browser tabs** individually, with per-page favicons (Chome/Firefox Dev only)
- **Every app's windows** individually, with titles and app icons
- **Installed apps**  that are not running — they appear only while
  searching, ranked below open windows/tabs, and Enter launches them

Runs as a background accessory app: no Dock icon, just a menu bar item.

## Features

- **Recency-sorted** — windows ordered most-recently-used first.
- **Orderless fuzzy search** — type space-separated tokens in any order.
- **App launcher** — Just type and enter.
- **Command mode** — Enter `>` and type to select from history.
- **Search mode** — Enter `?` and type search query.
- **Title bar management** (GNOME) — optionally hide window title bars on maximized
  or tiled windows, Unite-style; the focused window's title (and optional window
  buttons) moves into the top panel.


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

## PR and Bug report
I've been using this as my daily driver for quite some time now, and I
consider it feature-complete. I'll keep doing bug fixes and maintenance
work only — I don't accept pull requests or bug reports.

## License

Copyright (C) 2026 Kasim Tuman

OneSwitch is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License** as published by the Free Software
Foundation, either **version 2** of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but **without any
warranty**; without even the implied warranty of merchantability or fitness for a
particular purpose. See the GNU General Public License for more details.

The full text is in [`LICENSE`](LICENSE). If not, see
<https://www.gnu.org/licenses/old-licenses/gpl-2.0.html>.

> The GNOME Shell extension follows the same license as GNOME Shell itself
> (`GPL-2.0-or-later`), which is required for extensions that use GNOME Shell's
> modules.

`SPDX-License-Identifier: GPL-2.0-or-later`

