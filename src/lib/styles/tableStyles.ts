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

const boxList = (name: string, header: string, band: string, text = '#FFFFFF'): TableStyle => ({
  name, builtin: true, border: 'none', innerBorder: 'none',
  regions: {
    headerRow: { fill: header, text: { bold: true, color: text } },
    bandedRow: { fill: band },
  },
});

export const TABLE_BUILTINS: TableStyle[] = [
  { name: 'Simple Grid', builtin: true, border: null, innerBorder: null,
    regions: { headerRow: { fill: HEADER_FILL, text: { bold: true } } } },
  { name: 'Simple Grid Rows', builtin: true, border: null, innerBorderH: null, innerBorderV: 'none',
    regions: { headerRow: { fill: HEADER_FILL, text: { bold: true } } } },
  { name: 'Simple Grid Columns', builtin: true, border: null, innerBorderH: 'none', innerBorderV: null,
    regions: { headerRow: { fill: HEADER_FILL, text: { bold: true } } } },
  { name: 'Simple List Shaded', builtin: true, border: null, innerBorder: 'none',
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedRow: { fill: BAND_FILL },
    } },
  { name: 'Simple List Columns', builtin: true, border: null, innerBorder: 'none',
    regions: {
      headerRow: { fill: HEADER_FILL, text: { bold: true } },
      bandedColumn: { fill: BAND_FILL },
    } },
  boxList('Box List Blue', '#4A7EBB', '#DCE6F1'),
  boxList('Box List Green', '#77933C', '#EBF1DE'),
  boxList('Box List Red', '#C0504D', '#F2DCDB'),
  boxList('Box List Yellow', '#E6B800', '#FFF2CC', '#000000'),
  { name: 'Grid Table Accent', builtin: true, border: `0.5pt solid #8EAADB`, innerBorder: '0.5pt solid #8EAADB',
    regions: {
      headerRow: { fill: ACCENT, text: { bold: true, color: '#FFFFFF' } },
      bandedRow: { fill: ACCENT_LIGHT },
    } },
  { name: 'List Table Accent', builtin: true, border: 'none', innerBorderH: null, innerBorderV: 'none',
    regions: {
      headerRow: { text: { bold: true, color: ACCENT }, borders: { bottom: `1pt solid ${ACCENT}` } },
      bandedRow: { fill: ACCENT_LIGHT },
    } },
  { name: 'Academic', builtin: true, border: 'none', innerBorder: 'none',
    regions: {
      headerRow: { text: { bold: true }, borders: { top: '1pt solid #000000', bottom: '0.75pt solid #000000' } },
      lastRow: { borders: { bottom: '1pt solid #000000' } },
    } },
  { name: 'Financial', builtin: true, border: 'none', innerBorder: 'none',
    regions: {
      headerRow: { text: { bold: true }, borders: { top: '1pt solid #000000', bottom: '0.75pt solid #000000' } },
      firstColumn: { text: { bold: true } },
      lastRow: { text: { bold: true }, borders: { top: '0.75pt solid #000000', bottom: '1pt solid #000000' } },
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
function regionsAt(style: TableStyle, row: number, col: number, rows: number, cols: number): TableRegion[] {
  const r = style.regions;
  const bodyRow = row - (r.headerRow ? 1 : 0);
  const bodyCol = col - (r.firstColumn ? 1 : 0);
  const matches: Record<TableRegion, boolean> = {
    bandedColumn: bodyCol >= 0 && bodyCol % 2 === 1,
    bandedRow: bodyRow >= 0 && bodyRow % 2 === 1,
    lastColumn: col === cols - 1,
    firstColumn: col === 0,
    lastRow: row === rows - 1,
    headerRow: row === 0,
  };
  return TABLE_REGIONS.filter(name => r[name] && matches[name]);
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
export function resolveTableCell(style: TableStyle, cell: CellCoords): ResolvedTableCell {
  const { row, col, rows, cols } = cell;
  const rowEnd = row + (cell.rowSpan ?? 1);
  const colEnd = col + (cell.colSpan ?? 1);
  const at = (r: number, c: number) => regionsAt(style, r, c, rows, cols);
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
export function previewCellCss(style: TableStyle, row: number, col: number, rows: number, cols: number): string {
  const paint = resolveTableCell(style, { row, col, rows, cols });
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
