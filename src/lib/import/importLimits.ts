import { unzipSync, Inflate } from 'fflate';
import en from '../i18n/locales/en';

// Bounds reflect a large office document while keeping one browser tab responsive.
export const IMPORT_LIMITS = {
  compressedBytes: 128 * 1024 * 1024,
  zipEntries: 10_000,
  zipEntryBytes: 64 * 1024 * 1024,
  zipTotalBytes: 256 * 1024 * 1024,
  zipCompressionRatio: 1_000,
  xmlPartBytes: 32 * 1024 * 1024,
  xmlNodes: 1_000_000,
  xmlDepth: 512,
  mediaPartBytes: 64 * 1024 * 1024,
  textRunChars: 100_000,
  tableSpan: 1_000,
  chartPoints: 100_000,
  convertedImagePixels: 40_000_000,
  convertedImageBytes: 160 * 1024 * 1024,
} as const;

export class ImportLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'ImportLimitError'; }
}

const tooLarge = () => new ImportLimitError('The document archive exceeds supported limits.');

/** An archive unpacked within the limits. They are checked in fflate's own filter, on the
 *  sizes it allocates by, so a forged directory or a ZIP64 record cannot slip past them.
 *  `keep` picks entries; all of them still count. */
export function unzipWithinLimits(bytes: Uint8Array, keep?: (name: string) => boolean): Record<string, Uint8Array> {
  if (bytes.length > IMPORT_LIMITS.compressedBytes) throw new ImportLimitError('The document is too large to import safely.');
  let count = 0, total = 0;
  return unzipSync(bytes, {
    filter: ({ name, size, originalSize, compression }) => {
      if (++count > IMPORT_LIMITS.zipEntries) throw tooLarge();
      if (keep && !keep(name)) return false;
      // A stored entry is copied at its compressed size, whatever it declares.
      const out = compression ? originalSize : size;
      const partLimit = /\.xml$/i.test(name) ? IMPORT_LIMITS.xmlPartBytes
        : /(^|\/)(Pictures|media)\//i.test(name) ? IMPORT_LIMITS.mediaPartBytes : IMPORT_LIMITS.zipEntryBytes;
      if (out > partLimit || out > IMPORT_LIMITS.zipEntryBytes
        || (compression && size && out / size > IMPORT_LIMITS.zipCompressionRatio)) throw tooLarge();
      if ((total += out) > IMPORT_LIMITS.zipTotalBytes) throw tooLarge();
      return true;
    },
  });
}

/** A raw deflate stream inflated to at most `max` bytes. */
export function inflateWithin(data: Uint8Array, max: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const inflate = new Inflate((chunk) => {
    if ((length += chunk.length) > max) throw tooLarge();
    chunks.push(chunk);
  });
  inflate.push(data, true);
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

/** A complete decimal integer within an inclusive safe range, otherwise null. */
export function boundedInt(value: string | null | undefined, min: number, max: number): number | null {
  if (!value || !/^-?\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

const TAG_END = /"[^"]*"|'[^']*'|>/g;

export function parseImportXml(xml: string, format: 'odt' | 'docx'): Document {
  // An entity declaration is what makes XML unsafe; an external subset declares nothing
  // a DOM parser resolves, and an embedded formula object from an older office suite
  // names a MathML DTD, so that doctype is dropped instead of refusing the file.
  if (/<!ENTITY\b/i.test(xml) || /<!DOCTYPE[^[>]*\[/i.test(xml)) throw new Error(en.importError[`${format}Unsafe` as const]);
  // Each body stops at its first terminator, so a hostile prolog cannot backtrack exponentially.
  xml = xml.replace(/^((?:\s|<\?(?:[^?]|\?(?!>))*\?>|<!--(?:[^-]|-(?!->))*-->)*)<!DOCTYPE[^[>]*>/i, '$1');
  let depth = 0;
  let nodes = 0;
  for (let at = xml.indexOf('<'); at >= 0; at = xml.indexOf('<', at + 1)) {
    const next = xml[at + 1];
    if (next === '!') {
      const end = xml.startsWith('<!--', at) ? xml.indexOf('-->', at + 4)
        : xml.startsWith('<![CDATA[', at) ? xml.indexOf(']]>', at + 9) : at;
      if (end < 0) throw new Error(en.importError[`${format}Malformed` as const]);
      at = end + 2;
      continue;
    }
    if (next === '?') continue;
    if (next === '/') { depth--; continue; }
    // A quoted attribute value may hold '>' and '/>' of its own.
    TAG_END.lastIndex = at + 1;
    let end: RegExpExecArray | null;
    while ((end = TAG_END.exec(xml)) && end[0] !== '>');
    const close = end ? end.index : -1;
    if (close < 0 || ++nodes > IMPORT_LIMITS.xmlNodes || ++depth > IMPORT_LIMITS.xmlDepth) {
      throw new Error(en.importError[`${format}TooComplex` as const]);
    }
    if (xml[close - 1] === '/') depth--;
    at = close;
  }
  if (depth !== 0) throw new Error(en.importError[`${format}Malformed` as const]);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(en.importError[`${format}Malformed` as const]);
  return doc;
}
