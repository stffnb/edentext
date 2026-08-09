// Image formats, shared by both importers. An <img> renders only a fixed set, so the
// rest (WMF/EMF/SVM/TIFF/…) is decoded client-side (convertUnsupportedImages) or skipped
// with a warning. Resolved by extension, then by magic number so mislabels still work.
import { unzipSync } from 'fflate';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  apng: 'image/apng',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  pjp: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

export function imageExtOf(path: string): string {
  const bare = path.split(/[?#]/)[0];
  return bare.split('.').pop()?.toLowerCase() ?? '';
}

// A renderable mime from the magic number, or null (unknown/unrenderable). Only the
// formats browsers display are recognised — a metafile/TIFF signature returns null.
function sniffImageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  // SVG is XML text: look for an <svg root within the leading bytes.
  const head = String.fromCharCode(...b.subarray(0, Math.min(b.length, 256))).toLowerCase();
  if (head.includes('<svg')) return 'image/svg+xml';
  return null;
}

// The mime to render `bytes` (from `path`) as, or null when the browser can't display
// the format. Extension wins when renderable; otherwise the magic number is consulted.
export function displayableImageMime(bytes: Uint8Array, path: string): string | null {
  const byExt = MIME_BY_EXT[imageExtOf(path)];
  if (byExt) return byExt;
  return sniffImageMime(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000; // chunk so String.fromCharCode doesn't blow the call stack
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// A base64 data-URI for a displayable image, or null when the format can't be shown.
export function imageDataUrl(bytes: Uint8Array, path: string): string | null {
  const mime = displayableImageMime(bytes, path);
  if (!mime) return null;
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

// ---- client-side decoding of formats the browser can't render ----------------

// A map from archive path to a decoded PNG data-URI, produced by the async pre-pass and
// consulted by the synchronous importers before they read the raw bytes.
export type ConvertedImages = Map<string, string>;

// TIFF: 'II*\0' (little-endian) or 'MM\0*' (big-endian), or a .tif/.tiff extension.
function isTiff(bytes: Uint8Array, path: string): boolean {
  const ext = imageExtOf(path);
  if (ext === 'tif' || ext === 'tiff') return true;
  return bytes.length >= 4
    && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a));
}

// EMF: the record header's ' EMF' signature at byte 40, or a .emf extension.
function isEmf(bytes: Uint8Array, path: string): boolean {
  if (imageExtOf(path) === 'emf') return true;
  return bytes.length >= 44 && new DataView(bytes.buffer, bytes.byteOffset, 44).getUint32(40, true) === 0x464d4520;
}

// True when the browser can't display the bytes directly but a lazy decoder can turn
// them into something it can (see convertImageToDataUrl).
export function isConvertibleImage(bytes: Uint8Array, path: string): boolean {
  return displayableImageMime(bytes, path) === null && (isTiff(bytes, path) || isEmf(bytes, path));
}

// RGBA pixels → a PNG data-URI via an offscreen canvas (browser only, which is where
// import runs). null when there's no 2D context or the dimensions are empty.
function rgbaToPngDataUrl(rgba: Uint8Array, w: number, h: number): string | null {
  if (!w || !h) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cctx = canvas.getContext('2d');
  if (!cctx) return null;
  cctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return canvas.toDataURL('image/png');
}

// Decode a convertible format to a PNG data-URI, lazy-loading the decoder so it never
// enters the baseline bundle. null when it isn't convertible or decoding fails.
export async function convertImageToDataUrl(bytes: Uint8Array, path: string): Promise<string | null> {
  try {
    if (isTiff(bytes, path)) {
      const UTIF = await import('utif2');
      // A fresh ArrayBuffer (not the possibly-shared source buffer) for UTIF's typing.
      const buf = new Uint8Array(bytes).buffer;
      const ifds = UTIF.decode(buf);
      if (!ifds.length) return null;
      UTIF.decodeImage(buf, ifds[0]);
      return rgbaToPngDataUrl(UTIF.toRGBA8(ifds[0]), ifds[0].width, ifds[0].height);
    }
    if (isEmf(bytes, path)) {
      const svg = (await import('./emf')).emfToSvg(bytes);
      return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
    }
  } catch { /* corrupt/unsupported → the importer skips it with a warning */ }
  return null;
}

// Only archive entries in an image folder (ODF Pictures/, DOCX word/media/) are probed.
function looksLikeMedia(path: string): boolean {
  return /(^|\/)(Pictures|media)\//i.test(path);
}

// Pre-decode every convertible image in an .odt/.docx archive to a PNG data-URI, so the
// synchronous importer can resolve them. Lazy: the decoder is only imported when such an
// image is actually present, so ordinary documents load with zero extra cost.
export async function convertUnsupportedImages(bytes: Uint8Array): Promise<ConvertedImages> {
  const out: ConvertedImages = new Map();
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { return out; }
  for (const [path, data] of Object.entries(files)) {
    if (!looksLikeMedia(path) || !isConvertibleImage(data, path)) continue;
    const url = await convertImageToDataUrl(data, path);
    if (url) out.set(path, url);
  }
  return out;
}

// A frame whose picture cannot be shown — a chart, a metafile — as a labelled box at
// the drawing's own size, so the document keeps the space it reserves for it.
export function placeholderImage(label: string, widthPx: number, heightPx: number): string {
  const w = Math.max(8, Math.round(widthPx));
  const h = Math.max(8, Math.round(heightPx));
  const text = label.replace(/[<>&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="#f4f4f5" stroke="#c2c2c8" stroke-dasharray="6 4"/>`
    + `<text x="${w / 2}" y="${h / 2}" fill="#8a8a90" font-family="sans-serif" font-size="13"`
    + ` text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
