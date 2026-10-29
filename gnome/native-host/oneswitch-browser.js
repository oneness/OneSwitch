#!/usr/bin/env -S gjs -m
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';

// --- minimal Buffer shim so framing.js works under GJS ---
globalThis.Buffer = {
  from(str) { const b = new TextEncoder().encode(str); return wrap(b); },
  alloc(n) { return wrap(new Uint8Array(n)); },
  concat(arr) {
    const total = arr.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let o = 0;
    for (const a of arr) { out.set(a, o); o += a.length; }
    return wrap(out);
  },
};
function wrap(u8) {
  u8.readUInt32LE = readLE;
  u8.writeUInt32LE = writeLE;
  u8.subarray = (...args) => wrap(Uint8Array.prototype.subarray.apply(u8, args));
  u8.toString = () => new TextDecoder('utf-8').decode(u8);
  return u8;
}
function readLE(off) {
  return this[off] | (this[off+1]<<8) | (this[off+2]<<16) | (this[off+3]*0x1000000);
}
function writeLE(v, off) {
  this[off]=v&0xff; this[off+1]=(v>>8)&0xff; this[off+2]=(v>>16)&0xff; this[off+3]=(v>>24)&0xff;
}

const { encodeMessage, decodeMessages } = await import('./framing.js');
const { normalizeFavicon } = await import('./favicon-format.js');

// Determine which browser launched us from the manifest name passed in argv.
const browser = (ARGV[0] || '').includes('firefox') ? 'firefox' : 'chrome';
const sockPath = `${GLib.getenv('XDG_RUNTIME_DIR')}/oneswitch-browser-${browser}.sock`;

// --- diagnostics -----------------------------------------------------------
// Temporary instrumentation for "Firefox lists only a few of its tabs until the
// browser is restarted". This host is a *pure cache* of the last snapshot the
// webext pushed, so a frozen list can come from either end. Both ends append to
// one file — this host directly, the webext via {type:'log'} frames — so a
// single grep gives the whole timeline:
//
//   grep -E "WARN|FATAL|heartbeat|push#|serve list" \
//     $XDG_RUNTIME_DIR/oneswitch-host-firefox.log | tail -100
//
// Remove this block and the dlog() calls when the bug is closed.
const inst = GLib.uuid_string_random().slice(0, 8);
const logPath = `${GLib.getenv('XDG_RUNTIME_DIR')}/oneswitch-host-${browser}.log`;
const LOG_MAX = 8 * 1024 * 1024;
let logStream = null;
let logBroken = false;
let logBytes = 0;
let logFails = 0;

