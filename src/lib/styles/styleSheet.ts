// Named styles with inheritance, modelled on LibreOffice: a name, a parent, a follow-on
// style and two property groups. Resolution walks the parent chain (nearer wins); direct
// formatting on the block or run still overrides the result.

import { builtinTableStyles, tableStyleCss, type TableStyle } from './tableStyles';

export type ParaProps = {
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: string;
  spaceBefore?: number; // pt
  spaceAfter?: number;  // pt
  indent?: number;      // cm
  backgroundColor?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
};

export type TextProps = {
  fontFamily?: string;
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
};

export type Style = {
  name: string;
  parent: string | null;
  // Style applied to the paragraph created by Enter at its end (ODF next-style-name,
  // DOCX w:next). Not honored yet — stored so it round-trips.
  next: string | null;
  // 1–5 makes it a heading style: assigning it switches the node type (ODF outline level).
  outlineLevel?: number;
  builtin?: boolean;
  para: ParaProps;
  text: TextProps;
};

// Three families, as in LibreOffice/Word: paragraph styles govern whole blocks, character
// styles a run of text inside one (same Style shape; a character style only uses `text`),
// table styles a whole table (their own shape, no inheritance — see tableStyles.ts).
export type StyleFamily = 'paragraph' | 'character' | 'table';
export type StyleSheet = {
  paragraph: Record<string, Style>;
  character: Record<string, Style>;
  table: Record<string, TableStyle>;
};

export const DEFAULT_STYLE = 'Standard';
export const HEADING_PARENT = 'Heading';

// LibreOffice's defaults. Heading sizes/margins mirror HEADING_STYLE_OVERRIDES in
// export/odt.ts, which still drives the ODF/DOCX side (tests/unit/style-resolve.test.ts
// asserts the two agree).
const BUILTINS: Style[] = [
  { name: DEFAULT_STYLE, parent: null, next: null, builtin: true,
    para: { spaceBefore: 0, spaceAfter: 0 }, text: { fontFamily: 'Liberation Serif', fontSizePt: 12 } },
  { name: HEADING_PARENT, parent: DEFAULT_STYLE, next: DEFAULT_STYLE, builtin: true,
    para: { spaceBefore: 12, spaceAfter: 6 }, text: { fontFamily: 'Liberation Sans', bold: true } },
  ...[18, 16, 14, 13, 12].map((size, i) => ({
    name: `Heading ${i + 1}`, parent: HEADING_PARENT, next: DEFAULT_STYLE,
    outlineLevel: i + 1, builtin: true,
    para: {}, text: { fontSizePt: size },
  })),
  { name: 'Title', parent: HEADING_PARENT, next: DEFAULT_STYLE, builtin: true,
    para: { textAlign: 'center' }, text: { fontSizePt: 28 } },
  { name: 'Subtitle', parent: HEADING_PARENT, next: DEFAULT_STYLE, builtin: true,
    para: { textAlign: 'center' }, text: { fontSizePt: 18 } },
  { name: 'Quotations', parent: DEFAULT_STYLE, next: DEFAULT_STYLE, builtin: true,
    para: { indent: 1, spaceAfter: 14 }, text: {} },
];

// LibreOffice's character styles (its "Emphasis"/"Strong Emphasis"/"Source Text").
const CHAR_BUILTINS: Style[] = [
  { name: 'Emphasis', parent: null, next: null, builtin: true, para: {}, text: { italic: true } },
  { name: 'Strong Emphasis', parent: null, next: null, builtin: true, para: {}, text: { bold: true } },
  { name: 'Source Text', parent: null, next: null, builtin: true, para: {}, text: { fontFamily: 'Courier New' } },
];

// Bumped whenever the built-in definitions change: a stored sheet from an older version
// keeps its user styles but takes the new factory built-ins (see mergeStoredSheet).
export const STYLE_SHEET_VERSION = 7;

