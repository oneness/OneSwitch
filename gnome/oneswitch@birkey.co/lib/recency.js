// Pure. Given MRU-ordered windows and the focused window id, pick the initial
// selection: the previous (next most-recent) window. Falls back to 0.

import { browserOfWindow } from './model.js';

export function preselectIndex(items, focusedId) {
  if (!items || items.length === 0) return 0;
  if (focusedId === null || focusedId === undefined) return 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].windowId !== focusedId) return i;
  }
  return 0;
}

// The same choice, expressed as an index into the list the switcher actually shows
// (model.js orderWithTabs), where a browser window has been replaced by its tabs in
// recency order. `ordered` is that list; `windows` is the pre-replacement MRU list,
// which is still needed because it is the only place the focused *window* exists —
// a browser's own window row is gone from `ordered` — and because the MRU decision
// must be made on windows, not on rows of tabs.
export function preselectIndexWithTabs(ordered, windows, tabs, focusedId) {
  const rows = ordered || [];
  const tabRows = tabs || [];

  // Inside a browser, the previous context is a tab, not a window: the MRU list
  // has nothing better to offer than the window you came from, which is wrong when
  // the last two things were two tabs of the same browser. The webext marks that
  // tab, and only keeps the mark while you stayed in the browser — so when it is
  // present it really is the most recent context.
  const focused = (windows || []).find(w => w.windowId === focusedId);
  const focusedBrowser = focused ? browserOfWindow(focused) : null;
  if (focusedBrowser) {
    const previous = tabRows.find(t => t.browser === focusedBrowser && t.previous);
    const i = previous ? rows.indexOf(previous) : -1;
    if (i !== -1) return i;
  }

  // The next window down the MRU stack — the classic Ctrl+Tab target. A browser
  // target is reached through its first row (the tab it is showing), which is the
  // same rule model.js used to place that row in the first place.
  const target = (windows || [])[preselectIndex(windows, focusedId)];
  if (!target) return 0;
  const browser = browserOfWindow(target);
  if (browser) {
    const firstRow = tabRows.find(t => t.browser === browser && t.active) ||
                     tabRows.find(t => t.browser === browser);
    const i = firstRow ? rows.indexOf(firstRow) : -1;
    if (i !== -1) return i;
  }
  const i = rows.indexOf(target);
  return i === -1 ? 0 : i;
}
