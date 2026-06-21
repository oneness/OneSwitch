import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, matchHistory } from '../oneswitch@birkey.co/lib/history.js';

test('bash history: most-recent-first, de-duped, blanks dropped', () => {
  const content = 'ls\n\ncd /tmp\nls\n';
  assert.deepEqual(parseHistory(content, 'bash'), ['ls', 'cd /tmp']);
});

test('zsh extended-history timestamps are stripped', () => {
  const content = ': 1700000000:0;git status\n: 1700000005:0;git log\n';
  assert.deepEqual(parseHistory(content, 'zsh'), ['git log', 'git status']);
});

test('matchHistory filters case-insensitively by substring', () => {
  const entries = ['git status', 'git log', 'ls -la'];
  assert.deepEqual(matchHistory(entries, 'GIT'), ['git status', 'git log']);
});

test('matchHistory with empty fragment returns all entries', () => {
  const entries = ['a', 'b'];
  assert.deepEqual(matchHistory(entries, ''), ['a', 'b']);
});
