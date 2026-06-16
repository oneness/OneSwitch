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

const arg = (process.argv[2] || '') + (process.argv[3] || '') + (process.argv[4] || '');
const browser = arg.includes('firefox') || arg.includes('@birkey') ? 'firefox' : 'chrome';
const sockPath = `${process.env.XDG_RUNTIME_DIR}/oneswitch-browser-${browser}.sock`;

const cacheDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
  'oneswitch', 'favicons');

let latestTabs = [];

// Save data-URL favicons to disk so the GNOME extension can display them.
function cacheFavicons(tabs) {
  try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (_) {}
  for (const t of tabs) {
    if (!t.url || !t.favIconUrl) continue;
    const host = /^https?:\/\/([^/:]+)/.exec(t.url)?.[1];
    if (!host) continue;
    const m = /^data:image\/[^;]+;base64,(.+)$/.exec(t.favIconUrl);
    if (!m) continue;
    try { fs.writeFileSync(path.join(cacheDir, host), Buffer.from(m[1], 'base64')); } catch (_) {}
  }
}

// --- Unix socket server for the GNOME Shell extension ---
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
      toBrowser({ type: 'activate', tabId: req.tabId, windowId: req.windowId });
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
      cacheFavicons(m.tabs);
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
