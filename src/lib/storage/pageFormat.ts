import { PX_PER_CM } from './pageMargins';
import type { Orientation } from './pageOrientation';

export type PageFormat =
  | 'A3' | 'A4' | 'A5' | 'A6'
  | 'isoB4' | 'isoB5' | 'isoB6'
  | 'jisB4' | 'jisB5'
  | 'letter' | 'legal' | 'tabloid' | 'executive' | 'folio' | 'statement';

const KEY = 'edentext-page-format';

// Portrait page dimensions in cm per format (width < height). Landscape swaps them.
// Grouped A / ISO-B / JIS-B / US, matching the Word/LibreOffice paper menus.
export const PAGE_FORMAT_CM: Record<PageFormat, { w: number; h: number }> = {
  A3:        { w: 29.7,   h: 42 },
  A4:        { w: 21,     h: 29.7 },
  A5:        { w: 14.8,   h: 21 },
  A6:        { w: 10.5,   h: 14.8 },
  isoB4:     { w: 25,     h: 35.3 },
  isoB5:     { w: 17.6,   h: 25 },
  isoB6:     { w: 12.5,   h: 17.6 },
  jisB4:     { w: 25.7,   h: 36.4 },
  jisB5:     { w: 18.2,   h: 25.7 },
  letter:    { w: 21.59,  h: 27.94 },
  legal:     { w: 21.59,  h: 35.56 },
  tabloid:   { w: 27.94,  h: 43.18 },
  executive: { w: 18.415, h: 26.67 },
  folio:     { w: 21.59,  h: 33.02 },
  statement: { w: 13.97,  h: 21.59 },
};

const FORMATS = Object.keys(PAGE_FORMAT_CM) as PageFormat[];

export function loadPageFormat(): PageFormat {
  const raw = localStorage.getItem(KEY);
  return (raw && (FORMATS as string[]).includes(raw)) ? (raw as PageFormat) : 'A4';
}

export function savePageFormat(f: PageFormat): void {
  localStorage.setItem(KEY, f);
}

// Page box (cm) for a format + orientation; landscape swaps width/height.
export function pageDimsCm(format: PageFormat, orientation: Orientation): { w: number; h: number } {
  const { w, h } = PAGE_FORMAT_CM[format];
  return orientation === 'landscape' ? { w: h, h: w } : { w, h };
}

// Sets --user-page-{width,height} (px) on the document root, where they inherit
// down to .paper / .tiptap (see editor.css) and are read per layout pass by
// pageBreaks.ts. Supersedes applyOrientationVars, which only knew A4.
export function applyPageSizeVars(format: PageFormat, orientation: Orientation): void {
  const { w, h } = pageDimsCm(format, orientation);
  const root = document.documentElement.style;
  root.setProperty('--user-page-width', `${w * PX_PER_CM}px`);
  root.setProperty('--user-page-height', `${h * PX_PER_CM}px`);
}

// Match a page's dimensions (cm, any orientation) to a known format, within a
// tolerance for producer rounding; null when nothing fits. Used by the importers.
export function formatFromCm(wCm: number, hCm: number, tolCm = 0.2): PageFormat | null {
  const w = Math.min(wCm, hCm);
  const h = Math.max(wCm, hCm);
  for (const f of FORMATS) {
    const dims = PAGE_FORMAT_CM[f];
    if (Math.abs(dims.w - w) <= tolCm && Math.abs(dims.h - h) <= tolCm) return f;
  }
  return null;
}
