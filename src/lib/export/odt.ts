import type { Editor } from '@tiptap/core';
import { tiptapToOdt, type TiptapNode, type TextFormatting, type OdtDocument, type ParagraphBuilder, type TableBuilder, type RowBuilder, type CellBuilder } from 'odf-kit';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';

type AlignValue = 'left' | 'center' | 'right' | 'justify';

// tiptapToOdt ignores paragraph/heading node attrs (including lineHeight and
// textAlign). We rename nodes that carry either attr to custom types and
// handle them via unknownNodeHandler, which has access to the full OdtDocument API.

const CUST_P = '__cust_p__';
const CUST_H = '__cust_h__';
// Tables are renamed to this so odf-kit routes them to unknownNodeHandler. Its
// native table path (walkTable) calls addTable with no options, emitting cells
// with no border — invisible in LibreOffice/Word. We build the table ourselves
// and pass an explicit border instead.
const CUST_TABLE = '__cust_table__';

// Table export styling. Values mirror the editor's table CSS (src/styles/editor.css)
// so the .odt matches the on-screen preview.
const TABLE_BORDER = '0.5pt solid #000000';
const CELL_PADDING = '0.1cm'; // must match td/th padding in editor.css

// odf-kit emits this as the document's default font (Standard style). The editor
// renders the bundled, metric-identical Liberation Serif on screen.
const ODFKIT_DEFAULT_FONT = 'Liberation Serif';
// …but we declare Times New Roman in the .odt: it is metric-identical to
// Liberation Serif, so LibreOffice (substitutes TNR→Liberation Serif) and Word
// (has the real TNR) both render with the same metrics as the editor.
const EXPORT_FONT = 'Times New Roman';
const DEFAULT_LINE_HEIGHT = 1;  // must match line-height multiplier default in ToolbarExpanded.svelte

// Heading sizes/margins shown in the editor (editor.css). odf-kit's built-in
// Heading_20_N styles use larger sizes (28/24/20pt), so we rewrite them on
// export. Margins are the editor's em-based values resolved against each
// heading's own font size (top 1.5em, bottom 0.5em), converted to cm.
const HEADING_STYLE_OVERRIDES: { name: string; fontSize: string; marginTop: string; marginBottom: string }[] = [
  { name: 'Heading_20_1', fontSize: '20pt', marginTop: '1.058cm', marginBottom: '0.353cm' },
  { name: 'Heading_20_2', fontSize: '16pt', marginTop: '0.847cm', marginBottom: '0.282cm' },
  { name: 'Heading_20_3', fontSize: '14pt', marginTop: '0.741cm', marginBottom: '0.247cm' },
];

function hasCustomAttrs(attrs: TiptapNode['attrs']): boolean {
  if (!attrs) return false;
  if (attrs.lineHeight) return true;
  if (attrs.spaceBefore != null) return true;
  if (attrs.spaceAfter != null) return true;
  const ta = attrs.textAlign;
  return ta === 'left' || ta === 'center' || ta === 'right' || ta === 'justify';
}

function injectCustomTypes(node: TiptapNode, inContainer = false): TiptapNode {
  // Rename tables so odf-kit routes them to our unknownNodeHandler (see
  // CUST_TABLE). Recurse with inContainer=true so the cell paragraphs are NOT
  // renamed — our table handler walks them by type === "paragraph".
  if (node.type === 'table') {
    return {
      ...node,
      type: CUST_TABLE,
      content: node.content?.map(c => injectCustomTypes(c, true)),
    };
  }
  // Don't rename paragraphs inside list items or table cells — tiptapToOdt's list
  // builder (and our table handler) walk them by type === "paragraph"; renaming
  // breaks that.
  if (!inContainer && hasCustomAttrs(node.attrs)) {
    if (node.type === 'paragraph') return { ...node, type: CUST_P };
    if (node.type === 'heading')   return { ...node, type: CUST_H };
  }
  if (node.content?.length) {
    const childInContainer = inContainer
      || node.type === 'bulletList'
      || node.type === 'orderedList'
      || node.type === 'listItem';
    return { ...node, content: node.content.map(c => injectCustomTypes(c, childInContainer)) };
  }
  return node;
}

