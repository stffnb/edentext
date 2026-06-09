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

// Sentinel inserted between a cell's blocks (and between list items) so the
// single <text:p> odf-kit emits per cell can be split back into real block
// elements in applyCellBlocks. A Unicode private-use char: never present in user
// text, and passes through odf-kit's XML escaper untouched (escapeXml only
// touches & < >) so it survives serialization as a literal, findable character.
const SEG = '';

// Automatic list styles minted for in-cell lists (see applyCellBlocks). odf-kit's
// CellBuilder is run-based, so a list inside a cell can't reference a list style it
// generates for top-level lists — we inject our own, mirroring its buildListStyle.
const CELL_LIST_BULLET_STYLE = 'TblListBullet';
const CELL_LIST_NUMBER_STYLE = 'TblListNumber';

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

// Paragraph property overrides carried over to the exported .odt. Used for both
// list-item paragraphs and table-cell paragraphs — odf-kit's ListBuilder and
// TableBuilder neither support per-paragraph alignment/spacing/line-height, so we
// inject them as automatic paragraph styles in a post-processing pass.
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

// Per-cell block descriptors, built during exportTable and consumed in document
// order by applyCellBlocks to rebuild real <text:h>/<text:p>/<text:list> elements
// from the single SEG-segmented <text:p> odf-kit emits per cell. Each paragraph,
// heading, and list *item* contributes exactly one SEG-delimited segment, in the
// same DFS order they are emitted.
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

// Collect each table row's explicit height (px → cm string), in DFS document
// order — matching the order odf-kit emits <table:table-row> into content.xml.
// rowHeight is stored as unscaled document px at 96 dpi (tableRow.ts); convert to
// cm (px × 2.54 / 96). Rows without an explicit height yield null.
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

// odf-kit's TableBuilder has no row-height option (TableRowOptions only carries
// backgroundColor → fo:background-color on style:table-row-properties). We add the
// dragged row heights by post-processing content.xml: each <table:table-row> with a
// height gets a table:style-name pointing at a new automatic table-row style with
// style:min-row-height — a *minimum*, so the row grows with content and nothing is
// clipped (round-trips with LibreOffice/Word). use-optimal-row-height="false" stops
// LibreOffice from auto-shrinking back to the content height. The regex consumes one
// heights[] entry per <table:table-row> so the DFS order from collectTableRowHeights
// stays aligned; rows already carrying a table:style-name (not produced today — the
// editor sets no row background) are skipped.
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

// odf-kit's ListBuilder doesn't support per-item paragraph options, so list-item
// paragraphs always emit with text:style-name="List_20_Bullet" or "List_20_Number".
// We rewrite content.xml to point those at custom automatic styles that inherit
// from the list paragraph style and add fo:text-align / fo:margin-top / fo:margin-bottom.
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

// odf-kit's TableBuilder serializes every cell to a single <text:p
// text:style-name="Standard"> of runs — it has no API for headings, lists, or
// multiple paragraphs in a cell. exportTable therefore emits all of a cell's
// inline content into that one paragraph, separated by SEG markers, and records a
// CellBlock[] descriptor per cell (in document order, via buildCellContent). This
// pass splits each cell paragraph back on SEG and rebuilds the real
// <text:h>/<text:p>/<text:list> elements, applying per-paragraph
// alignment/spacing/line-height overrides as minted automatic styles (same
// technique as applyListItemStyles). It subsumes the former applyTableCellStyles
// (single-paragraph cell styling).
//
// Ordering: runs *after* applyListItemStyles (so that pass sees only genuine
// top-level <text:list-item>s — cell lists are still flat runs here), and *before*
// collapseRunWhitespace (so the new in-cell <text:p>/<text:h> get their inter-run
// newlines stripped too).
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

  // Each <text:list> (root or nested) carries its own style-name based on its own
  // type, so mixed bullet/number nesting renders correctly; the actual indent
  // level comes from the DOM nesting depth. One segment is consumed per list item,
  // in DFS order — matching buildCellContent's emission.
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

  // Match each real cell's single paragraph (filled or empty form) in document
  // order. Covered cells use <table:covered-table-cell> and never match; at this
  // stage a cell holds exactly one <text:p> with no nested </text:p>, so the
  // non-greedy inner capture is safe.
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

// Emit a cell's inline content into odf-kit's run-based CellBuilder and, in
// lockstep, return a CellBlock[] descriptor of its block structure. odf-kit will
// serialize all these runs into a single <text:p>; applyCellBlocks later splits
// that paragraph on the SEG markers we insert between segments and rebuilds the
// real <text:h>/<text:p>/<text:list> elements using this descriptor.
//
// A "segment" is one paragraph, one heading, or one list item's paragraph; we
// emit exactly one SEG between consecutive segments (never leading/trailing), so
// splitting yields one piece per segment in DFS order. Headings and list items
// get no base run formatting here — the real <text:h> / List_20_* styles supply it.
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

// Derive per-column widths (in cm) from the table's first row. The editor stores
// proportional *weights* in each cell's `colwidth` attr (see tableView.ts); we turn
// those into absolute cm widths that sum exactly to the text width. Combined with
// odf-kit's table:align="margins", LibreOffice/Word render the columns at exactly
// these proportions across the full text width — identical to the editor preview.
// Returns undefined when no column has an explicit width (fresh/legacy tables) so
// odf-kit falls back to even distribution.
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

// Build an ODF table from a CUST_TABLE node (renamed from "table" in
// injectCustomTypes). We bypass odf-kit's native walkTable so we can pass an
// explicit cell border — the native path emits none, so the table would be
// invisible in LibreOffice/Word. Column widths come from the editor's per-column
// weights (tableColumnWidthsCm); when absent odf-kit distributes columns evenly.
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
          // odf-kit serializes this to one <text:p>; applyCellBlocks splits it back
          // into real <text:h>/<text:p>/<text:list> using the descriptor. The push
          // happens in document order (addCell runs the callback synchronously),
          // matching the order applyCellBlocks walks cells in content.xml.
          r.addCell((c: CellBuilder) => {
            cellBlocks.push(buildCellContent(cell, c));
          }, { padding: CELL_PADDING });
        }
      });
    }
  }, columnWidths ? { border: TABLE_BORDER, columnWidths } : { border: TABLE_BORDER });
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

  const listStyles: ParaStyle[] = [];
  collectListItemStyles(raw, listStyles);
  const styledLists = applyListItemStyles(odt as Uint8Array, listStyles);

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
