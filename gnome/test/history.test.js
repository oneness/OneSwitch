import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHistory, matchHistory, matchCommands, MAX_PATH_COMMANDS } from '../oneswitch@birkey.co/lib/history.js';

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

test('matchCommands lists history matches before PATH executables', () => {
  const out = matchCommands(['git status', 'ls -la'], ['git', 'gitk', 'ls'], 'git');
  assert.deepEqual(out, [
    { cmd: 'git status', source: 'history' },
    { cmd: 'git', source: 'path' },
    { cmd: 'gitk', source: 'path' },
  ]);
});

test('matchCommands ranks executable prefix matches before substring matches', () => {
  const out = matchCommands([], ['digitize', 'git', 'gitk'], 'git');
  assert.deepEqual(out.map(e => e.cmd), ['git', 'gitk', 'digitize']);
});

test('matchCommands drops an executable equal to a listed history entry', () => {
  const out = matchCommands(['htop'], ['htop', 'top'], 'top');
  assert.deepEqual(out, [
    { cmd: 'htop', source: 'history' },
    { cmd: 'top', source: 'path' },
  ]);
});

test('matchCommands with empty fragment lists history only', () => {
  const out = matchCommands(['ls -la'], ['ls', 'cat'], '');
  assert.deepEqual(out, [{ cmd: 'ls -la', source: 'history' }]);
});

test('matchCommands caps PATH executables', () => {
  const many = Array.from({ length: 100 }, (_, i) => `cmd${String(i).padStart(3, '0')}`);
  const out = matchCommands([], many, 'cmd');
  assert.equal(out.length, MAX_PATH_COMMANDS);
});
