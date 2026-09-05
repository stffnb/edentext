// The export arguments beside the document — page setup, zones and sections, styles,
// notes, decor — drawn per seed, and both importers' readings of them reduced to one
// shape (`expectedOptions`/`importedOptions`) so a round trip compares field by field.
import { builtinStyleSheet, type StyleSheet, type Style, type ParaProps, type TextProps } from '../src/lib/styles/styleSheet';
import { DEFAULT_OUTLINE_LEVEL, MAX_OUTLINE_LEVELS, type OutlineNumbering } from '../src/lib/styles/outlineNumbering';
import { EMPTY_HF_SET, HF_DISTANCE_CM, type HfSet, type HfDoc } from '../src/lib/storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, type NoteSettings } from '../src/lib/storage/noteSettings';
import { EMPTY_PAGE_DECOR, type PageDecor } from '../src/lib/storage/pageDecor';
import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../src/lib/storage/lineNumbering';
import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../src/lib/storage/pageNumbering';
import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../src/lib/storage/docProperties';
import { LANGUAGES } from '../src/lib/storage/documentLanguage';
import type { PageMargins } from '../src/lib/storage/pageMargins';
import type { PageFormat } from '../src/lib/storage/pageFormat';
import type { Orientation } from '../src/lib/storage/pageOrientation';
import type { SpacingModel } from '../src/lib/storage/spacingModel';
import type { HfExport } from '../src/lib/export/odt';
import type { OdtImportResult } from '../src/lib/import/odt';
import { genDoc, pick, int, maybe, type Rng } from './fuzzDoc';
import { normalize } from './normalize';

type N = any;

export type FuzzOptions = {
  margins: PageMargins; orientation: Orientation; hf: HfExport | undefined;
  language: { language: string; country: string } | null; pageFormat: PageFormat;
  styles: StyleSheet; tabIntervalCm: number; spacingModel: SpacingModel;
  notes: NoteSettings; props: DocProperties; hyphenate: boolean; pageNumbering: PageNumbering;
  decor: PageDecor; lineNumbering: LineNumbering; recordChanges: boolean; foldMarks: boolean;
  spacingAtPageStart: boolean;
  // The user styles the document references (plus their parents): the only ones the
  // export writes, so the only ones that can come back.
  userStyles: string[];
};

// The positional arguments after the document, for buildOdt and buildDocx alike.
export function exportArgs(o: FuzzOptions) {
  return [o.margins, o.orientation, o.hf, o.language, o.pageFormat, o.styles, o.tabIntervalCm,
    o.spacingModel, false, o.notes, o.props, o.hyphenate, o.pageNumbering, o.decor,
    o.lineNumbering, o.recordChanges, o.foldMarks, o.spacingAtPageStart] as const;
}

const STYLE_NAMES = ['Merksatz', 'Fuzz Body', 'Größe & <Stil>'] as const;

