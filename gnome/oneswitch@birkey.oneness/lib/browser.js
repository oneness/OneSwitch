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
