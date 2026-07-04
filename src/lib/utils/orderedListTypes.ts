// Ordered-list numbering styles — single source of truth for orderedList.ts (the
// `listStyleType` attr), Toolbar.svelte, editor.css, and export/odt.ts. `decimal`
// is the default and maps to odf-kit's own output, so the export rewrite skips it.

export type OrderedListType =
  | 'decimal'      | 'decimal-paren'
  | 'lower-alpha'  | 'lower-alpha-paren'
  | 'upper-alpha'  | 'upper-alpha-paren'
  | 'lower-roman'  | 'lower-roman-paren'
  | 'upper-roman'  | 'upper-roman-paren'
  | 'multilevel';

export const DEFAULT_ORDERED_TYPE: OrderedListType = 'decimal';

// Numbering when the attr is null, keyed by 0-based nesting depth (Word's default
// multilevel template: 1. → a. → i., repeating).
export const DEFAULT_ORDERED_CYCLE: OrderedListType[] = ['decimal', 'lower-alpha', 'lower-roman'];

export function defaultOrderedType(depth0: number): OrderedListType {
  return DEFAULT_ORDERED_CYCLE[depth0 % DEFAULT_ORDERED_CYCLE.length];
}

export interface OrderedTypeDef {
  key: OrderedListType;
  label: string;   // human-readable description for the menu
  preview: string; // a single marker shown in the dropdown, e.g. "1." or "a)"
  numFormat: '1' | 'a' | 'A' | 'i' | 'I'; // ODF style:num-format
  numSuffix: '.' | ')';                    // ODF style:num-suffix
  // Legal/outline numbering (1., 1.1., 1.2.1. …): each level shows the parent chain.
  // ODF text:display-levels, DOCX "%1.%2." lvlText, CSS counters() markers.
  multilevel?: boolean;
}

// In menu order. Keep aligned with the @counter-style / ol[data-list-style] rules
// in editor.css.
export const ORDERED_LIST_TYPES: OrderedTypeDef[] = [
  { key: 'decimal',           label: '1, 2, 3',        preview: '1.',   numFormat: '1', numSuffix: '.' },
  { key: 'decimal-paren',     label: '1), 2), 3)',     preview: '1)',   numFormat: '1', numSuffix: ')' },
  { key: 'multilevel',        label: '1, 1.1, 1.2.1',  preview: '1.1.', numFormat: '1', numSuffix: '.', multilevel: true },
  { key: 'lower-alpha',       label: 'a, b, c',        preview: 'a.',   numFormat: 'a', numSuffix: '.' },
  { key: 'lower-alpha-paren', label: 'a), b), c)',     preview: 'a)',   numFormat: 'a', numSuffix: ')' },
  { key: 'upper-alpha',       label: 'A, B, C',        preview: 'A.',   numFormat: 'A', numSuffix: '.' },
  { key: 'upper-alpha-paren', label: 'A), B), C)',     preview: 'A)',   numFormat: 'A', numSuffix: ')' },
  { key: 'lower-roman',       label: 'i, ii, iii',     preview: 'i.',   numFormat: 'i', numSuffix: '.' },
  { key: 'lower-roman-paren', label: 'i), ii), iii)',  preview: 'i)',   numFormat: 'i', numSuffix: ')' },
  { key: 'upper-roman',       label: 'I, II, III',     preview: 'I.',   numFormat: 'I', numSuffix: '.' },
  { key: 'upper-roman-paren', label: 'I), II), III)',  preview: 'I)',   numFormat: 'I', numSuffix: ')' },
];

const BY_KEY = new Map<string, OrderedTypeDef>(ORDERED_LIST_TYPES.map(t => [t.key, t]));

export function orderedTypeDef(key: string | null | undefined): OrderedTypeDef {
  return BY_KEY.get(key ?? DEFAULT_ORDERED_TYPE) ?? BY_KEY.get(DEFAULT_ORDERED_TYPE)!;
}

// The def a list with this attr renders at this 0-based depth (null = depth cycle).
export function effectiveOrderedDef(key: string | null | undefined, depth0: number): OrderedTypeDef {
  return orderedTypeDef(key ?? defaultOrderedType(depth0));
}

// Attr helper: null when the key equals the depth default, so round trips don't
// accrete explicit attrs. Callers inside a multilevel chain skip this — there the
// chain itself is the default, so an explicit key must stay explicit.
export function orderedTypeAttr(key: OrderedListType, depth0: number): OrderedListType | null {
  return key === defaultOrderedType(depth0) ? null : key;
}

function toRoman(n: number): string {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let s = '';
  for (const [v, sym] of map) while (n >= v) { s += sym; n -= v; }
  return s;
}

function toAlpha(n: number): string {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

// The ordinal body an item renders for a num-format char (no suffix): 3/'a' → "c".
export function formatOrdinal(n: number, numFormat: OrderedTypeDef['numFormat']): string {
  switch (numFormat) {
    case 'a': return toAlpha(n);
    case 'A': return toAlpha(n).toUpperCase();
    case 'i': return toRoman(n);
    case 'I': return toRoman(n).toUpperCase();
    default: return String(n);
  }
}

// Reverse lookup for the ODT importer: ODF numbering attrs → listStyleType key.
// Unknown formats (e.g. figure numbering) fall back to decimal.
export function orderedTypeFromFormat(numFormat: string | null, numSuffix: string | null): OrderedListType {
  const match = ORDERED_LIST_TYPES.find(t => !t.multilevel && t.numFormat === numFormat && t.numSuffix === (numSuffix ?? '.'));
  return match?.key ?? DEFAULT_ORDERED_TYPE;
}
