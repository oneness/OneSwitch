import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndRank, composeResults, orderWithTabs, browserOfWindow, tabItems } from '../oneswitch@birkey.co/lib/model.js';
import { preselectIndexWithTabs } from '../oneswitch@birkey.co/lib/recency.js';

const items = [
  { id: 1, title: 'Inbox — Gmail', appName: 'Firefox' },
  { id: 2, title: 'oneswitch — model.js', appName: 'Code' },
  { id: 3, title: 'Slack | general', appName: 'Slack' },
  { id: 4, title: 'OneSwitch design', appName: 'Notion' },
];

test('empty query returns all items unchanged', () => {
  assert.deepEqual(filterAndRank(items, '').map(i => i.id), [1, 2, 3, 4]);
});

test('tokens are orderless and ANDed across title + appName', () => {
  const r = filterAndRank(items, 'code one').map(i => i.id);
  assert.deepEqual(r, [2]);
});

test('non-matching token excludes the item', () => {
  assert.deepEqual(filterAndRank(items, 'slack gmail').map(i => i.id), []);
});

test('title matches outrank app-only matches', () => {
  const r = filterAndRank(items, 'one').map(i => i.id);
  assert.deepEqual(r.slice(0, 2).sort(), [2, 4]);
});

test('shorter title breaks ties', () => {
  const tie = [
    { id: 'a', title: 'note', appName: 'X' },
    { id: 'b', title: 'note taking longer', appName: 'X' },
  ];
  assert.deepEqual(filterAndRank(tie, 'note').map(i => i.id), ['a', 'b']);
});

// composeResults tests
const wins = [
  { id: 'w1', kind: 'window', title: 'Inbox', appName: 'Firefox' },
  { id: 'w2', kind: 'window', title: 'Code', appName: 'Code' },
];
const apps = [
  { id: 'a1', kind: 'app', title: 'Calculator', appName: '' },
  { id: 'a2', kind: 'app', title: 'Code - OSS', appName: '' },
];

test('empty query returns windows only, no apps', () => {
  assert.deepEqual(composeResults(wins, apps, '').map(i => i.id), ['w1', 'w2']);
});

test('query appends matching apps after matching windows', () => {
  const r = composeResults(wins, apps, 'code').map(i => i.id);
  assert.deepEqual(r, ['w2', 'a2']);
});

test('apps that do not match are excluded', () => {
  const r = composeResults(wins, apps, 'calc').map(i => i.id);
  assert.deepEqual(r, ['a1']);
});

// --- browser windows vs their tabs -----------------------------------------
// A browser window's title is the active tab's title plus a suffix, so listing
// both makes the active tab look duplicated. The window row is replaced by its
// active tab — only when we actually have tabs for that browser — and that row
// keeps the window's place in the recency order. The rest of the browser's tabs
// follow the windows, because the bridge reports recency for two tabs only.

const firefoxWindow = { id: 'win-1', kind: 'window', title: 'Inbox — Gmail — Kasim — Firefox Developer Edition',
                        appName: 'Firefox Developer Edition', appId: 'firefox-devedition.desktop', windowId: 1 };
const terminalWindow = { id: 'win-2', kind: 'window', title: 'emacs', appName: 'Alacritty', appId: 'Alacritty.desktop', windowId: 2 };
const chromeWindow = { id: 'win-3', kind: 'window', title: 'x — Google Chrome', appName: 'Google Chrome', appId: 'google-chrome.desktop', windowId: 3 };
const ffTab = { id: 'tab-firefox-2', kind: 'tab', title: 'Inbox — Gmail', browser: 'firefox', active: true };

test('browserOfWindow matches the app name or the desktop id', () => {
  assert.equal(browserOfWindow(firefoxWindow), 'firefox');
  assert.equal(browserOfWindow(chromeWindow), 'chrome');
  assert.equal(browserOfWindow(terminalWindow), null);
  assert.equal(browserOfWindow({ appName: 'Firefox', appId: '' }), 'firefox');
  assert.equal(browserOfWindow({ appName: 'Chromium', appId: '' }), 'chrome');
  assert.equal(browserOfWindow(null), null);
});

