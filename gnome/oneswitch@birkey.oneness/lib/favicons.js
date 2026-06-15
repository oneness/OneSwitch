// faviconKey is pure (Node-tested). The disk cache uses GLib via a lazy
// legacy import so this file still loads in Node for the key tests.

export function faviconKey(url) {
  const m = /^https?:\/\/([^/:]+)/.exec(url || '');
  return m ? m[1] : null;
}

// --- disk cache (Shell-only; lazy import to keep Node happy) ---
let _GLib = null;
function glib() {
  if (!_GLib) _GLib = imports.gi.GLib;
  return _GLib;
}

export function cachePathFor(host) {
  const dir = `${glib().get_user_cache_dir()}/oneswitch/favicons`;
  glib().mkdir_with_parents(dir, 0o755);
  return `${dir}/${host}`;
}

// Returns a cached favicon file path for a url, or null if not cached yet.
export function cachedFaviconPath(url) {
  const host = faviconKey(url);
  if (!host) return null;
  const path = cachePathFor(host);
  return glib().file_test(path, glib().FileTest.EXISTS) ? path : null;
}
