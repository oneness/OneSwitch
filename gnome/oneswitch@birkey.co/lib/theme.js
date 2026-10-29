// Light/dark palette selection.
//
// GNOME Shell 47+ ships three stylesheets (light, dark, high contrast) and picks
// one from org.gnome.desktop.interface's `color-scheme` setting. Extension actors
// are not part of the shell's themed tree, so the popup cannot inherit that
// choice — it paints itself from our own stylesheet, which was dark-only.
//
// So we mirror the same setting instead of guessing: callers read `color-scheme`
// and tag their root actor with LIGHT_STYLE_CLASS, and stylesheet.css carries a
// light override for every hard-coded dark colour under `.oneswitch-light`.
//
// Kept free of gi:// imports so node --test can exercise it.

export const DESKTOP_INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
export const COLOR_SCHEME_KEY = 'color-scheme';
export const LIGHT_STYLE_CLASS = 'oneswitch-light';

// 'default' and 'prefer-light' are light; only 'prefer-dark' asks for dark.
export function isLightScheme(scheme) {
  return scheme !== 'prefer-dark';
}

// Tag (or untag) an actor with the light palette class. The descendant selectors
// in stylesheet.css carry the class down to the row labels and command output.
export function applyPalette(actor, scheme) {
  if (!actor) return;
  if (isLightScheme(scheme)) actor.add_style_class_name(LIGHT_STYLE_CLASS);
  else actor.remove_style_class_name(LIGHT_STYLE_CLASS);
}
