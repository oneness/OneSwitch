import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterAndRank, composeResults } from '../oneswitch@birkey.co/lib/model.js';

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
