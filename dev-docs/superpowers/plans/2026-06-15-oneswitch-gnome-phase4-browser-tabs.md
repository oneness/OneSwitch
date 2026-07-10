# OneSwitch GNOME Port — Phase 4: Browser Tabs (Chrome + Firefox) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** List Chrome and Firefox tabs individually in the switcher (with favicons), and switch to the selected tab — selecting it inside the browser *and* raising the browser's window.

**Architecture:** A cross-browser **WebExtension** reports the live tab list and accepts `activate` over a native-messaging port. A small GJS **native host** (`oneswitch-browser`) bridges that stdio port to a per-browser **Unix domain socket**. The Shell extension's `browser.js` reads the socket(s) to source tab items and send activate requests; `favicons.js` caches favicons. Tab activation is two-step: tell the browser (`tabs.update`+`windows.update`) and raise the `Meta.Window`.

**Tech Stack:** WebExtensions API (Chrome MV3 + Firefox), GJS native-messaging host (`Gio.Subprocess`/stdin-stdout + `Gio.SocketService`), `Gio.SocketClient`, Node `node --test` for the pure stdio framing.

**Prerequisite:** Phases 1–3 complete.

---

## File Structure (Phase 4)

```
gnome/
  webext/
    manifest.json            # NEW  MV3 + Firefox browser_specific_settings
    background.js            # NEW  report tabs + handle activate
  native-host/
    framing.js               # NEW  PURE encode/decode native-messaging frames
    oneswitch-browser.js     # NEW  host: stdio <-> unix socket bridge
    manifests/
      chrome.json.in         # NEW  native-messaging manifest template (Chrome)
      firefox.json.in        # NEW  native-messaging manifest template (Firefox)
  oneswitch@oneness.health/lib/
    browser.js               # NEW  socket client: list tabs + activate
    favicons.js              # NEW  PURE faviconKey() + Gio disk cache
    switcher.js              # MOD  source tabs, render favicons, two-step activate
    windows.js               # MOD  add findWindowByTitle/appId helper for raise
  test/
    framing.test.js          # NEW  node --test
    favicons.test.js         # NEW  node --test
```

Tab item shape: `{ id, kind:'tab', title, appName /*='Google Chrome'|'Firefox'*/, url, tabId, browserWindowId, browser /*'chrome'|'firefox'*/, faviconPath|null }`.

Identifiers: native-messaging host name **`health.oneness.oneswitch`**; sockets at `$XDG_RUNTIME_DIR/oneswitch-browser-<browser>.sock`.

---

### Task 1: `framing.js` — native-messaging frame encode/decode (PURE, TDD)

Native messaging frames a message as a little-endian uint32 length prefix followed by UTF-8 JSON. This pure module does the byte work; both the host and tests use it.

**Files:**
- Create: `gnome/native-host/framing.js`
- Test: `gnome/test/framing.test.js`

- [ ] **Step 1: Write the failing test**

`gnome/test/framing.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeMessage, decodeMessages } from '../native-host/framing.js';

test('encode prefixes a little-endian uint32 length', () => {
  const buf = encodeMessage({ a: 1 });
  const json = JSON.stringify({ a: 1 });
  assert.equal(buf.length, 4 + json.length);
  assert.equal(buf.readUInt32LE(0), json.length);
  assert.equal(buf.subarray(4).toString('utf8'), json);
});

test('decode reads whole frames and returns the remainder', () => {
  const a = encodeMessage({ x: 1 });
  const b = encodeMessage({ y: 2 });
  const { messages, rest } = decodeMessages(Buffer.concat([a, b]));
  assert.deepEqual(messages, [{ x: 1 }, { y: 2 }]);
  assert.equal(rest.length, 0);
});

test('decode leaves a partial trailing frame in rest', () => {
  const a = encodeMessage({ x: 1 });
  const partial = a.subarray(0, a.length - 2);
  const { messages, rest } = decodeMessages(partial);
  assert.deepEqual(messages, []);
  assert.equal(rest.length, partial.length);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gnome && node --test test/framing.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `framing.js`**

`gnome/native-host/framing.js`:

```js
// Pure. Native-messaging frame = uint32 LE length prefix + UTF-8 JSON.
// Uses Buffer (available in Node and in GJS via a tiny shim — see host).

