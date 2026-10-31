import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preselectIndex, preselectIndexWithTabs } from '../oneswitch@birkey.co/lib/recency.js';
import { orderWithTabs } from '../oneswitch@birkey.co/lib/model.js';

test('skips the focused window, selecting the next most-recent', () => {
  const items = [
    { windowId: 100 },
    { windowId: 200 },
    { windowId: 300 },
  ];
  assert.equal(preselectIndex(items, 100), 1);
});

test('skips multiple leading rows that belong to the focused window', () => {
  const items = [
    { windowId: 100 },
    { windowId: 100 },
    { windowId: 200 },
  ];
  assert.equal(preselectIndex(items, 100), 2);
});

test('falls back to 0 when every row is the focused window', () => {
  assert.equal(preselectIndex([{ windowId: 100 }], 100), 0);
});

test('falls back to 0 on empty input', () => {
  assert.equal(preselectIndex([], 100), 0);
});

test('returns 0 when focusedId is null (no focused window)', () => {
  const items = [{ windowId: 200 }, { windowId: 300 }];
  assert.equal(preselectIndex(items, null), 0);
});

// --- the same choice in the list the switcher shows ------------------------
// Ctrl+Tab must still land where you were: the previous *window* if that was a
// normal window, or the tab standing for it if it was a browser. The list is the
// recency-ordered one from model.js orderWithTabs, so the answer is a plain index
// into it — no more `kept.length + tabs.indexOf()` arithmetic to get wrong.

const ffWin = { id: 'win-1', kind: 'window', appName: 'Firefox Developer Edition', appId: 'firefox-devedition.desktop', windowId: 1 };
const term = { id: 'win-2', kind: 'window', appName: 'Alacritty', appId: 'Alacritty.desktop', windowId: 2 };
const tabA = { id: 'tab-firefox-1', kind: 'tab', browser: 'firefox', title: 'a', active: false };
const tabB = { id: 'tab-firefox-2', kind: 'tab', browser: 'firefox', title: 'b', active: true };

test('preselects the active tab of the previous browser window', () => {
  const tabs = [tabA, tabB];
  const rows = orderWithTabs([ffWin, term], tabs);
  // rows = [tabB (browser slot), term, tabA]
  assert.equal(preselectIndexWithTabs(rows, [ffWin, term], tabs, term.windowId), 0);
});

test('the two most recent contexts are the two most recent rows', () => {
  // From the browser: the terminal is next. From the terminal: the browser's
  // tab it is showing is next. That is what makes the toggle read as "the top two".
  const tabs = [tabA, tabB];
  const wins = [ffWin, term];
  const rows = orderWithTabs(wins, tabs);
  assert.equal(rows.indexOf(tabs[1]), 0);                                    // browser slot
  assert.equal(preselectIndexWithTabs(rows, wins, tabs, ffWin.windowId), 1); // -> terminal
  assert.equal(preselectIndexWithTabs(rows, wins, tabs, term.windowId), 0);  // -> the browser row
});

test('a window before the browser does not shift its row', () => {
  const tabs = [tabA, tabB];
  const rows = orderWithTabs([term, ffWin], tabs);
  assert.equal(preselectIndexWithTabs(rows, [term, ffWin], tabs, term.windowId), 1);
});

test('falls back to the browser first tab when active is not reported', () => {
  const noActive = [{ ...tabA }, { ...tabB, active: false }];
  const wins = [term, ffWin];
  const rows = orderWithTabs(wins, noActive);
  assert.equal(rows[1].id, tabA.id);
  assert.equal(preselectIndexWithTabs(rows, wins, noActive, term.windowId), 1);
});

test('unchanged when the focused window is the browser (skips its tabs)', () => {
  const tabs = [tabA, tabB];
  const rows = orderWithTabs([ffWin, term], tabs);
  // focused = the Firefox window itself -> previous window is the terminal
  assert.equal(preselectIndexWithTabs(rows, [ffWin, term], tabs, ffWin.windowId), 1);
});

test('a browser with no tabs keeps its window row and is still selectable', () => {
  const rows = orderWithTabs([ffWin, term], []);
  assert.deepEqual(rows.map(r => r.id), [ffWin.id, term.id]);
  assert.equal(preselectIndexWithTabs(rows, [ffWin, term], [], term.windowId), 0);
});

test('a single window and no tabs selects row 0 instead of throwing', () => {
  assert.equal(preselectIndexWithTabs([term], [term], [], term.windowId), 0);
});

// --- inside a browser: the tab you left is the context ----------------------
// The window MRU cannot answer "the last two things were two tabs": for a focused
// browser it only offers the window you came from. The webext marks the previous
// tab, and only while you stayed in that browser, so the mark means what it says.

const tabPrev = {
  id: 'tab-firefox-1', kind: 'tab', browser: 'firefox', title: 'a',
  active: false, previous: true,
};

test('from inside the browser, the tab you left wins over the MRU window', () => {
  const tabs = [tabPrev, { ...tabB }];          // a = previous, b = active
  const rows = orderWithTabs([ffWin, term], tabs);
  const idx = preselectIndexWithTabs(rows, [ffWin, term], tabs, ffWin.windowId);
  assert.equal(rows[idx].id, tabPrev.id);
});

test('a two-tab bounce lands on row 1, next to the tab you are on', () => {
  // Recorded from the shell: bouncing between two Firefox tabs landed on row 4 and
  // row 9 of an 18-row list, because only the active tab kept the browser's slot.
  const active = { ...tabB, id: 'tab-firefox-7', active: true, previous: false };
  const previous = { ...tabPrev, id: 'tab-firefox-1', active: false, previous: true };
  const tabs = [previous, active];
  const wins = [ffWin, term];
  const rows = orderWithTabs(wins, tabs);
  assert.equal(rows.indexOf(active), 0);
  assert.equal(preselectIndexWithTabs(rows, wins, tabs, ffWin.windowId), 1);
  assert.equal(rows[1].id, previous.id);
});

test('a previous tab of another browser is ignored', () => {
  const tabs = [{ ...tabPrev, browser: 'chrome' }, { ...tabB }];
  const rows = orderWithTabs([ffWin, term], tabs);
  assert.equal(preselectIndexWithTabs(rows, [ffWin, term], tabs, ffWin.windowId), 1);  // the terminal
});

test('the previous tab does not hijack a choice made from a normal window', () => {
  const tabs = [tabPrev, { ...tabB }];
  const rows = orderWithTabs([term, ffWin], tabs);
  const idx = preselectIndexWithTabs(rows, [term, ffWin], tabs, term.windowId);
  assert.equal(rows[idx].id, tabB.id);   // its active tab, not the previous one
});