test('the browser window row becomes its active tab, in the window slot', () => {
  const rows = orderWithTabs([firefoxWindow, terminalWindow], [ffTab]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-2', 'win-2']);
});

test('the browser keeps its recency slot instead of sinking below older windows', () => {
  // The regression: with the browser focused and the terminal second, the toggle
  // landed on row 3 — the browser's rows were appended after every window, so
  // the top two rows were the terminal and an unrelated older Chrome window.
  const rows = orderWithTabs([firefoxWindow, terminalWindow, chromeWindow], [ffTab]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-2', 'win-2', 'win-3']);
});

test('keeps the browser window when no tabs were enumerated for it', () => {
  const rows = orderWithTabs([firefoxWindow, terminalWindow], []);
  assert.deepEqual(rows.map(r => r.id), ['win-1', 'win-2']);
});

test('only the browser that has tabs is replaced', () => {
  const rows = orderWithTabs([firefoxWindow, chromeWindow, terminalWindow], [ffTab]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-2', 'win-3', 'win-2']);
});

test('every window of a covered browser resolves to the same run of tabs', () => {
  const second = { ...firefoxWindow, id: 'win-9', windowId: 9 };
  const secondTab = { ...ffTab, id: 'tab-firefox-7', active: false };
  const rows = orderWithTabs([firefoxWindow, second, terminalWindow], [ffTab, secondTab]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-2', 'win-2', 'tab-firefox-7']);
});

test('the browser tabs outside its first rows follow the windows, in strip order', () => {
  const first = { ...ffTab, id: 'tab-firefox-1', active: false };
  const rows = orderWithTabs([firefoxWindow, terminalWindow], [first, ffTab]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-2', 'win-2', 'tab-firefox-1']);
});

test('the tab the browser was showing before sits directly under the one it shows', () => {
  // The two-tab bounce: the webext keeps `previous` only while you stayed in that
  // browser, so that tab is the next most recent context and belongs at row 1 —
  // it used to be left in strip order, at row 4 or row 9 of an 18-row list.
  const active = { ...ffTab, id: 'tab-firefox-7', active: true, previous: false };
  const previous = { ...ffTab, id: 'tab-firefox-1', active: false, previous: true };
  const other = { ...ffTab, id: 'tab-firefox-3', active: false, previous: false };
  const rows = orderWithTabs([firefoxWindow, terminalWindow], [previous, active, other]);
  assert.deepEqual(rows.map(r => r.id),
    ['tab-firefox-7', 'tab-firefox-1', 'win-2', 'tab-firefox-3']);
});

test('a previous tab marked on a different browser is not hoisted', () => {
  const active = { ...ffTab, id: 'tab-firefox-7', active: true, previous: false };
  const chromePrev = { id: 'tab-chrome-1', kind: 'tab', browser: 'chrome', active: false, previous: true };
  const rows = orderWithTabs([firefoxWindow], [active, chromePrev]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-7', 'tab-chrome-1']);
});

test('the browser first row falls back to its first tab when active is not reported', () => {
  const rows = orderWithTabs([firefoxWindow], [{ ...ffTab, active: false }]);
  assert.deepEqual(rows.map(r => r.id), ['tab-firefox-2']);
});

test('a tab without a browser field never replaces anything', () => {
  const rows = orderWithTabs([firefoxWindow], [{ id: 'tab-x', kind: 'tab' }]);
  assert.deepEqual(rows.map(r => r.id), ['win-1']);
});

// --- bridge snapshot → tab rows (lib/model.js tabItems) ---

const snapshot = [
  { tabId: 1, windowId: 11, title: 'SRVIC', url: 'https://srvic.org/', active: false },
  { tabId: 2, windowId: 11, title: 'Inbox — Gmail', url: 'https://mail.google.com/', active: true },
];

const browserWin = {
  id: 'w-ff', kind: 'window', windowId: 862, title: 'browser',
  appName: 'Firefox Developer Edition', appId: 'firefox-devedition.desktop',
};
const emacsWin = {
  id: 'w-emacs', kind: 'window', windowId: 863, title: 'emacs',
  appName: 'Emacs', appId: 'emacs.desktop',
};

test('tabItems copies every field the switcher reads', () => {
  assert.deepEqual(tabItems('firefox', snapshot)[0], {
    id: 'tab-firefox-1',
    kind: 'tab',
    title: 'SRVIC',
    appName: 'Firefox',
    url: 'https://srvic.org/',
    tabId: 1,
    browserWindowId: 11,
    browser: 'firefox',
    active: false,
    previous: false,
  });
});

test('tabItems flags the browser active tab', () => {
  assert.deepEqual(tabItems('firefox', snapshot).map(t => t.active), [false, true]);
});

test('tabItems carries the browser previous-tab mark', () => {
  const marked = [{ ...snapshot[0], prev: true }, { ...snapshot[1], prev: false }];
  assert.deepEqual(tabItems('firefox', marked).map(t => t.previous), [true, false]);
});

test('tabItems copes with a sparse snapshot and an empty one', () => {
  const [row] = tabItems('chrome', [{ tabId: 7, windowId: 3 }]);
  assert.equal(row.active, false);
  assert.equal(row.title, '');
  assert.equal(row.url, '');
  assert.equal(row.appName, 'Google Chrome');
  assert.deepEqual(tabItems('firefox', null), []);
  assert.deepEqual(tabItems('firefox', []), []);
});

// The regression this shape exists for: the browser window is dropped from the
// list, so a Ctrl+Tab bounce has to land on the tab the browser is showing. It
// did not, for as long as the rows were built inline in browser.js without
// `active`: preselectIndexWithTabs() fell through to the browser's first tab.
test('rows from a bridge snapshot preselect the tab the browser is showing', () => {
  const tabs = tabItems('firefox', snapshot);
  const wins = [emacsWin, browserWin];
  const rows = orderWithTabs(wins, tabs);
  const idx = preselectIndexWithTabs(rows, wins, tabs, emacsWin.windowId);
  const chosen = rows[idx];
  assert.equal(chosen.kind, 'tab');
  assert.equal(chosen.url, 'https://mail.google.com/');
  assert.equal(chosen.active, true);
  // The browser was the second-most-recent window, so its row is 1: the
  // two most recent contexts are literally the top two rows.
  assert.equal(idx, 1);
});

test('a snapshot that flags no active tab still lands on a tab, not a window', () => {
  const tabs = tabItems('firefox', snapshot.map(t => ({ ...t, active: false })));
  const wins = [emacsWin, browserWin];
  const rows = orderWithTabs(wins, tabs);
  const idx = preselectIndexWithTabs(rows, wins, tabs, emacsWin.windowId);
  const chosen = rows[idx];
  assert.equal(chosen.kind, 'tab');
  assert.equal(chosen.url, 'https://srvic.org/');   // documented fallback: first tab
});
