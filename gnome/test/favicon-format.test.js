import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIco, pngFromIco, normalizeFavicon, imageFormat } from '../native-host/favicon-format.js';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIH = Uint8Array.from([0x28, 0x00, 0x00, 0x00]);

function pngFrame(size) {
  const out = new Uint8Array(PNG.length + size);
  out.set(PNG);
  out.fill(0xab, PNG.length);
  return out;
}

// ICO = 6-byte directory header + one 16-byte entry per frame + the frames.
function buildIco(frames) {
  frames = frames.map(f => (f.length ? { bytes: f, size: 32 } : f));
  const header = new Uint8Array(6 + 16 * frames.length);
  header[2] = 1;                                   // type: icon
  header[4] = frames.length & 0xff;
  header[5] = frames.length >> 8;
  let offset = header.length;
  frames.forEach(({ bytes, size }, i) => {
    const e = 6 + i * 16;
    header[e] = size === 256 ? 0 : size;           // 0 means 256
    header[e + 1] = size === 256 ? 0 : size;
    new DataView(header.buffer).setUint32(e + 8, bytes.length, true);
    new DataView(header.buffer).setUint32(e + 12, offset, true);
    offset += bytes.length;
  });
  const out = new Uint8Array(offset);
  out.set(header);
  let at = header.length;
  for (const { bytes } of frames) { out.set(bytes, at); at += bytes.length; }
  return out;
}

test('isIco spots the ICO directory header only', () => {
  assert.equal(isIco(buildIco([pngFrame(16)])), true);
  assert.equal(isIco(PNG), false);
  assert.equal(isIco(Uint8Array.from([0x00, 0x00, 0x01])), false);
  assert.equal(isIco(null), false);
});

test('pngFromIco returns the embedded PNG frame verbatim', () => {
  const frame = pngFrame(64);
  const got = pngFromIco(buildIco([frame]));
  assert.deepEqual(Uint8Array.from(got), frame);
});

test('pngFromIco picks the largest frame when there are several', () => {
  const small = pngFrame(8);
  const big = pngFrame(400);
  const got = pngFromIco(buildIco([small, big]));
  assert.deepEqual(Uint8Array.from(got), big);
});

test('pngFromIco ranks by declared area before payload size', () => {
  const bigDimsSmallBytes = pngFrame(16);
  const smallDimsBigBytes = pngFrame(400);
  const got = pngFromIco(buildIco([
    { bytes: bigDimsSmallBytes, size: 256 },
    { bytes: smallDimsBigBytes, size: 48 },
  ]));
  assert.deepEqual(Uint8Array.from(got), bigDimsSmallBytes);
});

test('pngFromIco ignores BMP frames and returns null when nothing is PNG', () => {
  assert.equal(pngFromIco(buildIco([BIH])), null);
  assert.equal(pngFromIco(buildIco([BIH, BIH])), null);
});

test('pngFromIco still finds a PNG frame next to BMP ones', () => {
  const frame = pngFrame(32);
  assert.deepEqual(Uint8Array.from(pngFromIco(buildIco([BIH, frame]))), frame);
});

test('pngFromIco survives a truncated directory', () => {
  const ico = buildIco([pngFrame(16)]);
  assert.doesNotThrow(() => pngFromIco(ico.subarray(0, 8)));
});

test('normalizeFavicon passes non-ICO payloads straight through', () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.deepEqual(Uint8Array.from(normalizeFavicon(svg)), svg);
  assert.deepEqual(Uint8Array.from(normalizeFavicon(PNG)), PNG);
});

test('normalizeFavicon converts an ICO to its PNG frame', () => {
  const frame = pngFrame(128);
  assert.deepEqual(Uint8Array.from(normalizeFavicon(buildIco([frame]))), frame);
});

test('normalizeFavicon drops payloads that can never be painted', () => {
  // A frame truncated before its DIB header is readable by nothing, and a
  // compressed frame that is not a PNG gives pngFromIco nothing to pull out.
  assert.equal(normalizeFavicon(buildIco([BIH])), null);
  assert.equal(normalizeFavicon(buildIco([[0x01, 0x02, 0x03, 0x04, ...new Uint8Array(36).fill(1)]])), null);
  assert.equal(normalizeFavicon(new Uint8Array(0)), null);
  assert.equal(normalizeFavicon(null), null);
});

