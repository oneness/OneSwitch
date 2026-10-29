import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preselectIndex, preselectIndexWithTabs } from '../oneswitch@birkey.co/lib/recency.js';

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

// --- the same choice when a browser window is replaced by its tabs ----------
// Ctrl+Tab must still land where you were: the previous *window* if that was a
// normal window, or the tab you had active if it was a browser.

const ffWin = { id: 'win-1', kind: 'window', appName: 'Firefox Developer Edition', appId: 'firefox-devedition.desktop', windowId: 1 };
const term = { id: 'win-2', kind: 'window', appName: 'Alacritty', appId: 'Alacritty.desktop', windowId: 2 };
const tabA = { id: 'tab-firefox-1', kind: 'tab', browser: 'firefox', title: 'a', active: false };
const tabB = { id: 'tab-firefox-2', kind: 'tab', browser: 'firefox', title: 'b', active: true };

test('preselects the active tab of the previous browser window', () => {
  const full = [ffWin, term, tabA, tabB];
  const kept = [term];
  // index into kept.concat(tabs) = [term, tabA, tabB]
  assert.equal(preselectIndexWithTabs(full, kept, [tabA, tabB], 2), 2);
});

test('falls back to the browser first tab when active is not reported', () => {
  const noActive = [{ ...tabA }, { ...tabB, active: false }];
  const full = [ffWin, term, ...noActive];
  assert.equal(preselectIndexWithTabs(full, [term], noActive, 2), 1);
});

test('unchanged when the previous window is a normal window', () => {
  const full = [term, ffWin, tabA, tabB];
  assert.equal(preselectIndexWithTabs(full, [term], [tabA, tabB], 1), 0);
});

test('unchanged when the focused window is the browser (skips its tabs)', () => {
  const full = [ffWin, term, tabA, tabB];
  // focused = the Firefox window itself -> previous window is the terminal
  assert.equal(preselectIndexWithTabs(full, [term], [tabA, tabB], 1), 0);
});

test('a tab target maps to its own position in the shown list', () => {
  const full = [tabA, term];
  // shown list is [term, tabA], so the tab is at 1
  assert.equal(preselectIndexWithTabs(full, [term], [tabA], 2), 1);
});

test('indices stay correct when a window before the target is dropped', () => {
  // ffWin is dropped, so `term` moves from index 1 to index 0 in the shown list
  const full = [ffWin, term, tabA, tabB];
  assert.equal(preselectIndexWithTabs(full, [term], [tabA, tabB], 1), 0);
});