// A persisted sheet merged onto the current built-ins. Same version: stored entries win
// (a document's own styles, and edits to built-ins). Older: only user styles survive.
export function mergeStoredSheet(stored: unknown): StyleSheet {
  const sheet = builtinStyleSheet();
  const data = stored as
    | { v?: number; paragraph?: Record<string, Style>; character?: Record<string, Style>; table?: Record<string, TableStyle> }
    | null;
  if (!data?.paragraph || typeof data.paragraph !== 'object') return sheet;
  const current = data.v === STYLE_SHEET_VERSION;
  for (const family of ['paragraph', 'character'] as const) {
    for (const [name, style] of Object.entries(data[family] ?? {})) {
      if (!style || typeof style !== 'object') continue;
      if (!current && style.builtin) continue;
      sheet[family][name] = style;
    }
  }
  // Table styles have their own shape, so they merge separately.
  for (const [name, style] of Object.entries(data.table ?? {})) {
    if (!style || typeof style !== 'object') continue;
    if (!current && style.builtin) continue;
    sheet.table[name] = style;
  }
  return sheet;
}

export function builtinStyleSheet(): StyleSheet {
  const paragraph: Record<string, Style> = {};
  for (const s of BUILTINS) paragraph[s.name] = structuredClone(s);
  const character: Record<string, Style> = {};
  for (const s of CHAR_BUILTINS) character[s.name] = structuredClone(s);
  return { paragraph, character, table: builtinTableStyles() };
}

// Inheritance order: every style directly followed by its own children, so the manager's
// indent matches the tree. Siblings sort built-ins first (as listed above), then by name.
// `Heading` is an abstract parent (LibreOffice's, holding what all levels share) — never
// assignable, so the gallery hides it (its children stay); the manager passes withAbstract.
export function styleOrder(sheet: StyleSheet, withAbstract = false, family: StyleFamily = 'paragraph'): Style[] {
  if (family === 'table') return []; // table styles have no inheritance — listed flat
  const styles = family === 'character' ? sheet.character : sheet.paragraph;
  const rank = new Map((family === 'character' ? CHAR_BUILTINS : BUILTINS).map((b, i) => [b.name, i]));
  const order = (a: string, b: string) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9) || a.localeCompare(b);
  // A style whose parent is missing from the sheet hangs at the root.
  const parentOf = (n: string) => (styles[n].parent && styles[styles[n].parent!] ? styles[n].parent : null);
  const out: Style[] = [];
  const seen = new Set<string>();
  const emit = (parent: string | null) => {
    for (const name of Object.keys(styles).filter(n => parentOf(n) === parent).sort(order)) {
      if (seen.has(name)) continue;
      seen.add(name);
      if (withAbstract || name !== HEADING_PARENT) out.push(styles[name]);
      emit(name);
    }
  };
  emit(null);
  // A parent cycle reaches no root; list its members anyway.
  for (const name of Object.keys(styles).sort(order)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(styles[name]);
    emit(name);
  }
  return out;
}

// Styles that exist only to be inherited from.
export function isAbstractStyle(name: string): boolean {
  return name === HEADING_PARENT;
}

export function headingStyleName(level: number): string {
  return `Heading ${level}`;
}

export type ResolvedStyle = { para: ParaProps; text: TextProps };

// Flattened props of a style: the parent chain applied root-first, so the nearest
// definition wins. Cycles and missing parents end the walk.
export function resolveStyle(sheet: StyleSheet, name: string | null | undefined, family: StyleFamily = 'paragraph'): ResolvedStyle {
  const styles = family === 'character' ? sheet.character : sheet.paragraph;
  const chain: Style[] = [];
  const seen = new Set<string>();
  // A character style with no definition contributes nothing; a paragraph always has Standard.
  let cur = name && styles[name] ? name : family === 'character' ? '' : DEFAULT_STYLE;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const style = styles[cur];
    if (!style) break;
    chain.push(style);
    cur = style.parent ?? '';
  }
  const out: ResolvedStyle = { para: {}, text: {} };
  // Only defined values layer: a key present as undefined means "not set here", so it
  // must not wipe what the parent provides.
  const layer = <T extends object>(target: T, source: T) => {
    for (const key of Object.keys(source) as (keyof T)[]) {
      if (source[key] !== undefined) target[key] = source[key];
    }
  };
  for (const style of chain.reverse()) {
    layer(out.para, style.para);
    layer(out.text, style.text);
  }
  return out;
}

