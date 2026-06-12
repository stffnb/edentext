import type { Editor } from '@tiptap/core';
import { tiptapToOdt, type TiptapNode, type TextFormatting, type OdtDocument, type ParagraphBuilder, type TableBuilder, type RowBuilder, type CellBuilder } from 'odf-kit';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { DEFAULT_ORDERED_TYPE, orderedTypeDef } from '../editor/orderedListTypes';

type AlignValue = 'left' | 'center' | 'right' | 'justify';

// tiptapToOdt ignores paragraph/heading node attrs (including lineHeight and
// textAlign). We rename nodes that carry either attr to custom types and
// handle them via unknownNodeHandler, which has access to the full OdtDocument API.

const CUST_P = '__cust_p__';
const CUST_H = '__cust_h__';
// Tables are renamed to this so odf-kit routes them to unknownNodeHandler. Its
// native path emits cells with no border (invisible in LibreOffice/Word), so we
// build the table ourselves with an explicit border.
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

// Sentinel between a cell's blocks (and list items) so the single <text:p> odf-kit
// emits per cell can be split back into real blocks in applyCellBlocks. A private-use
// char: never in user text, and passes odf-kit's XML escaper (only & < >) untouched.
const SEG = '';

// Automatic list styles minted for in-cell lists (see applyCellBlocks). odf-kit's
// CellBuilder is run-based, so a list inside a cell can't reference a list style it
// generates for top-level lists — we inject our own, mirroring its buildListStyle.
const CELL_LIST_BULLET_STYLE = 'TblListBullet';
const CELL_LIST_NUMBER_STYLE = 'TblListNumber';

// Heading sizes/margins shown in the editor (editor.css); odf-kit's Heading_20_N
// defaults are larger, so we rewrite them on export. Margins are the editor's em
// values (top 1.5em, bottom 0.5em) resolved against each heading's font size, in cm.
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

// Paragraph property overrides for the exported .odt, for both list-item and
// table-cell paragraphs (odf-kit's List/TableBuilder support no per-paragraph
// alignment/spacing/line-height), injected as automatic styles in post-processing.
type ParaStyle = {
  align: AlignValue | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: number | string | null;
};

function paraStyleIsEmpty(s: ParaStyle): boolean {
  return s.align === null && s.spaceBefore === null && s.spaceAfter === null && s.lineHeight === null;
}

// Extract the overridable paragraph properties from a node's attrs. Left
// alignment yields null (it's the Standard-style default, so no override needed).
function paraStyleFromAttrs(attrs: TiptapNode['attrs']): ParaStyle {
  const ta = attrs?.textAlign as AlignValue | undefined;
  const sb = attrs?.spaceBefore;
  const sa = attrs?.spaceAfter;
  const lh = attrs?.lineHeight;
  let lineHeight: number | string | null = null;
  if (lh != null) {
    const lhNum = parseFloat(String(lh));
    lineHeight = isNaN(lhNum) ? String(lh) : lhNum;
  }
  return {
    align: ta === 'center' || ta === 'right' || ta === 'justify' ? ta : null,
    spaceBefore: typeof sb === 'number' ? sb : null,
    spaceAfter: typeof sa === 'number' ? sa : null,
    lineHeight,
  };
}

// fo:* paragraph-properties attribute strings for a ParaStyle override.
function paraStyleProps(style: ParaStyle): string[] {
  const props: string[] = [];
  if (style.align) props.push(`fo:text-align="${style.align}"`);
  if (style.spaceBefore != null) props.push(`fo:margin-top="${style.spaceBefore}pt"`);
  if (style.spaceAfter != null) props.push(`fo:margin-bottom="${style.spaceAfter}pt"`);
  if (style.lineHeight != null) props.push(`fo:line-height="${normalizeLineHeight(style.lineHeight)}"`);
  return props;
}

// Per-cell block descriptors, built in exportTable and consumed in document order by
// applyCellBlocks to rebuild real <text:h>/<text:p>/<text:list> from the SEG-segmented
// <text:p> odf-kit emits. Each paragraph/heading/list item is one segment, in DFS order.
type CellListItem = { style: ParaStyle; nested: CellListBlock | null };
type CellListBlock = { kind: 'list'; ordered: boolean; start: number | null; items: CellListItem[] };
type CellBlock =
  | { kind: 'paragraph'; style: ParaStyle }
  | { kind: 'heading'; level: number; style: ParaStyle }
  | CellListBlock;

