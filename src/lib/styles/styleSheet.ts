// Named paragraph styles with inheritance, modelled on LibreOffice: a style has a
// name, a parent it inherits from, a follow-on style, and two property groups
// (paragraph layout + text). Resolution walks the parent chain, nearer wins; direct
// formatting on the block (attrs/marks) still overrides the result.

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

export type StyleSheet = { paragraph: Record<string, Style> };

export const DEFAULT_STYLE = 'Standard';
export const HEADING_PARENT = 'Heading';

// LibreOffice's defaults. Heading sizes/margins mirror HEADING_STYLE_OVERRIDES in
// export/odt.ts, which still drives the ODF/DOCX side (tests/unit/style-resolve.test.ts
// asserts the two agree).
const BUILTINS: Style[] = [
  { name: DEFAULT_STYLE, parent: null, next: null, builtin: true,
    para: {}, text: { fontFamily: 'Liberation Serif', fontSizePt: 12 } },
  { name: HEADING_PARENT, parent: DEFAULT_STYLE, next: DEFAULT_STYLE, builtin: true,
    para: { spaceBefore: 12, spaceAfter: 6 }, text: { fontFamily: 'Arial', bold: true } },
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

export function builtinStyleSheet(): StyleSheet {
  const paragraph: Record<string, Style> = {};
  for (const s of BUILTINS) paragraph[s.name] = structuredClone(s);
  return { paragraph };
}

// The gallery/manager order: built-ins as listed above, user styles after them.
export function styleOrder(sheet: StyleSheet): Style[] {
  const names = Object.keys(sheet.paragraph);
  const builtinOrder = BUILTINS.map(b => b.name).filter(n => names.includes(n) && n !== HEADING_PARENT);
  const rest = names.filter(n => !builtinOrder.includes(n) && n !== HEADING_PARENT).sort();
  return [...builtinOrder, ...rest].map(n => sheet.paragraph[n]);
}

export function headingStyleName(level: number): string {
  return `Heading ${level}`;
}

export type ResolvedStyle = { para: ParaProps; text: TextProps };

// Flattened props of a style: the parent chain applied root-first, so the nearest
// definition wins. Cycles and missing parents end the walk.
export function resolveStyle(sheet: StyleSheet, name: string | null | undefined): ResolvedStyle {
  const chain: Style[] = [];
  const seen = new Set<string>();
  let cur = name && sheet.paragraph[name] ? name : DEFAULT_STYLE;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const style = sheet.paragraph[cur];
    if (!style) break;
    chain.push(style);
    cur = style.parent ?? '';
  }
  const out: ResolvedStyle = { para: {}, text: {} };
  for (const style of chain.reverse()) {
    Object.assign(out.para, style.para);
    Object.assign(out.text, style.text);
  }
  return out;
}

// The bundled fonts are exposed as CSS variables; anything else renders by name.
function cssFontFamily(name: string): string {
  if (name === 'Liberation Serif') return 'var(--font-serif)';
  if (name === 'Arial') return 'var(--font-heading)';
  return `'${name.replace(/'/g, "\\'")}', var(--font-serif)`;
}

function declarations(r: ResolvedStyle): string[] {
  const out: string[] = [];
  const { para: p, text: t } = r;
  if (t.fontFamily) out.push(`font-family: ${cssFontFamily(t.fontFamily)}`);
  if (t.fontSizePt != null) out.push(`font-size: ${t.fontSizePt}pt`);
  if (t.bold != null) out.push(`font-weight: ${t.bold ? 700 : 400}`);
  if (t.italic != null) out.push(`font-style: ${t.italic ? 'italic' : 'normal'}`);
  if (t.underline || t.strike) {
    out.push(`text-decoration: ${[t.underline && 'underline', t.strike && 'line-through'].filter(Boolean).join(' ')}`);
  }
  if (t.color) out.push(`color: ${t.color}`);
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
  for (const style of Object.values(sheet.paragraph)) {
    const decls = declarations(resolveStyle(sheet, style.name));
    if (!decls.length) continue;
    const attr = `[data-style="${style.name.replace(/"/g, '\\"')}"]`;
    const selectors = [`.paper .tiptap ${attr}`];
    if (style.outlineLevel) selectors.push(`.paper .tiptap h${style.outlineLevel}:not([data-style])`);
    if (style.name === DEFAULT_STYLE) selectors.push('.paper .tiptap p:not([data-style])');
    rules.push(`${selectors.join(',\n')} {\n  ${decls.join(';\n  ')};\n}`);
  }
  return rules.join('\n\n');
}