// Mirror odf-kit's normalizeLineHeight (content.js): a number is a multiplier
// (1.5 → "150%"); a string with a unit passes through ("18pt" → "18pt").
function normalizeLineHeight(lh: number | string): string {
  return typeof lh === 'number' ? `${Math.round(lh * 100)}%` : lh;
}

// Per-list-item paragraph properties carried over to the exported .odt.
type ListItemStyle = {
  align: AlignValue | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: number | string | null;
};

function listItemStyleIsEmpty(s: ListItemStyle): boolean {
  return s.align === null && s.spaceBefore === null && s.spaceAfter === null && s.lineHeight === null;
}

// Collect the alignment + paragraph spacing of each listItem's first paragraph,
// in DFS order — matching the order that odf-kit emits <text:list-item> elements
// into content.xml. Items without overrides yield an all-null descriptor.
function collectListItemStyles(node: TiptapNode, result: ListItemStyle[]): void {
  if (node.type === 'listItem') {
    const firstPara = node.content?.find(c => c.type === 'paragraph');
    const ta = firstPara?.attrs?.textAlign as AlignValue | undefined;
    const sb = firstPara?.attrs?.spaceBefore;
    const sa = firstPara?.attrs?.spaceAfter;
    const lh = firstPara?.attrs?.lineHeight;
    let lineHeight: number | string | null = null;
    if (lh != null) {
      const lhNum = parseFloat(String(lh));
      lineHeight = isNaN(lhNum) ? String(lh) : lhNum;
    }
    result.push({
      align: ta === 'center' || ta === 'right' || ta === 'justify' ? ta : null,
      spaceBefore: typeof sb === 'number' ? sb : null,
      spaceAfter: typeof sa === 'number' ? sa : null,
      lineHeight,
    });
    // Recurse into nested lists only (their listItems extend the DFS sequence).
    for (const child of node.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        collectListItemStyles(child, result);
      }
    }
    return;
  }
  for (const child of node.content ?? []) {
    collectListItemStyles(child, result);
  }
}

