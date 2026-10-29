// Favicon payload format normalisation.
//
// The webext hands us whatever the site serves as its favicon: SVG, PNG, GIF or
// an .ico. The Shell paints these with gdk-pixbuf, which sniffs the content so an
// extensionless cache file is fine — except for .ico: gdk-pixbuf's ICO loader
// rejects the PNG-compressed frames every modern .ico uses, failing with
// "Compressed icons are not supported". Those tabs then drew no icon at all.
//
// An ICO is just a directory plus the frames stored verbatim, so pulling the
// biggest PNG frame out is byte surgery, no image decoding. Do it here at ingest
// so the cache only ever holds formats the Shell can paint.
//
// Pure, so both hosts and node --test can share it.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ICO_SIGNATURE = [0x00, 0x00, 0x01, 0x00];

function startsWith(buf, sig) {
  if (!buf || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

export function isIco(buf) {
  return startsWith(buf, ICO_SIGNATURE);
}

function u32(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

// Largest PNG-compressed frame of an .ico, or null if the file holds only
// BMP/DIB frames (which this Shell cannot render either way). Frames are ranked
// by the area declared in the directory (a 0 byte means 256), then by payload
// size, so a noisy small frame can never win over a bigger one.
export function pngFromIco(buf) {
  if (!isIco(buf) || buf.length < 6) return null;
  const count = buf[4] | (buf[5] << 8);
  let best = null;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > buf.length) break;
    const size = u32(buf, entry + 8);
    const offset = u32(buf, entry + 12);
    if (size < PNG_SIGNATURE.length || offset + size > buf.length) continue;
    if (!startsWith(buf.subarray(offset, offset + PNG_SIGNATURE.length), PNG_SIGNATURE)) continue;
    const area = (buf[entry] || 256) * (buf[entry + 1] || 256);
    if (!best || area > best.area || (area === best.area && size > best.size))
      best = { offset, size, area };
  }
  return best ? buf.subarray(best.offset, best.offset + best.size) : null;
}

// Cache-ready bytes for one favicon payload: ICO payloads become their PNG frame,
// everything else is passed through. Returns null when the payload can never be
// painted, so the caller can skip writing a file it would have to avoid later.
export function normalizeFavicon(buf) {
  if (!buf || buf.length === 0) return null;
  if (!isIco(buf)) return buf;
  return pngFromIco(buf);
}
