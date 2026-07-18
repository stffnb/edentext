// Header/footer content: one single-paragraph TipTap doc per zone (hfExtensions
// schema). The 'default' variant repeats on every page (odd pages when odd/even is
// on); 'first' (Word "Different First Page" / ODF header-first) overrides page 1;
// 'even' (Word "Different Odd & Even Pages" / ODF header-left) overrides even pages.
// Precedence: first (page 1) > even (even pages) > default. null = empty zone.

export type HfZone = 'header' | 'footer';
export type HfVariant = 'default' | 'first' | 'even';
export type HfDoc = { type: 'doc'; content?: unknown[] } | null;

const KEYS: Record<HfZone, Record<HfVariant, string>> = {
  header: { default: 'odf-editor-header', first: 'odf-editor-header-first', even: 'odf-editor-header-even' },
  footer: { default: 'odf-editor-footer', first: 'odf-editor-footer-first', even: 'odf-editor-footer-even' },
};

// Whether page 1 uses its own header/footer (Word w:titlePg / ODF header-first).
const DIFFERENT_FIRST_KEY = 'odf-editor-hf-different-first';
// Whether even pages use their own header/footer (Word w:evenAndOddHeaders / ODF header-left).
const DIFFERENT_ODD_EVEN_KEY = 'odf-editor-hf-odd-even';

export function loadDifferentFirstPage(): boolean {
  return localStorage.getItem(DIFFERENT_FIRST_KEY) === 'true';
}

export function saveDifferentFirstPage(on: boolean): void {
  if (on) localStorage.setItem(DIFFERENT_FIRST_KEY, 'true');
  else localStorage.removeItem(DIFFERENT_FIRST_KEY);
}

export function loadDifferentOddEven(): boolean {
  return localStorage.getItem(DIFFERENT_ODD_EVEN_KEY) === 'true';
}

export function saveDifferentOddEven(on: boolean): void {
  if (on) localStorage.setItem(DIFFERENT_ODD_EVEN_KEY, 'true');
  else localStorage.removeItem(DIFFERENT_ODD_EVEN_KEY);
}

// Word's default distance from the page edge to the header/footer text. The body
// margin stays the body margin (Word semantics); export/import convert to ODF's
// margin-to-header model (see export/odt.ts applyHfPostProcess).
export const HF_DISTANCE_CM = 1.25;

// Per-zone distance from the page edge to the header (from top) / footer (from
// bottom), in cm — user-configurable in the Layout panel.
export type HfDistances = { header: number; footer: number };

export const DEFAULT_HF_DISTANCES: HfDistances = { header: HF_DISTANCE_CM, footer: HF_DISTANCE_CM };

const DIST_KEY = 'odf-editor-hf-distances';
const DIST_MIN = 0;
const DIST_MAX = 10;

export function clampHfDistance(n: number): number {
  if (!Number.isFinite(n)) return HF_DISTANCE_CM;
  return Math.min(DIST_MAX, Math.max(DIST_MIN, Math.round(n * 100) / 100));
}

export function loadHfDistances(): HfDistances {
  const raw = localStorage.getItem(DIST_KEY);
  if (!raw) return { ...DEFAULT_HF_DISTANCES };
  try {
    const p = JSON.parse(raw);
    return {
      header: typeof p.header === 'number' ? clampHfDistance(p.header) : HF_DISTANCE_CM,
      footer: typeof p.footer === 'number' ? clampHfDistance(p.footer) : HF_DISTANCE_CM,
    };
  } catch {
    return { ...DEFAULT_HF_DISTANCES };
  }
}

export function saveHfDistances(d: HfDistances): void {
  localStorage.setItem(DIST_KEY, JSON.stringify(d));
}

export function loadHfDoc(zone: HfZone, variant: HfVariant = 'default'): HfDoc {
  const raw = localStorage.getItem(KEYS[zone][variant]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.type === 'doc' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveHfDoc(zone: HfZone, doc: HfDoc, variant: HfVariant = 'default'): void {
  if (hfIsEmpty(doc)) localStorage.removeItem(KEYS[zone][variant]);
  else localStorage.setItem(KEYS[zone][variant], JSON.stringify(doc));
}

// Empty = null or a single paragraph without inline content. Empty zones render
// nothing and are skipped on export.
export function hfIsEmpty(doc: HfDoc): boolean {
  if (!doc?.content?.length) return true;
  const para = doc.content[0] as { content?: unknown[] } | undefined;
  return !para?.content?.length;
}
