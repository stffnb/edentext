import type { Editor } from '@tiptap/core';
import { tiptapToOdt, type TiptapNode, type TextFormatting, type OdtDocument, type ParagraphBuilder } from 'odf-kit';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

type AlignValue = 'left' | 'center' | 'right' | 'justify';

// tiptapToOdt ignores paragraph/heading node attrs (including lineHeight and
// textAlign). We rename nodes that carry either attr to custom types and
// handle them via unknownNodeHandler, which has access to the full OdtDocument API.

const CUST_P = '__cust_p__';
const CUST_H = '__cust_h__';

// odf-kit emits this as the document's default font (Standard style). The editor
// renders the bundled, metric-identical Liberation Serif on screen.
const ODFKIT_DEFAULT_FONT = 'Liberation Serif';
// …but we declare Times New Roman in the .odt: it is metric-identical to
// Liberation Serif, so LibreOffice (substitutes TNR→Liberation Serif) and Word
// (has the real TNR) both render with the same metrics as the editor.
const EXPORT_FONT = 'Times New Roman';
const DEFAULT_LINE_HEIGHT = 1;  // must match line-height multiplier default in ToolbarExpanded.svelte

// Editor page geometry (see editor.css / pageBreaks.ts): 96px top/bottom and
// 80px side padding on a 794px (≈A4) page. Match them so the exported text
// column width — and therefore line wrapping and page flow — is identical.
const PAGE_MARGIN_V = '2.54cm'; // 96px @96dpi
const PAGE_MARGIN_H = '2.12cm'; // 80px @96dpi

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
  const ta = attrs.textAlign;
  return ta === 'left' || ta === 'center' || ta === 'right' || ta === 'justify';
}

function injectCustomTypes(node: TiptapNode, inList = false): TiptapNode {
  // Don't rename paragraphs inside list items — tiptapToOdt walks them by
  // type === "paragraph" to build list content; renaming breaks that.
  if (!inList && hasCustomAttrs(node.attrs)) {
    if (node.type === 'paragraph') return { ...node, type: CUST_P };
    if (node.type === 'heading')   return { ...node, type: CUST_H };
  }
  if (node.content?.length) {
    const childInList = inList
      || node.type === 'bulletList'
      || node.type === 'orderedList'
      || node.type === 'listItem';
    return { ...node, content: node.content.map(c => injectCustomTypes(c, childInList)) };
  }
  return node;
}

// Collect the alignment of each listItem's first paragraph, in DFS order —
// matching the order that odf-kit emits <text:list-item> elements into
// content.xml. Items without a non-default alignment yield null.
function collectListItemAligns(node: TiptapNode, result: (AlignValue | null)[]): void {
  if (node.type === 'listItem') {
    const firstPara = node.content?.find(c => c.type === 'paragraph');
    const ta = firstPara?.attrs?.textAlign as AlignValue | undefined;
    result.push(ta === 'center' || ta === 'right' || ta === 'justify' ? ta : null);
    // Recurse into nested lists only (their listItems extend the DFS sequence).
    for (const child of node.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        collectListItemAligns(child, result);
      }
    }
    return;
  }
  for (const child of node.content ?? []) {
    collectListItemAligns(child, result);
  }
}

// odf-kit's ListBuilder doesn't support per-item paragraph options, so list-item
// paragraphs always emit with text:style-name="List_20_Bullet" or "List_20_Number".
// We rewrite content.xml to point those at custom automatic styles that inherit
// from the list paragraph style and add fo:text-align.
function applyListItemAlignments(odtBytes: Uint8Array, aligns: (AlignValue | null)[]): Uint8Array {
  if (aligns.every(a => a === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const styleDefs: { name: string; parent: string; align: AlignValue }[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;
  let idx = 0;

  // Each text:list-item directly contains the item's paragraph as its first child.
  content = content.replace(
    /(<text:list-item>\s*<text:p text:style-name=")(List_20_Bullet|List_20_Number)(")/g,
    (_match, pre, parentStyle, post) => {
      const align = aligns[idx++];
      if (!align) return `${pre}${parentStyle}${post}`;
      const key = `${parentStyle}|${align}`;
      let name = nameByKey.get(key);
      if (!name) {
        counter++;
        name = `LP${counter}`;
        nameByKey.set(key, name);
        styleDefs.push({ name, parent: parentStyle, align });
      }
      return `${pre}${name}${post}`;
    },
  );

  if (styleDefs.length === 0) return odtBytes;

  const newStyles = styleDefs.map(({ name, parent, align }) =>
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties fo:text-align="${align}"/></style:style>`,
  ).join('\n');

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

function applyRuns(p: ParagraphBuilder, content: TiptapNode[] = []) {
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
    p.addText(node.text, Object.keys(fmt).length ? fmt : undefined);
  }
}

export async function exportToOdt(editor: Editor): Promise<void> {
  const raw = editor.getJSON() as TiptapNode;
  const json = injectCustomTypes(raw);

  const odt = await tiptapToOdt(json, {
    marginTop: PAGE_MARGIN_V,
    marginBottom: PAGE_MARGIN_V,
    marginLeft: PAGE_MARGIN_H,
    marginRight: PAGE_MARGIN_H,
    unknownNodeHandler(node: TiptapNode, doc: OdtDocument) {
      const opts: { lineHeight?: number | string; align?: AlignValue } = {};
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

  const listAligns: (AlignValue | null)[] = [];
  collectListItemAligns(raw, listAligns);
  const aligned = applyListItemAlignments(odt as Uint8Array, listAligns);
  const finalBytes = rewriteStylesXml(aligned);

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
