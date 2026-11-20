// The document's page setup as one reactive object. Each field is listed once, below: how it
// loads and saves, what a new document starts with and what an opened file brings. Undo,
// sessions, New, Open and autosave all walk this list, so a new field goes here and nowhere else.

import type { OdtImportResult } from '../import/odt';
import { loadPageMargins, savePageMargins, DEFAULT_MARGINS } from './pageMargins';
import { loadOrientation, saveOrientation, type Orientation } from './pageOrientation';
import { loadPageFormat, savePageFormat, type PageFormat } from './pageFormat';
import { loadHfDistances, saveHfDistances, loadHfFrames, saveHfFrames, loadDifferentFirstPage, saveDifferentFirstPage, loadDifferentOddEven, saveDifferentOddEven, DEFAULT_HF_DISTANCES, NO_HF_FRAMES, type HfSetFrames } from './headerFooter';
import { loadPageNumbering, savePageNumbering, DEFAULT_PAGE_NUMBERING } from './pageNumbering';
import { loadPageDecor, savePageDecor, EMPTY_PAGE_DECOR } from './pageDecor';
import { loadLineNumbering, saveLineNumbering, DEFAULT_LINE_NUMBERING } from './lineNumbering';
import { loadLineGrid, saveLineGrid, DEFAULT_LINE_GRID } from './lineGrid';
import { loadTabInterval, saveTabInterval, DEFAULT_TAB_INTERVAL_CM } from './tabInterval';
import { loadSpacingModel, saveSpacingModel, loadSpacingAtPageStart, saveSpacingAtPageStart, type SpacingModel } from './spacingModel';
import { loadPageRtl, savePageRtl } from './writingMode';
import { loadHyphenation, saveHyphenation } from './hyphenation';
import { loadBalanceSpaces, saveBalanceSpaces } from './balanceSpaces';
import { loadFoldMarks, saveFoldMarks } from './foldMarks';

// `blank` gets the value in effect and gives a new document's; `opened` gives undefined
// where the file keeps the value in effect.
type Field<T> = {
  load: () => T;
  save: (value: T) => void;
  blank: (now: T) => T;
  opened: (file: OdtImportResult) => T | undefined;
};
const field = <T>(f: Field<T>): Field<T> => f;

// The order is the undo step's and a session's field order.
const FIELDS = {
  pageMargins: field({ load: loadPageMargins, save: savePageMargins, blank: () => ({ ...DEFAULT_MARGINS }), opened: (f) => f.margins ?? undefined }),
  pageOrientation: field<Orientation>({ load: loadOrientation, save: saveOrientation, blank: () => 'portrait', opened: (f) => f.orientation ?? undefined }),
  pageFormat: field<PageFormat>({ load: loadPageFormat, save: savePageFormat, blank: () => 'A4', opened: (f) => f.format ?? undefined }),
  hfDistances: field({
    load: loadHfDistances, save: saveHfDistances, blank: () => ({ ...DEFAULT_HF_DISTANCES }),
    opened: (f) => ({ header: f.headerDistanceCm ?? DEFAULT_HF_DISTANCES.header, footer: f.footerDistanceCm ?? DEFAULT_HF_DISTANCES.footer }),
  }),
  hfFrames: field<HfSetFrames>({
    load: loadHfFrames, save: saveHfFrames, blank: () => ({ ...NO_HF_FRAMES }),
    opened: (f) => ({ frames: f.hfSections?.[0]?.frames ?? null, framesFirst: f.hfSections?.[0]?.framesFirst ?? null }),
  }),
  differentFirstPage: field({ load: loadDifferentFirstPage, save: saveDifferentFirstPage, blank: () => false, opened: (f) => f.differentFirstPage }),
  differentOddEven: field({ load: loadDifferentOddEven, save: saveDifferentOddEven, blank: () => false, opened: (f) => f.differentOddEven }),
  pageNumbering: field({ load: loadPageNumbering, save: savePageNumbering, blank: () => ({ ...DEFAULT_PAGE_NUMBERING }), opened: (f) => f.pageNumbering }),
  pageDecor: field({ load: loadPageDecor, save: savePageDecor, blank: () => ({ ...EMPTY_PAGE_DECOR }), opened: (f) => f.decor }),
  lineNumbering: field({ load: loadLineNumbering, save: saveLineNumbering, blank: () => ({ ...DEFAULT_LINE_NUMBERING }), opened: (f) => f.lineNumbering }),
  lineGrid: field({ load: loadLineGrid, save: saveLineGrid, blank: () => ({ ...DEFAULT_LINE_GRID }), opened: (f) => f.lineGrid }),
  tabIntervalCm: field({ load: loadTabInterval, save: saveTabInterval, blank: () => DEFAULT_TAB_INTERVAL_CM, opened: (f) => f.tabIntervalCm || undefined }),
  spacingModel: field<SpacingModel>({ load: loadSpacingModel, save: saveSpacingModel, blank: () => 'add', opened: (f) => f.spacingModel }),
  spacingAtPageStart: field({ load: loadSpacingAtPageStart, save: saveSpacingAtPageStart, blank: () => true, opened: (f) => f.spacingAtPageStart !== false }),
  pageRtl: field({ load: loadPageRtl, save: savePageRtl, blank: () => false, opened: (f) => f.rtl }),
  hyphenate: field({ load: loadHyphenation, save: saveHyphenation, blank: () => false, opened: (f) => f.hyphenate }),
  balanceSpaces: field({ load: loadBalanceSpaces, save: saveBalanceSpaces, blank: () => false, opened: (f) => f.balanceSpaces }),
  foldMarks: field({ load: loadFoldMarks, save: saveFoldMarks, blank: () => false, opened: (f) => f.foldMarks === true }),
};

type Fields = typeof FIELDS;
export type PageLayout = { [K in keyof Fields]: Fields[K] extends Field<infer T> ? T : never };
type Key = keyof PageLayout;
const KEYS = Object.keys(FIELDS) as Key[];

// Read and written field by field (`layout.pageMargins`), so each control and effect
// tracks only what it touches.
export const layout: PageLayout = $state(Object.fromEntries(KEYS.map((k) => [k, FIELDS[k].load()])) as PageLayout);

function set<K extends Key>(key: K, value: PageLayout[K]): void {
  layout[key] = value;
}

/** Every field as it is now, in the list's order. */
export function layoutValues(): PageLayout {
  return Object.fromEntries(KEYS.map((k) => [k, layout[k]])) as PageLayout;
}

/** Puts back every field of a snapshot `layoutValues` took. */
export function setLayout(values: PageLayout): void {
  for (const k of KEYS) set(k, values[k]);
}

/** A new document's page setup. */
export function resetLayout(): void {
  for (const k of KEYS) set(k, (FIELDS[k] as Field<PageLayout[typeof k]>).blank(layout[k]));
}

/** The page setup an opened file brings. */
export function adoptLayout(file: OdtImportResult): void {
  for (const k of KEYS) {
    const value = (FIELDS[k] as Field<PageLayout[typeof k]>).opened(file);
    if (value !== undefined) set(k, value);
  }
}

/** Keeps each field in localStorage; called once while the app component sets up. */
export function persistLayout(): void {
  for (const k of KEYS) $effect(() => (FIELDS[k] as Field<PageLayout[typeof k]>).save(layout[k]));
}
