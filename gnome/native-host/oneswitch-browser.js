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

// Determine which browser launched us from the manifest name passed in argv.
const browser = (ARGV[0] || '').includes('firefox') ? 'firefox' : 'chrome';
const sockPath = `${GLib.getenv('XDG_RUNTIME_DIR')}/oneswitch-browser-${browser}.sock`;

let latestTabs = [];

// --- read framed stdin from the browser ---
const stdinStream = new Gio.DataInputStream({
  base_stream: new Gio.UnixInputStream({ fd: 0, close_fd: false }),
});
let inbuf = Buffer.alloc(0);

function pumpStdin() {
  stdinStream.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (s, res) => {
    let bytes;
    try { bytes = s.read_bytes_finish(res); } catch (_e) { System.exit(0); return; }
    if (!bytes || bytes.get_size() === 0) { GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { System.exit(0); return false; }); return; }
    inbuf = Buffer.concat([inbuf, wrap(bytes.get_data())]);
    const { messages, rest } = decodeMessages(inbuf);
    inbuf = rest;
    for (const m of messages) if (m.type === 'tabs') latestTabs = m.tabs;
    pumpStdin();
  });
}

// --- write a framed message to the browser (stdout) ---
const stdoutStream = new Gio.UnixOutputStream({ fd: 1, close_fd: false });
function toBrowser(obj) {
  const f = encodeMessage(obj);
  stdoutStream.write_all(f, null);
}

// --- serve the unix socket for the Shell extension ---
try { Gio.File.new_for_path(sockPath).delete(null); } catch (_e) {}
const service = new Gio.SocketService();
const addr = new Gio.UnixSocketAddress({ path: sockPath });
service.add_address(addr, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
service.connect('incoming', (_s, conn) => {
  const din = new Gio.DataInputStream({ base_stream: conn.get_input_stream() });
  const dout = conn.get_output_stream();
  din.read_line_async(GLib.PRIORITY_DEFAULT, null, (d, res) => {
    let line; try { [line] = d.read_line_finish_utf8(res); } catch (_e) { conn.close(null); return; }
    let req = {}; try { req = JSON.parse(line || '{}'); } catch (_e) {}
    if (req.cmd === 'list') {
      dout.write_all(JSON.stringify({ browser, tabs: latestTabs }) + '\n', null);
    } else if (req.cmd === 'activate') {
      toBrowser({ type: 'activate', tabId: req.tabId, windowId: req.windowId });
      dout.write_all('{"ok":true}\n', null);
    }
    conn.close(null);
  });
  return false;
});
service.start();

pumpStdin();
new GLib.MainLoop(null, false).run();
