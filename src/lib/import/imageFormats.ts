// Image-format handling shared by the ODF and DOCX importers. An <img> can only
// render a fixed set of formats; anything else (WMF/EMF/SVM/TIFF/…) has to be skipped
// with a warning rather than emitted as a broken image. The format is resolved from
// the file extension first, then confirmed/recovered from the bytes' magic number so a
// mislabelled or extensionless entry still works.

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