// Collect the alignment + paragraph spacing of each listItem's first paragraph,
// in DFS order — matching the order that odf-kit emits <text:list-item> elements
// into content.xml. Items without overrides yield an all-null descriptor.
function collectListItemStyles(node: TiptapNode, result: ParaStyle[]): void {
  if (node.type === 'listItem') {
    const firstPara = node.content?.find(c => c.type === 'paragraph');
    result.push(paraStyleFromAttrs(firstPara?.attrs));
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

// Collect each table row's explicit height (px → cm), in DFS order matching odf-kit's
// <table:table-row> emission. rowHeight is unscaled px @96dpi (tableRow.ts), converted
// to cm (px × 2.54 / 96). Rows without an explicit height yield null.
function collectTableRowHeights(node: TiptapNode, result: (string | null)[]): void {
  if (node.type === 'table') {
    for (const row of node.content ?? []) {
      if (row.type !== 'tableRow') continue;
      const h = row.attrs?.rowHeight;
      if (typeof h === 'number' && h > 0) {
        const cm = Math.round(((h * 2.54) / 96) * 1000) / 1000;
        result.push(`${cm}cm`);
      } else {
        result.push(null);
      }
    }
    return;
  }
  for (const child of node.content ?? []) {
    collectTableRowHeights(child, result);
  }
}

// odf-kit's TableBuilder has no row-height option, so post-process content.xml: each
// <table:table-row> with a height gets an automatic style with style:min-row-height
// (a minimum) + use-optimal-row-height="false". One heights[] entry per row, in order.
function applyTableRowHeights(odtBytes: Uint8Array, heights: (string | null)[]): Uint8Array {
  if (heights.every(h => h === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const styleDefs: { name: string; height: string }[] = [];
  const nameByHeight = new Map<string, string>();
  let counter = 0;
  let idx = 0;

  content = content.replace(/<table:table-row\b([^>]*)>/g, (match, attrs: string) => {
    const height = heights[idx++];
    if (!height) return match;
    if (/\btable:style-name=/.test(attrs)) return match;
    let name = nameByHeight.get(height);
    if (!name) {
      counter++;
      name = `TRH${counter}`;
      nameByHeight.set(height, name);
      styleDefs.push({ name, height });
    }
    return `<table:table-row table:style-name="${name}"${attrs}>`;
  });

  if (styleDefs.length === 0) return odtBytes;

  const newStyles = styleDefs.map(({ name, height }) =>
    `<style:style style:name="${name}" style:family="table-row"><style:table-row-properties style:min-row-height="${height}" style:use-optimal-row-height="false"/></style:style>`,
  ).join('\n');

  content = content.replace('</office:automatic-styles>', `${newStyles}\n</office:automatic-styles>`);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// odf-kit's ListBuilder has no per-item paragraph options, so list-item paragraphs all
// emit as List_20_Bullet/Number. Rewrite content.xml to point those at automatic styles
// that inherit the list style and add fo:text-align / fo:margin-top / fo:margin-bottom.
function applyListItemStyles(odtBytes: Uint8Array, styles: ParaStyle[]): Uint8Array {
  if (styles.every(paraStyleIsEmpty)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const styleDefs: { name: string; parent: string; style: ParaStyle }[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;
  let idx = 0;

  // Each text:list-item directly contains the item's paragraph as its first child.
  content = content.replace(
    /(<text:list-item>\s*<text:p text:style-name=")(List_20_Bullet|List_20_Number)(")/g,
    (_match, pre, parentStyle, post) => {
      const style = styles[idx++];
      if (!style || paraStyleIsEmpty(style)) return `${pre}${parentStyle}${post}`;
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

  const newStyles = styleDefs.map(({ name, parent, style }) =>
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${paraStyleProps(style).join(' ')}/></style:style>`,
  ).join('\n');

  content = content.replace('</office:automatic-styles>', `${newStyles}\n</office:automatic-styles>`);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// odf-kit always emits ordered lists as "1." (num-format="1" num-suffix="."). This
// rewrites the matching L# list style to the user's chosen format; formats[] has one
// entry per top-level list in odf-kit's order (null for bullets/default 'decimal').

// Limitation: the chosen format applies to every nesting level (odf-kit emits one
// L# style per top-level list), so a nested list of a different type inherits it.
type OrderedFmt = { numFormat: string; numSuffix: string };

function collectOrderedListFormats(node: TiptapNode, result: (OrderedFmt | null)[]): void {
  for (const child of node.content ?? []) {
    if (child.type === 'bulletList') {
      result.push(null);
    } else if (child.type === 'orderedList') {
      const def = orderedTypeDef(child.attrs?.listStyleType as string | undefined);
      result.push(def.key === DEFAULT_ORDERED_TYPE ? null : { numFormat: def.numFormat, numSuffix: def.numSuffix });
    }
  }
}

function applyOrderedListFormats(odtBytes: Uint8Array, formats: (OrderedFmt | null)[]): Uint8Array {
  if (formats.every(f => f === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  formats.forEach((fmt, i) => {
    if (!fmt) return;
    // Rewrite only inside this list's own <text:list-style> block (all 6 levels).
    const re = new RegExp(`(<text:list-style style:name="L${i + 1}">)([\\s\\S]*?)(</text:list-style>)`);
    content = content.replace(re, (_m, open: string, body: string, close: string) =>
      open +
      body
        .replace(/style:num-format="1"/g, `style:num-format="${fmt.numFormat}"`)
        .replace(/style:num-suffix="\."/g, `style:num-suffix="${fmt.numSuffix}"`) +
      close,
    );
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Mirror odf-kit's buildListStyle (content.js) for the automatic list style our
// in-cell lists reference. Six nesting levels with identical bullet chars /
// indents / numbering, so cell lists match the editor's top-level lists.
const CELL_BULLET_CHARS = ['•', '◦', '▪', '▸', '–', '·'];
function buildCellListStyle(styleName: string, ordered: boolean): string {
  let levels = '';
  for (let level = 1; level <= 6; level++) {
    const indent = level * 0.635;
    const marginLeft = `${(indent * 2).toFixed(3)}cm`;
    const textIndent = `-${indent.toFixed(3)}cm`;
    const labelAlign = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${marginLeft}" fo:text-indent="${textIndent}" fo:margin-left="${marginLeft}"/></style:list-level-properties>`;
    if (ordered) {
      levels += `<text:list-level-style-number text:level="${level}" style:num-format="1" style:num-suffix=".">${labelAlign}</text:list-level-style-number>`;
    } else {
      const ch = CELL_BULLET_CHARS[(level - 1) % CELL_BULLET_CHARS.length];
      levels += `<text:list-level-style-bullet text:level="${level}" text:bullet-char="${ch}">${labelAlign}</text:list-level-style-bullet>`;
    }
  }
  return `<text:list-style style:name="${styleName}">${levels}</text:list-style>`;
}

// odf-kit serializes every cell to a single <text:p> of runs (no API for headings,
// lists, or multiple paragraphs). exportTable emits a cell's content into that paragraph
// SEG-separated; this pass splits on SEG and rebuilds real <text:h>/<text:p>/<text:list>.

// Ordering: after applyListItemStyles (so it sees only top-level list items, not cell
// lists) and before collapseRunWhitespace (so new in-cell paragraphs get newlines stripped).
function applyCellBlocks(odtBytes: Uint8Array, cellBlocks: CellBlock[][]): Uint8Array {
  const needsWork = (blocks: CellBlock[]): boolean => {
    if (blocks.length !== 1) return true;
    const b = blocks[0];
    return b.kind !== 'paragraph' || !paraStyleIsEmpty(b.style);
  };
  if (!cellBlocks.some(needsWork)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);

  // Minted paragraph automatic styles (parent = Standard / Heading_20_N /
  // List_20_*), deduped by parent + properties. An empty ParaStyle reuses the
  // parent directly (no minted style).
  const styleDefs: { name: string; parent: string; style: ParaStyle }[] = [];
  const nameByKey = new Map<string, string>();
  let styleCounter = 0;
  const styleNameFor = (parent: string, style: ParaStyle): string => {
    if (paraStyleIsEmpty(style)) return parent;
    const key = `${parent}|${style.align}|${style.spaceBefore}|${style.spaceAfter}|${style.lineHeight}`;
    let name = nameByKey.get(key);
    if (!name) {
      styleCounter++;
      name = `CB${styleCounter}`;
      nameByKey.set(key, name);
      styleDefs.push({ name, parent, style });
    }
    return name;
  };

  let usedBulletList = false;
  let usedNumberList = false;

  // Each <text:list> (root or nested) carries its own type-based style-name, so mixed
  // bullet/number nesting renders correctly; indent comes from nesting depth. One
  // segment consumed per list item, DFS order (matching buildCellContent).
  const buildList = (list: CellListBlock, segments: string[], cur: { i: number }): string => {
    const isBullet = !list.ordered;
    if (isBullet) usedBulletList = true; else usedNumberList = true;
    const listStyle = isBullet ? CELL_LIST_BULLET_STYLE : CELL_LIST_NUMBER_STYLE;
    const paraParent = isBullet ? 'List_20_Bullet' : 'List_20_Number';
    let out = `<text:list text:style-name="${listStyle}">`;
    list.items.forEach((item, idx) => {
      const startAttr = !isBullet && idx === 0 && list.start != null ? ` text:start-value="${list.start}"` : '';
      const seg = segments[cur.i++] ?? '';
      out += `<text:list-item${startAttr}><text:p text:style-name="${styleNameFor(paraParent, item.style)}">${seg}</text:p>`;
      if (item.nested) out += buildList(item.nested, segments, cur);
      out += '</text:list-item>';
    });
    return out + '</text:list>';
  };

  const buildBlocks = (blocks: CellBlock[], inner: string): string => {
    const segments = inner.split(SEG);
    const cur = { i: 0 };
    let out = '';
    for (const block of blocks) {
      if (block.kind === 'list') {
        out += buildList(block, segments, cur);
      } else if (block.kind === 'heading') {
        const seg = segments[cur.i++] ?? '';
        const name = styleNameFor(`Heading_20_${block.level}`, block.style);
        out += `<text:h text:style-name="${name}" text:outline-level="${block.level}">${seg}</text:h>`;
      } else {
        const seg = segments[cur.i++] ?? '';
        out += `<text:p text:style-name="${styleNameFor('Standard', block.style)}">${seg}</text:p>`;
      }
    }
    return out;
  };

  // Match each real cell's single paragraph (filled or empty) in document order.
  // Covered cells use <table:covered-table-cell> and never match; a cell holds exactly
  // one <text:p> with no nesting here, so the non-greedy inner capture is safe.
  let idx = 0;
  content = content.replace(
    /(<table:table-cell\b[^>]*>\s*)<text:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/text:p>)/g,
    (match, pre: string, innerRaw: string | undefined) => {
      const blocks = cellBlocks[idx++];
      if (!blocks || !needsWork(blocks)) return match;
      const inner = innerRaw ?? '';
      // Trivial single paragraph that only needs a style override: keep one
      // <text:p>, just point it at the minted style.
      if (blocks.length === 1 && blocks[0].kind === 'paragraph') {
        const name = styleNameFor('Standard', blocks[0].style);
        return innerRaw === undefined
          ? `${pre}<text:p text:style-name="${name}"/>`
          : `${pre}<text:p text:style-name="${name}">${inner}</text:p>`;
      }
      return `${pre}${buildBlocks(blocks, inner)}`;
    },
  );

  const additions: string[] = styleDefs.map(({ name, parent, style }) =>
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${paraStyleProps(style).join(' ')}/></style:style>`,
  );
  if (usedBulletList) additions.push(buildCellListStyle(CELL_LIST_BULLET_STYLE, false));
  if (usedNumberList) additions.push(buildCellListStyle(CELL_LIST_NUMBER_STYLE, true));

  if (additions.length) {
    content = content.replace('</office:automatic-styles>', `${additions.join('\n')}\n</office:automatic-styles>`);
  }

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

// Rewrite styles.xml to match the editor's preview: default font Liberation Serif →
// Times New Roman (metric-identical; see EXPORT_FONT), and Heading_20_1/2/3 sizes &
// margins → the editor's values (odf-kit's defaults are larger; HEADING_STYLE_OVERRIDES).
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

  // List item paragraphs inherit Standard's fo:margin-bottom (0.212cm), but the editor
  // zeroes it (editor.css), so without this override every exported bullet gains ~6pt
  // vs. the preview. Explicit per-item spacing overrides this via LP styles.
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

// ODF requires fo:color as #RRGGBB. TipTap may store hex (color picker) or rgb(r,g,b)
// after an HTML round-trip. Anything not valid hex is silently dropped by
// Word/LibreOffice → text renders black, so coerce it here.
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

// Emit each text node as an odf-kit run, translating its TipTap marks/attrs into
// TextFormatting (bold/italic/underline, font family/size, colour, highlight).
function applyRuns(p: ParagraphBuilder | CellBuilder, content: TiptapNode[] = []) {
  for (const node of content) {
    if (node.type !== 'text' || !node.text) continue;
    const marks = node.marks ?? [];
    const tsm = marks.find(m => m.type === 'textStyle');
    const fmt: TextFormatting = {};
    if (marks.some(m => m.type === 'bold'))      fmt.bold = true;
    if (marks.some(m => m.type === 'italic'))     fmt.italic = true;
    if (marks.some(m => m.type === 'underline'))  fmt.underline = true;
    if (marks.some(m => m.type === 'strike'))     fmt.strikethrough = true;
    if (marks.some(m => m.type === 'superscript')) fmt.superscript = true;
    else if (marks.some(m => m.type === 'subscript')) fmt.subscript = true;
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

// Emit a cell's inline content into odf-kit's run-based CellBuilder and, in lockstep,
// return a CellBlock[] descriptor. odf-kit serializes the runs into one <text:p>;
// applyCellBlocks splits on SEG and rebuilds real <text:h>/<text:p>/<text:list>.

// A segment is one paragraph, heading, or list item's paragraph; exactly one SEG
// between consecutive segments, so splitting yields one piece per segment in DFS order.
function buildCellContent(cell: TiptapNode, c: CellBuilder): CellBlock[] {
  const blocks: CellBlock[] = [];
  const state = { emitted: false }; // whether any segment has been emitted yet

  const emitSegment = (content: TiptapNode[] | undefined) => {
    if (state.emitted) c.addText(SEG);
    state.emitted = true;
    applyRuns(c, content ?? []);
  };

  const walkList = (listNode: TiptapNode): CellListBlock => {
    const ordered = listNode.type === 'orderedList';
    const start = ordered ? ((listNode.attrs?.start as number) ?? null) : null;
    const items: CellListItem[] = [];
    for (const item of listNode.content ?? []) {
      if (item.type !== 'listItem') continue;
      const firstPara = item.content?.find(x => x.type === 'paragraph');
      emitSegment(firstPara?.content); // one segment per item, in DFS order
      const nested = item.content?.find(x => x.type === 'bulletList' || x.type === 'orderedList');
      items.push({ style: paraStyleFromAttrs(firstPara?.attrs), nested: nested ? walkList(nested) : null });
    }
    return { kind: 'list', ordered, start, items };
  };

  for (const block of cell.content ?? []) {
    if (block.type === 'paragraph') {
      emitSegment(block.content);
      blocks.push({ kind: 'paragraph', style: paraStyleFromAttrs(block.attrs) });
    } else if (block.type === 'heading') {
      emitSegment(block.content);
      blocks.push({ kind: 'heading', level: (block.attrs?.level as number) ?? 1, style: paraStyleFromAttrs(block.attrs) });
    } else if (block.type === 'bulletList' || block.type === 'orderedList') {
      blocks.push(walkList(block));
    }
  }

  // Empty cell: odf-kit emits an empty <text:p/>; record one empty paragraph so
  // applyCellBlocks stays aligned and leaves it untouched.
  if (blocks.length === 0) {
    blocks.push({ kind: 'paragraph', style: paraStyleFromAttrs(undefined) });
  }
  return blocks;
}

// Per-column widths (cm) from the table's first row: the editor's proportional
// `colwidth` weights (tableView.ts) turned into absolute cm summing to the text width.
// With table:align="margins" this matches the preview. undefined → odf-kit even split.
function tableColumnWidthsCm(node: TiptapNode, contentWidthCm: number): string[] | undefined {
  const firstRow = (node.content ?? []).find(r => r.type === 'tableRow');
  if (!firstRow) return undefined;

  const weights: (number | null)[] = [];
  for (const cell of firstRow.content ?? []) {
    if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
    const colspan = (cell.attrs?.colspan as number) ?? 1;
    const cw = cell.attrs?.colwidth as number[] | null | undefined;
    for (let k = 0; k < colspan; k++) weights.push(cw && cw[k] ? cw[k] : null);
  }
  if (weights.length === 0 || weights.every(w => w == null)) return undefined;

  const present = weights.filter((w): w is number => w != null);
  const avg = present.reduce((a, b) => a + b, 0) / present.length;
  const filled = weights.map(w => (w != null ? w : avg));
  const total = filled.reduce((a, b) => a + b, 0);

  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const cm = filled.map(w => round3((w / total) * contentWidthCm));
  // Absorb the rounding remainder into the last column so the widths sum exactly
  // to the text width (table:align="margins" scales otherwise).
  const sum = cm.reduce((a, b) => a + b, 0);
  cm[cm.length - 1] = round3(cm[cm.length - 1] + (contentWidthCm - sum));
  return cm.map(v => `${v}cm`);
}

// Build an ODF table from a CUST_TABLE node, bypassing odf-kit's native walkTable to
// pass an explicit cell border (the native path emits none → invisible). Column widths
// come from tableColumnWidthsCm; when absent odf-kit distributes columns evenly.
function exportTable(node: TiptapNode, doc: OdtDocument, contentWidthCm: number, cellBlocks: CellBlock[][]): void {
  const rows = (node.content ?? []).filter(r => r.type === 'tableRow');
  if (rows.length === 0) return;
  const columnWidths = tableColumnWidthsCm(node, contentWidthCm);
  doc.addTable((t: TableBuilder) => {
    for (const row of rows) {
      t.addRow((r: RowBuilder) => {
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
          // Emit the cell's runs (SEG-separated) and record its block descriptor.
          // addCell runs synchronously, so the push is in document order — matching
          // how applyCellBlocks later walks cells in content.xml.
          r.addCell((c: CellBuilder) => {
            cellBlocks.push(buildCellContent(cell, c));
          }, { padding: CELL_PADDING });
        }
      });
    }
  }, columnWidths ? { border: TABLE_BORDER, columnWidths } : { border: TABLE_BORDER });
}

// odf-kit joins a multi-child element's children with "\n"; inside a <text:p>/<text:h>
// that newline is significant and collapses to a space, adding a spurious space at any
// mid-word run boundary. Strip the bare "\n" separators (real spaces sit adjacent, kept).
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

  // Text width = A4 page width (portrait 21cm / landscape 29.7cm) minus the L/R
  // margins. Table column widths are scaled to fill exactly this width.
  const pageWidthCm = orientation === 'landscape' ? 29.7 : 21;
  const contentWidthCm = pageWidthCm - margins.left - margins.right;

  // Filled by exportTable, in document order, one CellBlock[] per table cell.
  // applyCellBlocks consumes it to rebuild real <text:h>/<text:p>/<text:list>.
  const cellBlocks: CellBlock[][] = [];

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
        exportTable(node, doc, contentWidthCm, cellBlocks);
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

  // Rewrite odf-kit's default numbering (1.) into the per-list style the user
  // chose (a) / I.) / …). Runs before applyListItemStyles, which only touches
  // <text:p> styles, not the <text:list-style> definitions.
  const olFormats: (OrderedFmt | null)[] = [];
  collectOrderedListFormats(raw, olFormats);
  const numberedOdt = applyOrderedListFormats(odt as Uint8Array, olFormats);

  const listStyles: ParaStyle[] = [];
  collectListItemStyles(raw, listStyles);
  const styledLists = applyListItemStyles(numberedOdt, listStyles);

  // Rebuild real headings/lists/paragraphs inside table cells. Must run after
  // applyListItemStyles (cell lists don't exist yet) and before collapseRunWhitespace.
  const styledCells = applyCellBlocks(styledLists, cellBlocks);

  const rowHeights: (string | null)[] = [];
  collectTableRowHeights(raw, rowHeights);
  const styledRows = applyTableRowHeights(styledCells, rowHeights);

  const cleaned = collapseRunWhitespace(styledRows);
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