// User styles chain parent → child; each style draws its values from its own pool, so
// none equals what its chain resolves to (an equal value reads as inherited and is dropped).
function genStyles(r: Rng): { sheet: StyleSheet; names: string[] } {
  const sheet = builtinStyleSheet();
  const names = STYLE_NAMES.slice(0, int(r, 0, 3));
  names.forEach((name, i) => {
    const own = <T,>(pool: readonly [T, T, T]): T => pool[i];
    const para: ParaProps = {};
    const text: TextProps = {};
    if (maybe(r, 0.4)) para.textAlign = own(['justify', 'right', 'center']);
    if (maybe(r, 0.4)) para.lineHeight = own(['1.15', '1.5', '2']);
    if (maybe(r, 0.4)) para.spaceBefore = own([6, 12, 3]);
    if (maybe(r, 0.4)) para.spaceAfter = own([8, 4, 2]);
    if (maybe(r, 0.4)) para.indent = own([1.5, 0.75, 2.25]);
    if (maybe(r, 0.2)) para.backgroundColor = own(['#EEF3F8', '#FFF2CC', '#E2F0D9']);
    if (maybe(r, 0.2)) {
      para.borderBottom = own(['1pt solid #FF0000', '0.5pt solid #00B050', '2pt solid #0070C0']);
      if (maybe(r, 0.5)) para.borderPadding = own([2, 4, 6]);
    }
    if (maybe(r, 0.4)) text.fontFamily = own(['Liberation Sans', 'Courier New', 'Liberation Mono']);
    if (maybe(r, 0.4)) text.fontSizePt = own([10, 14, 11]);
    if (maybe(r, 0.4)) text[own(['bold', 'italic', 'underline'] as const)] = true;
    if (maybe(r, 0.4)) text.color = own(['#004080', '#7030A0', '#385723']);
    if (maybe(r, 0.2)) text.letterSpacingPt = own([0.5, 1.2, 2]);
    const style: Style = { name, parent: i > 0 && maybe(r, 0.4) ? names[i - 1] : 'Standard',
      next: maybe(r, 0.3) ? name : 'Standard', para, text };
    sheet.paragraph[name] = style;
  });
  if (maybe(r, 0.25)) {
    const depth = int(r, 1, 3);
    sheet.outline = Array.from({ length: MAX_OUTLINE_LEVELS }, (_, i) => i < depth
      ? { format: pick(r, ['1', 'a', 'I'] as const), prefix: maybe(r, 0.3) ? '§' : '',
          suffix: pick(r, ['.', ')', '']), displayLevels: int(r, 1, i + 1), start: pick(r, [1, 1, 3]) }
      : { ...DEFAULT_OUTLINE_LEVEL });
  }
  return { sheet, names };
}

const MARGIN_SETS: PageMargins[] = [
  { top: 2, bottom: 2, left: 2, right: 2 },
  { top: 2.5, bottom: 2, left: 3, right: 1.5 },
  { top: 1.5, bottom: 1.5, left: 1.9, right: 1.9 },
];

function zone(r: Rng): HfDoc {
  const attrs: N = {};
  if (maybe(r, 0.4)) attrs.textAlign = pick(r, ['center', 'right']);
  const marks = maybe(r, 0.3) ? [{ type: 'bold' }] : undefined;
  const content: N[] = [{ type: 'text', text: pick(r, ['Bericht', 'a & <b>', 'Größe']), ...(marks ? { marks } : {}) }];
  if (maybe(r, 0.3)) content.unshift({ type: 'chapterField', attrs: { level: 1, text: 'Kapitel' } }, { type: 'text', text: ' ' });
  if (maybe(r, 0.5)) content.push({ type: 'text', text: '\t' }, { type: 'pageNumber' });
  if (maybe(r, 0.3)) content.push({ type: 'text', text: ' of ' }, { type: 'pageCount' });
  if (maybe(r, 0.2)) content.push({ type: 'hardBreak' }, { type: 'text', text: 'zweite Zeile' });
  return { type: 'doc', content: [{ type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), content }] };
}

// The zones of one set. The first-page and even-page flags need a running zone to
// ride on: the file carries them as elements beside it, nowhere else.
function zones(r: Rng): HfSet {
  const s: HfSet = { ...EMPTY_HF_SET };
  if (maybe(r, 0.6)) s.header = zone(r);
  if (maybe(r, 0.6)) s.footer = zone(r);
  const running = !!(s.header || s.footer);
  if (running && maybe(r, 0.3)) {
    s.differentFirstPage = true;
    if (maybe(r, 0.6)) s.headerFirst = zone(r);
    if (maybe(r, 0.5)) s.footerFirst = zone(r);
  }
  if (running && maybe(r, 0.25)) {
    s.differentOddEven = true;
    if (maybe(r, 0.6)) s.headerEven = zone(r);
    if (maybe(r, 0.5)) s.footerEven = zone(r);
  }
  return s;
}

// A section past the first: its zones plus whatever page setup of its own it takes.
function section(r: Rng): HfSet {
  const s = zones(r);
  if (maybe(r, 0.2)) s.margins = pick(r, MARGIN_SETS);
  if (maybe(r, 0.15)) { s.format = pick(r, ['A5', 'letter']); s.orientation = pick(r, ['portrait', 'landscape']); }
  if (maybe(r, 0.2)) s.pageNumberStart = int(r, 1, 9);
  if (maybe(r, 0.15)) s.pageNumberFormat = pick(r, ['i', 'I', 'a', 'A']);
  if (maybe(r, 0.15)) s.distances = { header: pick(r, [0.6, 1]), footer: pick(r, [0.6, 1]) };
  if (maybe(r, 0.15)) s.startsOn = pick(r, ['odd', 'even']);
  return s;
}

