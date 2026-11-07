// Favicon payload format normalisation.
//
// The webext hands us whatever the site serves as its favicon: SVG, PNG, GIF,
// WEBP, BMP or an .ico. The Shell paints these with gdk-pixbuf, which sniffs the
// content so an extensionless cache file is fine — except for .ico, where the
// loader reads a frame's DIB directly and fails on every frame that is
// compressed ("Compressed icons are not supported"). Those tabs then drew no
// icon at all.
//
// An ICO is just a directory plus the frames stored verbatim, so telling which
// frames the loader will accept is byte surgery, no image decoding. Do it here at
// ingest so the cache only ever holds formats the Shell can paint.
//
// "Can paint" is decided from the bytes (`imageFormat`), never from a mime type
// or a filename: the Shell feeds a cache file to a bare GdkPixbufLoader, which
// is exactly a content sniff, and anything it does not recognise paints nothing
// — an invisible row, not a globe. An icon request answered with an HTML error
// page or a format no loader here carries is dropped here instead, so the
// switcher falls back to its generic icon as it does for a site with no icon.
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

// The frames an .ico declares, ranked by the area in the directory (a 0 byte
// means 256), then by payload size, so a noisy small frame can never win over a
// bigger one. `compression` is the frame's BITMAPINFOHEADER biCompression, which
// is how gdk-pixbuf decides what it can read: zero is BI_RGB, a frame it decodes
// itself, and anything else (in practice a PNG, whose IHDR width lands in those
// bytes and is never zero) it skips.
function icoFrames(buf) {
  if (!isIco(buf) || buf.length < 6) return [];
  const count = buf[4] | (buf[5] << 8);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    if (entry + 16 > buf.length) break;
    const size = u32(buf, entry + 8);
    const offset = u32(buf, entry + 12);
    if (size === 0 || offset + size > buf.length) continue;
    frames.push({
      offset,
      size,
      area: (buf[entry] || 256) * (buf[entry + 1] || 256),
      // Truncated before its header: neither readable nor a PNG frame.
      compression: offset + 20 <= buf.length ? u32(buf, offset + 16) : -1,
      png: startsWith(buf.subarray(offset, offset + PNG_SIGNATURE.length), PNG_SIGNATURE),
    });
  }
  return frames;
}

function biggest(frames) {
  let best = null;
  for (const f of frames) {
    if (!best || f.area > best.area || (f.area === best.area && f.size > best.size)) best = f;
  }
  return best;
}

// Largest PNG-compressed frame of an .ico, or null when every frame is a
// DIB the Shell can read as-is (see icoFrames).
export function pngFromIco(buf) {
  const frame = biggest(icoFrames(buf).filter(f => f.png));
  return frame ? buf.subarray(frame.offset, frame.offset + frame.size) : null;
}

// Which format a payload is, using the same magic the shell's loaders sniff:
// PNG, JPEG and SVG (via librsvg) are what sites actually serve; GIF, WEBP and
// BMP are rarer but a loader here paints them. SVG has no fixed signature — an
// SVG can open with an XML declaration, a comment or a doctype (ChatGPT's icon is
// a bare <!-- ... --> above its <svg>) — so it is searched for rather than
// prefix-matched, and an HTML page that merely embeds one is excluded by its
// own signature first. Anything that is none of these returns null.
export function imageFormat(buf) {
  if (!buf || buf.length === 0) return null;
  if (startsWith(buf, PNG_SIGNATURE)) return 'png';
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';          // "GIF8"
  if (startsWith(buf, [0x42, 0x4d])) return 'bmp';                      // "BM"
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) &&                       // "RIFF"
      startsWith(buf.subarray(8, 12), [0x57, 0x45, 0x42, 0x50])) return 'webp';
  if (isIco(buf)) return 'ico';

  // Textual formats: look past a UTF-8 BOM and any leading whitespace.
  const at = startsWith(buf, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  const head = String.fromCharCode(...buf.subarray(at, at + 4096)).toLowerCase();
  if (/^\s*<!doctype\s+html/.test(head) || /^\s*<html[\s>]/.test(head)) return null;
  return /<svg[\s/>]/.test(head) ? 'svg' : null;
}

// Cache-ready bytes for one favicon payload, or null when the Shell could not
// paint it, so the caller can skip writing a file it would have to avoid later.
// Everything that is not an .ico is passed through if `imageFormat` knows it.
//
// An .ico is left whole when the loader can read one of its frames itself, since
// that is the frame it will pick; a file whose frames are all PNGs has those
// pulled out instead, and is only dropped when even that yields nothing.
export function normalizeFavicon(buf) {
  if (!buf || buf.length === 0) return null;
  if (!isIco(buf)) return imageFormat(buf) ? buf : null;
  const frames = icoFrames(buf);
  const direct = biggest(frames.filter(f => f.compression === 0));
  const png = biggest(frames.filter(f => f.png));
  // A PNG frame only wins when it declares a bigger image: same size, the frame
  // the loader reads unaided is the safer choice.
  if (direct && (!png || direct.area >= png.area)) return buf;
  return png ? buf.subarray(png.offset, png.offset + png.size) : null;
}