// The bundled fonts are exposed as CSS variables; anything else renders by name.
function cssFontFamily(name: string): string {
  if (name === 'Liberation Serif') return 'var(--font-serif)';
  if (name === 'Liberation Sans' || name === 'Arial') return 'var(--font-heading)';
  return `'${name.replace(/'/g, "\\'")}', var(--font-serif)`;
}

// Single spacing is the font's *natural* line height, so it differs per family.
// editor.css covers Liberation Serif's 1.15; only the bundled families that deviate
// are listed, measured against LibreOffice at 12pt.
const SINGLE_LINE_HEIGHT: Record<string, number> = {
  Calibri: 1.2208,
  Carlito: 1.2208,
  'Courier New': 1.1333,
  'Liberation Mono': 1.1333,
};

// The text half of a rule, shared with the table-style family (tableStyles.ts).
export function textDeclarations(t: TextProps): string[] {
  const out: string[] = [];
  if (t.fontFamily) {
    out.push(`font-family: ${cssFontFamily(t.fontFamily)}`);
    const lh = SINGLE_LINE_HEIGHT[t.fontFamily];
    // An explicit line spacing is emitted after this and wins.
    if (lh) out.push(`line-height: ${lh}`);
  }
  if (t.fontSizePt != null) out.push(`font-size: ${t.fontSizePt}pt`);
  if (t.bold != null) out.push(`font-weight: ${t.bold ? 700 : 400}`);
  if (t.italic != null) out.push(`font-style: ${t.italic ? 'italic' : 'normal'}`);
  if (t.underline || t.strike) {
    out.push(`text-decoration: ${[t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ')}`);
  }
  if (t.color) out.push(`color: ${t.color}`);
  return out;
}