export function encodeMessage(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

export function decodeMessages(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const len = buffer.readUInt32LE(offset);
    if (buffer.length - offset - 4 < len) break; // partial frame
    const body = buffer.subarray(offset + 4, offset + 4 + len);
    messages.push(JSON.parse(body.toString('utf8')));
    offset += 4 + len;
  }
  return { messages, rest: buffer.subarray(offset) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd gnome && node --test test/framing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gnome/native-host/framing.js gnome/test/framing.test.js
git commit -m "feat(gnome): pure native-messaging frame encode/decode"
```

---

### Task 2: WebExtension — report tabs + handle activate

**Files:**
- Create: `gnome/webext/manifest.json`
- Create: `gnome/webext/background.js`

- [ ] **Step 1: Write `manifest.json`**

`gnome/webext/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "OneSwitch Bridge",
  "version": "1.0",
  "description": "Reports tabs to the OneSwitch GNOME extension and switches on request.",
  "permissions": ["tabs"],
  "background": { "service_worker": "background.js", "scripts": ["background.js"] },
  "browser_specific_settings": {
    "gecko": { "id": "oneswitch@oneness.health" }
  }
}
```

(Chrome ignores `scripts`; Firefox ignores `service_worker`. `browser_specific_settings.gecko.id` fixes the Firefox extension id used by the native-messaging `allowed_extensions`.)

- [ ] **Step 2: Write `background.js`**

`gnome/webext/background.js`:

```js
// Cross-browser: `chrome` exists in both Chrome and Firefox MV3.
const api = chrome;
const HOST = 'health.oneness.oneswitch';
let port = null;

function connect() {
  port = api.runtime.connectNative(HOST);
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 2000); });
  pushTabs();
}

async function pushTabs() {
  if (!port) return;
  const tabs = await api.tabs.query({});
  port.postMessage({
    type: 'tabs',
    tabs: tabs.map(t => ({
      tabId: t.id, windowId: t.windowId, title: t.title || '',
      url: t.url || '', favIconUrl: t.favIconUrl || '',
    })),
  });
}

function onHostMessage(msg) {
  if (msg && msg.type === 'activate') {
    api.tabs.update(msg.tabId, { active: true });
    api.windows.update(msg.windowId, { focused: true });
  }
}

for (const ev of [
  api.tabs.onUpdated, api.tabs.onRemoved, api.tabs.onActivated,
  api.tabs.onCreated, api.windows.onFocusChanged,
]) ev.addListener(() => pushTabs());

connect();
```

- [ ] **Step 3: Commit**

```bash
git add gnome/webext/manifest.json gnome/webext/background.js
git commit -m "feat(gnome): WebExtension reports tabs + handles activate"
```

---

### Task 3: Native host — stdio ↔ unix socket bridge

**Files:**
- Create: `gnome/native-host/oneswitch-browser.js`

The host is launched by the browser with the native-messaging manifest's `name` as `argv` context. It reads framed messages on stdin, keeps the latest tab snapshot, serves it on a per-browser Unix socket, and relays `activate` back to stdout. GJS lacks Node's `Buffer`; the host includes a minimal `Buffer`-compatible shim sufficient for `framing.js` (LE uint32 + utf8).

- [ ] **Step 1: Write the host**

`gnome/native-host/oneswitch-browser.js`:

```js
#!/usr/bin/env -S gjs -m
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

