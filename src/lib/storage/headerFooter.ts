// Header/footer content: one TipTap doc per zone (zoneExtensions schema).
// 'default' repeats on every page (odd pages when odd/even is on), 'first' overrides
// page 1, 'even' overrides even pages — also their precedence. null = empty zone.

import { withMirrored, type PageMargins } from './pageMargins';
import type { PageFormat } from './pageFormat';
import type { Orientation } from './pageOrientation';
import type { NoteNumFormat } from './noteSettings';
import { docKey, docStore, volatile } from './docScope';
import { stashImages, putImages, restoreImages, isStored, IDB_SRC } from './imageStore';
import { warnStorageFull } from './autosave';

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
  // The section's own paper, where the file gives it one (Word's w:pgSz, ODF's page
  // layout): a landscape page for a wide table amid portrait ones. null = the
  // document's own.
  format?: PageFormat | null;
  orientation?: Orientation | null;
  // The page number this section restarts at (Word's w:pgNumType start, ODF's
  // style:page-number on the paragraph that switches master page). null = it counts on.
  pageNumberStart?: number | null;
  // How its page-number field counts, where the section disagrees with the document
  // (roman front matter before decimal body). null = the document's own format.
  pageNumberFormat?: NoteNumFormat | null;
  // Its own edge→zone distances (ODF's page-layout margin, Word's w:pgMar
  // w:header/w:footer), where the section's page setup gives it others than the
  // document's; `distancesFirst` is its first page's where that hands over.
  distances?: HfDistances | null;
  distancesFirst?: HfDistances | null;
  // The side the section must open on (ODF `style:page-usage` right/left on its page
  // layout, Word's `w:type` oddPage/evenPage): where the flow would open it on the
  // other one, a blank page goes before it. null = wherever it falls.
  startsOn?: PageSide | null;
  // The zones' area boxes (ODF only), and its first page's where that hands over.
  frames?: HfFrames | null;
  framesFirst?: HfFrames | null;
};

// A zone's area as ODF's style:header-footer-properties draws it: per-side borders
// (canonical '<W>pt <line> #RRGGBB'), padding inside them and the gap to the body
// outside them, all cm. The area is at least its band less the gap; a `dynamic` gap
// (style:dynamic-spacing) shrinks as the area grows, so the band is max(band, area).
export type HfFrame = {
  border: { top: string | null; right: string | null; bottom: string | null; left: string | null };
  padding: { top: number; right: number; bottom: number; left: number };
  gap: number;
  dynamic?: boolean;
  background?: string; // '#RRGGBB', filling the area inside its borders
};
export type HfFrames = { header?: HfFrame | null; footer?: HfFrame | null };
// Section 1's frames, which the app keeps beside its zones.
export type HfSetFrames = Pick<HfSet, 'frames' | 'framesFirst'>;
export const NO_HF_FRAMES: HfSetFrames = { frames: null, framesFirst: null };

export type PageSide = 'odd' | 'even';

export const EMPTY_HF_SET: HfSet = {
  header: null, footer: null,
  headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false,
  margins: null, marginsFirst: null, format: null, orientation: null,
  distances: null, distancesFirst: null, startsOn: null, frames: null, framesFirst: null,
  pageNumberStart: null, pageNumberFormat: null,
};

// The six zone docs of a set, in the order their measured heights travel from
// HeaderFooterLayer to Editor.svelte.
export const HF_ZONE_KEYS = ['header', 'footer', 'headerFirst', 'footerFirst', 'headerEven', 'footerEven'] as const;
export type HfZoneKey = (typeof HF_ZONE_KEYS)[number];
/** A page whose zones are another height (px) than their set's, its fields filled in. */
export type PageZones = { page: number; header: HfZoneKey; footer: HfZoneKey; headerPx: number; footerPx: number };

// A margin edit in the UI: the values that changed go to every section with margins of
// its own as well, or an imported book whose chapters each carry a pair would not move.
export function spreadMargins(sections: HfSet[], prev: PageMargins, next: PageMargins): HfSet[] {
  const keys = (['top', 'bottom', 'left', 'right'] as const).filter((k) => prev[k] !== next[k]);
  const mirror = !!prev.mirrored !== !!next.mirrored;
  if (!keys.length && !mirror) return sections;
  const apply = (m: PageMargins | null | undefined) => m && withMirrored(
    { ...m, ...Object.fromEntries(keys.map((k) => [k, next[k]])) }, mirror ? !!next.mirrored : !!m.mirrored);
  return sections.map((s) => ({ ...s, margins: apply(s.margins), marginsFirst: apply(s.marginsFirst) }));
}