// odf-kit's ListBuilder doesn't support per-item paragraph options, so list-item
// paragraphs always emit with text:style-name="List_20_Bullet" or "List_20_Number".
// We rewrite content.xml to point those at custom automatic styles that inherit
// from the list paragraph style and add fo:text-align / fo:margin-top / fo:margin-bottom.
function applyListItemStyles(odtBytes: Uint8Array, styles: ListItemStyle[]): Uint8Array {
  if (styles.every(listItemStyleIsEmpty)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const styleDefs: { name: string; parent: string; style: ListItemStyle }[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;
  let idx = 0;

  // Each text:list-item directly contains the item's paragraph as its first child.
  content = content.replace(
    /(<text:list-item>\s*<text:p text:style-name=")(List_20_Bullet|List_20_Number)(")/g,
    (_match, pre, parentStyle, post) => {
      const style = styles[idx++];
      if (!style || listItemStyleIsEmpty(style)) return `${pre}${parentStyle}${post}`;
      const key = `${parentStyle}|${style.align}|${style.spaceBefore}|${style.spaceAfter}|${style.lineHeight}`;
      let name = nameByKey.get(key);
      if (!name) {
        counter++;
        name = `LP${counter}`;
        nameByKey.set(key, name);
        styleDefs.push({ name, parent: parentStyle, style });
      }
      return `${pre}${name}${post}`;
    },
  );

  if (styleDefs.length === 0) return odtBytes;

  const newStyles = styleDefs.map(({ name, parent, style }) => {
    const props: string[] = [];
    if (style.align) props.push(`fo:text-align="${style.align}"`);
    if (style.spaceBefore != null) props.push(`fo:margin-top="${style.spaceBefore}pt"`);
    if (style.spaceAfter != null) props.push(`fo:margin-bottom="${style.spaceAfter}pt"`);
    if (style.lineHeight != null) props.push(`fo:line-height="${normalizeLineHeight(style.lineHeight)}"`);
    return `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${props.join(' ')}/></style:style>`;
  }).join('\n');

  content = content.replace('</office:automatic-styles>', `${newStyles}\n</office:automatic-styles>`);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Re-zip an unpacked ODF, preserving the mimetype-first uncompressed requirement.
function rezipOdt(files: Record<string, Uint8Array>): Uint8Array {
  const mimetype = files['mimetype'];
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  if (mimetype) out['mimetype'] = [mimetype, { level: 0 }];
  for (const [path, data] of Object.entries(files)) {
    if (path === 'mimetype') continue;
    out[path] = [data, { level: 6 }];
  }
  return zipSync(out);
}

// Rewrite styles.xml so the exported document matches the editor's preview:
//  • default font Liberation Serif → Times New Roman (metric-identical; renders
//    the same in the editor, LibreOffice, and Word — see EXPORT_FONT).
//  • Heading_20_1/2/3 sizes & margins → the editor's values (odf-kit's defaults
//    are larger). See HEADING_STYLE_OVERRIDES.
function rewriteStylesXml(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const stylesBytes = files['styles.xml'];
  if (!stylesBytes) return odtBytes;

  let styles = strFromU8(stylesBytes);

  // The only occurrences of "Liberation Serif" in styles.xml are the default
  // font-face declaration and the Standard style's font-name attributes.
  styles = styles.split(ODFKIT_DEFAULT_FONT).join(EXPORT_FONT);

  styles = styles.replace(
    '<style:master-page style:name="Default"',
    '<style:master-page style:name="Standard"',
  );

  // List item paragraphs (List_20_Bullet/List_20_Number) inherit the Standard
  // style's fo:margin-bottom (0.212cm). The editor zeroes the bottom margin on
  // list items (editor.css: `li`/`li p` → margin-bottom: 0), so by default the
  // gap between bullets is just line-height. Without this override every
  // exported bullet would gain ~6pt of extra spacing vs. the editor preview.
  // Items with an explicit paragraph spacing override this via their LP styles
  // (see applyListItemStyles).
  for (const name of ['List_20_Bullet', 'List_20_Number']) {
    styles = styles.replace(
      new RegExp(`(<style:style style:name="${name}"[^>]*?)/>`),
      `$1><style:paragraph-properties fo:margin-bottom="0cm"/></style:style>`,
    );
  }

  // Scope each rewrite to its own <style:style …>…</style:style> block so the
  // font-size/margin replacements never bleed across heading levels.
  for (const { name, fontSize, marginTop, marginBottom } of HEADING_STYLE_OVERRIDES) {
    const re = new RegExp(`<style:style style:name="${name}"[\\s\\S]*?</style:style>`);
    styles = styles.replace(re, (block) =>
      block
        .replace(/fo:font-size="[^"]*"/g, `fo:font-size="${fontSize}"`)
        .replace(/style:font-size-asian="[^"]*"/g, `style:font-size-asian="${fontSize}"`)
        .replace(/style:font-size-complex="[^"]*"/g, `style:font-size-complex="${fontSize}"`)
        .replace(/fo:margin-top="[^"]*"/g, `fo:margin-top="${marginTop}"`)
        .replace(/fo:margin-bottom="[^"]*"/g, `fo:margin-bottom="${marginBottom}"`),
    );
  }

  files['styles.xml'] = strToU8(styles);
  return rezipOdt(files);
}

// ODF requires fo:color in `#RRGGBB` form. TipTap stores whatever string went
// in: hex from the color picker, but `rgb(r, g, b)` after any HTML round-trip
// (paste, parseHTML in fontColor.ts). Anything that isn't valid hex is silently
// dropped by Word/LibreOffice → text renders black.
function normalizeColor(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;

  const hex = s.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
    }
    if (h.length === 6 || h.length === 8) {
      return `#${h.slice(0, 6)}`.toUpperCase();
    }
    return undefined;
  }

  const rgb = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*[\d.]+\s*)?\)$/i);
  if (rgb) {
    const toHex = (v: string) => {
      const n = Math.max(0, Math.min(255, Math.round(parseFloat(v))));
      return n.toString(16).padStart(2, '0');
    };
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`.toUpperCase();
  }

  // Named colors (red, blue, …): pass through — odf-kit resolves them.
  return s;
}

function applyRuns(p: ParagraphBuilder | CellBuilder, content: TiptapNode[] = []) {
  for (const node of content) {
    if (node.type !== 'text' || !node.text) continue;
    const marks = node.marks ?? [];
    const tsm = marks.find(m => m.type === 'textStyle');
    const fmt: TextFormatting = {};
    if (marks.some(m => m.type === 'bold'))      fmt.bold = true;
    if (marks.some(m => m.type === 'italic'))     fmt.italic = true;
    if (marks.some(m => m.type === 'underline'))  fmt.underline = true;
    if (tsm?.attrs?.fontFamily) {
      const ff = String(tsm.attrs.fontFamily);
      // Explicitly choosing the editor default should match the untagged
      // default, which resolves to EXPORT_FONT via the Standard style.
      fmt.fontFamily = ff === ODFKIT_DEFAULT_FONT ? EXPORT_FONT : ff;
    }
    if (tsm?.attrs?.fontSize)   fmt.fontSize   = String(tsm.attrs.fontSize);
    if (tsm?.attrs?.color) {
      const c = normalizeColor(String(tsm.attrs.color));
      if (c) fmt.color = c;
    }
    // Text highlight (background). odf-kit maps highlightColor → fo:background-color
    // natively for normal paragraphs; this covers the custom-attr-paragraph path
    // (CUST_P/CUST_H), which bypasses odf-kit's own mark handling.
    const hl = marks.find(m => m.type === 'highlight');
    if (hl?.attrs?.color) {
      const c = normalizeColor(String(hl.attrs.color));
      if (c) fmt.highlightColor = c;
    }
    p.addText(node.text, Object.keys(fmt).length ? fmt : undefined);
  }
}

// Build an ODF table from a CUST_TABLE node (renamed from "table" in
// injectCustomTypes). We bypass odf-kit's native walkTable so we can pass an
// explicit cell border — the native path emits none, so the table would be
// invisible in LibreOffice/Word. No columnWidths are passed, so odf-kit
// distributes columns evenly, matching the editor's equal-width fixed layout.
function exportTable(node: TiptapNode, doc: OdtDocument): void {
  const rows = (node.content ?? []).filter(r => r.type === 'tableRow');
  if (rows.length === 0) return;
  doc.addTable((t: TableBuilder) => {
    for (const row of rows) {
      t.addRow((r: RowBuilder) => {
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
          const paras = (cell.content ?? []).filter(c => c.type === 'paragraph');
          r.addCell((c: CellBuilder) => {
            // Multiple cell paragraphs are joined with a space, matching
            // odf-kit's own walkTable behavior.
            paras.forEach((para, i) => {
              if (i > 0) c.addText(' ');
              applyRuns(c, para.content);
            });
          }, { padding: CELL_PADDING });
        }
      });
    }
  }, { border: TABLE_BORDER });
}

// odf-kit's XML builder serializes a multi-child element's children on separate
// lines, joined by "\n" (core/xml.js). Inside a <text:p>/<text:h> that newline
// is significant character data, so LibreOffice/Word collapse it to a space —
// inserting a spurious space wherever a run boundary falls mid-word (e.g. a
// highlight, bold, or colour that starts inside a word splits the text node, and
// the two runs serialize as "He\n<text:span>llo</text:span>" → "He llo").
//
// We strip the bare "\n" separators inside every paragraph/heading element.
// Only the newline characters are removed; any real space in the run text sits
// adjacent to (not inside) the "\n" and is preserved, so word-boundary spacing
// (e.g. "Hello " + bold "world") still round-trips correctly.
function collapseRunWhitespace(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  content = content.replace(
    /<text:(p|h)\b[^>]*>[\s\S]*?<\/text:\1>/g,
    (block) => block.replace(/\n/g, ''),
  );

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

export async function exportToOdt(editor: Editor, margins: PageMargins = DEFAULT_MARGINS, orientation: Orientation = 'portrait'): Promise<void> {
  const raw = editor.getJSON() as TiptapNode;
  const json = injectCustomTypes(raw);

  const odt = await tiptapToOdt(json, {
    // Orientation comes from the Layout panel; odf-kit swaps the A4 dimensions
    // automatically (29.7×21cm) and writes style:print-orientation accordingly.
    orientation,
    // Margins (cm) come from the Layout panel via App state. They match the
    // editor's on-screen padding so exported line wrapping / page flow is identical.
    marginTop: `${margins.top}cm`,
    marginBottom: `${margins.bottom}cm`,
    marginLeft: `${margins.left}cm`,
    marginRight: `${margins.right}cm`,
    unknownNodeHandler(node: TiptapNode, doc: OdtDocument) {
      if (node.type === CUST_TABLE) {
        exportTable(node, doc);
        return;
      }
      const opts: {
        lineHeight?: number | string;
        align?: AlignValue;
        spaceBefore?: string;
        spaceAfter?: string;
      } = {};
      if (node.attrs?.lineHeight != null) {
        const lhRaw = String(node.attrs.lineHeight);
        const lhNum = parseFloat(lhRaw);
        opts.lineHeight = isNaN(lhNum) ? lhRaw : lhNum;
      } else {
        opts.lineHeight = DEFAULT_LINE_HEIGHT;
      }
      const ta = node.attrs?.textAlign;
      if (ta === 'left' || ta === 'center' || ta === 'right' || ta === 'justify') {
        opts.align = ta;
      }
      if (node.attrs?.spaceBefore != null) opts.spaceBefore = `${node.attrs.spaceBefore}pt`;
      if (node.attrs?.spaceAfter != null) opts.spaceAfter = `${node.attrs.spaceAfter}pt`;
      const content = node.content ?? [];

      if (node.type === CUST_P) {
        if (content.length === 0) {
          doc.addParagraph('', opts);
        } else {
          doc.addParagraph((p: ParagraphBuilder) => applyRuns(p, content), opts);
        }
      } else if (node.type === CUST_H) {
        const level = (node.attrs?.level as number) ?? 1;
        doc.addHeading((p: ParagraphBuilder) => applyRuns(p, content), level, opts);
      }
    },
  });

  const listStyles: ListItemStyle[] = [];
  collectListItemStyles(raw, listStyles);
  const styledLists = applyListItemStyles(odt as Uint8Array, listStyles);
  const cleaned = collapseRunWhitespace(styledLists);
  const finalBytes = rewriteStylesXml(cleaned);

  const blob = new Blob([finalBytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.oasis.opendocument.text' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getFilename(editor);
  a.click();
  URL.revokeObjectURL(url);
}

function getFilename(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = editor.getJSON() as any;
  const heading = json.content?.find(
    (node: any) => node.type === 'heading' && node.content?.length
  );
  const firstText: string | undefined = heading?.content?.[0]?.text;
  if (firstText) {
    const name = firstText
      .slice(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (name) return `${name}.odt`;
  }
  return 'document.odt';
}