function genHf(r: Rng, nSections: number): HfExport | undefined {
  const top = zones(r);
  if (!top.header && !top.footer && nSections === 1) return undefined;
  const hf: HfExport = {
    header: top.header, footer: top.footer,
    headerFirst: top.headerFirst, footerFirst: top.footerFirst, differentFirstPage: top.differentFirstPage,
    headerEven: top.headerEven, footerEven: top.footerEven, differentOddEven: top.differentOddEven,
    pageCount: nSections + 2,
  };
  // Distances stay under the smallest margin (the export clamps them there).
  if (top.header && maybe(r, 0.4)) hf.headerDistanceCm = pick(r, [0.8, 1]);
  if (top.footer && maybe(r, 0.4)) hf.footerDistanceCm = pick(r, [0.8, 1]);
  if (nSections > 1) hf.sections = [top, ...Array.from({ length: nSections - 1 }, () => section(r))];
  return hf;
}

const HOSTILE = ['Jahresbericht & <Q1>', 'Größe "quoted"', "it's"] as const;

// `carrier`: whether the document holds a paragraph or heading — ODF keeps the first
// page number on the first paragraph, so a document of one empty index has no place for it.
function genOptions(r: Rng, sheet: StyleSheet, nSections: number, carrier: boolean): Omit<FuzzOptions, 'userStyles'> {
  const margins = { ...pick(r, MARGIN_SETS), ...(maybe(r, 0.2) ? { mirrored: true } : {}) };
  const notes = structuredClone(DEFAULT_NOTE_SETTINGS);
  if (maybe(r, 0.3)) {
    notes.footnote.numFormat = pick(r, ['1', 'i', 'I', 'a', 'A']);
    notes.footnote.startAt = int(r, 1, 5);
    notes.footnote.restart = pick(r, ['document', 'page']);
  }
  if (maybe(r, 0.2)) { notes.endnote.numFormat = pick(r, ['1', 'I', 'a', 'A']); notes.endnote.startAt = int(r, 1, 5); }
  if (maybe(r, 0.2)) { notes.footnote.prefix = '('; notes.footnote.suffix = ')'; }
  if (maybe(r, 0.2)) notes.separator = { ...notes.separator, relWidthPercent: 60, weightPt: 1.5, align: 'center' };
  const decor: PageDecor = { ...EMPTY_PAGE_DECOR };
  if (maybe(r, 0.15)) decor.background = pick(r, ['#fffdf5', '#eef3f8']);
  if (maybe(r, 0.15)) decor.border = { widthPt: pick(r, [0.5, 1, 2.25]), color: '#0046a0', paddingCm: pick(r, [0.05, 0.2, 0.5]) };
  if (maybe(r, 0.15)) {
    decor.watermark = { text: pick(r, ['ENTWURF', 'DRAFT & <x>']), font: 'Liberation Sans',
      color: '#c0c0c0', angle: pick(r, [0, 45, -30, 135]), transparency: pick(r, [0, 50, 80]) };
  }
  const lineNumbering: LineNumbering = maybe(r, 0.15)
    ? { on: true, interval: pick(r, [1, 5, 10]), distanceCm: pick(r, [0.5, 1]),
        restart: pick(r, ['continuous', 'page']), countEmpty: maybe(r, 0.5) }
    : { ...DEFAULT_LINE_NUMBERING };
  return {
    margins,
    orientation: maybe(r, 0.15) ? 'landscape' : 'portrait',
    hf: genHf(r, nSections),
    language: pick(r, [LANGUAGES[0].odf, LANGUAGES[1].odf, null]),
    pageFormat: maybe(r, 0.3) ? pick(r, ['A5', 'letter', 'legal', 'A3', 'executive', 'isoB5']) : 'A4',
    styles: sheet,
    tabIntervalCm: pick(r, [1.25, 1.25, 2, 0.5]),
    spacingModel: maybe(r, 0.15) ? 'max' : 'add',
    notes,
    props: maybe(r, 0.3)
      ? { title: pick(r, HOSTILE), subject: 'Finanzen', author: pick(r, HOSTILE), keywords: 'Bilanz, Prüfung', description: pick(r, HOSTILE) }
      : { ...EMPTY_DOC_PROPERTIES },
    hyphenate: maybe(r, 0.2),
    pageNumbering: maybe(r, 0.2) ? { format: pick(r, ['i', 'I', 'a', 'A']), start: carrier ? int(r, 1, 7) : 1 } : { ...DEFAULT_PAGE_NUMBERING },
    decor,
    lineNumbering,
    recordChanges: maybe(r, 0.1),
    foldMarks: maybe(r, 0.1),
    spacingAtPageStart: !maybe(r, 0.2),
  };
}

