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
