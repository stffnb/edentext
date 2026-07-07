import { PX_PER_CM } from './pageMargins';
import type { Orientation } from './pageOrientation';

export type PageFormat = 'A4' | 'letter' | 'legal' | 'A3' | 'A5';

const KEY = 'odf-editor-page-format';

// Portrait page dimensions in cm per format (width < height). Landscape swaps them.
// Matches odf-kit's pageFormat presets so ODT/DOCX round-trip is lossless.
export const PAGE_FORMAT_CM: Record<PageFormat, { w: number; h: number }> = {
  A4:     { w: 21,    h: 29.7 },
  letter: { w: 21.59, h: 27.94 },
  legal:  { w: 21.59, h: 35.56 },
  A3:     { w: 29.7,  h: 42 },
  A5:     { w: 14.8,  h: 21 },
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
