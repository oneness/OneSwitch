import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndRank, composeResults, dropTabbedBrowserWindows, browserOfWindow, tabItems } from '../oneswitch@birkey.co/lib/model.js';
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
// both makes the active tab look duplicated. The window is dropped only when we
// actually have tabs for that browser.

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

test('drops the browser window when its tabs are listed', () => {
  const kept = dropTabbedBrowserWindows([firefoxWindow, terminalWindow], [ffTab]);
  assert.deepEqual(kept.map(w => w.id), ['win-2']);
});

test('keeps the browser window when no tabs were enumerated for it', () => {
  const kept = dropTabbedBrowserWindows([firefoxWindow, terminalWindow], []);
  assert.deepEqual(kept.map(w => w.id), ['win-1', 'win-2']);
});

test('drops only the browser that has tabs', () => {
  const kept = dropTabbedBrowserWindows([firefoxWindow, chromeWindow, terminalWindow], [ffTab]);
  assert.deepEqual(kept.map(w => w.id), ['win-3', 'win-2']);
});

test('drops every window of a covered browser (tabs stand for all of them)', () => {
  const second = { ...firefoxWindow, id: 'win-9', windowId: 9 };
  const kept = dropTabbedBrowserWindows([firefoxWindow, second, terminalWindow], [ffTab]);
  assert.deepEqual(kept.map(w => w.id), ['win-2']);
});

test('a tab without a browser field never drops anything', () => {
  const kept = dropTabbedBrowserWindows([firefoxWindow], [{ id: 'tab-x', kind: 'tab' }]);
  assert.deepEqual(kept.map(w => w.id), ['win-1']);
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
  const kept = dropTabbedBrowserWindows(wins, tabs);
  const idx = preselectIndexWithTabs(wins.concat(tabs), kept, tabs, emacsWin.windowId);
  const chosen = kept.concat(tabs)[idx];
  assert.equal(chosen.kind, 'tab');
  assert.equal(chosen.url, 'https://mail.google.com/');
  assert.equal(chosen.active, true);
});

test('a snapshot that flags no active tab still lands on a tab, not a window', () => {
  const tabs = tabItems('firefox', snapshot.map(t => ({ ...t, active: false })));
  const wins = [emacsWin, browserWin];
  const kept = dropTabbedBrowserWindows(wins, tabs);
  const idx = preselectIndexWithTabs(wins.concat(tabs), kept, tabs, emacsWin.windowId);
  const chosen = kept.concat(tabs)[idx];
  assert.equal(chosen.kind, 'tab');
  assert.equal(chosen.url, 'https://srvic.org/');   // documented fallback: first tab
});
