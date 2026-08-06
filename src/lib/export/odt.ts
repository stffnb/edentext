import { tiptapToOdt, type TiptapNode, type TextFormatting, type OdtDocument, type ParagraphBuilder, type TableBuilder, type RowBuilder, type CellBuilder, type CellOptions, type HeaderFooterBuilder } from 'odf-kit';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
import { HF_DISTANCE_CM, hfIsEmpty, type HfDoc } from '../storage/headerFooter';
import { builtinStyleSheet, DEFAULT_STYLE, resolveStyle, type StyleSheet, type TextProps } from '../styles/styleSheet';
import {
  TABLE_REGIONS, parseTableLook, regionText, type TableLook, type TableRegion,
} from '../styles/tableStyles';

// A table's named style plus the conditional areas it opts into (Word's Table Style
// Options), collected by exportTable in document order.
type TableStyleRef = { name: string; look: TableLook };
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { BORDER_SIDES, parseBorderAttr } from '../editor/extensions/tableCellBorders';
import { TEXTBOX_PADDING_CM } from '../editor/extensions/textBox';
import { parseTabStops } from '../editor/extensions/tabStops';
import { orderedTypeDef, effectiveOrderedDef, effectiveOrderedDefAt, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { DEFAULT_BULLET_CYCLE, defaultBulletChar } from '../utils/bulletListTypes';
import { findFormat, renderFormat, odfNumberStyle, toDateValue, toTimeValue, localeTag, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, type DtFormat } from '../utils/dateTime';

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
// Synthetic first node: routes header/footer emission through unknownNodeHandler,
// which is the only hook with access to the OdtDocument (setHeader/setFooter).
const CUST_HF = '__cust_hf__';

// Table export styling. Values mirror the editor's table CSS (src/styles/editor.css)
// so the .odt matches the on-screen preview.
const TABLE_BORDER = '0.5pt solid #000000';
// Word's/LibreOffice's cell margins, asymmetric. Must match td/th padding in editor.css.
const CELL_PADDING_X = '0.19cm';
const CELL_PADDING_Y = '0cm';
const CELL_PADDING = CELL_PADDING_X;

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

// Sentinel for hardBreak nodes: replaceHardBreaks turns them into text so every
// odf-kit path (plain paragraphs, list items, cells) carries them; applyInlineSentinels
// swaps the char for <text:line-break/> in content.xml. U+E001 (SEG is U+E000).
const LBR = '';

// Sentinel wrapping page-count digits in header/footer runs; applyHfPostProcess
// rewrites it to <text:page-count> in styles.xml. U+E002 (SEG/LBR are E000/E001).
const PGC = '';

// Sentinel for tab chars: \t collapses to a space in ODF, so replaceTabs swaps
// each tab for this before odf-kit serializes; applyInlineSentinels → <text:tab/>. U+E003.
const TAB = '';

// Sentinel wrapping an image's index (IMG{i}IMG) emitted as plain run text by
// replaceImages, so it rides every odf-kit path (body paragraphs and table cells);
// applyImages rewrites it to a <draw:frame> in content.xml. U+E004.
const IMG = '';

// Sentinel prepended to a top-level paragraph/heading carrying a manual page break
// (breakBefore: 'page'); applyPageBreaks finds the marked block in content.xml, mints a
// fo:break-before="page" paragraph style for it, and strips the sentinel. U+E005.
const PGB = '';

// Sentinel wrapping an empty line's font size (FSZ<size>FSZ), the sole text of a
// top-level empty CUST_P/CUST_H; applyEmptyLineFontSizes turns it into a paragraph
// style fo:font-size (odf-kit has no paragraph font-size option). U+E007.
const FSZ = '\uE007';

// Sentinel wrapping a top-level paragraph's box spec (PBX<bg|bt|br|bb|bl>PBX), emitted
// as the paragraph's first run; applyParagraphBoxes mints a paragraph style with
// fo:background-color/fo:border-* (odf-kit has no such options). U+E00C.
const PBX = '\uE00C';

// Sentinel wrapping a table-of-contents index (TOC{i}TOC), emitted as a marker
// paragraph's run text by replaceTableOfContents so it rides odf-kit's paragraph path;
// applyToc rewrites the whole marker <text:p> to a <text:table-of-content>. U+E006.
const TOC_SENT = '';

// Sentinel bracketing a hoisted text box's blocks (marker paragraphs TBX S{i} TBX …
// TBX E{i} TBX): replaceTextBoxes hoists the box's blocks to top level so every
// existing pass serializes them; applyTextBoxes wraps the region back into a
// <draw:frame>/<draw:text-box> or <draw:custom-shape>. U+E008.
const TBX = '';

// Sentinel bracketing a hoisted multi-column section's blocks, same mechanism as
// TBX above; applyColumns wraps the region into a <text:section> with a minted
// section style carrying <style:columns>. U+E009.
const COL = '';

// Sentinel wrapping a date/time field's index (DTF{i}DTF), emitted as plain run text
// by replaceDateTimeFields so it rides every odf-kit path; applyDateTimeFields
// rewrites it to <text:date>/<text:time> + a minted number style. U+E00A.
const DTF = '';

// Sentinel wrapping a header/footer image's index (HFIMG{i}HFIMG), emitted as plain
// run text by replaceHfImages so it rides odf-kit's header/footer path (styles.xml);
// applyHfPostProcess rewrites it to an as-char <draw:frame>. U+E00B.
const HFIMG = '';

// Sentinel wrapping the named paragraph style of a block whose style isn't the ODF
// default for its node type (STY<name>STY), emitted as plain run text so it rides the
// odf-kit path; applyParagraphStyles points the block at that style. U+E00D.
const STY = '';

// Sentinel prefixed to a run that carries a named character style (CST<name>CST);
// applyCharacterStyles points the run's span at that style. U+E00E.
const CST = '\uE00E';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

// Automatic list styles minted for in-cell lists (see applyCellBlocks). odf-kit's
// CellBuilder is run-based, so a list inside a cell can't reference a list style it
// generates for top-level lists — we inject our own, mirroring its buildListStyle.
const CELL_LIST_BULLET_STYLE = 'TblListBullet';
const CELL_LIST_NUMBER_STYLE = 'TblListNumber';

// LibreOffice's heading defaults, shown in the editor (editor.css) and written over
// odf-kit's Heading_20_N styles on export: its sizes plus the Heading style's margins.
// The importers use them as the fallback yardstick when a file declares no style.
export const HEADING_STYLE_OVERRIDES: { name: string; fontSize: string; marginTop: string; marginBottom: string }[] = [
  { name: 'Heading_20_1', fontSize: '18pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_2', fontSize: '16pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_3', fontSize: '14pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_4', fontSize: '13pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_5', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
];

// Headings are sans (LibreOffice's Heading style). On screen the bundled 'Arial'
// @font-face maps to Liberation Sans, so the declared name is metric-identical —
// the same trick as EXPORT_FONT for the serif body font.
export const HEADING_FONT = 'Arial';

// Highest heading level the editor offers (extensions.ts, both importers, TOC).
export const MAX_HEADING_LEVEL = HEADING_STYLE_OVERRIDES.length;
export const HEADING_LEVELS = HEADING_STYLE_OVERRIDES.map((_, i) => i + 1);

// The bundled screen font → the metric-identical name declared in files, so
// LibreOffice and Word render with the editor's metrics.
export function twinFontName(family: string): string {
  if (family === ODFKIT_DEFAULT_FONT) return EXPORT_FONT;
  if (family === 'Liberation Sans') return HEADING_FONT;
  return family;
}

// ODF encodes spaces in style names as _20_ ("Heading 1" → "Heading_20_1").
export function odfStyleName(name: string): string {
  return name.replace(/ /g, '_20_');
}

// The style name a block carries: its own, else the node type's default. Mirrors
// blockStyleName in editor/extensions/paragraphStyle.ts (kept local: this module is
// framework-free).
function styleOf(node: TiptapNode): string {
  const own = node.attrs?.styleName;
  if (typeof own === 'string' && own) return own;
  return isHeadingNode(node) ? `Heading ${(node.attrs?.level as number) ?? 1}` : DEFAULT_STYLE;
}

// Headings reach the handler renamed to CUST_H (injectCustomTypes).
function isHeadingNode(node: TiptapNode): boolean {
  return node.type === 'heading' || node.type === CUST_H;
}

// Styles to define in the file: every built-in (Word/LibreOffice always define their
// standard styles) plus the user styles the document actually references, with their
// parent chains.
function usedStyleNames(doc: TiptapNode, sheet: StyleSheet): Set<string> {
  const used = new Set<string>();
  const addChain = (name: string) => {
    let cur: string | null | undefined = name;
    while (cur && sheet.paragraph[cur] && !used.has(cur)) {
      used.add(cur);
      cur = sheet.paragraph[cur].parent;
    }
  };
  for (const style of Object.values(sheet.paragraph)) if (style.builtin) addChain(style.name);
  const walk = (node: TiptapNode) => {
    if (node.type === 'paragraph' || node.type === 'heading') addChain(styleOf(node));
    node.content?.forEach(walk);
  };
  walk(doc);
  return used;
}

// What odf-kit itself puts on the block, so only a differing style needs a sentinel.
function odfDefaultStyleOf(node: TiptapNode): string {
  return isHeadingNode(node) ? `Heading ${(node.attrs?.level as number) ?? 1}` : DEFAULT_STYLE;
}

function hasCustomAttrs(attrs: TiptapNode['attrs']): boolean {
  if (!attrs) return false;
  // A named style is emitted via the STY sentinel, which needs the applyRuns path.
  if (typeof attrs.styleName === 'string' && attrs.styleName) return true;
  if (attrs.lineHeight) return true;
  if (attrs.spaceBefore != null) return true;
  if (attrs.spaceAfter != null) return true;
  if (typeof attrs.fontSize === 'string' && attrs.fontSize) return true;
  if (typeof attrs.indent === 'number' && attrs.indent > 0) return true;
  if (typeof attrs.indentFirst === 'number' && attrs.indentFirst !== 0) return true;
  if (typeof attrs.tabStops === 'string' && attrs.tabStops) return true;
  if (typeof attrs.backgroundColor === 'string' && attrs.backgroundColor) return true;
  if (attrs.widowControl === false) return true;
  for (const s of ['borderTop', 'borderRight', 'borderBottom', 'borderLeft'])
    if (typeof attrs[s] === 'string' && attrs[s] && attrs[s] !== 'none') return true;
  const ta = attrs.textAlign;
  return ta === 'left' || ta === 'center' || ta === 'right' || ta === 'justify';
}

// odf-kit's native run handling ignores the fontWeight textStyle attr (used to
// un-bold heading text), so such blocks must go through applyRuns via CUST_P/_H.
function hasFontWeightRun(content: TiptapNode['content']): boolean {
  return !!content?.some(c =>
    c.type === 'text' && c.marks?.some(m => m.type === 'textStyle' && m.attrs?.fontWeight),
  );
}

// Same for a named character style: only applyRuns emits its CST sentinel.
function hasCharStyleRun(content: TiptapNode['content']): boolean {
  return !!content?.some(c => c.type === 'text' && !!charStyleOf(c.marks));
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
  if (!inContainer && (hasCustomAttrs(node.attrs) || hasFontWeightRun(node.content) || hasCharStyleRun(node.content))) {
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

// Turn hardBreak nodes into LBR-sentinel text nodes so they ride through every
// odf-kit serialization path as plain run text; applyInlineSentinels rewrites the char
// to <text:line-break/> in content.xml afterwards.
function replaceHardBreaks(node: TiptapNode): TiptapNode {
  if (!node.content?.length) return node;
  return {
    ...node,
    content: node.content.map(c =>
      c.type === 'hardBreak'
        ? { type: 'text', text: LBR, ...(c.marks ? { marks: c.marks } : {}) }
        : replaceHardBreaks(c),
    ),
  };
}

// Swap each tab character in run text for the TAB sentinel so it survives odf-kit
// serialization (a literal \t would collapse to a space); applyInlineSentinels
// rewrites it to <text:tab/> in content.xml afterwards.
function replaceTabs(node: TiptapNode): TiptapNode {
  if (node.type === 'text' && node.text?.includes('\t')) {
    return { ...node, text: node.text.split('\t').join(TAB) };
  }
  if (!node.content?.length) return node;
  return { ...node, content: node.content.map(replaceTabs) };
}

// Prepend a PGB sentinel run to each top-level paragraph/heading with breakBefore so it
// rides every odf-kit path; applyPageBreaks resolves it. Top-level only: a sentinel in a
// cell/list paragraph would corrupt the SEG-based cell/list rebuild (applyCellBlocks).
function replacePageBreaks(doc: TiptapNode): TiptapNode {
  if (!doc.content?.length) return doc;
  return {
    ...doc,
    content: doc.content.map(child => {
      if ((child.type === 'paragraph' || child.type === 'heading') && child.attrs?.breakBefore === 'page') {
        return { ...child, content: [{ type: 'text', text: PGB }, ...(child.content ?? [])] };
      }
      return child;
    }),
  };
}

// One embedded picture, collected by replaceImages and emitted by applyImages.
// bytes is ArrayBuffer-backed to match fflate's zip entry map. rotationDeg is CW;
// wrap floats the frame at its anchor paragraph (left/right/top-bottom).
type WrapMode = 'inline' | 'left' | 'right' | 'topBottom';
type ImageExport = { path: string; bytes: Uint8Array<ArrayBuffer>; mimeType: string; widthCm: number; heightCm: number; alt: string; rotationDeg: number; wrap: WrapMode };

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Decode an `image` node's data-URI src into bytes + geometry. width/height are
// px @96dpi → cm via round3 (sub-pixel, matches table column widths), so an
// integer-px image round-trips exactly. Returns null for a non-data/empty src.
function imageDescriptor(node: TiptapNode, index: number, namePrefix = 'image'): ImageExport | null {
  const src = node.attrs?.src;
  if (typeof src !== 'string' || !src.startsWith('data:')) return null;
  const m = /^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/.exec(src);
  if (!m) return null;
  const mimeType = m[1] || 'image/png';
  const isB64 = (m[2] ?? '').includes('base64');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = isB64 ? base64ToBytes(m[3]) : new Uint8Array(new TextEncoder().encode(decodeURIComponent(m[3])));
  } catch {
    return null;
  }
  if (!bytes.length) return null;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const pxToCm = (px: number) => round3((px * 2.54) / 96);
  const w = typeof node.attrs?.width === 'number' ? node.attrs.width : 0;
  const h = typeof node.attrs?.height === 'number' ? node.attrs.height : 0;
  const wrapAttr = node.attrs?.wrap;
  const wrap: WrapMode = wrapAttr === 'left' || wrapAttr === 'right' || wrapAttr === 'topBottom' ? wrapAttr : 'inline';
  return {
    path: `Pictures/${namePrefix}${index + 1}.${EXT_BY_MIME[mimeType] ?? 'png'}`,
    bytes,
    mimeType,
    widthCm: w > 0 ? pxToCm(w) : 0,
    heightCm: h > 0 ? pxToCm(h) : 0,
    alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt : '',
    rotationDeg: typeof node.attrs?.rotation === 'number' ? node.attrs.rotation : 0,
    wrap,
  };
}

// Replace every inline `image` node with an IMG-sentinel text node and collect its
// bytes/geometry. Runs before odf-kit serialization so the sentinel rides through
// both the native paragraph path and our cell path; applyImages resolves it later.
function replaceImages(node: TiptapNode, images: ImageExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  for (const child of node.content) {
    if (child.type === 'image') {
      const desc = imageDescriptor(child, images.length);
      if (desc) {
        images.push(desc);
        content.push({ type: 'text', text: `${IMG}${images.length - 1}${IMG}` });
      }
      continue; // invalid image → dropped
    }
    content.push(replaceImages(child, images));
  }
  return { ...node, content };
}

// A header/footer paragraph's inline images → HFIMG-sentinel text runs (forced
// as-character), collected into `images` under a distinct Pictures/hfImage* name so
// applyHfRuns/hfFirstZoneXml carry the sentinel and applyHfPostProcess resolves it.
function replaceHfImages(para: TiptapNode | null, images: ImageExport[]): TiptapNode | null {
  if (!para?.content?.length) return para;
  const content: TiptapNode[] = [];
  for (const child of para.content) {
    if (child.type === 'image') {
      const desc = imageDescriptor(child, images.length, 'hfImage');
      if (desc) {
        images.push(desc);
        content.push({ type: 'text', text: `${HFIMG}${images.length - 1}${HFIMG}` });
      }
      continue; // invalid image → dropped
    }
    content.push(child);
  }
  return { ...para, content };
}

// One inserted date/time field, collected by replaceDateTimeFields and emitted by
// applyDateTimeFields. `value` is the field's stored moment (ISO local datetime).
type DateTimeFieldExport = { kind: 'date' | 'time'; format: string; fixed: boolean; value: string };

// Replace every inline `dateTimeField` node with a DTF-sentinel text run (carrying
// the node's marks) and collect its attrs; mirrors replaceImages so the sentinel
// rides every odf-kit path. applyDateTimeFields resolves it after serialization.
function replaceDateTimeFields(node: TiptapNode, fields: DateTimeFieldExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  for (const child of node.content) {
    if (child.type === 'dateTimeField') {
      const a = child.attrs ?? {};
      fields.push({
        kind: a.kind === 'time' ? 'time' : 'date',
        format: typeof a.format === 'string' ? a.format : '',
        fixed: a.fixed === true,
        value: typeof a.value === 'string' ? a.value : '',
      });
      content.push({ type: 'text', text: `${DTF}${fields.length - 1}${DTF}`, marks: child.marks });
      continue;
    }
    content.push(replaceDateTimeFields(child, fields));
  }
  return { ...node, content };
}

// One text box / shape, collected by replaceTextBoxes and emitted by applyTextBoxes.
type ShapeKind = 'textbox' | 'roundRect' | 'ellipse';
type TextBoxExport = {
  widthCm: number;
  heightCm: number;
  rotationDeg: number;
  wrap: WrapMode;
  shapeKind: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidthPt: number;
};

function textBoxDescriptor(node: TiptapNode): TextBoxExport {
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const pxToCm = (px: number) => round3((px * 2.54) / 96);
  const a = node.attrs ?? {};
  const wrapAttr = a.wrap;
  const kind = a.shapeKind;
  return {
    widthCm: pxToCm(typeof a.width === 'number' && a.width > 0 ? a.width : 280),
    heightCm: pxToCm(typeof a.height === 'number' && a.height > 0 ? a.height : 96),
    rotationDeg: typeof a.rotation === 'number' ? a.rotation : 0,
    wrap: wrapAttr === 'left' || wrapAttr === 'right' || wrapAttr === 'topBottom' ? wrapAttr : 'inline',
    shapeKind: kind === 'roundRect' || kind === 'ellipse' ? kind : 'textbox',
    fill: typeof a.fillColor === 'string' && a.fillColor ? a.fillColor : null,
    stroke: typeof a.strokeColor === 'string' && a.strokeColor ? a.strokeColor : null,
    strokeWidthPt: typeof a.strokeWidthPt === 'number' && a.strokeWidthPt > 0 ? a.strokeWidthPt : 1,
  };
}

// Swap each top-level textBox for a pair of marker paragraphs bracketing its child
// blocks, hoisted to top level. The hoisted blocks then ride every existing export
// pass unchanged (custom attrs, list styles, inline sentinels, images); applyTextBoxes
// re-wraps the serialized region into the drawing element. Top-level only by schema.
function replaceTextBoxes(doc: TiptapNode, boxes: TextBoxExport[]): TiptapNode {
  if (!doc.content?.length) return doc;
  const content: TiptapNode[] = [];
  for (const child of doc.content) {
    if (child.type === 'textBox') {
      const i = boxes.length;
      boxes.push(textBoxDescriptor(child));
      content.push({ type: 'paragraph', content: [{ type: 'text', text: `${TBX}S${i}${TBX}` }] });
      content.push(...(child.content ?? []));
      content.push({ type: 'paragraph', content: [{ type: 'text', text: `${TBX}E${i}${TBX}` }] });
      continue;
    }
    content.push(child);
  }
  return { ...doc, content };
}

// A multi-column section's geometry, collected by replaceColumns.
type ColumnsExport = { count: number; gapCm: number };

function columnsDescriptor(node: TiptapNode): ColumnsExport {
  const a = node.attrs ?? {};
  const count = typeof a.count === 'number' ? Math.min(3, Math.max(2, Math.round(a.count))) : 2;
  const gapRaw = typeof a.gapCm === 'number' && Number.isFinite(a.gapCm) ? a.gapCm : 0.5;
  const clamped = Math.min(5, Math.max(0, gapRaw));
  return { count, gapCm: Math.round(clamped * 1000) / 1000 };
}

// Re-merge paragraphs split by columnsFlow at a page boundary (the second part
// carries the layout-internal joinPrev attr) — the file must hold ONE paragraph.
// Also used by the DOCX exporter.
export function mergeJoinedParagraphsJson(blocks: TiptapNode[]): TiptapNode[] {
  const out: TiptapNode[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.type === 'paragraph' && b.attrs?.joinPrev && prev?.type === 'paragraph') {
      out[out.length - 1] = { ...prev, content: [...(prev.content ?? []), ...(b.content ?? [])] };
    } else {
      out.push(b);
    }
  }
  return out;
}

// Swap each top-level columns section for marker paragraphs (same mechanism as
// replaceTextBoxes). Adjacent equal-attr fragments are a columnsFlow.ts page-split
// chain — one section, so they coalesce here.
function replaceColumns(doc: TiptapNode, cols: ColumnsExport[]): TiptapNode {
  if (!doc.content?.length) return doc;
  const content: TiptapNode[] = [];
  const children = doc.content;
  for (let c = 0; c < children.length; c++) {
    const child = children[c];
    if (child.type === 'columns') {
      const i = cols.length;
      const desc = columnsDescriptor(child);
      cols.push(desc);
      const inner: TiptapNode[] = [...(child.content ?? [])];
      while (c + 1 < children.length && children[c + 1].type === 'columns') {
        const next = columnsDescriptor(children[c + 1]);
        if (next.count !== desc.count || next.gapCm !== desc.gapCm) break;
        inner.push(...(children[c + 1].content ?? []));
        c++;
      }
      content.push({ type: 'paragraph', content: [{ type: 'text', text: `${COL}S${i}${COL}` }] });
      content.push(...mergeJoinedParagraphsJson(inner));
      content.push({ type: 'paragraph', content: [{ type: 'text', text: `${COL}E${i}${COL}` }] });
      continue;
    }
    content.push(child);
  }
  return { ...doc, content };
}

// One generated table of contents, collected by replaceTableOfContents and emitted by
// applyToc. Entries are the cached heading→page rows (the node view keeps them current).
type TocEntry = { text: string; level: number; page: number };
type TocExport = { entries: TocEntry[] };

// Swap each top-level tableOfContents node for a marker paragraph carrying the TOC
// sentinel and collect its cached entries. Top-level only (like replacePageBreaks): a
// sentinel in a cell/list paragraph would corrupt the SEG-based cell rebuild.
function replaceTableOfContents(doc: TiptapNode, tocs: TocExport[]): TiptapNode {
  if (!doc.content?.length) return doc;
  const content: TiptapNode[] = [];
  for (const child of doc.content) {
    if (child.type === 'tableOfContents') {
      const raw = Array.isArray(child.attrs?.entries) ? (child.attrs!.entries as TocEntry[]) : [];
      const entries = raw
        .filter(e => e && typeof e.text === 'string')
        .map(e => ({
          text: String(e.text),
          level: Math.min(MAX_HEADING_LEVEL, Math.max(1, Number(e.level) || 1)),
          page: Math.max(1, Number(e.page) || 1),
        }));
      tocs.push({ entries });
      content.push({ type: 'paragraph', content: [{ type: 'text', text: `${TOC_SENT}${tocs.length - 1}${TOC_SENT}` }] });
      continue;
    }
    content.push(child);
  }
  return { ...doc, content };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  // Paragraph background ("colored field") + per-side border ("rule line"). The border
  // attr value ('<W>pt solid #RRGGBB') is already a valid ODF fo:border value.
  background: string | null;
  borderTop: string | null;
  borderRight: string | null;
  borderBottom: string | null;
  borderLeft: string | null;
};

function paraStyleIsEmpty(s: ParaStyle): boolean {
  return s.align === null && s.spaceBefore === null && s.spaceAfter === null && s.lineHeight === null
    && s.background === null && s.borderTop === null && s.borderRight === null
    && s.borderBottom === null && s.borderLeft === null;
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
  const border = (v: unknown) => (typeof v === 'string' && v && v !== 'none' ? v : null);
  return {
    align: ta === 'center' || ta === 'right' || ta === 'justify' ? ta : null,
    spaceBefore: typeof sb === 'number' ? sb : null,
    spaceAfter: typeof sa === 'number' ? sa : null,
    lineHeight,
    background: typeof attrs?.backgroundColor === 'string' && attrs.backgroundColor ? attrs.backgroundColor : null,
    borderTop: border(attrs?.borderTop),
    borderRight: border(attrs?.borderRight),
    borderBottom: border(attrs?.borderBottom),
    borderLeft: border(attrs?.borderLeft),
  };
}

// fo:* paragraph-properties attribute strings for a ParaStyle override.
function paraStyleProps(style: ParaStyle): string[] {
  const props: string[] = [];
  if (style.align) props.push(`fo:text-align="${style.align}"`);
  if (style.spaceBefore != null) props.push(`fo:margin-top="${style.spaceBefore}pt"`);
  if (style.spaceAfter != null) props.push(`fo:margin-bottom="${style.spaceAfter}pt"`);
  if (style.lineHeight != null) props.push(`fo:line-height="${normalizeLineHeight(style.lineHeight)}"`);
  if (style.background) props.push(`fo:background-color="${style.background}"`);
  // The canonical border attr ('<W>pt solid #RRGGBB') is itself a valid fo:border value.
  for (const [attr, side] of [
    ['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left'],
  ] as const) {
    const v = style[attr];
    if (v) props.push(`fo:border-${side}="${v}"`);
  }
  return props;
}

// Per-cell block descriptors, built in exportTable and consumed in document order by
// applyCellBlocks to rebuild real <text:h>/<text:p>/<text:list> from the SEG-segmented
// <text:p> odf-kit emits. Each paragraph/heading/list item is one segment, in DFS order.
type CellListItem = { style: ParaStyle; nested: CellListBlock | null };
// listStyleType is the ordered list's raw attr (null = depth default / inherited
// multilevel chain); bulletChar the bullet list's marker attr (null = default cycle).
type CellListBlock = { kind: 'list'; ordered: boolean; start: number | null; listStyleType: string | null; bulletChar: string | null; items: CellListItem[] };
type CellBlock =
  | { kind: 'paragraph'; style: ParaStyle }
  | { kind: 'heading'; level: number; style: ParaStyle }
  | CellListBlock;
// A table's own margins in cm (0/0 tables are recorded as null).
type TableMargins = { ml: number; mr: number };

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

// odf-kit only writes the fo:padding shorthand, which ODF defines as one length —
// LibreOffice drops a two-value form. Cells need Word's asymmetric margins, so the
// shorthand is expanded per side (scoped to cell properties; paragraphs use it too).
function expandCellPadding(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  const perSide = `fo:padding-left="${CELL_PADDING_X}" fo:padding-right="${CELL_PADDING_X}"`
    + ` fo:padding-top="${CELL_PADDING_Y}" fo:padding-bottom="${CELL_PADDING_Y}"`;
  const content = strFromU8(contentBytes).replace(
    /(<style:table-cell-properties\b[^>]*?)fo:padding="[^"]*"/g,
    (_m, head: string) => head + perSide,
  );

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// A dragged table edge → the table style's fo:margin-left/-right + style:width (with
// odf-kit's table:align="margins" the table fills exactly what's left). odf-kit names
// table styles Table1, Table2, … in document order, matching the descriptor list.
function applyTableMargins(odtBytes: Uint8Array, margins: (TableMargins | null)[], contentWidthCm: number): Uint8Array {
  if (margins.every(m => m === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  margins.forEach((m, i) => {
    if (!m) return;
    const width = Math.round((contentWidthCm - m.ml - m.mr) * 1000) / 1000;
    content = content.replace(
      new RegExp(`(<style:style[^>]*style:name="Table${i + 1}"[^>]*>\\s*<style:table-properties)`),
      `$1 style:width="${width}cm" fo:margin-left="${m.ml}cm" fo:margin-right="${m.mr}cm"`,
    );
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// A table's named style: odf-kit's automatic Table{n} style gets it as its parent, and
// applyNamedStyles defines it in styles.xml. ODF has no banding, so only the name
// travels — the look rides on the cell attrs the style painted.
function applyTableStyleNames(odtBytes: Uint8Array, tables: (TableStyleRef | null)[]): Uint8Array {
  if (tables.every(t => t === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  let nth = 0;
  tables.forEach((ref, i) => {
    if (!ref) return;
    content = content.replace(
      new RegExp(`(<style:style[^>]*style:name="Table${i + 1}")`),
      `$1 style:parent-style-name="${odfStyleName(ref.name)}"`,
    );
  });
  // Which conditional areas the table opts into: ODF's own table:use-*-styles pair with
  // a table template, so the toggles survive a round trip through our own importer.
  // Lookahead, not \b: a hyphen is a word boundary, so \b would also match
  // <table:table-cell/-row/-column and consume the counter.
  content = content.replace(/<table:table(?=[\s>])[^>]*/g, (tag) => {
    const ref = tables[nth++];
    return ref ? `${tag} ${odfLookAttrs(ref.look)}` : tag;
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// ODF names these per conditional area on <table:table> (§ table template attributes).
export const ODF_LOOK_ATTRS: Record<TableRegion, string> = {
  headerRow: 'table:use-first-row-styles',
  lastRow: 'table:use-last-row-styles',
  firstColumn: 'table:use-first-column-styles',
  lastColumn: 'table:use-last-column-styles',
  bandedRow: 'table:use-banding-rows-styles',
  bandedColumn: 'table:use-banding-columns-styles',
};

function odfLookAttrs(look: TableLook): string {
  return TABLE_REGIONS.map(r => `${ODF_LOOK_ATTRS[r]}="${look[r]}"`).join(' ');
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

// The whole <style:style …>…</style:style> (or self-closing) for an automatic style by
// name from content.xml. null when the name is a common/named style (defined in
// styles.xml), so applyPageBreaks mints a child of it instead of cloning.
function findAutoStyle(content: string, name: string): string | null {
  const open = content.indexOf(`<style:style style:name="${name}"`);
  if (open < 0) return null;
  const gt = content.indexOf('>', open);
  if (gt < 0) return null;
  if (content[gt - 1] === '/') return content.slice(open, gt + 1);
  const closeTag = '</style:style>';
  const close = content.indexOf(closeTag, gt);
  if (close < 0) return null;
  return content.slice(open, close + closeTag.length);
}

// Clone a <style:style> definition under newName, ensuring its paragraph-properties
// carry fo:break-before="page" (paragraph-properties precedes text-properties in ODF, so
// a freshly inserted one stays first child).
function cloneStyleWithBreak(def: string, newName: string): string {
  const s = def.replace(/style:name="[^"]*"/, `style:name="${newName}"`);
  if (/fo:break-before=/.test(s)) return s;
  const pp = '<style:paragraph-properties fo:break-before="page"/>';
  if (/^<style:style\b[^>]*\/>\s*$/.test(s)) {
    return s.replace(/\/>\s*$/, `>${pp}</style:style>`);
  }
  if (/<style:paragraph-properties\b[^>]*\/>/.test(s)) {
    return s.replace(/<style:paragraph-properties\b([^>]*?)\s*\/>/, '<style:paragraph-properties$1 fo:break-before="page"/>');
  }
  if (/<style:paragraph-properties\b/.test(s)) {
    return s.replace(/<style:paragraph-properties\b([^>]*)>/, '<style:paragraph-properties$1 fo:break-before="page">');
  }
  return s.replace(/(<style:style\b[^>]*[^/]>)/, `$1${pp}`);
}

// Resolve PGB sentinels: per source style, mint a fo:break-before="page" paragraph style
// (cloning its props so blocks sharing the style aren't affected, reused across blocks),
// reassign each marked block's style-name, and strip the sentinel.
function applyPageBreaks(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(PGB)) return odtBytes;

  const minted: string[] = [];
  const nameBySource = new Map<string, string>();
  let counter = 0;

  const breakStyleFor = (source: string): string => {
    const existing = nameBySource.get(source);
    if (existing) return existing;
    const name = `PB${++counter}`;
    nameBySource.set(source, name);
    const def = source ? findAutoStyle(content, source) : null;
    minted.push(def
      ? cloneStyleWithBreak(def, name)
      : `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${source || 'Standard'}"><style:paragraph-properties fo:break-before="page"/></style:style>`,
    );
    return name;
  };

  content = content.replace(
    new RegExp(`<text:(p|h)\\b([^>]*)>${PGB}`, 'g'),
    (_m, tag: string, attrs: string) => {
      const sm = /text:style-name="([^"]*)"/.exec(attrs);
      const name = breakStyleFor(sm ? sm[1] : '');
      const newAttrs = sm
        ? attrs.replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
        : ` text:style-name="${name}"${attrs}`;
      return `<text:${tag}${newAttrs}>`;
    },
  );
  // Drop any sentinels not consumed above (defensive — never legitimate text).
  content = content.split(PGB).join('');

  if (minted.length) {
    content = content.replace('</office:automatic-styles>', `${minted.join('')}</office:automatic-styles>`);
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// fo:font-size (+ asian/complex aliases) attribute string for a paragraph style.
function fontSizeProps(size: string): string {
  return `fo:font-size="${size}" style:font-size-asian="${size}" style:font-size-complex="${size}"`;
}

// Clone a <style:style> def under newName, adding fo:font-size to its text-properties.
function cloneStyleWithFontSize(def: string, newName: string, size: string): string {
  const s = def.replace(/style:name="[^"]*"/, `style:name="${newName}"`);
  const props = fontSizeProps(size);
  if (/<style:text-properties\b[^>]*\/>/.test(s)) {
    return s.replace(/<style:text-properties\b([^>]*?)\s*\/>/, `<style:text-properties$1 ${props}/>`);
  }
  if (/<style:text-properties\b/.test(s)) {
    return s.replace(/<style:text-properties\b([^>]*)>/, `<style:text-properties$1 ${props}>`);
  }
  if (/^<style:style\b[^>]*\/>\s*$/.test(s)) {
    return s.replace(/\s*\/>\s*$/, `><style:text-properties ${props}/></style:style>`);
  }
  return s.replace('</style:style>', `<style:text-properties ${props}/></style:style>`);
}

// Resolve FSZ sentinels (empty-line font size): per (source style, size) mint a style
// cloning the source's props plus that fo:font-size, reassign the block's style-name,
// and strip the sentinel. Mirrors applyPageBreaks.
function applyEmptyLineFontSizes(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(FSZ)) return odtBytes;

  const minted: string[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;

  const sizeStyleFor = (source: string, size: string): string => {
    const key = `${source}|${size}`;
    const existing = nameByKey.get(key);
    if (existing) return existing;
    const name = `EF${++counter}`;
    nameByKey.set(key, name);
    const def = source ? findAutoStyle(content, source) : null;
    minted.push(def
      ? cloneStyleWithFontSize(def, name, size)
      : `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${source || 'Standard'}"><style:text-properties ${fontSizeProps(size)}/></style:style>`,
    );
    return name;
  };

  content = content.replace(
    new RegExp(`<text:(p|h)\\b([^>]*)>${FSZ}([^${FSZ}]*)${FSZ}`, 'g'),
    (_m, tag: string, attrs: string, size: string) => {
      const sm = /text:style-name="([^"]*)"/.exec(attrs);
      const name = sizeStyleFor(sm ? sm[1] : '', size);
      const newAttrs = sm
        ? attrs.replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
        : ` text:style-name="${name}"${attrs}`;
      return `<text:${tag}${newAttrs}>`;
    },
  );
  // Drop any sentinels not consumed above (defensive — never legitimate text).
  content = content.replace(new RegExp(`${FSZ}[^${FSZ}]*${FSZ}`, 'g'), '');

  if (minted.length) {
    content = content.replace('</office:automatic-styles>', `${minted.join('')}</office:automatic-styles>`);
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// A top-level paragraph's box spec for the PBX sentinel: bg|borderTop|Right|Bottom|Left,
// each the raw value (canonical border '<W>pt solid #RRGGBB' is a valid fo:border) or '',
// plus a widow-control flag. '' overall when the paragraph needs none of them.
function paraBoxSpec(attrs: TiptapNode['attrs']): string {
  const s = paraStyleFromAttrs(attrs);
  const noWidow = attrs?.widowControl === false;
  if (!s.background && !s.borderTop && !s.borderRight && !s.borderBottom && !s.borderLeft && !noWidow) return '';
  return [s.background, s.borderTop, s.borderRight, s.borderBottom, s.borderLeft]
    .map((v) => v ?? '').concat(noWidow ? 'w0' : '').join('|');
}

function boxSpecToProps(spec: string): string {
  const [bg, bt, br, bb, bl, widow] = spec.split('|');
  const props: string[] = [];
  if (bg) props.push(`fo:background-color="${bg}"`);
  if (bt) props.push(`fo:border-top="${bt}"`);
  if (br) props.push(`fo:border-right="${br}"`);
  if (bb) props.push(`fo:border-bottom="${bb}"`);
  if (bl) props.push(`fo:border-left="${bl}"`);
  // LibreOffice writes 0/0 for "off"; absent means the XSL-FO default of 2.
  if (widow === 'w0') props.push('fo:orphans="0"', 'fo:widows="0"');
  return props.join(' ');
}

// Add fo:* into a cloned style's <style:paragraph-properties> (which precedes text-props
// in ODF). Mirrors cloneStyleWithFontSize but for paragraph-properties.
function cloneStyleWithParaProps(def: string, newName: string, props: string): string {
  const s = def.replace(/style:name="[^"]*"/, `style:name="${newName}"`);
  if (/<style:paragraph-properties\b[^>]*\/>/.test(s))
    return s.replace(/<style:paragraph-properties\b([^>]*?)\s*\/>/, `<style:paragraph-properties$1 ${props}/>`);
  if (/<style:paragraph-properties\b/.test(s))
    return s.replace(/<style:paragraph-properties\b([^>]*)>/, `<style:paragraph-properties$1 ${props}>`);
  if (/^<style:style\b[^>]*\/>\s*$/.test(s))
    return s.replace(/\s*\/>\s*$/, `><style:paragraph-properties ${props}/></style:style>`);
  if (/<style:text-properties\b/.test(s))
    return s.replace(/<style:text-properties\b/, `<style:paragraph-properties ${props}/><style:text-properties`);
  return s.replace('</style:style>', `<style:paragraph-properties ${props}/></style:style>`);
}

// ---- named paragraph styles (styles/styleSheet.ts) --------------------------------

// Set or replace attributes on an element's opening tag.
function setTagAttrs(tag: string, attrs: Record<string, string>): string {
  let out = tag;
  for (const [name, value] of Object.entries(attrs)) {
    const re = new RegExp(`\\s${name}="[^"]*"`);
    out = re.test(out)
      ? out.replace(re, ` ${name}="${value}"`)
      : out.replace(/(\/?>)$/, ` ${name}="${value}"$1`);
  }
  return out;
}

// Merge attributes into a style's <style:paragraph-properties>/<style:text-properties>,
// keeping whatever the producer already put there (language, keep-with-next, …).
function upsertProps(block: string, kind: 'paragraph' | 'text', attrs: Record<string, string>): string {
  if (!Object.keys(attrs).length) return block;
  const el = `style:${kind}-properties`;
  const open = new RegExp(`<${el}\\b[^>]*>`);
  const m = open.exec(block);
  if (m) return block.replace(open, setTagAttrs(m[0], attrs));
  const props = setTagAttrs(`<${el}/>`, attrs);
  // paragraph-properties precedes text-properties in ODF.
  if (kind === 'paragraph' && block.includes('<style:text-properties'))
    return block.replace('<style:text-properties', `${props}<style:text-properties`);
  if (/^<style:style\b[^>]*\/>$/.test(block.trim()))
    return block.trim().replace(/\/>$/, `>${props}</style:style>`);
  return block.replace('</style:style>', `${props}</style:style>`);
}

// A style's OWN properties as ODF attributes — the chain stays a chain in the file,
// so only what the style itself declares is written.
function ownStyleAttrs(style: { para: Record<string, unknown>; text: Record<string, unknown> }) {
  const p = style.para as Record<string, string | number | undefined>;
  const t = style.text as Record<string, string | number | boolean | undefined>;
  const para: Record<string, string> = {};
  if (p.textAlign) para['fo:text-align'] = String(p.textAlign);
  if (p.lineHeight != null) para['fo:line-height'] = normalizeLineHeight(p.lineHeight as string | number);
  if (p.spaceBefore != null) para['fo:margin-top'] = `${p.spaceBefore}pt`;
  if (p.spaceAfter != null) para['fo:margin-bottom'] = `${p.spaceAfter}pt`;
  if (p.indent != null) para['fo:margin-left'] = `${p.indent}cm`;
  if (p.backgroundColor) para['fo:background-color'] = String(p.backgroundColor);
  for (const [key, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const v = p[key];
    if (v && v !== 'none') para[`fo:border-${side}`] = String(v);
  }
  const text: Record<string, string> = {};
  if (t.fontFamily) {
    // The registry holds the on-screen family; the file declares its metric twin.
    const font = twinFontName(String(t.fontFamily));
    text['style:font-name'] = font;
    text['style:font-name-asian'] = font;
    text['style:font-name-complex'] = font;
  }
  if (t.fontSizePt != null) {
    const size = `${t.fontSizePt}pt`;
    text['fo:font-size'] = size;
    text['style:font-size-asian'] = size;
    text['style:font-size-complex'] = size;
  }
  if (t.bold != null) text['fo:font-weight'] = t.bold ? 'bold' : 'normal';
  if (t.italic != null) text['fo:font-style'] = t.italic ? 'italic' : 'normal';
  if (t.underline) text['style:text-underline-style'] = 'solid';
  if (t.strike) text['style:text-line-through-style'] = 'solid';
  if (t.color) text['fo:color'] = String(t.color);
  return { para, text };
}

// Attributes the style model owns: dropped from a producer's block before the style's
// own values go in, so anything the style leaves open really comes from its parent.
const MANAGED_STYLE_ATTRS = [
  'fo:margin-top', 'fo:margin-bottom', 'fo:margin-left', 'fo:text-align', 'fo:line-height',
  'fo:background-color', 'fo:border-top', 'fo:border-right', 'fo:border-bottom', 'fo:border-left',
  'fo:font-size', 'style:font-size-asian', 'style:font-size-complex',
  'fo:font-weight', 'style:font-weight-asian', 'style:font-weight-complex',
  'fo:font-style', 'style:font-style-asian', 'style:font-style-complex',
  'style:text-underline-style', 'style:text-line-through-style', 'fo:color',
  'style:font-name', 'style:font-name-asian', 'style:font-name-complex',
];

function stripManagedProps(block: string): string {
  let out = block;
  for (const attr of MANAGED_STYLE_ATTRS) out = out.replace(new RegExp(`\\s${attr}="[^"]*"`, 'g'), '');
  return out;
}

// Write the document's named paragraph styles into styles.xml: merge into the blocks
// odf-kit already emits (Standard, Heading, Heading_20_N), append the rest. The parent
// chain is preserved, so LibreOffice/Word show them as real, inheriting styles.
function applyNamedStyles(styles: string, sheet: StyleSheet, used: Set<string>, usedTables: Set<string> = new Set()): string {
  const added: string[] = [];
  // Table styles: ODF's table family carries no banding, so the name is all that travels
  // (the look is baked into the cells). An empty style block is enough to make it real.
  for (const name of usedTables) {
    const odfName = odfStyleName(name);
    if (findAutoStyle(styles, odfName)) continue;
    added.push(setTagAttrs('<style:style/>', {
      'style:name': odfName, 'style:family': 'table', 'style:display-name': name,
    }));
  }
  // Character styles are the same shape, family "text" and text props only.
  for (const style of Object.values(sheet.character ?? {})) {
    const { text } = ownStyleAttrs(style);
    if (!Object.keys(text).length) continue;
    const odfName = odfStyleName(style.name);
    if (findAutoStyle(styles, odfName)) continue;
    const attrs: Record<string, string> = {
      'style:name': odfName, 'style:family': 'text', 'style:display-name': style.name,
    };
    added.push(upsertProps(`${setTagAttrs('<style:style/>', attrs).replace('/>', '>')}</style:style>`, 'text', text));
  }
  for (const style of Object.values(sheet.paragraph)) {
    if (!used.has(style.name)) continue;
    const odfName = odfStyleName(style.name);
    const { para, text } = ownStyleAttrs(style);
    const existing = findAutoStyle(styles, odfName);
    if (existing) {
      let block = stripManagedProps(existing);
      if (style.parent) block = block.replace(/^<style:style\b[^>]*?(\/?)>/, (tag) =>
        setTagAttrs(tag, { 'style:parent-style-name': odfStyleName(style.parent!) }));
      block = upsertProps(upsertProps(block, 'paragraph', para), 'text', text);
      styles = styles.replace(existing, block);
      continue;
    }
    const attrs: Record<string, string> = {
      'style:name': odfName, 'style:family': 'paragraph', 'style:display-name': style.name,
    };
    if (style.parent) attrs['style:parent-style-name'] = odfStyleName(style.parent);
    if (style.next) attrs['style:next-style-name'] = odfStyleName(style.next);
    let block = `${setTagAttrs('<style:style/>', attrs).replace('/>', '>')}</style:style>`;
    block = upsertProps(upsertProps(block, 'paragraph', para), 'text', text);
    added.push(block);
  }
  return added.length ? styles.replace('</office:styles>', `${added.join('')}</office:styles>`) : styles;
}

// Resolve STY sentinels: point each marked block at its named style — directly when it
// carries no direct formatting, else via a clone of its automatic style whose parent
// becomes the named one (so hard formatting keeps overriding the style, as in LO).
function applyParagraphStyles(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(STY)) return odtBytes;

  const minted: string[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;

  const styleFor = (source: string, styleName: string): string => {
    const odfName = odfStyleName(styleName);
    const auto = source ? findAutoStyle(content, source) : null;
    if (!auto) return odfName; // no direct formatting: reference the style itself
    const key = `${source}|${odfName}`;
    const existing = nameByKey.get(key);
    if (existing) return existing;
    const name = `PS${++counter}`;
    nameByKey.set(key, name);
    minted.push(
      auto
        .replace(/style:name="[^"]*"/, `style:name="${name}"`)
        .replace(/^<style:style\b[^>]*?(\/?)>/, (tag) =>
          setTagAttrs(tag, { 'style:parent-style-name': odfName })),
    );
    return name;
  };

  const styRe = new RegExp(`${STY}([^${STY}]*)${STY}`);
  content = content.replace(
    new RegExp(`<text:(p|h)\\b([^>]*)>([\\s\\S]*?)</text:\\1>`, 'g'),
    (m, tag: string, attrs: string, inner: string) => {
      const sm = styRe.exec(inner);
      if (!sm) return m;
      const cleaned = inner.replace(styRe, '');
      const srcM = /text:style-name="([^"]*)"/.exec(attrs);
      const name = styleFor(srcM ? srcM[1] : '', sm[1]);
      const newAttrs = srcM
        ? attrs.replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
        : ` text:style-name="${name}"${attrs}`;
      return `<text:${tag}${newAttrs}>${cleaned}</text:${tag}>`;
    },
  );
  content = content.replace(new RegExp(`${STY}[^${STY}]*${STY}`, 'g'), '');

  if (minted.length) {
    content = content.replace('</office:automatic-styles>', `${minted.join('')}</office:automatic-styles>`);
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Resolve PBX sentinels: per (source style, box spec) mint a paragraph style cloning the
// source plus fo:background-color/fo:border-*, reassign the block, and strip the sentinel.
// Mirrors applyEmptyLineFontSizes; runs after it so an empty line's FSZ is already resolved.
function applyParagraphBoxes(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(PBX)) return odtBytes;

  const minted: string[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;

  const boxStyleFor = (source: string, spec: string): string => {
    const key = `${source}|${spec}`;
    const existing = nameByKey.get(key);
    if (existing) return existing;
    const name = `PB${++counter}`;
    nameByKey.set(key, name);
    const props = boxSpecToProps(spec);
    const def = source ? findAutoStyle(content, source) : null;
    minted.push(def
      ? cloneStyleWithParaProps(def, name, props)
      : `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${source || 'Standard'}"><style:paragraph-properties ${props}/></style:style>`,
    );
    return name;
  };

  const pbxRe = new RegExp(`${PBX}([^${PBX}]*)${PBX}`);
  content = content.replace(
    new RegExp(`<text:(p|h)\\b([^>]*)>([\\s\\S]*?)</text:\\1>`, 'g'),
    (m, tag: string, attrs: string, inner: string) => {
      const sm = pbxRe.exec(inner);
      if (!sm) return m;
      const cleaned = inner.replace(pbxRe, '');
      const srcM = /text:style-name="([^"]*)"/.exec(attrs);
      const name = boxStyleFor(srcM ? srcM[1] : '', sm[1]);
      const newAttrs = srcM
        ? attrs.replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
        : ` text:style-name="${name}"${attrs}`;
      return `<text:${tag}${newAttrs}>${cleaned}</text:${tag}>`;
    },
  );
  // Drop any sentinels not consumed above (defensive — never legitimate text).
  content = content.replace(new RegExp(`${PBX}[^${PBX}]*${PBX}`, 'g'), '');

  if (minted.length) {
    content = content.replace('</office:automatic-styles>', `${minted.join('')}</office:automatic-styles>`);
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// odf-kit always emits ordered lists as "1." at every level. This rewrites the
// matching L# list style per level: the depth-default cycle (1. → a. → i.), explicit
// listStyleType attrs, or the multilevel chain (decimal + text:display-levels).
type OrderedFmt = { numFormat: string; numSuffix: string };
type OlStyleFix = { fmts: OrderedFmt[]; multilevel: boolean };

const DEFAULT_ORDERED_FMTS: OrderedFmt[] = Array.from({ length: 6 }, (_, i) => {
  const d = effectiveOrderedDef(null, i);
  return { numFormat: d.numFormat, numSuffix: d.numSuffix };
});
const MULTILEVEL_FMTS: OrderedFmt[] = Array.from({ length: 6 }, () => ({ numFormat: '1', numSuffix: '.' }));

// Effective numbering of an ordered list at a cycle position: its attr, else the
// cycle default (re-anchoring slot + suffix at explicit styles; 'multilevel' handled
// by the callers).
function effOrderedFmt(list: TiptapNode, cycle: OrderedCycle): OrderedFmt {
  const key = list.attrs?.listStyleType as string | null | undefined;
  const def = effectiveOrderedDefAt(key === 'multilevel' ? 'decimal' : key, cycle);
  return { numFormat: def.numFormat, numSuffix: def.numSuffix };
}

// Per-level numbering for a list subtree — same DFS-first model as bulletCharVector,
// threading each list's cycle position down so nested defaults advance past their parent.
function orderedFmtVector(list: TiptapNode, startDepth: number, base: OrderedFmt[], startCycle: OrderedCycle): OrderedFmt[] {
  const vec = [...base];
  const seen = new Set<number>();
  const walk = (node: TiptapNode, depth: number, cycle: OrderedCycle) => {
    if (depth > vec.length) return;
    if (node.type === 'orderedList' && !seen.has(depth)) {
      seen.add(depth);
      vec[depth - 1] = effOrderedFmt(node, cycle);
    }
    const cChild = childCycle(cycle, node.attrs?.listStyleType as string | null | undefined, node.type === 'orderedList');
    for (const item of node.content ?? []) {
      if (item.type !== 'listItem') continue;
      for (const child of item.content ?? []) {
        if (child.type === 'bulletList' || child.type === 'orderedList') walk(child, depth + 1, cChild);
      }
    }
  };
  walk(list, startDepth, startCycle);
  return vec;
}

function collectOrderedListFormats(node: TiptapNode, result: (OlStyleFix | null)[]): void {
  for (const child of node.content ?? []) {
    if (child.type === 'bulletList') {
      result.push(null);
    } else if (child.type === 'orderedList') {
      if (child.attrs?.listStyleType === 'multilevel') {
        result.push({ fmts: MULTILEVEL_FMTS, multilevel: true });
      } else {
        const vec = orderedFmtVector(child, 1, DEFAULT_ORDERED_FMTS, ROOT_ORDERED_CYCLE);
        // odf-kit's own output is all-decimal; only an all-"1." vector needs no rewrite.
        result.push(vec.every(f => f.numFormat === '1' && f.numSuffix === '.') ? null : { fmts: vec, multilevel: false });
      }
    }
  }
}

function applyOrderedListFormats(odtBytes: Uint8Array, formats: (OlStyleFix | null)[]): Uint8Array {
  if (formats.every(f => f === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  formats.forEach((fix, i) => {
    if (!fix) return;
    // Rewrite only inside this list's own <text:list-style> block, level by level.
    const re = new RegExp(`(<text:list-style style:name="L${i + 1}">)([\\s\\S]*?)(</text:list-style>)`);
    content = content.replace(re, (_m, open: string, body: string, close: string) =>
      open +
      body.replace(
        /(<text:list-level-style-number text:level=")(\d)(" style:num-format=")[^"]*(" style:num-suffix=")[^"]*(")/g,
        (_mm, a: string, lvl: string, b: string, c: string, d: string) => {
          const f = fix.fmts[+lvl - 1] ?? DEFAULT_ORDERED_FMTS[+lvl - 1];
          const disp = fix.multilevel && +lvl > 1 ? ` text:display-levels="${lvl}"` : '';
          return a + lvl + b + f.numFormat + c + f.numSuffix + d + disp;
        },
      ) +
      close,
    );
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// One slot per top-level list (matching odf-kit's L# order): an ordered list's
// start value when >1 (a continued Word list), else null.
function collectListStartValues(node: TiptapNode, result: (number | null)[]): void {
  for (const child of node.content ?? []) {
    if (child.type === 'bulletList') {
      result.push(null);
    } else if (child.type === 'orderedList') {
      const s = child.attrs?.start;
      result.push(typeof s === 'number' && s > 1 ? s : null);
    }
  }
}

// odf-kit drops the ordered-list `start` attr, so a list continued across an intervening
// paragraph would restart at 1. Add text:start-value to each such list's first item.
function applyListStartValues(odtBytes: Uint8Array, starts: (number | null)[]): Uint8Array {
  if (starts.every(s => s === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  starts.forEach((start, i) => {
    if (start == null) return;
    const re = new RegExp(`(<text:list text:style-name="L${i + 1}"[^>]*>\\s*<text:list-item)>`);
    content = content.replace(re, `$1 text:start-value="${start}">`);
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Effective marker char of a bullet list at a 1-based depth: its bulletChar attr,
// else the default cycle.
function effBulletChar(list: TiptapNode, depth: number): string {
  const ch = list.attrs?.bulletChar;
  return typeof ch === 'string' && ch ? ch : defaultBulletChar(depth - 1);
}

// Per-level marker chars for a list subtree: slot d-1 = the DFS-first bullet list
// at depth d (one list style governs the whole tree, so the first list met at a depth
// defines that level; differing siblings get NL mints; unvisited depths keep `base`).
function bulletCharVector(list: TiptapNode, startDepth: number, base: string[]): string[] {
  const vec = [...base];
  const seen = new Set<number>();
  const walk = (node: TiptapNode, depth: number) => {
    if (depth > vec.length) return;
    if (node.type === 'bulletList' && !seen.has(depth)) {
      seen.add(depth);
      vec[depth - 1] = effBulletChar(node, depth);
    }
    for (const item of node.content ?? []) {
      if (item.type !== 'listItem') continue;
      for (const child of item.content ?? []) {
        if (child.type === 'bulletList' || child.type === 'orderedList') walk(child, depth + 1);
      }
    }
  };
  walk(list, startDepth);
  return vec;
}

// odf-kit emits every bullet level with the default cycle char. This rewrites the
// matching L# list style to the per-level chars of the user's bulletChar attrs;
// chars[] has one entry per top-level list (null = ordered or all-default).
function collectBulletListChars(node: TiptapNode, result: (string[] | null)[]): void {
  for (const child of node.content ?? []) {
    if (child.type === 'orderedList') {
      result.push(null);
    } else if (child.type === 'bulletList') {
      const vec = bulletCharVector(child, 1, DEFAULT_BULLET_CYCLE);
      result.push(vec.every((c, i) => c === DEFAULT_BULLET_CYCLE[i]) ? null : vec);
    }
  }
}

function applyBulletListChars(odtBytes: Uint8Array, chars: (string[] | null)[]): Uint8Array {
  if (chars.every(c => c === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  chars.forEach((vec, i) => {
    if (!vec) return;
    // Rewrite only inside this list's own <text:list-style> block (all 6 levels).
    const re = new RegExp(`(<text:list-style style:name="L${i + 1}">)([\\s\\S]*?)(</text:list-style>)`);
    content = content.replace(re, (_m, open: string, body: string, close: string) =>
      open +
      body.replace(
        /(<text:list-level-style-bullet text:level=")(\d)(" text:bullet-char=")[^"]*(")/g,
        (_mm, a: string, lvl: string, b: string, c: string) => a + lvl + b + (vec[+lvl - 1] ?? defaultBulletChar(+lvl - 1)) + c,
      ) +
      close,
    );
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Whole-list indent (cm) on a top-level bulletList/orderedList. odf-kit uses
// label-alignment mode (ignores the paragraph margin), so the shift goes onto the L#
// list-style's per-level fo:margin-left + text:list-tab-stop-position. One per list (0=none).
function collectListIndents(node: TiptapNode, result: number[]): void {
  for (const child of node.content ?? []) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      const ind = child.attrs?.indent;
      result.push(typeof ind === 'number' && ind > 0 ? ind : 0);
    }
  }
}

function applyListIndents(odtBytes: Uint8Array, indents: number[]): Uint8Array {
  if (indents.every(v => !v)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const bump = (cm: number) => (_m: string, attr: string, v: string) =>
    `${attr}="${(parseFloat(v) + cm).toFixed(3)}cm"`;

  indents.forEach((cm, i) => {
    if (!cm) return;
    const re = new RegExp(`(<text:list-style style:name="L${i + 1}">)([\\s\\S]*?)(</text:list-style>)`);
    content = content.replace(re, (_m, open: string, body: string, close: string) =>
      open +
      body
        .replace(/(fo:margin-left)="([\d.]+)cm"/g, bump(cm))
        .replace(/(text:list-tab-stop-position)="([\d.]+)cm"/g, bump(cm)) +
      close,
    );
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// odf-kit emits nested lists as bare <text:list> sharing the top-level L# style, so a
// nested list of a different kind/format/marker loses its look. Mint it its own
// 6-level list style (same pattern applyCellBlocks uses for cell lists).
type ListDef = { ordered: boolean; multilevel: boolean; fmts: OrderedFmt[]; bulletChars: string[] };

function listDefOf(node: TiptapNode, depth: number, cycle: OrderedCycle, baseChars: string[], baseFmts: OrderedFmt[]): ListDef {
  const multilevel = node.attrs?.listStyleType === 'multilevel';
  return {
    ordered: node.type === 'orderedList',
    multilevel,
    fmts: multilevel ? MULTILEVEL_FMTS : orderedFmtVector(node, depth, baseFmts, cycle),
    bulletChars: bulletCharVector(node, depth, baseChars),
  };
}

// One entry per nested <text:list> in DFS order (null = inherits its governing
// style correctly). Only walks top-level lists — cell lists never emit bare tags.
function collectNestedListFixes(doc: TiptapNode, result: (ListDef | null)[]): void {
  const walkList = (list: TiptapNode, governing: ListDef, isTop: boolean, depth: number, cycle: OrderedCycle) => {
    let gov = governing;
    if (!isTop) {
      const ordered = list.type === 'orderedList';
      let differs: boolean;
      if (ordered !== governing.ordered) {
        differs = true;
      } else if (!ordered) {
        differs = effBulletChar(list, depth) !== governing.bulletChars[(depth - 1) % governing.bulletChars.length];
      } else if (governing.multilevel) {
        // Attr-less lists inherit the chain; only an explicit style breaks out.
        const attr = list.attrs?.listStyleType;
        differs = !!attr && attr !== 'multilevel';
      } else {
        const f = effOrderedFmt(list, cycle);
        const g = governing.fmts[(depth - 1) % governing.fmts.length];
        differs = f.numFormat !== g.numFormat || f.numSuffix !== g.numSuffix;
      }
      const def = differs ? listDefOf(list, depth, cycle, governing.bulletChars, governing.fmts) : null;
      result.push(def);
      if (def) gov = def; // restyled list governs its own descendants
    }
    const cChild = childCycle(cycle, list.attrs?.listStyleType as string | null | undefined, list.type === 'orderedList');
    for (const item of list.content ?? []) {
      if (item.type !== 'listItem') continue;
      for (const child of item.content ?? []) {
        if (child.type === 'bulletList' || child.type === 'orderedList') walkList(child, gov, false, depth + 1, cChild);
      }
    }
  };
  for (const child of doc.content ?? []) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      walkList(child, listDefOf(child, 1, ROOT_ORDERED_CYCLE, DEFAULT_BULLET_CYCLE, DEFAULT_ORDERED_FMTS), true, 1, ROOT_ORDERED_CYCLE);
    }
  }
}

function applyNestedListTypes(odtBytes: Uint8Array, fixes: (ListDef | null)[]): Uint8Array {
  if (fixes.every(f => f === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const minted: string[] = [];
  const nameByKey = new Map<string, string>();
  const styleFor = (fix: ListDef): string => {
    const key = fix.ordered
      ? `o|${fix.multilevel ? 'M' : ''}|${fix.fmts.map(f => f.numFormat + f.numSuffix).join('')}`
      : `b|${fix.bulletChars.join('')}`;
    let name = nameByKey.get(key);
    if (!name) {
      name = `NL${nameByKey.size + 1}`;
      nameByKey.set(key, name);
      minted.push(buildCellListStyle(name, fix.ordered, { fmts: fix.fmts, multilevel: fix.multilevel, bulletChars: fix.bulletChars }));
    }
    return name;
  };

  // Bare <text:list> tags are exactly odf-kit's nested lists, in DFS order.
  let idx = 0;
  content = content.replace(/<text:list>/g, (match) => {
    const fix = fixes[idx++];
    return fix ? `<text:list text:style-name="${styleFor(fix)}">` : match;
  });

  if (minted.length) {
    content = content.replace('</office:automatic-styles>', `${minted.join('\n')}\n</office:automatic-styles>`);
  }
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Mirror odf-kit's buildListStyle (content.js) for the automatic list style our
// in-cell lists reference. Six nesting levels with the given bullet chars /
// indents / numbering, so cell lists match the editor's top-level lists.
function buildCellListStyle(
  styleName: string,
  ordered: boolean,
  opts: { fmts?: OrderedFmt[]; multilevel?: boolean; bulletChars?: string[] } = {},
): string {
  const fmts = opts.multilevel ? MULTILEVEL_FMTS : opts.fmts ?? MULTILEVEL_FMTS;
  const bulletChars = opts.bulletChars ?? DEFAULT_BULLET_CYCLE;
  let levels = '';
  for (let level = 1; level <= 6; level++) {
    const indent = level * 0.635;
    const marginLeft = `${(indent * 2).toFixed(3)}cm`;
    const textIndent = `-${indent.toFixed(3)}cm`;
    const labelAlign = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${marginLeft}" fo:text-indent="${textIndent}" fo:margin-left="${marginLeft}"/></style:list-level-properties>`;
    if (ordered) {
      const f = fmts[(level - 1) % fmts.length];
      const disp = opts.multilevel && level > 1 ? ` text:display-levels="${level}"` : '';
      levels += `<text:list-level-style-number text:level="${level}" style:num-format="${f.numFormat}" style:num-suffix="${f.numSuffix}"${disp}>${labelAlign}</text:list-level-style-number>`;
    } else {
      const ch = bulletChars[(level - 1) % bulletChars.length];
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
  // Bullet cell lists with a custom marker char get their own style carrying that
  // char at the list's own nesting depth (each <text:list> references its style
  // directly, so only the level it sits at matters).
  const bulletStyles: { name: string; chars: string[] }[] = [];
  const bulletStyleByKey = new Map<string, string>();
  const bulletStyleFor = (bulletChar: string | null, depth: number): string => {
    const ch = bulletChar ?? defaultBulletChar(depth - 1);
    if (ch === defaultBulletChar(depth - 1)) {
      usedBulletList = true;
      return CELL_LIST_BULLET_STYLE;
    }
    const key = `${ch}|${depth}`;
    let name = bulletStyleByKey.get(key);
    if (!name) {
      name = `${CELL_LIST_BULLET_STYLE}${bulletStyleByKey.size + 1}`;
      bulletStyleByKey.set(key, name);
      const chars = [...DEFAULT_BULLET_CYCLE];
      chars[(depth - 1) % chars.length] = ch;
      bulletStyles.push({ name, chars });
    }
    return name;
  };
  // One minted style per distinct numbering format (first = CELL_LIST_NUMBER_STYLE,
  // further ones counter-suffixed). The multilevel chain shares one style: nested lists
  // reference the same name, and their nesting depth selects the display-levels def.
  const numberStyles: { name: string; numFormat: string; numSuffix: string; multilevel?: boolean }[] = [];
  const numberStyleByKey = new Map<string, string>();
  const numberStyleFor = (numFormat: string, numSuffix: string, multilevel = false): string => {
    const key = multilevel ? 'ML' : `${numFormat}|${numSuffix}`;
    let name = numberStyleByKey.get(key);
    if (!name) {
      name = numberStyleByKey.size === 0 ? CELL_LIST_NUMBER_STYLE : `${CELL_LIST_NUMBER_STYLE}${numberStyleByKey.size}`;
      numberStyleByKey.set(key, name);
      numberStyles.push({ name, numFormat, numSuffix, multilevel });
    }
    return name;
  };

  // Each <text:list> (root or nested) carries its own type-based style-name, so mixed
  // bullet/number nesting renders correctly; indent comes from nesting depth. One
  // segment consumed per list item, DFS order (matching buildCellContent).
  const buildList = (list: CellListBlock, segments: string[], cur: { i: number }, depth = 1, mlGov = false, cycle: OrderedCycle = ROOT_ORDERED_CYCLE): string => {
    const isBullet = !list.ordered;
    const ml = !isBullet && (list.listStyleType === 'multilevel' || (mlGov && !list.listStyleType));
    let listStyle: string;
    if (isBullet) {
      listStyle = bulletStyleFor(list.bulletChar, depth);
    } else if (ml) {
      listStyle = numberStyleFor('1', '.', true);
    } else {
      const def = effectiveOrderedDefAt(list.listStyleType, cycle);
      listStyle = numberStyleFor(def.numFormat, def.numSuffix);
    }
    const cChild = childCycle(cycle, list.listStyleType, list.ordered);
    const paraParent = isBullet ? 'List_20_Bullet' : 'List_20_Number';
    let out = `<text:list text:style-name="${listStyle}">`;
    list.items.forEach((item, idx) => {
      const startAttr = !isBullet && idx === 0 && list.start != null ? ` text:start-value="${list.start}"` : '';
      const seg = segments[cur.i++] ?? '';
      out += `<text:list-item${startAttr}><text:p text:style-name="${styleNameFor(paraParent, item.style)}">${seg}</text:p>`;
      if (item.nested) out += buildList(item.nested, segments, cur, depth + 1, ml, cChild);
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
  for (const { name, chars } of bulletStyles) {
    additions.push(buildCellListStyle(name, false, { bulletChars: chars }));
  }
  for (const { name, numFormat, numSuffix, multilevel } of numberStyles) {
    additions.push(buildCellListStyle(name, true, { fmts: Array.from({ length: 6 }, () => ({ numFormat, numSuffix })), multilevel }));
  }

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
function rewriteStylesXml(odtBytes: Uint8Array, lang: { language: string; country: string } | null, pageFormat: PageFormat, orientation: Orientation, sheet: StyleSheet, used: Set<string>, usedTables: Set<string> = new Set()): Uint8Array {
  const files = unzipSync(odtBytes);
  const stylesBytes = files['styles.xml'];
  if (!stylesBytes) return odtBytes;

  let styles = strFromU8(stylesBytes);

  // Exact page box for the chosen format; odf-kit only emits its 5 presets, so
  // override the single fo:page-width/height in the page layout (round to 3 dp).
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const dims = pageDimsCm(pageFormat, orientation);
  styles = styles
    .replace(/fo:page-width="[^"]*"/, `fo:page-width="${round3(dims.w)}cm"`)
    .replace(/fo:page-height="[^"]*"/, `fo:page-height="${round3(dims.h)}cm"`);

  // Document spell-check language: set fo:language/fo:country on the base
  // Standard paragraph style, which every paragraph inherits from. LibreOffice
  // and Word read this as the document default language.
  if (lang) {
    styles = styles.replace(
      /(<style:style style:name="Standard"[\s\S]*?<style:text-properties\b[^>]*?)\/>/,
      `$1 fo:language="${lang.language}" fo:country="${lang.country}"/>`,
    );
  }

  // The only occurrences of "Liberation Serif" in styles.xml are the default
  // font-face declaration and the Standard style's font-name attributes.
  styles = styles.split(ODFKIT_DEFAULT_FONT).join(EXPORT_FONT);

  styles = styles.replace(
    '<style:master-page style:name="Default"',
    '<style:master-page style:name="Standard"',
  );

  // odf-kit's Standard style carries fo:margin-bottom="0.212cm", but the editor (like
  // LibreOffice and Word) has no paragraph spacing by default — every paragraph and list
  // item inherits this, so zero it or the export gains ~6pt per block vs. the preview.
  styles = styles.replace(
    /(<style:style style:name="Standard"[\s\S]*?<style:paragraph-properties[^>]*?)fo:margin-bottom="[^"]*"/,
    `$1fo:margin-bottom="0cm"`,
  );

  // ODF requires a font-face declaration for every referenced font name.
  styles = styles.replace(
    '</office:font-face-decls>',
    `<style:font-face style:name="${HEADING_FONT}" svg:font-family="${HEADING_FONT}" style:font-family-generic="swiss" style:font-pitch="variable"/></office:font-face-decls>`,
  );

  // The document's named paragraph styles (Standard, Heading, Heading_20_N, Title, …)
  // with their parent chain: merged into odf-kit's own blocks, appended when new.
  styles = applyNamedStyles(styles, sheet, used, usedTables);

  files['styles.xml'] = strToU8(styles);
  return rezipOdt(files);
}

// ODF requires fo:color as #RRGGBB. TipTap may store hex (color picker) or rgb(r,g,b)
// after an HTML round-trip. Anything not valid hex is silently dropped by
// Word/LibreOffice → text renders black, so coerce it here. Also used on import.
export function normalizeColor(input: string): string | undefined {
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

// Translate a TipTap mark set into odf-kit TextFormatting (bold/italic/underline,
// font family/size, colour, highlight). Shared by body runs and header/footer runs.
function formattingFromMarks(marks: TiptapNode['marks'] = []): TextFormatting {
  const tsm = marks.find(m => m.type === 'textStyle');
  const fmt: TextFormatting = {};
  if (marks.some(m => m.type === 'bold'))      fmt.bold = true;
  // Explicit weight (e.g. un-bolding heading text) overrides the bold shortcut.
  if (tsm?.attrs?.fontWeight) {
    const fw = String(tsm.attrs.fontWeight);
    fmt.fontWeight = (/^\d+$/.test(fw) ? Number(fw) : fw) as TextFormatting['fontWeight'];
  }
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
  return fmt;
}

// Hyperlink target of a run, if any. odf-kit's native run path handles the link mark
// itself; this covers the custom emitters (CUST_P/_H, cells) that bypass it.
function linkHrefOf(marks: TiptapNode['marks'] = []): string | undefined {
  const href = marks.find(m => m.type === 'link')?.attrs?.href;
  return href ? String(href) : undefined;
}

// Emit each text node as an odf-kit run; link-marked runs become <text:a> via addLink.
// forceBold bakes bold onto every run regardless of marks — used for header-row cells,
// whose bold is presentational (CSS) in the editor and so isn't stored as a mark.
// The sheet of the export in flight, so the run emitters can resolve character styles
// without threading it through every cell/list helper (mirrors docLangTag in docx.ts).
let exportSheet: StyleSheet = builtinStyleSheet();

function applyRuns(p: ParagraphBuilder | CellBuilder, content: TiptapNode[] = [], force: TextProps = {}) {
  const forced = Object.keys(force).length ? textFormatting(force) : null;
  for (const node of content) {
    if (node.type !== 'text' || !node.text) continue;
    const fmt = formattingFromMarks(node.marks);
    // A cell's header/region formatting is presentational (CSS) in the editor, so bake it
    // under the run's own marks; an explicit un-bold (fontWeight:normal) still wins.
    if (forced) {
      const direct = { ...fmt };
      Object.assign(fmt, forced, direct);
      if (!direct.bold && fmt.fontWeight === 'normal') delete fmt.bold;
    }
    // A named character style: bake its resolved formatting (so odf-kit always mints a
    // span) and mark the run, so applyCharacterStyles can re-point that span at the style.
    const charStyle = charStyleOf(node.marks);
    let prefix = '';
    if (charStyle) {
      // The style is the base, the run's own marks stay on top.
      const direct = { ...fmt };
      Object.assign(fmt, charFormatting(exportSheet, charStyle), direct);
      prefix = `${CST}${charStyle}${CST}`;
    }
    const f = Object.keys(fmt).length ? fmt : undefined;
    const href = linkHrefOf(node.marks);
    if (href) p.addLink(prefix + node.text, href, f);
    else p.addText(prefix + node.text, f);
  }
}

function charStyleOf(marks: TiptapNode['marks']): string | null {
  const name = marks?.find(m => m.type === 'charStyle')?.attrs?.name;
  return typeof name === 'string' && name ? name : null;
}

// A character style's resolved props as odf-kit run formatting (baked so the file still
// looks right for readers that ignore the style reference).
function charFormatting(sheet: StyleSheet, name: string): Record<string, unknown> {
  return textFormatting(resolveStyle(sheet, name, 'character').text);
}

// TextProps as odf-kit run formatting.
function textFormatting(t: TextProps): Record<string, unknown> {
  const fmt: Record<string, unknown> = {};
  if (t.bold != null) fmt.bold = t.bold;
  if (t.italic != null) fmt.italic = t.italic;
  if (t.underline) fmt.underline = true;
  if (t.strike) fmt.strikethrough = true;
  if (t.fontFamily) fmt.fontFamily = t.fontFamily === ODFKIT_DEFAULT_FONT ? EXPORT_FONT : t.fontFamily;
  if (t.fontSizePt != null) fmt.fontSize = `${t.fontSizePt}pt`;
  if (t.color) fmt.color = t.color;
  return fmt;
}

// Resolve CST sentinels: point each marked run's span at its named character style
// (a clone of the automatic style whose parent becomes the named one), then strip it.
function applyCharacterStyles(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(CST)) return odtBytes;

  const minted: string[] = [];
  const nameByKey = new Map<string, string>();
  let counter = 0;

  const styleFor = (source: string, styleName: string): string => {
    const odfName = odfStyleName(styleName);
    const auto = source ? findAutoStyle(content, source) : null;
    if (!auto) return odfName;
    const key = `${source}|${odfName}`;
    const existing = nameByKey.get(key);
    if (existing) return existing;
    const name = `TS${++counter}`;
    nameByKey.set(key, name);
    minted.push(
      auto
        .replace(/style:name="[^"]*"/, `style:name="${name}"`)
        .replace(/^<style:style\b[^>]*?(\/?)>/, (tag) => setTagAttrs(tag, { 'style:parent-style-name': odfName })),
    );
    return name;
  };

  const cstRe = new RegExp(`${CST}([^${CST}]*)${CST}`);
  content = content.replace(
    new RegExp(`<text:span\\b([^>]*)>([\\s\\S]*?)</text:span>`, 'g'),
    (m, attrs: string, inner: string) => {
      const sm = cstRe.exec(inner);
      if (!sm) return m;
      const cleaned = inner.replace(cstRe, '');
      const srcM = /text:style-name="([^"]*)"/.exec(attrs);
      const name = styleFor(srcM ? srcM[1] : '', sm[1]);
      const newAttrs = srcM
        ? attrs.replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
        : ` text:style-name="${name}"${attrs}`;
      return `<text:span${newAttrs}>${cleaned}</text:span>`;
    },
  );
  content = content.replace(new RegExp(`${CST}[^${CST}]*${CST}`, 'g'), '');

  if (minted.length) {
    content = content.replace('</office:automatic-styles>', `${minted.join('')}</office:automatic-styles>`);
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Emit the header/footer paragraph into odf-kit's HeaderFooterBuilder. hardBreak
// and pageCount ride as sentinels (LBR / PGC-wrapped digits) and are rewritten to
// <text:line-break/> / <text:page-count> in applyHfPostProcess (styles.xml).
function applyHfRuns(b: HeaderFooterBuilder, para: TiptapNode, pageCount: number): void {
  for (const node of para.content ?? []) {
    const fmt = formattingFromMarks(node.marks);
    const f = Object.keys(fmt).length ? fmt : undefined;
    if (node.type === 'text' && node.text) b.addText(node.text, f);
    else if (node.type === 'hardBreak')    b.addText(LBR);
    else if (node.type === 'pageNumber')   b.addPageNumber(f);
    else if (node.type === 'pageCount')    b.addText(`${PGC}${pageCount}${PGC}`, f);
  }
}

// Emit a cell's inline content into odf-kit's run-based CellBuilder and, in lockstep,
// return a CellBlock[] descriptor. odf-kit serializes the runs into one <text:p>;
// applyCellBlocks splits on SEG and rebuilds real <text:h>/<text:p>/<text:list>.

// A segment is one paragraph, heading, or list item's paragraph; exactly one SEG
// between consecutive segments, so splitting yields one piece per segment in DFS order.
function buildCellContent(cell: TiptapNode, c: CellBuilder, force: TextProps = {}): CellBlock[] {
  const blocks: CellBlock[] = [];
  const state = { emitted: false }; // whether any segment has been emitted yet

  const emitSegment = (content: TiptapNode[] | undefined) => {
    if (state.emitted) c.addText(SEG);
    state.emitted = true;
    applyRuns(c, content ?? [], force);
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
    // Raw attrs; applyCellBlocks resolves the depth defaults when it knows the depth.
    const listStyleType = ordered && typeof listNode.attrs?.listStyleType === 'string' ? (listNode.attrs.listStyleType as string) : null;
    const bulletChar = !ordered && typeof listNode.attrs?.bulletChar === 'string' ? (listNode.attrs.bulletChar as string) : null;
    return { kind: 'list', ordered, start, listStyleType, bulletChar, items };
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

// A table's own left/right margins (cm, from the outer-edge drag), clamped into the
// text width. null = the table spans the full text width (the common case).
function tableMarginsCm(node: TiptapNode, contentWidthCm: number): TableMargins | null {
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const ml = Math.max(0, Number(node.attrs?.marginLeft) || 0);
  const mr = Math.max(0, Number(node.attrs?.marginRight) || 0);
  if (!ml && !mr) return null;
  if (ml + mr > contentWidthCm - 1) return null;
  return { ml: round3(ml), mr: round3(mr) };
}

// Build an ODF table from a CUST_TABLE node, bypassing odf-kit's native walkTable to
// pass an explicit cell border (the native path emits none → invisible). Column widths
// come from tableColumnWidthsCm; when absent odf-kit distributes columns evenly.
function exportTable(node: TiptapNode, doc: OdtDocument, contentWidthCm: number, cellBlocks: CellBlock[][], tableMargins: (TableMargins | null)[], tableStyleNames: (TableStyleRef | null)[]): void {
  const rows = (node.content ?? []).filter(r => r.type === 'tableRow');
  if (rows.length === 0) return;
  const margins = tableMarginsCm(node, contentWidthCm);
  tableMargins.push(margins);
  // The named table style, if the registry still knows it: its name goes on the table's
  // automatic style (applyTableStyleNames), its text formatting is baked per cell.
  const styleName = typeof node.attrs?.tableStyle === 'string' ? node.attrs.tableStyle : null;
  const tableStyle = styleName ? exportSheet.table?.[styleName] : undefined;
  const look = parseTableLook(node.attrs?.tableLook);
  tableStyleNames.push(tableStyle && styleName ? { name: styleName, look } : null);
  const columnWidths = tableColumnWidthsCm(node, contentWidthCm - (margins ? margins.ml + margins.mr : 0));
  doc.addTable((t: TableBuilder) => {
    for (const row of rows) {
      t.addRow((r: RowBuilder) => {
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
          // Emit the cell's runs (SEG-separated) and record its block descriptor.
          // addCell runs synchronously, so the push is in document order — matching
          // how applyCellBlocks later walks cells in content.xml.
          // colSpan/rowSpan make odf-kit emit number-columns/rows-spanned and the
          // <table:covered-table-cell> placeholders; those never match the
          // applyCellBlocks cell regex, so cellBlocks stays one-per-real-cell aligned.
          const opts: CellOptions = { padding: CELL_PADDING };
          const colspan = (cell.attrs?.colspan as number) ?? 1;
          const rowspan = (cell.attrs?.rowspan as number) ?? 1;
          if (colspan > 1) opts.colSpan = colspan;
          if (rowspan > 1) opts.rowSpan = rowspan;
          // Cell shading → fo:background-color (odf-kit mints the cell style).
          const bg = cell.attrs?.backgroundColor;
          if (typeof bg === 'string') {
            const c = normalizeColor(bg);
            if (c) opts.backgroundColor = c;
          }
          // Per-side borders → fo:border-* (null = the table default border below).
          for (const side of BORDER_SIDES) {
            const b = parseBorderAttr(cell.attrs?.[side] as string | null);
            if (b === 'none') opts[side] = 'none';
            else if (b) opts[side] = `${b.widthPt}pt solid ${normalizeColor(b.color) ?? b.color}`;
          }
          // Header cells and a table style's regions render bold/font via CSS
          // (presentational), so bake that onto the runs for Word/LibreOffice.
          const force = regionText(tableStyle, cell.attrs?.region);
          if (bg === HEADER_SHADE) force.bold = true;
          r.addCell((c: CellBuilder) => {
            cellBlocks.push(buildCellContent(cell, c, force));
          }, opts);
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

// Rewrite the inline sentinels planted before serialization into real ODF elements:
// LBR (from replaceHardBreaks) → <text:line-break/>, TAB (from replaceTabs) →
// <text:tab/>. Both are valid as bare paragraph text and inside <text:span>.
// Also completes a decimal tab stop, which odf-kit can only write half of.
const CHAR_TAB_STOP = 'style:type="char"';

function applyInlineSentinels(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(LBR) && !content.includes(TAB) && !content.includes(CHAR_TAB_STOP)) return odtBytes;

  content = content.split(LBR).join('<text:line-break/>').split(TAB).join('<text:tab/>');
  content = content.split(CHAR_TAB_STOP).join(`${CHAR_TAB_STOP} style:char="."`);
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// ODF draw:transform for a rotated frame/shape. ODF rotate() is CCW radians (ours is
// CW degrees) about the origin, so the translate re-centres it on the unrotated box.
function frameTransform(rotationDeg: number, widthCm: number, heightCm: number): string {
  if (!rotationDeg || !widthCm || !heightCm) return '';
  const a = (-rotationDeg * Math.PI) / 180;
  const cw = widthCm / 2;
  const ch = heightCm / 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const tx = r3(cos * cw - sin * ch - cw);
  const ty = r3(sin * cw + cos * ch - ch);
  return ` draw:transform="rotate (${a.toFixed(6)}) translate (${tx}cm ${ty}cm)"`;
}

function imageTransform(img: ImageExport): string {
  return frameTransform(img.rotationDeg, img.widthCm, img.heightCm);
}

// ODF style:wrap is the side TEXT flows on (inverse of the image side); horizontal-pos
// places the frame on that side. topBottom ⇒ no wrap, centred.
function imageWrapProps(wrap: WrapMode): string {
  if (wrap === 'left') return 'style:wrap="right" style:horizontal-pos="left"';
  if (wrap === 'right') return 'style:wrap="left" style:horizontal-pos="right"';
  return 'style:wrap="none" style:horizontal-pos="center"';
}

// Graphic style for a floating frame (wrap + side, anchored to the paragraph top).
// Inline images need none. Injected into content.xml automatic-styles by applyImages.
function imageGraphicStyle(img: ImageExport, index: number): string {
  if (img.wrap === 'inline') return '';
  return (
    `<style:style style:name="ImgFr${index + 1}" style:family="graphic">` +
    `<style:graphic-properties ${imageWrapProps(img.wrap)}` +
    ` style:number-wrapped-paragraphs="no-limit"` +
    ` style:horizontal-rel="paragraph-content"` +
    ` style:vertical-pos="top" style:vertical-rel="paragraph"/>` +
    `</style:style>`
  );
}

// One <draw:frame>. Inline = as-character (text-flow anchor). Floating = paragraph
// anchor + a graphic style (wrap + side). Size is the exact svg geometry and rotation
// the draw:transform, so all of it round-trips.
function imageFrameXml(img: ImageExport, index: number): string {
  const dims =
    (img.widthCm ? ` svg:width="${img.widthCm}cm"` : '') +
    (img.heightCm ? ` svg:height="${img.heightCm}cm"` : '');
  const title = img.alt ? `<svg:title>${escapeXml(img.alt)}</svg:title>` : '';
  const inner = `<draw:image xlink:href="${img.path}"/>${title}`;
  const anchor = img.wrap === 'inline' ? 'as-char' : 'paragraph';
  const styleName = img.wrap === 'inline' ? '' : ` draw:style-name="ImgFr${index + 1}"`;
  return (
    `<draw:frame draw:name="Image${index + 1}"${styleName} text:anchor-type="${anchor}" draw:z-index="${index}"${dims}${imageTransform(img)}>` +
    `${inner}</draw:frame>`
  );
}

// As-character <draw:frame> for a header/footer image (always inline; no wrap style or
// rotation). Distinct draw:name so it never collides with a body image's frame.
function hfImageFrameXml(img: ImageExport, index: number): string {
  const dims =
    (img.widthCm ? ` svg:width="${img.widthCm}cm"` : '') +
    (img.heightCm ? ` svg:height="${img.heightCm}cm"` : '');
  const title = img.alt ? `<svg:title>${escapeXml(img.alt)}</svg:title>` : '';
  return (
    `<draw:frame draw:name="HfImage${index + 1}" text:anchor-type="as-char" draw:z-index="${index}"${dims}>` +
    `<draw:image xlink:href="${img.path}"/>${title}</draw:frame>`
  );
}

// Inject automatic styles, tolerating an empty/self-closed or absent section.
function injectAutomaticStyles(content: string, styles: string): string {
  if (!styles) return content;
  if (content.includes('</office:automatic-styles>')) {
    return content.replace('</office:automatic-styles>', `${styles}</office:automatic-styles>`);
  }
  if (content.includes('<office:automatic-styles/>')) {
    return content.replace('<office:automatic-styles/>', `<office:automatic-styles>${styles}</office:automatic-styles>`);
  }
  return content.replace('<office:body', `<office:automatic-styles>${styles}</office:automatic-styles><office:body`);
}

// Resolve image sentinels: swap each IMG{i}IMG for its <draw:frame>, add the binary
// picture files, and register each in META-INF/manifest.xml. content.xml already
// declares the draw/svg/xlink namespaces and rezipOdt handles binary entries.
function applyImages(odtBytes: Uint8Array, images: ImageExport[]): Uint8Array {
  if (!images.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  content = content.replace(new RegExp(`${IMG}(\\d+)${IMG}`, 'g'), (_m, idx: string) => {
    const i = Number(idx);
    const img = images[i];
    return img ? imageFrameXml(img, i) : '';
  });
  // Graphic styles for the floating frames.
  content = injectAutomaticStyles(content, images.map((img, i) => imageGraphicStyle(img, i)).join(''));
  files['content.xml'] = strToU8(content);

  for (const img of images) files[img.path] = img.bytes;

  const manifestBytes = files['META-INF/manifest.xml'];
  if (manifestBytes) {
    const entries = images
      .map(img => `<manifest:file-entry manifest:full-path="${img.path}" manifest:media-type="${img.mimeType}"/>`)
      .join('');
    const manifest = strFromU8(manifestBytes).replace('</manifest:manifest>', `${entries}</manifest:manifest>`);
    files['META-INF/manifest.xml'] = strToU8(manifest);
  }

  return rezipOdt(files);
}

// Ensure content.xml declares the number namespace (odf-kit may omit it); the minted
// <number:date-style>/<number:time-style> and their references need the prefix.
function ensureNumberNamespace(content: string): string {
  if (content.includes('xmlns:number=')) return content;
  return content.replace(
    /<office:document-content\b/,
    '<office:document-content xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"',
  );
}

// Resolve date/time field sentinels: swap each DTF{i}DTF for a <text:date>/<text:time>
// carrying the displayed value, the ISO date/time-value, text:fixed, and a minted
// data style. Auto fields render (and store) the current moment; fixed ones use `value`.
function applyDateTimeFields(odtBytes: Uint8Array, fields: DateTimeFieldExport[], lang: { language: string; country: string } | null): Uint8Array {
  if (!fields.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  const tag = localeTag(lang ? `${lang.language}` : 'en');
  // One data style per distinct format actually used; reference it by minted name.
  const styleNames = new Map<string, string>();
  const mintedStyles: string[] = [];
  const styleFor = (fmt: DtFormat): string => {
    const existing = styleNames.get(fmt.key);
    if (existing) return existing;
    const name = `Ndt${styleNames.size + 1}`;
    styleNames.set(fmt.key, name);
    mintedStyles.push(odfNumberStyle(fmt, name, lang));
    return name;
  };

  let content = strFromU8(contentBytes);
  content = content.replace(new RegExp(`${DTF}(\\d+)${DTF}`, 'g'), (_m, idx: string) => {
    const field = fields[Number(idx)];
    if (!field) return '';
    const fmt = findFormat(field.format)
      ?? findFormat(field.kind === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT)!;
    const parsed = field.fixed && field.value ? new Date(field.value) : new Date();
    const when = isNaN(parsed.getTime()) ? new Date() : parsed;
    const display = escapeXml(renderFormat(fmt, when, tag));
    const styleName = styleFor(fmt);
    const fixedAttr = ` text:fixed="${field.fixed ? 'true' : 'false'}"`;
    if (fmt.kind === 'time') {
      return `<text:time text:time-value="${toTimeValue(when)}"${fixedAttr} style:data-style-name="${styleName}">${display}</text:time>`;
    }
    return `<text:date text:date-value="${toDateValue(when)}"${fixedAttr} style:data-style-name="${styleName}">${display}</text:date>`;
  });

  content = ensureNumberNamespace(content);
  content = injectAutomaticStyles(content, mintedStyles.join(''));
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Static enhanced geometry for the two non-rectangular shape kinds, matching what
// LibreOffice emits (round-rectangle path pre-evaluated for modifier 3600).
const ENHANCED_GEOMETRY: Record<'roundRect' | 'ellipse', string> = {
  ellipse:
    '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ellipse"' +
    ' draw:text-areas="3163 3163 18437 18437"' +
    ' draw:enhanced-path="U 10800 10800 10800 10800 0 360 Z N"/>',
  roundRect:
    '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="round-rectangle" draw:modifiers="3600"' +
    ' draw:enhanced-path="M 3600 0 X 0 3600 L 0 18000 Y 3600 21600 L 18000 21600 X 21600 18000 L 21600 3600 Y 18000 0 Z N"/>',
};

// Graphic style for a text box / shape: fill, stroke, text padding, auto-grow, and —
// for floating boxes — the same wrap/position props as floating images.
function textBoxGraphicStyle(box: TextBoxExport, index: number): string {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const fill = box.fill
    ? `draw:fill="solid" draw:fill-color="${normalizeColor(box.fill) ?? '#FFFFFF'}"`
    : 'draw:fill="none"';
  const stroke = box.stroke
    ? `draw:stroke="solid" svg:stroke-color="${normalizeColor(box.stroke) ?? '#000000'}" svg:stroke-width="${r3(box.strokeWidthPt)}pt"`
    : 'draw:stroke="none"';
  const wrap = box.wrap === 'inline'
    ? ''
    : ` ${imageWrapProps(box.wrap)} style:number-wrapped-paragraphs="no-limit"` +
      ` style:horizontal-rel="paragraph-content" style:vertical-pos="top" style:vertical-rel="paragraph"`;
  // auto-grow only for plain text boxes; a custom-shape needs both explicitly
  // false, or LibreOffice's shape autofit shrinks it to its text.
  const grow = box.shapeKind === 'textbox'
    ? ' draw:auto-grow-height="true"'
    : ' draw:auto-grow-height="false" draw:auto-grow-width="false"';
  return (
    `<style:style style:name="TbxFr${index + 1}" style:family="graphic">` +
    `<style:graphic-properties ${fill} ${stroke} fo:padding="${TEXTBOX_PADDING_CM}cm"` +
    `${grow} draw:textarea-vertical-align="top"${wrap}/>` +
    `</style:style>`
  );
}

// The drawing element wrapping a box's serialized blocks: a <draw:frame>/<draw:text-box>
// for plain text boxes (height = fo:min-height, so it grows with content like the
// editor), or a <draw:custom-shape> with preset geometry for roundRect/ellipse.
function textBoxXml(box: TextBoxExport, inner: string, index: number): string {
  const n = index + 1;
  const anchor = box.wrap === 'inline' ? 'as-char' : 'paragraph';
  const transform = frameTransform(box.rotationDeg, box.widthCm, box.heightCm);
  const common =
    ` draw:style-name="TbxFr${n}" text:anchor-type="${anchor}" draw:z-index="${index}"` +
    ` svg:width="${box.widthCm}cm"`;
  if (box.shapeKind === 'textbox') {
    // svg:height for consumers without auto-grow; fo:min-height is the real semantic
    // (height = minimum, content grows the box) and wins on our own re-import.
    return (
      `<draw:frame draw:name="TextBox${n}"${common} svg:height="${box.heightCm}cm"${transform}>` +
      `<draw:text-box fo:min-height="${box.heightCm}cm">${inner}</draw:text-box></draw:frame>`
    );
  }
  return (
    `<draw:custom-shape draw:name="Shape${n}"${common} svg:height="${box.heightCm}cm"${transform}>` +
    `${inner}${ENHANCED_GEOMETRY[box.shapeKind]}</draw:custom-shape>`
  );
}

// Resolve the text-box marker paragraphs: wrap each S{i}…E{i} region (the box's
// hoisted, fully serialized blocks) into its drawing element inside a fresh anchor
// paragraph, and inject the minted graphic styles.
function applyTextBoxes(odtBytes: Uint8Array, boxes: TextBoxExport[]): Uint8Array {
  if (!boxes.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  content = content.replace(
    new RegExp(`<text:p\\b[^>]*>${TBX}S(\\d+)${TBX}</text:p>([\\s\\S]*?)<text:p\\b[^>]*>${TBX}E\\1${TBX}</text:p>`, 'g'),
    (_m, idx: string, inner: string) => {
      const i = Number(idx);
      const box = boxes[i];
      if (!box) return '';
      return `<text:p text:style-name="Standard">${textBoxXml(box, inner, i)}</text:p>`;
    },
  );
  content = injectAutomaticStyles(content, boxes.map((b, i) => textBoxGraphicStyle(b, i)).join(''));
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Section style for a multi-column region: balanced columns with a uniform gap.
// text:dont-balance-text-columns sits on <style:columns> (not section-properties).
function columnsSectionStyle(cols: ColumnsExport, index: number): string {
  return (
    `<style:style style:name="ColSec${index + 1}" style:family="section">` +
    `<style:section-properties style:editable="false">` +
    `<style:columns fo:column-count="${cols.count}" fo:column-gap="${cols.gapCm}cm"` +
    ` text:dont-balance-text-columns="false"/>` +
    `</style:section-properties></style:style>`
  );
}

// Resolve the columns marker paragraphs: wrap each S{i}…E{i} region (the section's
// hoisted, fully serialized blocks) into a <text:section> — a block-level element,
// so no anchor paragraph — and inject the minted section styles.
function applyColumns(odtBytes: Uint8Array, cols: ColumnsExport[]): Uint8Array {
  if (!cols.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  content = content.replace(
    new RegExp(`<text:p\\b[^>]*>${COL}S(\\d+)${COL}</text:p>([\\s\\S]*?)<text:p\\b[^>]*>${COL}E\\1${COL}</text:p>`, 'g'),
    (_m, idx: string, inner: string) => {
      const i = Number(idx);
      if (!cols[i]) return '';
      return `<text:section text:style-name="ColSec${i + 1}" text:name="ColumnsSection${i + 1}">${inner}</text:section>`;
    },
  );
  content = injectAutomaticStyles(content, cols.map((c, i) => columnsSectionStyle(c, i)).join(''));
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Minted automatic paragraph style for a TOC entry level: per-level left indent and a
// right tab stop at the text width with a dotted leader (so the page number right-aligns
// with dots, matching the on-screen TOC and Word/LibreOffice).
function contentsEntryStyle(name: string, level: number, tabPosCm: number): string {
  const indentCm = level === 2 ? 0.6 : level === 3 ? 1.2 : 0;
  const margin = indentCm > 0 ? ` fo:margin-left="${indentCm}cm"` : '';
  return (
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard">` +
    `<style:paragraph-properties${margin}>` +
    `<style:tab-stops><style:tab-stop style:position="${tabPosCm}cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops>` +
    `</style:paragraph-properties></style:style>`
  );
}

// The TOC title style (bold, 16pt) — mirrors the .toc-title on screen.
function contentsHeadingStyle(): string {
  return (
    `<style:style style:name="Contents_20_Heading" style:family="paragraph" style:parent-style-name="Standard">` +
    `<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.3cm"/>` +
    `<style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>`
  );
}

// The full <text:table-of-content>: a source (title + per-level entry templates that
// carry a right tab stop, page number, and link markers so LibreOffice rebuilds it as a
// linking TOC) plus a cached index-body (title + one entry paragraph per heading).
function tocXml(toc: TocExport, index: number): string {
  const title = 'Table of Contents';
  const name = `${title}${index + 1}`;
  const source =
    `<text:table-of-content-source text:outline-level="${MAX_HEADING_LEVEL}" text:use-index-marks="false" text:use-index-source-styles="false">` +
    `<text:index-title-template text:style-name="Contents_20_Heading">${escapeXml(title)}</text:index-title-template>` +
    HEADING_LEVELS
      .map(
        l =>
          `<text:table-of-content-entry-template text:outline-level="${l}" text:style-name="Contents_20_${l}">` +
          `<text:index-entry-link-start/>` +
          `<text:index-entry-text/>` +
          `<text:index-entry-tab-stop style:type="right" style:leader-char="."/>` +
          `<text:index-entry-page-number/>` +
          `<text:index-entry-link-end/>` +
          `</text:table-of-content-entry-template>`,
      )
      .join('') +
    `</text:table-of-content-source>`;
  const body =
    `<text:index-body>` +
    `<text:index-title text:name="${escapeXml(name)}_Head">` +
    `<text:p text:style-name="Contents_20_Heading">${escapeXml(title)}</text:p>` +
    `</text:index-title>` +
    toc.entries
      .map(e => `<text:p text:style-name="Contents_20_${e.level}">${escapeXml(e.text)}<text:tab/>${e.page}</text:p>`)
      .join('') +
    `</text:index-body>`;
  return `<text:table-of-content text:name="${escapeXml(name)}" text:protected="true">${source}${body}</text:table-of-content>`;
}

// Resolve TOC sentinels: rewrite each marker <text:p>TOC{i}TOC</text:p> to its
// <text:table-of-content> and mint the Contents_20_* paragraph styles it references.
function applyToc(odtBytes: Uint8Array, tocs: TocExport[], contentWidthCm: number): Uint8Array {
  if (!tocs.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(TOC_SENT)) return odtBytes;

  content = content.replace(
    new RegExp(`<text:p\\b[^>]*>${TOC_SENT}(\\d+)${TOC_SENT}</text:p>`, 'g'),
    (_m, idx: string) => {
      const toc = tocs[Number(idx)];
      return toc ? tocXml(toc, Number(idx)) : '';
    },
  );
  // Defensive: strip any sentinels not consumed above.
  content = content.split(TOC_SENT).join('');

  const tabPosCm = Math.max(1, Math.round(contentWidthCm * 1000) / 1000);
  const styles =
    contentsHeadingStyle() +
    HEADING_LEVELS.map(l => contentsEntryStyle(`Contents_20_${l}`, l, tabPosCm)).join('');
  content = injectAutomaticStyles(content, styles);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Header/footer input for the export: one single-paragraph doc per zone (or null),
// the page count snapshot for the stored <text:page-count> value, and the page-edge
// distances (cm; default HF_DISTANCE_CM) for header (from top) / footer (from bottom).
export type HfExport = {
  header: HfDoc;
  footer: HfDoc;
  // First-page overrides (Word titlePg / ODF header-first); only used when
  // differentFirstPage is set. null = the first page's zone is blank.
  headerFirst?: HfDoc;
  footerFirst?: HfDoc;
  differentFirstPage?: boolean;
  // Even-page overrides (Word evenAndOddHeaders / ODF header-left); only used when
  // differentOddEven is set. null = the even pages' zone is blank.
  headerEven?: HfDoc;
  footerEven?: HfDoc;
  differentOddEven?: boolean;
  pageCount: number;
  headerDistanceCm?: number;
  footerDistanceCm?: number;
};

// The full document → .odt pipeline, DOM-free; returns the .odt bytes.
export async function buildOdt(docJson: TiptapNode, margins: PageMargins = DEFAULT_MARGINS, orientation: Orientation = 'portrait', hf?: HfExport, language?: { language: string; country: string } | null, pageFormat: PageFormat = 'A4', styles: StyleSheet = builtinStyleSheet()): Promise<Uint8Array> {
  // Collect embedded images and swap them for IMG sentinels before serialization;
  // applyImages resolves the sentinels and writes the Pictures/ + manifest entries.
  // Text boxes and columns sections are hoisted after replacePageBreaks (so PGB never
  // lands on their blocks) and before the inline passes (which then cover the hoisted
  // blocks too).
  exportSheet = styles;
  const images: ImageExport[] = [];
  const tocs: TocExport[] = [];
  const textBoxes: TextBoxExport[] = [];
  const columns: ColumnsExport[] = [];
  const dateFields: DateTimeFieldExport[] = [];
  const raw = replaceDateTimeFields(replaceImages(replaceTabs(replaceHardBreaks(replaceColumns(replaceTextBoxes(replacePageBreaks(replaceTableOfContents(docJson, tocs)), textBoxes), columns))), images), dateFields);
  let headerPara = hf && !hfIsEmpty(hf.header) ? (hf.header!.content![0] as TiptapNode) : null;
  let footerPara = hf && !hfIsEmpty(hf.footer) ? (hf.footer!.content![0] as TiptapNode) : null;
  // Different first page (ODF header-first): page 1 gets its own zone content.
  const differentFirstPage = !!hf?.differentFirstPage;
  let firstHeaderPara = differentFirstPage && hf && !hfIsEmpty(hf.headerFirst ?? null) ? (hf.headerFirst!.content![0] as TiptapNode) : null;
  let firstFooterPara = differentFirstPage && hf && !hfIsEmpty(hf.footerFirst ?? null) ? (hf.footerFirst!.content![0] as TiptapNode) : null;
  // Different odd & even pages (ODF header-left): even pages get their own zone.
  const differentOddEven = !!hf?.differentOddEven;
  let evenHeaderPara = differentOddEven && hf && !hfIsEmpty(hf.headerEven ?? null) ? (hf.headerEven!.content![0] as TiptapNode) : null;
  let evenFooterPara = differentOddEven && hf && !hfIsEmpty(hf.footerEven ?? null) ? (hf.footerEven!.content![0] as TiptapNode) : null;
  // Hoist header/footer inline images out to HFIMG sentinels before odf-kit serializes
  // the zones; applyHfPostProcess rewrites them to <draw:frame> in styles.xml.
  const hfImages: ImageExport[] = [];
  headerPara = replaceHfImages(headerPara, hfImages);
  footerPara = replaceHfImages(footerPara, hfImages);
  firstHeaderPara = replaceHfImages(firstHeaderPara, hfImages);
  firstFooterPara = replaceHfImages(firstFooterPara, hfImages);
  evenHeaderPara = replaceHfImages(evenHeaderPara, hfImages);
  evenFooterPara = replaceHfImages(evenFooterPara, hfImages);
  // With the flag on, page 1 is independent: whenever a side has a zone on either
  // variant, emit both (an empty one blanks its side, matching the editor and Word).
  if (differentFirstPage) {
    const empty = (): TiptapNode => ({ type: 'paragraph', content: [] });
    if (headerPara || firstHeaderPara) { headerPara ??= empty(); firstHeaderPara ??= empty(); }
    if (footerPara || firstFooterPara) { footerPara ??= empty(); firstFooterPara ??= empty(); }
  }
  // Same for even pages: an empty even zone blanks it while the default fills odd pages.
  if (differentOddEven) {
    const empty = (): TiptapNode => ({ type: 'paragraph', content: [] });
    if (headerPara || evenHeaderPara) { headerPara ??= empty(); evenHeaderPara ??= empty(); }
    if (footerPara || evenFooterPara) { footerPara ??= empty(); evenFooterPara ??= empty(); }
  }
  // Distance from the page edge to the header (top) / footer (bottom). Becomes the
  // ODF page margin; clamped below the body margin so the body still starts at it.
  const headerDist = Math.min(hf?.headerDistanceCm ?? HF_DISTANCE_CM, margins.top);
  const footerDist = Math.min(hf?.footerDistanceCm ?? HF_DISTANCE_CM, margins.bottom);
  let json = injectCustomTypes(raw);
  if (headerPara || footerPara) {
    json = { ...json, content: [{ type: CUST_HF }, ...(json.content ?? [])] };
  }

  // Text width = the format's page width (orientation-swapped) minus the L/R
  // margins. Table column widths are scaled to fill exactly this width.
  const pageWidthCm = pageDimsCm(pageFormat, orientation).w;
  const contentWidthCm = pageWidthCm - margins.left - margins.right;

  // Filled by exportTable, in document order, one CellBlock[] per table cell.
  // applyCellBlocks consumes it to rebuild real <text:h>/<text:p>/<text:list>.
  const cellBlocks: CellBlock[][] = [];
  // One entry per table, same order — consumed by applyTableMargins.
  const tableMargins: (TableMargins | null)[] = [];
  // The named table style + its options per table, same order — applyTableStyleNames.
  const tableStyleNames: (TableStyleRef | null)[] = [];

  const odt = await tiptapToOdt(json, {
    // Orientation sets style:print-orientation; rewriteStylesXml overrides the exact
    // fo:page-width/height for the chosen format (odf-kit only knows 5 presets).
    orientation,
    // Margins (cm) from the Layout panel, matching the editor's padding so line
    // wrapping / page flow is identical. With a header/footer the vertical margin is
    // the edge→zone distance; applyHfPostProcess keeps the body starting at the margin.
    marginTop: `${headerPara ? headerDist : margins.top}cm`,
    marginBottom: `${footerPara ? footerDist : margins.bottom}cm`,
    marginLeft: `${margins.left}cm`,
    marginRight: `${margins.right}cm`,
    unknownNodeHandler(node: TiptapNode, doc: OdtDocument) {
      if (node.type === CUST_HF) {
        if (headerPara) doc.setHeader((b: HeaderFooterBuilder) => applyHfRuns(b, headerPara, hf!.pageCount));
        if (footerPara) doc.setFooter((b: HeaderFooterBuilder) => applyHfRuns(b, footerPara, hf!.pageCount));
        return;
      }
      if (node.type === CUST_TABLE) {
        exportTable(node, doc, contentWidthCm, cellBlocks, tableMargins, tableStyleNames);
        return;
      }
      const opts: {
        lineHeight?: number | string;
        align?: AlignValue;
        spaceBefore?: string;
        spaceAfter?: string;
        indentLeft?: string;
        indentFirst?: string;
        tabStops?: { position: string; type: 'left' | 'center' | 'right' }[];
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
      // Left indent → fo:margin-left (odf-kit emits it natively from indentLeft).
      if (typeof node.attrs?.indent === 'number' && node.attrs.indent > 0) {
        opts.indentLeft = `${node.attrs.indent}cm`;
      }
      // First-line indent → fo:text-indent; negative is a hanging indent.
      if (typeof node.attrs?.indentFirst === 'number' && node.attrs.indentFirst !== 0) {
        opts.indentFirst = `${node.attrs.indentFirst}cm`;
      }
      // Tab stops → <style:tab-stops>. odf-kit's type has no decimal stop, so it goes
      // out as 'char' and applyInlineSentinels adds the style:char ODF requires.
      const stops = parseTabStops(node.attrs?.tabStops);
      if (stops.length) {
        opts.tabStops = stops.map((s) => ({
          position: `${s.pos}cm`,
          // odf-kit writes style:type verbatim but types it without ODF's 'char'.
          type: (s.align === 'decimal' ? 'char' : s.align) as 'left' | 'center' | 'right',
        }));
      }
      const content = node.content ?? [];
      // An empty line's font size (its paragraph-mark size) rides as an FSZ sentinel
      // that applyEmptyLineFontSizes turns into a paragraph-style fo:font-size.
      const emptyFs = content.length === 0 && typeof node.attrs?.fontSize === 'string' && node.attrs.fontSize
        ? `${FSZ}${node.attrs.fontSize}${FSZ}` : '';
      // Paragraph background/borders ride as a leading PBX sentinel (odf-kit has no such
      // options); applyParagraphBoxes mints the style. FSZ stays first so its own pass,
      // which runs earlier, still matches it right after the opening tag.
      const spec = paraBoxSpec(node.attrs);
      const pbx = spec ? `${PBX}${spec}${PBX}` : '';
      // Named style, unless it is the one odf-kit puts on this node type anyway.
      const styleName = styleOf(node);
      const sty = styleName !== odfDefaultStyleOf(node) ? `${STY}${styleName}${STY}` : '';
      const marks = sty + pbx;
      const withPbx = (p: ParagraphBuilder) => { if (marks) p.addText(marks); applyRuns(p, content); };

      if (node.type === CUST_P) {
        if (content.length === 0) doc.addParagraph(emptyFs + marks, opts);
        else doc.addParagraph(withPbx, opts);
      } else if (node.type === CUST_H) {
        const level = (node.attrs?.level as number) ?? 1;
        if (content.length === 0) doc.addHeading(emptyFs + marks, level, opts);
        else doc.addHeading(withPbx, level, opts);
      }
    },
  });

  // Rewrite odf-kit's default numbering (1.) into per-level formats (depth cycle,
  // explicit types, multilevel chains). Runs before applyListItemStyles, which only
  // touches <text:p> styles, not the <text:list-style> definitions.
  const olFormats: (OlStyleFix | null)[] = [];
  collectOrderedListFormats(raw, olFormats);
  let numberedOdt = applyOrderedListFormats(odt as Uint8Array, olFormats);

  // A Word list continued across an intervening paragraph splits into separate nodes with
  // a `start` attr; odf-kit drops it, so emit text:start-value on each such list's first item.
  const listStarts: (number | null)[] = [];
  collectListStartValues(raw, listStarts);
  numberedOdt = applyListStartValues(numberedOdt, listStarts);

  // Rewrite odf-kit's default bullet chars into the per-level bulletChar attrs.
  const blChars: (string[] | null)[] = [];
  collectBulletListChars(raw, blChars);
  numberedOdt = applyBulletListChars(numberedOdt, blChars);

  const nestedFixes: (ListDef | null)[] = [];
  collectNestedListFixes(raw, nestedFixes);
  numberedOdt = applyNestedListTypes(numberedOdt, nestedFixes);

  const listStyles: ParaStyle[] = [];
  collectListItemStyles(raw, listStyles);
  const styledLists = applyListItemStyles(numberedOdt, listStyles);

  // Whole-list indent → added to each L# list-style's level margins.
  const listIndents: number[] = [];
  collectListIndents(raw, listIndents);
  const indentedLists = applyListIndents(styledLists, listIndents);

  // Rebuild real headings/lists/paragraphs inside table cells. Must run after
  // applyListItemStyles (cell lists don't exist yet) and before collapseRunWhitespace.
  const styledCells = applyCellBlocks(indentedLists, cellBlocks);

  const rowHeights: (string | null)[] = [];
  collectTableRowHeights(raw, rowHeights);
  const styledRows = applyTableRowHeights(expandCellPadding(styledCells), rowHeights);
  const withTableMargins = applyTableStyleNames(
    applyTableMargins(styledRows, tableMargins, contentWidthCm), tableStyleNames);

  const cleaned = collapseRunWhitespace(withTableMargins);
  const withBreaks = applyInlineSentinels(cleaned);
  const withImages = applyImages(withBreaks, images);
  const withDateFields = applyDateTimeFields(withImages, dateFields, language ?? null);
  const withTextBoxes = applyTextBoxes(withDateFields, textBoxes);
  const withColumns = applyColumns(withTextBoxes, columns);
  const withToc = applyToc(withColumns, tocs, contentWidthCm);
  const withPageBreaks = applyPageBreaks(withToc);
  const withEmptyFontSizes = applyEmptyLineFontSizes(withPageBreaks);
  const withParaBoxes = applyParagraphBoxes(withEmptyFontSizes);
  const withNamedStyles = applyCharacterStyles(applyParagraphStyles(withParaBoxes));
  const usedTables = new Set(tableStyleNames.filter((t): t is TableStyleRef => !!t).map(t => t.name));
  const withStyles = rewriteStylesXml(withNamedStyles, language ?? null, pageFormat, orientation, styles, usedStyleNames(docJson, styles), usedTables);
  return applyHfPostProcess(withStyles, margins, headerPara, footerPara, headerDist, footerDist, firstHeaderPara, firstFooterPara, hf?.pageCount ?? 1, hfImages, evenHeaderPara, evenFooterPara);
}

function hfAlign(para: TiptapNode): AlignValue | null {
  const ta = para.attrs?.textAlign;
  return ta === 'center' || ta === 'right' || ta === 'justify' ? ta : null;
}

// fo:* paragraph-properties for a header/footer paragraph: alignment plus the paragraph
// background ("colored field") and per-side borders ("rule line"). Empty ⇒ no override.
function hfParaProps(para: TiptapNode): string[] {
  const props: string[] = [];
  const align = hfAlign(para);
  if (align) props.push(`fo:text-align="${align}"`);
  const s = paraStyleFromAttrs(para.attrs);
  if (s.background) props.push(`fo:background-color="${s.background}"`);
  for (const [attr, side] of [
    ['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left'],
  ] as const) {
    if (s[attr]) props.push(`fo:border-${side}="${s[attr]}"`);
  }
  return props;
}

// Header/footer post-processing on styles.xml: resolve LBR/PGC sentinels, apply the
// paragraph alignment to the Header/Footer styles, and rewrite the geometry to the
// Word-style mapping (page margin = HF distance, min-height fills up to the body margin).
function applyHfPostProcess(odtBytes: Uint8Array, margins: PageMargins, headerPara: TiptapNode | null, footerPara: TiptapNode | null, headerDist: number, footerDist: number, firstHeaderPara: TiptapNode | null = null, firstFooterPara: TiptapNode | null = null, pageCount = 1, hfImages: ImageExport[] = [], evenHeaderPara: TiptapNode | null = null, evenFooterPara: TiptapNode | null = null): Uint8Array {
  if (!headerPara && !footerPara && !firstHeaderPara && !firstFooterPara && !evenHeaderPara && !evenFooterPara) return odtBytes;

  const files = unzipSync(odtBytes);
  const stylesBytes = files['styles.xml'];
  if (!stylesBytes) return odtBytes;
  let styles = strFromU8(stylesBytes);

  // Same fix as collapseRunWhitespace: odf-kit joins runs with "\n", which would
  // collapse into spurious spaces. styles.xml only has text:p inside header/footer.
  styles = styles.replace(/<text:p\b[^>]*>[\s\S]*?<\/text:p>/g, (block) => block.replace(/\n/g, ''));
  styles = styles.split(LBR).join('<text:line-break/>');
  styles = styles.replace(new RegExp(`${PGC}(\\d*)${PGC}`, 'g'), '<text:page-count>$1</text:page-count>');

  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const zone = (kind: 'header' | 'footer', para: TiptapNode, bodyMarginCm: number, distCm: number) => {
    // min-height fills the gap between the edge→zone distance and the body margin,
    // so the body still starts at bodyMarginCm (page margin was set to distCm).
    const minH = round3(Math.max(0.2, bodyMarginCm - distCm));
    // The spacing attr sits on the body-facing side: below the header, above the footer.
    const spacingAttr = kind === 'header' ? 'fo:margin-bottom' : 'fo:margin-top';
    styles = styles.replace(
      new RegExp(`<style:${kind}-style>[\\s\\S]*?</style:${kind}-style>`),
      `<style:${kind}-style><style:header-footer-properties fo:min-height="${minH}cm" ${spacingAttr}="0cm" style:dynamic-spacing="false"/></style:${kind}-style>`,
    );
    const props = hfParaProps(para);
    if (props.length) {
      const styleName = kind === 'header' ? 'Header' : 'Footer';
      styles = styles.replace(
        new RegExp(`(<style:style style:name="${styleName}"[^>]*?)/>`),
        `$1><style:paragraph-properties ${props.join(' ')}/></style:style>`,
      );
    }
  };
  if (headerPara) zone('header', headerPara, margins.top, headerDist);
  if (footerPara) zone('footer', footerPara, margins.bottom, footerDist);

  // Different first page / odd-even: inject <style:{header,footer}-{first,left}> content
  // into the master page (ODF 1.3; LibreOffice reads them). The page-layout header/footer
  // geometry above is shared across variants, so only the content differs here.
  if (firstHeaderPara || firstFooterPara || evenHeaderPara || evenFooterPara) {
    const mintedStyles: string[] = [];
    const mint = (n: string) => { mintedStyles.push(n); };
    const injectVariant = (kind: 'header' | 'footer', suffix: 'first' | 'left', para: TiptapNode | null) => {
      if (!para) return;
      const xml = hfVariantZoneXml(kind, suffix, para, pageCount, mint);
      // Insert after the matching default zone (always present when a variant exists,
      // since buildOdt emits an empty default alongside it), else at the master-page bounds.
      const closeTag = `</style:${kind}>`;
      if (styles.includes(closeTag)) styles = styles.replace(closeTag, `${closeTag}${xml}`);
      else if (kind === 'header') styles = styles.replace(/(<style:master-page\b[^>]*>)/, `$1${xml}`);
      else styles = styles.replace('</style:master-page>', `${xml}</style:master-page>`);
    };
    injectVariant('header', 'first', firstHeaderPara);
    injectVariant('header', 'left', evenHeaderPara);
    injectVariant('footer', 'first', firstFooterPara);
    injectVariant('footer', 'left', evenFooterPara);
    if (mintedStyles.length) {
      const defs = mintedStyles.join('');
      if (styles.includes('</office:automatic-styles>')) styles = styles.replace('</office:automatic-styles>', `${defs}</office:automatic-styles>`);
      else styles = styles.replace('<office:automatic-styles/>', `<office:automatic-styles>${defs}</office:automatic-styles>`);
    }
  }

  // Resolve HFIMG sentinels (default + first-page zones) to as-char <draw:frame>s, then
  // add the picture binaries and their manifest entries (mirrors the body applyImages).
  if (hfImages.length) {
    styles = ensureDrawNamespaces(styles);
    styles = styles.replace(new RegExp(`${HFIMG}(\\d+)${HFIMG}`, 'g'), (_m, idx: string) => {
      const img = hfImages[Number(idx)];
      return img ? hfImageFrameXml(img, Number(idx)) : '';
    });
    for (const img of hfImages) files[img.path] = img.bytes;
    const manifestBytes = files['META-INF/manifest.xml'];
    if (manifestBytes) {
      const entries = hfImages
        .map((img) => `<manifest:file-entry manifest:full-path="${img.path}" manifest:media-type="${img.mimeType}"/>`)
        .join('');
      files['META-INF/manifest.xml'] = strToU8(strFromU8(manifestBytes).replace('</manifest:manifest>', `${entries}</manifest:manifest>`));
    }
  }

  files['styles.xml'] = strToU8(styles);
  return rezipOdt(files);
}

// styles.xml needs draw/svg/xlink namespaces for an image frame; odf-kit may not declare
// all three (svg is used by page geometry, but draw/xlink can be absent).
function ensureDrawNamespaces(styles: string): string {
  const ns: [string, string][] = [
    ['draw', 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'],
    ['svg', 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0'],
    ['xlink', 'http://www.w3.org/1999/xlink'],
  ];
  const missing = ns.filter(([p]) => !styles.includes(`xmlns:${p}=`)).map(([p, uri]) => `xmlns:${p}="${uri}"`);
  return missing.length ? styles.replace(/<office:document-styles\b/, `<office:document-styles ${missing.join(' ')}`) : styles;
}

// Serialize a variant header/footer paragraph to <style:{header,footer}-{first,left}>
// XML (first = page 1, left = even pages). Runs and page fields become <text:span>
// referencing minted automatic text styles (pushed via `mint`); hardBreak → line-break.
function hfVariantZoneXml(kind: 'header' | 'footer', suffix: 'first' | 'left', para: TiptapNode, pageCount: number, mint: (styleXml: string) => void): string {
  let styleSeq = 0;
  // Distinct minted-style prefix per variant so first + even styles never collide.
  const pfx = `HF${suffix === 'first' ? 'F' : 'L'}${kind[0].toUpperCase()}`;
  // Wrap inline XML in a minted text style span when the run carries formatting.
  const styled = (innerXml: string, marks: TiptapNode['marks']): string => {
    const props = odfTextPropsFromMarks(marks);
    if (!props) return innerXml;
    const name = `${pfx}T${++styleSeq}`;
    mint(`<style:style style:name="${name}" style:family="text"><style:text-properties ${props}/></style:style>`);
    return `<text:span text:style-name="${name}">${innerXml}</text:span>`;
  };

  let inner = '';
  for (const node of para.content ?? []) {
    if (node.type === 'text' && node.text) inner += styled(odfEncodeInline(node.text), node.marks);
    else if (node.type === 'hardBreak') inner += '<text:line-break/>';
    else if (node.type === 'pageNumber') inner += styled('<text:page-number text:select-page="current">1</text:page-number>', node.marks);
    else if (node.type === 'pageCount') inner += styled(`<text:page-count>${pageCount}</text:page-count>`, node.marks);
  }

  const parent = kind === 'header' ? 'Header' : 'Footer';
  const props = hfParaProps(para);
  let paraStyle = parent;
  if (props.length) {
    paraStyle = `${pfx}P`;
    mint(`<style:style style:name="${paraStyle}" style:family="paragraph" style:parent-style-name="${parent}"><style:paragraph-properties ${props.join(' ')}/></style:style>`);
  }
  return `<style:${kind}-${suffix}><text:p text:style-name="${paraStyle}">${inner}</text:p></style:${kind}-${suffix}>`;
}

// A text run's ODF <style:text-properties> attribute string from TipTap marks (mirrors
// formattingFromMarks). Empty string → no styling needed (returned as null).
function odfTextPropsFromMarks(marks: TiptapNode['marks']): string | null {
  const fmt = formattingFromMarks(marks);
  const a: string[] = [];
  if (fmt.fontWeight != null) a.push(`fo:font-weight="${fmt.fontWeight}"`);
  else if (fmt.bold) a.push('fo:font-weight="bold"');
  if (fmt.italic) a.push('fo:font-style="italic"');
  if (fmt.underline) a.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
  if (fmt.strikethrough) a.push('style:text-line-through-style="solid"');
  if (fmt.superscript) a.push('style:text-position="super 58%"');
  else if (fmt.subscript) a.push('style:text-position="sub 58%"');
  if (fmt.fontFamily) {
    const q = /\s/.test(fmt.fontFamily) ? `'${fmt.fontFamily}'` : fmt.fontFamily;
    a.push(`style:font-name="${fmt.fontFamily}" fo:font-family="${q}"`);
  }
  if (fmt.fontSize) a.push(`fo:font-size="${fmt.fontSize}"`);
  if (fmt.color) a.push(`fo:color="${fmt.color}"`);
  if (fmt.highlightColor) a.push(`fo:background-color="${fmt.highlightColor}"`);
  return a.length ? a.join(' ') : null;
}

// Encode inline text as ODF: runs of ≥2 spaces → <text:s text:c>, tabs → <text:tab/>,
// the rest XML-escaped (so LibreOffice preserves significant whitespace).
function odfEncodeInline(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === '\t') { out += '<text:tab/>'; i++; continue; }
    if (ch === ' ') {
      let n = 1;
      while (s[i + n] === ' ') n++;
      out += n === 1 ? ' ' : `<text:s text:c="${n}"/>`;
      i += n;
      continue;
    }
    out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
    i++;
  }
  return out;
}

// Document filename derived from the first non-empty heading (sanitized, max 50
// chars), falling back to document.odt.
export function deriveFilename(json: TiptapNode): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content = (json as any).content as any[] | undefined;
  const heading = content?.find(
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
