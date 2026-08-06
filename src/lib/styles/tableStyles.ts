// Table styles, the third named-style family — Word's table styles / LibreOffice's table
// AutoFormats. A style paints conditional regions (header row, banded rows, first column,
// …); resolveTableCell is the single source of truth for applying, CSS, export and import.

import { textDeclarations, type TextProps } from './styleSheet';

// Ascending precedence, as in Word: a later region's properties win over an earlier one's.
// `wholeTable` is the base rather than a conditional region, so it is layered first and
// never listed in a cell's `region` attr.
export const TABLE_REGIONS = [
  'bandedColumn', 'bandedRow', 'lastColumn', 'firstColumn', 'lastRow', 'headerRow',
] as const;
export type TableRegion = (typeof TABLE_REGIONS)[number];

// Word's "Table Style Options": which conditional regions a given table opts into. A
// region paints only when the style defines it AND the table's look enables it, so the
// same style reads differently per table (and the gallery previews follow the toggles).
export type TableLook = Record<TableRegion, boolean>;

// Word's default for a new table (its w:tblLook 04A0): header row, first column, bands.
export const DEFAULT_TABLE_LOOK: TableLook = {
  headerRow: true, firstColumn: true, bandedRow: true,
  lastRow: false, lastColumn: false, bandedColumn: false,
};

const isRegion = (v: string): v is TableRegion => (TABLE_REGIONS as readonly string[]).includes(v);

// Stored space-separated on the table node, like a cell's `region` list. An absent attr
// means the Word default, so a table predating the toggles keeps looking the same.
export function parseTableLook(attr: unknown): TableLook {
  if (typeof attr !== 'string') return { ...DEFAULT_TABLE_LOOK };
  const on = new Set(attr.split(' ').filter(isRegion));
  return Object.fromEntries(TABLE_REGIONS.map(r => [r, on.has(r)])) as TableLook;
}

export function tableLookAttr(look: TableLook): string {
  return TABLE_REGIONS.filter(r => look[r]).join(' ');
}

export type BorderSideKey = 'top' | 'right' | 'bottom' | 'left';

export type TableRegionProps = {
  // null = explicitly no fill; undefined = inherit from the lower-precedence region.
  fill?: string | null;
  text?: TextProps;
  // Border overrides for the region's own sides, e.g. a rule under the header row.
  borders?: Partial<Record<BorderSideKey, string | null>>;
};

// Border values follow the cell attrs (tableCellBorders.ts): null = the table default
// 0.5pt black, 'none' = no border, else the canonical '<W>pt solid #RRGGBB'.
export type TableStyle = {
  name: string;
  builtin?: boolean;
  // The Table Style Options this style is about, applied on assignment over whatever the
  // table already had. Defining all six areas keeps every toggle meaningful, so without
  // this a row-banded and a column-banded style would be indistinguishable.
  look?: Partial<TableLook>;
  border?: string | null;       // the table's outer edges
  innerBorder?: string | null;  // the grid lines inside it
  innerBorderH?: string | null; // horizontal inner lines only (falls back to innerBorder)
  innerBorderV?: string | null; // vertical inner lines only
  wholeTable?: TableRegionProps;
  regions: Partial<Record<TableRegion, TableRegionProps>>;
};

// The families Word and LibreOffice ship: plain grids, shaded lists, the coloured box
// lists, Word's accent tables, and the rule-only academic/financial pair. Colours follow
// the Office theme accents; a yellow header keeps black text to stay readable.
const HEADER_FILL = '#F2F2F2';
const BAND_FILL = '#F7F7F7';
const ACCENT = '#4472C4';
const ACCENT_LIGHT = '#D9E2F3';
const ACCENT_MID = '#B4C6E7';

// Every built-in defines all six conditional areas, so each Table-Style-Option toggle
// visibly does something (as in Word).
const boxList = (name: string, header: string, band: string, mid: string, text = '#FFFFFF'): TableStyle => ({
  name, builtin: true, border: 'none', innerBorder: 'none',
  regions: {
    headerRow: { fill: header, text: { bold: true, color: text } },
    bandedRow: { fill: band },
    bandedColumn: { fill: band },
    // The colourful families shade their emphasis areas as well, so switching one on
    // is as visible as the header row (Word's Grid Table families do the same).
    firstColumn: { fill: mid, text: { bold: true } },
    lastColumn: { fill: mid, text: { bold: true } },
    lastRow: { fill: mid, text: { bold: true }, borders: { top: `1pt solid ${header}` } },
  },
});

