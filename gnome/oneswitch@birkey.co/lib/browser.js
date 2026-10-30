import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import { tabItems } from './model.js';

const BROWSERS = ['chrome', 'firefox'];

function sock(browser) {
  return `${GLib.getenv('XDG_RUNTIME_DIR')}/oneswitch-browser-${browser}.sock`;
}

// The host serves a cached snapshot, so every failure here is worth a line in
// the journal: a missing socket, a refused connect and a stale snapshot all
// look identical from the popup (fewer tabs than the browser has).
function request(browser, reqObj) {
  const path = sock(browser);
  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
    log(`[OneSwitch] browser: ${browser} ${reqObj.cmd}: no socket at ${path}`);
    return null;
  }
  try {
    const client = new Gio.SocketClient();
    const conn = client.connect(new Gio.UnixSocketAddress({ path }), null);
    conn.get_output_stream().write_all(JSON.stringify(reqObj) + '\n', null);
    const din = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
    const [line] = din.read_line_utf8(null);
    conn.close(null);
    if (!line) {
      log(`[OneSwitch] browser: ${browser} ${reqObj.cmd}: empty reply from ${path}`);
      return null;
    }
    return JSON.parse(line);
  } catch (e) {
    // Previously swallowed silently — this is where a dead or stale socket shows up.
    log(`[OneSwitch] browser: ${browser} ${reqObj.cmd} FAILED: ${e && e.message}`);
    return null;
  }
}

// Tab items from every running browser bridge.
export function listTabs() {
  const out = [];
  for (const browser of BROWSERS) {
    const resp = request(browser, { cmd: 'list' });
    if (!resp || !resp.tabs) {
      log(`[OneSwitch] browser: ${browser}: reply carried no tab list`);
      continue;
    }
    // ts/pushes are diagnostics from the host: how old the snapshot it served
    // is. Age alone is not a fault — pushes only happen on tab/window events, so
    // a snapshot hours old is normal after a long read (probe.py decides).
    const age = resp.ts ? Math.round((Date.now() - resp.ts) / 1000) : -1;
    log(`[OneSwitch] browser: ${browser}: ${resp.tabs.length} tab(s), snapshot age ${age}s, pushes ${resp.pushes}`);
    // Row shape lives in model.js so it can be unit-tested: a field dropped while
    // translating here is invisible until the popup picks the wrong row.
    out.push(...tabItems(browser, resp.tabs));
  }
  return out;
}

// `sameBrowser` says the popup was opened from this browser, which the webext
// needs to know whether the tab you are leaving is a bounce target or whether the
// window you came from is (see the tab-recency block in webext/background.js).
export function activateTab(item, { sameBrowser = false } = {}) {
  request(item.browser, {
    cmd: 'activate',
    tabId: item.tabId,
    windowId: item.browserWindowId,
    sameBrowser: !!sameBrowser,
  });
}
