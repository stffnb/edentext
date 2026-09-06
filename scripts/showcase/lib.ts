// What the showcase documents share: the node builders, a styled table, pictures as
// data-URIs and the shape run.mjs hands to buildOdt/buildDocx. Runs in the browser,
// served by the dev server (see run.mjs).
import type { PageMargins } from '../../src/lib/storage/pageMargins';
import type { PageFormat } from '../../src/lib/storage/pageFormat';
import type { HfExport } from '../../src/lib/export/odt';
import type { StyleSheet } from '../../src/lib/styles/styleSheet';
import type { NoteSettings } from '../../src/lib/storage/noteSettings';
import type { DocProperties } from '../../src/lib/storage/docProperties';
import type { PageNumbering } from '../../src/lib/storage/pageNumbering';
import type { PageDecor } from '../../src/lib/storage/pageDecor';
import type { LineNumbering } from '../../src/lib/storage/lineNumbering';
import {
  DEFAULT_TABLE_LOOK, builtinTableStyles, resolveTableCell, tableLookAttr,
} from '../../src/lib/styles/tableStyles';

export { T, P, H, TBL, ROW, TC, THC, BOLD } from '../../src/lib/templates/builders';
import { P, T } from '../../src/lib/templates/builders';
export type N = Record<string, unknown>;

export const ITALIC = { type: 'italic' };
export const LI = (...content: N[]): N => ({ type: 'listItem', content });
export const UL = (...items: N[]): N => ({ type: 'bulletList', content: items });
export const OL = (...items: N[]): N => ({ type: 'orderedList', content: items });
export const BR: N = { type: 'hardBreak' };
export const FORMULA = (latex: string, display = false): N => ({ type: 'formula', attrs: { latex, display } });
export const SEQ = (category: 'figure' | 'table', number: number): N =>
  ({ type: 'sequenceField', attrs: { category, format: '1', number } });
export const CITE = (identifier: string, type: string, fields: Record<string, string>): N =>
  ({ type: 'bibliographyEntry', attrs: { identifier, type, fields, text: '' } });
export const IDX = (term: string): N => ({ type: 'indexEntry', attrs: { term } });
export const FOOTNOTE = (id: string, n: number): N =>
  ({ type: 'noteRef', attrs: { id, kind: 'footnote', text: String(n) } });
export const NOTE = (id: string, ...content: N[]): N =>
  ({ type: 'note', attrs: { id, kind: 'footnote', label: null, text: '' }, content });
export const INDEX = (index: string, title: string, extra: N = {}): N =>
  ({ type: 'tableOfContents', attrs: { entries: [], title, index, leader: '.', tabPosCm: null, maxLevel: 3, ...extra } });
export const COLUMNS = (count: number, gapCm: number, ...content: N[]): N =>
  ({ type: 'columns', attrs: { count, gapCm }, content });
export const PAGE_NUMBER: N = { type: 'pageNumber' };
export const HF = (attrs: N | null, ...content: N[]): N => ({ type: 'doc', content: [P(attrs, ...content)] });

/** A block-level picture in its own paragraph, or floating with the text around it. */
export const IMAGE = (src: string, width: number, height: number, attrs: N = {}): N =>
  ({ type: 'image', attrs: { src, width, height, ...attrs } });

// A picture served by the dev server (this folder's img/), as the data-URI the editor stores.
export async function picture(file: string): Promise<string> {
  const blob = await (await fetch(`/scripts/showcase/img/${file}`)).blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

export const svgDataUrl = (svg: string): string =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

// A table in one of the built-in table styles, its look resolved per cell the way the
// editor stores it. Cells are text, or ready-made node lists; `numeric` right-aligns.
export function styledTable(
  name: string, rows: (string | N[])[][],
  opts: { header?: boolean; widths?: number[]; formulas?: Record<string, string>; cellFormat?: string; numeric?: number[]; attrs?: N } = {},
): N {
  const style = builtinTableStyles()[name];
  if (!style) throw new Error(`no table style ${name}`);
  const look = { ...DEFAULT_TABLE_LOOK, ...(style.look ?? {}) };
  const nRows = rows.length, cols = rows[0].length;
  const header = opts.header ?? true;
  const content = rows.map((row, ri) => ({
    type: 'tableRow',
    content: row.map((cell, ci) => {
      const paint = resolveTableCell(style, { row: ri, col: ci, rows: nRows, cols }, look);
      const attrs: N = { colspan: 1, rowspan: 1, colwidth: opts.widths ? [opts.widths[ci]] : null };
      if (paint.fill) attrs.backgroundColor = paint.fill;
      for (const [k, v] of Object.entries(paint.borders)) if (v !== null) attrs[k] = v;
      if (paint.regions.length) attrs.region = paint.regions.join(' ');
      const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
      if (opts.formulas?.[ref]) { attrs.formula = opts.formulas[ref]; if (opts.cellFormat) attrs.cellFormat = opts.cellFormat; }
      const para = typeof cell === 'string'
        ? P(opts.numeric?.includes(ci) && ri > 0 ? { textAlign: 'right' } : null, ...(cell ? [T(cell)] : []))
        : P(null, ...cell);
      return { type: ri === 0 && header ? 'tableHeader' : 'tableCell', attrs, content: [para] };
    }),
  }));
  return { type: 'table', attrs: { tableStyle: name, tableLook: tableLookAttr(look), repeatHeader: header, ...(opts.attrs ?? {}) }, content };
}

/** One screenshot: which page sits at the top of the window, at which zoom and theme. */
export type Shot = {
  /** The page at the top of the window: by number, or the one holding this heading. */
  file: string; page?: number; at?: string; zoom?: number; theme?: 'light' | 'dark';
  /** Pages side by side (View ▸ page columns). */
  columns?: number; markup?: boolean; spelling?: boolean;
  /** The ribbon tab to open, and where to put the caret (first match in view). */
  tab?: string; caret?: string;
};

export type Showcase = {
  name: string;
  doc: N;
  margins?: PageMargins;
  orientation?: 'portrait' | 'landscape';
  hf?: HfExport;
  language?: { language: string; country: string };
  pageFormat?: PageFormat;
  styles?: StyleSheet;
  notes?: NoteSettings;
  props?: DocProperties;
  hyphenate?: boolean;
  pageNumbering?: PageNumbering;
  decor?: PageDecor;
  lineNumbering?: LineNumbering;
  shots: Shot[];
};

/** The positional argument list of buildOdt/buildDocx; `undefined` takes the default. */
export function exportArgs(s: Showcase): unknown[] {
  return [s.doc, s.margins, s.orientation, s.hf, s.language, s.pageFormat, s.styles, undefined, undefined,
    false, s.notes, s.props, s.hyphenate ?? false, s.pageNumbering, s.decor, s.lineNumbering];
}
