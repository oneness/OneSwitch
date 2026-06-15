import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../oneswitch@birkey.oneness/lib/query.js';

test('plain text is search mode', () => {
  assert.deepEqual(parseQuery('firefox'), { mode: 'search', value: 'firefox' });
});

test('leading > is command mode, > stripped and left-trimmed', () => {
  assert.deepEqual(parseQuery('>  ls -la'), { mode: 'command', value: 'ls -la' });
});

test('bare > is command mode with empty value', () => {
  assert.deepEqual(parseQuery('>'), { mode: 'command', value: '' });
});
