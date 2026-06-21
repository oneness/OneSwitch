import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preselectIndex } from '../oneswitch@birkey.co/lib/recency.js';

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