function declarations(r: ResolvedStyle): string[] {
  const { para: p } = r;
  const out = textDeclarations(r.text);
  if (p.textAlign) out.push(`text-align: ${p.textAlign}`);
  if (p.lineHeight) out.push(`line-height: ${p.lineHeight}`);
  if (p.spaceBefore != null) out.push(`margin-top: ${p.spaceBefore}pt`);
  if (p.spaceAfter != null) out.push(`margin-bottom: ${p.spaceAfter}pt`);
  if (p.indent != null) out.push(`margin-left: ${p.indent}cm`);
  if (p.backgroundColor) out.push(`background-color: ${p.backgroundColor}`);
  for (const [key, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const v = p[key];
    if (v && v !== 'none') out.push(`border-${side}: ${v}`);
  }
  return out;
}

// The document stylesheet: one rule per style, keyed by the block's data-style attr,
// plus per-level fallbacks for headings that carry no style name (imported documents).
// Specificity beats editor.css's `.paper .tiptap hN`; inline attrs/marks still win.
export function styleCss(sheet: StyleSheet): string {
  const rules: string[] = [];
  for (const style of Object.values(sheet.character ?? {})) {
    const decls = declarations(resolveStyle(sheet, style.name, 'character'));
    if (!decls.length) continue;
    const attr = `[data-char-style="${style.name.replace(/"/g, '\\"')}"]`;
    rules.push(`.paper .tiptap ${attr} {\n  ${decls.join(';\n  ')};\n}`);
  }
  for (const style of Object.values(sheet.paragraph)) {
    const decls = declarations(resolveStyle(sheet, style.name));
    if (!decls.length) continue;
    const attr = `[data-style="${style.name.replace(/"/g, '\\"')}"]`;
    const selectors = [`.paper .tiptap ${attr}`];
    if (style.outlineLevel) selectors.push(`.paper .tiptap h${style.outlineLevel}:not([data-style])`);
    if (style.name === DEFAULT_STYLE) selectors.push('.paper .tiptap p:not([data-style])');
    rules.push(`${selectors.join(',\n')} {\n  ${decls.join(';\n  ')};\n}`);
  }
  // Table styles last: their cell selectors must outrank the paragraph rules above.
  const table = tableStyleCss(sheet.table ?? {});
  if (table) rules.push(table);
  return rules.join('\n\n');
}

// ---- block ⇄ style ------------------------------------------------------------------

type BlockNode = { type?: { name: string }; attrs?: Record<string, unknown> };
type BlockMark = { type: { name: string } | string; attrs?: Record<string, unknown> };

// The formatting a block currently shows, read off its attrs and the marks of its text —
// the raw material for "new style from selection".
export function propsFromBlock(node: BlockNode, marks: BlockMark[] = []): ResolvedStyle {
  const a = node.attrs ?? {};
  const para: ParaProps = {};
  // Every block carries textAlign:'left' (the TextAlign extension's default), so only a
  // real choice counts as the block's own alignment.
  const ta = a.textAlign;
  if (ta === 'center' || ta === 'right' || ta === 'justify') para.textAlign = ta;
  if (typeof a.lineHeight === 'string' && a.lineHeight) para.lineHeight = a.lineHeight;
  if (typeof a.spaceBefore === 'number') para.spaceBefore = a.spaceBefore;
  if (typeof a.spaceAfter === 'number') para.spaceAfter = a.spaceAfter;
  if (typeof a.indent === 'number' && a.indent > 0) para.indent = a.indent;
  if (typeof a.backgroundColor === 'string' && a.backgroundColor) para.backgroundColor = a.backgroundColor;
  for (const side of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'] as const) {
    const v = a[side];
    if (typeof v === 'string' && v && v !== 'none') para[side] = v;
  }

  const text: TextProps = {};
  // The paragraph-mark size sizes the block itself; a run's own size wins below.
  if (typeof a.fontSize === 'string' && a.fontSize) text.fontSizePt = parseFloat(a.fontSize);
  const nameOf = (m: BlockMark) => (typeof m.type === 'string' ? m.type : m.type.name);
  for (const mark of marks) {
    const name = nameOf(mark);
    if (name === 'bold') text.bold = true;
    else if (name === 'italic') text.italic = true;
    else if (name === 'underline') text.underline = true;
    else if (name === 'strike') text.strike = true;
    else if (name === 'textStyle') {
      const attrs = mark.attrs ?? {};
      if (typeof attrs.fontFamily === 'string' && attrs.fontFamily) text.fontFamily = attrs.fontFamily;
      if (typeof attrs.fontSize === 'string' && attrs.fontSize) text.fontSizePt = parseFloat(attrs.fontSize);
      if (typeof attrs.color === 'string' && attrs.color) text.color = attrs.color;
      if (attrs.fontWeight === 'normal') text.bold = false;
    }
  }
  return { para, text };
}

// What `shown` declares beyond `base` — a style's own properties (LibreOffice's
// "new style from selection" stores exactly this against the parent).
export function styleDelta(shown: ResolvedStyle, base: ResolvedStyle): ResolvedStyle {
  const pick = <T extends object>(a: T, b: T): T => {
    const out = {} as T;
    for (const key of Object.keys(a) as (keyof T)[]) {
      if (a[key] !== undefined && a[key] !== b[key]) out[key] = a[key];
    }
    return out;
  };
  return { para: pick(shown.para, base.para), text: pick(shown.text, base.text) };
}

// A name that isn't taken yet ("Style", "Style 2", …).
export function uniqueStyleName(sheet: StyleSheet, base: string, family: StyleFamily = 'paragraph'): string {
  const styles: Record<string, unknown> = sheet[family] ?? sheet.paragraph;
  if (!styles[base]) return base;
  for (let i = 2; ; i++) if (!styles[`${base} ${i}`]) return `${base} ${i}`;
}
