// faviconKey/isIco are pure (Node-tested). The disk cache uses GLib via a lazy
// legacy import so this file still loads in Node for the key tests.

export function faviconKey(url) {
  const m = /^https?:\/\/([^/:]+)/.exec(url || '');
  return m ? m[1] : null;
}

// gdk-pixbuf's ICO loader rejects the PNG-compressed frames that modern .ico
// files use ("Compressed icons are not supported"), so an .ico in the cache can
// never paint. The native host rewrites those as PNG at ingest (see
// native-host/favicon-format.js); until a host with that fix has rewritten an
// old file, report it as missing so the switcher draws its fallback icon rather
// than an invisible hole.
export function isIco(buf) {
  return !!buf && buf.length >= 4 &&
    buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
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

// Returns a cached, paintable favicon file path for a url, or null if there is
// none yet (or the file is one the Shell cannot render).
export function cachedFaviconPath(url) {
  const host = faviconKey(url);
  if (!host) return null;
  const path = cachePathFor(host);
  let bytes;
  try {
    const [, contents] = glib().file_get_contents(path);
    bytes = contents;
  } catch (_e) {
    return null;   // not cached
  }
  if (!bytes || bytes.length === 0 || isIco(bytes)) return null;
  return path;
}