function dlog(msg) {
  if (logBroken) return;
  try {
    const line = `${new Date().toISOString()} [${inst}] ${msg}\n`;
    const bytes = new TextEncoder().encode(line);
    const f = Gio.File.new_for_path(logPath);
    // Replace the whole file with this line. Note GFile.replace() only swaps the
    // temp file in on close(), and replace_contents() rejects an empty buffer,
    // so rotation has to write the line itself rather than truncate to nothing.
    const rotate = () => {
      f.replace_contents(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
      logBytes = bytes.length;
    };
    if (!logStream) {
      // Append across host restarts — a dying host is part of the story.
      let size = 0;
      try { size = f.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size(); } catch (_e) {}
      if (size > LOG_MAX) { rotate(); return; }
      logStream = f.append_to(Gio.FileCreateFlags.NONE, null);
      logBytes = size;
    } else if (logBytes + bytes.length > LOG_MAX) {
      try { logStream.close(null); } catch (_e) {}
      logStream = null;
      rotate();
      return;
    }
    logStream.write_all(bytes, null);
    logBytes += bytes.length;
    logFails = 0;
  } catch (_e) {
    // Logging must never take the host down with it, and must recover from a
    // transient stream error rather than going dark for the rest of its life.
    try { if (logStream) logStream.close(null); } catch (_e2) {}
    logStream = null;
    if (++logFails > 5) logBroken = true;
  }
}

let latestTabs = [];
let pushes = 0;
let lastPushMs = 0;

// --- favicon cache ---------------------------------------------------------
// The webext no longer ships favIconUrl with every snapshot (image data was 99%
// of it). Instead we ask for the icons we do not have yet, once per site, and
// write them where the Shell extension reads them:
// ~/.cache/oneswitch/favicons/<page host>.
const favCacheDir = `${GLib.getenv('XDG_CACHE_HOME') || `${GLib.getenv('HOME')}/.cache`}/oneswitch/favicons`;
const askedFavicons = new Set();

function hostOf(url) {
  const m = /^https?:\/\/([^/:]+)/.exec(url || '');
  return m ? m[1] : null;
}

function requestMissingFavicons() {
  const want = [];
  for (const t of latestTabs) {
    const h = hostOf(t.url);
    if (!h || askedFavicons.has(h)) continue;
    askedFavicons.add(h);
    if (!GLib.file_test(`${favCacheDir}/${h}`, GLib.FileTest.EXISTS)) want.push(h);
  }
  if (want.length) {
    dlog(`favicons: asking the webext for ${want.length} missing icon(s): ${want.join(' ')}`);
    toBrowser({ type: 'want-favicons', hosts: want });
  }
}

function writeFavicons(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  try { GLib.mkdir_with_parents(favCacheDir, 0o755); } catch (_e) {}
  let wrote = 0;
  let unusable = 0;
  for (const it of items) {
    const host = it && it.host;
    // host becomes a filename: keep it to what a hostname can contain.
    if (!host || !/^[A-Za-z0-9._-]+$/.test(host)) continue;
    const m = /^data:image\/[^;]+;base64,(.+)$/.exec((it && it.dataUrl) || '');
    if (!m) continue;
    // .ico payloads are rewritten as their PNG frame here: the Shell's image
    // loader cannot read PNG-compressed ICO frames (see favicon-format.js).
    const bytes = normalizeFavicon(GLib.base64_decode(m[1]));
    if (!bytes) { unusable++; continue; }
    try {
      if (GLib.file_set_contents(`${favCacheDir}/${host}`, bytes)) wrote++;
    } catch (_e) {}
  }
  dlog(`favicons: wrote ${wrote}/${items.length} icon(s) to ${favCacheDir}` +
       (unusable ? ` (${unusable} unusable payload(s) skipped)` : ''));
}

// Icons cached before the ICO→PNG rewrite are still on disk and would never be
// re-fetched (the webext is only asked for hosts we lack), so fix them in place.
function migrateCachedFavicons() {
  let dir;
  try {
    dir = Gio.File.new_for_path(favCacheDir)
      .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
  } catch (_e) {
    return;   // no cache dir yet
  }
  let rewrote = 0;
  let info;
  while ((info = dir.next_file(null)) !== null) {
    const path = `${favCacheDir}/${info.get_name()}`;
    try {
      const [, bytes] = GLib.file_get_contents(path);
      const png = normalizeFavicon(bytes);
      if (!png || png === bytes) continue;   // not an ICO, or nothing to rewrite
      if (GLib.file_set_contents(path, png)) rewrote++;
    } catch (_e) {}
  }
  try { dir.close(null); } catch (_e) {}
  if (rewrote) dlog(`favicons: rewrote ${rewrote} cached .ico icon(s) as PNG`);
}

dlog(`start: browser=${browser} sock=${sockPath} argv=${JSON.stringify(ARGV)}`);
migrateCachedFavicons();

// --- read framed stdin from the browser ---
const stdinStream = new Gio.DataInputStream({
  base_stream: new Gio.UnixInputStream({ fd: 0, close_fd: false }),
});
let inbuf = Buffer.alloc(0);

function applyMessage(m, bytes, parseMs) {
  if (!m || typeof m !== 'object') { dlog('recv: non-object message'); return; }
  if (m.type === 'tabs') {
    const prev = latestTabs.length;
    const hadTabs = Array.isArray(m.tabs);
    latestTabs = hadTabs ? m.tabs : [];
    pushes++;
    lastPushMs = Date.now();
    const wins = new Set(latestTabs.map(t => t.windowId)).size;
    // bytes/parseMs/pending show whether this host is keeping up: `pending` is
    // what is still sitting in inbuf (a partial frame), so a growing value means
    // frames are arriving faster than they are parsed.
    const trig = typeof m.trigger === 'string' ? ` trigger=${m.trigger}` : '';
    dlog(`recv tabs#${pushes}: ${latestTabs.length} tab(s) in ${wins} window(s), was ${prev} ` +
         `bytes=${bytes} parseMs=${parseMs} pending=${inbuf.length}${trig}` +
         (hadTabs ? '' : ' (WARNING: payload had no tabs array)'));
    if (parseMs > 100)
      dlog(`WARN tabs#${pushes}: parsing took ${parseMs}ms — the host is falling behind the push rate`);
    // A drop is usually just a closed tab. Only the webext knows the trigger, so
    // state the fact here and let its log line say whether it was unexpected.
    if (latestTabs.length < prev)
      dlog(`note tabs#${pushes}: snapshot went ${prev} -> ${latestTabs.length} tab(s)${trig}`);
    if (latestTabs.length === 0)
      dlog(`WARN tabs#${pushes}: snapshot is EMPTY`);
    requestMissingFavicons();
  } else if (m.type === 'favicons') {
    writeFavicons(m.items);
  } else if (m.type === 'log') {
    dlog(`webext: ${m.line}`);
  } else {
    dlog(`recv: unknown type=${m.type}`);
  }
}

function pumpStdin() {
  stdinStream.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (s, res) => {
    let bytes;
    try { bytes = s.read_bytes_finish(res); } catch (e) {
      dlog(`stdin: read failed (${e && e.message}) -> exit`);
      System.exit(0); return;
    }
    if (!bytes || bytes.get_size() === 0) {
      dlog('stdin: EOF — the browser closed the port; exiting so the next connect starts clean');
      GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { System.exit(0); return false; });
      return;
    }
    let msgs = [];
    const t0 = Date.now();
    let consumed = 0;
    try {
      const before = inbuf.length;
      inbuf = Buffer.concat([inbuf, wrap(bytes.get_data())]);
      const decoded = decodeMessages(inbuf);
      msgs = decoded.messages;
      inbuf = decoded.rest;
      // Bytes of whole frames completed by this read (0 while a big frame is
      // still arriving) — not the 64 KiB read chunk.
      consumed = before + bytes.get_size() - inbuf.length;
    } catch (e) {
      // Deliberately not swallowed: the original code dies here too, and a dead
      // pump is one of the ways the snapshot can freeze while the socket keeps
      // happily serving the stale list. Make it visible, then fail as before.
      dlog(`FATAL pump: ${e && e.message} — stdin pump stops here; ` +
           `the socket will keep serving a frozen snapshot until the host is restarted`);
      throw e;
    }
    const parseMs = Date.now() - t0;
    for (const m of msgs) applyMessage(m, consumed, parseMs);
    pumpStdin();
  });
}

