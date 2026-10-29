import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isIco, pngFromIco, normalizeFavicon } from '../native-host/favicon-format.js';

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
  assert.equal(normalizeFavicon(buildIco([BIH])), null);
  assert.equal(normalizeFavicon(new Uint8Array(0)), null);
  assert.equal(normalizeFavicon(null), null);
});