// A 40-byte BITMAPINFOHEADER: biCompression sits at offset 16, which is the byte
// gdk-pixbuf's ICO loader tests before it will read a frame.
function dibFrame(compression = 0, size = 40) {
  const out = new Uint8Array(size).fill(0x7f);
  new DataView(out.buffer).setUint32(0, 40, true);
  new DataView(out.buffer).setUint32(16, compression, true);
  return out;
}

test('normalizeFavicon keeps an .ico whose frames the loader reads itself', () => {
  // Old-style .ico: DIB frames only. gdk-pixbuf decodes these, so the file is
  // left whole rather than dropped — dropping it is what left those rows blank.
  const ico = buildIco([dibFrame()]);
  assert.deepEqual(Uint8Array.from(normalizeFavicon(ico)), ico);
});

test('normalizeFavicon prefers the bigger frame, PNG or direct', () => {
  const dib = { bytes: dibFrame(), size: 16 };
  const png = { bytes: pngFrame(200), size: 32 };
  // A bigger PNG frame wins: the loader would otherwise read the small DIB.
  const got = normalizeFavicon(buildIco([dib, png]));
  assert.deepEqual(Uint8Array.from(got), png.bytes);
  // Equal declared area: the frame the loader reads unaided is the safer pick.
  const ico = buildIco([{ bytes: dibFrame(), size: 32 }, png]);
  assert.deepEqual(Uint8Array.from(normalizeFavicon(ico)), ico);
});

// --- what the Shell's loader can paint -------------------------------------
// The cache file has no extension and St hands it to a bare GdkPixbufLoader, so
// the format is decided by content sniffing alone. These cases come from icons
// that actually broke or nearly broke: GitHub's SVG, ChatGPT's SVG behind a
// comment, and an HTML error page served for a missing icon.
const enc = s => new TextEncoder().encode(s);

test('imageFormat recognises the formats a favicon is served as', () => {
  assert.equal(imageFormat(PNG), 'png');
  assert.equal(imageFormat(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
  assert.equal(imageFormat(enc('GIF89a....')), 'gif');
  assert.equal(imageFormat(enc('BM6\x00\x00\x00')), 'bmp');
  assert.equal(imageFormat(enc('RIFF\x00\x01\x00\x00WEBPVP8 ')), 'webp');
  assert.equal(imageFormat(buildIco([pngFrame(16)])), 'ico');
});

test('imageFormat finds an SVG however the file opens', () => {
  assert.equal(imageFormat(enc('<svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  // ChatGPT's icon: a comment above the element.
  assert.equal(imageFormat(enc('<!-- generated -->\n<svg width="180">')), 'svg');
  assert.equal(imageFormat(enc('<?xml version="1.0"?><svg viewBox="0 0 8 8"/>')), 'svg');
  assert.equal(imageFormat(enc('\n  <svg/>')), 'svg');
  // A UTF-8 BOM must not hide the element.
  assert.equal(imageFormat(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc('<svg>')])), 'svg');
});

test('imageFormat rejects what no loader here can paint', () => {
  assert.equal(imageFormat(enc('<!DOCTYPE html><html><body>404</body></html>')), null);
  assert.equal(imageFormat(enc('<html><head><title>403</title></head></html>')), null);
  // An error page that embeds an SVG is still an error page.
  assert.equal(imageFormat(enc('<!doctype html><body><svg></svg></body>')), null);
  assert.equal(imageFormat(enc('RIFF\x00\x01\x00\x00WAVEfmt ')), null);   // a sound, not an image
  assert.equal(imageFormat(Uint8Array.from([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70])), null);  // AVIF
  assert.equal(imageFormat(new Uint8Array(0)), null);
  assert.equal(imageFormat(null), null);
});

test('normalizeFavicon drops a payload that would paint an empty row', () => {
  assert.equal(normalizeFavicon(enc('<!DOCTYPE html><html><body>Not found</body></html>')), null);
});

test('normalizeFavicon keeps every paintable format byte for byte', () => {
  const webp = enc('RIFF\x00\x01\x00\x00WEBPVP8 ');
  assert.deepEqual(Uint8Array.from(normalizeFavicon(webp)), webp);
  const svg = enc('<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.deepEqual(Uint8Array.from(normalizeFavicon(svg)), svg);
});
