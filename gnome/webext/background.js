// Firefox exposes `browser` (Promise-based); Chrome only has `chrome`.
// chrome.tabs.query({}) without a callback returns undefined in Firefox MV2,
// so we always use the callback form wrapped in a Promise.
const api = typeof browser !== 'undefined' ? browser : chrome;
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
  const tabs = await new Promise(resolve => api.tabs.query({}, resolve));
  if (!port) return;
  port.postMessage({
    type: 'tabs',
    tabs: (tabs || []).map(t => ({
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
