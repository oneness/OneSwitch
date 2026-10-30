#!/home/kasim/.nix-profile/bin/node
// Native messaging host for OneSwitch — Node.js version.
// Bridges the browser's tab list to a Unix socket read by the GNOME extension.
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// framing.js uses Buffer natively under Node.
const { encodeMessage, decodeMessages } = await import('./framing.js');
const { normalizeFavicon } = await import('./favicon-format.js');

const arg = (process.argv[2] || '') + (process.argv[3] || '') + (process.argv[4] || '');
const browser = arg.includes('firefox') || arg.includes('@birkey') ? 'firefox' : 'chrome';
const sockPath = `${process.env.XDG_RUNTIME_DIR}/oneswitch-browser-${browser}.sock`;

const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
  'oneswitch', 'favicons');

let latestTabs = [];

// Favicons are pulled, not pushed: the webext no longer ships favIconUrl with
// every snapshot (image data was 99% of it). We ask for the sites we do not
// have yet, once each, and write the data: URLs to disk for the Shell extension.
const askedFavicons = new Set();

function hostOf(url) {
  const m = /^https?:\/\/([^/:]+)/.exec(url || '');
  return m ? m[1] : null;
}

function requestMissingFavicons() {
  const want = [];
  for (const t of latestTabs) {
    const host = hostOf(t.url);
    if (!host || askedFavicons.has(host)) continue;
    askedFavicons.add(host);
    let cached = false;
    try { cached = fs.existsSync(path.join(cacheDir, host)); } catch (_) {}
    if (!cached) want.push(host);
  }
  if (want.length) toBrowser({ type: 'want-favicons', hosts: want });
}

function writeFavicons(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  for (const it of items) {
    const host = it && it.host;
    if (!host || !/^[A-Za-z0-9._-]+$/.test(host)) continue;   // becomes a filename
    const m = /^data:image\/[^;]+;base64,(.+)$/.exec((it && it.dataUrl) || '');
    if (!m) continue;
    // .ico payloads are rewritten as their PNG frame: the Shell's image loader
    // cannot read PNG-compressed ICO frames (see favicon-format.js).
    const bytes = normalizeFavicon(Buffer.from(m[1], 'base64'));
    if (!bytes) continue;
    try { fs.writeFileSync(path.join(cacheDir, host), bytes); } catch (_) {}
  }
}

// Icons cached before the ICO→PNG rewrite would never be re-fetched (webext is
// only asked for hosts we lack), so fix them in place on startup.
function migrateCachedFavicons() {
  let names = [];
  try { names = fs.readdirSync(cacheDir); } catch (_) { return; }
  for (const name of names) {
    const file = path.join(cacheDir, name);
    try {
      const bytes = fs.readFileSync(file);
      const png = normalizeFavicon(bytes);
      if (!png || png === bytes) continue;   // not an ICO, or nothing to rewrite
      fs.writeFileSync(file, png);
    } catch (_) {}
  }
}

// --- Unix socket server for the GNOME Shell extension ---
migrateCachedFavicons();
try { fs.unlinkSync(sockPath); } catch (_) {}
const server = net.createServer(conn => {
  let data = '';
  conn.setEncoding('utf8');
  conn.on('data', chunk => {
    data += chunk;
    const nl = data.indexOf('\n');
    if (nl === -1) return;
    let req = {};
    try { req = JSON.parse(data.slice(0, nl)); } catch (_) {}
    if (req.cmd === 'list') {
      conn.end(JSON.stringify({ browser, tabs: latestTabs }) + '\n');
    } else if (req.cmd === 'activate') {
      toBrowser({ type: 'activate', tabId: req.tabId, windowId: req.windowId,
                  sameBrowser: !!req.sameBrowser });
      conn.end('{"ok":true}\n');
    } else {
      conn.end('{"ok":false}\n');
    }
  });
});
server.listen(sockPath);

// --- Read framed messages from the browser (stdin) ---
let inbuf = Buffer.alloc(0);
process.stdin.on('data', chunk => {
  inbuf = Buffer.concat([inbuf, chunk]);
  const { messages, rest } = decodeMessages(inbuf);
  inbuf = rest;
  for (const m of messages) {
    if (m.type === 'tabs') {
      latestTabs = m.tabs;
      requestMissingFavicons();
    } else if (m.type === 'favicons') {
      writeFavicons(m.items);
    }
  }
});
process.stdin.on('end', () => {
  try { fs.unlinkSync(sockPath); } catch (_) {}
  process.exit(0);
});

// --- Write framed message to the browser (stdout) ---
function toBrowser(obj) {
  process.stdout.write(encodeMessage(obj));
}
