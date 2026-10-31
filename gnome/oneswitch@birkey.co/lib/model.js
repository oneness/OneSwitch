// Pure search/ranking. No GNOME imports so Node can unit-test it.

function scoreItem(title, appName, tokens) {
  let score = 0;
  for (const t of tokens) {
    const inTitle = title.includes(t);
    const inApp = appName.includes(t);
    if (inTitle) score += 10;
    else if (inApp) score += 4;
    if (title.startsWith(t)) score += 6;
    if (new RegExp(`\\b${escapeRe(t)}`).test(title)) score += 3;
  }
  return score;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function filterAndRank(items, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return items.slice();
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const it of items) {
    const title = (it.title || '').toLowerCase();
    const app = (it.appName || '').toLowerCase();
    const hay = `${title} ${app}`;
    if (!tokens.every(t => hay.includes(t))) continue;
    scored.push({ item: it, score: scoreItem(title, app, tokens) });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (a.item.title || '').length - (b.item.title || '').length);
  return scored.map(s => s.item);
}

// Windows always show; apps only while searching, ranked after windows.
export function composeResults(windows, apps, query) {
  const w = filterAndRank(windows, query);
  if (!(query || '').trim()) return w;
  const a = filterAndRank(apps, query);
  return w.concat(a);
}

// Which browser a window belongs to. Matched on substrings because the app name
// is not stable ("Firefox", "Firefox Developer Edition") and the desktop id
// ("firefox-devedition.desktop") is the more reliable of the two.
export function browserOfWindow(w) {
  const hay = `${(w && w.appName) || ''} ${(w && w.appId) || ''}`.toLowerCase();
  if (hay.includes('firefox')) return 'firefox';
  if (hay.includes('chrome') || hay.includes('chromium')) return 'chrome';
  return null;
}

// The list the switcher shows, in recency order. A browser window whose tabs we can
// list must not also be a row: its title is the active tab's title plus a suffix, so
// the active tab would appear twice. Its slot is filled by its tabs in recency order
// — the tab it is showing, then the tab it was showing before — and that is the
// whole point of the two-tab bounce: leaving the second one in strip order put it at
// row 4, or row 9 of an 18-row list, so Ctrl+Tab between two tabs of one browser
// landed deep in the list while the top two rows said otherwise. Those two are the
// only ones the bridges report recency for; the rest follow the windows in strip
// order. In the macOS build the tab rows carry their browser window's AX element and
// so sort into that window's MRU slot — the same rule.
//
// The `previous` mark is only kept while you stayed in that browser (see the tab
// recency block in webext/background.js), so when it is present it really is the
// next most recent context — ahead of the other windows, which is where it goes.
// A browser we have no tabs for keeps its window, so a failed tab enumeration never
// loses the window; the same rule as the macOS WindowManager.allItems() list.
export function orderWithTabs(windows, tabs) {
  const blocks = new Map();          // browser -> its tabs, in strip order
  for (const t of tabs || []) {
    if (!t || !t.browser) continue;
    if (!blocks.has(t.browser)) blocks.set(t.browser, []);
    blocks.get(t.browser).push(t);
  }

  const prefix = new Map();          // browser -> the rows filling its window slot
  const out = [];
  for (const w of windows || []) {
    const browser = browserOfWindow(w);
    const block = browser ? blocks.get(browser) : null;
    if (!block || block.length === 0) { out.push(w); continue; }
    // Every window of a covered browser resolves to the same block, so only the
    // first one carries it; the rest would duplicate the run of tabs.
    if (prefix.has(browser)) continue;
    const head = tabPrefix(block);
    prefix.set(browser, head);
    out.push(...head);
  }

  for (const [browser, block] of blocks) {
    const head = prefix.get(browser) || [];
    for (const t of block) if (!head.includes(t)) out.push(t);
  }
  return out;
}

// The rows that fill a browser's window slot: the tab it is showing, then the one
// it was showing before. Both fall back to the first tab when nothing is flagged,
// and `previous` is skipped if it names the same tab or is absent. Several windows
// of one browser can put more than one `previous` in the snapshot; only the first
// is hoisted here — the rest keep strip order with the other tabs.
function tabPrefix(block) {
  const active = block.find(t => t.active) || block[0];
  const head = [active];
  const previous = block.find(t => t.previous && t !== active);
  if (previous) head.push(previous);
  return head;
}

// Bridge snapshot → tab rows: the other half of browserOfWindow(). These rows are
// what the switcher orders and preselects from, and a field missing here is
// silently inert rather than an error — `active` was exactly that, and every
// Ctrl+Tab bounce went to the browser's first tab instead of the tab you were on.
// So every field a consumer reads is copied by name, and test/model.test.js asserts
// the shape.
export function tabItems(browser, snapshotTabs) {
  const appName = browser === 'firefox' ? 'Firefox' : 'Google Chrome';
  return (snapshotTabs || []).map(t => ({
    id: `tab-${browser}-${t.tabId}`,
    kind: 'tab',
    title: t.title || '',
    appName,
    url: t.url || '',
    tabId: t.tabId,
    // Named for the browser window on purpose: `windowId` on a window row is
    // Meta's window id, and preselectIndex() compares it against the focused
    // window — the browser's own numbering must not be mistaken for that.
    browserWindowId: t.windowId,
    browser,
    // Which tab the browser is showing. preselectIndexWithTabs() needs it to turn
    // a dropped browser window into the tab you were actually on.
    active: !!t.active,
    // The tab this window showed before the current one (webext/background.js).
    // While the popup is opened from inside the browser this is the only thing
    // that can answer "the last two things I was on were two tabs".
    previous: !!t.prev,
  }));
}
