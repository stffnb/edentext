// Numbering styles for ordered lists (Word/LibreOffice-style). Single source of
// truth shared by:
//   • orderedList.ts        — the `listStyleType` node attr (default 'decimal')
//   • Toolbar.svelte        — the split-button dropdown
//   • editor.css            — on-screen markers via list-style-type / @counter-style
//   • export/odt.ts         — rewrites odf-kit's default L# list styles on export
//
// `decimal` is the default and deliberately maps to odf-kit's own default output
// (style:num-format="1" style:num-suffix="."), so existing documents export
// unchanged and the export rewrite pass is a no-op for them.

export type OrderedListType =
  | 'decimal'      | 'decimal-paren'
  | 'lower-alpha'  | 'lower-alpha-paren'
  | 'upper-alpha'  | 'upper-alpha-paren'
  | 'lower-roman'  | 'lower-roman-paren'
  | 'upper-roman'  | 'upper-roman-paren';

export const DEFAULT_ORDERED_TYPE: OrderedListType = 'decimal';

export interface OrderedTypeDef {
  key: OrderedListType;
  label: string;   // human-readable description for the menu
  preview: string; // a single marker shown in the dropdown, e.g. "1." or "a)"
  numFormat: '1' | 'a' | 'A' | 'i' | 'I'; // ODF style:num-format
  numSuffix: '.' | ')';                    // ODF style:num-suffix
}

// In menu order. Keep aligned with the @counter-style / ol[data-list-style] rules
// in editor.css.
export const ORDERED_LIST_TYPES: OrderedTypeDef[] = [
  { key: 'decimal',           label: '1, 2, 3',       preview: '1.', numFormat: '1', numSuffix: '.' },
  { key: 'decimal-paren',     label: '1), 2), 3)',    preview: '1)', numFormat: '1', numSuffix: ')' },
  { key: 'lower-alpha',       label: 'a, b, c',       preview: 'a.', numFormat: 'a', numSuffix: '.' },
  { key: 'lower-alpha-paren', label: 'a), b), c)',    preview: 'a)', numFormat: 'a', numSuffix: ')' },
  { key: 'upper-alpha',       label: 'A, B, C',       preview: 'A.', numFormat: 'A', numSuffix: '.' },
  { key: 'upper-alpha-paren', label: 'A), B), C)',    preview: 'A)', numFormat: 'A', numSuffix: ')' },
  { key: 'lower-roman',       label: 'i, ii, iii',    preview: 'i.', numFormat: 'i', numSuffix: '.' },
  { key: 'lower-roman-paren', label: 'i), ii), iii)', preview: 'i)', numFormat: 'i', numSuffix: ')' },
  { key: 'upper-roman',       label: 'I, II, III',    preview: 'I.', numFormat: 'I', numSuffix: '.' },
  { key: 'upper-roman-paren', label: 'I), II), III)', preview: 'I)', numFormat: 'I', numSuffix: ')' },
];

const BY_KEY = new Map<string, OrderedTypeDef>(ORDERED_LIST_TYPES.map(t => [t.key, t]));

export function orderedTypeDef(key: string | null | undefined): OrderedTypeDef {
  return BY_KEY.get(key ?? DEFAULT_ORDERED_TYPE) ?? BY_KEY.get(DEFAULT_ORDERED_TYPE)!;
}
