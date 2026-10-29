// Firefox exposes `browser` (Promise-based); Chrome only has `chrome`.
// chrome.tabs.query({}) without a callback returns undefined in Firefox MV2,
// so we always use the callback form wrapped in a Promise.
const api = typeof browser !== 'undefined' ? browser : chrome;
const HOST = 'health.oneness.oneswitch';
let port = null;

// --- diagnostics -----------------------------------------------------------
// Temporary instrumentation for "Firefox lists only a few of its tabs until the
// browser is restarted". The host is a pure cache of whatever this script last
// pushed, so every push is logged with its trigger, count and payload size, and
// relayed to the host ({type:'log'}) so it lands in the same file as the
// host-side view — one timeline even when the pipe itself is the problem.
//
//   grep -E "WARN|push#|disconnect" $XDG_RUNTIME_DIR/oneswitch-host-firefox.log
//
// Remove this block and the sendLog() calls when the bug is closed.
let seq = 0;
let connects = 0;
let inflight = 0;
let lastCount = -1;

function sendLog(line) {
  try { console.log(`[OneSwitch] ${line}`); } catch (_e) {}
  try { if (port) port.postMessage({ type: 'log', line }); } catch (_e) {}
}

sendLog(`background loaded: api=${typeof api} tabsQuery=${typeof (api.tabs && api.tabs.query)} ` +
        `persistent=${typeof api.runtime.getBackgroundPage}`);

function connect() {
  connects++;
  sendLog(`connect: attempt ${connects}`);
  try {
    port = api.runtime.connectNative(HOST);
  } catch (e) {
    // Unchanged behaviour (the error still propagates), but now it is recorded:
    // a throwing connectNative leaves the extension with no port and no retry.
    sendLog(`connect: connectNative THREW ${e && e.message} — no retry is scheduled`);
    throw e;
  }
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const err = api.runtime.lastError;
    sendLog(`disconnect: lastError=${err ? err.message : 'none'}; reconnecting in 2s`);
    port = null;
    setTimeout(connect, 2000);
  });
  pushTabs('connect');
}

const FAVICON_HOST = /^https?:\/\/([^/:]+)/;
function faviconHost(url) {
  const m = FAVICON_HOST.exec(url || '');
  return m ? m[1] : null;
}

async function pushTabs(trigger) {
  if (!port) { sendLog(`push skipped: no port (trigger=${trigger})`); return; }
  const mySeq = ++seq;
  const t0 = Date.now();
  inflight++;
  let tabs;
  try {
    tabs = await new Promise(resolve => api.tabs.query({}, resolve));
  } catch (e) {
    inflight--;
    sendLog(`push#${mySeq} trigger=${trigger}: tabs.query FAILED ${e && e.message}`);
    return;
  }
  inflight--;
  if (!tabs) {
    sendLog(`push#${mySeq} trigger=${trigger}: tabs.query returned ${tabs} — pushing an empty list`);
  }
  // No favIconUrl here on purpose: it is usually a short URL but Firefox hands
  // some sites a full data: URL of the image (Gmail's is 40 KiB), and it was 99%
  // of this payload — re-sent on every title/favicon change. The host asks for
  // the icons it does not have yet via {type:'want-favicons'} instead.
  const list = (tabs || []).map(t => ({
    tabId: t.id, windowId: t.windowId, title: t.title || '',
    url: t.url || '',
    // Lets the switcher preselect the tab you were actually on when a browser
    // window is represented by its tabs (Ctrl+Tab must not move you elsewhere).
    active: !!t.active,
  }));
  const wins = new Set(list.map(t => t.windowId)).size;
  // `trigger` travels with the snapshot so the host can say why a count changed
  // without guessing (a closed tab and a stale reply look identical otherwise).
  const msg = { type: 'tabs', trigger, tabs: list };
  const bytes = JSON.stringify(msg).length;
  sendLog(`push#${mySeq} trigger=${trigger} tabs=${list.length} windows=${wins} ` +
          `inflight=${inflight} ms=${Date.now() - t0} bytes=${bytes}`);
  // A drop on tabs.onRemoved is just a closed tab. On any other trigger it means
  // a slower, older query resolved last — the one way the list can go backwards.
  if (list.length < lastCount && trigger !== 'tabs.onRemoved') {
    sendLog(`WARN push#${mySeq}: tab count dropped ${lastCount} -> ${list.length} on ` +
            `${trigger} (a stale query resolved last would freeze the list here)`);
  }
  lastCount = list.length;
  if (!port) { sendLog(`push#${mySeq}: port vanished while querying — snapshot dropped`); return; }
  try {
    port.postMessage(msg);
  } catch (e) {
    sendLog(`push#${mySeq}: postMessage THREW ${e && e.message} — later pushes may keep failing`);
  }
}

// Pull, not push: the host names the sites whose icon it is missing, and gets
// only those, once. Only data: URLs are useful — the host writes them to disk.
async function sendFavicons(hosts) {
  const want = new Set(hosts || []);
  if (want.size === 0) return;
  const tabs = await new Promise(resolve => api.tabs.query({}, resolve));
  const items = [];
  const seen = new Set();
  for (const t of tabs || []) {
    const host = faviconHost(t.url);
    const fav = t.favIconUrl || '';
    if (!host || !want.has(host) || seen.has(host) || !fav.startsWith('data:image/')) continue;
    seen.add(host);
    items.push({ host, dataUrl: fav });
  }
  sendLog(`favicons: asked for ${want.size} host(s), sending ${items.length} ` +
          `(${items.reduce((s, i) => s + i.dataUrl.length, 0)} bytes)`);
  if (port && items.length) {
    try { port.postMessage({ type: 'favicons', items }); } catch (e) {
      sendLog(`favicons: postMessage THREW ${e && e.message}`);
    }
  }
}

function onHostMessage(msg) {
  if (!msg) return;
  if (msg.type === 'activate') {
    sendLog(`activate: tabId=${msg.tabId} windowId=${msg.windowId}`);
    api.tabs.update(msg.tabId, { active: true });
    api.windows.update(msg.windowId, { focused: true });
  } else if (msg.type === 'want-favicons') {
    sendFavicons(msg.hosts);
  }
}

for (const [name, ev] of [
  ['tabs.onUpdated', api.tabs.onUpdated],
  ['tabs.onRemoved', api.tabs.onRemoved],
  ['tabs.onActivated', api.tabs.onActivated],
  ['tabs.onCreated', api.tabs.onCreated],
  ['windows.onFocusChanged', api.windows.onFocusChanged],
]) {
  ev.addListener(() => pushTabs(name));
}

connect();