function usedStyles(doc: N, sheet: StyleSheet, names: string[]): string[] {
  const used = new Set<string>();
  for (const block of doc.content ?? []) {
    let name: string | undefined = block.attrs?.styleName;
    while (name && names.includes(name) && !used.has(name)) {
      used.add(name);
      name = sheet.paragraph[name]?.parent ?? undefined;
    }
  }
  return names.filter((n) => used.has(n));
}

export function genCase(r: Rng): { doc: N; opts: FuzzOptions } {
  const { sheet, names } = genStyles(r);
  const doc = genDoc(r, names);
  const nSections = 1 + doc.content.filter((b: N) => b.attrs?.sectionBreak).length;
  const carrier = doc.content.some((b: N) => b.type === 'paragraph' || b.type === 'heading');
  const opts = genOptions(r, sheet, nSections, carrier);
  return { doc, opts: { ...opts, userStyles: usedStyles(doc, sheet, names) } };
}

// --- the imported reading and the authored options, in one shape ---

const compact = (o: N): N => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null));
const zoneDoc = (d: HfDoc | undefined): N => (d ? normalize(structuredClone(d)) : null);
const marginsOf = (m: PageMargins | null | undefined): N =>
  m ? { top: m.top, bottom: m.bottom, left: m.left, right: m.right, ...(m.mirrored ? { mirrored: true } : {}) } : null;

// The document's page setup, which fills whatever a section has none of its own.
type DocSetup = {
  margins: PageMargins | null; format: PageFormat | null; orientation: Orientation | null;
  numFormat: string; headerDist: number | null; footerDist: number | null;
};

// One section's effective page setup: its zones, and the document's values wherever it
// has none of its own. An importer may elect a later section's master page as the
// document's, so only what a section ends up with is comparable, not where it is kept.
function hfSet(s: Partial<HfSet> | undefined, index: number, doc: DocSetup): N {
  const z: HfSet = { ...EMPTY_HF_SET, ...(s ?? {}) };
  const out: N = { header: zoneDoc(z.header), footer: zoneDoc(z.footer),
    differentFirstPage: !!z.differentFirstPage, differentOddEven: !!z.differentOddEven };
  if (out.differentFirstPage) { out.headerFirst = zoneDoc(z.headerFirst); out.footerFirst = zoneDoc(z.footerFirst); }
  if (out.differentOddEven) { out.headerEven = zoneDoc(z.headerEven); out.footerEven = zoneDoc(z.footerEven); }
  const has = { header: !!(z.header || z.headerFirst || z.headerEven), footer: !!(z.footer || z.footerFirst || z.footerEven) };
  // Mirroring is the document's, whichever margins a section has of its own.
  const margins = z.margins ?? doc.margins;
  Object.assign(out, {
    margins: margins && marginsOf({ ...margins, mirrored: !!doc.margins?.mirrored }),
    format: z.format ?? doc.format, orientation: z.orientation ?? doc.orientation,
    pageNumberFormat: z.pageNumberFormat ?? doc.numFormat,
    headerDist: has.header ? z.distances?.header ?? doc.headerDist : null,
    footerDist: has.footer ? z.distances?.footer ?? doc.footerDist : null,
    pageNumberStart: index > 0 ? z.pageNumberStart ?? null : null,
    startsOn: index > 0 ? z.startsOn ?? null : null,
  });
  return out;
}