// --- minimal Buffer shim so framing.js works under GJS ---
globalThis.Buffer = {
  from(str) { const b = new TextEncoder().encode(str); b.readUInt32LE = readLE; b.writeUInt32LE = writeLE; return wrap(b); },
  alloc(n) { return wrap(new Uint8Array(n)); },
  concat(arr) {
    const total = arr.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const a of arr) { out.set(a, o); o += a.length; }
    return wrap(out);
  },
};
function wrap(u8) {
  u8.readUInt32LE = readLE; u8.writeUInt32LE = writeLE;
  u8.subarray = Uint8Array.prototype.subarray.bind(u8);
  u8.toString = (enc) => new TextDecoder('utf-8').decode(u8);
  return u8;
}
function readLE(off) { return this[off] | (this[off+1]<<8) | (this[off+2]<<16) | (this[off+3]*0x1000000); }
function writeLE(v, off) { this[off]=v&0xff; this[off+1]=(v>>8)&0xff; this[off+2]=(v>>16)&0xff; this[off+3]=(v>>24)&0xff; }

const { encodeMessage, decodeMessages } = await import('./framing.js');

// --- determine which browser launched us (from manifest path / argv) ---
const browser = (ARGV[0] || '').includes('firefox') ? 'firefox' : 'chrome';
const sockPath = `${GLib.getenv('XDG_RUNTIME_DIR')}/oneswitch-browser-${browser}.sock`;

let latestTabs = [];

// --- read framed stdin from the browser ---
const stdin = new Gio.DataInputStream({ base_stream: new Gio.UnixInputStream({ fd: 0, close_fd: false }) });
let inbuf = Buffer.alloc(0);
function pumpStdin() {
  stdin.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (s, res) => {
    const bytes = s.read_bytes_finish(res);
    if (!bytes || bytes.get_size() === 0) { GLib.idle_add(GLib.PRIORITY_DEFAULT, () => System.exit(0)); return; }
    inbuf = Buffer.concat([inbuf, wrap(bytes.get_data())]);
    const { messages, rest } = decodeMessages(inbuf);
    inbuf = rest;
    for (const m of messages) if (m.type === 'tabs') latestTabs = m.tabs;
    pumpStdin();
  });
}

// --- write a framed message to the browser (stdout) ---
const stdout = new Gio.UnixOutputStream({ fd: 1, close_fd: false });
function toBrowser(obj) { const f = encodeMessage(obj); stdout.write_all(f, null); }

