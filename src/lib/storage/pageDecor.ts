// The page's own decoration: LibreOffice's Format ▸ Page Style ▸ Area and Borders, and
// its Format ▸ Watermark. All three are page-level and all three ride the page layout
// (the watermark rides the master page's header, where both word processors keep it),
// so they share one key. Every field is absent by default — a fresh document decorates
// nothing, and neither importer stamps a decoration on a file that has none.

const KEY = 'edentext-page-decor';

// A page border is one rule around the whole page, as both word processors draw it: one
// width and colour for all four sides, offset from the text by `paddingCm`.
export type PageBorder = { widthPt: number; color: string; paddingCm: number };

// LibreOffice's watermark dialog, field for field.
export type Watermark = {
  text: string;
  font: string;
  color: string;
  /** Degrees counter-clockwise from the baseline, as LibreOffice's dialog counts. */
  angle: number;
  /** Percent; 0 is opaque. */
  transparency: number;
};

export type PageDecor = {
  background: string | null;
  border: PageBorder | null;
  watermark: Watermark | null;
};

export const EMPTY_PAGE_DECOR: PageDecor = { background: null, border: null, watermark: null };

// LibreOffice's own defaults for a freshly switched-on border and watermark.
export const DEFAULT_PAGE_BORDER: PageBorder = { widthPt: 0.5, color: '#000000', paddingCm: 0.05 };
export const DEFAULT_WATERMARK: Watermark = {
  text: '', font: 'Liberation Sans', color: '#c0c0c0', angle: 45, transparency: 50,
};

// Clamped and rounded to 2 dp: a border read back out of a file arrives through a
// unit conversion, and 0.2cm must compare equal to the 0.2cm that was written.
const clamp = (v: number, lo: number, hi: number) =>
  Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;

// A colour the exports can write verbatim: ODF and DOCX both take #RRGGBB only.
function hex(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function readBorder(raw: unknown): PageBorder | null {
  const b = raw as Partial<PageBorder> | null | undefined;
  if (!b || typeof b !== 'object') return null;
  return {
    widthPt: clamp(Number(b.widthPt) || DEFAULT_PAGE_BORDER.widthPt, 0.25, 20),
    color: hex(b.color, DEFAULT_PAGE_BORDER.color)!,
    paddingCm: clamp(Number(b.paddingCm) || 0, 0, 5),
  };
}

function readWatermark(raw: unknown): Watermark | null {
  const w = raw as Partial<Watermark> | null | undefined;
  if (!w || typeof w !== 'object' || typeof w.text !== 'string' || !w.text) return null;
  return {
    text: w.text,
    font: typeof w.font === 'string' && w.font ? w.font : DEFAULT_WATERMARK.font,
    color: hex(w.color, DEFAULT_WATERMARK.color)!,
    angle: clamp(Number(w.angle) || 0, -180, 180),
    transparency: clamp(Number(w.transparency) || 0, 0, 100),
  };
}

export function normalizePageDecor(raw: unknown): PageDecor {
  const d = raw as Partial<PageDecor> | null | undefined;
  if (!d || typeof d !== 'object') return EMPTY_PAGE_DECOR;
  return {
    background: hex(d.background, null),
    border: readBorder(d.border),
    watermark: readWatermark(d.watermark),
  };
}

export function isEmptyPageDecor(d: PageDecor): boolean {
  return !d.background && !d.border && !d.watermark;
}

export function loadPageDecor(): PageDecor {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizePageDecor(JSON.parse(raw)) : EMPTY_PAGE_DECOR;
  } catch {
    return EMPTY_PAGE_DECOR;
  }
}

export function savePageDecor(decor: PageDecor): void {
  if (isEmptyPageDecor(decor)) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(decor));
}