const styleOf = (s: Style | undefined): N => (s ? { parent: s.parent, next: s.next, para: compact(s.para), text: compact(s.text) } : null);

// null where nothing is numbered; the resolved label look is import-only.
function outlineOf(o: OutlineNumbering | null | undefined): N {
  if (!o || o.every((l) => l.format === 'none')) return null;
  return Array.from({ length: MAX_OUTLINE_LEVELS }, (_, i) => {
    const { labelText, ...rest } = o[i] ?? DEFAULT_OUTLINE_LEVEL;
    return compact(rest);
  });
}

export function expectedOptions(o: FuzzOptions): N {
  const hf = o.hf;
  const doc: DocSetup = { margins: o.margins, format: o.pageFormat, orientation: o.orientation,
    numFormat: o.pageNumbering.format,
    headerDist: hf?.headerDistanceCm ?? HF_DISTANCE_CM, footerDist: hf?.footerDistanceCm ?? HF_DISTANCE_CM };
  const sets: Partial<HfSet>[] = hf?.sections ?? [hf ?? {}];
  return {
    language: o.language ? LANGUAGES.find((l) => l.odf.language === o.language!.language)!.code : null,
    tabIntervalCm: o.tabIntervalCm, spacingModel: o.spacingModel, hyphenate: o.hyphenate,
    recordChanges: o.recordChanges, foldMarks: o.foldMarks, spacingAtPageStart: o.spacingAtPageStart,
    pageNumberStart: o.pageNumbering.start, decor: o.decor, lineNumbering: o.lineNumbering, props: o.props,
    notes: o.notes,
    sections: sets.map((s, i) => hfSet(s, i, doc)),
    styles: Object.fromEntries(o.userStyles.map((n) => [n, styleOf(o.styles.paragraph[n])])),
    outline: outlineOf(o.styles.outline),
  };
}

export function importedOptions(res: OdtImportResult, o: FuzzOptions): N {
  const doc: DocSetup = { margins: res.margins, format: res.format, orientation: res.orientation,
    numFormat: res.pageNumbering.format, headerDist: res.headerDistanceCm, footerDist: res.footerDistanceCm };
  return {
    language: res.language,
    tabIntervalCm: res.tabIntervalCm, spacingModel: res.spacingModel, hyphenate: res.hyphenate,
    recordChanges: res.recordChanges, foldMarks: res.foldMarks, spacingAtPageStart: res.spacingAtPageStart,
    pageNumberStart: res.pageNumbering.start, decor: res.decor, lineNumbering: res.lineNumbering, props: res.props,
    notes: res.notes,
    sections: (res.hfSections ?? []).map((s, i) => hfSet(s, i, doc)),
    styles: Object.fromEntries(o.userStyles.map((n) => [n, styleOf(res.styles.paragraph[n])])),
    outline: outlineOf(res.styles.outline),
  };
}

// firstDiff with the slack a unit conversion needs: numbers within 0.02 agree, and a
// missing value equals a null one.
export function diffLoose(a: N, b: N, path = '$'): string | null {
  if (a == null && b == null) return null;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.02 ? null : `${path}: ${a} vs ${b}`;
  if (typeof a !== typeof b || a == null || b == null) return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (typeof a !== 'object') return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = diffLoose(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// Drops the paths a format cannot carry (`a.b`, `sections.*.c`) from a canonical reading.
export function omit(canon: N, paths: readonly string[]): N {
  const out = structuredClone(canon);
  const drop = (node: N, parts: string[]): void => {
    if (!node || typeof node !== 'object') return;
    const [head, ...rest] = parts;
    const keys = head === '*' ? Object.keys(node) : [head];
    for (const k of keys) {
      if (rest.length) drop(node[k], rest);
      else delete node[k];
    }
  };
  for (const p of paths) drop(out, p.split('.'));
  return out;
}
