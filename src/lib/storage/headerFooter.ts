// Header/footer content: one single-paragraph TipTap doc per zone (hfExtensions schema).
// 'default' repeats on every page (odd pages when odd/even is on), 'first' overrides
// page 1, 'even' overrides even pages — also their precedence. null = empty zone.

import type { PageMargins } from './pageMargins';

export type HfZone = 'header' | 'footer';
export type HfVariant = 'default' | 'first' | 'even';
export type HfDoc = { type: 'doc'; content?: unknown[] } | null;

// One section's page setup: its zones and, where the file gives the section its own,
// its page margins. A document has one per section (a body block carrying
// `sectionBreak` starts the next one). `margins` null = the document's own.
export type HfSet = {
  header: HfDoc;
  footer: HfDoc;
  headerFirst: HfDoc;
  footerFirst: HfDoc;
  differentFirstPage: boolean;
  headerEven: HfDoc;
  footerEven: HfDoc;
  differentOddEven: boolean;
  margins?: PageMargins | null;
  // The section's first page, where its page style hands over to another after it
  // (ODF style:next-style-name — the title-page idiom). null = same as `margins`.
  marginsFirst?: PageMargins | null;
};

export const EMPTY_HF_SET: HfSet = {
  header: null, footer: null,
  headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false,
  margins: null, marginsFirst: null,
};

export function hfSetIsEmpty(s: HfSet): boolean {
  return hfIsEmpty(s.header) && hfIsEmpty(s.footer)
    && hfIsEmpty(s.headerFirst) && hfIsEmpty(s.footerFirst)
    && hfIsEmpty(s.headerEven) && hfIsEmpty(s.footerEven);
}

// Sections past the first, in order. Persisted whole rather than per zone like
// section 1's, whose six docs each have their own key.
const EXTRA_KEY = 'edentext-hf-sections';

export function loadExtraHfSections(): HfSet[] {
  const raw = localStorage.getItem(EXTRA_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s) => ({ ...EMPTY_HF_SET, ...s })) : [];
  } catch {
    return [];
  }
}

export function saveExtraHfSections(sections: HfSet[]): void {
  if (sections.length) localStorage.setItem(EXTRA_KEY, JSON.stringify(sections));
  else localStorage.removeItem(EXTRA_KEY);
}

const KEYS: Record<HfZone, Record<HfVariant, string>> = {
  header: { default: 'edentext-header', first: 'edentext-header-first', even: 'edentext-header-even' },
  footer: { default: 'edentext-footer', first: 'edentext-footer-first', even: 'edentext-footer-even' },
};

// Whether page 1 uses its own header/footer (Word w:titlePg / ODF header-first).
const DIFFERENT_FIRST_KEY = 'edentext-hf-different-first';
// Whether even pages use their own header/footer (Word w:evenAndOddHeaders / ODF header-left).
const DIFFERENT_ODD_EVEN_KEY = 'edentext-hf-odd-even';

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

// Default distance from the page edge to the header/footer text; the body margin stays
// the body margin. Export/import convert to ODF's margin-to-header model (see
// export/odt.ts applyHfPostProcess).
export const HF_DISTANCE_CM = 1.25;

// Per-zone distance from the page edge to the header (from top) / footer (from
// bottom), in cm — user-configurable in the Layout panel.
export type HfDistances = { header: number; footer: number };

export const DEFAULT_HF_DISTANCES: HfDistances = { header: HF_DISTANCE_CM, footer: HF_DISTANCE_CM };

const DIST_KEY = 'edentext-hf-distances';
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

// Whether any zone shows a chapter field — only then does the layer need the
// heading→page map, which costs a DOM read per heading.
export function hfUsesChapterField(sets: HfSet[]): boolean {
  const inZone = (doc: HfDoc) =>
    ((doc?.content?.[0] as { content?: { type?: string }[] } | undefined)?.content ?? [])
      .some((n) => n.type === 'chapterField');
  return sets.some((s) => inZone(s.header) || inZone(s.footer) || inZone(s.headerFirst)
    || inZone(s.footerFirst) || inZone(s.headerEven) || inZone(s.footerEven));
}

// Empty = null or a single paragraph without inline content AND without a visible box
// (a footer that is just a colored rule line has no text but must still render/export).
export function hfIsEmpty(doc: HfDoc): boolean {
  if (!doc?.content?.length) return true;
  const para = doc.content[0] as { content?: unknown[]; attrs?: Record<string, unknown> } | undefined;
  if (para?.content?.length) return false;
  const a = para?.attrs ?? {};
  return !a.backgroundColor && !a.borderTop && !a.borderRight && !a.borderBottom && !a.borderLeft;
}