export function hfSetIsEmpty(s: HfSet): boolean {
  return hfIsEmpty(s.header) && hfIsEmpty(s.footer)
    && hfIsEmpty(s.headerFirst) && hfIsEmpty(s.footerFirst)
    && hfIsEmpty(s.headerEven) && hfIsEmpty(s.footerEven);
}

// Sections past the first, in order. Persisted whole rather than per zone like
// section 1's, whose six docs each have their own key.
const EXTRA_KEY = docKey('edentext-hf-sections');

export function loadExtraHfSections(): HfSet[] {
  const raw = docStore.getItem(EXTRA_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s) => ({ ...EMPTY_HF_SET, ...s })) : [];
  } catch {
    return [];
  }
}

type EachDoc = (f: (doc: HfDoc) => HfDoc) => unknown;
const latest = new Map<string, object>();

// Pictures go to the image store as the body's do (imageStore.ts). The write is at once,
// naming the pictures the store has confirmed and keeping the others inline until it has.
// A full storage loses the zones as it loses the body, under the same warning; a throw
// here would abort the rest of the effects that adopt an opened document.
function store(key: string, each: EachDoc): void {
  const token = {};
  latest.set(key, token);
  const write = () => {
    const json = volatile ? each((d) => d) : each((d) => d && (stashImages(d, isStored).json as HfDoc));
    try { docStore.setItem(key, JSON.stringify(json)); } catch (err) { warnStorageFull(key, err); }
  };
  write();
  if (volatile) return;
  const blobs = new Map<string, string>();
  each((d) => {
    if (d) for (const [k, v] of stashImages(d).blobs) if (!isStored(k)) blobs.set(k, v);
    return d;
  });
  if (blobs.size) void putImages(blobs, false).then((ok) => { if (ok && latest.get(key) === token) write(); });
}

const eachOfSets = (sections: HfSet[]): EachDoc => (f) =>
  sections.map((s) => ({ ...s, ...Object.fromEntries(HF_ZONE_KEYS.map((z) => [z, f(s[z])])) }));

export function saveExtraHfSections(sections: HfSet[]): void {
  if (sections.length) store(EXTRA_KEY, eachOfSets(sections));
  else { latest.delete(EXTRA_KEY); docStore.removeItem(EXTRA_KEY); }
}

const KEYS: Record<HfZone, Record<HfVariant, string>> = {
  header: { default: docKey('edentext-header'), first: docKey('edentext-header-first'), even: docKey('edentext-header-even') },
  footer: { default: docKey('edentext-footer'), first: docKey('edentext-footer-first'), even: docKey('edentext-footer-even') },
};

// Whether page 1 uses its own header/footer (Word w:titlePg / ODF header-first).
const DIFFERENT_FIRST_KEY = docKey('edentext-hf-different-first');
// Whether even pages use their own header/footer (Word w:evenAndOddHeaders / ODF header-left).
const DIFFERENT_ODD_EVEN_KEY = docKey('edentext-hf-odd-even');

export function loadDifferentFirstPage(): boolean {
  return docStore.getItem(DIFFERENT_FIRST_KEY) === 'true';
}

export function saveDifferentFirstPage(on: boolean): void {
  if (on) docStore.setItem(DIFFERENT_FIRST_KEY, 'true');
  else docStore.removeItem(DIFFERENT_FIRST_KEY);
}

export function loadDifferentOddEven(): boolean {
  return docStore.getItem(DIFFERENT_ODD_EVEN_KEY) === 'true';
}

export function saveDifferentOddEven(on: boolean): void {
  if (on) docStore.setItem(DIFFERENT_ODD_EVEN_KEY, 'true');
  else docStore.removeItem(DIFFERENT_ODD_EVEN_KEY);
}

// Default distance from the page edge to the header/footer text; the body margin stays
// the body margin. Export/import convert to ODF's margin-to-header model (see
// export/odt.ts applyHfPostProcess).
export const HF_DISTANCE_CM = 1.25;

// Per-zone distance from the page edge to the header (from top) / footer (from
// bottom), in cm — user-configurable in the Layout panel.
export type HfDistances = { header: number; footer: number };

