// The number format a table cell prints its value in (LibreOffice's Table ▸ Number
// Format, Word's `\#` field switch). The set is the common head of both dialogs'
// lists — numbers, percentages, the locale's currency and its short date.

import { formatCellNumber, type NumberLocale } from './tableFormula';

export type CellFormat =
  'general' | 'int' | 'dec2' | 'group2' | 'percent' | 'percent2' | 'currency' | 'date';

export const CELL_FORMATS: CellFormat[] =
  ['general', 'int', 'dec2', 'group2', 'percent', 'percent2', 'currency', 'date'];

// Word's picture for the formats whose code is the same everywhere; the currency and
// date ones are the locale's, built below.
const FIXED_CODES: Record<string, string> = {
  general: '', int: '0', dec2: '0.00', group2: '#,##0.00', percent: '0%', percent2: '0.00%',
};

/** Word's picture switch for a format, as its own dialog writes it. */
export function cellFormatCode(format: CellFormat, lang: string): string {
  if (format === 'currency') {
    const { symbol, before, space } = currencyParts(lang);
    return before ? `${symbol}${space}#,##0.00` : `#,##0.00${space}${symbol}`;
  }
  if (format === 'date') {
    return datePattern(lang)
      .map((f) => (f.kind === 'literal' ? f.text : f.kind[0].replace('m', 'M').repeat(f.digits)))
      .join('');
  }
  return FIXED_CODES[format] ?? '';
}

export function cellFormatFromCode(code: string): CellFormat | null {
  const key = code.trim();
  const fixed = CELL_FORMATS.find((f) => FIXED_CODES[f] === key);
  if (fixed) return fixed;
  if (!/[#0]/.test(key) && /[yMd]/.test(key)) return 'date';
  return /[^#0.,;()%\s+-]/.test(key) ? 'currency' : null;
}

export function isCellFormat(v: unknown): v is CellFormat {
  return typeof v === 'string' && (CELL_FORMATS as string[]).includes(v);
}

/** The shape of one format, which is all both file formats record about it. */
export type FormatKind = 'number' | 'percent' | 'currency' | 'date';
export type FormatSpec = { decimals: number; grouping: boolean; kind: FormatKind };

export const CELL_FORMAT_SPECS: Record<CellFormat, FormatSpec> = {
  general: { decimals: 0, grouping: false, kind: 'number' },
  int: { decimals: 0, grouping: false, kind: 'number' },
  dec2: { decimals: 2, grouping: false, kind: 'number' },
  group2: { decimals: 2, grouping: true, kind: 'number' },
  percent: { decimals: 0, grouping: false, kind: 'percent' },
  percent2: { decimals: 2, grouping: false, kind: 'percent' },
  currency: { decimals: 2, grouping: true, kind: 'currency' },
  date: { decimals: 0, grouping: false, kind: 'date' },
};

/** A file's number style read back as the nearest format we offer. */
export function cellFormatFromSpec(spec: FormatSpec): CellFormat {
  if (spec.kind === 'currency' || spec.kind === 'date') return spec.kind;
  if (spec.kind === 'percent') return spec.decimals >= 2 ? 'percent2' : 'percent';
  if (spec.grouping) return 'group2';
  if (spec.decimals >= 2) return 'dec2';
  return 'int';
}

// The currency a language spends, as LibreOffice takes it from the document's own
// language. The bundled dictionaries are en-US and de-DE; a neighbour keeps its own.
const CURRENCY_BY_REGION: Record<string, string> = {
  US: 'USD', DE: 'EUR', AT: 'EUR', FR: 'EUR', GB: 'GBP', CH: 'CHF',
};

export function localeCurrency(lang: string): string {
  const region = new Intl.Locale(lang || 'en').maximize().region ?? 'US';
  return CURRENCY_BY_REGION[region] ?? 'USD';
}

/** Where the locale puts its currency symbol, read off Intl rather than a table. */
export function currencyParts(lang: string): { symbol: string; before: boolean; space: string } {
  const parts = new Intl.NumberFormat(lang || 'en', { style: 'currency', currency: localeCurrency(lang) })
    .formatToParts(1234.5);
  const at = parts.findIndex((p) => p.type === 'currency');
  const num = parts.findIndex((p) => p.type === 'integer');
  const gap = parts[at < num ? at + 1 : at - 1];
  return {
    symbol: parts[at]?.value ?? '¤',
    before: at < num,
    space: gap?.type === 'literal' ? gap.value : '',
  };
}

export type DateField =
  | { kind: 'literal'; text: string }
  | { kind: 'day' | 'month' | 'year'; digits: number };

/** The locale's short date as its fields, from Intl: the order, padding and separators. */
export function datePattern(lang: string): DateField[] {
  const ref = new Date(Date.UTC(2023, 2, 5)); // single-digit day and month → is it padded?
  return new Intl.DateTimeFormat(lang || 'en', { dateStyle: 'short', timeZone: 'UTC' })
    .formatToParts(ref)
    .map((p): DateField => (p.type === 'day' || p.type === 'month' || p.type === 'year'
      ? { kind: p.type, digits: p.value.length }
      : { kind: 'literal', text: p.value }));
}

// A cell's number as a date: LibreOffice's own day 0 is 1899-12-30 (probed — serial
// 45000 renders as 15.03.2023). Out of the calendar's range it stays a number.
const DATE_EPOCH = Date.UTC(1899, 11, 30);

export function serialToDate(n: number): Date | null {
  const d = new Date(DATE_EPOCH + Math.round(n) * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A value printed in its cell's format. `general` is the editor's own rendering —
 * no grouping, the locale's decimal separator, the float noise rounded off.
 */
export function formatCellValue(n: number, format: CellFormat, loc: NumberLocale, lang: string): string {
  if (!Number.isFinite(n)) return '';
  if (format === 'general') return formatCellNumber(n, loc);
  const spec = CELL_FORMAT_SPECS[format];
  if (spec.kind === 'date') {
    const date = serialToDate(n);
    if (!date) return formatCellNumber(n, loc);
    return new Intl.DateTimeFormat(lang || 'en', { dateStyle: 'short', timeZone: 'UTC' }).format(date);
  }
  const value = spec.kind === 'percent' ? n * 100 : n;
  const body = new Intl.NumberFormat(lang || 'en', {
    style: spec.kind === 'currency' ? 'currency' : 'decimal',
    currency: spec.kind === 'currency' ? localeCurrency(lang) : undefined,
    minimumFractionDigits: spec.decimals,
    maximumFractionDigits: spec.decimals,
    useGrouping: spec.grouping,
  }).format(value);
  return spec.kind === 'percent' ? `${body}%` : body;
}
