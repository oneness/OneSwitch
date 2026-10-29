import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconKey, isIco } from '../oneswitch@birkey.co/lib/favicons.js';

test('faviconKey is the host of an http(s) url', () => {
  assert.equal(faviconKey('https://mail.google.com/mail/u/0'), 'mail.google.com');
});

test('faviconKey returns null for non-web urls', () => {
  assert.equal(faviconKey('chrome://settings'), null);
  assert.equal(faviconKey('about:config'), null);
  assert.equal(faviconKey(''), null);
});

test('isIco only matches the ICO directory header', () => {
  assert.equal(isIco(Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x03, 0x00])), true);
  assert.equal(isIco(Uint8Array.from([0x89, 0x50, 0x4e, 0x47])), false);   // PNG
  assert.equal(isIco(Uint8Array.from([0x00, 0x00, 0x01])), false);         // too short
  assert.equal(isIco(null), false);
});
