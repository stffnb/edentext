import { strFromU8 } from 'fflate';
import { markerFormatFromText, pruneImportedMarkers, type MarkerFormat } from '../editor/extensions/listMarker';
import en from '../i18n/locales/en';
import { StyleResolver, NS, WATERMARK_NAME, lengthToPt, lengthToCm, layerTextProps, langTagsOfProps, type PropMap } from './styleResolver';
import { cjkDocFont, odfFromTag, tagFromOdf } from '../storage/documentLanguage';
import { ASIAN_SCRIPT_RE } from '../utils/script';
import { ODF_LOOK_ATTRS, normalizeColor, labelledItems } from '../export/odt';
import { HEADING_STYLE_OVERRIDES, MAX_HEADING_LEVEL } from '../styles/headings';
import { isAllowedUri } from '@tiptap/extension-link';
import { builtinStyleSheet, DEFAULT_STYLE, screenFontName, type ParaProps, type Style, type StyleSheet, type TextProps } from '../styles/styleSheet';
import { DEFAULT_OUTLINE_LEVEL, MAX_OUTLINE_LEVELS, type OutlineLevel, type OutlineNumbering } from '../styles/outlineNumbering';
import { LIST_LEVEL_STEP_CM, MAX_LIST_LEVELS, type ListLevelStyle, type ListStyle } from '../styles/listStyles';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { colorModeOf, cropOf, fitInlineImage, framePx, stackRank, wrapGap, wrapGapAttr, type Crop } from '../editor/extensions/image';
import { odfChartDataUrl } from './chart';
import { formatTabStops, normalizeLeader } from '../editor/extensions/tabStops';
import { isEmphasis, type CapsMode, type LineStyle } from '../editor/extensions/textEffects';
import {
  TABLE_REGIONS, builtinTableStyles, parseTableLook, resolveTableCell, tableLookAttr,
  type TableLook, type TableRegion,
} from '../styles/tableStyles';
import { knownNumFormat, odfNumFormatOf, orderedTypeFromFormat, orderedTypeAttrAt, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { bulletCharAttr, bulletCharFromOdf } from '../utils/bulletListTypes';
import { docxPicture, matchFormat, toDateValue, type Token } from '../utils/dateTime';
import {
  shapeFromOdfType, lineKindFor, pathHeadsFor, parseSvgPath, parseOdfPoints, fitPath, isOpenOutline, type ShapeKind,
} from '../utils/shapes';
import { resolveGeometry, type ResolvedGeometry } from '../utils/enhancedGeometry';
import { isPresetName, presetAdjust } from '../utils/shapePresets';
import type { DrawingMlPreset } from '../utils/shapes';
import { imageDataUrl, imageSizeCm, placeholderImage, unzipArchive, type ConvertedImages } from './imageFormats';
import { boundedInt, IMPORT_LIMITS, parseImportXml } from './importLimits';
import { astToLatex } from '../math/latex';
import { parseMathml } from '../math/mathml';
import { PX_PER_CM, cmToPx, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import type { RecordLock } from '../storage/trackChanges.svelte';
import type { SpacingModel } from '../storage/spacingModel';
import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
import { languageFromOdf, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
import { hfIsEmpty, type HfDistances, type HfDoc, type HfSet } from '../storage/headerFooter';
import { NOTE_FONT_SIZE_PT, NOTE_INDENT_CM, type NoteKind, type NoteNumFormat, type NoteSettings } from '../storage/noteSettings';
import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../storage/docProperties';
import { clampPageStart, type PageNumbering } from '../storage/pageNumbering';
import { newCommentId } from '../editor/extensions/comment';
import { ODF_SEQ_CATEGORY } from '../editor/extensions/caption';
import { isCrossRefFormat } from '../editor/extensions/crossReference';
import type { IndexKind, TocEntry } from '../editor/extensions/tableOfContents';
import { isBibType } from '../editor/extensions/bibliographyEntry';
import { citationStyleFromTemplate } from '../utils/citationStyle';
import type { PageDecor } from '../storage/pageDecor';
import { FOLD_MARK_NAME } from '../storage/foldMarks';
import type { LineNumbering } from '../storage/lineNumbering';
import type { LineGrid } from '../storage/lineGrid';
import type { EmbeddedFont } from '../fonts/embeddedFonts';
import { cellPaddingAttr, DEFAULT_CELL_PADDING, type CellPadding } from '../editor/extensions/tableCellPadding';
import { fromWriterFormula } from '../utils/tableFormula';
import { cellFormatFromSpec, type CellFormat, type FormatKind } from '../utils/cellFormat';
import { TEXTBOX_PADDING_CM, boxTextWidthCm } from '../editor/extensions/textBox';

// Warnings are the English catalog text; localizeImportMessage maps them at display time.
const WARN = en.importWarn;

// .odt → TipTap JSON, inverting export/odt.ts. Editor-expressible content becomes its
// native node/mark/attr; values matching the editor's defaults are suppressed so round
// trips don't accrete explicit attrs. Unsupported content degrades gracefully (reported).

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
  /** The blocks a paragraph became at its struck paragraph marks (`blocksOf`). */
  parts?: Node[];
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: Mark[];
  text?: string;
};

export interface OdtImportResult {
  content: Node; // { type: 'doc', … }
  margins: PageMargins | null;
  orientation: Orientation | null;
  format: PageFormat | null;
  // A right-to-left page (ODF style:writing-mode="rl-tb", Word w:bidi): the columns
  // fill from the right and the body's base direction is RTL.
  rtl: boolean;
  // Page background, page border and watermark (storage/pageDecor.ts).
  decor: PageDecor;
  lineNumbering: LineNumbering;
  lineGrid: LineGrid;
  // Every space at half the font size (settings.xml BalanceSpacesAndIdeographicSpaces,
  // Word's w:balanceSingleByteDoubleByteWidth).
  balanceSpaces: boolean;
  // Fold + punch marks in the left margin (the export's named header lines).
  foldMarks: boolean;
  // Automatic hyphenation (ODF fo:hyphenate on the base style, Word w:autoHyphenation).
  hyphenate: boolean;
  // Whether the document records revisions (ODF text:track-changes, Word w:trackRevisions).
  recordChanges: boolean;
  // What guards that against being turned off (settings.xml RedlineProtectionKey, Word w:documentProtection).
  recordLock: RecordLock | null;
  // How the page-number field counts (ODF style:num-format + style:page-number, Word w:pgNumType).
  pageNumbering: PageNumbering;
  // The grid every tab past the last custom stop falls on; the format's own fallback
  // when the file declares none.
  tabIntervalCm: number;
  // How the space between two blocks is measured; 'max' only where the file says so
  // (settings.xml AddParaTableSpacing=false, what LibreOffice writes for a Word import).
  spacingModel: SpacingModel;
  spacingAtPageStart: boolean;
  // Zone docs in the zoneExtensions schema; null = no zone.
  header: HfDoc;
  footer: HfDoc;
  // First-page variants (Word "Different First Page" / ODF header-first). null when
  // the file has no first-page override; only used when differentFirstPage is set.
  headerFirst: HfDoc;
  footerFirst: HfDoc;
  differentFirstPage: boolean;
  // Even-page variants (Word "Different Odd & Even Pages" / ODF header-left). null when
  // the file has no even-page override; only used when differentOddEven is set.
  headerEven: HfDoc;
  footerEven: HfDoc;
  differentOddEven: boolean;
  // One set per section, in body order — [0] repeats the fields above (the app's own
  // editable zones); the rest belong to blocks after a `sectionBreak`.
  hfSections: HfSet[];
  // Edge→zone distance (cm): header from top, footer from bottom. null = no zone.
  headerDistanceCm: number | null;
  footerDistanceCm: number | null;
  // Document spell-check language; NO_LANGUAGE when the file's language has no
  // bundled dictionary; null when the file declares none.
  language: DocumentLanguage | null;
  // The tag of the default language in the other slot (western or asian), null where none.
  languageOther?: string | null;
  // Fonts embedded in the package, to register via FontFace so they render.
  fonts: EmbeddedFont[];
  // The document's named paragraph styles: the file's own (only those it uses, plus
  // their parent chains) merged over the editor's built-ins.
  styles: StyleSheet;
  // How its footnotes and endnotes are numbered and separated.
  notes: NoteSettings;
  // Title/subject/author/keywords (ODF meta.xml, DOCX docProps/core.xml).
  props: DocProperties;
  warnings: string[];
}

// Where a block sits: only 'body' takes page breaks/columns/TOCs, and a 'list'
// paragraph's indent lives in the list style rather than its own margin.
type BlockKind = 'body' | 'list' | 'cell' | 'zone';

// `files` is the full unzipped archive so image converters can read Pictures/ binaries;
// imageCache dedupes repeated hrefs into one data-URI.
type Ctx = {
  resolver: StyleResolver;
  // ODF style name → display name, and the names blocks actually reference: the
  // document's style registry is built from these (only used styles are kept).
  styleNames: Map<string, string>;
  usedStyles: Set<string>;
  charStyleNames: Map<string, string>;
  usedCharStyles: Set<string>;
  // Named list styles (Listenformatvorlagen) lists reference, by ODF name.
  usedListStyles: Set<string>;
  // Last number of each top-level ordered list, keyed `style:<name>` and `id:<xml:id>`, so
  // text:continue-numbering / text:continue-list carry the count into a later list.
  listEnds: Map<string, number>;
  warnings: Set<string>;
  // text:ref-name of every sequence a text:sequence-ref in this file points at. The
  // editor addresses a caption through a bookmark, so those numbers get one.
  seqRefNames: Set<string>;
  files: Record<string, Uint8Array>;
  imageCache: Map<string, string>;
  convertedImages: ConvertedImages;
  // Text width (cm) of the section being walked; a table's margins are relative to it.
  // `docContentWidthCm` is the first section's, where the export keeps an index's stop.
  contentWidthCm: number;
  docContentWidthCm: number;
  // Text width (cm) of the cell being converted: what a table nested in it measures against.
  cellWidthCm?: number;
  // The columns of the section being walked: a table there fills one column.
  sectionCols?: { count: number; gapCm: number } | null;
  // The section's left page margin: a frame placed against the page is kept against the
  // text column, as the DOCX importer keeps it.
  leftMarginCm: number;
  // Page and body-text height (cm): what a frame centred on either sits in.
  pageHeightCm: number;
  textHeightCm: number;
  // The page's own direction: a block declaring the same one is inheriting, not
  // formatted, so only a block that differs carries a `dir` attr.
  pageRtl: boolean;
  // LibreOffice's Word 2013 layout (TabOverSpacing without TabOverMargin, settings.xml).
  breakDropsSpace: boolean;
  // Master pages the body switches to, in order — one section each past the first.
  masterPages: string[];
  leadingMaster: string; // the master the document opens on: naming it first switches nothing
  // The page number each of those sections restarts at, in the same order (null = it
  // counts on). ODF writes it on the paragraph that switches master page.
  masterPageStarts: (number | null)[];
  // Body blocks walked so far: only the document's first has nothing above it to break
  // from when a style names a master page.
  bodyBlocks: number;
  // Bookmark ranges open at this point of the walk, outermost first; a range may end in
  // a later paragraph than it started in, so the set outlives one convertInline call.
  /** Bookmarks whose range is open, by name; `true` once a run has carried it. */
  openBookmarks: Map<string, boolean>;
  /** Bookmarks with no range of their own, waiting for the next run to carry them. */
  pointBookmarks: Set<string>;
  // Ranged comments currently open, by their office:name — same shape as openBookmarks.
  openComments: Map<string, Record<string, unknown>>;
  // The answers in each comment's thread, by the office:name they point at. Collected
  // up front: LibreOffice writes an answer before the comment it belongs to.
  commentReplies: Map<string, { author: string; date: string; text: string }[]>;
  // Recorded revisions: the <text:tracked-changes> registry by change id, and the
  // insertions whose <text:change-start> has been seen but not their end.
  revisions: Map<string, OdfRevision>;
  openInsertions: Map<string, Record<string, unknown>>;
  // Likewise the format changes, whose regions state no old values.
  openFormats: Map<string, Record<string, unknown>>;
  // Footnotes/endnotes in anchor order: the file stores each note's text at its anchor,
  // the editor keeps them in one section at the document end (notes.ts).
  notes: { id: string; kind: NoteKind; label: string | null; text: string; content: Node[]; styleName: string | null }[];
  // Set when a header carries the export's named fold-mark lines (storage/foldMarks.ts).
  foldMarks: boolean;
  // Converting a header/footer zone: page fields, no notes or comments.
  zone?: boolean;
};

// Read a Pictures/ entry into a base64 data-URI; null when it's missing or in a format
// the browser can't display (the caller distinguishes the two for its warning).
function loadImageDataUrl(href: string, ctx: Ctx): string | null {
  const cached = ctx.imageCache.get(href);
  if (cached) return cached;
  // A format the browser can't render may have been pre-decoded to PNG by the async pass.
  const converted = ctx.convertedImages.get(href);
  if (converted) { ctx.imageCache.set(href, converted); return converted; }
  const bytes = ctx.files[href];
  if (!bytes) return null;
  const url = imageDataUrl(bytes, href);
  if (!url) return null;
  ctx.imageCache.set(href, url);
  return url;
}

// ODF style:wrap names the side TEXT flows on (inverse of the image side); pick a
// side from horizontal-pos when the value doesn't name one (parallel/dynamic/…).
function wrapModeFromOdf(wrapVal: string | undefined, hpos: string | undefined): 'left' | 'right' | 'topBottom' | 'through' {
  // run-through is the text running over or under the frame (style:run-through picks
  // which), so it reserves nothing — ODF's `none` is the one that means above-and-below.
  if (wrapVal === 'run-through') return 'through';
  if (wrapVal === 'none') return 'topBottom';
  if (wrapVal === 'left') return 'right'; // text on left ⇒ image on the right
  if (wrapVal === 'right') return 'left'; // text on right ⇒ image on the left
  return hpos && /right/.test(hpos) ? 'right' : 'left';
}

// draw:transform rotate() is CCW radians; the editor stores CW degrees.
function frameRotationDeg(el: Element): number {
  const transform = el.getAttributeNS(NS.draw, 'transform');
  const rot = transform && /rotate\s*\(\s*(-?[\d.eE+]+)\s*\)/.exec(transform);
  if (!rot) return 0;
  return ((Math.round((-parseFloat(rot[1]) * 180) / Math.PI) % 360) + 360) % 360;
}

// Where an as-char frame sits against the line: `baseline`/`char` measure from the text
// baseline, `text`/`line` from the character area, and `from-top` puts the frame's top
// svg:y below the baseline whatever the relation says (all probed against LibreOffice).
function applyInlineVAlign(el: Element, attrs: Record<string, unknown>, gp: PropMap): void {
  const pos = gp['style:vertical-pos'];
  const rel = gp['style:vertical-rel'];
  const area = rel === 'text' || rel === 'line';
  if (pos === 'from-top') {
    const y = lengthToCm(el.getAttributeNS(NS.svg, 'y'));
    if (y == null) return;
    // `from-top` with no relation and y 0 is how LibreOffice re-spells a frame that
    // declared no vertical alignment at all — the default, not an offset (probed).
    if (rel === undefined && y === 0) return;
    attrs.vAlign = 'offset';
    attrs.wrapOffsetY = Math.round(y * 1000) / 1000;
  } else if (pos === 'middle') attrs.vAlign = area ? 'text-middle' : 'middle';
  else if (pos === 'bottom') attrs.vAlign = area ? 'text-bottom' : 'below';
  else if (pos === 'top' && area) attrs.vAlign = 'text-top';
}

// A box is a block of its own, so a figure frame's centring — which its as-char anchor
// would otherwise give it — rides the box. Never at a side float (horizontal-pos is the
// float's side there); the image band-pairing left/right mapping is not a box's either.
function boxWrapAlign(gp: PropMap, attrs: Record<string, unknown>): void {
  delete attrs.wrapAlign;
  const hpos = gp['style:horizontal-pos'];
  if ((hpos === 'center' || hpos === 'right') && attrs.wrapOffset == null
      && attrs.wrap !== 'left' && attrs.wrap !== 'right') attrs.wrapAlign = hpos;
}

// Vertical text in any box shape: the style's writing mode, both of ODF's top-to-bottom
// modes (the editor has the one direction the browser lays out). A text frame carries it
// in the graphic properties, a drawing shape in its style's paragraph properties.
function boxTextFlow(el: Element, ctx: Ctx, attrs: Record<string, unknown>): void {
  const name = el.getAttributeNS(NS.draw, 'style-name');
  const gp = ctx.resolver.graphicProps(name);
  const mode = gp['style:writing-mode'] ?? ctx.resolver.graphicParaProps(name)['style:writing-mode'];
  if (mode === 'tb-rl' || mode === 'tb-lr' || mode === 'tb') attrs.textVertical = true;
  // Where the text sits in a box taller than it is; 'justify' spreads it, top-anchored.
  const anchor = gp['draw:textarea-vertical-align'];
  if (anchor === 'middle' || anchor === 'bottom') attrs.textVAlign = anchor;
}

// Nothing floats a run-through picture to a side, so its alignment in the column
// becomes the x that alignment gives, as the DOCX leg does for wrapNone.
function pictureAlignX(frame: Element, attrs: Record<string, unknown>, gp: PropMap, contentCm: number): void {
  const hpos = gp['style:horizontal-pos'], rel = gp['style:horizontal-rel'];
  const w = lengthToCm(frame.getAttributeNS(NS.svg, 'width'));
  if (attrs.wrap !== 'through' || attrs.wrapOffset != null || w == null || !contentCm) return;
  if (rel && rel !== 'paragraph' && rel !== 'paragraph-content' && rel !== 'page-content') return;
  const x = hpos === 'right' ? contentCm - w : hpos === 'center' ? (contentCm - w) / 2 : null;
  if (x != null) attrs.wrapOffset = Math.round(x * 100) / 100;
}

function applyFrameRotationAndWrap(el: Element, attrs: Record<string, unknown>, gp: PropMap, contentCm = 0, leftMarginCm = 0, heights?: { pageHeightCm: number; textHeightCm: number }): void {
  const deg = frameRotationDeg(el);
  if (deg) attrs.rotation = deg;
  const anchor = el.getAttributeNS(NS.text, 'anchor-type');
  if (anchor === 'as-char') {
    applyInlineVAlign(el, attrs, gp);
    return;
  }
  const wrapVal = gp['style:wrap'];
  if (anchor || wrapVal) {
    attrs.wrap = wrapModeFromOdf(wrapVal, gp['style:horizontal-pos']);
  }
  // "background" sits behind the text, "foreground" in front (frameGraphicProps).
  if (attrs.wrap === 'through' && gp['style:run-through'] === 'foreground') attrs.inFront = true;
  const rank = stackRank(el, NS.draw, 'z-index');
  if (rank) attrs.zIndex = rank;
  // Beside a side float only the text's side of the gap is drawn — the other one is the
  // frame's own offset; above and below count for every mode that wraps.
  if (attrs.wrap === 'left' || attrs.wrap === 'right' || attrs.wrap === 'topBottom') {
    const at = (side: string) => lengthToCm(gp[`fo:margin-${side}`] ?? gp['fo:margin']) ?? 0;
    const text = attrs.wrap === 'right' ? 'left' : attrs.wrap === 'left' ? 'right' : null;
    const gap = wrapGapAttr(wrapGap({ top: at('top'), bottom: at('bottom'), left: text === 'left' ? at('left') : 0, right: text === 'right' ? at('right') : 0 }));
    // Only a side gap stays the plain number it always was.
    if (gap) attrs.wrapDist = gap.top || gap.bottom ? gap : gap.left || gap.right;
  }
  // A frame placed by coordinate (style:horizontal-pos="from-left") keeps its x in the
  // column; the wrap mode alone would snap it to a side. An x the file measures from the
  // page edge (or the start margin, which begins there) counts from the column here too.
  const hpos = gp['style:horizontal-pos'];
  const hrel = gp['style:horizontal-rel'];
  const pageX = hrel === 'page' || hrel === 'page-start-margin' ? leftMarginCm : 0;
  // Set against the page's left edge is x 0 there: a cover picture filling the sheet.
  const rawX = hpos === 'from-left' ? placedAt(el, 'x')
    : hpos === 'left' && pageX ? 0 : null;
  const x = rawX == null ? null : rawX - pageX;
  if (x != null && attrs.wrap) attrs.wrapOffset = Math.round(x * 100) / 100;
  // Where the file names no side (parallel/dynamic), the text takes whichever side of
  // the frame has room: a frame set past the middle of the column is a float on the
  // right, not one on the left pushed there — which the browser drops below instead.
  if (x != null && contentCm > 0 && (attrs.wrap === 'left' || attrs.wrap === 'right')
      && wrapVal !== 'left' && wrapVal !== 'right') {
    const w = lengthToCm(el.getAttributeNS(NS.svg, 'width')) ?? 0;
    attrs.wrap = x > contentCm - (x + w) ? 'right' : 'left';
  }
  // Set against one end of its band rather than filling it (Word's positionH align).
  if (attrs.wrap === 'topBottom' && (hpos === 'left' || hpos === 'right')) attrs.wrapAlign = hpos;
  // Likewise down the page — against the anchor paragraph, or against the top of the
  // page it lands on (`page`, which is how LibreOffice writes a Word cover block; the
  // node view resolves the page, so the frame stays in the flow it is anchored in).
  // `page-content` counts from where the page's body text begins, below its header.
  const rel = gp['style:vertical-rel'];
  const fromPage = rel === 'page';
  const fromBody = rel === 'page-content';
  const vpos = gp['style:vertical-pos'];
  // Centred or set to the bottom of the page or its body: the top that puts it there.
  const room = heights && (fromPage ? heights.pageHeightCm : heights.textHeightCm)
    - (lengthToCm(el.getAttributeNS(NS.svg, 'height')) ?? 0);
  const y = vpos === 'from-top' && (!rel || rel.startsWith('paragraph') || rel === 'line' || fromPage || fromBody)
    ? placedAt(el, 'y') : vpos === 'top' && (fromPage || fromBody) ? 0
      : room != null && (fromPage || fromBody) && (vpos === 'middle' || vpos === 'bottom') ? (vpos === 'middle' ? room / 2 : room) : null;
  if (y != null && attrs.wrap && (fromPage || fromBody || y > 0 || (attrs.wrap === 'through' && y < 0))) {
    attrs.wrapOffsetY = Math.round(y * 100) / 100;
    if (fromPage) attrs.wrapFromPage = true;
    if (fromBody) attrs.wrapFromBody = true;
  }
  // A page-anchored frame is out of the text flow, placed from its page's corner: the
  // cover graphic or watermark of a title page. Its offsets are that corner's, not the
  // column's, so they replace whatever the wrap rules above read.
  if (anchor === 'page') {
    const page = Number(el.getAttributeNS(NS.text, 'anchor-page-number'));
    attrs.anchorPage = Number.isInteger(page) && page > 0 ? page : 1;
    attrs.wrapOffset = Math.max(0, placedAt(el, 'x') ?? 0);
    attrs.wrapOffsetY = Math.max(0, placedAt(el, 'y') ?? 0);
    // "background" (LibreOffice's default for a new one) sits behind text; a cover
    // page's own graphic instead declares "foreground" to sit in front of everything.
    if (gp['style:run-through'] === 'foreground') attrs.inFront = true;
  }
}

// A paragraph mark that declares nothing keeps the style's font, but the runs may all
// agree on another one — then that is the paragraph's font, strut included. Without it
// the taller style strut governs every line and the block renders too high. A field
// outside the runs keeps the style's font (`natural`) as a mark of its own, which
// raises only its line, as in both word processors.
const FONTLESS_INLINE = new Set(['hardBreak', 'image', 'textBox', 'formula', 'indexEntry']);
type InlineJson = { type: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
export function applyUniformRunFont(attrs: Record<string, unknown>, content: InlineJson[], natural: { fontSize?: string | null; fontFamily?: string | null } = {}): void {
  let family: string | null | undefined;
  let size: string | null | undefined;
  let runs = 0;
  const fields: InlineJson[] = [];
  for (const n of content) {
    if (FONTLESS_INLINE.has(n.type)) continue;
    if (n.type !== 'text') { fields.push(n); continue; }
    const ts = (n.marks ?? []).find((m) => m.type === 'textStyle')?.attrs ?? {};
    const f = (ts.fontFamily as string) ?? null;
    const s = (ts.fontSize as string) ?? null;
    if (runs && f !== family) family = undefined;
    if (runs && s !== size) size = undefined;
    if (!runs) { family = f; size = s; }
    runs++;
  }
  if (!runs) return;
  const hoist: Record<string, string> = {};
  if (attrs.fontFamily == null && family) hoist.fontFamily = family;
  if (attrs.fontSize == null && size) hoist.fontSize = size;
  for (const [k, v] of Object.entries(hoist)) {
    const keep = natural[k as keyof typeof natural];
    // A field that cannot keep the style's font would change its look: no hoist then.
    if (fields.length && !keep) continue;
    attrs[k] = v;
    for (const f of fields) {
      const ts = (f.marks ??= []).find((m) => m.type === 'textStyle');
      if (ts?.attrs?.[k] != null) continue;
      if (ts) ts.attrs = { ...ts.attrs, [k]: keep };
      else f.marks.push({ type: 'textStyle', attrs: { [k]: keep } });
    }
  }
}

// A top-and-bottom frame set below its paragraph's first line sinks behind the text: a
// full-width float pushes every following line under itself, so the offset can only be
// drawn as what stands above the frame. Higher up it overlaps the first line, which moves
// below it, so it leads (`fontPt` sizes that line at single spacing).
export function sinkOffsetFrames(content: { type: string; text?: string; attrs?: Record<string, unknown> }[], fontPt: number): void {
  const lineCm = fontPt * 1.15 * 2.54 / 72;
  const sinks = (n: { type: string; attrs?: Record<string, unknown> }) =>
    (n.type === 'image' || n.type === 'textBox')
    && n.attrs?.wrap === 'topBottom' && (n.attrs.wrapOffsetY as number) >= lineCm;
  if (!content.some(sinks)) return;
  const frames = content.filter(sinks).sort((a, b) => (a.attrs!.wrapOffsetY as number) - (b.attrs!.wrapOffsetY as number));
  for (const f of frames) content.splice(content.indexOf(f), 1);
  content.push(...frames);
}

// Two top-and-bottom pictures set against opposite ends of nearby paragraphs share one
// band and sit side by side, as they do in LibreOffice and Word. Only such a pair keeps
// its wrapAlign: a lone picture reserves the whole band, which is what the wrap means.
// Text boxes are left out — a box's place across its band is one the editor offers.
export function pairAlignedFrames(blocks: { content?: { type: string; attrs?: Record<string, unknown> }[] }[], columnPx: number): void {
  const found: { attrs: Record<string, unknown>; at: number }[] = [];
  blocks.forEach((b, i) => {
    for (const node of b.content ?? [])
      if (node.type === 'image' && node.attrs?.wrap === 'topBottom' && node.attrs.wrapAlign) found.push({ attrs: node.attrs, at: i });
  });
  const paired = new Set<Record<string, unknown>>();
  for (let i = 0; i + 1 < found.length; i++) {
    const [a, b] = [found[i], found[i + 1]];
    if (paired.has(a.attrs) || b.at - a.at > 3 || a.attrs.wrapAlign === b.attrs.wrapAlign) continue;
    const total = ((a.attrs.width as number) ?? 0) + ((b.attrs.width as number) ?? 0);
    if (!total || total > columnPx * 1.15) continue;
    // Word lets the two overlap in the middle; two floats cannot, so a pair a little
    // wider than the column is scaled down to it instead of breaking apart.
    if (total > columnPx) for (const f of [a, b]) scaleFrame(f.attrs, columnPx / total);
    paired.add(a.attrs).add(b.attrs);
  }
  for (const f of found) if (!paired.has(f.attrs)) f.attrs.wrapAlign = null;
}

function scaleFrame(attrs: Record<string, unknown>, factor: number): void {
  for (const k of ['width', 'height'])
    if (typeof attrs[k] === 'number') attrs[k] = Math.max(1, Math.round(attrs[k] * factor));
}

// A <draw:frame><draw:image> → an image node. Size comes from the frame's svg
// geometry (cm → px). as-char frames stay inline; paragraph/page-anchored frames
// with a wrap become floating (wrap mode + svg:x/svg:y position).
function convertFrame(frame: Element, ctx: Ctx): Node | null {
  // A frame may list several <draw:image> alternatives (e.g. a metafile + a bitmap
  // fallback) — prefer the first the browser can display.
  const hrefs = Array.from(frame.getElementsByTagNameNS(NS.draw, 'image'))
    .map(im => (im.getAttributeNS(NS.xlink, 'href') ?? '').replace(/^\.\//, ''))
    .filter(Boolean);
  if (!hrefs.length) return null;
  const href = hrefs.find(h => loadImageDataUrl(h, ctx)) ?? hrefs[0];
  let src = loadImageDataUrl(href, ctx);
  const wCm = lengthToCm(frame.getAttributeNS(NS.svg, 'width'));
  const hCm = lengthToCm(frame.getAttributeNS(NS.svg, 'height'));
  if (!src) {
    // The frame still occupies its box, so an undrawable picture comes in as a
    // placeholder of that size rather than collapsing the layout around it.
    if (wCm == null || hCm == null) {
      ctx.warnings.add(WARN.imagesSkipped);
      return null;
    }
    ctx.warnings.add(WARN.imagesPlaceholder);
    src = placeholderImage('Image', cmToPx(wCm), cmToPx(hCm));
  }
  const attrs: Record<string, unknown> = { src };
  if (wCm != null) attrs.width = framePx(cmToPx(wCm));
  if (hCm != null) attrs.height = framePx(cmToPx(hCm));
  const title = frame.getElementsByTagNameNS(NS.svg, 'title')[0]?.textContent;
  if (title) attrs.alt = title;
  const gp = ctx.resolver.frameGraphicProps(frame.getAttributeNS(NS.draw, 'style-name'));
  const crop = clipCrop(gp['fo:clip'], ctx.files[href]);
  if (crop) attrs.crop = crop;
  const mode = colorModeOf(gp['draw:color-mode']);
  if (mode) attrs.colorMode = mode;
  applyFrameRotationAndWrap(frame, attrs, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  pictureAlignX(frame, attrs, gp, ctx.contentWidthCm);
  if (!attrs.wrap || attrs.wrap === 'inline') fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  return { type: 'image', attrs };
}

// fo:clip="rect(top, right, bottom, left)" cuts lengths off the picture at its own size.
function clipCrop(clip: unknown, bytes: Uint8Array | undefined): Crop | null {
  const m = typeof clip === 'string' ? /rect\(([^)]*)\)/.exec(clip) : null;
  const size = m && bytes ? imageSizeCm(bytes) : null;
  if (!m || !size) return null;
  const [t, r, b, l] = m[1].split(/[\s,]+/).filter(Boolean).map((v) => Math.max(0, lengthToCm(v) ?? 0));
  return cropOf({ l: l / size.w, t: t / size.h, r: r / size.w, b: b / size.h });
}

// A shape's fill color; fo:background-color (LibreOffice's per-shape fill) beats draw:fill.
// A drawn shape's fill defaults to solid when the keyword is absent — LibreOffice only
// writes "none" to turn it off. defaultSolid is false for plain text frames (fill none).
function shapeFill(gp: PropMap, defaultSolid: boolean): string | null {
  const bg = gp['fo:background-color'];
  if (bg !== undefined) return bg === 'transparent' || bg === 'none' ? null : normalizeColor(bg) ?? null;
  const fill = gp['draw:fill'];
  const solid = fill === 'solid' || (fill === undefined && defaultSolid);
  return solid ? normalizeColor(gp['draw:fill-color'] ?? '') ?? null : null;
}

// A shape's stroke as { color, widthPt }. fo:border ("<w> <style> <color>", LibreOffice's
// per-shape border) wins over draw:stroke. Like the fill, a drawn shape's stroke defaults
// to solid when draw:stroke is absent (color from svg:stroke-color); "none" turns it off.
function shapeStroke(gp: PropMap, defaultSolid: boolean): { color: string | null; widthPt: number | null } {
  // A drawn shape's outline is draw:stroke alone: its style chain ends in LibreOffice's
  // Frame style, whose hairline fo:border belongs to text frames.
  const border = defaultSolid ? undefined : gp['fo:border'];
  if (border !== undefined) {
    let widthPt: number | null = null, color: string | null = null, styleTok: string | null = null;
    for (const part of border.trim().split(/\s+/)) {
      if (/^-?[\d.]+\s*(pt|cm|mm|in|px|pc)?$/.test(part)) widthPt = lengthToPt(part);
      else if (part.startsWith('#')) color = normalizeColor(part) ?? null;
      else styleTok = part;
    }
    if (styleTok === 'none' || styleTok === 'hidden' || (widthPt != null && widthPt <= 0)) {
      return { color: null, widthPt: null };
    }
    return { color: color ?? '#000000', widthPt };
  }
  const stroke = gp['draw:stroke'];
  const present = stroke === undefined ? defaultSolid && gp['svg:stroke-color'] !== undefined : stroke !== 'none';
  const color = present ? normalizeColor(gp['svg:stroke-color'] ?? '#000000') ?? '#000000' : null;
  return { color, widthPt: color ? lengthToPt(gp['svg:stroke-width']) : null };
}

// Fill/stroke attrs from a shape's graphic style, suppressing the editor defaults (white
// fill, 1pt black stroke). Absent/none → explicit null, since omitting the attr would
// re-apply the default. defaultSolid marks drawn shapes, whose fill/stroke default solid.
function shapeStyleAttrs(gp: PropMap, attrs: Record<string, unknown>, defaultSolid: boolean): void {
  const fillColor = shapeFill(gp, defaultSolid);
  if (fillColor !== '#FFFFFF') attrs.fillColor = fillColor;
  const { color: strokeColor, widthPt } = shapeStroke(gp, defaultSolid);
  if (strokeColor !== '#000000') attrs.strokeColor = strokeColor;
  if (strokeColor && widthPt != null && Math.abs(widthPt - 1) > 0.1) {
    attrs.strokeWidthPt = Math.round(widthPt * 100) / 100;
  }
}

// The block content of a text box / shape: one table where the frame holds nothing
// else, otherwise its text:* children and tables via the cell path, at least one paragraph.
function textBoxContent(children: Element[], ctx: Ctx, widthCm: number | null, attrs: Record<string, unknown>): Node[] {
  const textChildren = children.filter(c => c.namespaceURI === NS.text);
  // A frame holding nothing but a table is a floating table — how LibreOffice keeps
  // Word's own (w:tblpPr) and the one table the box's schema takes. Its margins are
  // measured against the frame it fills, not the page's text.
  const blocks = children.map(c => c.namespaceURI === (NS.loext as string) && c.localName === 'table' ? asOdfTable(c) : c)
    .filter(c => c.namespaceURI === NS.text || (c.namespaceURI === NS.table && c.localName === 'table'));
  const tables = blocks.filter(c => c.namespaceURI === NS.table);
  if (tables.length === 1 && textChildren.every(c => c.localName !== 'list' && !c.textContent?.trim())) {
    const outerCm = ctx.contentWidthCm;
    if (widthCm) ctx.contentWidthCm = widthCm;
    let table: Node | null;
    try { table = convertTable(tables[0], ctx); } finally { ctx.contentWidthCm = outerCm; }
    if (table) return [table];
  }
  // No cell around the box's blocks any more, whatever the box sits in: a table beside
  // the text is measured against the box's text width, as one in a cell is.
  const outerCell = ctx.cellWidthCm;
  ctx.cellWidthCm = boxTextWidthCm(attrs);
  let out: Node[];
  try { out = unnestBoxes(convertBlocks(blocks, ctx, 'cell'), ctx); } finally { ctx.cellWidthCm = outerCell; }
  return out.length ? out : [{ type: 'paragraph' }];
}

// LibreOffice writes a table in a drawing shape's text as loext:table, its columns, rows
// and cells loext: too (attributes table:); read as the table:table it stands for.
function asOdfTable(el: Element): Element {
  const out = el.ownerDocument.createElementNS(NS.table, `table:${el.localName}`);
  for (const a of Array.from(el.attributes)) out.setAttributeNS(a.namespaceURI, a.name, a.value);
  for (const c of Array.from(el.childNodes)) {
    out.appendChild(c instanceof Element && c.namespaceURI === (NS.loext as string) ? asOdfTable(c) : c.cloneNode(true));
  }
  return out;
}

// A box inside a box has nowhere to go — both word processors refuse one and the editor
// bars it — so its blocks take its place in the outer box. Bottom-up, so one pass does.
export function unnestBoxes(blocks: Node[], ctx: { warnings: Set<string> }): Node[] {
  const out: Node[] = [];
  for (const block of blocks) {
    const boxes = (block.content ?? []).filter(n => n.type === 'textBox');
    if (!boxes.length) { out.push(block); continue; }
    ctx.warnings.add(WARN.textBoxFlattened);
    block.content = block.content!.filter(n => n.type !== 'textBox');
    if (block.content.length) out.push(block);
    for (const b of boxes) out.push(...(b.content ?? [{ type: 'paragraph' }]));
  }
  return out;
}

// A <draw:frame><draw:text-box> → a textBox node. The height is the text-box's
// fo:min-height when present (height = minimum, content grows the box), else the
// frame's svg:height, which LibreOffice keeps fixed and clips at.
function convertTextBoxFrame(frame: Element, textBoxEl: Element, ctx: Ctx): Node {
  // A region around the frame records the frame, not the paragraphs in it.
  const open = ctx.openInsertions;
  ctx.openInsertions = new Map();
  try { return textBoxNode(frame, textBoxEl, ctx); } finally { ctx.openInsertions = open; }
}

function textBoxNode(frame: Element, textBoxEl: Element, ctx: Ctx): Node {
  const attrs: Record<string, unknown> = {};
  // A floating frame that grows with its text (fo:min-width, no width) spans what its
  // anchor leaves it: LibreOffice lays it out at the column's width (probed).
  const minCm = lengthToCm(textBoxEl.getAttributeNS(NS.fo, 'min-width'));
  const xCm = lengthToCm(frame.getAttributeNS(NS.svg, 'x')) ?? 0;
  const spans = minCm != null && frame.getAttributeNS(NS.text, 'anchor-type') !== 'as-char';
  const wCm = lengthToCm(frame.getAttributeNS(NS.svg, 'width'))
    ?? (spans ? Math.max(minCm, Math.round((ctx.contentWidthCm - xCm) * 1000) / 1000) : minCm);
  if (wCm != null) attrs.width = framePx(cmToPx(wCm));
  const minHCm = lengthToCm(textBoxEl.getAttributeNS(NS.fo, 'min-height'));
  const hCm = minHCm ?? lengthToCm(frame.getAttributeNS(NS.svg, 'height'));
  if (hCm != null) attrs.height = framePx(cmToPx(hCm));
  if (minHCm == null && hCm != null) attrs.fixedHeight = true;
  const gp = ctx.resolver.frameGraphicProps(frame.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(frame, attrs, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  boxWrapAlign(gp, attrs);
  const padCm = lengthToCm(gp['fo:padding'] ?? gp['fo:padding-left']);
  if (padCm != null && Math.abs(padCm - TEXTBOX_PADDING_CM) > 0.01) attrs.paddingCm = Math.round(padCm * 1000) / 1000;
  for (const [prop, key] of [['fo:padding-top', 'paddingTopCm'], ['fo:padding-bottom', 'paddingBottomCm']]) {
    const cm = lengthToCm(gp[prop]);
    if (cm != null && Math.abs(cm - (padCm ?? TEXTBOX_PADDING_CM)) > 0.01) attrs[key] = Math.round(cm * 1000) / 1000;
  }
  shapeStyleAttrs(gp, attrs, false);
  // A text frame without a fill under a common style still covers what lies behind it —
  // LibreOffice paints its surroundings' background there — unless draw:opacity lets it show.
  if (attrs.fillColor === null && !(parseFloat(gp['draw:opacity'] ?? '100') < 100)
    && ctx.resolver.hasCommonGraphicStyle(frame.getAttributeNS(NS.draw, 'style-name'))) delete attrs.fillColor;
  boxTextFlow(frame, ctx, attrs);
  return { type: 'textBox', attrs, content: textBoxContent(Array.from(textBoxEl.children), ctx, wCm, attrs) };
}

// A <draw:frame> holding a formula object → a formula node. The MathML lives either
// in the referenced sub-document (LibreOffice, and our own export) or inline in the
// <draw:object>; parseMathml prefers our LaTeX annotation when the file carries one.
function convertFormulaFrame(frame: Element, ctx: Ctx): Node | null {
  const obj = Array.from(frame.children).find(
    c => c.namespaceURI === NS.draw && (c.localName === 'object' || c.localName === 'object-ole'),
  );
  if (!obj) return null;
  const inline = obj.getElementsByTagNameNS(NS.math, 'math')[0];
  const mathEl = inline ?? loadFormulaObject(obj.getAttributeNS(NS.xlink, 'href'), ctx);
  if (!mathEl) return null;
  const got = parseMathml(mathEl);
  const latex = got.latex ?? astToLatex(got.ast);
  if (!latex.trim()) return null;
  // The frame's svg geometry is ignored: a formula is laid out from its own markup,
  // so a stored box would only fight the renderer.
  return { type: 'formula', attrs: { latex, display: aloneInParagraph(frame) } };
}

// A <draw:frame> holding a chart object → an image node drawing it, at the frame's own
// size. Read-only, like the DOCX leg: the editor has no chart object, so a re-export
// carries the picture (see import/chart.ts).
function convertChartFrame(frame: Element, ctx: Ctx): Node | null {
  const obj = Array.from(frame.children).find(
    c => c.namespaceURI === NS.draw && (c.localName === 'object' || c.localName === 'object-ole'),
  );
  const wCm = lengthToCm(frame.getAttributeNS(NS.svg, 'width'));
  const hCm = lengthToCm(frame.getAttributeNS(NS.svg, 'height'));
  if (!obj || wCm == null || hCm == null) return null;
  const doc = loadObjectDoc(obj.getAttributeNS(NS.xlink, 'href'), ctx);
  const src = doc && odfChartDataUrl(doc, cmToPx(wCm), cmToPx(hCm));
  if (!src) return null;
  const attrs: Record<string, unknown> = { src, width: framePx(cmToPx(wCm)), height: framePx(cmToPx(hCm)), alt: 'Chart' };
  const gp = ctx.resolver.frameGraphicProps(frame.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(frame, attrs, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  pictureAlignX(frame, attrs, gp, ctx.contentWidthCm);
  if (!attrs.wrap || attrs.wrap === 'inline') fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  return { type: 'image', attrs };
}

// A display formula is one that owns its line — ODF has no flag for it (LibreOffice
// writes display="block" on every formula object it re-saves), so it is read off the
// paragraph: nothing but this frame in it.
function aloneInParagraph(frame: Element): boolean {
  const p = frame.parentElement;
  if (!p || p.namespaceURI !== NS.text || (p.localName !== 'p' && p.localName !== 'h')) return false;
  if ((p.textContent ?? '').trim()) return false;
  // A deletion's point marker counts: rejecting it restores text beside the formula.
  if (p.getElementsByTagNameNS(NS.text, 'change')[0]) return false;
  return Array.from(p.children).filter(c => c.namespaceURI === NS.draw).length === 1;
}

// The embedded object's content.xml — an ODF formula document's root is the MathML
// itself. A non-formula object (chart, spreadsheet) has no math root and falls through.
function loadFormulaObject(href: string | null, ctx: Ctx): Element | null {
  const doc = loadObjectDoc(href, ctx);
  const root = doc?.documentElement;
  if (!root) return null;
  return root.namespaceURI === NS.math && root.localName === 'math'
    ? root
    : doc!.getElementsByTagNameNS(NS.math, 'math')[0] ?? null;
}

// The sub-document a draw:object points at ("./Object 1" → "Object 1/content.xml").
function loadObjectDoc(href: string | null, ctx: Ctx): Document | null {
  const dir = (href ?? '').replace(/^\.\//, '').replace(/\/$/, '');
  if (!dir) return null;
  const bytes = ctx.files[`${dir}/content.xml`] ?? ctx.files[dir];
  if (!bytes) return null;
  // An object this cannot read costs its own frame, never the whole document.
  let doc: Document;
  try { doc = parseImportXml(strFromU8(bytes), 'odt'); } catch { return null; }
  return doc.documentElement && !doc.getElementsByTagName('parsererror').length ? doc : null;
}

// draw:rect / draw:ellipse / draw:custom-shape (any preset `utils/shapes.ts` knows) → a
// textBox with the matching shapeKind; the shape's text is its content. A preset we
// can't draw (a connector, a freeform) is dropped with a warning.
function convertShape(el: Element, ctx: Ctx): Node | null {
  let kind: ShapeKind | null = null;
  let path = '';
  let resolved: ResolvedGeometry | null = null;
  let preset: DrawingMlPreset | null = null;
  if (el.localName === 'rect') kind = 'textbox';
  else if (el.localName === 'ellipse') kind = 'ellipse';
  else {
    const geo = el.getElementsByTagNameNS(NS.draw, 'enhanced-geometry')[0];
    const type = geo?.getAttributeNS(NS.draw, 'type') ?? '';
    kind = shapeFromOdfType(type);
    // A shape no preset covers still draws from the outline it carries: LibreOffice
    // writes a freeform as `non-primitive` plus the path, any other shape with formulas.
    // A DrawingML preset (`ooxml-name`) stays one, so it keeps resizing as a preset.
    if (!kind && geo) {
      resolved = enhancedPathOutline(geo, el);
      path = resolved.path;
      const name = type.startsWith('ooxml-') ? type.slice(6) : '';
      if (path && isPresetName(name)) {
        const flag = (a: string) => geo.getAttributeNS(NS.draw, a) === 'true';
        preset = { name, adj: presetAdjust(name, (geo.getAttributeNS(NS.draw, 'modifiers') ?? '').trim().split(/\s+/).filter(Boolean).map(Number)),
          ...(flag('mirror-horizontal') ? { flipH: true } : {}), ...(flag('mirror-vertical') ? { flipV: true } : {}) };
      }
      if (path) kind = 'textbox';
    }
  }
  if (!kind) {
    ctx.warnings.add(WARN.shapesRemoved);
    return null;
  }
  const attrs: Record<string, unknown> = {};
  if (kind !== 'textbox') attrs.shapeKind = kind;
  if (path) attrs.shapePath = path;
  if (resolved?.textArea) attrs.shapeTextArea = resolved.textArea;
  if (preset) attrs.shapePreset = preset;
  const wCm = lengthToCm(el.getAttributeNS(NS.svg, 'width'));
  const hCm = lengthToCm(el.getAttributeNS(NS.svg, 'height'));
  if (wCm != null) attrs.width = framePx(cmToPx(wCm));
  if (hCm != null) attrs.height = framePx(cmToPx(hCm));
  const gp = ctx.resolver.graphicProps(el.getAttributeNS(NS.draw, 'style-name'));
  // A rectangle keeps its height unless it grows with its text: a rule drawn as a
  // 0.5mm bar holds an empty paragraph it must not grow to.
  if (el.localName === 'rect' && hCm != null && gp['draw:auto-grow-height'] !== 'true') attrs.fixedHeight = true;
  applyFrameRotationAndWrap(el, attrs, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  boxWrapAlign(gp, attrs);
  shapeStyleAttrs(gp, attrs, true);
  if (path) outlineHeads(gp, attrs);
  boxTextFlow(el, ctx, attrs);
  return { type: 'textBox', attrs, content: textBoxContent(Array.from(el.children), ctx, wCm, attrs) };
}

// A `<draw:enhanced-geometry>` no preset matches, read as its own outline: its
// equations and modifiers resolved for the shape's size, arcs as curves. LibreOffice
// keeps the arcs only in its own `drawooo:enhanced-path`, so that one wins.
function enhancedPathOutline(geo: Element, el: Element): ResolvedGeometry {
  const path = geo.getAttributeNS(NS.drawooo, 'enhanced-path') || geo.getAttributeNS(NS.draw, 'enhanced-path');
  if (!path) return { path: '', textArea: null };
  const nums = (v: string | null) => (v ?? '').trim().split(/\s+/).filter(Boolean).map(Number);
  const equations: Record<string, string> = {};
  for (const eq of Array.from(geo.getElementsByTagNameNS(NS.draw, 'equation'))) {
    equations[eq.getAttributeNS(NS.draw, 'name') ?? ''] = eq.getAttributeNS(NS.draw, 'formula') ?? '';
  }
  const hundredthMm = (name: string) => (lengthToCm(el.getAttributeNS(NS.svg, name)) ?? 0) * 1000;
  return resolveGeometry({
    path, equations,
    modifiers: nums(geo.getAttributeNS(NS.draw, 'modifiers')),
    viewBox: nums(geo.getAttributeNS(NS.svg, 'viewBox')),
    logW: hundredthMm('width'), logH: hundredthMm('height'),
    mirrorH: geo.getAttributeNS(NS.draw, 'mirror-horizontal') === 'true',
    mirrorV: geo.getAttributeNS(NS.draw, 'mirror-vertical') === 'true',
    subViews: nums(geo.getAttributeNS(NS.drawooo, 'sub-view-size')),
    textAreas: geo.getAttributeNS(NS.draw, 'text-areas') ?? undefined,
  });
}

// draw:polygon / draw:polyline / draw:path / draw:connector → a box drawing the file's
// own outline. The frame is the shape's box, or — a connector declaring none — the one
// its two endpoints span.
function convertFreeform(el: Element, ctx: Ctx): Node | null {
  const num = (ns: string, name: string) => lengthToCm(el.getAttributeNS(ns, name));
  const vb = (el.getAttributeNS(NS.svg, 'viewBox') ?? '').split(/\s+/).map(Number);
  const points = el.getAttributeNS(NS.draw, 'points');
  const d = el.getAttributeNS(NS.svg, 'd');
  const cmds = d ? parseSvgPath(d)
    : points ? parseOdfPoints(points, el.localName === 'polygon')
    : [];
  let wCm = num(NS.svg, 'width');
  let hCm = num(NS.svg, 'height');
  if (wCm == null || hCm == null) {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => num(NS.svg, a) ?? 0);
    wCm = Math.abs(x2 - x1);
    hCm = Math.abs(y2 - y1);
  }
  const path = cmds.length && vb.length === 4 && vb[2] > 0 && vb[3] > 0
    ? fitPath(cmds, vb[2], vb[3], vb[0], vb[1]) : '';
  if (!path || !wCm || !hCm) {
    ctx.warnings.add(WARN.shapesRemoved);
    return null;
  }
  const attrs: Record<string, unknown> = {
    shapePath: path, width: framePx(cmToPx(wCm)), height: framePx(cmToPx(hCm)),
  };
  const gp = ctx.resolver.graphicProps(el.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(el, attrs, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  boxWrapAlign(gp, attrs);
  shapeStyleAttrs(gp, attrs, true);
  outlineHeads(gp, attrs);
  return { type: 'textBox', attrs, content: [{ type: 'paragraph' }] };
}

// The arrow heads an open outline's style declares. A closed one has no ends to carry them.
function outlineHeads(gp: PropMap, attrs: Record<string, unknown>): void {
  const heads = pathHeadsFor(!!gp['draw:marker-start'], !!gp['draw:marker-end']);
  if (heads && isOpenOutline(String(attrs.shapePath))) attrs.arrowHeads = heads;
}

// draw:line → a textBox of the matching line kind: the two endpoints become the frame
// they span, and which diagonal they run along. Which heads the graphic style declares
// is what decides plain line / arrow / double arrow.
function convertLine(el: Element, ctx: Ctx): Node | null {
  const at = (name: string) => lengthToCm(el.getAttributeNS(NS.svg, name)) ?? 0;
  const [x1, y1, x2, y2] = [at('x1'), at('y1'), at('x2'), at('y2')];
  const gp = ctx.resolver.graphicProps(el.getAttributeNS(NS.draw, 'style-name'));
  const [start, end] = [!!gp['draw:marker-start'], !!gp['draw:marker-end']];
  const kind = lineKindFor(start, end);
  const attrs: Record<string, unknown> = {
    shapeKind: kind,
    width: framePx(cmToPx(Math.abs(x2 - x1))),
    height: framePx(cmToPx(Math.abs(y2 - y1))),
  };
  // The editor draws a line across its frame from the corner its flips name; its one
  // head is the end's, so a line with the start's alone runs back.
  const back = start && !end;
  if ((y2 < y1) !== back) attrs.flipV = true;
  if ((x2 < x1) !== back) attrs.flipH = true;
  applyFrameRotationAndWrap(el, attrs, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  boxWrapAlign(gp, attrs);
  shapeStyleAttrs(gp, attrs, true);
  return { type: 'textBox', attrs, content: [{ type: 'paragraph' }] };
}

// Where a drawing in a group sits, in cm of its anchor's space: its own x/y, a line's
// endpoints, or a rotated shape's box worked back from the rotate()/translate() pair.
function drawBox(el: Element): { x: number; y: number; w: number; h: number } {
  const at = (name: string) => lengthToCm(el.getAttributeNS(NS.svg, name));
  const w = at('width'), h = at('height');
  if (w == null || h == null) {
    const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((a) => at(a) ?? 0);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  const transform = el.getAttributeNS(NS.draw, 'transform') ?? '';
  const t = /translate\s*\(\s*(\S+?)\s*[ ,]\s*(\S+?)\s*\)/.exec(transform);
  if (!t) return { x: at('x') ?? 0, y: at('y') ?? 0, w, h };
  // The box turns counter-clockwise about its corner, which then moves to the translate.
  const a = parseFloat(/rotate\s*\(\s*(-?[\d.eE+]+)/.exec(transform)?.[1] ?? '0') || 0;
  const cx = (lengthToCm(t[1]) ?? 0) + (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
  const cy = (lengthToCm(t[2]) ?? 0) - (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// A frame's unrotated corner: svg:x/y, or for a rotated one its translate(). Files that
// carry both (earlier exports of this editor) keep svg:x/y; their translate is off.
function placedAt(el: Element, axis: 'x' | 'y'): number | null {
  const v = lengthToCm(el.getAttributeNS(NS.svg, axis));
  if (v != null || !/translate/.test(el.getAttributeNS(NS.draw, 'transform') ?? '')) return v;
  return drawBox(el)[axis];
}

const PLACEMENT_ATTRS = ['wrap', 'wrapOffset', 'wrapOffsetY', 'wrapFromPage', 'wrapFromBody', 'wrapAlign',
  'wrapDist', 'inFront', 'anchorPage', 'vAlign', 'zIndex'];

// A draw:g opens as its members, as a DOCX group does: they sit in the anchor's space,
// the group's style places their bounding box, and the first member carries that
// placement (an as-char group's place in the line) while the rest run through over it.
function convertDrawGroup(g: Element, ctx: Ctx): Node[] {
  const leaves: Element[] = [];
  const collect = (el: Element) => {
    for (const c of Array.from(el.children)) {
      if (c.namespaceURI !== NS.draw) continue;
      if (c.localName === 'g' || c.localName === 'a') collect(c);
      else leaves.push(c);
    }
  };
  collect(g);
  const members: { node: Node; box: ReturnType<typeof drawBox> }[] = [];
  for (const leaf of leaves) {
    const conv = convertDrawElement(leaf, ctx);
    const node = conv?.inline ?? conv?.block;
    if (node) members.push({ node, box: drawBox(leaf) });
  }
  if (!members.length) { ctx.warnings.add(WARN.drawingsRemoved); return []; }

  const minX = Math.min(...members.map((m) => m.box.x));
  const minY = Math.min(...members.map((m) => m.box.y));
  const bounds = g.cloneNode(false) as Element;
  bounds.setAttributeNS(NS.svg, 'svg:x', `${minX}cm`);
  bounds.setAttributeNS(NS.svg, 'svg:y', `${minY}cm`);
  bounds.setAttributeNS(NS.svg, 'svg:width', `${Math.max(...members.map((m) => m.box.x + m.box.w)) - minX}cm`);
  bounds.setAttributeNS(NS.svg, 'svg:height', `${Math.max(...members.map((m) => m.box.y + m.box.h)) - minY}cm`);
  const gp = ctx.resolver.graphicProps(g.getAttributeNS(NS.draw, 'style-name'));
  const place: Record<string, unknown> = {};
  applyFrameRotationAndWrap(bounds, place, gp, ctx.contentWidthCm, ctx.leftMarginCm, ctx);
  delete place.rotation;

  // Member offsets count from the group's own offset where it has one, else from the
  // first member, which is where the line or the alignment puts it.
  const [first, ...rest] = members;
  const originX = place.wrap && place.wrapOffset != null ? (place.wrapOffset as number) - minX : -first.box.x;
  const originY = place.wrap && place.wrapOffsetY != null ? (place.wrapOffsetY as number) - minY : -first.box.y;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const strip = (n: Node) => {
    const attrs = { ...n.attrs };
    for (const k of PLACEMENT_ATTRS) delete attrs[k];
    return attrs;
  };
  const carrier = { ...first.node, attrs: { ...strip(first.node), ...place } };
  if (place.wrap && place.wrapOffset != null) carrier.attrs.wrapOffset = r(originX + first.box.x);
  if (place.wrap && place.wrapOffsetY != null) carrier.attrs.wrapOffsetY = r(originY + first.box.y);
  const over = rest.map(({ node, box }) => ({
    ...node,
    attrs: {
      ...strip(node), wrap: 'through', inFront: gp['style:run-through'] !== 'background',
      wrapOffset: r(originX + box.x), wrapOffsetY: r(originY + box.y),
      ...(place.wrapFromPage ? { wrapFromPage: true } : {}),
      ...(place.wrapFromBody ? { wrapFromBody: true } : {}),
      ...(place.anchorPage ? { anchorPage: place.anchorPage } : {}),
      ...(place.zIndex ? { zIndex: place.zIndex } : {}),
    },
  }));
  // An as-char carrier reserves the group's place in the line, and the frames over it
  // take their static position from the paragraph — so they precede it.
  return place.wrap || place.anchorPage ? [carrier, ...over] : [...over, carrier];
}

// Dispatch any draw:* element: an image stays inline; a text box / shape is a block
// node; a group is its members; everything else is dropped with a warning.
function convertDrawElement(e: Element, ctx: Ctx): { inline?: Node; block?: Node; group?: Node[] } | null {
  // The watermark is not a drawing: it rides the page decoration instead
  // (storage/pageDecor.ts), so it must not also arrive as a shape in the header.
  if (e.getAttributeNS(NS.draw, 'name')?.startsWith(WATERMARK_NAME)) return null;
  // Fold marks ride the flag (storage/foldMarks.ts), not the document, same rule.
  if (e.getAttributeNS(NS.draw, 'name')?.startsWith(FOLD_MARK_NAME)) {
    ctx.foldMarks = true;
    return null;
  }
  if (e.localName === 'frame') {
    const textBoxEl = Array.from(e.children).find(
      c => c.namespaceURI === NS.draw && c.localName === 'text-box',
    );
    if (textBoxEl) return { block: convertTextBoxFrame(e, textBoxEl, ctx) };
    const formula = convertFormulaFrame(e, ctx);
    if (formula) return { inline: formula };
    const chart = convertChartFrame(e, ctx);
    if (chart) return { inline: chart };
    const hasImage = !!e.getElementsByTagNameNS(NS.draw, 'image')[0];
    const img = convertFrame(e, ctx);
    if (img) return { inline: img };
    // A frame with neither image nor text box (OLE object, …) — report the drop;
    // an unreadable image already warned inside convertFrame.
    if (!hasImage) ctx.warnings.add(WARN.drawingsRemoved);
    return null;
  }
  if (e.localName === 'line') {
    const line = convertLine(e, ctx);
    return line ? { block: line } : null;
  }
  if (e.localName === 'rect' || e.localName === 'ellipse' || e.localName === 'custom-shape') {
    const shape = convertShape(e, ctx);
    return shape ? { block: shape } : null;
  }
  if (e.localName === 'polygon' || e.localName === 'polyline' || e.localName === 'path'
    || e.localName === 'connector') {
    const shape = convertFreeform(e, ctx);
    return shape ? { block: shape } : null;
  }
  if (e.localName === 'g') {
    const group = convertDrawGroup(e, ctx);
    return group.length ? { group } : null;
  }
  if (e.localName === 'a') {
    // draw:a wraps a drawing in a hyperlink; the editor has no image link, so unwrap
    // to the inner drawing (the link is dropped, like other flattened hyperlinks).
    for (const child of Array.from(e.children)) {
      if (child.namespaceURI !== NS.draw) continue;
      const conv = convertDrawElement(child, ctx);
      if (conv) return conv;
    }
    return null;
  }
  ctx.warnings.add(WARN.drawingsRemoved);
  return null;
}

// ---- editor defaults to suppress on import -----------------------------------

const BODY_FONT_SIZE_PT = 12;
// Match LO/Word producer rounding noise (cm: ≤0.014pt, twips: ≤0.025pt), not
// genuine user values.
const EPS_PT = 0.15;

const HEADING_DEFAULTS = HEADING_STYLE_OVERRIDES.map(h => ({
  fontSizePt: lengthToPt(h.fontSize)!,
  marginTopPt: lengthToPt(h.marginTop)!,
  marginBottomPt: lengthToPt(h.marginBottom)!,
  italic: h.italic === true,
}));

// The editor's on-screen default (Liberation Serif) and what the export declares
// in its place (Times New Roman) — both mean "default font", so no mark. Headings
// render sans (HEADING_FONT), so their default pair is the metric-identical one.
const DEFAULT_FONTS = new Set(['times new roman', 'liberation serif']);
const DEFAULT_HEADING_FONTS = new Set(['arial', 'liberation sans']);

// odf-kit emits each list level at margin-left = level × 1.27cm (label-alignment).
// A top-level list's margin beyond this level-1 base is its whole-list indent.
const LIST_BASE_MARGIN_CM = 1.27;
const LIST_INDENT_EPS_CM = 0.05;
const LIST_HANGING_CM = 0.635; // the hang every list export writes (export/docx.ts)

// ---- entry --------------------------------------------------------------------

// LibreOffice writes AddParaTableSpacing=false for a document it imported from Word,
// and then takes the larger of two adjoining spacings instead of adding them.
function odfSpacingModel(files: Record<string, Uint8Array>): SpacingModel {
  const xml = files['settings.xml'] ? strFromU8(files['settings.xml']) : '';
  return /AddParaTableSpacing"[^>]*>false</.test(xml) ? 'max' : 'add';
}

// The same settings file says whether the block that opens a page keeps its space above
// (AddParaTableSpacingAtStart). Absent = on, which is what LibreOffice writes by default.
function odfSpacingAtPageStart(files: Record<string, Uint8Array>): boolean {
  const xml = files['settings.xml'] ? strFromU8(files['settings.xml']) : '';
  return !/AddParaTableSpacingAtStart"[^>]*>false</.test(xml);
}

// The settings LibreOffice stores a Word 2013 document's layout in: the space above a
// paragraph's own page break goes with TabOverSpacing unless TabOverMargin is on (probed).
function odfBreakDropsSpace(files: Record<string, Uint8Array>): boolean {
  const xml = files['settings.xml'] ? strFromU8(files['settings.xml']) : '';
  return /TabOverSpacing"[^>]*>true</.test(xml) && !/TabOverMargin"[^>]*>true</.test(xml);
}

export function importOdt(bytes: Uint8Array, convertedImages: ConvertedImages = new Map()): OdtImportResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipArchive(bytes);
  } catch {
    throw new Error(en.importError.odtArchive);
  }
  const contentBytes = files['content.xml'];
  if (!contentBytes) throw new Error(en.importError.odtContentMissing);

  const contentDoc = parseXml(strFromU8(contentBytes));
  const stylesDoc = files['styles.xml'] ? parseXml(strFromU8(files['styles.xml'])) : null;
  const resolver = new StyleResolver(contentDoc, stylesDoc);
  const warnings = new Set<string>();

  const body = contentDoc.getElementsByTagNameNS(NS.office, 'text')[0];
  if (!body) throw new Error(en.importError.odtNoBody);

  const styleNames = new Map<string, string>();
  for (const [name, def] of resolver.namedParagraphStyles()) styleNames.set(name, displayStyleName(name, def.display));
  const charStyleNames = new Map<string, string>();
  for (const [name, def] of resolver.namedTextStyles()) charStyleNames.set(name, displayStyleName(name, def.display));
  // The document's page setup is the first section's: the master its leading block
  // uses, Standard where it names none. Blocks measure against their own section's text
  // width (a table's margins, an inline image's fit, the tab-stop suppression).
  const masters = masterPagesOf(Array.from(body.children), resolver);
  resolver.setDefaultMaster(masters.dominant);
  const first = resolver.hasMasterPage(masters.leading) ? masters.leading : null;
  const geo = resolver.pageGeometry(first) ?? resolver.pageGeometry();
  const contentWidthCm = contentWidthOf(geo);
  const ctx: Ctx = { resolver, styleNames, usedStyles: new Set(), charStyleNames, usedCharStyles: new Set(), usedListStyles: new Set(), listEnds: new Map(), warnings, seqRefNames: sequenceRefNames(body), files, imageCache: new Map(), convertedImages, contentWidthCm, docContentWidthCm: contentWidthCm, leftMarginCm: geo?.margins.left ?? 0, ...heightsOf(geo), pageRtl: geo?.rtl ?? false, breakDropsSpace: odfBreakDropsSpace(files), masterPages: [], leadingMaster: masters.leading ?? 'Standard', masterPageStarts: [], bodyBlocks: 0, openBookmarks: new Map(), pointBookmarks: new Set(), openComments: new Map(), commentReplies: odfCommentReplies(body), revisions: odfRevisions(body), openInsertions: new Map(), openFormats: new Map(), notes: [], foldMarks: false };
  // Whole-document columns declared on the page layout instead of a
  // text:section: the body's wrappable runs are wrapped the way a section's would be.
  const pageCols = resolver.pageColumns();
  ctx.sectionCols = pageCols;
  let blocks = convertBlocks(Array.from(body.children), ctx, 'body');
  ctx.sectionCols = null;
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });
  pairAlignedFrames(blocks, Math.floor(cmToPx(contentWidthCm)));

  if (pageCols) {
    const wrapped: Node[] = [];
    pushColumnRuns(blocks, pageCols, wrapped, ctx);
    blocks = wrapped;
  }

  // The notes the walk collected, in anchor order, as the section the editor keeps at
  // the document end. Empty when the file has none, so nothing is added.
  if (ctx.notes.length) {
    blocks.push({ type: 'noteSection', content: ctx.notes.map((n) => ({
      type: 'note',
      attrs: { id: n.id, kind: n.kind, label: n.label, text: n.text, styleName: n.styleName },
      ...(n.content.length ? { content: n.content } : {}),
    })) });
  }

  // The zones are the first section's too; a later section carries its own setup where
  // it differs (hfSetOfMasterPage), so a chapter master's is not lost either.
  const hf = resolver.masterPageHF(first);
  const geometry = geo;
  const edge = resolver.edgeDistancesCm(first);

  const fonts: EmbeddedFont[] = [];
  for (const s of resolver.embeddedFontSources()) {
    const data = files[s.href];
    if (data) fonts.push({ family: s.family, weight: s.weight, style: s.style, data });
  }

  const docLangs = resolver.documentLanguage();
  const odfLang = docLangs.main ? odfFromTag(docLangs.main) : null;
  let language: DocumentLanguage | null = null;
  if (odfLang) {
    const code = languageFromOdf(odfLang.language, odfLang.country || undefined);
    if (code) {
      language = code;
    } else {
      language = NO_LANGUAGE;
      warnings.add(WARN.noDictionary(docLangs.main!));
    }
  }

  const docNumFormat = resolver.pageNumberFormat(first);
  const zoneOf = (el: Element | null, footer = false) =>
    (el ? convertHfZone(el, ctx, geo, footer ? hf.footerBandCm : hf.headerBandCm, footer) : null);
  const headerFirst = zoneOf(hf.headerFirst);
  const footerFirst = zoneOf(hf.footerFirst, true);
  // The presence of a first-page element is the flag, even when it's empty (an empty
  // first-page zone deliberately blanks page 1 while the default fills later pages).
  const differentFirstPage = !!(hf.headerFirst || hf.footerFirst || hf.firstPageOnly);
  const differentOddEven = !!(hf.headerLeft || hf.footerLeft);
  const header = zoneOf(hf.header);
  const footer = zoneOf(hf.footer, true);
  // Odd/even is per zone in ODF: a master that gives only the footer a left variant
  // repeats its header on left pages. An element that is *there* but empty blanks it.
  const headerEven = hf.headerLeft ? zoneOf(hf.headerLeft) : differentOddEven ? header : null;
  const footerEven = hf.footerLeft ? zoneOf(hf.footerLeft, true) : differentOddEven ? footer : null;
  // A first-page/even zone reserves the band even if its default counterpart is empty.
  const hasHeader = hf.header || headerFirst || headerEven;
  const hasFooter = hf.footer || footerFirst || footerEven;

  const result: OdtImportResult = {
    content: { type: 'doc', content: blocks },
    margins: geometry?.margins ?? null,
    orientation: geometry?.orientation ?? null,
    format: geometry?.format ?? null,
    rtl: geometry?.rtl ?? false,
    decor: resolver.pageDecor(first),
    lineNumbering: resolver.lineNumbering(),
    lineGrid: resolver.lineGrid(),
    foldMarks: ctx.foldMarks,
    hyphenate: resolver.documentHyphenation(),
    recordChanges: odfRecordChanges(body),
    recordLock: odfRecordLock(files),
    pageNumbering: { format: docNumFormat, start: odfPageNumberStart(resolver, body) },
    tabIntervalCm: resolver.defaultTabInterval(),
    spacingModel: odfSpacingModel(files),
    spacingAtPageStart: odfSpacingAtPageStart(files),
    balanceSpaces: /BalanceSpacesAndIdeographicSpaces"[^>]*>true</.test(files['settings.xml'] ? strFromU8(files['settings.xml']) : ''),
    header,
    footer,
    headerFirst,
    footerFirst,
    differentFirstPage,
    headerEven,
    footerEven,
    differentOddEven,
    hfSections: [
      { header, footer, headerFirst, footerFirst, differentFirstPage, headerEven, footerEven, differentOddEven },
      ...ctx.masterPages.map((name, i) => ({ ...hfSetOfMasterPage(name, ctx, geometry, docNumFormat, edge), pageNumberStart: ctx.masterPageStarts[i] ?? null })),
    ],
    headerDistanceCm: hasHeader ? edge?.top ?? null : null,
    footerDistanceCm: hasFooter ? edge?.bottom ?? null : null,
    language,
    languageOther: docLangs.other,
    fonts,
    styles: collectStyleSheet(resolver, ctx),
    notes: resolver.noteSettings(),
    props: odfDocProperties(files),
    warnings: [...warnings],
  };
  pruneImportedMarkers(result as unknown as Parameters<typeof pruneImportedMarkers>[0]);
  return result;
}

// The zones of a named master page — what a section past the first switches to.
function hfSetOfMasterPage(
  name: string, ctx: Ctx,
  doc: { orientation: Orientation; format: PageFormat } | null,
  docNumFormat: NoteNumFormat,
  docEdge: { top: number; bottom: number } | null,
): HfSet {
  const hf = ctx.resolver.masterPageHF(name);
  // Its zones measure against the section's own page layout (`geo`, below).
  const zone = (el: Element | null, footer = false) =>
    (el ? convertHfZone(el, ctx, geo, footer ? hf.footerBandCm : hf.headerBandCm, footer) : null);
  // Odd/even is per zone: an absent left variant repeats the default one on left pages.
  const oddEven = !!(hf.headerLeft || hf.footerLeft);
  // Its page layout is the section's own geometry; where the master hands over, that
  // layout governs the first page only and the successor's the rest.
  const geo = ctx.resolver.pageGeometry(name);
  const own = geo?.margins ?? null;
  const restGeo = hf.restPage ? ctx.resolver.pageGeometry(hf.restPage) : null;
  const rest = restGeo?.margins ?? own;
  // The paper of the layout governing the section's body. Only a section disagreeing
  // with the document carries it — matching is inheritance, as it is for the margins.
  const paper = restGeo ?? geo;
  // The page-number format rides the layout governing the body, like the margins: a
  // roman front matter is one master before the decimal body's, not a document setting.
  const numFormat = ctx.resolver.pageNumberFormat(hf.restPage ?? name);
  // The layout's own margin is the edge→zone distance, and a section's zones sit on it:
  // an index whose header starts 4cm down is not the body's 1.5cm. Matching the
  // document's is inheritance, as it is for the margins.
  const distOf = (page: string | null): HfDistances | null => {
    const e = ctx.resolver.edgeDistancesCm(page);
    return e ? { header: e.top, footer: e.bottom } : null;
  };
  const sameDist = (a: HfDistances | null, b: HfDistances | null) =>
    !!a && !!b && Math.abs(a.header - b.header) < 0.01 && Math.abs(a.footer - b.footer) < 0.01;
  const docDist = docEdge ? { header: docEdge.top, footer: docEdge.bottom } : null;
  const restDist = distOf(hf.restPage ?? name);
  const firstDist = hf.restPage ? distOf(name) : null;
  return {
    distances: sameDist(restDist, docDist) ? null : restDist,
    distancesFirst: firstDist && !sameDist(firstDist, restDist) ? firstDist : null,
    margins: rest,
    marginsFirst: hf.restPage && !hf.mirrorPair ? own : null,
    // The section's own layout is what says which side it opens on, even where a
    // successor governs the pages after it.
    startsOn: ctx.resolver.pageStartSide(name),
    pageNumberFormat: numFormat !== docNumFormat ? numFormat : null,
    format: paper && doc && paper.format !== doc.format ? paper.format : null,
    orientation: paper && doc && paper.orientation !== doc.orientation ? paper.orientation : null,
    header: zone(hf.header),
    footer: zone(hf.footer, true),
    headerFirst: zone(hf.headerFirst),
    footerFirst: zone(hf.footerFirst, true),
    differentFirstPage: !!(hf.headerFirst || hf.footerFirst || hf.firstPageOnly),
    headerEven: hf.headerLeft ? zone(hf.headerLeft) : oddEven ? zone(hf.header) : null,
    footerEven: hf.footerLeft ? zone(hf.footerLeft, true) : oddEven ? zone(hf.footer, true) : null,
    differentOddEven: oddEven,
  };
}

// A header/footer zone → a zone doc, through the body's block converter at the section's
// text width. `bandCm` is the zone's own gap to the body plus its padding: space inside
// the band, so it rides the spacing of the block facing the body. The **last**
// paragraph's own margin-bottom is not part of the band — probed: a header of one 10pt
// line with a 12mm bottom margin puts the body at min-height, and a footer's is dropped
// the same way, while every margin *between* two of its paragraphs counts in full.
function convertHfZone(zoneEl: Element, ctx: Ctx, geo: Parameters<typeof contentWidthOf>[0], bandCm = 0, footer = false): HfDoc {
  const zoneCtx: Ctx = {
    ...ctx, zone: true, contentWidthCm: contentWidthOf(geo), leftMarginCm: geo?.margins.left ?? ctx.leftMarginCm, ...heightsOf(geo), foldMarks: false,
    openBookmarks: new Map(), pointBookmarks: new Set(), openComments: new Map(), openInsertions: new Map(), openFormats: new Map(), revisions: odfRevisions(zoneEl),
  };
  const blocks = convertBlocks(Array.from(zoneEl.children), zoneCtx, 'zone');
  if (zoneCtx.foldMarks) ctx.foldMarks = true;
  const zone: HfDoc = { type: 'doc', content: blocks };
  if (hfIsEmpty(zone)) return null;
  const paras = Array.from(zoneEl.children).filter((c) => c.namespaceURI === NS.text && (c.localName === 'p' || c.localName === 'h'));
  const margin = (p: Element | undefined, side: string) =>
    snapPt(lengthToPt(ctx.resolver.paraProps(p?.getAttributeNS(NS.text, 'style-name') ?? null)[`fo:margin-${side}`]) ?? 0);
  const bandPt = snapPt((bandCm / 2.54) * 72);
  const first = blocks[0];
  const last = blocks[blocks.length - 1];
  const isText = (b: Node | undefined) => b?.type === 'paragraph' || b?.type === 'heading';
  if (footer && isText(first) && bandPt) {
    first.attrs = { ...first.attrs, spaceBefore: snapPt(margin(paras[0], 'top') + bandPt) };
  }
  if (isText(last)) {
    const after = footer ? 0 : bandPt;
    if (after || margin(paras[paras.length - 1], 'bottom')) last.attrs = { ...last.attrs, spaceAfter: after };
  }
  return zone;
}

// The text width of a page setup; the ODF default page where the file declares none.
function heightsOf(geo: { margins: PageMargins; orientation: Orientation; format: PageFormat } | null): { pageHeightCm: number; textHeightCm: number } {
  const h = pageDimsCm(geo?.format ?? 'A4', geo?.orientation ?? 'portrait').h;
  return { pageHeightCm: h, textHeightCm: h - (geo ? geo.margins.top + geo.margins.bottom : 2 * 2) };
}

function contentWidthOf(geo: { margins: PageMargins; orientation: Orientation; format: PageFormat } | null): number {
  return geo
    ? pageDimsCm(geo.format, geo.orientation).w - geo.margins.left - geo.margins.right
    : pageDimsCm('A4', 'portrait').w - 2 * 2.12;
}

// The document's first page number: ODF has no document-level start, so LibreOffice puts
// `style:page-number` on the first paragraph's own style.
// One that switches master page behind a block that is no paragraph (an index, a table)
// opens the next section, whose restart it is.
function odfPageNumberStart(resolver: StyleResolver, body: Element): number {
  const first = firstParagraph(body);
  const style = first?.getAttributeNS(NS.text, 'style-name');
  const n = style ? Number(resolver.paraProps(style)['style:page-number']) : NaN;
  if (!Number.isFinite(n) || (resolver.masterPageOf(style!) && contentBefore(first!, body))) return 1;
  return clampPageStart(n);
}

// Whether a block of the body precedes `el` (the declarations ahead of the text do not).
function contentBefore(el: Element, body: Element): boolean {
  for (let node: Element | null = el; node && node !== body; node = node.parentElement) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (!(sib.namespaceURI === NS.text && /-decls$|^tracked-changes$/.test(sib.localName))
        && !(sib.namespaceURI === NS.office && sib.localName === 'forms')) return true;
    }
  }
  return false;
}

// The first paragraph in document order, wherever the body keeps it (a section, a list,
// a table) — past the tracked-changes registry, whose paragraphs are deleted text.
function firstParagraph(el: Element): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.namespaceURI === NS.text && child.localName === 'tracked-changes') continue;
    if (child.namespaceURI === NS.text && (child.localName === 'p' || child.localName === 'h')) return child;
    const inner = firstParagraph(child);
    if (inner) return inner;
  }
  return null;
}

// meta.xml → the document's descriptive properties (LibreOffice's File ▸ Properties).
function odfDocProperties(files: Record<string, Uint8Array>): DocProperties {
  const bytes = files['meta.xml'];
  if (!bytes) return { ...EMPTY_DOC_PROPERTIES };
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return { ...EMPTY_DOC_PROPERTIES }; }
  const text = (ns: string, name: string) =>
    doc.getElementsByTagNameNS(ns, name)[0]?.textContent?.trim() ?? '';
  return {
    title: text(NS.dc, 'title'),
    subject: text(NS.dc, 'subject'),
    // dc:creator is who saved it last, meta:initial-creator who started it.
    author: text(NS.dc, 'creator') || text(NS.meta, 'initial-creator'),
    keywords: Array.from(doc.getElementsByTagNameNS(NS.meta, 'keyword'))
      .map(k => k.textContent?.trim() ?? '').filter(Boolean).join(', '),
    description: text(NS.dc, 'description'),
  };
}

function parseXml(xml: string): Document {
  return parseImportXml(xml, 'odt');
}

// ---- block conversion -----------------------------------------------------------

// Block types a columns section (columns.ts) can contain.
const COLUMNS_ALLOWED = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'table']);

// Wrap a multi-column region's converted blocks into columns nodes: maximal runs of
// allowed types become one node each; anything else is emitted between the runs at
// top level — with a warning, except columns nodes (they keep their own layout).
function pushColumnRuns(inner: Node[], cols: { count: number; gapCm: number }, out: Node[], ctx: Ctx): void {
  let count = cols.count;
  if (count > 3) {
    ctx.warnings.add(WARN.columnsReduced);
    count = 3;
  }
  let run: Node[] = [];
  const flush = () => {
    if (run.length) out.push({ type: 'columns', attrs: { count, gapCm: cols.gapCm }, content: run });
    run = [];
  };
  for (const block of inner) {
    if (COLUMNS_ALLOWED.has(block.type)) {
      run.push(block);
    } else if (block.type === 'tableOfContents') {
      // An index flows through the section's columns on its own.
      flush();
      const a = block.attrs ?? {};
      block.attrs = { ...a, columns: a.columns ?? count, columnGapCm: a.columnGapCm ?? cols.gapCm };
      out.push(block);
    } else {
      if (block.type !== 'columns') {
        ctx.warnings.add(WARN.movedOutOfColumns);
      }
      flush();
      out.push(block);
    }
  }
  flush();
}

// A style that hides its paragraph takes the line with it, not just the text. A hidden
// *heading* stays: it is the document's outline, which the running head's chapter field
// reads — an ODF chapter marker exists for nothing else, and dropping it blanks the head.
function hiddenParagraph(el: Element, ctx: Ctx): boolean {
  if (el.localName !== 'p') return false;
  if (ctx.resolver.paraTextProps(el.getAttributeNS(NS.text, 'style-name'))['text:display'] !== 'none') return false;
  ctx.warnings.add(WARN.hiddenText);
  return true;
}

const blocksOf = ({ parts, ...node }: Node): Node[] => parts ?? [node];

function convertBlocks(elements: Element[], ctx: Ctx, kind: BlockKind, boldByDefault = false): Node[] {
  const out: Node[] = [];

  // A page-anchored frame is out of the text flow: it rides a paragraph of its own,
  // which collapses to nothing (editor.css). In a cell there is no page corner to place
  // it from, so it stays the ordinary floating frame the wrap rules made of it.
  const hoistPageFrames = (block: Node | null): Node | null => {
    const frames = (block?.content ?? []).filter(n => n.type === 'image' && n.attrs?.anchorPage);
    if (!block || !frames.length) return block;
    if (kind !== 'body') {
      for (const f of frames) delete f.attrs!.anchorPage;
      return block;
    }
    block.content = block.content!.filter(n => !frames.includes(n));
    for (const f of frames) out.push({ type: 'paragraph', content: [f] });
    return block;
  };

  for (const el of elements) {
    if (el.namespaceURI === NS.text) {
      if (el.localName === 'p' || el.localName === 'h') {
        if (hiddenParagraph(el, ctx)) continue;
        for (const part of blocksOf(convertParaLike(el, ctx, kind, boldByDefault))) {
          const block = hoistPageFrames(part);
          if (block) out.push(block);
        }
      } else if (el.localName === 'list') {
        // Chapter numbering wrapping only headings is no real list — unwrap it to plain
        // headings instead of empty nested list levels.
        const headingEls = kind === 'body' ? outlineHeadingEls(el, ctx.resolver) : null;
        if (headingEls) {
          for (const h of headingEls) out.push(...blocksOf(convertParaLike(h, ctx, 'body')));
        } else {
          const list = convertList(el, ctx, null, 1, false, ROOT_ORDERED_CYCLE, !isChapterList(el, ctx.resolver));
          for (const part of list ? liftListTables(list, true) : []) out.push(part.type === 'table' ? part : keepContinuation(out, part));
        }
      } else if (el.localName === 'section') {
        const cols = ctx.resolver.sectionColumns(el.getAttributeNS(NS.text, 'style-name'));
        const outerCols = ctx.sectionCols;
        if (kind === 'body' && cols) ctx.sectionCols = cols;
        let inner: Node[];
        try { inner = convertBlocks(Array.from(el.children), ctx, kind, boldByDefault); } finally { ctx.sectionCols = outerCols; }
        if (kind === 'body' && cols) pushColumnRuns(inner, cols, out, ctx);
        else out.push(...inner);
      } else if (ODF_INDEX_KIND[el.localName] && kind === 'body') {
        // A generated contents / list of figures / list of tables → a tableOfContents
        // node of that family (regenerated live).
        out.push(convertToc(el, ctx, ODF_INDEX_KIND[el.localName]!));
      } else if (/-index$|^table-of-content$|^bibliography$/.test(el.localName)) {
        // Other generated indexes (bibliography, …) or a TOC nested in a cell: keep the
        // rendered text from index-body.
        const indexBody = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
        if (indexBody) out.push(...convertBlocks(Array.from(indexBody.children), ctx, kind, boldByDefault));
      }
      // tracked-changes registry, decls, soft-page-break, … → no visual content
    } else if (el.namespaceURI === NS.table && el.localName === 'table') {
      if (kind === 'cell' && ctx.cellWidthCm != null) {
        const outerCm = ctx.contentWidthCm;
        ctx.contentWidthCm = ctx.cellWidthCm;
        try {
          const table = convertTable(el, ctx);
          if (table) out.push(table);
        } finally { ctx.contentWidthCm = outerCm; }
      } else if (kind === 'body' || kind === 'zone') {
        // Before the conversion: a section the table opens may have a text width of its
        // own, which is what its columns are measured against.
        const flow = tableSectionFlow(el, ctx);
        // A table in a columns section fills its column, so it is measured against one.
        const cols = kind === 'body' ? ctx.sectionCols : null;
        const outerCm = ctx.contentWidthCm;
        if (cols) ctx.contentWidthCm = (outerCm - cols.gapCm * (cols.count - 1)) / cols.count;
        let table: Node | null;
        try { table = convertTable(el, ctx); } finally { ctx.contentWidthCm = outerCm; }
        if (table) {
          if (flow) table.attrs = { ...(table.attrs ?? {}), ...flow };
          out.push(table);
        }
      }
    } else if (el.namespaceURI === NS.draw) {
      const conv = convertDrawElement(el, ctx);
      // A frame at block level (rare — ODF allows one straight under office:text)
      // → wrapped in a paragraph, which is where an inline node has to live.
      const frames = conv?.group ?? [conv?.inline ?? conv?.block].filter((n): n is Node => !!n);
      if (frames.length) out.push({ type: 'paragraph', content: frames });
    }
  }
  // A block's own "break after" becomes the next block's break before — the same page
  // break, and the only one the editor stores. A trailing one has nothing left to break,
  // and only a paragraph, heading or table carries the attr (pageBreak.ts).
  for (let i = 0; i < out.length; i++) {
    if (out[i].attrs?.breakAfter !== 'page') continue;
    delete out[i].attrs!.breakAfter;
    const next = out[i + 1];
    if (next && (next.type === 'paragraph' || next.type === 'heading' || next.type === 'table')) {
      next.attrs = { ...next.attrs, breakBefore: 'page' };
    }
  }
  return out;
}

// A <text:table-of-content> → a tableOfContents node. Its entries (text + level + page)
// are the cached index-body, shown as saved until the index is updated.
const ODF_INDEX_KIND: Record<string, IndexKind | undefined> = {
  'table-of-content': 'toc', 'illustration-index': 'figures', 'table-index': 'tables',
  'alphabetical-index': 'alphabetical', 'bibliography': 'bibliography',
};

// A <text:bibliography-mark> → a citation. Its non-empty text: attributes other than the
// identifier and the type are the source's fields, whatever the file happens to name.
// LibreOffice's DOCX reader leaves a Word CITATION field's code as the identifier and its
// result as the title: the tag is the source's name, and the result no field of it.
function bibEntryFromMark(el: Element): Node | null {
  const raw = (el.getAttributeNS(NS.text, 'identifier') ?? '').trim();
  const code = /^CITATION\s+("[^"]+"|\S+)/i.exec(raw);
  const identifier = code ? code[1].replace(/^"|"$/g, '').trim() : raw;
  if (!identifier) return null;
  const fields: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) {
    if (a.namespaceURI !== NS.text || a.localName === 'identifier' || a.localName === 'bibliography-type') continue;
    if (code && a.value.trim() === (el.textContent ?? '').trim()) continue;
    if (a.value.trim()) fields[a.localName] = a.value;
  }
  const type = el.getAttributeNS(NS.text, 'bibliography-type') ?? '';
  return {
    type: 'bibliographyEntry',
    attrs: { identifier, type: isBibType(type) ? type : 'misc', fields, text: el.textContent ?? '' },
  };
}

function convertToc(el: Element, ctx: Ctx, indexKind: IndexKind): Node {
  // Before the rest: a section the index opens may have a text width of its own, which
  // is what the entries' tab stop is measured against.
  const flow = indexSectionFlow(el, ctx);
  // The file's own heading ("Inhalt", "Sommaire", …), so a reopened index keeps its name.
  // No <text:index-title> means the index really has none — its heading is an ordinary
  // paragraph above it, and adding ours would double it.
  const title = el.getElementsByTagNameNS(NS.text, 'index-title')[0]?.textContent?.trim() ?? '';
  const family = el.localName;
  const source = el.getElementsByTagNameNS(NS.text, `${family}-source`)[0];
  const depth = Number(source?.getAttributeNS(NS.text, 'outline-level'));
  const maxLevel = depth >= 1 ? Math.min(MAX_HEADING_LEVEL, depth) : MAX_HEADING_LEVEL;
  // The fill between an entry and its page number. A template that declares the stop but
  // no leader-char means the gap really is empty (Word's TOC \p " " does the same); only
  // an index with no template at all falls back to dots.
  const stop = source?.getElementsByTagNameNS(NS.style, 'index-entry-tab-stop')[0]
    ?? source?.getElementsByTagNameNS(NS.text, 'index-entry-tab-stop')[0];
  const leader = source ? normalizeLeader(stop?.getAttributeNS(NS.style, 'leader-char')) : '.';
  // Where the page number ends: the entry template's own stop, else the right stop of
  // the paragraph style its entries use. Word and LibreOffice both put it short of the
  // text width in some templates, and the number then hangs 45mm out of place.
  const templates = Array.from(source?.getElementsByTagNameNS(NS.text, `${family}-entry-template`) ?? []);
  // LibreOffice opens an alphabetical index with its separator template (the letter
  // rows), which names no page number; the first entry level says whether the rows do.
  const template = templates.find((t) => t.getAttributeNS(NS.text, 'outline-level') !== 'separator') ?? templates[0];
  const styled = ctx.resolver.tabStops(template?.getAttributeNS(NS.text, 'style-name') ?? null);
  let tabPosCm = lengthToCm(stop?.getAttributeNS(NS.style, 'position'))
    ?? [...styled].reverse().find(t => t.align === 'right')?.pos ?? null;
  // A stop at the column's end is the attr's own default (null = the text width).
  // ponytail: the entry styles are one set per document, so an index in a section of other
  // margins carries the document's stop; per-index entry styles would name its own.
  const atEnd = (w: number) => tabPosCm != null && Math.abs(tabPosCm - w) < 0.05;
  if (atEnd(ctx.contentWidthCm) || atEnd(ctx.docContentWidthCm)) tabPosCm = null;
  // Each level's own paragraph style: the entry rows carry its name, so the document
  // stylesheet gives them the file's indent, spacing and font instead of our defaults.
  const levelStyles: (string | null)[] = [];
  for (const tpl of templates) {
    // A caption index has one level and declares no text:outline-level.
    const level = Number(tpl.getAttributeNS(NS.text, 'outline-level')) || 1;
    const named = ctx.resolver.namedAncestor(tpl.getAttributeNS(NS.text, 'style-name'));
    if (!(level >= 1) || !named) continue;
    const display = ctx.styleNames.get(named) ?? named;
    // An entry template resolving to the default style names no style of its own.
    if (display === DEFAULT_STYLE) continue;
    ctx.usedStyles.add(named);
    levelStyles[level - 1] = display;
  }
  // The attr defaults stay implicit, as everywhere else: '.' is the leader a fresh index
  // has, and a null stop is the end of the column. `leader: null` is not the default — it
  // is an index whose rows deliberately have no fill.
  const attrs: Record<string, unknown> = { entries: null, title, maxLevel, index: indexKind, ...flow,
    ...(leader === '.' ? {} : { leader }), ...(tabPosCm != null ? { tabPosCm } : {}) };
  // A template that names no page number is an index of text alone (Word's TOC \n). A
  // bibliography row never has one, so its own template says nothing about this.
  if (indexKind !== 'bibliography' && template
    && !template.getElementsByTagNameNS(NS.text, 'index-entry-page-number')[0]) {
    attrs.pageNumbers = false;
  }
  if (levelStyles.some(Boolean)) attrs.levelStyles = Array.from(levelStyles, (s) => s ?? null);
  // The index's own section style may lay its rows out in columns.
  const cols = ctx.resolver.sectionColumns(el.getAttributeNS(NS.text, 'style-name'));
  if (cols) Object.assign(attrs, { columns: Math.min(3, cols.count), columnGapCm: cols.gapCm });
  // A bibliography's citation style is its entry template: the fields it names, in order.
  // A numbered index says so on the source instead, whatever its template reads.
  if (indexKind === 'bibliography') {
    // One template per source type, and LibreOffice fills the types the document does
    // not cite with its own default — which is the "key" shape. So the document's style
    // is the first template that reads as anything else.
    const styles = templates.map((tpl) => citationStyleFromTemplate(
      Array.from(tpl.getElementsByTagNameNS(NS.text, 'index-entry-bibliography'))
        .map((f) => f.getAttributeNS(NS.text, 'bibliography-data-field') ?? '')));
    // Every citation showing a bare [n] is a numbered style a Word file cached, which
    // LibreOffice's DOCX reader passes on as text alone.
    const marks = Array.from(el.ownerDocument.getElementsByTagNameNS(NS.text, 'bibliography-mark'));
    const cachedNumbers = marks.length > 0 && marks.every((m) => /^\s*\[\d+\]\s*$/.test(m.textContent ?? ''));
    attrs.citationStyle = ctx.resolver.bibliographyNumbered() || source?.getAttributeNS(NS.text, 'numbered-entries') === 'true'
      ? 'numbered'
      : styles.find((st) => st && st !== 'key') ?? (cachedNumbers ? 'numbered' : 'key');
  }
  const pages = attrs.pageNumbers !== false && indexKind !== 'bibliography';
  const entries: TocEntry[] = [];
  const indexBody = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
  // Rows whose styles name no level (a converted file's own) take it from how far in they
  // sit, as they are drawn: the least indented is level 1.
  const indentOf = (style: string) => lengthToCm(ctx.resolver.paraProps(style)['fo:margin-left']) ?? 0;
  const indentRanks = new Map([...new Set(Array.from(indexBody?.children ?? [])
    .filter((p) => p.localName === 'p').map((p) => indentOf(p.getAttributeNS(NS.text, 'style-name') ?? '')))]
    .sort((a, b) => a - b).map((cm, i) => [cm, Math.min(MAX_HEADING_LEVEL, i + 1)]));
  for (const p of Array.from(indexBody?.children ?? [])) {
    // A bibliography converted from a Word table holds one source per row.
    if (p.namespaceURI === NS.table && p.localName === 'table') {
      for (const tr of Array.from(p.getElementsByTagNameNS(NS.table, 'table-row'))) {
        const text = Array.from(tr.getElementsByTagNameNS(NS.text, 'p'))
          .map((q) => tocEntryTextAndPage(q, false).text).filter(Boolean).join(' ');
        if (text) entries.push({ text, level: 1, page: 1 });
      }
      continue;
    }
    if (p.namespaceURI !== NS.text || p.localName !== 'p') continue; // skip index-title
    // The rows name automatic styles derived from the level's own (Contents 2, …).
    const style = p.getAttributeNS(NS.text, 'style-name') ?? '';
    const levelOf = (name: string | null) => /(?:_20_| )(\d+)$/.exec(name ?? '');
    const m = levelOf(style) ?? levelOf(ctx.resolver.namedAncestor(style));
    const level = m ? Math.min(MAX_HEADING_LEVEL, Math.max(1, parseInt(m[1], 10)))
      : indentRanks.get(indentOf(style)) ?? 1;
    const { text, page } = tocEntryTextAndPage(p, pages);
    const nums = page.split(/[,;]/).map((n) => parseInt(n, 10)).filter((n) => n > 0);
    if (!text) continue;
    // A letter row (its own separator style) is no entry; a term heading its subentries
    // has a level style and lists no page.
    if (indexKind === 'alphabetical' && pages && !nums.length) {
      if (m) entries.push({ text, level, page: 1, pages: [] });
      continue;
    }
    entries.push({ text, level, page: nums[0] ?? 1, ...(nums.length > 1 ? { pages: nums } : {}) });
  }
  // A body with nothing in it was never generated, and LibreOffice fills it on load
  // (probed); one holding an empty paragraph stays empty there.
  attrs.entries = indexBody && !indexBody.children.length ? null : entries;
  return { type: 'tableOfContents', attrs };
}

// A cached row: its text up to the last tab (earlier tabs read as spaces), the page
// number after it — or, for an index without page numbers, the whole row as text.
function tocEntryTextAndPage(p: Element, pages: boolean): { text: string; page: string } {
  const tabs = p.getElementsByTagNameNS(NS.text, 'tab');
  const lastTab = pages && tabs.length ? tabs[tabs.length - 1] : null;
  let before = '';
  let after = '';
  let past = false;
  const walk = (el: Element) => {
    for (const c of Array.from(el.childNodes)) {
      if (c === lastTab) { past = true; continue; }
      const e = c.nodeType === 1 ? (c as Element) : null;
      if (e && !(e.namespaceURI === NS.text && (e.localName === 'tab' || e.localName === 's'))) { walk(e); continue; }
      const txt = e ? (e.localName === 'tab' ? '\t' : ' ') : c.nodeValue ?? '';
      if (past) after += txt; else before += txt;
    }
  };
  walk(p);
  // A tab inside the text stays one: it sets the title at the level's hanging indent.
  const text = before.replace(/[^\S\t]+/g, ' ').replace(/ ?\t[\t ]*/g, '\t').trim();
  return { text, page: after.trim() };
}

// What a block's named style already gives it — the yardstick for "is this direct
// formatting?". Without a style in the file, the editor's own defaults stand in.
type BlockDefaults = {
  fontSizePt: number;
  marginTopPt: number;
  marginBottomPt: number;
  indentPt: number;
  // The named style's line spacing as an ODF factor; a block declaring the same one adds
  // nothing, but a block that declares 100% under a 115% style is direct formatting.
  lineHeight: string;
  // The style's own alignment and flow flags (Title centres, Heading keeps with next).
  textAlign: string | null;
  keepNext: boolean;
  keepLines: boolean;
  boldByDefault: boolean;
  fonts: Set<string>;
  // The asian fonts the block already renders its CJK text in.
  asianFonts: Set<string>;
  color: string;
  // Marks the style already provides. A run that opts *out* of one can't be expressed
  // (only bold has fontWeight:'normal'), so it keeps the style's rendering.
  // ponytail: per-mark "off" overrides need mark attrs like fontWeight's; add if files need it.
  italic: boolean;
  // The line the style draws (lineSig), null where it draws none.
  underline: string | null;
  strike: string | null;
  caps: CapsMode | null;
  // The languages in force for the block's runs — its own, else the document's.
  lang: string | null;
  langAsian: string | null;
  // The style's own paragraph background and rule lines (paraBoxAttrs).
  box: Record<string, string>;
};


// Metric twins: the on-screen font and the name we declare in files mean the same thing.
const FONT_TWINS: Record<string, string[]> = {
  'times new roman': ['liberation serif'],
  'liberation serif': ['times new roman'],
  arial: ['liberation sans'],
  'liberation sans': ['arial'],
};

// The set plus the family and its metric twin, lower-cased as the sets compare.
function withFont(set: Set<string>, family: string | null | undefined): Set<string> {
  const out = new Set(set);
  const f = family?.toLowerCase();
  if (f) {
    out.add(f);
    for (const twin of FONT_TWINS[f] ?? []) out.add(twin);
  }
  return out;
}

// fo:line-height as the model spells it: a factor ('1.5') for a percentage, a fixed
// height ('28pt') for a length; null for `normal` or anything unreadable.
function lineSpacing(lh: string | undefined): string | null {
  if (!lh || lh === 'normal') return null;
  if (lh.endsWith('%')) {
    const p = parseFloat(lh);
    return Number.isFinite(p) ? String(Math.round(p) / 100) : null;
  }
  const pt = lengthToPt(lh);
  return pt != null && pt > 0 ? `${snapPt(pt)}pt` : null;
}

// fo:text-align → the editor's four values (start/end read as an LTR page), or null.
function odfTextAlign(ta: string | undefined): string | null {
  if (ta === 'center' || ta === 'justify') return ta;
  if (ta === 'right' || ta === 'end') return 'right';
  if (ta === 'left' || ta === 'start') return 'left';
  return null;
}

function blockDefaults(resolver: StyleResolver, named: string | null, headingLevel: number | null, boldByDefault: boolean): BlockDefaults {
  const hdef = headingLevel != null ? HEADING_DEFAULTS[headingLevel - 1] : null;
  const doc = resolver.documentLanguage();
  const docLang = doc.main;
  const fallback: BlockDefaults = {
    fontSizePt: hdef ? hdef.fontSizePt : BODY_FONT_SIZE_PT,
    marginTopPt: hdef ? hdef.marginTopPt : 0,
    marginBottomPt: hdef ? hdef.marginBottomPt : 0,
    indentPt: 0,
    lineHeight: '1',
    textAlign: null,
    keepNext: false,
    keepLines: false,
    // A heading is bold by default only where the registry keeps the bold built-in: a
    // file that declares its own heading style re-parents it, so bold is formatting.
    boldByDefault: (headingLevel != null && !resolver.styleParent(named)) || boldByDefault,
    fonts: new Set(headingLevel != null ? DEFAULT_HEADING_FONTS : DEFAULT_FONTS),
    // The file's default asian font, and an East Asian document's Han default besides.
    asianFonts: withFont(withFont(DEFAULT_FONTS, resolver.asianFontOf(resolver.paraTextProps(null))), docLang && cjkDocFont(docLang)),
    color: '#000000',
    italic: hdef ? hdef.italic : false,
    underline: null,
    strike: null,
    caps: null,
    lang: doc.west,
    langAsian: doc.asian,
    box: {},
  };
  if (!named) return fallback;
  const para = resolver.paraProps(named);
  const text = resolver.paraTextProps(named);
  const fonts = withFont(fallback.fonts, resolver.fontFamilyOf(text));
  const asianFonts = withFont(fallback.asianFonts, resolver.asianFontOf(text));
  const weight = text['fo:font-weight'];
  const fontStyle = text['fo:font-style'];
  const langs = langTagsOfProps(text);
  return {
    fontSizePt: lengthToPt(text['fo:font-size']) ?? fallback.fontSizePt,
    marginTopPt: lengthToPt(para['fo:margin-top']) ?? 0,
    marginBottomPt: lengthToPt(para['fo:margin-bottom']) ?? 0,
    indentPt: lengthToPt(para['fo:margin-left']) ?? 0,
    lineHeight: lineSpacing(para['fo:line-height']) ?? '1',
    textAlign: odfTextAlign(para['fo:text-align']),
    keepNext: para['fo:keep-with-next'] === 'always',
    keepLines: para['fo:keep-together'] === 'always',
    boldByDefault: weight ? weight === 'bold' || parseInt(weight, 10) >= 600 : fallback.boldByDefault,
    fonts,
    asianFonts,
    color: (text['fo:color'] && normalizeColor(text['fo:color'])) || fallback.color,
    italic: fontStyle === 'italic' || fontStyle === 'oblique',
    underline: lineSig(text, 'underline'),
    strike: lineSig(text, 'line-through'),
    caps: capsFromOdf(text),
    lang: langs.west ?? doc.west,
    langAsian: langs.asian ?? doc.asian,
    box: paraBoxAttrs(para),
  };
}

// A style:display-name (when present) is authoritative; else the name's _hex_ escapes
// (LibreOffice's encoding of what an NCName cannot hold, "_20_" for a space) decode.
function displayStyleName(odfName: string, display?: string): string {
  return display || decodeStyleName(odfName);
}

export function decodeStyleName(odfName: string): string {
  return odfName.replace(/_([0-9a-fA-F]{2,6})_/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

function paraPropsFromOdf(props: PropMap): ParaProps {
  const out: ParaProps = {};
  const ta = props['fo:text-align'];
  if (ta === 'center' || ta === 'justify') out.textAlign = ta;
  else if (ta === 'right' || ta === 'end') out.textAlign = 'right';
  else if (ta === 'left' || ta === 'start') out.textAlign = 'left';
  const mt = lengthToPt(props['fo:margin-top']);
  const mb = lengthToPt(props['fo:margin-bottom']);
  const ml = lengthToCm(props['fo:margin-left']);
  if (mt != null) out.spaceBefore = snapPt(mt);
  if (mb != null) out.spaceAfter = snapPt(mb);
  if (ml != null) out.indent = Math.round(ml * 100) / 100;
  const ti = lengthToCm(props['fo:text-indent']);
  if (ti != null) out.indentFirst = Math.round(ti * 100) / 100;
  // The ODF percentage itself, or a fixed height, as everywhere else in the model
  // (blockAttrs, both DOCX paths, and the export, which writes either straight back).
  const lh = lineSpacing(props['fo:line-height']);
  if (lh) out.lineHeight = lh;
  const bg = props['fo:background-color'];
  if (bg && bg !== 'transparent') out.backgroundColor = normalizeColor(bg) ?? undefined;
  let pad: number | null = null;
  for (const [key, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const v = props[`fo:border-${side}`] ?? props['fo:border'];
    if (!v || v === 'none') continue;
    out[key] = borderAttrFromOdf(v) ?? undefined;
    const p = lengthToPt(props[`fo:padding-${side}`] ?? props['fo:padding']);
    if (p) pad = Math.max(pad ?? 0, p);
  }
  if (pad) out.borderPadding = snapPt(pad);
  return out;
}

function textPropsFromOdf(props: PropMap, resolver: StyleResolver): TextProps {
  const out: TextProps = {};
  const family = resolver.fontFamilyOf(props);
  // Our own export declares the metric twin; keep the registry on the on-screen name
  // so an export→import loop doesn't drift.
  if (family) out.fontFamily = screenFontName(family);
  const asian = resolver.asianFontOf(props);
  if (asian) out.fontFamilyAsian = screenFontName(asian);
  const size = lengthToPt(props['fo:font-size']);
  if (size != null) out.fontSizePt = Math.round(size * 10) / 10;
  const spacing = lengthToPt(props['fo:letter-spacing']);
  if (spacing) out.letterSpacingPt = Math.round(spacing * 100) / 100;
  // Kerning is on unless the file says otherwise (probed), which is the browser default
  // too — but a style under one that turns it off has to say so to get it back.
  const kerning = props['style:letter-kerning'];
  if (kerning) out.kerning = kerning !== 'false';
  const weight = props['fo:font-weight'];
  if (weight) out.bold = weight === 'bold' || parseInt(weight, 10) >= 600;
  const style = props['fo:font-style'];
  if (style) out.italic = style === 'italic' || style === 'oblique';
  const ul = props['style:text-underline-style'];
  if (ul) out.underline = ul !== 'none';
  const lt = props['style:text-line-through-style'];
  if (lt) out.strike = lt !== 'none';
  const color = props['fo:color'] ? normalizeColor(props['fo:color']) : undefined;
  if (color) out.color = color;
  const caps = capsFromOdf(props);
  if (caps) out.caps = caps;
  return out;
}

// What a style declares itself: its resolved props minus the parent's.
function ownProps<T extends object>(resolved: T, parent: T): T {
  const out = {} as T;
  for (const key of Object.keys(resolved) as (keyof T)[]) {
    if (resolved[key] !== undefined && resolved[key] !== parent[key]) out[key] = resolved[key];
  }
  return out;
}

// The default style's asian font is a default where it is the western one (a file that
// names a single font) or an East Asian document's Han default — both what an export
// writes back unasked.
export function dropDefaultAsianFont(text: TextProps, docTag: string | null | undefined): void {
  const cjk = docTag ? cjkDocFont(docTag) : null;
  if (text.fontFamilyAsian && (text.fontFamilyAsian === (text.fontFamily ?? 'Liberation Serif') || text.fontFamilyAsian === cjk)) {
    delete text.fontFamilyAsian;
  }
}

// The document's style registry: the editor's built-ins, with the file's own definitions
// merged over them — only the styles blocks actually reference, plus their parent chains.
function collectStyleSheet(resolver: StyleResolver, ctx: Ctx): StyleSheet {
  const defs = resolver.namedParagraphStyles();
  const sheet = builtinStyleSheet();
  const keep = new Set<string>();
  for (const name of ctx.usedStyles) {
    let cur: string | null = name;
    const seen = new Set<string>();
    while (cur && defs.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      keep.add(cur);
      cur = defs.get(cur)!.parent;
    }
  }
  for (const odfName of keep) {
    const def = defs.get(odfName)!;
    const name = displayStyleName(odfName, def.display);
    const parent = def.parent ? displayStyleName(def.parent, defs.get(def.parent)?.display) : null;
    const builtin = sheet.paragraph[name];
    // Own props = resolved minus the parent's resolved values. Going through the
    // resolver keeps relative sizes ("130%") and values a file repeats from its parent
    // from landing here raw.
    const style: Style = {
      name,
      parent: parent && parent !== name ? parent : builtin?.parent ?? null,
      next: def.next ? displayStyleName(def.next, defs.get(def.next)?.display) : builtin?.next ?? null,
      builtin: builtin?.builtin,
      para: ownProps(paraPropsFromOdf(resolver.paraProps(odfName)), paraPropsFromOdf(def.parent ? resolver.paraProps(def.parent) : {})),
      text: ownProps(textPropsFromOdf(resolver.paraTextProps(odfName), resolver), textPropsFromOdf(def.parent ? resolver.paraTextProps(def.parent) : {}, resolver)),
    };
    const level = /^Heading (\d+)$/.exec(name);
    if (level) style.outlineLevel = Number(level[1]);
    if (name === DEFAULT_STYLE) {
      dropDefaultAsianFont(style.text, resolver.documentLanguage().main);
    }
    sheet.paragraph[name] = style;
  }
  // A chapter number's character style is named by the outline definition, not by any
  // run, so the walk never sees it — and the export would reference a style it dropped.
  for (const level of Array.from(resolver.outlineStyle()?.children ?? [])) {
    const named = level.getAttributeNS(NS.text, 'style-name');
    if (named) ctx.usedCharStyles.add(named);
  }
  for (const odfName of ctx.usedCharStyles) {
    const name = ctx.charStyleNames.get(odfName) ?? odfName;
    const builtin = sheet.character[name];
    sheet.character[name] = {
      name, parent: null, next: null, builtin: builtin?.builtin,
      para: {}, text: textPropsFromOdf(resolver.spanTextProps(odfName), resolver),
    };
  }
  for (const odfName of ctx.usedListStyles) {
    const el = resolver.listStyle(odfName);
    if (!el) continue;
    const name = displayStyleName(odfName, resolver.listStyleDisplayName(odfName));
    sheet.list[name] = listStyleFromOdf(name, el, sheet.list[name]?.builtin);
  }
  sheet.outline = outlineFromOdf(resolver.outlineStyle(), ctx);
  return sheet;
}

// <text:outline-style> → the chapter-numbering definition, level 1 first. A level the
// file leaves out is unnumbered, which is how both products switch one off.
function outlineFromOdf(el: Element | null, ctx: Ctx): OutlineNumbering | null {
  if (!el) return null;
  const out: OutlineNumbering = [];
  let numbered = false;
  for (let level = 1; level <= MAX_OUTLINE_LEVELS; level++) {
    const def = Array.from(el.children).find(
      (c) => c.localName === 'outline-level-style' && c.getAttributeNS(NS.text, 'level') === String(level));
    const format = def ? knownNumFormat(odfNumFormatOf(def)) : null;
    if (!def || !format) {
      out.push({ ...DEFAULT_OUTLINE_LEVEL });
      continue;
    }
    numbered = true;
    const charStyle = def.getAttributeNS(NS.text, 'style-name');
    const name = charStyle ? ctx.charStyleNames.get(charStyle) ?? charStyle : null;
    const labelText = charStyle ? textPropsFromOdf(ctx.resolver.spanTextProps(charStyle), ctx.resolver) : null;
    const geometry = outlineLevelGeometry(def);
    out.push({
      format,
      prefix: def.getAttributeNS(NS.style, 'num-prefix') ?? '',
      suffix: (def.getAttributeNS(NS.style, 'num-suffix') ?? '') + geometry.pad,
      displayLevels: Math.max(1, parseInt(def.getAttributeNS(NS.text, 'display-levels') ?? '1', 10) || 1),
      start: Math.max(0, parseInt(def.getAttributeNS(NS.text, 'start-value') ?? '1', 10) || 1),
      ...(name ? { charStyle: name } : {}),
      ...(labelText && Object.keys(labelText).length ? { labelText } : {}),
      ...geometry.pos,
    });
  }
  // Trailing unnumbered levels carry nothing — a definition ends at its last number.
  while (out.length && out[out.length - 1].format === 'none') out.pop();
  return numbered ? out : null;
}

// Where a level puts its label: the newer label-alignment mode, else the positional one
// (text:space-before + text:min-label-width). A label followed by a space carries it in
// its suffix, since only a tab has a stop to run to.
function outlineLevelGeometry(def: Element): { pos: Partial<OutlineLevel>; pad: string } {
  const props = def.getElementsByTagNameNS(NS.style, 'list-level-properties')[0] ?? null;
  const align = props?.getElementsByTagNameNS(NS.style, 'list-level-label-alignment')[0] ?? null;
  const pos: Partial<OutlineLevel> = {};
  let pad = '';
  const cm = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  if (align) {
    const indent = cm(lengthToCm(align.getAttributeNS(NS.fo, 'margin-left'))) ?? 0;
    const first = cm(lengthToCm(align.getAttributeNS(NS.fo, 'text-indent'))) ?? 0;
    const followedBy = align.getAttributeNS(NS.text, 'label-followed-by') ?? 'listtab';
    if (indent) pos.indentCm = indent;
    if (first) pos.firstIndentCm = first;
    if (followedBy === 'listtab') {
      pos.tabCm = cm(lengthToCm(align.getAttributeNS(NS.text, 'list-tab-stop-position'))) ?? indent;
    } else if (followedBy === 'space') pad = ' ';
  } else if (props) {
    const before = cm(lengthToCm(props.getAttributeNS(NS.text, 'space-before'))) ?? 0;
    const width = cm(lengthToCm(props.getAttributeNS(NS.text, 'min-label-width'))) ?? 0;
    if (before || width) {
      pos.indentCm = Math.round((before + width) * 1000) / 1000;
      pos.firstIndentCm = -width;
      pos.tabCm = pos.indentCm;
    }
  }
  return { pos, pad };
}

// A named <text:list-style> element → the registry's shape. Each level's indentCm is
// its margin step past the level above minus the 1.27cm base (the export's inverse).
function listStyleFromOdf(name: string, el: Element, builtin?: boolean): ListStyle {
  const levels: ListLevelStyle[] = [];
  let multilevel = false;
  let prevMargin = 0;
  for (let d = 1; d <= MAX_LIST_LEVELS; d++) {
    const def = listLevelDef(el, d);
    if (!def) break;
    const ordered = def.localName === 'list-level-style-number';
    const level: ListLevelStyle = { kind: ordered ? 'number' : 'bullet' };
    const margin = listLevelMarginLeftCm(def) ?? prevMargin + LIST_LEVEL_STEP_CM;
    const extra = Math.round((margin - prevMargin - LIST_LEVEL_STEP_CM) * 100) / 100;
    if (extra) level.indentCm = extra;
    prevMargin = margin;
    if (listLevelRightAligned(def)) level.markerAlign = 'right';
    if (ordered) {
      if (parseInt(def.getAttributeNS(NS.text, 'display-levels') ?? '1', 10) > 1) multilevel = true;
      const key = orderedTypeFromFormat(odfNumFormatOf(def), def.getAttributeNS(NS.style, 'num-suffix'));
      level.numType = key === 'multilevel' ? 'decimal' : key;
      const sv = parseInt(def.getAttributeNS(NS.text, 'start-value') ?? '', 10);
      if (Number.isFinite(sv) && sv > 1) level.startAt = sv;
    } else {
      const ch = bulletCharFromOdf(def.getAttributeNS(NS.text, 'bullet-char'), listLevelFontName(def));
      if (ch) level.bulletChar = ch;
    }
    levels.push(level);
  }
  const style: ListStyle = { name, levels };
  if (builtin) style.builtin = true;
  if (multilevel) style.multilevel = true;
  return style;
}

// The block's yardstick plus what the run's character style provides.
function charDefaults(ctx: Ctx, base: BlockDefaults, odfName: string): BlockDefaults {
  const props = ctx.resolver.spanTextProps(odfName);
  const fonts = withFont(base.fonts, ctx.resolver.fontFamilyOf(props));
  const asianFonts = withFont(base.asianFonts, ctx.resolver.asianFontOf(props));
  const weight = props['fo:font-weight'];
  const fontStyle = props['fo:font-style'];
  return {
    ...base,
    fontSizePt: lengthToPt(props['fo:font-size']) ?? base.fontSizePt,
    boldByDefault: weight ? weight === 'bold' || parseInt(weight, 10) >= 600 : base.boldByDefault,
    fonts,
    asianFonts,
    color: (props['fo:color'] && normalizeColor(props['fo:color'])) || base.color,
    italic: fontStyle ? fontStyle === 'italic' || fontStyle === 'oblique' : base.italic,
    underline: props['style:text-underline-style'] ? lineSig(props, 'underline') : base.underline,
    strike: props['style:text-line-through-style'] ? lineSig(props, 'line-through') : base.strike,
    caps: capsFromOdf(props) ?? base.caps,
  };
}

function convertParaLike(el: Element, ctx: Ctx, kind: BlockKind, boldByDefault = false, listHeading = false): Node {
  const { resolver } = ctx;
  const styleName = el.getAttributeNS(NS.text, 'style-name');
  const paraProps = resolver.paraProps(styleName);
  const baseTextProps = resolver.paraTextProps(styleName);

  // A <text:h> that *is* an item of chapter numbering — the numbered heading both word
  // processors write — stays a paragraph here; the editor numbers a chapter from its
  // outline. `listHeading`: a heading after the item's paragraph, or in a real list.
  const isHeading = el.localName === 'h' && (kind !== 'list' || listHeading);
  let level = 1;
  if (isHeading) {
    const raw = parseInt(el.getAttributeNS(NS.text, 'outline-level') ?? '1', 10);
    level = Math.min(MAX_HEADING_LEVEL, Math.max(1, Number.isFinite(raw) ? raw : 1));
  }

  // The file's own named style for this block (an automatic style is direct formatting
  // layered on top of it); everything it already provides is not direct formatting.
  const named = resolver.namedAncestor(styleName);
  // Only a body block carries its style's name (below); anywhere else — a cell, a text
  // box — the formatting has to become direct, so it is measured against the default
  // style instead: the one `p:not([data-style])` re-applies (styleSheet.ts). A heading
  // keeps its level's yardstick, which is what `hN:not([data-style])` re-applies: the
  // file's style where the heading names it, the built-in (null) under any other style.
  // A header/footer zone renders its paragraphs at the editor's own defaults with only the
  // default style's font on top, so that is what its formatting is measured against.
  const levelStyled = isHeading && kind !== 'zone' && !!named && (ctx.styleNames.get(named) ?? named) === `Heading ${level}`;
  const yardstick = kind === 'body' || levelStyled ? named : kind === 'zone' || isHeading ? null : DEFAULT_STYLE;
  const defaults = blockDefaults(resolver, yardstick, isHeading ? level : null, boldByDefault);
  // A cell paragraph's spacing is the exception: editor.css zeroes it whatever the default
  // style declares (only that rule outranks the style's — not the `li p` one, and not for a
  // heading), so the file's own margins there are direct formatting.
  if (kind === 'cell' && !isHeading) { defaults.marginTopPt = 0; defaults.marginBottomPt = 0; }

  // A style:master-page-name switches the page master, which is how ODF gives a section
  // its own header/footer; the block that does it opens that section, and from it on
  // the blocks measure against that master's text width.
  const master = kind === 'body' ? resolver.masterPageOf(styleName) : null;
  const opensSection = !!master && opensMaster(master, ctx);
  if (opensSection) {
    ctx.masterPages.push(master!);
    // The same paragraph carries the number the section restarts at, if it does.
    const restart = Number(paraProps['style:page-number']);
    ctx.masterPageStarts.push(Number.isFinite(restart) ? clampPageStart(restart) : null);
    const geo = resolver.pageGeometry(master!);
    if (geo) { ctx.contentWidthCm = contentWidthOf(geo); ctx.leftMarginCm = geo.margins.left; Object.assign(ctx, heightsOf(geo)); }
  }
  const attrs = blockAttrs(paraProps, baseTextProps, defaults, kind);
  // A paragraph breaking itself onto a page under LibreOffice's Word 2013 layout opens it
  // without its space above (probed; a master page or the first page keeps it). It always
  // sits there: a 0.
  if (attrs.breakBefore === 'page' && !master && kind === 'body' && ctx.bodyBlocks > 0 && ctx.breakDropsSpace
    && (lengthToPt(paraProps['fo:margin-top']) ?? 0) > 0) attrs.spaceBefore = 0;
  if (paraProps['style:contextual-spacing'] === 'true') applyContextualSpacing(el, styleName, attrs);
  if (master) {
    // Naming a master *is* a page break, even where the page already uses that one
    // (probed) — which is how a book starts every chapter on a fresh page. Only the
    // document's first block has nothing above it to break from.
    if (ctx.bodyBlocks) attrs.breakBefore = 'page';
    if (opensSection) attrs.sectionBreak = true;
  }
  if (kind === 'body') ctx.bodyBlocks++;
  // Tab stops live in a child element of the paragraph properties, so they come from
  // the resolver's own walk rather than the flattened paraProps.
  const stops = formatTabStops(resolver.tabStops(styleName));
  if (stops) attrs.tabStops = stops;
  // A run inherits the block's own size (attrs.fontSize below), not the default style's,
  // so that is what it is measured against — else a list item whose style sets 11pt drops
  // every 12pt run as "the style supplies it" and renders them at 11.
  const markSizePt = lengthToPt(baseTextProps['fo:font-size']);
  // The block's own language, which its runs are measured against; the document's is
  // the default and no formatting.
  const ownLangs = langTagsOfProps(baseTextProps);
  const blockLang = ownLangs.west ?? defaults.lang;
  const blockLangAsian = ownLangs.asian ?? defaults.langAsian;
  const runDefaults = {
    ...(markSizePt != null && Math.abs(markSizePt - defaults.fontSizePt) > 0.05
      ? { ...defaults, fontSizePt: markSizePt }
      : defaults),
    lang: blockLang,
    langAsian: blockLangAsian,
  };
  const content = convertInline(el, ctx, baseTextProps, runDefaults);

  // The paragraph style's own font size is the block's line-height floor on every
  // line, not only on an empty one; carry it as a block attr (mirrors the docx
  // paragraph-mark size), or text smaller than the style keeps the taller strut.
  const markSize = lengthToPt(baseTextProps['fo:font-size']);
  if (markSize != null && Math.abs(markSize - defaults.fontSizePt) > 0.05) attrs.fontSize = formatPt(markSize);
  // Keep with next: a heading does that anyway (pageBreaks.ts), and what the block's
  // own style supplies (Title keeps with next) is not direct formatting either.
  if (!isHeading && !defaults.keepNext && paraProps['fo:keep-with-next'] === 'always') attrs.keepNext = true;
  // Unless a heading style the file defines drops it; an undefined one is the built-in.
  if (isHeading && paraProps['fo:keep-with-next'] !== 'always' && resolver.namedAncestor(styleName)) attrs.keepNext = false;
  if (!defaults.keepLines && paraProps['fo:keep-together'] === 'always') attrs.keepLines = true;
  // "Don't hyphenate this paragraph" — only meaningful where the document hyphenates at
  // all; below that switch it is the default and no formatting.
  if (baseTextProps['fo:hyphenate'] === 'false' && resolver.documentHyphenation()) attrs.noHyphenation = true;
  // style:writing-mode — the block's own base direction. "page" inherits, and the mode
  // the page already has is no formatting, so only a block that differs carries it.
  const wm = paraProps['style:writing-mode'];
  if (wm === 'rl-tb' && !ctx.pageRtl) attrs.dir = 'rtl';
  else if (wm === 'lr-tb' && ctx.pageRtl) attrs.dir = 'ltr';
  if (blockLang && blockLang !== defaults.lang) attrs.lang = blockLang;
  if (blockLangAsian && blockLangAsian !== defaults.langAsian) attrs.langAsian = blockLangAsian;
  const markFont = resolver.fontFamilyOf(baseTextProps);
  if (markFont && !defaults.fonts.has(markFont.toLowerCase())) attrs.fontFamily = markFont;
  const markAsian = resolver.asianFontOf(baseTextProps);
  if (markAsian && !defaults.asianFonts.has(markAsian.toLowerCase())) attrs.fontFamilyAsian = markAsian;
  // Outside the body the named style's font is baked in rather than declared, so runs
  // that all agree on another one still make it the block's, as they do in the body.
  const styleText = kind !== 'body' && named ? resolver.paraTextProps(named) : null;
  const baked = {
    fontSize: styleText && styleText['fo:font-size'] === baseTextProps['fo:font-size'] ? attrs.fontSize : undefined,
    fontFamily: styleText && resolver.fontFamilyOf(styleText) === markFont ? attrs.fontFamily : undefined,
  };
  for (const [k, v] of Object.entries(baked)) if (v != null) delete attrs[k];
  applyUniformRunFont(attrs, content, { fontSize: `${markSizePt ?? defaults.fontSizePt}pt`, fontFamily: markFont ?? null });
  for (const [k, v] of Object.entries(baked)) if (v != null && attrs[k] == null) attrs[k] = v;
  sinkOffsetFrames(content, lengthToPt(attrs.fontSize as string | undefined) ?? defaults.fontSizePt);

  const node: Node = { type: isHeading ? 'heading' : 'paragraph' };
  if (isHeading) attrs.level = level;
  // Only top-level blocks carry a style: list items and cells reference the producer's
  // own plumbing styles (List_20_Bullet, Table_20_Contents), which are not user styles.
  if (named && kind === 'body') {
    const display = ctx.styleNames.get(named) ?? named;
    ctx.usedStyles.add(named);
    if (display !== (isHeading ? `Heading ${level}` : DEFAULT_STYLE)) attrs.styleName = display;
  } else if (levelStyled) {
    // The level's style renders it, so the sheet needs the file's definition of it.
    ctx.usedStyles.add(named!);
  }
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return withParagraphMarks(node, ctx, kind);
}

// A paragraph mark struck through: the registry holds a block per side, the body one
// paragraph with REV_BREAK where the mark was. It parts again, each side in its own
// registry block's format, the only place that keeps the second side's (review.md).
const REV_BREAK = '__revBreak';

// The change of a recorded row or cell, which ODF keeps on the first change in its text;
// the U+200D that opens such a line (or stands in for an empty one) goes.
function lineChange(nodes: Node[]): Record<string, unknown> | undefined {
  for (const node of nodes) {
    const content = node.content ?? [];
    const at = content.findIndex((n) => n.marks?.some((m) => m.type === 'insertion' || m.type === 'deletion'));
    if (at >= 0) {
      const text = content[at], rev = Object.fromEntries(text.marks!.filter((m) => m.type === 'insertion' || m.type === 'deletion').map((m) => [m.type, m.attrs]));
      if (text.text?.startsWith('\u200D')) {
        if (text.text.length > 1) text.text = text.text.slice(1);
        else content.splice(at, 1);
      }
      return rev;
    }
    const nested = lineChange(content);
    if (nested) return nested;
  }
  return undefined;
}

function withParagraphMarks(node: Node, ctx: Ctx, kind: BlockKind): Node {
  const open = [...ctx.openInsertions.values()].pop();
  const shape = (el: unknown) => {
    const block = el as Element;
    if (!block.getAttributeNS(NS.text, 'style-name')) return node;
    return convertParaLike(block.cloneNode(false) as Element, ctx, kind, false, block.localName === 'h');
  };
  const parts: Node[] = [];
  type Break = { rev: unknown; after: unknown; before: unknown };
  let run: Node[] = [], last = null as Break | null;
  const close = (el: unknown, rev?: unknown) => {
    const { type, attrs } = el ? shape(el) : node;
    parts.push({ type, ...(attrs || rev ? { attrs: { ...attrs, ...(rev ? { revMark: rev } : {}) } } : {}), ...(run.length ? { content: run } : {}) });
    run = [];
  };
  for (const n of node.content ?? []) {
    if (n.type !== REV_BREAK) { run.push(n); continue; }
    last = n.attrs as Break;
    close(last.before, last.rev);
  }
  if (!last) {
    if (open) node.attrs = { ...node.attrs, revMark: { insertion: open } };
    return node;
  }
  close(last.after, open ? { insertion: open } : undefined);
  // What opened the section or the page stays on the block that comes first.
  const { breakBefore, sectionBreak } = node.attrs ?? {};
  if (breakBefore || sectionBreak) parts[0].attrs = { ...parts[0].attrs, ...(breakBefore ? { breakBefore } : {}), ...(sectionBreak ? { sectionBreak } : {}) };
  return { ...parts[0], parts };
}

// textAlign / lineHeight / spaceBefore / spaceAfter from resolved paragraph
// props, suppressing values that match the editor's defaults for this context.
function blockAttrs(paraProps: PropMap, textProps: PropMap, defaults: BlockDefaults, kind: BlockKind): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  // Measured against the named style's own alignment: what the style supplies is not
  // direct formatting, and a block overriding it back to left needs the attr to win.
  // An RTL block renders right by default — LibreOffice pairs the mode with
  // fo:text-align="end" for exactly that look, which is no direct formatting either.
  const ta = odfTextAlign(paraProps['fo:text-align']);
  const base = paraProps['style:writing-mode'] === 'rl-tb' ? 'right' : defaults.textAlign ?? 'left';
  if (ta !== null && ta !== base) attrs.textAlign = ta;

  // A header/footer's proportional spacing is left out: LibreOffice lays the band out at
  // single height (measured: a 10pt header in a 115% style reserves one plain line).
  const lh = lineSpacing(paraProps['fo:line-height']);
  const widened = kind === 'zone' && lh != null && !lh.endsWith('pt') && Number(lh) > 1;
  if (lh != null && lh !== defaults.lineHeight && !widened) attrs.lineHeight = lh;
  if (paraProps['style:snap-to-layout-grid'] === 'false') attrs.snapToGrid = false;

  const defTop = defaults.marginTopPt;
  const defBottom = defaults.marginBottomPt;
  // An unspecified fo:margin is ODF's default of 0, which is also the editor's
  // paragraph default — so it is suppressed, and a file that does declare spacing
  // (e.g. LO's 0.212cm Text Body) keeps it as an explicit value.
  const mt = lengthToPt(paraProps['fo:margin-top']) ?? 0;
  const mb = lengthToPt(paraProps['fo:margin-bottom']) ?? 0;
  if (Math.abs(mt - defTop) > EPS_PT) attrs.spaceBefore = snapPt(mt);
  if (Math.abs(mb - defBottom) > EPS_PT) attrs.spaceAfter = snapPt(mb);

  // Left indent → fo:margin-left (cm). Skip lists: their indent lives in the
  // list-style level properties, not paraProps. What the style already indents is not
  // direct formatting.
  // LibreOffice's font-relative loext: twins (in `ic`, characters) win over the fo: ones.
  const ic = (v: string | undefined) => { const m = /^(-?[\d.]+)ic$/.exec(v ?? ''); return m ? parseFloat(m[1]) : 0; };
  if (kind !== 'list') {
    const ml = lengthToPt(paraProps['fo:margin-left']) ?? 0;
    const leftChars = ic(paraProps['loext:margin-left']);
    if (leftChars > 0) attrs.indentChars = leftChars;
    else if (Math.abs(ml - defaults.indentPt) > EPS_PT) attrs.indent = Math.round((ml / 72) * 2.54 * 100) / 100;
    // fo:text-indent is the first line only; negative is a hanging indent.
    const chars = ic(paraProps['loext:text-indent']);
    const ti = lengthToCm(paraProps['fo:text-indent']);
    if (chars) attrs.indentFirstChars = chars;
    else if (ti != null && Math.abs(ti) > 0.02) attrs.indentFirst = Math.round(ti * 100) / 100;
  }
  const mr = lengthToCm(paraProps['fo:margin-right']);
  const rightChars = ic(paraProps['loext:margin-right']);
  if (rightChars > 0) attrs.indentRightChars = rightChars;
  else if (mr != null && (mr > 0.02 || (kind !== 'cell' && mr < -0.02))) attrs.indentRight = Math.round(mr * 100) / 100;

  // Manual page break (fo:break-before); the editor has no column breaks, so only
  // "page". A cell block can't carry one — LibreOffice ignores it inside a table.
  if (kind !== 'cell' && paraProps['fo:break-before'] === 'page') attrs.breakBefore = 'page';
  // fo:break-after is the same break seen from the block above; convertBlocks moves it
  // onto the next block, which is what the editor can express.
  if (kind === 'body' && paraProps['fo:break-after'] === 'page') attrs.breakAfter = 'page';

  // Widow-orphan control: LibreOffice writes 0 for "off", and a file declaring neither
  // anywhere in the chain has none either (probed: a lone last line goes over).
  const lines = (v: string | undefined) => Number(v ?? 0) > 0;
  if (!lines(paraProps['fo:widows']) || !lines(paraProps['fo:orphans'])) attrs.widowControl = false;

  // Paragraph background ("colored field") + per-side borders ("rule line"), less
  // what the named style supplies.
  for (const [k, v] of Object.entries(paraBoxAttrs(paraProps))) if (defaults.box[k] !== v) attrs[k] = v;

  return attrs;
}

// style:contextual-spacing drops a paragraph's own spacing towards a neighbour of the
// same style — LibreOffice's List styles carry it. The editor has no such mode, so the
// suppressed side becomes an explicit 0, as the docx path does for w:contextualSpacing.
function applyContextualSpacing(el: Element, styleName: string | null, attrs: Record<string, unknown>): void {
  const same = (sib: Element | null) => !!sib && sib.getAttributeNS(NS.text, 'style-name') === styleName;
  if (same(flowSibling(el, 'previous'))) attrs.spaceBefore = 0;
  if (same(flowSibling(el, 'next'))) attrs.spaceAfter = 0;
}

// The paragraph before or after this one in the flow: its own sibling, or — in a list,
// where each item wraps its paragraphs and a deeper list wraps them again — the
// neighbouring item's nearest one, climbing out of the item a nested list opens with.
function flowSibling(el: Element, dir: 'previous' | 'next'): Element | null {
  const isPara = (e: Element) => e.namespaceURI === NS.text && (e.localName === 'p' || e.localName === 'h');
  const step = (e: Element) => (dir === 'previous' ? e.previousElementSibling : e.nextElementSibling);
  // The nearest paragraph inside a list or item, from whichever end the walk arrives at.
  const inside = (e: Element): Element | null => {
    if (isPara(e)) return e;
    const kids = Array.from(e.children);
    for (const k of dir === 'previous' ? kids.reverse() : kids) {
      const found = inside(k);
      if (found) return found;
    }
    return null;
  };
  for (let node: Element | null = el; node; node = node.parentElement) {
    for (let s = step(node); s; s = step(s)) {
      const found = inside(s);
      if (found) return found;
    }
    const parent = node.parentElement;
    const wrapper = parent && parent.namespaceURI === NS.text
      && (parent.localName === 'list-item' || parent.localName === 'list'
        || parent.localName === 'list-header');
    if (!wrapper) return null;
  }
  return null;
}

// Paragraph background + per-side border attrs (paragraphBox.ts) from resolved paraProps.
// Each key is omitted when absent so a paragraph with no box props stays clean. Borders:
// a per-side fo:border-* overrides the all-sides fo:border; 'none' ⇒ no border (undefined).
export function paraBoxAttrs(paraProps: PropMap): Record<string, string> {
  const out: Record<string, string> = {};
  const bg = paraProps['fo:background-color'];
  if (bg && bg !== 'transparent') {
    const c = normalizeColor(bg);
    if (c) out.backgroundColor = c;
  }
  const all = paraProps['fo:border'];
  const sides: [string, string][] = [
    ['borderTop', 'fo:border-top'],
    ['borderRight', 'fo:border-right'],
    ['borderBottom', 'fo:border-bottom'],
    ['borderLeft', 'fo:border-left'],
  ];
  for (const [attr, key] of sides) {
    const raw = paraProps[key] ?? all;
    if (raw == null) continue;
    const v = borderAttrFromOdf(raw, false);
    if (v && v !== 'none') out[attr] = v;
  }
  return out;
}

// Round to 2 decimals; snap to the integer when within producer rounding noise
// (6pt → LO's 0.212cm → 6.0094pt → 6).
function snapPt(v: number): number {
  const r = Math.round(v * 100) / 100;
  const i = Math.round(r);
  return Math.abs(r - i) <= 0.03 ? i : r;
}

// ---- date/time fields ---------------------------------------------------------

// Parse a <number:date-style>/<number:time-style> body into our token model so it can
// be matched to a catalog format. number:style="long" = padded/4-digit, and hours
// become 12-hour when an am-pm token is present.
function parseNumberStyleTokens(styleEl: Element): Token[] {
  const toks: Token[] = [];
  for (const c of Array.from(styleEl.children)) {
    if (c.namespaceURI !== NS.number) continue;
    const long = c.getAttributeNS(NS.number, 'style') === 'long';
    switch (c.localName) {
      case 'text': toks.push({ t: 'lit', s: c.textContent ?? '' }); break;
      case 'year': toks.push({ t: 'year', long }); break;
      case 'month': {
        const textual = c.getAttributeNS(NS.number, 'textual') === 'true';
        toks.push({ t: 'month', style: textual ? (long ? 'longText' : 'shortText') : (long ? 'num2' : 'num') });
        break;
      }
      case 'day': toks.push({ t: 'day', pad: long }); break;
      case 'day-of-week': toks.push({ t: 'weekday', long }); break;
      case 'hours': toks.push({ t: 'hour24', pad: long }); break;
      case 'minutes': toks.push({ t: 'minute' }); break;
      case 'seconds': toks.push({ t: 'second' }); break;
      case 'am-pm': toks.push({ t: 'ampm' }); break;
    }
  }
  if (toks.some(t => t.t === 'ampm')) {
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].t === 'hour24') toks[i] = { t: 'hour12', pad: (toks[i] as { pad: boolean }).pad };
    }
  }
  return toks;
}

// ISO local datetime for the node's `value`: a date-value or dateTime time-value is
// kept; a legacy PThHmMsS time-value is placed on today's date (only its time renders).
function fieldValue(kind: 'date' | 'time', raw: string | null): string {
  const m = kind === 'time' && raw ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(raw) : null;
  if (m) {
    const now = new Date();
    now.setHours(Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0), 0);
    return toDateValue(now);
  }
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d.getTime()) ? raw! : '';
}

// A <text:date>/<text:time> whose data style matches a known format → a live field
// node; returns null (keep the shown text) for an unrecognised format.
function convertDateTimeField(e: Element, ctx: Ctx): Node | null {
  const styleEl = ctx.resolver.numberStyle(e.getAttributeNS(NS.style, 'data-style-name'));
  if (!styleEl) return null;
  const tokens = parseNumberStyleTokens(styleEl);
  // Kind follows the number style's actual tokens, not the element name: OpenOffice
  // can wrap a date field in <text:time> yet reference a date-style, and vice versa.
  const kind = numberStyleKind(tokens) ?? (e.localName === 'time' ? 'time' : 'date');
  // A style the catalog does not list rides its own DOCX picture as the key, which
  // renders and re-exports the same (dateTime.ts findFormat).
  const format = matchFormat(tokens, kind) ?? (tokens.length ? docxPicture({ key: '', kind, tokens }) : null);
  if (!format) return null;
  const fixed = e.getAttributeNS(NS.text, 'fixed') === 'true';
  const raw = e.getAttributeNS(NS.text, 'date-value') ?? e.getAttributeNS(NS.text, 'time-value');
  return { type: 'dateTimeField', attrs: { kind, format, fixed, value: fieldValue(kind, raw) } };
}

// A key too short for a hash is what LibreOffice stands in for a DOCX protection without one.
function odfRecordLock(files: Record<string, Uint8Array>): RecordLock | null {
  const key = /RedlineProtectionKey"[^>]*>([^<]+)</.exec(files['settings.xml'] ? strFromU8(files['settings.xml']) : '')?.[1];
  return key ? (atob(key).length >= 20 ? { key } : {}) : null;
}

// Whether the document records revisions: the registry's own flag, which ODF defaults
// to true where the element is there without it. No registry at all records nothing.
function odfRecordChanges(body: Element): boolean {
  const registry = body.getElementsByTagNameNS(NS.text, 'tracked-changes')[0];
  return !!registry && registry.getAttributeNS(NS.text, 'track-changes') !== 'false';
}

type OdfRevision = { kind: 'insertion' | 'deletion' | 'formatChange'; author: string; date: string; moveId?: string; comment?: string; text: string; paras: Element[]; under?: { author: string; date: string; comment?: string } };

// The attrs of a change's mark; what its paragraphs share goes on the paragraph marks too.
const revisionAttrs = (id: string, { author, date, moveId, comment }: OdfRevision) =>
  ({ id, author, date, ...(moveId ? { moveId } : {}), ...(comment ? { comment } : {}) });

// The <text:tracked-changes> registry: one entry per change id. A deletion carries the
// text it removed (the body has only a point marker), an insertion only who and when.
function odfRevisions(body: Element): Map<string, OdfRevision> {
  const out = new Map<string, OdfRevision>();
  const registry = body.getElementsByTagNameNS(NS.text, 'tracked-changes')[0];
  for (const region of Array.from(registry?.children ?? [])) {
    const id = region.getAttributeNS(NS.text, 'id') ?? region.getAttribute('xml:id');
    const kindEl = Array.from(region.children).find((c) => c.localName === 'insertion' || c.localName === 'deletion' || c.localName === 'format-change');
    if (!id || !kindEl) continue;
    const who = (el: Element) => {
      const info = el.getElementsByTagNameNS(NS.office, 'change-info')[0];
      // LibreOffice ends each paragraph with a newline it reads, and writes that as an empty last one.
      const comment = Array.from(info?.children ?? []).filter((c) => c.namespaceURI === NS.text && c.localName === 'p').map((p) => p.textContent).join('\n').trimEnd();
      return {
        author: info?.getElementsByTagNameNS(NS.dc, 'creator')[0]?.textContent?.trim() ?? '',
        date: info?.getElementsByTagNameNS(NS.dc, 'date')[0]?.textContent?.trim() ?? '',
        ...(comment ? { comment } : {}),
      };
    };
    // LibreOffice keeps a heading's deleted text a text:h, and a list item's inside its list.
    const blocks = (el: Element): Element[] => Array.from(el.children).flatMap((c) => c.namespaceURI !== NS.text ? []
      : c.localName === 'p' || c.localName === 'h' ? [c] : /^list(-item|-header)?$/.test(c.localName) ? blocks(c) : []);
    const paras = blocks(kindEl);
    const move = kindEl.getElementsByTagNameNS(NS.loext as string, 'move-id')[0]?.textContent?.trim();
    // A deletion of another's insertion carries that insertion after it, in the same region.
    const under = kindEl.localName === 'deletion'
      ? Array.from(region.children).find((c) => c.localName === 'insertion') : undefined;
    out.set(id, {
      kind: kindEl.localName === 'deletion' ? 'deletion' : kindEl.localName === 'format-change' ? 'formatChange' : 'insertion',
      ...who(kindEl),
      ...(move ? { moveId: move } : {}),
      text: paras.map((n) => n.textContent ?? '').join('\n'),
      paras,
      ...(under ? { under: who(under) } : {}),
    });
  }
  return out;
}

// Every sequence a cross-reference in this file names. Only those numbers get a
// bookmark on import — the target the editor's own reference and Word both address.
function sequenceRefNames(body: Element): Set<string> {
  const out = new Set<string>();
  for (const e of Array.from(body.getElementsByTagNameNS(NS.text, 'sequence-ref'))) {
    const name = e.getAttributeNS(NS.text, 'ref-name');
    if (name) out.add(name);
  }
  return out;
}

// <text:sequence> → a caption's running number. The counter's name is the category
// (LibreOffice's "Illustration"/"Table"); the element text is the file's cached value,
// which the editor's own numbering overwrites on the first edit.
function convertSequenceField(e: Element): Node | null {
  const name = e.getAttributeNS(NS.text, 'name') ?? '';
  const category = ODF_SEQ_CATEGORY[name];
  if (!category) return null;
  const format = e.getAttributeNS(NS.style, 'num-format');
  const number = parseInt((e.textContent ?? '').replace(/\D/g, ''), 10);
  return {
    type: 'sequenceField',
    attrs: {
      category,
      format: format && '1aAiI'.includes(format) ? format : '1',
      number: Number.isFinite(number) && number > 0 ? number : 1,
    },
  };
}

// A note style that only re-states the stock look (10pt, the hanging indent, nothing
// else changed against the default style) equals a styleName-less note; suppress it,
// as every other default-equal value is on import.
function isStockNoteStyle(resolver: StyleResolver, name: string): boolean {
  // Measured against Standard (the stock styles' parent), so inherited values match.
  const text = resolver.paraTextProps(name), baseT = resolver.paraTextProps('Standard');
  const para = resolver.paraProps(name), baseP = resolver.paraProps('Standard');
  const cm = (v?: string) => lengthToCm(v ?? null) ?? 0;
  if (Math.abs((lengthToPt(text['fo:font-size']) ?? 0) - NOTE_FONT_SIZE_PT) > 0.3) return false;
  if (Math.abs(cm(para['fo:margin-left']) - NOTE_INDENT_CM) > 0.03) return false;
  if (Math.abs(cm(para['fo:text-indent']) + NOTE_INDENT_CM) > 0.03) return false;
  const sameT = (k: string) => (text[k] ?? '') === (baseT[k] ?? '');
  const sameP = (k: string) => (para[k] ?? '') === (baseP[k] ?? '');
  const sameCm = (k: string) => Math.abs(cm(para[k]) - cm(baseP[k])) < 0.03;
  return ['fo:font-family', 'style:font-name', 'fo:font-style', 'fo:font-weight', 'fo:color', 'fo:background-color', 'style:text-underline-style'].every(sameT)
    && ['fo:text-align', 'fo:line-height'].every(sameP)
    && ['fo:margin-top', 'fo:margin-bottom', 'fo:margin-right'].every(sameCm);
}

// The note's paragraph style: the one its own <text:p> names, else the class's
// configured default. Registered as used, or collectStyleSheet drops it.
function noteBodyStyle(e: Element, ctx: Ctx, kind: NoteKind): string | null {
  const body = e.getElementsByTagNameNS(NS.text, 'note-body')[0] ?? null;
  const own = Array.from(body?.children ?? []).find((c) => c.localName === 'p' || c.localName === 'h');
  const raw = own?.getAttributeNS(NS.text, 'style-name')
    ?? ctx.resolver.noteSettings()[kind].bodyStyle.replace(/ /g, '_20_');
  const named = ctx.resolver.namedAncestor(raw, 'paragraph');
  if (!named || isStockNoteStyle(ctx.resolver, named)) return null;
  ctx.usedStyles.add(named);
  return ctx.styleNames.get(named) ?? decodeStyleName(named);
}

// <text:note> → the anchor node, with the note's own text collected into ctx for the
// section the document end gets. A body of several paragraphs is flattened to hard
// breaks — the editor's note holds one paragraph.
function convertNote(e: Element, ctx: Ctx, defaults: BlockDefaults): Node | null {
  const kind: NoteKind = e.getAttributeNS(NS.text, 'note-class') === 'endnote' ? 'endnote' : 'footnote';
  const citation = e.getElementsByTagNameNS(NS.text, 'note-citation')[0] ?? null;
  const label = citation?.getAttributeNS(NS.text, 'label') || null;
  const shown = label ?? (citation?.textContent ?? '').trim();
  const body = e.getElementsByTagNameNS(NS.text, 'note-body')[0] ?? null;

  const content: Node[] = [];
  for (const para of Array.from(body?.children ?? [])) {
    if (para.localName !== 'p' && para.localName !== 'h') continue;
    if (content.length) content.push({ type: 'hardBreak' });
    content.push(...convertInline(para, ctx, {}, defaults).filter((n) => n.type !== REV_BREAK));
  }
  // The file's own id is unique within it, so it is the anchor's id too. The note takes
  // the paragraph style its notes-configuration names, so it renders at the file's own
  // size and indent rather than at LibreOffice's.
  const id = e.getAttributeNS(NS.text, 'id') || `${kind}${ctx.notes.length + 1}`;
  const styleName = noteBodyStyle(e, ctx, kind);
  ctx.notes.push({ id, kind, label, text: shown, content, styleName });
  return { type: 'noteRef', attrs: { id, kind, text: shown } };
}

// A number style with any calendar token is a date style; hours/minutes → time; else null.
function numberStyleKind(tokens: Token[]): 'date' | 'time' | null {
  if (tokens.some(t => t.t === 'year' || t.t === 'month' || t.t === 'day' || t.t === 'weekday')) return 'date';
  if (tokens.some(t => t.t === 'hour24' || t.t === 'hour12' || t.t === 'minute' || t.t === 'second' || t.t === 'ampm')) return 'time';
  return null;
}

// ---- inline conversion --------------------------------------------------------

function convertInline(root: Element, ctx: Ctx, baseProps: PropMap, defaults: BlockDefaults): Node[] {
  const out: Node[] = [];
  // Point comments, with the run index they were seen at — resolved after the walk.
  const points: { at: number; attrs: Record<string, unknown> }[] = [];

  // The named character style of the enclosing span, if any: its formatting belongs to
  // the style, so the run only keeps what goes beyond it.
  let charStyle: string | null = null;

  const pushText = (text: string, props: PropMap, linkHref?: string, extra?: Mark) => {
    // Strip our export sentinels (SEG/LBR) defensively — never legitimate text.
    let clean = text.replace(/[-]/g, '');
    if (clean.includes('\n')) {
      // Newlines in ODF text content are formatting whitespace (real breaks
      // are text:line-break): drop whitespace-only nodes, collapse the rest.
      if (!clean.trim()) return;
      clean = clean.replace(/[ \t]*\n[ \t]*/g, ' ');
    }
    if (!clean) return;
    const marks = marksFor(scriptProps(clean, props), ctx.resolver,
      charStyle ? charDefaults(ctx, defaults, charStyle) : defaults);
    if (charStyle) {
      const display = ctx.charStyleNames.get(charStyle) ?? charStyle;
      ctx.usedCharStyles.add(charStyle);
      marks.push({ type: 'charStyle', attrs: { name: display } });
    }
    if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
    // Ranges overlap, so the run carries every bookmark it is in — plus any point
    // bookmark waiting for it.
    for (const name of ctx.openBookmarks.keys()) ctx.openBookmarks.set(name, true);
    for (const name of new Set([...ctx.openBookmarks.keys(), ...ctx.pointBookmarks])) {
      marks.push({ type: 'bookmark', attrs: { name } });
    }
    ctx.pointBookmarks.clear();
    for (const attrs of ctx.openComments.values()) marks.push({ type: 'comment', attrs });
    const insertion = ctx.openInsertions.values().next().value;
    if (insertion) marks.push({ type: 'insertion', attrs: insertion });
    const format = ctx.openFormats.values().next().value;
    if (format) marks.push({ type: 'formatChange', attrs: format });
    if (extra) marks.push(extra);
    const node: Node = { type: 'text', text: clean };
    if (marks.length) node.marks = marks;
    out.push(node);
  };

  // An atom met inside a recorded insertion takes its mark as text does (pushText). Each
  // child's nodes are settled by the innermost walk that pushed them, under the insertion
  // open while it did; a note anchor takes no marks and a box is no single character.
  const settled = new WeakSet<Node>();
  const walk = (el: Element, props: PropMap, linkHref?: string) => {
    let from = out.length, insertion = ctx.openInsertions.values().next().value;
    const settle = () => {
      for (const n of out.slice(from)) {
        if (settled.has(n)) continue;
        settled.add(n);
        if (insertion && !n.marks?.some((m) => m.type === 'insertion')) {
          n.marks = [...(n.marks ?? []), { type: 'insertion', attrs: insertion }];
        }
      }
      from = out.length;
      insertion = ctx.openInsertions.values().next().value;
    };
    for (const child of Array.from(el.childNodes)) {
      settle();
      if (child.nodeType === 3 /* text */) {
        pushText(child.nodeValue ?? '', props, linkHref);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const e = child as Element;

      if (e.namespaceURI === NS.text) {
        // A field set to show nothing shows nothing: its stored value is not text.
        if (e.getAttributeNS(NS.text, 'display') === 'none') continue;
        switch (e.localName) {
          case 'span': {
            const spanStyle = e.getAttributeNS(NS.text, 'style-name');
            const outer = charStyle;
            charStyle = ctx.resolver.namedAncestor(spanStyle, 'text') ?? outer;
            walk(e, layerTextProps(props, ctx.resolver.spanTextProps(spanStyle)), linkHref);
            charStyle = outer;
            continue;
          }
          case 's': {
            const c = boundedInt(e.getAttributeNS(NS.text, 'c') ?? '1', 1, IMPORT_LIMITS.textRunChars) ?? 1;
            pushText(' '.repeat(c), props, linkHref);
            continue;
          }
          case 'tab':
            pushText('\t', props, linkHref);
            continue;
          case 'line-break': {
            // Carry the run's marks so an empty line between two breaks keeps its font size.
            const marks = marksFor(props, ctx.resolver, defaults);
            const insertion = ctx.openInsertions.values().next().value;
            if (insertion) marks.push({ type: 'insertion', attrs: insertion });
            const format = ctx.openFormats.values().next().value;
            if (format) marks.push({ type: 'formatChange', attrs: format });
            const br: Node = { type: 'hardBreak' };
            if (marks.length) br.marks = marks;
            out.push(br);
            continue;
          }
          case 'a': {
            // ODF hyperlink → link mark on the contained text; an internal #bookmark
            // href is kept as-is and resolved against the document's bookmarks. A scheme
            // the editor would never open (javascript:) stops here, not at render time.
            const href = e.getAttributeNS(NS.xlink, 'href') ?? '';
            walk(e, props, isAllowedUri(href) ? href || linkHref : linkHref);
            continue;
          }
          case 'ruby': {
            // Both halves are elements of their own; the editor keeps them as one atom.
            const base = e.getElementsByTagNameNS(NS.text, 'ruby-base')[0]?.textContent ?? '';
            const reading = e.getElementsByTagNameNS(NS.text, 'ruby-text')[0]?.textContent ?? '';
            if (base.trim()) out.push({ type: 'ruby', attrs: { base: base.trim(), text: reading.trim() } });
            continue;
          }
          case 'note': {
            // The zone schema has no notes.
            if (ctx.zone) continue;
            const note = convertNote(e, ctx, defaults);
            if (note) out.push(note);
            continue;
          }
          // A named range → a bookmark mark on the text it covers. A reference mark is
          // the same target under another name (LibreOffice's own cross-references use
          // it), and travels as a bookmark.
          case 'bookmark-start':
          case 'bookmark-end':
          case 'reference-mark-start':
          case 'reference-mark-end': {
            const name = e.getAttributeNS(NS.text, 'name');
            if (!name) continue;
            if (e.localName.endsWith('-start')) ctx.openBookmarks.set(name, false);
            else {
              // A range holding no text of its own still marks a place: the next run
              // carries it, as a point bookmark does.
              if (ctx.openBookmarks.get(name) === false) ctx.pointBookmarks.add(name);
              ctx.openBookmarks.delete(name);
            }
            continue;
          }
          case 'bookmark-ref':
          case 'reference-ref':
          case 'sequence-ref':
          case 'note-ref': {
            const name = e.getAttributeNS(NS.text, 'ref-name');
            const fmt = e.getAttributeNS(NS.text, 'reference-format');
            // A format the editor cannot recompute (chapter, a user variable) keeps the
            // value the file cached.
            const kind = e.localName === 'sequence-ref' ? 'sequence' : e.localName === 'note-ref' ? 'note' : 'bookmark';
            if (name && isCrossRefFormat(fmt)) {
              const field: Node = {
                type: 'crossRef',
                attrs: { name, format: fmt, text: e.textContent ?? '', ...(kind === 'bookmark' ? {} : { kind }) },
              };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            if (e.textContent) pushText(e.textContent, props, linkHref);
            continue;
          }
          // A point bookmark or reference mark has no range of its own, so the next run
          // carries it — a reference to it still lands where the file put it.
          case 'bookmark':
          case 'reference-mark': {
            const name = e.getAttributeNS(NS.text, 'name');
            if (name) ctx.pointBookmarks.add(name);
            continue;
          }
          // The producer's own pagination, which the editor recomputes.
          case 'soft-page-break':
            continue;
          case 'change-start':
          case 'change-end': {
            // A recorded insertion brackets its runs; the registry holds who and when.
            const id = e.getAttributeNS(NS.text, 'change-id');
            const rev = id ? ctx.revisions.get(id) : undefined;
            if (id && rev?.kind === 'insertion') {
              if (e.localName === 'change-start') ctx.openInsertions.set(id, revisionAttrs(id, rev));
              else ctx.openInsertions.delete(id);
            }
            if (id && rev?.kind === 'formatChange') {
              if (e.localName === 'change-start') ctx.openFormats.set(id, { ...revisionAttrs(id, rev), old: null });
              else ctx.openFormats.delete(id);
            }
            continue;
          }
          case 'change': {
            // A deletion is a point marker: its text lives only in the registry, and the
            // editor keeps it in the document marked as removed. The registry paragraphs
            // are real styled runs, so they convert like any inline content.
            const id = e.getAttributeNS(NS.text, 'change-id');
            const rev = id ? ctx.revisions.get(id) : undefined;
            if (id && rev?.kind === 'deletion' && (rev.paras.length || rev.text)) {
              const del = [{ type: 'deletion', attrs: revisionAttrs(id, rev) },
                ...(rev.under ? [{ type: 'insertion', attrs: { id: `${id}-ins`, ...rev.under } }] : [])];
              if (!rev.paras.length) {
                out.push({ type: 'text', text: rev.text, marks: [...marksFor(props, ctx.resolver, defaults), ...del] });
                continue;
              }
              rev.paras.forEach((p, i) => {
                if (i) out.push({ type: REV_BREAK, attrs: { rev: { deletion: del[0].attrs, ...(rev.under ? { insertion: del[1].attrs } : {}) }, before: rev.paras[i - 1], after: p } });
                for (const n of convertInline(p, ctx, props, defaults)) {
                  n.marks = [...(n.marks ?? []), ...del];
                  out.push(n);
                }
              });
            }
            continue;
          }
          default:
            // In headers/footers, page fields stay live fields (pageField.ts). The atom
            // carries the run's marks so its digits render in the run's font/size.
            if (ctx.zone && (e.localName === 'page-number' || e.localName === 'page-count')) {
              const field: Node = { type: e.localName === 'page-count' ? 'pageCount' : 'pageNumber' };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            // The running head's chapter name; text:display="number"/"plain-number" is a
            // numbering we don't track, so those keep the file's cached string.
            if (ctx.zone && e.localName === 'chapter' && e.getAttributeNS(NS.text, 'display') === 'name') {
              const level = Number(e.getAttributeNS(NS.text, 'outline-level')) || 1;
              const field: Node = { type: 'chapterField', attrs: { level, text: e.textContent ?? '' } };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            // Date/time fields become live dateTimeField nodes (a known format; falls
            // through to the shown text otherwise) — in a zone too, where a dated
            // running head is what they are usually for.
            if (e.localName === 'date' || e.localName === 'time') {
              const field = convertDateTimeField(e, ctx);
              if (field) {
                // The field is an atom without inline children, so it can't inherit
                // the surrounding run's font from a sibling span — carry the run's
                // marks on the node so it renders in the same font/size/etc.
                const marks = marksFor(props, ctx.resolver, defaults);
                if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
                if (marks.length) field.marks = marks;
                out.push(field);
                continue;
              }
            }
            // A placeholder field (Insert ▸ Field ▸ Placeholder): the label is the
            // shown text without the <>/‹› brackets either producer draws around it.
            if (e.localName === 'placeholder') {
              const label = (e.textContent ?? '').trim().replace(/^[<‹]/, '').replace(/[>›]$/, '');
              const field: Node = { type: 'placeholderField', attrs: { text: label } };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            // A caption's running number (caption.ts). Only the two categories the
            // editor counts survive as a live field; any other sequence (a user
            // variable, a chapter counter) keeps its evaluated text.
            if (e.localName === 'sequence') {
              const field = convertSequenceField(e);
              const refName = e.getAttributeNS(NS.text, 'ref-name');
              const anchor: Mark | undefined = refName && ctx.seqRefNames.has(refName)
                ? { type: 'bookmark', attrs: { name: refName } } : undefined;
              if (field) {
                const marks = marksFor(props, ctx.resolver, defaults);
                if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
                if (anchor) marks.push(anchor);
                if (marks.length) field.marks = marks;
                out.push(field);
                continue;
              }
              // A counter the editor does not keep (an equation number, a user counter)
              // leaves its evaluated text — carrying the anchor, or every reference to it
              // would name a bookmark the document no longer has.
              if (anchor && e.textContent) {
                pushText(e.textContent, props, linkHref, anchor);
                continue;
              }
            }
            // A place marked for the alphabetical index. LibreOffice writes a point
            // mark; a range one (-mark-start/-end) is kept at its start, the editor's
            // entry being a place too.
            if (e.localName === 'alphabetical-index-mark' || e.localName === 'alphabetical-index-mark-start') {
              const term = e.getAttributeNS(NS.text, 'string-value') ?? '';
              if (term.trim()) {
                out.push({ type: 'indexEntry', attrs: { term: term.trim(), key1: (e.getAttributeNS(NS.text, 'key1') ?? '').trim() } });
              }
              continue;
            }
            if (e.localName === 'alphabetical-index-mark-end') continue;
            // A citation. Every field is an attribute of the mark, so the source record
            // travels with it; the element's text is what the citation showed.
            if (e.localName === 'bibliography-mark') {
              const entry = bibEntryFromMark(e);
              // Space the producer kept inside the mark is the text's: the label the
              // editor draws has none, so it would close up on the word before.
              const lead = /^\s+/.exec(e.textContent ?? '')?.[0];
              if (entry && lead) pushText(lead.replace(/\s+/g, ' '), props, linkHref);
              if (entry) { out.push(entry); continue; }
            }
            // Other text fields (title, …) store their evaluated value as element
            // text — keep what the source document showed.
            if (e.textContent) pushText(e.textContent, props, linkHref);
            continue;
        }
      }
      // LibreOffice's content control (loext): ours is a placeholder field, any other
      // is read through, its text kept.
      if (e.localName === 'content-control' && e.namespaceURI === (NS.loext as string)) {
        if (e.getAttributeNS(NS.loext, 'tag') === 'edentext-placeholder') {
          const field: Node = { type: 'placeholderField', attrs: { text: (e.textContent ?? '').trim() } };
          const marks = marksFor(props, ctx.resolver, defaults);
          if (marks.length) field.marks = marks;
          out.push(field);
        } else {
          for (const n of convertInline(e, ctx, props, defaults)) out.push(n);
        }
        continue;
      }
      if (e.namespaceURI === NS.draw) {
        const conv = convertDrawElement(e, ctx);
        // A box is inline like a picture, so it stays exactly where the frame sits.
        if (conv?.inline) out.push(conv.inline);
        else if (conv?.block) out.push(conv.block);
        else if (conv?.group) out.push(...conv.group);
        continue;
      }
      if (e.namespaceURI === NS.office && (e.localName === 'annotation' || e.localName === 'annotation-end')) {
        // A ranged comment brackets its text with a named annotation/annotation-end pair;
        // a point one (LibreOffice's comment with nothing selected) carries no name and
        // sits after the text it was made on. The zone schema has no comment mark.
        if (ctx.zone) continue;
        if (e.localName === 'annotation-end') {
          const name = e.getAttributeNS(NS.office, 'name');
          if (name) ctx.openComments.delete(name);
          continue;
        }
        // An answer is an annotation of its own pointing at its comment; it is folded
        // into that comment's thread, not shown as a comment beside it.
        if (e.getAttributeNS(NS.loext, 'parent-name')) continue;
        const name = e.getAttributeNS(NS.office, 'name');
        const replies = (name && ctx.commentReplies.get(name)) || [];
        // Only where the file has one: an empty thread is the mark's default, and an
        // attr written out anyway would differ from what the editor itself holds.
        const attrs = { ...odfCommentAttrs(e), ...(replies.length ? { replies } : {}) };
        if (name) ctx.openComments.set(name, attrs);
        else points.push({ at: out.length, attrs });
        continue;
      }
    }
    settle();
  };

  walk(root, baseProps);
  // A point comment attaches to the run before it, else to the one after — it is anchored
  // at a caret, and the editor's comment is a mark that needs a range.
  for (const p of points) {
    const target = (out[p.at - 1]?.type === 'text' ? out[p.at - 1] : out[p.at]) as Node | undefined;
    if (target?.type !== 'text') continue;
    target.marks = [...(target.marks ?? []), { type: 'comment', attrs: p.attrs }];
  }
  return mergeAdjacentText(out);
}

// Every answer in the file by the comment it answers (loext:parent-name), in document
// order — the annotations themselves may come in any order.
function odfCommentReplies(body: Element): Map<string, { author: string; date: string; text: string }[]> {
  const out = new Map<string, { author: string; date: string; text: string }[]>();
  for (const el of Array.from(body.getElementsByTagNameNS(NS.office, 'annotation'))) {
    const parent = el.getAttributeNS(NS.loext, 'parent-name');
    if (!parent) continue;
    const a = odfCommentAttrs(el);
    const list = out.get(parent) ?? [];
    list.push({ author: String(a.author ?? ''), date: String(a.date ?? ''), text: String(a.text ?? '') });
    out.set(parent, list);
  }
  return out;
}

// <office:annotation> → the comment mark's attrs. `office:name` is the id where the file
// has one (a ranged comment); a point one gets a minted id.
function odfCommentAttrs(el: Element): Record<string, unknown> {
  const child = (ns: string, name: string) =>
    Array.from(el.children).find(c => c.namespaceURI === ns && c.localName === name);
  const body = Array.from(el.children)
    .filter(c => c.namespaceURI === NS.text && c.localName === 'p')
    .map(p => p.textContent ?? '')
    .join('\n');
  return {
    id: el.getAttributeNS(NS.office, 'name') || newCommentId(),
    author: child(NS.dc, 'creator')?.textContent?.trim() ?? '',
    date: child(NS.dc, 'date')?.textContent?.trim() ?? '',
    text: body.trim(),
    resolved: el.getAttributeNS(NS.loext, 'resolved') === 'true',
  };
}

// text + text:s + text would otherwise emit three identically-marked nodes.
function mergeAdjacentText(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (
      prev && n.type === 'text' && prev.type === 'text' &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])
    ) {
      prev.text! += n.text!;
    } else {
      out.push(n);
    }
  }
  return out;
}

// ODF names the line's shape and how many lines it draws; CSS has one property for
// both, and a double line wins over the shape (it is what the reader sees).
const LINE_SHAPE: Record<string, LineStyle> = {
  dotted: 'dotted', 'dot-dash': 'dotted', 'dot-dot-dash': 'dotted',
  dash: 'dashed', 'long-dash': 'dashed',
  wave: 'wavy',
};

function lineAttrs(style: string, type: string | undefined, color: string | undefined): Record<string, unknown> | undefined {
  const attrs: Record<string, unknown> = {};
  const shape = type === 'double' ? 'double' : LINE_SHAPE[style];
  if (shape) attrs.lineStyle = shape;
  const c = color && color !== 'font-color' ? normalizeColor(color) : undefined;
  if (c) attrs.lineColor = c;
  return Object.keys(attrs).length ? attrs : undefined;
}

// The line a style draws, in the shape marksFor gives a run: a run drawing exactly that
// adds nothing, a different shape or colour is direct formatting the style can't carry.
function lineSig(props: PropMap, kind: 'underline' | 'line-through'): string | null {
  const style = props[`style:text-${kind}-style`];
  if (!style || style === 'none') return null;
  const color = kind === 'underline' ? props['style:text-underline-color'] : undefined;
  return JSON.stringify(lineAttrs(style, props[`style:text-${kind}-type`], color) ?? {});
}

function capsFromOdf(props: PropMap): CapsMode | null {
  if (props['fo:font-variant'] === 'small-caps') return 'smallCaps';
  const t = props['fo:text-transform'];
  return t === 'uppercase' || t === 'lowercase' || t === 'capitalize' ? t : null;
}

// Hebrew, Arabic, Indic, Thai and CJK: a style carries western, asian and complex-script
// fonts side by side, and text is set from the set its own script belongs to. A file that
// leaves them at the defaults sets Hebrew at 12pt Times, not the 16pt the style declares.
const COMPLEX_SCRIPT_RE = /[֐-ࣿऀ-෿฀-๿ក-៿יִ-﷿ﹰ-ﻼ]/;


// The three property sets differ only by suffix; the western one has none.
const SCRIPT_ALIASES = [
  ['fo:font-size', 'style:font-size'],
  ['fo:font-weight', 'style:font-weight'],
  ['fo:font-style', 'style:font-style'],
  ['fo:font-family', 'style:font-family'],
  ['style:font-name', 'style:font-name'],
] as const;

// Fold the set belonging to the text's script onto the western keys marksFor reads. The
// choice is per text node; both formats write a span boundary where the script changes.
// The asian font is not folded: a run keeps the pair, and the editor sets each character
// from the font of its script.
function scriptProps(text: string, props: PropMap): PropMap {
  const suffix = COMPLEX_SCRIPT_RE.test(text) ? '-complex'
    : ASIAN_SCRIPT_RE.test(text) ? '-asian' : '';
  if (!suffix) return props;
  const out = { ...props };
  const folded = suffix === '-asian' ? SCRIPT_ALIASES.slice(0, 3) : SCRIPT_ALIASES;
  // The two font forms shadow each other, as everywhere else (layerTextProps).
  if (suffix === '-complex' && (props['style:font-family-complex'] || props['style:font-name-complex'])) {
    delete out['fo:font-family'];
    delete out['style:font-name'];
  }
  for (const [western, stem] of folded) {
    const value = props[`${stem}${suffix}`];
    if (value) out[western] = value;
  }
  return out;
}

function marksFor(props: PropMap, resolver: StyleResolver, defaults: BlockDefaults): Mark[] {
  const marks: Mark[] = [];
  const textStyle: Record<string, unknown> = {};

  const weight = props['fo:font-weight'];
  const bold = weight ? weight === 'bold' || parseInt(weight, 10) >= 600 : null;
  // Headings and header-row cells render bold by default (CSS): only a *non*-bold run
  // needs a mark (fontWeight:normal), and a bold run needs none.
  if (defaults.boldByDefault) {
    if (bold === false) textStyle.fontWeight = 'normal';
  } else if (bold === true) {
    marks.push({ type: 'bold' });
  }

  // Marks the block's named style already renders need no mark of their own.
  const fs = props['fo:font-style'];
  if ((fs === 'italic' || fs === 'oblique') && !defaults.italic) marks.push({ type: 'italic' });
  const ul = props['style:text-underline-style'];
  if (ul && ul !== 'none' && lineSig(props, 'underline') !== defaults.underline) {
    const line = lineAttrs(ul, props['style:text-underline-type'], props['style:text-underline-color']);
    marks.push(line ? { type: 'underline', attrs: line } : { type: 'underline' });
  }
  const lt = props['style:text-line-through-style'];
  if (lt && lt !== 'none' && lineSig(props, 'line-through') !== defaults.strike) {
    const line = lineAttrs(lt, props['style:text-line-through-type'], undefined);
    marks.push(line ? { type: 'strike', attrs: line } : { type: 'strike' });
  }

  // "super 58%" / "sub" / bare percentage (positive = raised, negative = lowered). A
  // percentage that is not one of the two presets is a freely raised run, kept in pt.
  const pos = props['style:text-position'];
  if (pos) {
    const pct = parseFloat(pos);
    if (pos.startsWith('super')) marks.push({ type: 'superscript' });
    else if (pos.startsWith('sub')) marks.push({ type: 'subscript' });
    else if (Number.isFinite(pct) && pct) {
      const size = lengthToPt(props['fo:font-size']) ?? defaults.fontSizePt;
      textStyle.textPosition = Math.round((pct / 100) * size * 10) / 10;
    }
  }

  const caps = capsFromOdf(props);
  if (caps && caps !== defaults.caps) textStyle.caps = caps;
  const em = props['style:text-emphasize'];
  if (isEmphasis(em)) textStyle.emphasis = em;

  const langs = langTagsOfProps(props);
  if (langs.west && langs.west !== defaults.lang) textStyle.lang = langs.west;
  if (langs.asian && langs.asian !== defaults.langAsian) textStyle.langAsian = langs.asian;

  const bg = props['fo:background-color'];
  if (bg && bg !== 'transparent') {
    const c = normalizeColor(bg);
    if (c) marks.push({ type: 'highlight', attrs: { color: c } });
  }

  const color = props['fo:color'] ? normalizeColor(props['fo:color']) : undefined;
  // The style's own color (black by default; an explicit black mark would fight dark/allBlack).
  if (color && color !== defaults.color) textStyle.color = color;

  const sizePt = lengthToPt(props['fo:font-size']);
  if (sizePt != null && Math.abs(sizePt - defaults.fontSizePt) > 0.05) textStyle.fontSize = formatPt(sizePt);

  const family = resolver.fontFamilyOf(props);
  if (family && !defaults.fonts.has(family.toLowerCase())) textStyle.fontFamily = family;
  const asian = resolver.asianFontOf(props);
  if (asian && !defaults.asianFonts.has(asian.toLowerCase())) textStyle.fontFamilyAsian = asian;

  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });
  return marks;
}

function formatPt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r}pt`;
}

// ---- lists -----------------------------------------------------------------------

// The master governing the most body blocks, and the one the first paragraph starts on.
// Mirrors convertBlocks' body-level dispatch: only a paragraph or heading can name one,
// and '' is the file's own default.
function masterPagesOf(elements: Element[], resolver: StyleResolver): { dominant: string | null; leading: string | null } {
  const counts = new Map<string, number>();
  let current = '';
  // The master the first paragraph names; a paragraph naming none — or a leading block
  // that is no paragraph at all, a table or a list — starts on Standard.
  let leading: string | null = null;
  const walk = (els: Element[], top = false): void => {
    for (const el of els) {
      if (el.namespaceURI === NS.text && (el.localName === 'p' || el.localName === 'h')) {
        const own = resolver.masterPageOf(el.getAttributeNS(NS.text, 'style-name'));
        leading ??= own ?? 'Standard';
        current = own ?? current;
        counts.set(current, (counts.get(current) ?? 0) + 1);
      } else if (el.namespaceURI === NS.text && el.localName === 'list') {
        const headings = outlineHeadingEls(el, resolver);
        if (headings) walk(headings);
      } else if (el.namespaceURI === NS.text && el.localName === 'section') {
        walk(Array.from(el.children));
      } else if (el.namespaceURI === NS.text && /-index$|^table-of-content$|^bibliography$/.test(el.localName)) {
        const indexBody = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
        if (indexBody) walk(Array.from(indexBody.children));
      }
      if (top) leading ??= 'Standard';
    }
  };
  walk(elements, true);
  let dominant = '';
  let governed = 0;
  for (const [name, count] of counts) {
    if (count > governed) { dominant = name; governed = count; }
  }
  return { dominant: dominant || null, leading };
}

// Whether a <text:list> around headings is chapter numbering rather than a list: it is
// the outline style, the list a heading's named style carries, or no style at all. A list
// on the heading alone is a real one — LibreOffice's bullet on a heading (probed).
function isChapterList(listEl: Element, resolver: StyleResolver): boolean {
  const name = listEl.getAttributeNS(NS.text, 'style-name');
  if (!name || name === resolver.outlineStyle()?.getAttributeNS(NS.style, 'name')) return true;
  for (const h of Array.from(listEl.getElementsByTagNameNS(NS.text, 'h'))) {
    if (resolver.paraListStyle(h.getAttributeNS(NS.text, 'style-name')) === name) return true;
  }
  return false;
}

// The heading elements of a chapter-numbering <text:list> whose leaves are all headings
// (each list-item holds only a text:h and/or nested such lists), so they import as plain
// headings. null when it's a genuine list.
function outlineHeadingEls(listEl: Element, resolver: StyleResolver): Element[] | null {
  if (!isChapterList(listEl, resolver)) return null;
  return headingLeaves(listEl);
}

function headingLeaves(listEl: Element): Element[] | null {
  const out: Element[] = [];
  for (const item of Array.from(listEl.children)) {
    if (item.namespaceURI !== NS.text || (item.localName !== 'list-item' && item.localName !== 'list-header')) continue;
    for (const child of Array.from(item.children)) {
      if (child.namespaceURI !== NS.text) return null;
      if (child.localName === 'h') {
        out.push(child);
      } else if (child.localName === 'list') {
        const nested = headingLeaves(child);
        if (!nested) return null;
        out.push(...nested);
      } else {
        return null; // a paragraph or other content ⇒ a genuine list
      }
    }
  }
  return out.length ? out : null;
}

// `inheritedStyleName`: a nested text:list usually carries no style-name of its own — the
// outermost list's style governs, one level def per depth. `govMultilevel`: inside a
// display-levels chain, so an explicit numbering here is never suppressed (null = rejoin).
// `keepHeadings`: the list is no chapter numbering, so a heading opening an item stays one.
function convertList(el: Element, ctx: Ctx, inheritedStyleName: string | null, depth: number, govMultilevel = false, baseCycle: OrderedCycle = ROOT_ORDERED_CYCLE, keepHeadings = false): Node | null {
  const styleName = el.getAttributeNS(NS.text, 'style-name') ?? inheritedStyleName;
  // A named list style travels as `listStyleName` on the outermost list; everything the
  // style's levels say stays in the registry, so no per-level attrs are derived.
  const named = ctx.resolver.isNamedListStyle(styleName);
  if (named && depth === 1) ctx.usedListStyles.add(styleName!);
  const levelDef = listLevelDef(ctx.resolver.listStyle(styleName), depth);
  const ordered = levelDef?.localName === 'list-level-style-number';
  const displayLevels = parseInt(levelDef?.getAttributeNS(NS.text, 'display-levels') ?? '1', 10);
  // A multilevel top shows plain numbers itself — detect it from its level-2 def.
  const isMultilevelTop = ordered && depth === 1
    && parseInt(listLevelDef(ctx.resolver.listStyle(styleName), 2)?.getAttributeNS(NS.text, 'display-levels') ?? '1', 10) > 1;
  const inChain = ordered && (isMultilevelTop || displayLevels > 1);
  // This list's rendered numbering re-anchors its children's default cycle (slot + suffix).
  const renderedKey = ordered && !inChain
    ? orderedTypeFromFormat(odfNumFormatOf(levelDef!), levelDef!.getAttributeNS(NS.style, 'num-suffix'))
    : null;
  const childBaseCycle = childCycle(baseCycle, inChain ? 'multilevel' : renderedKey, ordered);

  const items: Node[] = [];
  let start: number | null = null;
  for (const item of Array.from(el.children)) {
    if (item.namespaceURI !== NS.text || (item.localName !== 'list-item' && item.localName !== 'list-header')) continue;

    if (ordered && items.length === 0) {
      const sv = parseInt(item.getAttributeNS(NS.text, 'start-value') ?? '', 10);
      if (Number.isFinite(sv) && sv > 1) start = sv;
    }

    const blocks: Node[] = [];
    for (const child of Array.from(item.children)) {
      if (child.namespaceURI === NS.text && (child.localName === 'p' || child.localName === 'h')) {
        const parts = blocksOf(convertParaLike(child, ctx, 'list', false, keepHeadings || blocks.length > 0));
        for (const [i, part] of parts.entries()) {
          // LibreOffice wraps a mark between list items in text:list, each in its item.
          if (i) items.push({ type: 'listItem', content: blocks.splice(0) });
          blocks.push(part);
        }
      } else if (child.namespaceURI === NS.text && child.localName === 'list') {
        const nested = convertList(child, ctx, styleName, depth + 1, inChain, childBaseCycle, keepHeadings);
        if (nested) blocks.push(nested);
      } else if (child.namespaceURI === NS.table && child.localName === 'table') {
        // Kept in place for now; liftListTables cuts the list around it.
        const table = convertTable(child, ctx);
        if (table) blocks.push(table);
      }
    }
    // An item opening with a sub-list draws no line of its own and counts nothing, so its
    // sub-list counts its level on. One restarting it is a further sub-list of the item
    // before (our own export's form, splitNestedLists), and goes back on that item.
    const prev = items[items.length - 1];
    const opener = Array.from(item.children).find((c) => c.namespaceURI === NS.text && ['p', 'h', 'list'].includes(c.localName));
    const restarts = opener?.localName === 'list'
      && !!Array.from(opener.children).find((c) => c.localName === 'list-item')?.hasAttributeNS(NS.text, 'start-value');
    if (blocks.length && blocks[0].type !== 'paragraph' && blocks[0].type !== 'heading' && prev && restarts) {
      prev.content!.push(...blocks);
      continue;
    }
    if (!blocks.length) blocks.push({ type: 'paragraph' });
    items.push({ type: 'listItem', content: blocks });
  }
  if (items.length === 0) return null;
  let continued = false;
  if (ordered && depth === 1 && styleName) {
    // LibreOffice continues the latest list of the same style, or the one continue-list names.
    const ref = el.getAttributeNS(NS.text, 'continue-list');
    const prev = ref ? ctx.listEnds.get(`id:${ref}`)
      : el.getAttributeNS(NS.text, 'continue-numbering') === 'true' ? ctx.listEnds.get(`style:${styleName}`) : undefined;
    if (start == null && prev != null) { start = prev + 1; continued = true; }
    const styleStart = parseInt(levelDef!.getAttributeNS(NS.text, 'start-value') ?? '', 10);
    const end = (start ?? (styleStart > 0 ? styleStart : 1)) + labelledItems({ type: 'orderedList', content: items }) - 1;
    ctx.listEnds.set(`style:${styleName}`, end);
    const id = el.getAttribute('xml:id');
    if (id) ctx.listEnds.set(`id:${id}`, end);
  }

  // A level's margin-left is absolute, the editor nests one LIST_BASE_MARGIN_CM per
  // level — so the attr is this level's step past the one above, which DOM nesting adds
  // to. Signed, floored there: a list may sit left of the base, never of the column.
  let indent: number | null = null;
  if (listLevelMarginLeftCm(levelDef) != null) {
    const marginCm = (d: number) =>
      listLevelMarginLeftCm(listLevelDef(ctx.resolver.listStyle(styleName), d)) ?? d * LIST_BASE_MARGIN_CM;
    const step = marginCm(depth) - (depth > 1 ? marginCm(depth - 1) : 0);
    const extra = Math.round(Math.max(-LIST_BASE_MARGIN_CM, step - LIST_BASE_MARGIN_CM) * 100) / 100;
    if (Math.abs(extra) > LIST_INDENT_EPS_CM) indent = extra;
  }

  if (!ordered) {
    const attrs: Record<string, unknown> = {};
    if (named) {
      if (depth === 1) attrs.listStyleName = displayStyleName(styleName!, ctx.resolver.listStyleDisplayName(styleName!));
    } else {
      const raw = levelDef?.getAttributeNS(NS.text, 'bullet-char') ?? null;
      const bulletChar = bulletCharAttr(bulletCharFromOdf(raw, listLevelFontName(levelDef)), depth - 1);
      if (bulletChar) attrs.bulletChar = bulletChar;
      if (indent != null) attrs.indent = indent;
      if (listLevelRightAligned(levelDef)) attrs.markerAlign = 'right';
      Object.assign(attrs, listLevelLabel(levelDef, depth), listLevelMarker(levelDef, ctx));
    }
    const node: Node = { type: 'bulletList', content: items };
    if (Object.keys(attrs).length) node.attrs = attrs;
    return node;
  }

  let listStyleType: string | null;
  if (isMultilevelTop) {
    listStyleType = 'multilevel';
  } else if (displayLevels > 1) {
    listStyleType = null; // chain member — the multilevel top carries the attr
  } else {
    const key = renderedKey!;
    // Explicit styles inside a chain stay explicit; elsewhere the cycle default
    // (re-anchored per ancestor) imports as null so round trips don't accrete attrs.
    listStyleType = govMultilevel ? key : orderedTypeAttrAt(key, baseCycle);
  }
  const attrs: Record<string, unknown> = {};
  if (start != null) attrs.start = start;
  if (continued) attrs.continueNumbering = true;
  if (named) {
    if (depth === 1) attrs.listStyleName = displayStyleName(styleName!, ctx.resolver.listStyleDisplayName(styleName!));
  } else {
    if (listStyleType) attrs.listStyleType = listStyleType;
    if (indent != null) attrs.indent = indent;
    if (listLevelRightAligned(levelDef)) attrs.markerAlign = 'right';
    Object.assign(attrs, listLevelLabel(levelDef, depth), listLevelMarker(levelDef, ctx));
  }
  const node: Node = { type: 'orderedList', content: items };
  if (Object.keys(attrs).length) node.attrs = attrs;
  return node;
}

// The text style a level formats its label with, as the list's own marker format.
function listLevelMarker(levelDef: Element | null, ctx: Ctx): { markerFormat?: Partial<MarkerFormat> } {
  const name = levelDef?.getAttributeNS(NS.text, 'style-name');
  const props = name ? ctx.resolver.spanTextProps(name) : null;
  // The family as a run reads it, which is what the first portion it is held against has.
  const family = props && ctx.resolver.fontFamilyOf(props);
  const own = props ? markerFormatFromText({ ...textPropsFromOdf(props, ctx.resolver), ...(family ? { fontFamily: family } : {}) }) : null;
  return own ? { markerFormat: own } : {};
}

// fo:text-align="end" on the level properties: the label is set against the far end of
// its hanging indent (Word's w:lvlJc="right"), so a wide number grows into the margin.
function listLevelRightAligned(levelDef: Element | null): boolean {
  for (const props of Array.from(levelDef?.children ?? [])) {
    if (props.namespaceURI !== NS.style || props.localName !== 'list-level-properties') continue;
    const align = props.getAttributeNS(NS.fo, 'text-align');
    return align === 'end' || align === 'right';
  }
  return false;
}

// The label's hang (the negated fo:text-indent) and what follows it, where they differ
// from the flat 0.635cm and tab the editor draws. odf-kit writes depth × 0.635cm, which
// is the same default.
function listLevelLabel(levelDef: Element | null, depth: number): { hanging?: number; markerSuffix?: 'space' | 'nothing' } {
  const la = levelDef?.getElementsByTagNameNS(NS.style, 'list-level-label-alignment')[0];
  if (!la) return {};
  const out: { hanging?: number; markerSuffix?: 'space' | 'nothing' } = {};
  const ti = lengthToCm(la.getAttributeNS(NS.fo, 'text-indent'));
  const hang = ti == null ? null : Math.round(-ti * 100) / 100;
  if (hang != null && ![LIST_HANGING_CM, depth * LIST_HANGING_CM].some((d) => Math.abs(hang - d) <= LIST_INDENT_EPS_CM)) out.hanging = hang;
  const follow = la.getAttributeNS(NS.text, 'label-followed-by');
  if (follow === 'space' || follow === 'nothing') out.markerSuffix = follow;
  return out;
}

// Level's fo:margin-left (cm) from its <style:list-level-label-alignment> (the
// label-alignment mode odf-kit/LibreOffice use). null when absent.
function listLevelMarginLeftCm(levelDef: Element | null): number | null {
  if (!levelDef) return null;
  for (const props of Array.from(levelDef.children)) {
    if (props.namespaceURI !== NS.style || props.localName !== 'list-level-properties') continue;
    for (const la of Array.from(props.children)) {
      if (la.namespaceURI === NS.style && la.localName === 'list-level-label-alignment') {
        return lengthToCm(la.getAttributeNS(NS.fo, 'margin-left'));
      }
    }
  }
  return null;
}

// The level def's declared font (Word-written .odt puts Wingdings/Symbol here for
// its private-use bullet chars; LibreOffice writes real Unicode chars instead).
function listLevelFontName(levelDef: Element | null): string | null {
  if (!levelDef) return null;
  for (const props of Array.from(levelDef.children)) {
    if (props.namespaceURI !== NS.style || props.localName !== 'text-properties') continue;
    return props.getAttributeNS(NS.style, 'font-name') ?? props.getAttributeNS(NS.fo, 'font-family');
  }
  return null;
}

function listLevelDef(listStyle: Element | null, depth: number): Element | null {
  if (!listStyle) return null;
  for (const child of Array.from(listStyle.children)) {
    if (child.namespaceURI !== NS.text) continue;
    if (!child.localName.startsWith('list-level-style-')) continue;
    if (child.getAttributeNS(NS.text, 'level') === String(depth)) return child;
  }
  return null;
}

// ---- tables ------------------------------------------------------------------------

// ODF border ("0.5pt solid #000000" / "none" / absent) → the canonical '<W>pt solid
// #RRGGBB', 'none', or null; non-solid styles coerce to solid. treatDefaultAsNull folds
// the 0.5pt-black default to null — cells inherit the table's, paragraph borders don't.
export function borderAttrFromOdf(raw: string | null | undefined, treatDefaultAsNull = true): string | null {
  if (!raw || raw === 'none' || raw === 'hidden') return 'none';
  let widthPt: number | null = null;
  let color: string | null = null;
  let styleTok: string | null = null;
  for (const part of raw.trim().split(/\s+/)) {
    if (/^-?[\d.]+\s*(pt|cm|mm|in|px|pc)?$/.test(part)) widthPt = lengthToPt(part);
    else if (part.startsWith('#')) color = normalizeColor(part) ?? null;
    else styleTok = part;
  }
  if (styleTok === 'none' || styleTok === 'hidden') return 'none';
  if (widthPt != null && widthPt <= 0) return 'none';
  const w = Math.round((widthPt ?? 0.5) * 100) / 100;
  const c = (color ?? '#000000').toUpperCase();
  if (treatDefaultAsNull && Math.abs(w - 0.5) < 0.11 && c === '#000000') return null;
  return `${w}pt solid ${c}`;
}

// A formula cell's number format: its style points at a data style, whose shape is
// all we keep — its family, the decimals and the grouping. A foreign document's own
// currency symbol and date order give way to the ones the document's language spells.
function cellNumberFormat(cellEl: Element, ctx: Ctx): CellFormat | null {
  const dataName = ctx.resolver.cellDataStyle(cellEl.getAttributeNS(NS.table, 'style-name'));
  const styleEl = ctx.resolver.numberStyle(dataName);
  const kind = FORMAT_KINDS[styleEl?.localName ?? ''];
  if (!styleEl || !kind) return null;
  const num = styleEl.getElementsByTagNameNS(NS.number, 'number')[0];
  return cellFormatFromSpec({
    decimals: parseInt(num?.getAttributeNS(NS.number, 'decimal-places') ?? '0', 10) || 0,
    grouping: num?.getAttributeNS(NS.number, 'grouping') === 'true',
    kind,
  });
}

const FORMAT_KINDS: Record<string, FormatKind | undefined> = {
  'number-style': 'number', 'percentage-style': 'percent',
  'currency-style': 'currency', 'date-style': 'date',
};

// The export bakes a region's color onto every run (it is CSS in the editor); a run
// matching the region's own color carries the style, not direct formatting. Bold rides
// the boldByDefault channel instead, so an explicitly normal run keeps its override.
function unbakeRegionColor(nodes: Node[], color: string): void {
  for (const n of nodes) {
    if (n.content) unbakeRegionColor(n.content, color);
    const ts = (n.marks ?? []).find((m) => m.type === 'textStyle');
    if (ts?.attrs?.color !== color) continue;
    delete ts.attrs.color;
    if (Object.keys(ts.attrs).length === 0) {
      n.marks = n.marks!.filter((m) => m !== ts);
      if (n.marks.length === 0) delete n.marks;
    }
  }
}

// Naming another master opens a section; naming the current one again does only where
// that restarts something — its first page hands over, or it demands a side (probed:
// every chapter reopening LibreOffice's Chapter Intro opens headless on a right page).
function opensMaster(master: string, ctx: Ctx): boolean {
  const current = ctx.masterPages[ctx.masterPages.length - 1] ?? ctx.leadingMaster;
  if (master !== current) return true;
  return ctx.bodyBlocks > 0 && (!!ctx.resolver.masterPageHF(master).restPage || !!ctx.resolver.pageStartSide(master));
}

// A block whose style names a master page opens a section, exactly as a paragraph style
// does (convertParaLike): ODF's only per-section header/footer, and naming one is a page
// break. Mutates ctx, so it runs before the block is converted against the new width.
function sectionFlowAttrs(master: string | null, breakBefore: boolean, ctx: Ctx): Record<string, unknown> | null {
  const attrs: Record<string, unknown> = {};
  if (breakBefore && ctx.bodyBlocks) attrs.breakBefore = 'page';
  if (master && opensMaster(master, ctx)) {
    ctx.masterPages.push(master);
    ctx.masterPageStarts.push(null);
    const geo = ctx.resolver.pageGeometry(master);
    if (geo) { ctx.contentWidthCm = contentWidthOf(geo); ctx.leftMarginCm = geo.margins.left; Object.assign(ctx, heightsOf(geo)); }
    attrs.sectionBreak = true;
  }
  if (master && ctx.bodyBlocks) attrs.breakBefore = 'page';
  ctx.bodyBlocks++;
  return Object.keys(attrs).length ? attrs : null;
}

// A table carries both on its own style, which is where LibreOffice writes them.
function tableSectionFlow(el: Element, ctx: Ctx): Record<string, unknown> | null {
  const styleName = el.getAttributeNS(NS.table, 'style-name');
  return sectionFlowAttrs(ctx.resolver.masterPageOf(styleName, 'table'),
    ctx.resolver.tableProps(styleName)['fo:break-before'] === 'page', ctx);
}

// An index carries both on its first body paragraph — its title where it has one.
function indexSectionFlow(el: Element, ctx: Ctx): Record<string, unknown> | null {
  const body = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
  const styleName = body?.getElementsByTagNameNS(NS.text, 'p')[0]?.getAttributeNS(NS.text, 'style-name') ?? null;
  return sectionFlowAttrs(ctx.resolver.masterPageOf(styleName),
    ctx.resolver.paraProps(styleName)['fo:break-before'] === 'page', ctx);
}

function convertTable(el: Element, ctx: Ctx): Node | null {
  const weights = columnWeights(el, ctx.resolver);

  // The named table style behind the automatic one, hoisted: a registry style's regions
  // are re-derived per cell from name + look + grid position, as the editor paints them.
  const named = ctx.resolver.namedAncestor(el.getAttributeNS(NS.table, 'style-name'), 'table');
  const styleName = named ? displayStyleName(named) : null;
  const look = odfTableLook(el);
  const regStyle = styleName ? builtinTableStyles()[styleName] : undefined;
  const regLook = parseTableLook(look);

  const rowEls: { el: Element; header: boolean }[] = [];
  for (const child of Array.from(el.children)) {
    if (child.namespaceURI !== NS.table) continue;
    if (child.localName === 'table-row') rowEls.push({ el: child, header: false });
    else if (child.localName === 'table-header-rows' || child.localName === 'table-rows') {
      const header = child.localName === 'table-header-rows';
      for (const rowEl of Array.from(child.children)) {
        if (rowEl.namespaceURI === NS.table && rowEl.localName === 'table-row') rowEls.push({ el: rowEl, header });
      }
    }
  }
  // Grid extent up front — resolveTableCell needs the totals (lastRow, banding).
  const gridRows = rowEls.length;
  let gridCols = weights?.length ?? 0;
  if (!gridCols && rowEls[0]) {
    for (const c of Array.from(rowEls[0].el.children)) {
      if (c.namespaceURI !== NS.table) continue;
      const rep = Math.min(256, parseInt(c.getAttributeNS(NS.table, 'number-columns-repeated') ?? '1', 10) || 1);
      if (c.localName === 'covered-table-cell') gridCols += rep;
      else if (c.localName === 'table-cell') {
        gridCols += rep * (parseInt(c.getAttributeNS(NS.table, 'number-columns-spanned') ?? '1', 10) || 1);
      }
    }
  }

  const margins = tableMargins(el, ctx);
  const tableCm = ctx.contentWidthCm - (margins?.marginLeft ?? 0) - (margins?.marginRight ?? 0);
  const rows: Node[] = [];
  // Source-row bookkeeping: a row of only covered cells is dropped (the editor cannot
  // hold a cell-less row), so every span reaching over it must shrink by one.
  const placed: { attrs: Record<string, unknown>; row: number; span: number }[] = [];
  const dropped: number[] = [];
  let srcRow = 0;
  let cellPad: CellPadding | null | undefined;
  const addRow = (rowEl: Element, header: boolean) => {
    const rowIdx = srcRow++;
    const cells: Node[] = [];
    let colIndex = 0;
    for (const cellEl of Array.from(rowEl.children)) {
      if (cellEl.namespaceURI !== NS.table) continue;
      const repeated = Math.min(256, parseInt(cellEl.getAttributeNS(NS.table, 'number-columns-repeated') ?? '1', 10) || 1);
      if (cellEl.localName === 'covered-table-cell') {
        colIndex += repeated; // grid slots owned by a span elsewhere
        continue;
      }
      if (cellEl.localName !== 'table-cell') continue;

      const colspan = parseInt(cellEl.getAttributeNS(NS.table, 'number-columns-spanned') ?? '1', 10) || 1;
      const rowspan = parseInt(cellEl.getAttributeNS(NS.table, 'number-rows-spanned') ?? '1', 10) || 1;
      const cellStyleName = cellEl.getAttributeNS(NS.table, 'style-name');
      // ODF has no table-level cell margin: it sits on each cell's style, and fo:padding
      // defaults to 0, so a side nobody declares really is zero — left open, the cell
      // would take Word's implicit 0.19cm instead (probed).
      const padSides = ctx.resolver.cellPadding(cellStyleName).map((v) => v ?? 0);
      if (cellPad === undefined) cellPad = cellPaddingAttr(padSides);
      const ownPad = cellPaddingAttr(padSides, cellPad ?? DEFAULT_CELL_PADDING);
      const verticalAlign = ctx.resolver.cellVerticalAlign(cellStyleName);
      const rawBg = ctx.resolver.cellBackgroundColor(cellStyleName);
      const backgroundColor = normalizeColor(rawBg) ?? null;
      // Per-side borders; an undeclared side means no border in ODF → 'none'.
      // Only null (= the editor's 0.5pt-black default) is left off the attrs.
      const rawBorders = ctx.resolver.cellBorders(cellStyleName);
      const borders: Record<string, string> = {};
      for (const [attr, side] of [
        ['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left'],
      ] as const) {
        const v = borderAttrFromOdf(rawBorders[side]);
        if (v !== null) borders[attr] = v;
      }
      // Header-shaded cells and a bold region render bold by default (CSS); convert their
      // runs like headings, so a baked-bold run needs no mark and only a normal run gets one.
      const paint = regStyle ? resolveTableCell(regStyle, {
        row: rowIdx, col: colIndex, rowSpan: rowspan, colSpan: colspan,
        rows: gridRows, cols: gridCols,
      }, regLook) : null;
      const share = weights ? weights.slice(colIndex, colIndex + colspan).reduce((a, b) => a + b, 0)
        / weights.reduce((a, b) => a + b, 0) : colspan / Math.max(1, gridCols);
      const outerCellCm = ctx.cellWidthCm;
      ctx.cellWidthCm = tableCm * share - padSides[1] - padSides[3];
      let blocks: Node[];
      try {
        blocks = convertBlocks(Array.from(cellEl.children), ctx, 'cell',
          backgroundColor === HEADER_SHADE || paint?.text.bold === true);
      } finally { ctx.cellWidthCm = outerCellCm; }
      if (paint?.text.color) unbakeRegionColor(blocks, paint.text.color);
      // LibreOffice writes the formula in its own language behind an `ooow:` prefix;
      // the cached result is the cell's text and needs nothing here.
      const rawFormula = cellEl.getAttributeNS(NS.table, 'formula');
      const formula = rawFormula ? fromWriterFormula(rawFormula) : '';
      // The number format is on the cell's style, as a reference to a data style.
      const cellFormat = formula ? cellNumberFormat(cellEl, ctx) : null;
      for (let r = 0; r < repeated; r++) {
        const attrs: Record<string, unknown> = { colspan, rowspan, ...borders };
        if (paint?.regions.length) attrs.region = paint.regions.join(' ');
        if (rowspan > 1) placed.push({ attrs, row: rowIdx, span: rowspan });
        if (formula) attrs.formula = formula;
        if (cellFormat) attrs.cellFormat = cellFormat;
        if (ownPad) attrs.cellPadding = ownPad;
        if (backgroundColor) attrs.backgroundColor = backgroundColor;
        if (verticalAlign) attrs.verticalAlign = verticalAlign;
        if (weights) attrs.colwidth = weights.slice(colIndex, colIndex + colspan);
        const content = blocks.length ? structuredClone(blocks) : [{ type: 'paragraph' }];
        const revMark = ctx.resolver.recordedLine('table-cell', cellStyleName) ? lineChange(content) : undefined;
        if (revMark) attrs.revMark = revMark;
        cells.push({ type: header ? 'tableHeader' : 'tableCell', attrs, content });
        colIndex += colspan;
      }
    }
    if (cells.length === 0) { dropped.push(rowIdx); return; }

    const row: Node = { type: 'tableRow', content: cells };
    const heightCm = ctx.resolver.rowMinHeightCm(rowEl.getAttributeNS(NS.table, 'style-name'));
    if (heightCm != null && heightCm > 0) row.attrs = { rowHeight: Math.round(heightCm * PX_PER_CM) };
    if (ctx.resolver.rowKeepTogether(rowEl.getAttributeNS(NS.table, 'style-name'))) row.attrs = { ...row.attrs, cantSplit: true };
    const revMark = ctx.resolver.recordedLine('table-row', rowEl.getAttributeNS(NS.table, 'style-name')) ? lineChange(cells) : undefined;
    if (revMark) row.attrs = { ...row.attrs, revMark };
    rows.push(row);
  };

  for (const { el: rowEl, header } of rowEls) addRow(rowEl, header);

  if (rows.length === 0) return null;
  if (dropped.length) for (const p of placed) {
    const cut = dropped.filter((d) => d > p.row && d < p.row + p.span).length;
    if (cut) p.attrs.rowspan = p.span - cut;
  }
  const attrs: Record<string, unknown> = { ...(margins ?? {}), ...tableSpacing(el, ctx) };
  if (cellPad) attrs.cellPadding = cellPad;
  // The default is to allow a break, so only the explicit "no" is worth an attr.
  if (ctx.resolver.tableProps(el.getAttributeNS(NS.table, 'style-name'))['style:may-break-between-rows'] === 'false') {
    attrs.keepRows = true;
  }
  // <table:table-header-rows> is what makes both word processors repeat the first row
  // on every page the table continues on.
  if (Array.from(el.children).some(c => c.namespaceURI === NS.table && c.localName === 'table-header-rows')) {
    attrs.repeatHeader = true;
  }
  if (styleName) {
    attrs.tableStyle = styleName;
    // Which conditional areas the table opts into (ODF's table template attributes).
    // Absent ⇒ leave the attr null, so parseTableLook falls back to the default.
    // '' is a declared all-off look — dropping it would revert to the default look.
    if (look != null) attrs.tableLook = look;
  }
  return Object.keys(attrs).length ? { type: 'table', attrs, content: rows } : { type: 'table', content: rows };
}

// The six table:use-*-styles attributes → the editor's space-separated tableLook attr.
// null when the file declares none (a foreign producer), so the default look applies.
function odfTableLook(el: Element): string | null {
  const on: TableRegion[] = [];
  let declared = false;
  for (const [region, attr] of Object.entries(ODF_LOOK_ATTRS) as [TableRegion, string][]) {
    // ODF_LOOK_ATTRS holds the qualified names the exporter writes; getAttributeNS
    // wants the local one.
    const v = el.getAttributeNS(NS.table, attr.replace('table:', ''));
    if (v == null) continue;
    declared = true;
    if (v === 'true') on.push(region);
  }
  return declared ? tableLookAttr(Object.fromEntries(
    TABLE_REGIONS.map(r => [r, on.includes(r)]),
  ) as TableLook) : null;
}

// A table narrower than the text width → the editor's marginLeft/marginRight attrs.
// LibreOffice states the width plus one margin (per table:align), the other follows.
function tableMargins(el: Element, ctx: Ctx): { marginLeft?: number; marginRight?: number } | null {
  const props = ctx.resolver.tableProps(el.getAttributeNS(NS.table, 'style-name'));
  const content = ctx.contentWidthCm;
  const rel = parseFloat(props['style:rel-width'] ?? '');
  const width = lengthToCm(props['style:width'])
    ?? (Number.isFinite(rel) && rel > 0 ? (Math.min(rel, 100) / 100) * content : null);

  let left = lengthToCm(props['fo:margin-left']);
  let right = lengthToCm(props['fo:margin-right']);
  const align = props['table:align'];
  // "margins" is ODF for a table filling the space between its own: the side it does
  // not declare is 0, and style:width is the width the producer's page had, not one to
  // measure a margin against.
  if (align === 'margins') { left ??= 0; right ??= 0; }
  if (left == null && width != null) {
    left = align === 'center' ? (content - width) / 2 : align === 'right' ? content - width : 0;
  }
  left = left ?? 0; // negative is real: a table may hang into the page margin
  if (right == null) right = width != null ? content - left - width : 0;

  // Rounding noise from the producer, or a table that would be left with no room.
  if (Math.abs(left) < 0.05 && Math.abs(right) < 0.05) return null;
  if (left + right > content - 1) return null;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const l = round2(left), r = round2(right);
  // A zero side is the attr's default (null); rounding may also leave a -0 behind.
  return { ...(Math.abs(l) >= 0.005 ? { marginLeft: l } : {}), ...(Math.abs(r) >= 0.005 ? { marginRight: r } : {}) };
}

// The space a table's own style puts above and below it (fo:margin-top/-bottom on
// the table, which LibreOffice honours like a paragraph's).
function tableSpacing(el: Element, ctx: Ctx): { marginTop?: number; marginBottom?: number } {
  const props = ctx.resolver.tableProps(el.getAttributeNS(NS.table, 'style-name'));
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const out: { marginTop?: number; marginBottom?: number } = {};
  const top = lengthToCm(props['fo:margin-top']);
  const bottom = lengthToCm(props['fo:margin-bottom']);
  if (top && top > 0) out.marginTop = round3(top);
  if (bottom && bottom > 0) out.marginBottom = round3(bottom);
  return out;
}

// Per-column proportional weights for the colwidth cell attr (tableView.ts uses
// ratios only). Prefers LibreOffice's relative widths (rel-column-width) and
// falls back to absolute cm. null when the document declares no usable widths.
function columnWeights(tableEl: Element, resolver: StyleResolver): number[] | null {
  const rel: (number | null)[] = [];
  const cm: (number | null)[] = [];
  const scan = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child.namespaceURI !== NS.table) continue;
      if (child.localName === 'table-column') {
        const repeated = Math.min(256, parseInt(child.getAttributeNS(NS.table, 'number-columns-repeated') ?? '1', 10) || 1);
        const styleName = child.getAttributeNS(NS.table, 'style-name');
        for (let i = 0; i < repeated; i++) {
          rel.push(resolver.columnRelWidth(styleName));
          cm.push(resolver.columnWidthCm(styleName));
        }
      } else if (child.localName === 'table-columns' || child.localName === 'table-header-columns') {
        scan(child);
      }
    }
  };
  scan(tableEl);

  // cm values get ×100 so both forms land in comparable integer territory.
  const widths = rel.some(w => w != null) ? rel : cm.map(w => (w != null ? w * 100 : null));
  if (widths.length === 0 || widths.every(w => w == null)) return null;
  const present = widths.filter((w): w is number => w != null);
  const avg = present.reduce((a, b) => a + b, 0) / present.length;
  return widths.map(w => Math.max(1, Math.round(w ?? avg)));
}

// ODF keeps no table in a list item, yet some files carry one: the list is cut around it
// as the editor's own insert cuts it (splitListAt). What follows counts on — the outer
// list by its attr, a deeper level through the item without a label it opens with.
function liftListTables(list: Node, outer: boolean): Node[] {
  const isList = (n: Node) => n.type === 'bulletList' || n.type === 'orderedList';
  if (!JSON.stringify(list).includes('"type":"table"')) return [list];
  const out: Node[] = [];
  let part: Node = { ...list, content: [] };
  let end = (Number(list.attrs?.start) || 1) - 1;
  const cut = (table: Node, it: Node, item: Node[]) => {
    if (item.length) part.content!.push({ ...it, content: item.splice(0) });
    if (part.content!.length) {
      out.push(part);
      end = (Number(part.attrs?.start) || 1) + labelledItems(part) - 1;
    }
    out.push(table);
    const { start: _s, ...attrs } = list.attrs ?? {};
    part = { ...list, attrs: list.type === 'orderedList' && outer ? { ...attrs, start: end + 1, continueNumbering: true } : attrs, content: [] };
  };
  for (const it of list.content ?? []) {
    const item: Node[] = [];
    for (const b of it.content ?? []) {
      if (b.type === 'table') cut(b, it, item);
      else if (isList(b)) for (const p of liftListTables(b, false)) { if (p.type === 'table') cut(p, it, item); else item.push(p); }
      else item.push(b);
    }
    if (item.length) part.content!.push({ ...it, content: item });
  }
  if (part.content!.length) out.push(part);
  return out;
}

// The editor continues the ordered list before it in the same parent; the file may name
// another, so the flag stays only where counting on from that one gives the same start.
function keepContinuation(out: Node[], list: Node): Node {
  if (!list.attrs?.continueNumbering) return list;
  const prev = out.findLast((n) => n.type === 'orderedList');
  const end = prev ? (Number(prev.attrs?.start) || 1) + labelledItems(prev) - 1 : 0;
  if (end + 1 !== list.attrs.start) delete list.attrs.continueNumbering;
  return list;
}
