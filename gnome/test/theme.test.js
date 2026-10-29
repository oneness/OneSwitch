import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLightScheme, applyPalette, LIGHT_STYLE_CLASS } from '../oneswitch@birkey.co/lib/theme.js';

test('only prefer-dark selects the dark palette', () => {
  assert.equal(isLightScheme('prefer-dark'), false);
  assert.equal(isLightScheme('default'), true);
  assert.equal(isLightScheme('prefer-light'), true);
});

test('applyPalette tags the actor when the shell is light', () => {
  const classes = new Set();
  const actor = {
    add_style_class_name: (c) => classes.add(c),
    remove_style_class_name: (c) => classes.delete(c),
  };
  applyPalette(actor, 'default');
  assert.ok(classes.has(LIGHT_STYLE_CLASS));
});

test('applyPalette drops the class again when the shell switches to dark', () => {
  const classes = new Set([LIGHT_STYLE_CLASS]);
  const actor = {
    add_style_class_name: (c) => classes.add(c),
    remove_style_class_name: (c) => classes.delete(c),
  };
  applyPalette(actor, 'prefer-dark');
  assert.equal(classes.has(LIGHT_STYLE_CLASS), false);
});

test('applyPalette tolerates a missing actor', () => {
  assert.doesNotThrow(() => applyPalette(null, 'default'));
});