export const DEFAULT_HF_DISTANCES: HfDistances = { header: HF_DISTANCE_CM, footer: HF_DISTANCE_CM };

const DIST_KEY = docKey('edentext-hf-distances');
const DIST_MIN = 0;
const DIST_MAX = 10;

export function clampHfDistance(n: number): number {
  if (!Number.isFinite(n)) return HF_DISTANCE_CM;
  return Math.min(DIST_MAX, Math.max(DIST_MIN, Math.round(n * 100) / 100));
}

export function loadHfDistances(): HfDistances {
  const raw = docStore.getItem(DIST_KEY);
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
  docStore.setItem(DIST_KEY, JSON.stringify(d));
}

const FRAMES_KEY = docKey('edentext-hf-frames');

export function loadHfFrames(): HfSetFrames {
  try {
    const p = JSON.parse(docStore.getItem(FRAMES_KEY) ?? 'null');
    return p && typeof p === 'object' ? { frames: p.frames ?? null, framesFirst: p.framesFirst ?? null } : { ...NO_HF_FRAMES };
  } catch {
    return { ...NO_HF_FRAMES };
  }
}

export function saveHfFrames(f: HfSetFrames): void {
  if (f.frames || f.framesFirst) docStore.setItem(FRAMES_KEY, JSON.stringify(f));
  else docStore.removeItem(FRAMES_KEY);
}

export function loadHfDoc(zone: HfZone, variant: HfVariant = 'default'): HfDoc {
  const raw = docStore.getItem(KEYS[zone][variant]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.type === 'doc' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The stored zones, read again with their pictures back from the image store — null when
 * they name none. `missing` counts the keys the store no longer had.
 */
export async function loadHfPictures(): Promise<{ zones: Record<HfZoneKey, HfDoc>; sections: HfSet[]; missing: number } | null> {
  const zones: Record<HfZoneKey, HfDoc> = {
    header: loadHfDoc('header'), footer: loadHfDoc('footer'),
    headerFirst: loadHfDoc('header', 'first'), footerFirst: loadHfDoc('footer', 'first'),
    headerEven: loadHfDoc('header', 'even'), footerEven: loadHfDoc('footer', 'even'),
  };
  const sections = loadExtraHfSections();
  const docs = [...Object.values(zones), ...sections.flatMap((s) => HF_ZONE_KEYS.map((z) => s[z]))].filter((d) => d != null);
  if (!docs.some((d) => JSON.stringify(d).includes(`"${IDB_SRC}`))) return null;
  let missing = 0;
  for (const d of docs) missing += await restoreImages(d);
  return { zones, sections, missing };
}

export function saveHfDoc(zone: HfZone, doc: HfDoc, variant: HfVariant = 'default'): void {
  const key = KEYS[zone][variant];
  if (hfIsEmpty(doc)) { latest.delete(key); docStore.removeItem(key); }
  else store(key, (f) => f(doc));
}

type ZoneNode = { type?: string; content?: ZoneNode[]; attrs?: Record<string, unknown> };

// Whether any zone shows a chapter field — only then does the layer need the
// heading→page map, which costs a DOM read per heading.
export function hfUsesChapterField(sets: HfSet[]): boolean {
  const has = (n: ZoneNode): boolean => n.type === 'chapterField' || !!n.content?.some(has);
  const inZone = (doc: HfDoc) => !!doc && has(doc as ZoneNode);
  return sets.some((s) => inZone(s.header) || inZone(s.footer) || inZone(s.headerFirst)
    || inZone(s.footerFirst) || inZone(s.headerEven) || inZone(s.footerEven));
}

// Empty = null or one text block without inline content AND without a visible box
// (a footer that is just a colored rule line has no text but must still render/export).
// Several blank lines are content: both word processors reserve each of them.
export function hfIsEmpty(doc: HfDoc): boolean {
  const blocks = doc?.content as ZoneNode[] | undefined;
  if ((blocks?.length ?? 0) > 1) return false;
  return !blocks?.some((b) => {
    if (b.type !== 'paragraph' && b.type !== 'heading') return true;
    if (b.content?.length) return true;
    const a = b.attrs ?? {};
    return !!(a.backgroundColor || a.borderTop || a.borderRight || a.borderBottom || a.borderLeft);
  });
}