// Heartbeat: proves the host is alive while no pushes arrive. A run of these
// with a growing age and a constant tab count is the "frozen snapshot" smoking
// gun; a gap in them means the host itself stalled.
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
  const age = lastPushMs ? Math.round((Date.now() - lastPushMs) / 1000) : -1;
  dlog(`heartbeat: pushes=${pushes} tabs=${latestTabs.length} lastPushAge=${age}s`);
  return GLib.SOURCE_CONTINUE;
});

// --- write a framed message to the browser (stdout) ---
const stdoutStream = new Gio.UnixOutputStream({ fd: 1, close_fd: false });
function toBrowser(obj) {
  const f = encodeMessage(obj);
  stdoutStream.write_all(f, null);
}

// --- serve the unix socket for the Shell extension ---
try {
  Gio.File.new_for_path(sockPath).delete(null);
  dlog('socket: removed a pre-existing socket file (previous host crashed, or another host is alive)');
} catch (_e) {}
const service = new Gio.SocketService();
const addr = new Gio.UnixSocketAddress({ path: sockPath });
try {
  service.add_address(addr, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
} catch (e) {
  dlog(`FATAL socket: add_address(${sockPath}) failed: ${e && e.message}`);
  throw e;
}
service.connect('incoming', (_s, conn) => {
  const din = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
  const dout = conn.get_output_stream();
  din.read_line_async(GLib.PRIORITY_DEFAULT, null, (d, res) => {
    let line;
    try { [line] = d.read_line_finish_utf8(res); } catch (e) {
      dlog(`serve: read failed (${e && e.message})`);
      conn.close(null); return;
    }
    let req = {}; try { req = JSON.parse(line || '{}'); } catch (_e) {}
    const age = lastPushMs ? Math.round((Date.now() - lastPushMs) / 1000) : -1;
    if (req.cmd === 'list') {
      // The age is context, not a verdict: pushes only happen on tab/window
      // events, so a snapshot hours old is normal after a long read. probe.py
      // is what decides whether a short list is actually wrong.
      dlog(`serve list: tabs=${latestTabs.length} lastPushAge=${age}s pushes=${pushes}`);
      dout.write_all(JSON.stringify({ browser, tabs: latestTabs, ts: lastPushMs, pushes }) + '\n', null);
    } else if (req.cmd === 'activate') {
      dlog(`serve activate: tabId=${req.tabId} windowId=${req.windowId}`);
      toBrowser({ type: 'activate', tabId: req.tabId, windowId: req.windowId });
      dout.write_all('{"ok":true}\n', null);
    } else {
      dlog(`serve: unknown cmd=${req.cmd}`);
    }
    conn.close(null);
  });
  return false;
});
service.start();
dlog('socket: listening');

pumpStdin();
new GLib.MainLoop(null, false).run();