// --- serve the unix socket for the Shell extension ---
try { Gio.File.new_for_path(sockPath).delete(null); } catch (_e) {}
const service = new Gio.SocketService();
const addr = new Gio.UnixSocketAddress({ path: sockPath });
service.add_address(addr, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
service.connect('incoming', (_s, conn) => {
  const din = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
  const dout = conn.get_output_stream();
  din.read_line_async(GLib.PRIORITY_DEFAULT, null, (d, res) => {
    const [line] = d.read_line_finish_utf8(res);
    let req = {}; try { req = JSON.parse(line || '{}'); } catch (_e) {}
    if (req.cmd === 'list') {
      const payload = JSON.stringify({ browser, tabs: latestTabs }) + '\n';
      dout.write_all(payload, null);
    } else if (req.cmd === 'activate') {
      toBrowser({ type: 'activate', tabId: req.tabId, windowId: req.windowId });
      dout.write_all('{"ok":true}\n', null);
    }
    conn.close(null);
  });
  return false;
});
service.start();

pumpStdin();
new GLib.MainLoop(null, false).run();
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x gnome/native-host/oneswitch-browser.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add gnome/native-host/oneswitch-browser.js
git commit -m "feat(gnome): native-messaging host bridging stdio to a unix socket"
```

---

### Task 4: Native-messaging manifest templates

**Files:**
- Create: `gnome/native-host/manifests/chrome.json.in`
- Create: `gnome/native-host/manifests/firefox.json.in`

`@HOST_PATH@` is substituted with the absolute path to `oneswitch-browser.js` at install time (the home-manager module in Phase 5, or `sed` for manual installs).

- [ ] **Step 1: Chrome template**

`gnome/native-host/manifests/chrome.json.in`:

```json
{
  "name": "health.oneness.oneswitch",
  "description": "OneSwitch tab bridge",
  "path": "@HOST_PATH@",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://@CHROME_EXT_ID@/"]
}
```

- [ ] **Step 2: Firefox template**

`gnome/native-host/manifests/firefox.json.in`:

```json
{
  "name": "health.oneness.oneswitch",
  "description": "OneSwitch tab bridge",
  "path": "@HOST_PATH@",
  "type": "stdio",
  "allowed_extensions": ["oneswitch@oneness.health"]
}
```

- [ ] **Step 3: Document install paths in `gnome/native-host/README.md`**

`gnome/native-host/README.md`:

```markdown
# OneSwitch native host

Install the filled-in manifest (replace @HOST_PATH@ with the absolute path to
oneswitch-browser.js; for Chrome also replace @CHROME_EXT_ID@ with the unpacked
extension id shown at chrome://extensions) to:

- Chrome:  ~/.config/google-chrome/NativeMessagingHosts/health.oneness.oneswitch.json
- Chromium:~/.config/chromium/NativeMessagingHosts/health.oneness.oneswitch.json
- Firefox: ~/.mozilla/native-messaging-hosts/health.oneness.oneswitch.json

Phase 5's home-manager module writes these automatically.
```

- [ ] **Step 4: Commit**

```bash
git add gnome/native-host/manifests/ gnome/native-host/README.md
git commit -m "feat(gnome): native-messaging manifest templates + install docs"
```

---

### Task 5: `favicons.js` — favicon key + disk cache (PURE key, TDD)

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/favicons.js`
- Test: `gnome/test/favicons.test.js`

- [ ] **Step 1: Write the failing test (pure key logic)**

`gnome/test/favicons.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconKey } from '../oneswitch@oneness.health/lib/favicons.js';

test('faviconKey is the host of an http(s) url', () => {
  assert.equal(faviconKey('https://mail.google.com/mail/u/0'), 'mail.google.com');
});

test('faviconKey returns null for non-web urls', () => {
  assert.equal(faviconKey('chrome://settings'), null);
  assert.equal(faviconKey('about:config'), null);
  assert.equal(faviconKey(''), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd gnome && node --test test/favicons.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `favicons.js`**

`gnome/oneswitch@oneness.health/lib/favicons.js`:

```js
// faviconKey is pure (Node-tested). The disk cache uses GLib and is only
// exercised inside the Shell; it is written so the pure import still loads.

export function faviconKey(url) {
  const m = /^https?:\/\/([^/:]+)/.exec(url || '');
  return m ? m[1] : null;
}

// --- disk cache (Shell-only; lazy GLib import to keep Node happy) ---
let _GLib = null;
function glib() {
  if (!_GLib) _GLib = imports.gi.GLib; // available only inside gnome-shell
  return _GLib;
}

export function cachePathFor(host) {
  const dir = `${glib().get_user_cache_dir()}/oneswitch/favicons`;
  glib().mkdir_with_parents(dir, 0o755);
  return `${dir}/${host}`;
}

// Returns a cached favicon file path for a url, or null if not cached yet.
// (Fetching/seeding from favIconUrl data is wired in switcher.js Task 6.)
export function cachedFaviconPath(url) {
  const host = faviconKey(url);
  if (!host) return null;
  const path = cachePathFor(host);
  return glib().file_test(path, glib().FileTest.EXISTS) ? path : null;
}
```

> Note: `imports.gi.GLib` is the legacy synchronous import, valid inside the Shell and lazily evaluated so Node never hits it. Do not convert this file to a top-level `import GLib from 'gi://GLib'`, which would break the Node test.

- [ ] **Step 4: Run to verify pass**

Run: `cd gnome && node --test test/favicons.test.js`
Expected: PASS — pure key tests green; the lazy GLib path is untouched by Node.

- [ ] **Step 5: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/favicons.js gnome/test/favicons.test.js
git commit -m "feat(gnome): favicon host key (pure) + lazy disk cache"
```

---

### Task 6: `browser.js` — socket client; integrate tabs into the switcher

**Files:**
- Create: `gnome/oneswitch@oneness.health/lib/browser.js`
- Modify: `gnome/oneswitch@oneness.health/lib/windows.js`
- Modify: `gnome/oneswitch@oneness.health/lib/switcher.js`

- [ ] **Step 1: Write `browser.js`**

`gnome/oneswitch@oneness.health/lib/browser.js`:

```js
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { faviconKey } from './favicons.js';

const BROWSERS = ['chrome', 'firefox'];
function sock(browser) {
  return `${GLib.getenv('XDG_RUNTIME_DIR')}/oneswitch-browser-${browser}.sock`;
}

function request(browser, reqObj) {
  const path = sock(browser);
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) return null;
  try {
    const client = new Gio.SocketClient();
    const conn = client.connect(new Gio.UnixSocketAddress({ path }), null);
    conn.get_output_stream().write_all(JSON.stringify(reqObj) + '\n', null);
    const din = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
    const [line] = din.read_line_utf8(null);
    conn.close(null);
    return line ? JSON.parse(line) : null;
  } catch (_e) {
    return null;
  }
}

// Tab items from every running browser bridge.
export function listTabs() {
  const out = [];
  for (const browser of BROWSERS) {
    const resp = request(browser, { cmd: 'list' });
    if (!resp || !resp.tabs) continue;
    const appName = browser === 'firefox' ? 'Firefox' : 'Google Chrome';
    for (const t of resp.tabs) {
      out.push({
        id: `tab-${browser}-${t.tabId}`,
        kind: 'tab',
        title: t.title || '',
        appName,
        url: t.url || '',
        tabId: t.tabId,
        browserWindowId: t.windowId,
        browser,
        faviconHost: faviconKey(t.url),
      });
    }
  }
  return out;
}

export function activateTab(item) {
  request(item.browser, { cmd: 'activate', tabId: item.tabId, windowId: item.browserWindowId });
}
```

- [ ] **Step 2: Add a window-raise helper in `windows.js`**

Append to `gnome/oneswitch@oneness.health/lib/windows.js`:

```js
// Raise the browser window for an activated tab. Best-effort: match the
// browser app, preferring the window whose title contains the tab title.
export function raiseBrowserWindow(browser, tabTitle) {
  const tracker = Shell.WindowTracker.get_default();
  const wantFirefox = browser === 'firefox';
  let fallback = null;
  for (const w of global.display.get_tab_list(Meta.TabList.NORMAL, null)) {
    const app = tracker.get_window_app(w);
    const name = (app ? app.get_name() : '').toLowerCase();
    const isFirefox = name.includes('firefox');
    const isChrome = name.includes('chrome') || name.includes('chromium');
    if (wantFirefox ? isFirefox : isChrome) {
      fallback = fallback || w;
      if (tabTitle && (w.get_title() || '').includes(tabTitle)) { Main.activateWindow(w); return; }
    }
  }
  if (fallback) Main.activateWindow(fallback);
}
```

- [ ] **Step 3: Source tabs + two-step activation in `switcher.js`**

Add the import:

```js
import * as Browser from './browser.js';
```

In `open()`, after sourcing apps, add tabs and fold them into the window list so search/recency treat them as rows (tabs rank alongside windows):

```js
    this._tabs = Browser.listTabs();
    this._all = this._all.concat(this._tabs);
```

(Place this immediately after `this._all = Windows.listWindows();` and before computing `this._apps`/preselect, so `this._all` already includes tabs when `composeResults('')` and `preselectIndex` run.)

In `_render()`, add a favicon branch (after the existing window/app icon branches):

```js
      else if (it.kind === 'tab') {
        const path = Favicons.cachedFaviconPath(it.url);
        if (path) row.add_child(new St.Icon({ gicon: Gio.icon_new_for_string(path), icon_size: 22 }));
      }
```

Add the favicons import near the top:

```js
import * as Favicons from './favicons.js';
```

In `_activateIndex()`, add a tab branch (before the app/window branches, inside the non-command path):

```js
    if (it.kind === 'tab') {
      Browser.activateTab(it);
      Windows.raiseBrowserWindow(it.browser, it.title);
      return;
    }
```

- [ ] **Step 4: Commit**

```bash
git add gnome/oneswitch@oneness.health/lib/browser.js \
  gnome/oneswitch@oneness.health/lib/windows.js \
  gnome/oneswitch@oneness.health/lib/switcher.js
git commit -m "feat(gnome): list + switch browser tabs via the native-host socket"
```

---

### Task 7: End-to-end acceptance

**Files:** none.

- [ ] **Step 1: Load the WebExtension**

- Chrome: `chrome://extensions` → Developer mode → Load unpacked → `gnome/webext/`. Note the extension id; fill `@CHROME_EXT_ID@` in the Chrome native-messaging manifest and install it (see `native-host/README.md`). Fill `@HOST_PATH@` with the absolute path to `oneswitch-browser.js`.
- Firefox: `about:debugging` → This Firefox → Load Temporary Add-on → `gnome/webext/manifest.json`. Install the Firefox native-messaging manifest.

- [ ] **Step 2: Verify the bridge**

Run: `ls $XDG_RUNTIME_DIR/oneswitch-browser-*.sock`
Expected: a socket appears for each running browser once its extension has connected.

- [ ] **Step 3: Verify in the nested shell**

Run: `cd gnome && make test && make install && make nested`
Then `gnome-extensions enable oneswitch@oneness.health`, open the switcher, and confirm:

- Chrome and Firefox tabs appear as individual rows (title + browser name).
- Selecting a tab + Enter switches the browser to that tab **and** raises the browser window.
- Search filters tabs alongside windows; closing a browser makes its tabs disappear from the list (socket gone → `listTabs` skips it).

Expected: all pass. (Favicons may be blank until Task-6 favicon seeding is extended; row text + activation are the acceptance bar for Phase 4.)

- [ ] **Step 4: Commit any fixes**

```bash
git add -A gnome/
git commit -m "fix(gnome): Phase 4 browser-tab acceptance fixes"
```

---

## Self-Review

**Spec coverage (Phase 4 slice):** Chrome tabs listed + switchable → Tasks 2,3,6 ✅; Firefox tabs listed + switchable (with full data, better than macOS) → same, cross-browser WebExtension ✅; native-messaging host + per-browser socket bridge → Tasks 1,3 ✅; two-step activation (`tabs.update`+`windows.update` and raise `Meta.Window`) → Task 2 `onHostMessage` + Task 6 `raiseBrowserWindow` ✅; favicons (host-keyed, cached) → Task 5 + Task 6 render branch ✅; manifests for Chrome+Firefox paths → Task 4 ✅.

**Placeholder scan:** `@HOST_PATH@`/`@CHROME_EXT_ID@` are intentional install-time template tokens (documented in Task 4 / Task 7), not plan placeholders. Favicon *seeding from `favIconUrl`* is explicitly deferred (row text + switching are the Phase-4 bar); the cache read path is complete. No TODO/TBD.

**Type consistency:** frame functions `encodeMessage(obj)`/`decodeMessages(buffer)→{messages,rest}` (Task 1) used identically in the host (Task 3). Host socket protocol `{cmd:'list'}→{browser,tabs}` and `{cmd:'activate',tabId,windowId}` (Task 3) matches `browser.js` `request`/`listTabs`/`activateTab` (Task 6). Tab item shape `{kind:'tab', url, tabId, browserWindowId, browser, title}` produced in `listTabs` and consumed in `_render`/`_activateIndex`/`raiseBrowserWindow` (Task 6). `faviconKey(url)` (Task 5) used in `browser.js` and `cachedFaviconPath` (Tasks 5,6). ✅
