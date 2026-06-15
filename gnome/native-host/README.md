# OneSwitch native host

`oneswitch-browser.js` is a GJS script launched by the browser over stdio native
messaging. It bridges the browser's tab list to a Unix socket that the Shell
extension reads.

## Manual install

Fill in `@HOST_PATH@` with the absolute path to `oneswitch-browser.js` (or the Nix
wrapper at `result/bin/oneswitch-browser`). For Chrome also replace `@CHROME_EXT_ID@`
with the unpacked extension id shown at `chrome://extensions`.

Install the filled manifest to:

| Browser   | Path |
|-----------|------|
| Chrome    | `~/.config/google-chrome/NativeMessagingHosts/health.oneness.oneswitch.json` |
| Chromium  | `~/.config/chromium/NativeMessagingHosts/health.oneness.oneswitch.json` |
| Firefox   | `~/.mozilla/native-messaging-hosts/health.oneness.oneswitch.json` |

Phase 5's home-manager module writes these automatically with the correct host path.