// The grey and rule-based families keep emphasis text-only, as in Word.
const emphasis = { text: { bold: true } };
const greyEdges = {
  firstColumn: emphasis,
  lastColumn: emphasis,
  lastRow: { ...emphasis, borders: { top: '1pt solid #000000' } },
};

export const TABLE_BUILTINS: TableStyle[] = [
  { name: 'Simple Grid', builtin: true, border: null, innerBorder: null,
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
      ...greyEdges,
    } },
  { name: 'Simple Grid Rows', builtin: true, border: null, innerBorderH: null, innerBorderV: 'none',
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
      ...greyEdges,
    } },
  { name: 'Simple Grid Columns', builtin: true, border: null, innerBorderH: 'none', innerBorderV: null,
    look: { bandedRow: false, bandedColumn: true },
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
      ...greyEdges,
    } },
  { name: 'Simple List Shaded', builtin: true, border: null, innerBorder: 'none',
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
      ...greyEdges,
    } },
  { name: 'Simple List Columns', builtin: true, border: null, innerBorder: 'none',
    look: { bandedRow: false, bandedColumn: true },
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedColumn: { fill: BAND_FILL }, bandedRow: { fill: BAND_FILL },
      ...greyEdges,
    } },
  // Word's "Plain Table": no lines at all, emphasis by weight only.
  { name: 'Plain Table', builtin: true, border: 'none', innerBorder: 'none',
    regions: {
      headerRow: { text: { bold: true }, borders: { bottom: '0.75pt solid #000000' } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
      ...greyEdges,
    } },
  boxList('Box List Blue', '#4A7EBB', '#DCE6F1', '#B8CCE4'),
  boxList('Box List Green', '#77933C', '#EBF1DE', '#D6E3BC'),
  boxList('Box List Red', '#C0504D', '#F2DCDB', '#E5B8B7'),
  boxList('Box List Yellow', '#E6B800', '#FFF2CC', '#FFE699', '#000000'),
  { name: 'Grid Table Accent', builtin: true, border: `0.5pt solid #8EAADB`, innerBorder: '0.5pt solid #8EAADB',
    regions: {
      headerRow: { fill: ACCENT, text: { bold: true, color: '#FFFFFF' } },
      bandedRow: { fill: ACCENT_LIGHT }, bandedColumn: { fill: ACCENT_LIGHT },
      firstColumn: { fill: ACCENT_MID, text: { bold: true } },
      lastColumn: { fill: ACCENT_MID, text: { bold: true } },
      lastRow: { fill: ACCENT_MID, text: { bold: true }, borders: { top: `1pt solid ${ACCENT}` } },
    } },
  { name: 'List Table Accent', builtin: true, border: 'none', innerBorderH: null, innerBorderV: 'none',
    regions: {
      headerRow: { text: { bold: true, color: ACCENT }, borders: { bottom: `1pt solid ${ACCENT}` } },
      bandedRow: { fill: ACCENT_LIGHT }, bandedColumn: { fill: ACCENT_LIGHT },
      firstColumn: { fill: ACCENT_MID, text: { bold: true } },
      lastColumn: { fill: ACCENT_MID, text: { bold: true } },
      lastRow: { fill: ACCENT_MID, text: { bold: true }, borders: { top: `1pt solid ${ACCENT}` } },
    } },
  { name: 'Academic', builtin: true, border: 'none', innerBorder: 'none',
    look: { bandedRow: false, bandedColumn: false, firstColumn: false },
    regions: {
      headerRow: { text: { bold: true }, borders: { top: '1pt solid #000000', bottom: '0.75pt solid #000000' } },
      lastRow: { borders: { bottom: '1pt solid #000000' } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
      firstColumn: emphasis, lastColumn: emphasis,
    } },
  { name: 'Financial', builtin: true, border: 'none', innerBorder: 'none',
    look: { lastRow: true, bandedRow: false, bandedColumn: false },
    regions: {
      headerRow: { text: { bold: true }, borders: { top: '1pt solid #000000', bottom: '0.75pt solid #000000' } },
      firstColumn: emphasis, lastColumn: emphasis,
      lastRow: { ...emphasis, borders: { top: '0.75pt solid #000000', bottom: '1pt solid #000000' } },
      bandedRow: { fill: BAND_FILL }, bandedColumn: { fill: BAND_FILL },
    } },
];

export function builtinTableStyles(): Record<string, TableStyle> {
  const out: Record<string, TableStyle> = {};
  for (const s of TABLE_BUILTINS) out[s.name] = structuredClone(s);
  return out;
}

export type CellCoords = {
  row: number; col: number;
  rowSpan?: number; colSpan?: number;
  rows: number; cols: number;
};

export type ResolvedTableCell = {
  regions: TableRegion[];
  fill: string | null;
  text: TextProps;
  borders: Record<'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft', string | null>;
};

// The conditional regions a grid position belongs to, in ascending precedence. Banding
// counts body rows only, so a header row doesn't shift the stripes (as in Word).
function regionsAt(
  style: TableStyle, look: TableLook,
  row: number, col: number, rows: number, cols: number,
): TableRegion[] {
  // A region counts as present only when the style paints it and the table opts in —
  // that also decides whether banding skips the header row / first column.
  const on = (name: TableRegion) => !!style.regions[name] && look[name];
  const bodyRow = row - (on('headerRow') ? 1 : 0);
  const bodyCol = col - (on('firstColumn') ? 1 : 0);
  const matches: Record<TableRegion, boolean> = {
    bandedColumn: bodyCol >= 0 && bodyCol % 2 === 1,
    bandedRow: bodyRow >= 0 && bodyRow % 2 === 1,
    lastColumn: col === cols - 1,
    firstColumn: col === 0,
    lastRow: row === rows - 1,
    headerRow: row === 0,
  };
  return TABLE_REGIONS.filter(name => on(name) && matches[name]);
}

// The border of one grid line, decided from both sides so the two facing cells always
// agree (collapsed borders must not disagree — see setTableBorders).
function boundary(
  style: TableStyle,
  before: TableRegion[] | null,
  after: TableRegion[] | null,
  beforeSide: BorderSideKey,
  afterSide: BorderSideKey,
): string | null {
  const horizontal = beforeSide === 'bottom';
  let value = before === null || after === null
    ? style.border
    : (horizontal ? style.innerBorderH : style.innerBorderV) ?? style.innerBorder;
  if (value === undefined) value = null;
  const layer = (regions: TableRegion[] | null, side: BorderSideKey) => {
    if (!regions) return;
    for (const name of regions) {
      const v = style.regions[name]?.borders?.[side];
      if (v !== undefined) value = v;
    }
  };
  layer(before, beforeSide);
  layer(after, afterSide);
  return value;
}

// Everything a table style paints on one cell. Fill and borders are materialized as cell
// attrs (so export/PDF/clipboard need no extra work); `text` is rendered via CSS keyed on
// the `region` attr and baked onto the runs on export.
export function resolveTableCell(
  style: TableStyle, cell: CellCoords, look: TableLook = DEFAULT_TABLE_LOOK,
): ResolvedTableCell {
  const { row, col, rows, cols } = cell;
  const rowEnd = row + (cell.rowSpan ?? 1);
  const colEnd = col + (cell.colSpan ?? 1);
  const at = (r: number, c: number) => regionsAt(style, look, r, c, rows, cols);
  const regions = at(row, col);

  let fill: string | null = style.wholeTable?.fill ?? null;
  const text: TextProps = { ...style.wholeTable?.text };
  for (const name of regions) {
    const props = style.regions[name];
    if (!props) continue;
    if (props.fill !== undefined) fill = props.fill;
    for (const [key, v] of Object.entries(props.text ?? {})) {
      if (v !== undefined) (text as Record<string, unknown>)[key] = v;
    }
  }

  return {
    regions,
    fill,
    text,
    borders: {
      borderTop: boundary(style, row > 0 ? at(row - 1, col) : null, regions, 'bottom', 'top'),
      borderBottom: boundary(style, at(rowEnd - 1, col), rowEnd < rows ? at(rowEnd, col) : null, 'bottom', 'top'),
      borderLeft: boundary(style, col > 0 ? at(row, col - 1) : null, regions, 'right', 'left'),
      borderRight: boundary(style, at(row, colEnd - 1), colEnd < cols ? at(row, colEnd) : null, 'right', 'left'),
    },
  };
}

// The text formatting a cell inherits from its table style, read off the `region` attr
// the paint left on it. Shared by the editor (Bold button) and both exporters.
export function regionText(style: TableStyle | null | undefined, regionAttr: unknown): TextProps {
  if (!style) return {};
  const text: TextProps = { ...style.wholeTable?.text };
  for (const name of String(regionAttr ?? '').split(' ').filter(Boolean)) {
    Object.assign(text, style.regions[name as TableRegion]?.text ?? {});
  }
  return text;
}

// Inline CSS for one cell of a style's preview grid (the toolbar gallery and the style
// manager show the same tile). Widths collapse to 1–2px so a thick rule stays legible;
// the table default border rides on currentColor, so the tile has to carry a page color.
export function previewCellCss(
  style: TableStyle, row: number, col: number, rows: number, cols: number,
  look: TableLook = DEFAULT_TABLE_LOOK,
): string {
  const paint = resolveTableCell(style, { row, col, rows, cols }, look);
  const side = (value: string | null): string => {
    if (value === 'none') return 'none';
    if (value === null) return '1px solid currentColor';
    const m = /^([\d.]+)pt solid (#[0-9A-Fa-f]{6})$/.exec(value);
    if (!m) return 'none';
    return `${parseFloat(m[1]) > 0.75 ? 2 : 1}px solid ${m[2]}`;
  };
  const borders = (['Top', 'Right', 'Bottom', 'Left'] as const)
    .map(s => `border-${s.toLowerCase()}: ${side(paint.borders[`border${s}`])}`)
    .join(';');
  return `background: ${paint.fill ?? 'transparent'};${borders};font-weight: ${paint.text.bold ? 700 : 400}`;
}

// The options a style is applied with: its own declared ones over the table's current.
export function styleLook(style: TableStyle | undefined, table: TableLook): TableLook {
  return { ...table, ...style?.look };
}

// The text bar inside a preview cell: a schematic line whose weight and colour follow
// the region, so bold-only areas (first/last column, total row) are visible in a tile —
// they would otherwise look identical, the tiles carrying no real text.
export function previewTextCss(
  style: TableStyle, row: number, col: number, rows: number, cols: number,
  look: TableLook = DEFAULT_TABLE_LOOK,
): string {
  const { text } = resolveTableCell(style, { row, col, rows, cols }, look);
  const bold = text.bold === true;
  return `height: ${bold ? 2 : 1}px; background: ${text.color ?? 'currentColor'};`
    + `opacity: ${bold ? 0.85 : 0.45};`
    // A slant for italic, so an italic-only region is visible too.
    + `transform: ${text.italic ? 'skewX(-14deg)' : 'none'}`;
}

// One rule per style and region, emitted in ascending precedence so an overlap (header
// row ∩ first column) resolves by source order. The descendant selector is required: the
// Standard paragraph rule would otherwise beat a plain cell rule on font/size/color.
export function tableStyleCss(styles: Record<string, TableStyle>): string {
  const rules: string[] = [];
  for (const style of Object.values(styles ?? {})) {
    const table = `.paper .tiptap table[data-table-style="${style.name.replace(/"/g, '\\"')}"]`;
    const emit = (cellSel: string, text: TextProps | undefined) => {
      const decls = textDeclarations(text ?? {});
      if (!decls.length) return;
      const selectors = [`${table} ${cellSel}`, `${table} ${cellSel} :is(p,h1,h2,h3,h4,h5,li)`];
      rules.push(`${selectors.join(',\n')} {\n  ${decls.join(';\n  ')};\n}`);
    };
    emit(':is(td,th)', style.wholeTable?.text);
    for (const name of TABLE_REGIONS) emit(`:is(td,th)[data-region~="${name}"]`, style.regions[name]?.text);
  }
  return rules.join('\n\n');
}
