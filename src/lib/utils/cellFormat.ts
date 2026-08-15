// The number format a table cell prints its value in (LibreOffice's Table ▸ Number
// Format, Word's `\#` field switch). The set is the common head of both dialogs'
// lists — plain numbers and percentages; currency and date formats are not offered.

import { formatCellNumber, type NumberLocale } from './tableFormula';

export type CellFormat = 'general' | 'int' | 'dec2' | 'group2' | 'percent' | 'percent2';

export const CELL_FORMATS: CellFormat[] = ['general', 'int', 'dec2', 'group2', 'percent', 'percent2'];

// Word's picture for each, which is also how the format reads in the two dialogs.
export const CELL_FORMAT_CODES: Record<CellFormat, string> = {
  general: '', int: '0', dec2: '0.00', group2: '#,##0.00', percent: '0%', percent2: '0.00%',
};

export function cellFormatFromCode(code: string): CellFormat | null {
  const key = code.trim();
  return CELL_FORMATS.find((f) => CELL_FORMAT_CODES[f] === key) ?? null;
}

export function isCellFormat(v: unknown): v is CellFormat {
  return typeof v === 'string' && (CELL_FORMATS as string[]).includes(v);
}

/** The shape of one format, which is all both file formats record about it. */
export type FormatSpec = { decimals: number; grouping: boolean; percent: boolean };

export const CELL_FORMAT_SPECS: Record<CellFormat, FormatSpec> = {
  general: { decimals: 0, grouping: false, percent: false },
  int: { decimals: 0, grouping: false, percent: false },
  dec2: { decimals: 2, grouping: false, percent: false },
  group2: { decimals: 2, grouping: true, percent: false },
  percent: { decimals: 0, grouping: false, percent: true },
  percent2: { decimals: 2, grouping: false, percent: true },
};

/** A file's number style read back as the nearest format we offer. */
export function cellFormatFromSpec(spec: FormatSpec): CellFormat {
  if (spec.percent) return spec.decimals >= 2 ? 'percent2' : 'percent';
  if (spec.grouping) return 'group2';
  if (spec.decimals >= 2) return 'dec2';
  return 'int';
}

/**
 * A value printed in its cell's format. `general` is the editor's own rendering —
 * no grouping, the locale's decimal separator, the float noise rounded off.
 */
export function formatCellValue(n: number, format: CellFormat, loc: NumberLocale, lang: string): string {
  if (!Number.isFinite(n)) return '';
  if (format === 'general') return formatCellNumber(n, loc);
  const spec = CELL_FORMAT_SPECS[format];
  const value = spec.percent ? n * 100 : n;
  const body = new Intl.NumberFormat(lang || 'en', {
    minimumFractionDigits: spec.decimals,
    maximumFractionDigits: spec.decimals,
    useGrouping: spec.grouping,
  }).format(value);
  return spec.percent ? `${body}%` : body;
}
