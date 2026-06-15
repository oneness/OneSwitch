import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconKey } from '../oneswitch@birkey.oneness/lib/favicons.js';

test('faviconKey is the host of an http(s) url', () => {
  assert.equal(faviconKey('https://mail.google.com/mail/u/0'), 'mail.google.com');
});

test('faviconKey returns null for non-web urls', () => {
  assert.equal(faviconKey('chrome://settings'), null);
  assert.equal(faviconKey('about:config'), null);
  assert.equal(faviconKey(''), null);
});
