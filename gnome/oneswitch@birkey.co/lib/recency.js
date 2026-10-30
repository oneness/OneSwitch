// Pure. Given MRU-ordered items and the focused window id, pick the initial
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

// Same choice, but expressed as an index into the list the switcher actually
// shows (kept.concat(tabs)). Two translations are needed, because dropping a
// browser window shifts every later index and because the MRU target may itself
// have been a dropped window: then the target becomes that browser's tab — the
// active one, or the browser's first if the webext did not say. `full` is the
// pre-drop list (windows then tabs, MRU order), so the MRU decision is unchanged.
export function preselectIndexWithTabs(full, kept, tabs, focusedId) {
  // Inside a browser, the previous context is a tab, not a window: the MRU list
  // has nothing better to offer than the window you came from, which is wrong when
  // the last two things were two tabs of the same browser. The webext marks that
  // tab, and only keeps the mark while you stayed in the browser — so when it is
  // present it really is the most recent context.
  const focused = (full || []).find(it => it.kind === 'window' && it.windowId === focusedId);
  const focusedBrowser = focused ? browserOfWindow(focused) : null;
  if (focusedBrowser) {
    const previous = (tabs || []).find(t => t.browser === focusedBrowser && t.previous);
    if (previous) return kept.length + tabs.indexOf(previous);
  }

  const target = full[preselectIndex(full, focusedId)];
  if (!target) return 0;
  if (target.kind !== 'window') {
    const i = tabs.indexOf(target);
    return i === -1 ? 0 : kept.length + i;
  }
  const k = kept.indexOf(target);
  if (k !== -1) return k;
  const browser = browserOfWindow(target);
  const replacement = tabs.find(t => t.browser === browser && t.active) ||
                      tabs.find(t => t.browser === browser);
  return replacement ? kept.length + tabs.indexOf(replacement) : 0;
}
