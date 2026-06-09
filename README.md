# OneSwitch

A lightweight macOS app/window/tab switcher triggered by **Control+Tab**. Press the
hotkey to open a Spotlight-style popup, type to filter, arrow keys to move, Enter to
switch. It lists:

- **Google Chrome tabs** individually (via AppleScript)
- **Every app's windows** individually, with titles (via the Accessibility API)

Runs as a background accessory app (no Dock icon).

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
   to list and raise individual windows. Without it, the list degrades to one entry per app.
2. **Automation → Google Chrome** — required to list/switch Chrome tabs.

Grant once; the signed identity keeps them valid across rebuilds.

## Architecture

- `WindowManager` — enumerates Chrome tabs (AppleScript) + app windows (Accessibility
  API), and activates a selected item.
- `HotKeyManager` — registers the global Control+Tab hotkey (Carbon).
- `SwitcherPanelController` / `SwitcherView` / `SwitcherModel` — the popup UI and its state.
- `main.swift` — wires it together as an accessory `NSApplication`.

## Known limitations

- **Control+Tab is grabbed globally**, so it no longer switches tabs inside apps that use
  it (browsers, terminals). Hotkey is not yet configurable.
- **Firefox** exposes no per-tab scripting; its windows are listed via the Accessibility
  API instead (so no tab-level switching for Firefox).
- Only **Chrome** has tab-level support so far (Safari/Arc not yet implemented).

## Diagnostics

```sh
.build/debug/OneSwitch --dump   # print the tab/window list and permission status
```
