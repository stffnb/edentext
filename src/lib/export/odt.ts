import { tiptapToOdt, type TiptapNode, type TiptapMark, type TextFormatting, type OdtDocument, type ParagraphBuilder, type TableBuilder, type RowBuilder, type CellBuilder, type CellOptions, type HeaderFooterBuilder } from 'odf-kit';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import type { SpacingModel } from '../storage/spacingModel';
import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
import { HF_DISTANCE_CM, hfIsEmpty, type HfDoc, type HfSet } from '../storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, NOTE_FONT_SIZE_PT, NOTE_INDENT_CM, type NoteKind, type NoteNumFormat, type NoteSettings } from '../storage/noteSettings';
import { EMPTY_DOC_PROPERTIES, keywordList, type DocProperties } from '../storage/docProperties';
import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
import { EMPTY_PAGE_DECOR, type PageDecor, type Watermark } from '../storage/pageDecor';
import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../storage/lineNumbering';
import { builtinStyleSheet, DEFAULT_STYLE, resolveStyle, type StyleSheet, type TextProps } from '../styles/styleSheet';
import {
  TABLE_REGIONS, parseTableLook, regionText, type TableLook, type TableRegion,
} from '../styles/tableStyles';

// A table's named style plus the conditional areas it opts into (Word's Table Style
// Options), collected by exportTable in document order.
type TableStyleRef = { name: string; look: TableLook };
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { BORDER_SIDES, parseBorderAttr } from '../editor/extensions/tableCellBorders';
import { parseCellPadding, DEFAULT_CELL_PADDING, type CellPadding } from '../editor/extensions/tableCellPadding';
import { TEXTBOX_PADDING_CM } from '../editor/extensions/textBox';
import { isShapeKind, odfEnhancedGeometry, type ShapeKind } from '../utils/shapes';
import { normalizeLeader, parseTabStops } from '../editor/extensions/tabStops';
import { charStyleProps, listMarkerFormat, type MarkerFormat } from '../editor/extensions/listMarker';
import { orderedTypeDef, effectiveOrderedDef, effectiveOrderedDefAt, childCycle, formatOrdinal, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { ODF_SEQ_NAME, seqCategoryOf, type SeqCategory } from '../editor/extensions/caption';
import { indexKindOf, INDEX_TITLES, type IndexKind } from '../editor/extensions/tableOfContents';
import { DEFAULT_BULLET_CYCLE, defaultBulletChar } from '../utils/bulletListTypes';
import { findFormat, renderFormat, odfNumberStyle, toDateValue, toTimeValue, localeTag, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, type DtFormat } from '../utils/dateTime';
import { parseLatex } from '../math/latex';
import { mathmlDocument } from '../math/mathml';

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

// odf-kit emits this as the document's default font (Standard style). The editor
// renders the bundled, metric-identical Liberation Serif on screen.
const ODFKIT_DEFAULT_FONT = 'Liberation Serif';
// …but we declare Times New Roman in the .odt: it is metric-identical to
// Liberation Serif, so LibreOffice (substitutes TNR→Liberation Serif) and Word
// (has the real TNR) both render with the same metrics as the editor.
const EXPORT_FONT = 'Times New Roman';
// The body size a run without one of its own renders at (LibreOffice's default).
const DEFAULT_FONT_SIZE_PT = 12;
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
// TBX E{i} TBX): hoisted to top level, they ride every existing pass; applyTextBoxes
// wraps the region back into a <draw:frame>/<draw:text-box> or custom shape. U+E008.
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

// Sentinel prefixed to a run carrying character effects odf-kit's run formatting has no
// field for (TEF<odf attrs>TEF); applyTextEffects folds them into the run's own
// automatic text style. U+E00F.
const TEF = '\uE00F';

// Sentinel wrapping the index of the section a block opens (SEC{i}SEC), emitted as the
// block's first run; applySectionMasterPages points it at that section's master page,
// which is what carries the section's own header/footer. U+E010.
const SEC = '\uE010';

// Separates a tab stop's alignment from its leader character inside style:type,
// which odf-kit writes verbatim. U+E011.
const LEAD = '\uE011';

// Sentinel wrapping a formula's index (MTH{i}MTH), emitted as plain run text by
// replaceFormulas so it rides every odf-kit path; applyFormulas rewrites it to a
// <draw:frame>/<draw:object> and writes the embedded formula object. U+E012.
const MTH = '\uE012';

// Sentinels bracketing a bookmark's text (BMS<name>BMS \u2026 BME<name>BME), spliced into
// the run text by replaceBookmarks so they ride every odf-kit path; applyBookmarks
// rewrites them to <text:bookmark-start/>/<text:bookmark-end/>. U+E013/U+E014.
const BMS = '\uE013';
const BME = '\uE014';

// Sentinel wrapping a cross-reference's index and its display text
// (XRF{i}XRF<text>XRF); applyBookmarks rewrites it to <text:bookmark-ref>. U+E015.
const XRF = '\uE015';

// Sentinel wrapping a header/footer chapter field (CHP<level>CHP<name>CHP);
// applyHfPostProcess rewrites it to <text:chapter> in styles.xml. U+E016.
const CHP = '\uE016';

// Sentinels bracketing a comment's text (CMS{i}CMS \u2026 CME{i}CME), spliced into the run
// text like the bookmark pair; applyComments rewrites them to <office:annotation> and
// <office:annotation-end/>. U+E018/U+E019.
const CMS = '\uE018';
const CME = '\uE019';

// Sentinels for footnotes/endnotes (notes.ts): FNT A{i} FNT marks the anchor in the
// running text, FNT B{i} FNT opens the note's own hoisted paragraph. applyNotes cuts
// the body out and splices it into a <text:note> at the anchor. U+E017.
const FNT = '\uE017';

// Sentinel wrapping a caption's sequence-field index (SEQ{i}SEQ); applySequenceFields
// rewrites it to <text:sequence>. U+E01A.
const SEQ = '\uE01A';
// Sentinel wrapping an index entry's index (IXE{i}IXE); applyIndexEntries resolves it.
const IXE = '\uE01E';

// Sentinels for recorded revisions (trackChanges.ts): TCI{i}TCI brackets an insertion's
// runs, TCD{i}TCD stands where a deletion's text was cut out. applyRevisions rewrites
// both and builds the <text:tracked-changes> registry. U+E01B/U+E01C.
const TCI = '\uE01B';
const TCD = '\uE01C';

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
// Levels 4 and 6 are italic, as they are in LibreOffice (probed against its style pool).
export const HEADING_STYLE_OVERRIDES: { name: string; fontSize: string; marginTop: string; marginBottom: string; italic?: true }[] = [
  { name: 'Heading_20_1', fontSize: '18pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_2', fontSize: '16pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_3', fontSize: '14pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_4', fontSize: '13pt', marginTop: '0.423cm', marginBottom: '0.212cm', italic: true },
  { name: 'Heading_20_5', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm' },
  { name: 'Heading_20_6', fontSize: '12pt', marginTop: '0.423cm', marginBottom: '0.212cm', italic: true },
];

// Headings are sans (LibreOffice's Heading style). On screen the bundled 'Arial'
// @font-face maps to Liberation Sans, so the declared name is metric-identical —
// the same trick as EXPORT_FONT for the serif body font.
export const HEADING_FONT = 'Arial';

// What both formats name as the producing application (ODF meta:generator).
export const GENERATOR = 'EdenText';

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
  if (typeof attrs.fontFamily === 'string' && attrs.fontFamily) return true;
  if (typeof attrs.indent === 'number' && attrs.indent > 0) return true;
  if (typeof attrs.indentFirst === 'number' && attrs.indentFirst !== 0) return true;
  if (typeof attrs.indentRight === 'number' && attrs.indentRight > 0) return true;
  if (typeof attrs.tabStops === 'string' && attrs.tabStops) return true;
  if (typeof attrs.backgroundColor === 'string' && attrs.backgroundColor) return true;
  if (attrs.widowControl === false) return true;
  if (attrs.keepNext === true) return true;
  if (attrs.keepLines === true) return true;
  if (attrs.dir === 'rtl' || attrs.dir === 'ltr') return true;
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

// Mark the first block of each section after the first, so applySectionMasterPages can
// point it at that section's master page. Runs after the column hoist, so a section
// starting inside one is top-level by now; the PGB marker keeps its place at the front.
function replaceSectionBreaks(doc: TiptapNode): TiptapNode {
  if (!doc.content?.length) return doc;
  let index = 0;
  return {
    ...doc,
    content: doc.content.map(child => {
      if (!(child.type === 'paragraph' || child.type === 'heading') || child.attrs?.sectionBreak !== true) return child;
      const inner = child.content ?? [];
      const at = inner[0]?.type === 'text' && inner[0].text === PGB ? 1 : 0;
      const mark: TiptapNode = { type: 'text', text: `${SEC}${++index}${SEC}` };
      return { ...child, content: [...inner.slice(0, at), mark, ...inner.slice(at)] };
    }),
  };
}

// One embedded picture, collected by replaceImages and emitted by applyImages.
// bytes is ArrayBuffer-backed to match fflate's zip entry map. rotationDeg is CW;
// wrap floats the frame at its anchor paragraph (left/right/top-bottom).
type WrapMode = 'inline' | 'left' | 'right' | 'topBottom';
type ImageExport = { path: string; bytes: Uint8Array<ArrayBuffer>; mimeType: string; widthCm: number; heightCm: number; alt: string; rotationDeg: number; wrap: WrapMode; wrapOffsetCm: number | null; wrapOffsetYCm: number | null; wrapDistCm: number | null; wrapAlign: string | null; anchorPage: number | null; vAlign: string | null; inFront: boolean };

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
    wrapOffsetCm: typeof node.attrs?.wrapOffset === 'number' ? round3(node.attrs.wrapOffset) : null,
    wrapOffsetYCm: typeof node.attrs?.wrapOffsetY === 'number' ? round3(node.attrs.wrapOffsetY) : null,
    wrapDistCm: typeof node.attrs?.wrapDist === 'number' ? round3(node.attrs.wrapDist) : null,
    wrapAlign: node.attrs?.wrapAlign === 'left' || node.attrs?.wrapAlign === 'right' ? node.attrs.wrapAlign : null,
    anchorPage: typeof node.attrs?.anchorPage === 'number' && node.attrs.anchorPage > 0 ? node.attrs.anchorPage : null,
    vAlign: typeof node.attrs?.vAlign === 'string' ? node.attrs.vAlign : null,
    inFront: node.attrs?.inFront === true,
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

// One formula, collected by replaceFormulas and emitted by applyFormulas as an
// embedded ODF formula object (Formula{n}/content.xml) plus the frame referencing it.
type FormulaExport = { latex: string; display: boolean };

// Replace every inline `formula` node with an MTH-sentinel text run (carrying the
// node's marks) and collect its source; mirrors replaceImages so the sentinel rides
// every odf-kit path. applyFormulas resolves it after serialization.
function replaceFormulas(node: TiptapNode, formulas: FormulaExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  for (const child of node.content) {
    if (child.type === 'formula') {
      const a = child.attrs ?? {};
      const latex = typeof a.latex === 'string' ? a.latex : '';
      if (!latex) continue;
      formulas.push({ latex, display: a.display === true });
      content.push({ type: 'text', text: `${MTH}${formulas.length - 1}${MTH}`, marks: child.marks });
      continue;
    }
    content.push(replaceFormulas(child, formulas));
  }
  return { ...node, content };
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

// One recorded revision. Runs of the same change share an id, so the registry holds one
// entry per id and a deletion's text is the concatenation of its runs.
type RevisionExport = { kind: 'insertion' | 'deletion'; id: string; author: string; date: string; text: string };

// Bracket every insertion run with TCI sentinels and cut every deletion run out, leaving
// a TCD sentinel where it was — ODF keeps a deletion's text in the registry, not inline.
function replaceRevisions(node: TiptapNode, out: Map<string, RevisionExport>): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  for (const child of node.content) {
    const mark = child.type === 'text'
      ? child.marks?.find((m) => m.type === 'insertion' || m.type === 'deletion')
      : undefined;
    if (!mark) { content.push(replaceRevisions(child, out)); continue; }
    const a = mark.attrs ?? {};
    const id = String(a.id ?? '');
    const kind = mark.type as 'insertion' | 'deletion';
    const entry = out.get(id) ?? {
      kind, id,
      author: String(a.author ?? '') || GENERATOR,
      date: typeof a.date === 'string' && a.date ? a.date : new Date().toISOString(),
      text: '',
    };
    entry.text += child.text ?? '';
    out.set(id, entry);
    // The marks stay off the sentinel runs: a change is not formatting, and odf-kit
    // would otherwise split the paragraph's runs around it.
    const rest = child.marks?.filter((m) => m !== mark);
    if (kind === 'deletion') {
      content.push({ type: 'text', text: `${TCD}${id}${TCD}` });
      continue;
    }
    content.push({ type: 'text', text: `${TCI}${id}${TCI}` });
    content.push({ ...child, ...(rest?.length ? { marks: rest } : { marks: undefined }) });
    content.push({ type: 'text', text: `${TCI}${id}${TCI}` });
  }
  return { ...node, content };
}

// Resolve the revision sentinels and prepend the registry the body points into.
function applyRevisions(odtBytes: Uint8Array, list: Map<string, RevisionExport>): Uint8Array {
  if (!list.size) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  // ODF ids are per document; the editor's are opaque strings.
  const odfId = new Map([...list.keys()].map((id, i) => [id, `ct${i + 1}`]));
  let open = new Map<string, boolean>();
  content = content
    .replace(new RegExp(`${TCI}([^${TCI}]*)${TCI}`, 'g'), (_m, id: string) => {
      const ct = odfId.get(id);
      if (!ct) return '';
      const isEnd = open.get(id) === true;
      open.set(id, !isEnd);
      return isEnd
        ? `<text:change-end text:change-id="${ct}"/>`
        : `<text:change-start text:change-id="${ct}"/>`;
    })
    .replace(new RegExp(`${TCD}([^${TCD}]*)${TCD}`, 'g'), (_m, id: string) => {
      const ct = odfId.get(id);
      return ct ? `<text:change text:change-id="${ct}"/>` : '';
    });

  const regions = [...list.values()].map((r) => {
    const ct = odfId.get(r.id)!;
    const info = `<office:change-info><dc:creator>${escapeXml(r.author)}</dc:creator>`
      + `<dc:date>${escapeXml(r.date.replace(/\.\d+Z?$/, ''))}</dc:date></office:change-info>`;
    const body = r.kind === 'deletion'
      ? `<text:deletion>${info}<text:p text:style-name="Standard">${escapeXml(r.text)}</text:p></text:deletion>`
      : `<text:insertion>${info}</text:insertion>`;
    return `<text:changed-region xml:id="${ct}" text:id="${ct}">${body}</text:changed-region>`;
  }).join('');
  content = content.replace(/(<office:text\b[^>]*>)/, `$1<text:tracked-changes>${regions}</text:tracked-changes>`);
  content = ensureDcNamespace(content);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// The change registry names its author with dc:creator; odf-kit declares no dc: prefix
// in content.xml, and an undeclared one loses the whole element.
function ensureDcNamespace(content: string): string {
  if (content.includes('xmlns:dc=')) return content;
  return content.replace(/<office:document-content\b/, '<office:document-content xmlns:dc="http://purl.org/dc/elements/1.1/"');
}

// One caption sequence field, collected by replaceSequenceFields and emitted by
// applySequenceFields. `number` is the rank the editor resolved; both formats cache it.
type SequenceExport = { category: SeqCategory; format: string; number: number };

// Replace every inline `sequenceField` node with a SEQ-sentinel text run, as
// replaceDateTimeFields does, so it rides every odf-kit path.
function replaceSequenceFields(node: TiptapNode, fields: SequenceExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  for (const child of node.content) {
    if (child.type === 'sequenceField') {
      const a = child.attrs ?? {};
      fields.push({
        category: seqCategoryOf(a.category as string),
        format: typeof a.format === 'string' && a.format ? a.format : '1',
        number: typeof a.number === 'number' && a.number > 0 ? a.number : 1,
      });
      content.push({ type: 'text', text: `${SEQ}${fields.length - 1}${SEQ}`, marks: child.marks });
      continue;
    }
    content.push(replaceSequenceFields(child, fields));
  }
  return { ...node, content };
}

// Resolve SEQ sentinels into <text:sequence>. The formula is LibreOffice's own
// "ooow:<name>+1", which is what makes its reader recount the captions on load; the
// element text is the cached number, and text:ref-name is the anchor an index links to.
function applySequenceFields(odtBytes: Uint8Array, fields: SequenceExport[]): Uint8Array {
  if (!fields.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  content = content.replace(new RegExp(`${SEQ}(\\d+)${SEQ}`, 'g'), (_m, idx: string) => {
    const f = fields[Number(idx)];
    if (!f) return '';
    const name = ODF_SEQ_NAME[f.category];
    const display = escapeXml(formatOrdinal(f.number, f.format as NoteNumFormat));
    return `<text:sequence text:ref-name="ref${name}${idx}" text:name="${name}"`
      + ` text:formula="ooow:${name}+1" style:num-format="${f.format}">${display}</text:sequence>`;
  });

  // Every sequence needs its variable declared, as LibreOffice writes them.
  const used = [...new Set(fields.map((f) => ODF_SEQ_NAME[f.category]))];
  const decls = used.map((n) => `<text:sequence-decl text:display-outline-level="0" text:name="${n}"/>`).join('');
  content = /<text:sequence-decls>/.test(content)
    ? content.replace('<text:sequence-decls>', `<text:sequence-decls>${decls}`)
    : content.replace('<office:text>', `<office:text><text:sequence-decls>${decls}</text:sequence-decls>`);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// One alphabetical-index entry, collected by replaceIndexEntries.
type IndexEntryExport = { term: string; key1: string };

function replaceIndexEntries(node: TiptapNode, marks: IndexEntryExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  for (const child of node.content) {
    if (child.type === 'indexEntry') {
      const a = child.attrs ?? {};
      marks.push({ term: String(a.term ?? ''), key1: String(a.key1 ?? '') });
      content.push({ type: 'text', text: `${IXE}${marks.length - 1}${IXE}`, marks: child.marks });
      continue;
    }
    content.push(replaceIndexEntries(child, marks));
  }
  return { ...node, content };
}

// Resolve IXE sentinels into the point mark LibreOffice writes for an index entry.
function applyIndexEntries(odtBytes: Uint8Array, marks: IndexEntryExport[]): Uint8Array {
  if (!marks.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;
  let content = strFromU8(contentBytes);
  content = content.replace(new RegExp(`${IXE}(\\d+)${IXE}`, 'g'), (_m, idx: string) => {
    const m = marks[Number(idx)];
    if (!m) return '';
    return `<text:alphabetical-index-mark text:string-value="${escapeXml(m.term)}"`
      + (m.key1 ? ` text:key1="${escapeXml(m.key1)}"` : '') + '/>';
  });
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// One cross-reference, collected by replaceCrossRefs and emitted by applyBookmarks.
type CrossRefExport = { name: string; format: 'text' | 'page' };

const bookmarkNameOf = (node: TiptapNode): string =>
  String(node.marks?.find((m) => m.type === 'bookmark')?.attrs?.name ?? '');

// One comment, collected by replaceComments and emitted by applyComments.
type CommentExport = { name: string; author: string; date: string; text: string; resolved: boolean };

// Bracket each comment's text with the CMS/CME sentinels, the same shape as the bookmark
// pair — spliced into the run text, so a comment inside a cell or a list rides along too.
function replaceComments(node: TiptapNode, out: CommentExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  let openId = '';
  let openIndex = -1;
  let lastOfRange = -1;
  const closeRange = () => {
    if (!openId) return;
    const run = content[lastOfRange];
    content[lastOfRange] = { ...run, text: `${run.text ?? ''}${CME}${openIndex}${CME}` };
    openId = '';
  };
  for (const child of node.content) {
    const mark = child.type === 'text' ? child.marks?.find(m => m.type === 'comment') : undefined;
    const id = mark ? String(mark.attrs?.id ?? '') : '';
    if (id !== openId) closeRange();
    if (id && !openId) {
      openId = id;
      openIndex = out.length;
      out.push({
        name: id,
        author: String(mark!.attrs?.author ?? ''),
        date: String(mark!.attrs?.date ?? ''),
        text: String(mark!.attrs?.text ?? ''),
        resolved: mark!.attrs?.resolved === true,
      });
      content.push({ ...child, text: `${CMS}${openIndex}${CMS}${child.text ?? ''}` });
      lastOfRange = content.length - 1;
      continue;
    }
    content.push(id ? child : replaceComments(child, out));
    if (id) lastOfRange = content.length - 1;
  }
  closeRange();
  return { ...node, content };
}

// Bracket each bookmark's text with the BMS/BME sentinels and every `crossRef` node with
// an XRF-sentinel run; applyBookmarks resolves them after serialization. Spliced into the
// run text, not a run emitter, so both ride every odf-kit path (cells included).
function replaceBookmarks(node: TiptapNode, refs: CrossRefExport[]): TiptapNode {
  if (!node.content?.length) return node;
  const content: TiptapNode[] = [];
  // Index of the run the open bookmark started on, so its end sentinel lands on the
  // last run of the range.
  let open = '';
  let lastOfRange = -1;
  const closeRange = () => {
    if (!open) return;
    const run = content[lastOfRange];
    content[lastOfRange] = { ...run, text: `${run.text ?? ''}${BME}${open}${BME}` };
    open = '';
  };
  for (const child of node.content) {
    if (child.type === 'crossRef') {
      closeRange();
      const a = child.attrs ?? {};
      refs.push({ name: String(a.name ?? ''), format: a.format === 'page' ? 'page' : 'text' });
      content.push({ type: 'text', text: `${XRF}${refs.length - 1}${XRF}${String(a.text ?? '')}${XRF}`, marks: child.marks });
      continue;
    }
    const name = child.type === 'text' ? bookmarkNameOf(child) : '';
    if (name !== open) closeRange();
    if (name && !open) {
      open = name;
      content.push({ ...child, text: `${BMS}${name}${BMS}${child.text ?? ''}` });
      lastOfRange = content.length - 1;
      continue;
    }
    content.push(name ? child : replaceBookmarks(child, refs));
    if (name) lastOfRange = content.length - 1;
  }
  closeRange();
  return { ...node, content };
}

// One text box / shape, collected by replaceTextBoxes and emitted by applyTextBoxes.
type TextBoxExport = {
  widthCm: number;
  heightCm: number;
  rotationDeg: number;
  wrap: WrapMode;
  wrapOffsetCm: number | null;
  wrapOffsetYCm: number | null;
  wrapDistCm: number | null;
  wrapAlign: string | null;
  paddingCm: number;
  shapeKind: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidthPt: number;
  // The anchor paragraph's own spacing in pt, which the box stands in for.
  spaceBeforePt: number;
  spaceAfterPt: number;
};

function textBoxDescriptor(node: TiptapNode): TextBoxExport {
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const pxToCm = (px: number) => round3((px * 2.54) / 96);
  const a = node.attrs ?? {};
  const wrapAttr = a.wrap;
  return {
    widthCm: pxToCm(typeof a.width === 'number' && a.width > 0 ? a.width : 280),
    heightCm: pxToCm(typeof a.height === 'number' && a.height > 0 ? a.height : 96),
    rotationDeg: typeof a.rotation === 'number' ? a.rotation : 0,
    wrap: wrapAttr === 'left' || wrapAttr === 'right' || wrapAttr === 'topBottom' ? wrapAttr : 'inline',
    wrapOffsetCm: typeof a.wrapOffset === 'number' ? round3(a.wrapOffset) : null,
    wrapOffsetYCm: typeof a.wrapOffsetY === 'number' ? round3(a.wrapOffsetY) : null,
    wrapDistCm: typeof a.wrapDist === 'number' ? round3(a.wrapDist) : null,
    wrapAlign: a.wrapAlign === 'center' || a.wrapAlign === 'right' ? a.wrapAlign : null,
    paddingCm: typeof a.paddingCm === 'number' ? round3(a.paddingCm) : TEXTBOX_PADDING_CM,
    shapeKind: isShapeKind(a.shapeKind) ? a.shapeKind : 'textbox',
    fill: typeof a.fillColor === 'string' && a.fillColor ? a.fillColor : null,
    stroke: typeof a.strokeColor === 'string' && a.strokeColor ? a.strokeColor : null,
    strokeWidthPt: typeof a.strokeWidthPt === 'number' && a.strokeWidthPt > 0 ? a.strokeWidthPt : 1,
    spaceBeforePt: typeof a.spaceBefore === 'number' ? round3(a.spaceBefore) : 0,
    spaceAfterPt: typeof a.spaceAfter === 'number' ? round3(a.spaceAfter) : 0,
  };
}

// Swap each top-level textBox for a pair of marker paragraphs bracketing its child blocks,
// hoisted to top level so they ride every existing export pass unchanged (custom attrs,
// list styles, inline sentinels, images); applyTextBoxes re-wraps the serialized region.
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

// One footnote/endnote, collected by replaceNotes and emitted by applyNotes.
type NoteExport = { kind: 'footnote' | 'endnote'; citation: string; label: string | null; styleName: string | null };

// Anchors become an FNT A{i} sentinel run in the running text; the note section is
// dissolved and each note re-emitted as its own top-level paragraph opening with an
// FNT B{i} sentinel. Hoisted like a text box, so the note text rides every existing
// pass — marks, character styles, links, bookmarks, fields and formulas all included.
function replaceNotes(doc: TiptapNode, notes: NoteExport[]): TiptapNode {
  const bodies = new Map<string, { content: TiptapNode[]; label: string | null; styleName: string | null }>();
  const body: TiptapNode[] = [];
  for (const child of doc.content ?? []) {
    if (child.type !== 'noteSection') { body.push(child); continue; }
    for (const note of child.content ?? []) {
      const a = note.attrs ?? {};
      bodies.set(String(a.id ?? ''), {
        content: note.content ?? [],
        label: typeof a.label === 'string' && a.label ? a.label : null,
        styleName: typeof a.styleName === 'string' && a.styleName ? a.styleName : null,
      });
    }
  }

  // Anchor order is the numbering order, so it is also the index order.
  const order: string[] = [];
  const swapRefs = (node: TiptapNode): TiptapNode => {
    if (!node.content?.length) return node;
    return {
      ...node,
      content: node.content.map((child) => {
        if (child.type !== 'noteRef') return swapRefs(child);
        const a = child.attrs ?? {};
        const id = String(a.id ?? '');
        const i = notes.length;
        order.push(id);
        notes.push({
          kind: a.kind === 'endnote' ? 'endnote' : 'footnote',
          citation: String(a.text ?? ''),
          label: bodies.get(id)?.label ?? null,
          styleName: bodies.get(id)?.styleName ?? null,
        });
        return { type: 'text', text: `${FNT}A${i}${FNT}` };
      }),
    };
  };

  const hoisted = body.map(swapRefs);
  order.forEach((id, i) => {
    hoisted.push({
      type: 'paragraph',
      content: [{ type: 'text', text: `${FNT}B${i}${FNT}` }, ...(bodies.get(id)?.content ?? [])],
    });
  });
  return { ...doc, content: hoisted };
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
type TocEntry = { text: string; level: number; page: number; pages?: number[] };
type TocExport = { kind: IndexKind; entries: TocEntry[]; title: string | null; maxLevel: number; leader: string | null; tabPosCm: number | null; levelStyles: (string | null)[] | null };

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
          // An alphabetical row lists every page its term appears on.
          ...(Array.isArray(e.pages) && e.pages.length ? { pages: e.pages.map((n: unknown) => Math.max(1, Number(n) || 1)) } : {}),
        }));
      const rawTitle = child.attrs?.title;
      const depth = Number(child.attrs?.maxLevel);
      tocs.push({
        kind: indexKindOf(child.attrs?.index),
        entries,
        title: typeof rawTitle === 'string' ? rawTitle : null,
        maxLevel: depth >= 1 ? Math.min(MAX_HEADING_LEVEL, depth) : MAX_HEADING_LEVEL,
        leader: normalizeLeader(child.attrs?.leader),
        tabPosCm: typeof child.attrs?.tabPosCm === 'number' ? child.attrs.tabPosCm : null,
        levelStyles: Array.isArray(child.attrs?.levelStyles) ? (child.attrs!.levelStyles as (string | null)[]) : null,
      });
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
  // The block's own base direction (textDirection.ts); null inherits the page's.
  dir: 'ltr' | 'rtl' | null;
};

function paraStyleIsEmpty(s: ParaStyle): boolean {
  return s.align === null && s.spaceBefore === null && s.spaceAfter === null && s.lineHeight === null
    && s.background === null && s.borderTop === null && s.borderRight === null
    && s.borderBottom === null && s.borderLeft === null && s.dir === null;
}

// ODF writes a direction as a writing mode; the vertical ones are not ours to emit.
export function writingModeOf(dir: 'ltr' | 'rtl' | null | undefined): string | null {
  return dir === 'rtl' ? 'rl-tb' : dir === 'ltr' ? 'lr-tb' : null;
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
    dir: attrs?.dir === 'rtl' || attrs?.dir === 'ltr' ? attrs.dir : null,
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
  const wm = writingModeOf(style.dir);
  if (wm) props.push(`style:writing-mode="${wm}"`);
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
type TableProps = { ml: number; mr: number; mt: number; mb: number; keepRows: boolean; repeatHeader: boolean };

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

  content = injectAutomaticStyles(content, `${newStyles}\n`);

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// odf-kit only writes the fo:padding shorthand, which ODF defines as one length —
// LibreOffice drops a multi-value form. The cells carry their table's margins as a
// CSS-style TRBL shorthand, which this expands per side (scoped to cell properties).
function expandCellPadding(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  const content = strFromU8(contentBytes).replace(
    /(<style:table-cell-properties\b[^>]*?)fo:padding="([^"]*)"/g,
    (_m, head: string, value: string) => {
      const [top, right, bottom, left] = value.trim().split(/\s+/);
      if (!left) return head + `fo:padding="${value}"`;
      return head + `fo:padding-top="${top}" fo:padding-right="${right}"`
        + ` fo:padding-bottom="${bottom}" fo:padding-left="${left}"`;
    },
  );

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// A dragged table edge → the style's fo:margin-left/-right + style:width (with odf-kit's
// table:align="margins" the table fills what's left); keep-rows → may-break-between-rows.
// odf-kit names table styles Table1, Table2, … in document order, as the descriptors are.
function applyTableProps(odtBytes: Uint8Array, margins: (TableProps | null)[], contentWidthCm: number): Uint8Array {
  if (margins.every(m => m === null)) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  margins.forEach((m, i) => {
    if (!m) return;
    const width = Math.round((contentWidthCm - m.ml - m.mr) * 1000) / 1000;
    const horiz = m.ml || m.mr
      ? ` style:width="${width}cm" fo:margin-left="${m.ml}cm" fo:margin-right="${m.mr}cm"` : '';
    const vert = `${m.mt ? ` fo:margin-top="${m.mt}cm"` : ''}${m.mb ? ` fo:margin-bottom="${m.mb}cm"` : ''}`;
    const keep = m.keepRows ? ' style:may-break-between-rows="false"' : '';
    content = content.replace(
      new RegExp(`(<style:style[^>]*style:name="Table${i + 1}"[^>]*>\\s*<style:table-properties)`),
      `$1${horiz}${vert}${keep}`,
    );
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// <table:table-header-rows> around a table's first row, which is what makes both word
// processors repeat it at the top of every page the table continues on. The tables come
// out in document order, the same order applyTableProps walks.
function applyTableHeaderRows(odtBytes: Uint8Array, tables: (TableProps | null)[]): Uint8Array {
  if (!tables.some(t => t?.repeatHeader)) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  let index = -1;
  content = content.replace(/<table:table\b[\s\S]*?<\/table:table>/g, (table) => {
    index++;
    if (!tables[index]?.repeatHeader) return table;
    const open = table.indexOf('<table:table-row');
    if (open < 0) return table;
    const close = table.indexOf('</table:table-row>', open);
    if (close < 0) return table;
    const end = close + '</table:table-row>'.length;
    return table.slice(0, open)
      + `<table:table-header-rows>${table.slice(open, end)}</table:table-header-rows>`
      + table.slice(end);
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
  // Which conditional areas the table opts into (ODF's own table:use-*-styles), so the
  // toggles survive a round trip. Lookahead, not \b: a hyphen is a word boundary, so \b
  // would also match <table:table-cell/-row/-column and consume the counter.
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

  content = injectAutomaticStyles(content, `${newStyles}\n`);

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
    content = injectAutomaticStyles(content, minted.join(''));
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// The paragraph mark's font as an FSZ payload ("<size>|<family>", either half empty).
function markFontPayload(attrs: TiptapNode['attrs']): string {
  const size = typeof attrs?.fontSize === 'string' ? attrs.fontSize : '';
  const family = typeof attrs?.fontFamily === 'string' ? attrs.fontFamily : '';
  return size || family ? `${size}|${family}` : '';
}

// The paragraph style's own text properties for that payload (+ asian/complex aliases).
function fontSizeProps(payload: string): string {
  const [size, family] = payload.split('|');
  const font = family ? twinFontName(family) : '';
  return [
    size ? `fo:font-size="${size}" style:font-size-asian="${size}" style:font-size-complex="${size}"` : '',
    font ? `style:font-name="${font}" style:font-name-asian="${font}" style:font-name-complex="${font}"` : '',
  ].filter(Boolean).join(' ');
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
    content = injectAutomaticStyles(content, minted.join(''));
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// A top-level paragraph's box spec for the PBX sentinel: bg|borderTop|Right|Bottom|Left,
// each the raw value (canonical border '<W>pt solid #RRGGBB' is a valid fo:border) or '',
// then a widow flag, the right indent, a keep-with-next flag and the writing mode.
// '' when it needs none.
function paraBoxSpec(attrs: TiptapNode['attrs']): string {
  const s = paraStyleFromAttrs(attrs);
  const noWidow = attrs?.widowControl === false;
  const keepNext = attrs?.keepNext === true;
  const keepLines = attrs?.keepLines === true;
  // odf-kit has a paragraph option for the left indent but none for the right one.
  const right = typeof attrs?.indentRight === 'number' && attrs.indentRight > 0 ? attrs.indentRight : 0;
  const wm = writingModeOf(s.dir);
  if (!s.background && !s.borderTop && !s.borderRight && !s.borderBottom && !s.borderLeft && !noWidow && !right && !keepNext && !keepLines && !wm) return '';
  return [s.background, s.borderTop, s.borderRight, s.borderBottom, s.borderLeft]
    .map((v) => v ?? '')
    .concat(noWidow ? 'w0' : '', right ? `${right}cm` : '', keepNext ? 'k1' : '', keepLines ? 'g1' : '', wm ?? '').join('|');
}

function boxSpecToProps(spec: string): string {
  const [bg, bt, br, bb, bl, widow, marginRight, keepNext, keepLines, writingMode] = spec.split('|');
  const props: string[] = [];
  if (bg) props.push(`fo:background-color="${bg}"`);
  if (bt) props.push(`fo:border-top="${bt}"`);
  if (br) props.push(`fo:border-right="${br}"`);
  if (bb) props.push(`fo:border-bottom="${bb}"`);
  if (bl) props.push(`fo:border-left="${bl}"`);
  // LibreOffice writes 0/0 for "off"; absent means the XSL-FO default of 2.
  if (widow === 'w0') props.push('fo:orphans="0"', 'fo:widows="0"');
  if (marginRight) props.push(`fo:margin-right="${marginRight}"`);
  if (keepNext === 'k1') props.push('fo:keep-with-next="always"');
  if (keepLines === 'g1') props.push('fo:keep-together="always"');
  if (writingMode) props.push(`style:writing-mode="${writingMode}"`);
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
    if (!v || v === 'none') continue;
    para[`fo:border-${side}`] = String(v);
    // The gap to the rule, on the ruled sides only — fo:padding would ring the block.
    if (p.borderPadding != null) para[`fo:padding-${side}`] = `${p.borderPadding}pt`;
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
  if (t.letterSpacingPt) text['fo:letter-spacing'] = `${t.letterSpacingPt}pt`;
  if (t.kerning != null) text['style:letter-kerning'] = String(t.kerning);
  if (t.bold != null) text['fo:font-weight'] = t.bold ? 'bold' : 'normal';
  if (t.italic != null) text['fo:font-style'] = t.italic ? 'italic' : 'normal';
  if (t.underline) text['style:text-underline-style'] = 'solid';
  if (t.strike) text['style:text-line-through-style'] = 'solid';
  if (t.color) text['fo:color'] = String(t.color);
  if (t.caps === 'smallCaps') text['fo:font-variant'] = 'small-caps';
  else if (t.caps) text['fo:text-transform'] = String(t.caps);
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
    content = injectAutomaticStyles(content, minted.join(''));
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
    content = injectAutomaticStyles(content, minted.join(''));
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

// Per-level indent (cm) and label alignment of each top-level list, from the first list
// at that level. odf-kit uses label-alignment mode (which ignores the paragraph margin),
// so both go onto the L# list-style's own level definitions.
type ListLevelProps = { indent: number; right: boolean };

function collectListLevelProps(node: TiptapNode, result: ListLevelProps[][]): void {
  for (const child of node.content ?? []) {
    if (child.type !== 'bulletList' && child.type !== 'orderedList') continue;
    const levels: ListLevelProps[] = [];
    const visit = (list: TiptapNode, depth: number) => {
      const ind = list.attrs?.indent;
      if (levels[depth - 1] === undefined) {
        levels[depth - 1] = { indent: typeof ind === 'number' ? ind : 0, right: list.attrs?.markerAlign === 'right' };
      }
      for (const item of list.content ?? []) {
        for (const block of item.content ?? []) {
          if (block.type === 'bulletList' || block.type === 'orderedList') visit(block, depth + 1);
        }
      }
    };
    visit(child, 1);
    result.push(levels);
  }
}

function applyListLevelProps(odtBytes: Uint8Array, props: ListLevelProps[][]): Uint8Array {
  const plain = (l: ListLevelProps) => !l?.indent && !l?.right;
  if (props.every(levels => levels.every(plain))) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const bump = (cm: number) => (_m: string, attr: string, v: string) =>
    `${attr}="${(parseFloat(v) + cm).toFixed(3)}cm"`;
  // The editor nests the levels, so a level's margin grows by every indent above it too.
  const rewriteLevels = (body: string, levels: ListLevelProps[]) =>
    body.replace(/<text:list-level-style-[a-z]+[\s\S]*?(?=<text:list-level-style-|$)/g, (lvl) => {
      const n = parseInt(/text:level="(\d+)"/.exec(lvl)?.[1] ?? '', 10);
      if (!Number.isFinite(n)) return lvl;
      const cm = levels.slice(0, n).reduce((a, b) => a + (b?.indent || 0), 0);
      const shifted = cm
        ? lvl.replace(/(fo:margin-left)="([\d.]+)cm"/g, bump(cm))
             .replace(/(text:list-tab-stop-position)="([\d.]+)cm"/g, bump(cm))
        : lvl;
      return levels[n - 1]?.right
        ? shifted.replace('<style:list-level-properties ', '<style:list-level-properties fo:text-align="end" ')
        : shifted;
    });

  props.forEach((levels, i) => {
    if (levels.every(plain)) return;
    const re = new RegExp(`(<text:list-style style:name="L${i + 1}">)([\\s\\S]*?)(</text:list-style>)`);
    content = content.replace(re, (_m, open: string, body: string, close: string) =>
      open + rewriteLevels(body, levels) + close);
  });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Marker formatting per nesting level of each top-level list, from the first list at
// that level (null unless its items agree — see listMarkerFormat). Nested lists that
// odf-kit restyles keep their plain marker.
function collectListMarkerFormats(doc: TiptapNode, result: (MarkerFormat | null)[][]): void {
  for (const child of doc.content ?? []) {
    if (child.type !== 'bulletList' && child.type !== 'orderedList') continue;
    const levels: (MarkerFormat | null)[] = [];
    const visit = (list: TiptapNode, depth: number) => {
      if (levels[depth - 1] === undefined) levels[depth - 1] = listMarkerFormat(list, charStyleProps(exportSheet));
      for (const item of list.content ?? []) {
        for (const block of item.content ?? []) {
          if (block.type === 'bulletList' || block.type === 'orderedList') visit(block, depth + 1);
        }
      }
    };
    visit(child, 1);
    result.push(levels);
  }
}

// text:style-name on the level definition points at a style:family="text" style — how
// ODF formats a number/bullet. It has to be a **named** style in styles.xml:
// LibreOffice ignores the reference when it resolves to an automatic one (probed).
function applyListMarkerFormats(odtBytes: Uint8Array, formats: (MarkerFormat | null)[][]): Uint8Array {
  if (!formats.some((levels) => levels.some(Boolean))) return odtBytes;

  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  const stylesBytes = files['styles.xml'];
  if (!contentBytes || !stylesBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  const minted: string[] = [];
  const nameByProps = new Map<string, string>();
  const styleFor = (format: MarkerFormat): string => {
    const color = format.color ? normalizeColor(format.color) : undefined;
    const props = (format.fontFamily ? ` fo:font-family="${twinFontName(format.fontFamily)}"` : '')
      + (format.fontWeight ? ` fo:font-weight="${format.fontWeight}"` : '')
      + (format.fontStyle ? ` fo:font-style="${format.fontStyle}"` : '')
      + (format.fontSize ? ` fo:font-size="${format.fontSize}"` : '')
      + (color ? ` fo:color="${color}"` : '');
    let name = nameByProps.get(props);
    if (!name) {
      name = `MK${nameByProps.size + 1}`;
      nameByProps.set(props, name);
      minted.push(`<style:style style:name="${name}" style:family="text"><style:text-properties${props}/></style:style>`);
    }
    return name;
  };

  formats.forEach((levels, i) => {
    if (!levels.some(Boolean)) return;
    const re = new RegExp(`(<text:list-style style:name="L${i + 1}">)([\\s\\S]*?)(</text:list-style>)`);
    content = content.replace(re, (_m, open: string, body: string, close: string) =>
      open +
      body.replace(/<text:list-level-style-(number|bullet) text:level="(\d)"/g, (match, kind: string, level: string) => {
        const format = levels[Number(level) - 1];
        return format ? `<text:list-level-style-${kind} text:level="${level}" text:style-name="${styleFor(format)}"` : match;
      }) +
      close,
    );
  });

  if (minted.length) {
    files['styles.xml'] = strToU8(
      strFromU8(stylesBytes).replace('</office:styles>', `${minted.join('\n')}\n</office:styles>`),
    );
  }
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
    content = injectAutomaticStyles(content, `${minted.join('\n')}\n`);
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
    content = injectAutomaticStyles(content, `${additions.join('\n')}\n`);
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
// LibreOffice's watermark is a fontwork shape in the master page's header, and the
// enhanced geometry below is the "fontwork-plain-text" preset it writes verbatim.
const WATERMARK_GEOMETRY =
  '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:text-areas="0 0 21600 21600"' +
  ' draw:text-path="true" draw:type="fontwork-plain-text" draw:modifiers="10800"' +
  ' draw:enhanced-path="M ?f3 0 L ?f5 0 N M ?f6 21600 L ?f7 21600 N">' +
  '<draw:equation draw:name="f0" draw:formula="$0 -10800"/>' +
  '<draw:equation draw:name="f1" draw:formula="?f0 *2"/>' +
  '<draw:equation draw:name="f2" draw:formula="abs(?f1 )"/>' +
  '<draw:equation draw:name="f3" draw:formula="if(?f1 ,0,?f2 )"/>' +
  '<draw:equation draw:name="f4" draw:formula="21600-?f2 "/>' +
  '<draw:equation draw:name="f5" draw:formula="if(?f1 ,?f4 ,21600)"/>' +
  '<draw:equation draw:name="f6" draw:formula="if(?f1 ,?f2 ,0)"/>' +
  '<draw:equation draw:name="f7" draw:formula="if(?f1 ,21600,?f4 )"/>' +
  '</draw:enhanced-geometry>';

// LibreOffice's own shape name; Word looks for exactly this one, so a round trip
// through either keeps recognising the shape as a watermark rather than a drawing.
const WATERMARK_NAME = 'PowerPlusWaterMarkObject';
// The shape's aspect ratio, measured off LibreOffice's own output (17cm × 3.789cm).
const WATERMARK_RATIO = 4.487;

// The watermark shape plus its two automatic styles, spliced into the master page's
// header — where both word processors keep it. A document without a header gets an
// explicit zero-height header band, so the body's geometry is unchanged.
function applyWatermarkOdf(odtBytes: Uint8Array, wm: Watermark | null): Uint8Array {
  if (!wm?.text) return odtBytes;
  const files = unzipSync(odtBytes);
  const stylesBytes = files['styles.xml'];
  if (!stylesBytes) return odtBytes;
  const styles = strFromU8(stylesBytes);
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const widthCm = Math.max(1, lengthOfPageLayout(styles) );
  const heightCm = round3(widthCm / WATERMARK_RATIO);
  const opacity = `${round3(100 - wm.transparency)}%`;
  const minted =
    `<style:style style:name="Wmk1" style:family="graphic"><style:graphic-properties` +
    ` draw:stroke="none" draw:fill="solid" draw:fill-color="${wm.color}" draw:opacity="${opacity}"` +
    ` draw:auto-grow-height="false" draw:auto-grow-width="false"` +
    ` fo:min-height="${heightCm}cm" fo:min-width="${round3(widthCm)}cm"` +
    ` style:run-through="background" style:wrap="run-through" style:number-wrapped-paragraphs="no-limit"` +
    ` style:vertical-pos="middle" style:vertical-rel="page-content"` +
    ` style:horizontal-pos="center" style:horizontal-rel="page-content" style:flow-with-text="false"/></style:style>` +
    `<style:style style:name="WmkP1" style:family="paragraph"><style:text-properties` +
    ` fo:font-family="${escapeXml(`'${wm.font}'`)}" fo:font-size="1pt"/></style:style>`;
  const shape =
    `<draw:custom-shape text:anchor-type="char" draw:z-index="0" draw:name="${WATERMARK_NAME}"` +
    ` draw:style-name="Wmk1" draw:text-style-name="WmkP1"` +
    ` svg:width="${round3(widthCm)}cm" svg:height="${heightCm}cm"` +
    ` draw:transform="rotate (${(wm.angle * Math.PI) / 180})">` +
    `<text:p>${escapeXml(wm.text)}</text:p>${WATERMARK_GEOMETRY}</draw:custom-shape>`;

  // odf-kit declares no draw: prefix in styles.xml, and an undeclared one makes
  // LibreOffice drop the whole shape without a word.
  let out = styles.includes('xmlns:draw=')
    ? styles
    : styles.replace(/<office:document-styles\b/, '<office:document-styles xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"');
  out = injectAutomaticStyles(out, minted);
  // Into the header the document already has — the shape is out of flow, so it changes
  // neither the band nor the zone's text.
  if (out.includes('<style:header>')) {
    out = out.replace(/<style:header>(\s*<text:p[^>]*>)?/, (m) =>
      m.includes('<text:p') ? `${m}${shape}` : `${m}<text:p text:style-name="Header">${shape}</text:p>`);
  } else {
    // No header: give the master page one that reserves no band of its own. LibreOffice
    // still floors the band at 0.499cm, so the body shifts by that much — its own
    // watermark does the same.
    const zone = `<style:header><text:p text:style-name="Header">${shape}</text:p></style:header>`;
    out = out.replace(/<style:header-style\s*\/>/, '<style:header-style><style:header-footer-properties fo:min-height="0cm" fo:margin-bottom="0cm"/></style:header-style>');
    out = /<style:master-page\b[^>]*\/>/.test(out)
      ? out.replace(/(<style:master-page\b[^>]*)\/>/, `$1>${zone}</style:master-page>`)
      : out.replace(/(<style:master-page\b[^>]*>)/, `$1${zone}`);
  }
  files['styles.xml'] = strToU8(out);
  return rezipOdt(files);
}

// The text width the page layout declares, in cm — the watermark spans it, as
// LibreOffice's does.
function lengthOfPageLayout(styles: string): number {
  const num = (attr: string) => {
    const m = new RegExp(`${attr}="([\\d.]+)cm"`).exec(styles);
    return m ? parseFloat(m[1]) : 0;
  };
  const width = num('fo:page-width');
  return width ? width - num('fo:margin-left') - num('fo:margin-right') : 17;
}

function rewriteStylesXml(odtBytes: Uint8Array, lang: { language: string; country: string } | null, pageFormat: PageFormat, orientation: Orientation, sheet: StyleSheet, used: Set<string>, usedTables: Set<string> = new Set(), tabIntervalCm: number = DEFAULT_TAB_INTERVAL_CM, mirrored = false, rtl = false, notes: NoteSettings = DEFAULT_NOTE_SETTINGS, hyphenate = false, pageNumbering: PageNumbering = DEFAULT_PAGE_NUMBERING, decor: PageDecor = EMPTY_PAGE_DECOR, lineNumbering: LineNumbering = DEFAULT_LINE_NUMBERING): Uint8Array {
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

  // Mirrored margins: fo:margin-left/right are the inner/outer pair, which is what
  // the editor already holds, so only the flag has to be written back.
  if (mirrored) {
    styles = styles.replace(/<style:page-layout /, '<style:page-layout style:page-usage="mirrored" ');
  }

  // A right-to-left page: its columns fill from the right, as the editor draws them.
  if (rtl) {
    styles = styles.replace(/<style:page-layout-properties /, '<style:page-layout-properties style:writing-mode="rl-tb" ');
  }

  // Page background and page border ride the page layout, exactly where LibreOffice
  // keeps them (probed). The border is offset from the text area by fo:padding.
  const decorProps = [
    decor.border ? `fo:border="${round3(decor.border.widthPt)}pt solid ${decor.border.color}"` : '',
    decor.border ? `fo:padding="${round3(decor.border.paddingCm)}cm"` : '',
    decor.background ? `fo:background-color="${decor.background}"` : '',
  ].filter(Boolean).join(' ');
  if (decorProps) {
    styles = styles.replace(/<style:page-layout-properties /, `<style:page-layout-properties ${decorProps} `);
  }

  // Line numbering is one document-wide element in office:styles (probed). LibreOffice
  // writes only what differs from the ODF defaults, so an unnumbered document has none.
  if (lineNumbering.on) {
    const cfg = `<text:linenumbering-configuration text:number-lines="true"`
      + ` text:offset="${round3(lineNumbering.distanceCm)}cm" style:num-format="1"`
      + ` text:number-position="left" text:increment="${lineNumbering.interval}"`
      + ` text:count-empty-lines="${lineNumbering.countEmpty}"`
      + ` text:restart-on-page="${lineNumbering.restart === 'page'}"/>`;
    styles = styles.includes('</office:styles>')
      ? styles.replace('</office:styles>', `${cfg}</office:styles>`)
      : styles.replace(/<office:automatic-styles\b/, `<office:styles>${cfg}</office:styles><office:automatic-styles`);
  }

  // How the page-number field counts. ODF keeps the format on the page layout; the start
  // value is a property of the document's first paragraph (applyPageNumberStart).
  if (pageNumbering.format !== '1') {
    styles = styles.replace(
      /<style:page-layout-properties /,
      `<style:page-layout-properties style:num-format="${pageNumbering.format}" `,
    );
  }

  // Document spell-check language: set fo:language/fo:country on the base
  // Standard paragraph style, which every paragraph inherits from. LibreOffice
  // and Word read this as the document default language.
  if (lang) {
    styles = styles.replace(
      /(<style:style style:name="Standard"[\s\S]*?<style:text-properties\b[^>]*?)\/>/,
      `$1 fo:language="${lang.language}" fo:country="${lang.country}"/>`,
    );
  }

  // Automatic hyphenation. ODF counts fo:hyphenate as a *text* property, so it sits
  // beside the language on the style every paragraph inherits from — probed: in
  // paragraph-properties LibreOffice ignores it and drops it on the next save. Its two
  // limits ride along at LibreOffice's own defaults.
  if (hyphenate) {
    styles = styles.replace(
      /(<style:style style:name="Standard"[\s\S]*?<style:text-properties\b[^>]*?)\/>/,
      '$1 fo:hyphenate="true" fo:hyphenation-remain-char-count="2" fo:hyphenation-push-char-count="2"/>',
    );
  }

  // The only occurrences of "Liberation Serif" in styles.xml are the default
  // font-face declaration and the Standard style's font-name attributes.
  styles = styles.split(ODFKIT_DEFAULT_FONT).join(EXPORT_FONT);

  styles = styles.replace(
    '<style:master-page style:name="Default"',
    '<style:master-page style:name="Standard"',
  );

  // The document's tab interval, on the paragraph default-style. Always written: a file
  // that declares none falls back to ODF's own 2cm, which is not what the editor shows
  // (measured — LibreOffice puts a bare A⇥X at 2cm, not at its UI default of 1.25).
  styles = styles.replace('<office:styles>', '<office:styles>'
    + `<style:default-style style:family="paragraph"><style:paragraph-properties style:tab-stop-distance="${round3(tabIntervalCm)}cm"/></style:default-style>`
    + notesStyles() + notesConfiguration(notes));

  // The separator belongs to the page layout, beside the margins it is measured against.
  styles = styles.replace(
    /<style:page-layout-properties\b[^>]*\/>/,
    (props) => `${props.slice(0, -2)}>${footnoteSepXml(notes.separator)}</style:page-layout-properties>`,
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

// The sheet of the export in flight, so the run emitters can resolve character styles
// without threading it through every cell/list helper (mirrors docLangTag in docx.ts).
let exportSheet: StyleSheet = builtinStyleSheet();
let exportSpacingModel: SpacingModel = 'add';

// Emit each text node as an odf-kit run; link-marked runs become <text:a> via addLink.
// `force` bakes formatting onto every run regardless of marks — for header/region cells,
// whose formatting is presentational (CSS) in the editor and so isn't stored as marks.
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

// CSS line styles → ODF's own names for the same shapes.
const ODF_LINE_STYLE: Record<string, string> = { dotted: 'dotted', dashed: 'dash', wavy: 'wave' };

// The effects ODF carries but odf-kit's run formatting has no field for. Returned as
// the <style:text-properties> attributes applyTextEffects folds into the run's style.
export function odfExtraTextProps(marks: TiptapNode['marks'] = []): string {
  const a: string[] = [];
  const caps = marks.find(m => m.type === 'textStyle')?.attrs?.caps;
  if (caps === 'smallCaps') a.push('fo:font-variant="small-caps"');
  else if (caps === 'uppercase' || caps === 'lowercase' || caps === 'capitalize') a.push(`fo:text-transform="${caps}"`);
  const u = marks.find(m => m.type === 'underline')?.attrs;
  if (u?.lineStyle === 'double') a.push('style:text-underline-type="double"');
  else if (typeof u?.lineStyle === 'string' && ODF_LINE_STYLE[u.lineStyle]) {
    a.push(`style:text-underline-style="${ODF_LINE_STYLE[u.lineStyle]}"`);
  }
  if (u?.lineColor) {
    const c = normalizeColor(String(u.lineColor));
    if (c) a.push(`style:text-underline-color="${c}"`);
  }
  if (marks.find(m => m.type === 'strike')?.attrs?.lineStyle === 'double') {
    a.push('style:text-line-through-type="double"');
  }
  // ODF places a raised run in percent of its font size, Word and the editor in pt.
  const pos = marks.find(m => m.type === 'textStyle')?.attrs?.textPosition;
  if (typeof pos === 'number' && pos) {
    a.push(`style:text-position="${Math.round((pos / runSizePt(marks)) * 10000) / 100}% 100%"`);
  }
  return a.join(' ');
}

// The run's own size where it declares one — the reference for the percentage above.
function runSizePt(marks: TiptapNode['marks']): number {
  const size = marks?.find(m => m.type === 'textStyle')?.attrs?.fontSize;
  const pt = size ? parseFloat(String(size)) : NaN;
  return Number.isFinite(pt) && pt > 0 ? pt : DEFAULT_FONT_SIZE_PT;
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

// Prefix the sentinel on every run carrying such an effect, wherever it sits — odf-kit
// reads marks itself on its native paths, so the pre-pass is what reaches all of them.
function markTextEffects(node: TiptapNode): TiptapNode {
  if (node.type === 'text') {
    const extra = odfExtraTextProps(node.marks);
    return extra ? { ...node, text: `${TEF}${extra}${TEF}${node.text ?? ''}` } : node;
  }
  if (!node.content?.length) return node;
  return { ...node, content: node.content.map(markTextEffects) };
}

// odf-kit's list builder reads a run's marks itself and knows nothing about charStyle,
// and applyRuns never sees a list paragraph — so do its two jobs here: bake the style
// into direct marks (the run then gets a span) and prefix the CST sentinel for it.
function bakeListCharStyles(node: TiptapNode, sheet: StyleSheet, inList = false): TiptapNode {
  if (node.type === 'text') {
    const name = inList ? charStyleOf(node.marks) : null;
    if (!name) return node;
    return {
      ...node,
      text: `${CST}${name}${CST}${node.text ?? ''}`,
      marks: bakeMarks(node.marks ?? [], resolveStyle(sheet, name, 'character').text),
    };
  }
  if (!node.content?.length) return node;
  const nested = inList || node.type === 'bulletList' || node.type === 'orderedList';
  return { ...node, content: node.content.map(c => bakeListCharStyles(c, sheet, nested)) };
}

// The style's props as direct marks, with the run's own marks on top (as in applyRuns).
function bakeMarks(marks: TiptapMark[], t: TextProps): TiptapMark[] {
  const out = marks.filter(m => m.type !== 'textStyle');
  const own = marks.find(m => m.type === 'textStyle')?.attrs ?? {};
  const attrs: Record<string, unknown> = {};
  if (t.fontFamily) attrs.fontFamily = t.fontFamily;
  if (t.fontSizePt != null) attrs.fontSize = `${t.fontSizePt}pt`;
  if (t.color) attrs.color = t.color;
  for (const [key, value] of Object.entries(own)) if (value != null) attrs[key] = value;
  // An explicit weight is the un-bold channel and outranks the style's bold.
  const flags = [[t.bold && own.fontWeight == null, 'bold'], [t.italic, 'italic'],
    [t.underline, 'underline'], [t.strike, 'strike']] as const;
  for (const [on, type] of flags) if (on && !marks.some(m => m.type === type)) out.push({ type });
  if (Object.keys(attrs).length) out.push({ type: 'textStyle', attrs });
  return out;
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
    content = injectAutomaticStyles(content, minted.join(''));
  }

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Merge each TEF sentinel's effects into that run's own automatic text style (cloned,
// since the style is shared) and wrap a run that got no span in one. Shared by
// content.xml (body) and styles.xml (header/footer), which mint their styles separately.
function resolveTextEffects(xml: string, mint: (styleXml: string) => void, prefix: string): string {
  if (!xml.includes(TEF)) return xml;
  const nameByKey = new Map<string, string>();
  const styleFor = (source: string, extra: string): string => {
    const key = `${source}|${extra}`;
    const existing = nameByKey.get(key);
    if (existing) return existing;
    const name = `${prefix}${nameByKey.size + 1}`;
    nameByKey.set(key, name);
    const auto = source ? findAutoStyle(xml, source) : null;
    const names = [...extra.matchAll(/([\w:.-]+)=/g)].map(m => m[1]);
    mint(auto
      ? auto.replace(/style:name="[^"]*"/, `style:name="${name}"`)
          .replace(/<style:text-properties\b([^>]*?)(\/?)>/, (_m, attrs: string, slash: string) => {
            const kept = names.reduce((acc, n) => acc.replace(new RegExp(`\\s${n}="[^"]*"`, 'g'), ''), attrs);
            return `<style:text-properties${kept} ${extra}${slash}>`;
          })
      : `<style:style style:name="${name}" style:family="text"><style:text-properties ${extra}/></style:style>`);
    return name;
  };

  const tefRe = new RegExp(`${TEF}([^${TEF}]*)${TEF}`);
  let out = xml.replace(
    new RegExp(`<text:span\\b([^>]*)>([\\s\\S]*?)</text:span>`, 'g'),
    (m, attrs: string, inner: string) => {
      const sm = tefRe.exec(inner);
      if (!sm) return m;
      const srcM = /text:style-name="([^"]*)"/.exec(attrs);
      const name = styleFor(srcM ? srcM[1] : '', sm[1]);
      const newAttrs = srcM
        ? attrs.replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
        : ` text:style-name="${name}"${attrs}`;
      return `<text:span${newAttrs}>${inner.replace(new RegExp(tefRe.source, 'g'), '')}</text:span>`;
    },
  );
  // A run whose only formatting is such an effect never got a span: give it one, up to
  // the next element (a tab or line break carries no visible effect anyway).
  out = out.replace(
    new RegExp(`${TEF}([^${TEF}]*)${TEF}([^<${TEF}]*)`, 'g'),
    (_m, extra: string, text: string) => `<text:span text:style-name="${styleFor('', extra)}">${text}</text:span>`,
  );
  return out;
}

function applyTextEffects(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  const before = strFromU8(contentBytes);
  const minted: string[] = [];
  const content = resolveTextEffects(before, (s) => minted.push(s), 'TE');
  if (content === before) return odtBytes;

  files['content.xml'] = strToU8(injectAutomaticStyles(content, minted.join('')));
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
    else if (node.type === 'chapterField') b.addText(chapterSentinel(node), f);
  }
}

// CHP<level>CHP<cached name>CHP — the cached name is what a reader shows before it
// resolves the field itself, so it rides along like LibreOffice writes it.
function chapterSentinel(node: TiptapNode): string {
  const level = Number(node.attrs?.level) || 1;
  return `${CHP}${level}${CHP}${String(node.attrs?.text ?? '')}${CHP}`;
}

// Emit a cell's inline content into odf-kit's run-based CellBuilder and, in lockstep,
// return a CellBlock[] descriptor. odf-kit serializes the runs into one <text:p>;
// applyCellBlocks splits on SEG and rebuilds real <text:h>/<text:p>/<text:list>.

// A segment is one paragraph, heading, or list item's paragraph; exactly one SEG
// between consecutive segments, so splitting yields one piece per segment in DFS order.
// Neither word processor passes the default style's spacing into a cell (LibreOffice's Table
// Contents zeroes both, Word's table styles the space below), and editor.css renders it that
// way — so the file says so too. A paragraph's own spacing still wins.
function cellParaStyle(attrs: TiptapNode['attrs']): ParaStyle {
  const style = paraStyleFromAttrs(attrs);
  if (attrs?.styleName) return style;
  const def = resolveStyle(exportSheet, DEFAULT_STYLE).para;
  if (!def.spaceBefore && !def.spaceAfter) return style;
  const spaceBefore = exportSpacingModel === 'max' ? style.spaceBefore : style.spaceBefore ?? 0;
  return { ...style, spaceBefore, spaceAfter: style.spaceAfter ?? 0 };
}

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
      blocks.push({ kind: 'paragraph', style: cellParaStyle(block.attrs) });
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
    blocks.push({ kind: 'paragraph', style: cellParaStyle(undefined) });
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

// What rides on a table's own automatic style: its left/right margins (cm, from the
// outer-edge drag, clamped into the text width) and whether a page break may fall
// between its rows. null = a full-width table that may break, the common case.
function tablePropsOf(node: TiptapNode, contentWidthCm: number): TableProps | null {
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  let ml = Math.max(0, Number(node.attrs?.marginLeft) || 0);
  let mr = Math.max(0, Number(node.attrs?.marginRight) || 0);
  const mt = Math.max(0, Number(node.attrs?.marginTop) || 0);
  const mb = Math.max(0, Number(node.attrs?.marginBottom) || 0);
  const keepRows = node.attrs?.keepRows === true;
  const repeatHeader = node.attrs?.repeatHeader === true;
  if (ml + mr > contentWidthCm - 1) ml = mr = 0;
  if (!ml && !mr && !mt && !mb && !keepRows && !repeatHeader) return null;
  return { ml: round3(ml), mr: round3(mr), mt: round3(mt), mb: round3(mb), keepRows, repeatHeader };
}

// Build an ODF table from a CUST_TABLE node, bypassing odf-kit's native walkTable to
// pass an explicit cell border (the native path emits none → invisible). Column widths
// come from tableColumnWidthsCm; when absent odf-kit distributes columns evenly.
function exportTable(node: TiptapNode, doc: OdtDocument, contentWidthCm: number, cellBlocks: CellBlock[][], tableMargins: (TableProps | null)[], tableStyleNames: (TableStyleRef | null)[]): void {
  const rows = (node.content ?? []).filter(r => r.type === 'tableRow');
  if (rows.length === 0) return;
  const margins = tablePropsOf(node, contentWidthCm);
  tableMargins.push(margins);
  // The named table style, if the registry still knows it: its name goes on the table's
  // automatic style (applyTableStyleNames), its text formatting is baked per cell.
  const styleName = typeof node.attrs?.tableStyle === 'string' ? node.attrs.tableStyle : null;
  const tableStyle = styleName ? exportSheet.table?.[styleName] : undefined;
  const look = parseTableLook(node.attrs?.tableLook);
  tableStyleNames.push(tableStyle && styleName ? { name: styleName, look } : null);
  const columnWidths = tableColumnWidthsCm(node, contentWidthCm - (margins ? margins.ml + margins.mr : 0));
  // Cell margins ride on every cell as a TRBL shorthand (ODF has no table-level one);
  // expandCellPadding splits it, since odf-kit only writes fo:padding and ODF only
  // allows one length there. A cell's own attr overrides the table's.
  const tablePad = parseCellPadding(node.attrs?.cellPadding) ?? DEFAULT_CELL_PADDING;
  const padValue = (p: CellPadding) => p.map(n => `${n}cm`).join(' ');
  doc.addTable((t: TableBuilder) => {
    for (const row of rows) {
      t.addRow((r: RowBuilder) => {
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
          // Emit the cell's runs (SEG-separated) and record its descriptor; addCell is
          // synchronous, so the push stays in document order, matching applyCellBlocks'
          // walk. Spans make odf-kit emit covered cells, which its cell regex never matches.
          const opts: CellOptions = { padding: padValue(parseCellPadding(cell.attrs?.cellPadding) ?? tablePad) };
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
          // Content set against the middle/bottom of the box → style:vertical-align.
          const va = cell.attrs?.verticalAlign;
          if (va === 'middle' || va === 'bottom') opts.verticalAlign = va;
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
// LBR → <text:line-break/>, TAB → <text:tab/> (both valid as bare paragraph text and
// inside <text:span>), and complete the decimal stop odf-kit only half-writes.
const CHAR_TAB_STOP = 'style:type="char"';

// The ODF line kind that goes with a fill character.
const ODF_LEADER_STYLE: Record<string, string> = { '.': 'dotted', '·': 'dotted', '-': 'dash', '_': 'solid' };

// odf-kit has no leader option and mints one automatic style per distinct option set,
// so the leader rides style:type — where a bare map would give two stops that agree on
// position and alignment the same style, and with it the same leader.
function applyTabLeaders(odtBytes: Uint8Array): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;
  let content = strFromU8(contentBytes);
  if (!content.includes(LEAD)) return odtBytes;
  content = content.replace(new RegExp(`style:type="([a-z]+)${LEAD}(.)"`, 'g'), (_m, type, ch) =>
    `style:type="${type}" style:leader-style="${ODF_LEADER_STYLE[ch]}" style:leader-text="${ch}"`);
  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

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
// An offset frame is placed by coordinate instead (svg:x on the frame).
function imageWrapProps(wrap: WrapMode, offset: number | null, align?: string | null, distCm?: number | null): string {
  const pos = offset != null ? 'from-left' : null;
  // Only the text side is written; the frame's own offset covers the other one.
  const gap = distCm ? ` fo:margin-${wrap === 'right' ? 'left' : 'right'}="${distCm}cm"` : '';
  if (wrap === 'left') return `style:wrap="right" style:horizontal-pos="${pos ?? 'left'}"${gap}`;
  if (wrap === 'right') return `style:wrap="left" style:horizontal-pos="${pos ?? 'right'}"${gap}`;
  return `style:wrap="none" style:horizontal-pos="${align ?? pos ?? 'center'}"`;
}

// The inverse of the importer's as-char alignment map (import/odt.ts): a frame with no
// entry stands on the baseline, which is what a style-less as-char frame does anyway.
const INLINE_VALIGN_ODF: Record<string, string> = {
  middle: 'style:vertical-pos="middle" style:vertical-rel="baseline"',
  below: 'style:vertical-pos="bottom" style:vertical-rel="baseline"',
  'text-top': 'style:vertical-pos="top" style:vertical-rel="text"',
  'text-middle': 'style:vertical-pos="middle" style:vertical-rel="text"',
  'text-bottom': 'style:vertical-pos="bottom" style:vertical-rel="text"',
  offset: 'style:vertical-pos="from-top" style:vertical-rel="text"',
};

// Graphic style for a floating frame (wrap + side, anchored to the paragraph top).
// Inline images need none. Injected into content.xml automatic-styles by applyImages.
function imageGraphicStyle(img: ImageExport, index: number): string {
  if (img.anchorPage) {
    return (
      `<style:style style:name="ImgFr${index + 1}" style:family="graphic">` +
      `<style:graphic-properties style:wrap="run-through" style:run-through="${img.inFront ? 'foreground' : 'background'}"` +
      ` style:horizontal-rel="page" style:horizontal-pos="from-left"` +
      ` style:vertical-rel="page" style:vertical-pos="from-top"/></style:style>`
    );
  }
  if (img.wrap === 'inline') {
    const v = INLINE_VALIGN_ODF[img.vAlign ?? ''];
    return v
      ? `<style:style style:name="ImgFr${index + 1}" style:family="graphic">` +
        `<style:graphic-properties style:wrap="none" ${v}/></style:style>`
      : '';
  }
  return (
    `<style:style style:name="ImgFr${index + 1}" style:family="graphic">` +
    `<style:graphic-properties ${imageWrapProps(img.wrap, img.wrapOffsetCm, img.wrapAlign, img.wrapDistCm)}` +
    ` style:number-wrapped-paragraphs="no-limit"` +
    ` style:horizontal-rel="paragraph-content"` +
    ` style:vertical-pos="${img.wrapOffsetYCm != null ? 'from-top' : 'top'}" style:vertical-rel="paragraph"/>` +
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
  const floats = img.anchorPage != null || img.wrap !== 'inline';
  const anchor = img.anchorPage != null
    ? ` text:anchor-type="page" text:anchor-page-number="${img.anchorPage}"`
    : ` text:anchor-type="${floats ? 'paragraph' : 'as-char'}"`;
  const named = floats || (img.vAlign != null && img.vAlign in INLINE_VALIGN_ODF);
  const styleName = named ? ` draw:style-name="ImgFr${index + 1}"` : '';
  const x = img.wrapOffsetCm != null && floats && !img.wrapAlign ? ` svg:x="${img.wrapOffsetCm}cm"` : '';
  // An as-char frame carries svg:y only for the offset alignment, which is what it means.
  const y = img.wrapOffsetYCm != null && (floats || img.vAlign === 'offset')
    ? ` svg:y="${img.wrapOffsetYCm}cm"` : '';
  return (
    `<draw:frame draw:name="Image${index + 1}"${styleName}${anchor} draw:z-index="${index}"${dims}${x}${y}${imageTransform(img)}>` +
    `${inner}</draw:frame>`
  );
}

// <draw:frame> for a header/footer image. As-character by default; a positioned frame
// (a page-anchored background) instead rides the zone paragraph at its page corner
// offset, run through behind the text. Distinct draw:name per frame.
function hfImageFrameXml(img: ImageExport, index: number): string {
  const dims =
    (img.widthCm ? ` svg:width="${img.widthCm}cm"` : '') +
    (img.heightCm ? ` svg:height="${img.heightCm}cm"` : '');
  const title = img.alt ? `<svg:title>${escapeXml(img.alt)}</svg:title>` : '';
  const anchor =
    img.wrap === 'inline'
      ? `text:anchor-type="as-char"`
      : `text:anchor-type="paragraph" draw:style-name="${HF_BG_STYLE}${index + 1}"` +
        ` svg:x="${img.wrapOffsetCm ?? 0}cm" svg:y="${img.wrapOffsetYCm ?? 0}cm"`;
  return (
    `<draw:frame draw:name="HfImage${index + 1}" ${anchor} draw:z-index="${index}"${dims}>` +
    `<draw:image xlink:href="${img.path}"/>${title}</draw:frame>`
  );
}

const HF_BG_STYLE = 'HfBg';

// The graphic style a page-anchored zone frame points at: positioned from the page's
// top-left corner and run through behind the text, as LibreOffice writes a watermark.
function hfBackgroundStyleXml(index: number): string {
  return (
    `<style:style style:name="${HF_BG_STYLE}${index + 1}" style:family="graphic">` +
    `<style:graphic-properties style:wrap="run-through" style:run-through="background"` +
    ` style:horizontal-rel="page" style:horizontal-pos="from-left"` +
    ` style:vertical-rel="page" style:vertical-pos="from-top"/></style:style>`
  );
}

// Inject automatic styles into content.xml or styles.xml, tolerating an empty/self-closed
// or absent section — a document odf-kit gave none writes `<office:automatic-styles/>`, and
// a plain string replace on the closing tag would drop the styles there.
function injectAutomaticStyles(content: string, styles: string): string {
  if (!styles) return content;
  if (content.includes('</office:automatic-styles>')) {
    return content.replace('</office:automatic-styles>', `${styles}</office:automatic-styles>`);
  }
  const section = `<office:automatic-styles>${styles}</office:automatic-styles>`;
  if (content.includes('<office:automatic-styles/>')) {
    return content.replace('<office:automatic-styles/>', section);
  }
  return content.replace(/<office:(body|master-styles)\b/, (m) => `${section}${m}`);
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

// The formula sub-document: an ODF formula document's content.xml is the MathML root
// itself. The LaTeX rides in an annotation so our own files re-import exactly; other
// readers ignore it and typeset the presentation markup.
function formulaObjectXml(f: FormulaExport): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${mathmlDocument(parseLatex(f.latex), f.display, f.latex)}`;
}

// Resolve formula sentinels: swap each MTH{i}MTH for a <draw:frame> pointing at an
// embedded formula object, write that object's content.xml, and register both it and
// its directory in META-INF/manifest.xml — the same shape as applyImages.
function applyFormulas(odtBytes: Uint8Array, formulas: FormulaExport[]): Uint8Array {
  if (!formulas.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  content = content.replace(new RegExp(`${MTH}(\\d+)${MTH}`, 'g'), (_m, idx: string) => {
    const i = Number(idx);
    const f = formulas[i];
    if (!f) return '';
    // No svg:width/height on purpose: with a size the consumer scales the object to
    // fit it (LibreOffice magnifies a too-wide frame); without one it typesets the
    // formula at its natural size, matched to the surrounding text.
    return (
      `<draw:frame draw:name="Formula${i + 1}" draw:style-name="MthFr" text:anchor-type="as-char" draw:z-index="${i}">` +
      `<draw:object xlink:href="./Formula${i + 1}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`
    );
  });
  // One shared graphic style: an as-char formula sits on the text baseline, which is
  // what LibreOffice writes for its own formula frames.
  content = injectAutomaticStyles(content,
    '<style:style style:name="MthFr" style:family="graphic">' +
    '<style:graphic-properties style:vertical-pos="middle" style:vertical-rel="text"' +
    ' fo:padding="0cm" fo:border="none"/></style:style>');
  files['content.xml'] = strToU8(content);

  for (const [i, f] of formulas.entries()) {
    files[`Formula${i + 1}/content.xml`] = strToU8(formulaObjectXml(f));
  }

  const manifestBytes = files['META-INF/manifest.xml'];
  if (manifestBytes) {
    const entries = formulas
      .map((_f, i) =>
        `<manifest:file-entry manifest:full-path="Formula${i + 1}/" manifest:media-type="application/vnd.oasis.opendocument.formula"/>` +
        `<manifest:file-entry manifest:full-path="Formula${i + 1}/content.xml" manifest:media-type="text/xml"/>`)
      .join('');
    files['META-INF/manifest.xml'] = strToU8(
      strFromU8(manifestBytes).replace('</manifest:manifest>', `${entries}</manifest:manifest>`));
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
  // An as-char frame keeps only its horizontal-pos: that is what centres a figure
  // frame, and the anchor paragraph this export mints carries no alignment.
  const wrap = box.wrap === 'inline'
    ? (box.wrapAlign ? ` style:horizontal-pos="${box.wrapAlign}" style:horizontal-rel="paragraph-content"` : '')
    : ` ${imageWrapProps(box.wrap, box.wrapOffsetCm, box.wrapAlign, box.wrapDistCm)} style:number-wrapped-paragraphs="no-limit"` +
      ` style:horizontal-rel="paragraph-content"` +
      ` style:vertical-pos="${box.wrapOffsetYCm != null ? 'from-top' : 'top'}" style:vertical-rel="paragraph"`;
  // auto-grow only for plain text boxes; a custom-shape needs both explicitly
  // false, or LibreOffice's shape autofit shrinks it to its text.
  const grow = box.shapeKind === 'textbox'
    ? ' draw:auto-grow-height="true"'
    : ' draw:auto-grow-height="false" draw:auto-grow-width="false"';
  return (
    `<style:style style:name="TbxFr${index + 1}" style:family="graphic">` +
    `<style:graphic-properties ${fill} ${stroke} fo:padding="${box.paddingCm}cm"` +
    `${grow} draw:textarea-vertical-align="top"${wrap}/>` +
    `</style:style>`
  );
}

// The anchor paragraph carries the spacing the box stands in for (import/odt.ts hands a
// lifted box its anchor's margins); nothing to mint when it has none.
function textBoxAnchorStyle(box: TextBoxExport, index: number): string {
  if (!box.spaceBeforePt && !box.spaceAfterPt) return '';
  return (
    `<style:style style:name="TbxP${index + 1}" style:family="paragraph" style:parent-style-name="Standard">` +
    `<style:paragraph-properties fo:margin-top="${box.spaceBeforePt}pt" fo:margin-bottom="${box.spaceAfterPt}pt"/>` +
    `</style:style>`
  );
}

// The drawing element wrapping a box's serialized blocks: a <draw:frame>/<draw:text-box>
// for plain text boxes (height = fo:min-height, so it grows with content like the
// editor), or a <draw:custom-shape> with the preset geometry of `utils/shapes.ts`.
function textBoxXml(box: TextBoxExport, inner: string, index: number): string {
  const n = index + 1;
  const anchor = box.wrap === 'inline' ? 'as-char' : 'paragraph';
  const transform = frameTransform(box.rotationDeg, box.widthCm, box.heightCm);
  const at = box.wrap === 'inline' ? ''
    : (box.wrapOffsetCm != null ? ` svg:x="${box.wrapOffsetCm}cm"` : '') +
      (box.wrapOffsetYCm != null ? ` svg:y="${box.wrapOffsetYCm}cm"` : '');
  const common =
    ` draw:style-name="TbxFr${n}" text:anchor-type="${anchor}" draw:z-index="${index}"` +
    ` svg:width="${box.widthCm}cm"${at}`;
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
    `${inner}${odfEnhancedGeometry(box.shapeKind) ?? ''}</draw:custom-shape>`
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
      const style = box.spaceBeforePt || box.spaceAfterPt ? `TbxP${i + 1}` : 'Standard';
      return `<text:p text:style-name="${style}">${textBoxXml(box, inner, i)}</text:p>`;
    },
  );
  content = injectAutomaticStyles(
    content,
    boxes.map((b, i) => textBoxGraphicStyle(b, i) + textBoxAnchorStyle(b, i)).join(''),
  );
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
// The note styles LibreOffice ships, written verbatim so a re-save changes nothing:
// Footnote/Endnote at 10pt with a 0.6cm hanging indent, and the two character styles
// its notes-configuration points at (the anchor raised, the symbol plain).
function notesStyles(): string {
  const para = (name: string) =>
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">`
    + `<style:paragraph-properties fo:margin-left="${NOTE_INDENT_CM}cm" fo:text-indent="-${NOTE_INDENT_CM}cm" style:auto-text-indent="false"/>`
    + `<style:text-properties fo:font-size="${NOTE_FONT_SIZE_PT}pt" style:font-size-asian="${NOTE_FONT_SIZE_PT}pt" style:font-size-complex="${NOTE_FONT_SIZE_PT}pt"/>`
    + '</style:style>';
  const anchor = (name: string, display: string) =>
    `<style:style style:name="${name}" style:display-name="${display}" style:family="text">`
    + '<style:text-properties style:text-position="super 58%"/></style:style>';
  return para('Footnote') + para('Endnote')
    + `<style:style style:name="Footnote_20_Symbol" style:display-name="Footnote Symbol" style:family="text"/>`
    + `<style:style style:name="Endnote_20_Symbol" style:display-name="Endnote Symbol" style:family="text"/>`
    + anchor('Footnote_20_anchor', 'Footnote anchor')
    + anchor('Endnote_20_anchor', 'Endnote anchor');
}

// <text:notes-configuration> per class. ODF counts start-value from 0, so the first
// note of a class carries startAt - 1.
function notesConfiguration(settings: NoteSettings): string {
  const one = (kind: NoteKind) => {
    const s = settings[kind];
    const foot = kind === 'footnote';
    const prefix = s.prefix ? ` style:num-prefix="${escapeXml(s.prefix)}"` : '';
    const suffix = s.suffix ? ` style:num-suffix="${escapeXml(s.suffix)}"` : '';
    return `<text:notes-configuration text:note-class="${kind}"`
      + ` text:citation-style-name="${odfStyleName(s.citationStyle)}"`
      + ` text:citation-body-style-name="${foot ? 'Footnote_20_anchor' : 'Endnote_20_anchor'}"`
      + ` text:default-style-name="${odfStyleName(s.bodyStyle)}"`
      + ` style:num-format="${s.numFormat}"${prefix}${suffix}`
      + ` text:start-value="${Math.max(0, s.startAt - 1)}"`
      + (foot ? ` text:footnotes-position="${s.position}" text:start-numbering-at="${s.restart}"` : '')
      + '/>';
  };
  return one('footnote') + one('endnote');
}

// <style:footnote-sep> lives inside the page layout's own properties, not the styles.
function footnoteSepXml(sep: NoteSettings['separator']): string {
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  return `<style:footnote-sep style:width="${round3((sep.weightPt / 72) * 2.54)}cm"`
    + ` style:distance-before-sep="${round3(sep.spaceAboveCm)}cm"`
    + ` style:distance-after-sep="${round3(sep.spaceBelowCm)}cm"`
    + ` style:line-style="solid" style:adjustment="${sep.align}"`
    + ` style:rel-width="${round3(sep.relWidthPercent)}%" style:color="${sep.color}"/>`;
}

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

// The index title style (bold, 16pt) — mirrors the .toc-title on screen.
function contentsHeadingStyle(name: string): string {
  return (
    `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="Standard">` +
    `<style:paragraph-properties fo:margin-top="0cm" fo:margin-bottom="0.3cm"/>` +
    `<style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>`
  );
}

// A level's entry style: the file's own named one where the index came with it, else the
// automatic Contents_20_N this export mints.
function tocLevelStyle(toc: TocExport, level: number): string {
  const own = toc.levelStyles?.[level - 1];
  return own ? odfStyleName(own) : `${ODF_INDEX[toc.kind].entryStyle}${level}`;
}

// ODF has one element family per index. A caption index is single-level and finds its
// entries by the counter's name, so its template carries no text:outline-level.
const ODF_INDEX: Record<IndexKind, { el: string; heading: string; entryStyle: string; docName: string; seq?: string }> = {
  toc: { el: 'table-of-content', heading: 'Contents_20_Heading', entryStyle: 'Contents_20_', docName: 'Table of Contents' },
  figures: { el: 'illustration-index', heading: 'Illustration_20_Index_20_Heading', entryStyle: 'Illustration_20_Index_20_', docName: 'Illustration Index', seq: 'Illustration' },
  tables: { el: 'table-index', heading: 'Table_20_Index_20_Heading', entryStyle: 'Table_20_Index_20_', docName: 'Table Index', seq: 'Table' },
  alphabetical: { el: 'alphabetical-index', heading: 'Index_20_Heading', entryStyle: 'Index_20_', docName: 'Alphabetical Index' },
};

function tocXml(toc: TocExport, index: number): string {
  const spec = ODF_INDEX[toc.kind];
  const title = toc.title ?? INDEX_TITLES[toc.kind];
  const name = `${spec.docName}${index + 1}`;
  const stop =
    `<text:index-entry-tab-stop style:type="right"` +
    `${toc.tabPosCm ? ` style:position="${toc.tabPosCm}cm"` : ''}` +
    `${toc.leader ? ` style:leader-char="${escapeXml(toc.leader)}"` : ''}/>`;
  const entry = (levelAttr: string, style: string) =>
    `<text:${spec.el}-entry-template${levelAttr} text:style-name="${style}">` +
    `<text:index-entry-link-start/><text:index-entry-text/>${stop}` +
    `<text:index-entry-page-number/><text:index-entry-link-end/>` +
    `</text:${spec.el}-entry-template>`;
  // An alphabetical index is fed by its marks, is single-level, and merges the pages of
  // a term the reader marked more than once — LibreOffice's text:combine-entries.
  const sourceAttrs = toc.kind === 'alphabetical'
    ? ' text:combine-entries="true" text:ignore-case="true"'
    : spec.seq
      ? ` text:use-caption="true" text:caption-sequence-name="${spec.seq}" text:caption-sequence-format="category-and-value"`
      : ` text:outline-level="${toc.maxLevel}" text:use-index-marks="false" text:use-index-source-styles="false"`;
  const templates = spec.seq
    ? entry('', tocLevelStyle(toc, 1))
    : toc.kind === 'alphabetical'
      ? entry(' text:outline-level="1"', tocLevelStyle(toc, 1))
      : HEADING_LEVELS.filter(l => l <= toc.maxLevel)
          .map(l => entry(` text:outline-level="${l}"`, tocLevelStyle(toc, l)))
          .join('');
  const source =
    `<text:${spec.el}-source${sourceAttrs}>` +
    (title ? `<text:index-title-template text:style-name="${spec.heading}">${escapeXml(title)}</text:index-title-template>` : '') +
    templates +
    `</text:${spec.el}-source>`;
  const body =
    `<text:index-body>` +
    (title
      ? `<text:index-title text:name="${escapeXml(name)}_Head">` +
        `<text:p text:style-name="${spec.heading}">${escapeXml(title)}</text:p>` +
        `</text:index-title>`
      : '') +
    toc.entries
      .map(e => `<text:p text:style-name="${tocLevelStyle(toc, e.level)}">${escapeXml(e.text).replace(/\n/g, '<text:line-break/>')}<text:tab/>${e.pages?.join(', ') ?? e.page}</text:p>`)
      .join('') +
    `</text:index-body>`;
  return `<text:${spec.el} text:name="${escapeXml(name)}" text:protected="true">${source}${body}</text:${spec.el}>`;
}

// BMS/BME/XRF sentinels → <text:bookmark-start/>, <text:bookmark-end/> and
// <text:bookmark-ref>. All three are legal anywhere in paragraph content, so a plain
// replace works wherever odf-kit put the run — inside a <text:span> included.
function applyBookmarks(odtBytes: Uint8Array, refs: CrossRefExport[]): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(BMS) && !content.includes(XRF)) return odtBytes;

  content = content
    .replace(new RegExp(`${BMS}([^${BMS}]*)${BMS}`, 'g'), (_m, name: string) => `<text:bookmark-start text:name="${name}"/>`)
    .replace(new RegExp(`${BME}([^${BME}]*)${BME}`, 'g'), (_m, name: string) => `<text:bookmark-end text:name="${name}"/>`)
    .replace(new RegExp(`${XRF}(\\d+)${XRF}([^${XRF}]*)${XRF}`, 'g'), (_m, idx: string, shown: string) => {
      const ref = refs[Number(idx)];
      if (!ref) return shown;
      return `<text:bookmark-ref text:reference-format="${ref.format}" text:ref-name="${ref.name}">${shown}</text:bookmark-ref>`;
    });

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// CMS/CME sentinels → <office:annotation> (author, date and body) and
// <office:annotation-end/>. content.xml declares neither dc: nor loext:, so the two
// namespaces are added on the root when a document actually has comments.
function applyComments(odtBytes: Uint8Array, list: CommentExport[]): Uint8Array {
  if (!list.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(CMS)) return odtBytes;

  content = content
    .replace(new RegExp(`${CMS}(\\d+)${CMS}`, 'g'), (_m, idx: string) => {
      const c = list[Number(idx)];
      if (!c) return '';
      // LibreOffice reads its own resolved flag off loext: and writes it either way;
      // its comment bodies carry the pool's Comment paragraph style.
      const body = c.text.split('\n').map(line => `<text:p text:style-name="Comment">${escapeXml(line)}</text:p>`).join('');
      return `<office:annotation office:name="${escapeXml(c.name)}" loext:resolved="${c.resolved}">`
        + (c.author ? `<dc:creator>${escapeXml(c.author)}</dc:creator>` : '')
        + (c.date ? `<dc:date>${escapeXml(c.date)}</dc:date>` : '')
        + (body || '<text:p text:style-name="Comment"/>')
        + '</office:annotation>';
    })
    .replace(new RegExp(`${CME}(\\d+)${CME}`, 'g'), (_m, idx: string) => {
      const c = list[Number(idx)];
      return c ? `<office:annotation-end office:name="${escapeXml(c.name)}"/>` : '';
    })
    .replace(
      '<office:document-content ',
      '<office:document-content xmlns:dc="http://purl.org/dc/elements/1.1/"'
      + ' xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" ',
    );

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

// Cut each hoisted note paragraph out of content.xml and splice its runs into a
// <text:note> at the anchor sentinel. Runs last of the content.xml passes, so the note
// text carries everything the earlier ones resolved inside it.
function applyNotes(odtBytes: Uint8Array, notes: NoteExport[]): Uint8Array {
  if (!notes.length) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;

  let content = strFromU8(contentBytes);
  if (!content.includes(FNT)) return odtBytes;

  // The note's runs, taken out of the paragraph the hoist gave it. A wrapper span may
  // hold the sentinel, so it is cut by string and the empty remains are swept after.
  const bodies: string[] = notes.map((_note, i) => {
    const open = `${FNT}B${i}${FNT}`;
    const at = content.indexOf(open);
    if (at < 0) return '';
    const start = content.lastIndexOf('<text:p', at);
    const end = content.indexOf('</text:p>', at);
    if (start < 0 || end < 0) return '';
    const block = content.slice(start, end + '</text:p>'.length);
    content = content.slice(0, start) + content.slice(end + '</text:p>'.length);
    return block
      .replace(/^<text:p\b[^>]*>/, '')
      .replace(/<\/text:p>$/, '')
      .replace(open, '')
      .replace(/<text:span\b[^>]*\/>|<text:span\b[^>]*><\/text:span>/g, '');
  });

  content = content.replace(new RegExp(`${FNT}A(\\d+)${FNT}`, 'g'), (_m, idx: string) => {
    const i = Number(idx);
    const note = notes[i];
    if (!note) return '';
    const endnote = note.kind === 'endnote';
    const label = note.label ? ` text:label="${escapeXml(note.label)}"` : '';
    return `<text:note text:id="${endnote ? 'edn' : 'ftn'}${i + 1}" text:note-class="${note.kind}">`
      + `<text:note-citation${label}>${escapeXml(note.citation)}</text:note-citation>`
      + `<text:note-body><text:p text:style-name="${odfStyleName(note.styleName ?? (endnote ? 'Endnote' : 'Footnote'))}">${bodies[i]}</text:p></text:note-body>`
      + '</text:note>';
  });
  // Defensive: strip any sentinel the passes above left behind.
  content = content.split(FNT).join('');

  files['content.xml'] = strToU8(content);
  return rezipOdt(files);
}

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
  // One set of entry styles per index family actually present; a caption index has the
  // single level its ODF template declares.
  const styles = [...new Set(tocs.map(t => t.kind))]
    .map((kind) => {
      const spec = ODF_INDEX[kind];
      const levels = kind === 'toc' ? HEADING_LEVELS : [1];
      return contentsHeadingStyle(spec.heading)
        + levels.map(l => contentsEntryStyle(`${spec.entryStyle}${l}`, l, tabPosCm)).join('');
    })
    .join('');
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
  // One set per section, in body order; [0] repeats the fields above. Absent = the
  // document has a single section.
  sections?: HfSet[];
  pageCount: number;
  headerDistanceCm?: number;
  footerDistanceCm?: number;
};

// The full document → .odt pipeline, DOM-free; returns the .odt bytes.
export async function buildOdt(docJson: TiptapNode, margins: PageMargins = DEFAULT_MARGINS, orientation: Orientation = 'portrait', hf?: HfExport, language?: { language: string; country: string } | null, pageFormat: PageFormat = 'A4', styles: StyleSheet = builtinStyleSheet(), tabIntervalCm: number = DEFAULT_TAB_INTERVAL_CM, spacingModel: SpacingModel = 'add', rtl = false, notesSettings: NoteSettings = DEFAULT_NOTE_SETTINGS, props: DocProperties = EMPTY_DOC_PROPERTIES, hyphenate = false, pageNumbering: PageNumbering = DEFAULT_PAGE_NUMBERING, decor: PageDecor = EMPTY_PAGE_DECOR, lineNumbering: LineNumbering = DEFAULT_LINE_NUMBERING): Promise<Uint8Array> {
  // Images become IMG sentinels before serialization; applyImages resolves them and writes
  // the Pictures/ + manifest entries. Text boxes and columns hoist after replacePageBreaks
  // (so PGB misses their blocks) and before the inline passes (which then cover them).
  exportSheet = styles;
  exportSpacingModel = spacingModel;
  const images: ImageExport[] = [];
  const tocs: TocExport[] = [];
  const textBoxes: TextBoxExport[] = [];
  const columns: ColumnsExport[] = [];
  const dateFields: DateTimeFieldExport[] = [];
  const formulas: FormulaExport[] = [];
  const crossRefs: CrossRefExport[] = [];
  const notes: NoteExport[] = [];
  const commentList: CommentExport[] = [];
  const seqFields: SequenceExport[] = [];
  const revisionList = new Map<string, RevisionExport>();
  const indexMarks: IndexEntryExport[] = [];
  const sentinels = replaceIndexEntries(replaceRevisions(replaceSequenceFields(replaceComments(replaceBookmarks(replaceFormulas(replaceDateTimeFields(replaceImages(replaceTabs(replaceHardBreaks(replaceSectionBreaks(replaceNotes(replaceColumns(replaceTextBoxes(replacePageBreaks(replaceTableOfContents(docJson, tocs)), textBoxes), columns), notes)))), images), dateFields), formulas), crossRefs), commentList), seqFields), revisionList), indexMarks);
  const raw = markTextEffects(bakeListCharStyles(sentinels, styles));
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
  headerPara = headerPara && markTextEffects(headerPara);
  footerPara = footerPara && markTextEffects(footerPara);
  headerPara = replaceHfImages(headerPara, hfImages);
  footerPara = replaceHfImages(footerPara, hfImages);
  firstHeaderPara = replaceHfImages(firstHeaderPara, hfImages);
  firstFooterPara = replaceHfImages(firstFooterPara, hfImages);
  evenHeaderPara = replaceHfImages(evenHeaderPara, hfImages);
  evenFooterPara = replaceHfImages(evenFooterPara, hfImages);
  // With the flag on, page 1 is independent: whenever a side has a zone on either
  // variant, emit both — an empty one blanks its side, as the editor shows it.
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
  // One entry per table, same order — consumed by applyTableProps.
  const tableMargins: (TableProps | null)[] = [];
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
          // odf-kit writes style:type verbatim but types it without ODF's 'char'; a
          // LEAD suffix rides along so the leader reaches applyTabLeaders.
          type: ((s.align === 'decimal' ? 'char' : s.align)
            + (normalizeLeader(s.leader) ? `${LEAD}${s.leader}` : '')) as 'left' | 'center' | 'right',
        }));
      }
      const content = node.content ?? [];
      // The paragraph-mark font size rides as an FSZ sentinel that
      // applyEmptyLineFontSizes turns into a paragraph-style fo:font-size — it is the
      // block's line-height floor, so it matters on a filled block as much as an empty one.
      const fszPayload = markFontPayload(node.attrs);
      const fsz = fszPayload ? `${FSZ}${fszPayload}${FSZ}` : '';
      // Paragraph background/borders ride as a leading PBX sentinel (odf-kit has no such
      // options); applyParagraphBoxes mints the style. FSZ stays first so its own pass,
      // which runs earlier, still matches it right after the opening tag.
      const spec = paraBoxSpec(node.attrs);
      const pbx = spec ? `${PBX}${spec}${PBX}` : '';
      // Named style, unless it is the one odf-kit puts on this node type anyway.
      const styleName = styleOf(node);
      const sty = styleName !== odfDefaultStyleOf(node) ? `${STY}${styleName}${STY}` : '';
      const marks = fsz + sty + pbx;
      const withPbx = (p: ParagraphBuilder) => { if (marks) p.addText(marks); applyRuns(p, content); };

      if (node.type === CUST_P) {
        if (content.length === 0) doc.addParagraph(marks, opts);
        else doc.addParagraph(withPbx, opts);
      } else if (node.type === CUST_H) {
        const level = (node.attrs?.level as number) ?? 1;
        if (content.length === 0) doc.addHeading(marks, level, opts);
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
  const listLevels: ListLevelProps[][] = [];
  collectListLevelProps(raw, listLevels);
  let indentedLists = applyListLevelProps(styledLists, listLevels);

  // Marker formatting → a minted character style on each L# level definition.
  const markerFormats: (MarkerFormat | null)[][] = [];
  collectListMarkerFormats(raw, markerFormats);
  indentedLists = applyListMarkerFormats(indentedLists, markerFormats);

  // Rebuild real headings/lists/paragraphs inside table cells. Must run after
  // applyListItemStyles (cell lists don't exist yet) and before collapseRunWhitespace.
  const styledCells = applyCellBlocks(indentedLists, cellBlocks);

  const rowHeights: (string | null)[] = [];
  collectTableRowHeights(raw, rowHeights);
  const styledRows = applyTableRowHeights(expandCellPadding(styledCells), rowHeights);
  const withTableMargins = applyTableStyleNames(
    applyTableHeaderRows(applyTableProps(styledRows, tableMargins, contentWidthCm), tableMargins), tableStyleNames);

  const cleaned = collapseRunWhitespace(withTableMargins);
  // Before applyInlineSentinels: it matches the bare style:type="char" a leader would hide.
  const withBreaks = applyInlineSentinels(applyTabLeaders(cleaned));
  const withImages = applyImages(withBreaks, images);
  const withDateFields = applyDateTimeFields(withImages, dateFields, language ?? null);
  const withSequences = applyIndexEntries(applyRevisions(applySequenceFields(withDateFields, seqFields), revisionList), indexMarks);
  const withFormulas = applyFormulas(withSequences, formulas);
  const withTextBoxes = applyTextBoxes(withFormulas, textBoxes);
  const withColumns = applyColumns(withTextBoxes, columns);
  const withBookmarks = applyComments(applyBookmarks(withColumns, crossRefs), commentList);
  // After every other content.xml pass: the note's own runs are hoisted into the body,
  // so they must be fully resolved before they are cut out and moved into <text:note>.
  const withNotes = applyNotes(withBookmarks, notes);
  const withToc = applyToc(withNotes, tocs, contentWidthCm);
  const withPageBreaks = applyPageBreaks(withToc);
  const withEmptyFontSizes = applyEmptyLineFontSizes(withPageBreaks);
  const withParaBoxes = applyParagraphBoxes(withEmptyFontSizes);
  // Effects first: applyCharacterStyles then clones the style that already carries them.
  const withNamedStyles = applyCharacterStyles(applyTextEffects(applyParagraphStyles(withParaBoxes)));
  const usedTables = new Set(tableStyleNames.filter((t): t is TableStyleRef => !!t).map(t => t.name));
  const withStyles = rewriteStylesXml(withNamedStyles, language ?? null, pageFormat, orientation, styles, usedStyleNames(docJson, styles), usedTables, tabIntervalCm, margins.mirrored === true, rtl, notesSettings, hyphenate, pageNumbering, decor, lineNumbering);
  const withHf = applyHfPostProcess(withStyles, margins, headerPara, footerPara, headerDist, footerDist, firstHeaderPara, firstFooterPara, hf?.pageCount ?? 1, hfImages, evenHeaderPara, evenFooterPara);
  const withWatermark = applyWatermarkOdf(withHf, decor.watermark);
  // Sections past the first get their own master page, which is where ODF keeps a
  // section's header/footer; the SEC-marked block points at it.
  const withSections = applySectionMasterPages(withWatermark, hf?.sections ?? [], hf?.pageCount ?? 1, margins);
  return applyDocProperties(applyPageNumberStart(applySpacingModel(withSections, spacingModel), pageNumbering.start), props);
}

// The document's first page number. ODF has no document-level start: LibreOffice puts
// `style:page-number` on the first paragraph's own style (probed), beside the master page
// it names.
function applyPageNumberStart(odtBytes: Uint8Array, start: number): Uint8Array {
  if (start <= 1) return odtBytes;
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  if (!contentBytes) return odtBytes;
  const content = strFromU8(contentBytes);
  const body = /<office:text\b[^>]*>/.exec(content);
  if (!body) return odtBytes;
  const first = /<text:(p|h)\b([^>]*)>/.exec(content.slice(body.index + body[0].length));
  if (!first) return odtBytes;
  const at = body.index + body[0].length + first.index;
  const srcM = /text:style-name="([^"]*)"/.exec(first[2]);
  const source = srcM ? srcM[1] : 'Standard';
  const name = 'PgNumStart';
  const def = findAutoStyle(content, source);
  const minted = def
    ? cloneStyleWithParaProps(def, name, `style:page-number="${start}"`)
    : `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${source}"><style:paragraph-properties style:page-number="${start}"/></style:style>`;
  const tag = srcM
    ? first[0].replace(/text:style-name="[^"]*"/, `text:style-name="${name}"`)
    : `<text:${first[1]} text:style-name="${name}"${first[2]}>`;
  files['content.xml'] = strToU8(
    injectAutomaticStyles(content.slice(0, at) + tag + content.slice(at + first[0].length), minted),
  );
  return rezipOdt(files);
}

// The descriptive metadata → meta.xml, which odf-kit already writes (generator +
// creation date). LibreOffice's File ▸ Properties and Word's File ▸ Info read it.
function applyDocProperties(odtBytes: Uint8Array, props: DocProperties): Uint8Array {
  const files = unzipSync(odtBytes);
  const metaBytes = files['meta.xml'];
  if (!metaBytes) return odtBytes;
  const el = (tag: string, value: string) => (value.trim() ? `<${tag}>${escapeXml(value.trim())}</${tag}>` : '');
  const author = props.author.trim();
  const fields = el('dc:title', props.title) + el('dc:subject', props.subject)
    + el('dc:description', props.description)
    + keywordList(props.keywords).map(k => `<meta:keyword>${escapeXml(k)}</meta:keyword>`).join('')
    + (author ? el('meta:initial-creator', author) + el('dc:creator', author) : '')
    + `<dc:date>${new Date().toISOString()}</dc:date>`;
  files['meta.xml'] = strToU8(strFromU8(metaBytes)
    .replace('<meta:generator>odf-kit</meta:generator>', `<meta:generator>${GENERATOR}</meta:generator>`)
    .replace('</office:meta>', `${fields}</office:meta>`));
  return rezipOdt(files);
}

// A document that takes the larger of two adjoining spacings needs LibreOffice's
// AddParaTableSpacing=false — its own default adds them, so without this the space
// between every pair of blocks would grow when the file is reopened.
function applySpacingModel(odtBytes: Uint8Array, model: SpacingModel): Uint8Array {
  if (model !== 'max') return odtBytes;
  const files = unzipSync(odtBytes);
  const item =
    '<config:config-item-set config:name="ooo:configuration-settings">' +
    '<config:config-item config:name="AddParaTableSpacing" config:type="boolean">false</config:config-item>' +
    '</config:config-item-set>';
  const existing = files['settings.xml'];
  if (existing) {
    files['settings.xml'] = strToU8(strFromU8(existing).replace('</office:settings>', `${item}</office:settings>`));
    return rezipOdt(files);
  }
  files['settings.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
    ' xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.3">' +
    `<office:settings>${item}</office:settings></office:document-settings>`,
  );
  const manifestBytes = files['META-INF/manifest.xml'];
  if (manifestBytes) {
    const entry = '<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/>';
    const manifest = strFromU8(manifestBytes);
    if (!manifest.includes('"settings.xml"')) {
      files['META-INF/manifest.xml'] = strToU8(manifest.replace('</manifest:manifest>', `${entry}</manifest:manifest>`));
    }
  }
  return rezipOdt(files);
}

function hfAlign(para: TiptapNode): AlignValue | null {
  const ta = para.attrs?.textAlign;
  return ta === 'center' || ta === 'right' || ta === 'justify' ? ta : null;
}

// <style:tab-stops> for a zone paragraph: odf-kit builds the body's, but a header/footer
// style is written by hand here.
function tabStopsXml(attrs: TiptapNode['attrs']): string {
  const stops = parseTabStops(attrs?.tabStops);
  if (!stops.length) return '';
  const inner = stops.map((st) => {
    const leader = normalizeLeader(st.leader);
    return `<style:tab-stop style:position="${st.pos}cm" style:type="${st.align === 'decimal' ? 'char' : st.align}"`
      + (st.align === 'decimal' ? ' style:char="."' : '')
      + (leader ? ` style:leader-style="${ODF_LEADER_STYLE[leader]}" style:leader-text="${leader}"` : '')
      + '/>';
  }).join('');
  return `<style:tab-stops>${inner}</style:tab-stops>`;
}

// The whole <style:paragraph-properties> of a zone paragraph, or '' when it needs none:
// alignment plus the paragraph background ("colored field") and per-side borders.
function hfParaPropsXml(para: TiptapNode): string {
  const props: string[] = [];
  const align = hfAlign(para);
  if (align) props.push(`fo:text-align="${align}"`);
  const s = paraStyleFromAttrs(para.attrs);
  if (s.background) props.push(`fo:background-color="${s.background}"`);
  // The zone's own margins, which grow the band on the way back in (import/CLAUDE.md).
  for (const [attr, side] of [['spaceBefore', 'top'], ['spaceAfter', 'bottom']] as const) {
    const v = para.attrs?.[attr];
    if (typeof v === 'number' && v) props.push(`fo:margin-${side}="${v}pt"`);
  }
  for (const [attr, side] of [
    ['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left'],
  ] as const) {
    if (s[attr]) props.push(`fo:border-${side}="${s[attr]}"`);
  }
  const tabs = tabStopsXml(para.attrs);
  if (!props.length && !tabs) return '';
  const open = `<style:paragraph-properties${props.length ? ` ${props.join(' ')}` : ''}`;
  return tabs ? `${open}>${tabs}</style:paragraph-properties>` : `${open}/>`;
}

// Header/footer post-processing on styles.xml: resolve LBR/PGC sentinels, apply the
// paragraph alignment to the Header/Footer styles, and rewrite the geometry to the
// ODF's own mapping (page margin = HF distance, min-height fills up to the body margin).
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
  styles = styles.replace(new RegExp(`${CHP}(\\d)${CHP}([\\s\\S]*?)${CHP}`, 'g'),
    (_m, level: string, name: string) => `<text:chapter text:display="name" text:outline-level="${level}">${name}</text:chapter>`);

  const mintedStyles: string[] = [];
  const mint = (n: string) => { mintedStyles.push(n); };
  styles = resolveTextEffects(styles, mint, 'HFTE');

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
    const props = hfParaPropsXml(para);
    if (props) {
      const styleName = kind === 'header' ? 'Header' : 'Footer';
      styles = styles.replace(
        new RegExp(`(<style:style style:name="${styleName}"[^>]*?)/>`),
        `$1>${props}</style:style>`,
      );
    }
  };
  if (headerPara) zone('header', headerPara, margins.top, headerDist);
  if (footerPara) zone('footer', footerPara, margins.bottom, footerDist);

  // Different first page / odd-even: inject <style:{header,footer}-{first,left}> content
  // into the master page (ODF 1.3; LibreOffice reads them). The page-layout header/footer
  // geometry above is shared across variants, so only the content differs here.
  if (firstHeaderPara || firstFooterPara || evenHeaderPara || evenFooterPara) {
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
  }
  if (mintedStyles.length) {
    const defs = mintedStyles.join('');
    styles = injectAutomaticStyles(styles, defs);
  }

  // Resolve HFIMG sentinels (default + first-page zones) to as-char <draw:frame>s, then
  // add the picture binaries and their manifest entries (mirrors the body applyImages).
  if (hfImages.length) {
    styles = ensureDrawNamespaces(styles);
    styles = styles.replace(new RegExp(`${HFIMG}(\\d+)${HFIMG}`, 'g'), (_m, idx: string) => {
      const img = hfImages[Number(idx)];
      return img ? hfImageFrameXml(img, Number(idx)) : '';
    });
    const bgStyles = hfImages.map((img, i) => (img.wrap === 'inline' ? '' : hfBackgroundStyleXml(i))).join('');
    if (bgStyles) {
      styles = injectAutomaticStyles(styles, bgStyles);
    }
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

// A variant zone paragraph → <style:{header,footer}-{first,left}> XML (suffix null = the
// section's own zone). Runs and page fields become <text:span>s referencing minted
// automatic text styles (pushed via `mint`); hardBreak → line-break.
function hfVariantZoneXml(kind: 'header' | 'footer', suffix: 'first' | 'left' | null, para: TiptapNode, pageCount: number, mint: (styleXml: string) => void, prefix = ''): string {
  let styleSeq = 0;
  // Distinct minted-style prefix per variant so first + even styles never collide.
  const pfx = `${prefix}HF${suffix === 'first' ? 'F' : suffix === 'left' ? 'L' : 'D'}${kind[0].toUpperCase()}`;
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
    else if (node.type === 'chapterField') inner += styled(
      `<text:chapter text:display="name" text:outline-level="${Number(node.attrs?.level) || 1}">${odfEncodeInline(String(node.attrs?.text ?? ''))}</text:chapter>`, node.marks);
  }

  const parent = kind === 'header' ? 'Header' : 'Footer';
  const props = hfParaPropsXml(para);
  let paraStyle = parent;
  if (props) {
    paraStyle = `${pfx}P`;
    mint(`<style:style style:name="${paraStyle}" style:family="paragraph" style:parent-style-name="${parent}">${props}</style:style>`);
  }
  const tag = suffix ? `${kind}-${suffix}` : kind;
  return `<style:${tag}><text:p text:style-name="${paraStyle}">${inner}</text:p></style:${tag}>`;
}

// A section's own master page: the Standard one cloned under its own name, carrying that
// section's zones. ODF has no per-section header/footer other than this.
function masterPageXml(name: string, layoutName: string, set: HfSet, pageCount: number, mint: (styleXml: string) => void, pfx: string): string {
  const zone = (kind: 'header' | 'footer', suffix: 'first' | 'left' | null, doc: HfDoc): string => {
    if (hfIsEmpty(doc)) return '';
    return hfVariantZoneXml(kind, suffix, doc!.content![0] as TiptapNode, pageCount, mint, pfx);
  };
  // An empty default beside a variant blanks its side, as the editor renders it.
  const need = (a: HfDoc, b: HfDoc) => (hfIsEmpty(a) && !hfIsEmpty(b) ? { type: 'doc', content: [{ type: 'paragraph', content: [] }] } as HfDoc : a);
  const hFirst = set.differentFirstPage ? set.headerFirst : null;
  const fFirst = set.differentFirstPage ? set.footerFirst : null;
  const hEven = set.differentOddEven ? set.headerEven : null;
  const fEven = set.differentOddEven ? set.footerEven : null;
  const body = zone('header', null, need(need(set.header, hFirst), hEven))
    + zone('header', 'first', hFirst) + zone('header', 'left', hEven)
    + zone('footer', null, need(need(set.footer, fFirst), fEven))
    + zone('footer', 'first', fFirst) + zone('footer', 'left', fEven);
  return `<style:master-page style:name="${name}" style:page-layout-name="${layoutName}">${body}</style:master-page>`;
}

// Point each SEC-marked block at its section's master page (ODF's only per-section
// header/footer), minting the master pages beside the Standard one odf-kit wrote.
function applySectionMasterPages(odtBytes: Uint8Array, sets: HfSet[], pageCount: number, margins: PageMargins): Uint8Array {
  const files = unzipSync(odtBytes);
  const contentBytes = files['content.xml'];
  const stylesBytes = files['styles.xml'];
  if (!contentBytes || !stylesBytes) return odtBytes;
  let content = strFromU8(contentBytes);
  if (!content.includes(SEC)) return odtBytes;
  let styles = strFromU8(stylesBytes);

  const minted: string[] = [];
  const used = new Set<number>();
  let counter = 0;
  content = content.replace(
    new RegExp(`<text:(p|h)\\b([^>]*)>${SEC}(\\d+)${SEC}`, 'g'),
    (_m, tag: string, attrs: string, idx: string) => {
      const index = Number(idx);
      used.add(index);
      const sm = /text:style-name="([^"]*)"/.exec(attrs);
      const source = sm?.[1] ?? '';
      const def = source ? findAutoStyle(content, source) : null;
      const name = `MP${++counter}`;
      const master = ` style:master-page-name="Section${index + 1}"`;
      minted.push(def
        ? def.replace(/style:name="[^"]*"/, `style:name="${name}"`).replace(/(<style:style\b[^>]*?)(\/?>)/, `$1${master}$2`)
        : `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${source || 'Standard'}"${master}/>`);
      const rest = attrs.replace(/\s*text:style-name="[^"]*"/, '');
      return `<text:${tag}${rest} text:style-name="${name}">`;
    },
  );
  if (minted.length) {
    content = injectAutomaticStyles(content, minted.join(''));
  }

  // The page layout odf-kit gave the Standard master page: reused as is by a section
  // whose margins are the document's, cloned with them shifted by a section that has
  // its own — a shift, so whatever the header/footer pass folded into it survives.
  const layout = /<style:master-page\b[^>]*style:page-layout-name="([^"]*)"/.exec(styles)?.[1] ?? 'pm1';
  const layoutXml = new RegExp(`<style:page-layout\\b[^>]*style:name="${layout}"[\\s\\S]*?</style:page-layout>`).exec(styles)?.[0] ?? null;
  const layouts: string[] = [];
  const layoutFor = (index: number, set: HfSet): string => {
    const m = set.margins;
    if (!m || !layoutXml) return layout;
    const name = `${layout}Sec${index + 1}`;
    layouts.push(layoutXml
      .replace(`style:name="${layout}"`, `style:name="${name}"`)
      .replace(/<style:page-layout-properties\b[^>]*>/, (props) =>
        (['top', 'bottom', 'left', 'right'] as const).reduce((p, side) =>
          p.replace(new RegExp(`fo:margin-${side}="([\\d.]+)cm"`), (_x, cm: string) =>
            `fo:margin-${side}="${Math.max(0, Math.round((parseFloat(cm) + m[side] - margins[side]) * 1000) / 1000)}cm"`), props)));
    return name;
  };
  const hfStyles: string[] = [];
  const pages: string[] = [];
  for (const index of [...used].sort((a, b) => a - b)) {
    const set = sets[index];
    if (!set) continue;
    pages.push(masterPageXml(`Section${index + 1}`, layoutFor(index, set), set, pageCount, (x) => hfStyles.push(x), `MS${index}`));
  }
  if (layouts.length) styles = styles.replace('</office:automatic-styles>', `${layouts.join('')}</office:automatic-styles>`);
  if (pages.length) styles = styles.replace('</office:master-styles>', `${pages.join('')}</office:master-styles>`);
  if (hfStyles.length) {
    const defs = hfStyles.join('');
    styles = injectAutomaticStyles(styles, defs);
  }

  files['content.xml'] = strToU8(content);
  files['styles.xml'] = strToU8(styles);
  return rezipOdt(files);
}

// A text run's ODF <style:text-properties> attribute string from TipTap marks (mirrors
// formattingFromMarks). Empty string → no styling needed (returned as null).
function odfTextPropsFromMarks(marks: TiptapNode['marks']): string | null {
  const fmt = formattingFromMarks(marks);
  const a: string[] = [];
  // The effects below name the underline's own shape and colour where the run has them.
  const extra = odfExtraTextProps(marks);
  if (fmt.fontWeight != null) a.push(`fo:font-weight="${fmt.fontWeight}"`);
  else if (fmt.bold) a.push('fo:font-weight="bold"');
  if (fmt.italic) a.push('fo:font-style="italic"');
  if (fmt.underline) {
    a.push('style:text-underline-width="auto"');
    if (!/style:text-underline-style=/.test(extra)) a.push('style:text-underline-style="solid"');
    if (!/style:text-underline-color=/.test(extra)) a.push('style:text-underline-color="font-color"');
  }
  if (fmt.strikethrough) a.push('style:text-line-through-style="solid"');
  if (extra) a.push(extra);
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
