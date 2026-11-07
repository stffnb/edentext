import {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, InternalHyperlink, BookmarkStart, BookmarkEnd, Tab,
  FootnoteReferenceRun, EndnoteReferenceRun,
  TableOfContents,
  Table, TableRow, TableCell, Header, Footer, PageNumber, SimpleField, ImportedXmlComponent,
  CommentRangeStart, CommentRangeEnd, CommentReference, InsertedTextRun, DeletedTextRun,
  AlignmentType, LevelFormat, LevelSuffix, UnderlineType, BorderStyle, ShadingType,
  WidthType, HeightRule, PageOrientation, LineRuleType, LineNumberRestartFormat, DocumentGridType, TableLayoutType, SectionType, NumberFormat,
  HorizontalPositionAlign, VerticalPositionRelativeFrom, HorizontalPositionRelativeFrom,
  TableAnchorType, RelativeHorizontalPosition,
  TextWrappingType, TextWrappingSide, TabStopType, LeaderType,
} from 'docx';
import type { IParagraphPropertiesOptions, IRunOptions } from 'docx';
import { blockFormat, sameBlockFormat, type RevFormat } from '../editor/extensions/trackChanges';
import type { TiptapNode } from 'odf-kit';
import type {
  IRunStylePropertiesOptions, IFontAttributesProperties, ISpacingProperties, IIndentAttributesProperties,
  ILevelsOptions, IFloating, IBorderOptions, IParagraphStyleOptions, ICharacterStyleOptions,
  ITableFloatOptions,
} from 'docx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { isSvgDataUrl, svgToPngDataUrl } from '../import/imageFormats';
import { TEXTBOX_PADDING_CM, boxTextWidthCm, type TextVAlign } from '../editor/extensions/textBox';
import { colorModeOf, cropOf, wrapGap, wrapGapAttr, type ColorMode, type Crop, type WrapGap } from '../editor/extensions/image';
import { SHAPES, boxHeads, isShapeKind, isLineKind, drawingMlPath, asShapePreset, asTextArea, type PathHeads, type ShapeKind, type DrawingMlPreset, type TextArea } from '../utils/shapes';
import { cellFormatCode, isCellFormat } from '../utils/cellFormat';
import { cjkDocFont, isAsianTag, type ExportLanguage } from '../storage/documentLanguage';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import type { RecordLock } from '../storage/trackChanges.svelte';
import { pageDimsCm, formatDimsCm, type PageFormat } from '../storage/pageFormat';
import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
import type { SpacingModel } from '../storage/spacingModel';
import { HF_DISTANCE_CM, HF_ZONE_KEYS, hfIsEmpty, type HfDoc, type HfSet } from '../storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteNumFormat, type NoteSettings } from '../storage/noteSettings';
import { DOCX_SEQ_NAME, seqCategoryOf } from '../editor/extensions/caption';
import { sanitizeBookmarkName, stampBookmarkEdges, bookmarkEdgesOf } from '../editor/extensions/bookmark';
import { isCrossRefFormat, isCrossRefKind, type CrossRefFormat, type CrossRefKind } from '../editor/extensions/crossReference';
import { indexKindOf, INDEX_TITLES, INDEX_COLUMN_GAP_CM, type IndexKind } from '../editor/extensions/tableOfContents';
import { citationText, DOCX_BIB_FIELD, DOCX_SOURCE_TYPE, type BibSource } from '../editor/extensions/bibliographyEntry';
import { DOCX_STYLE_NAME, isCitationStyle, type CitationStyle } from '../utils/citationStyle';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { parseBorderAttr, type BorderSide } from '../editor/extensions/tableCellBorders';
import { parseCellPadding, DEFAULT_CELL_PADDING } from '../editor/extensions/tableCellPadding';
import { parseTabStops, type TabAlign } from '../editor/extensions/tabStops';
import { emphasisToWord, isEmphasis } from '../editor/extensions/textEffects';
import { firstLineCm, leftCm, rightCm } from '../editor/extensions/indent';
import { charStyleProps, listMarkerFormat } from '../editor/extensions/listMarker';
import { effectiveOrderedDefAt, formatOrdinal, childCycle, orderedTypeDef, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { effectiveListLevel, listStyleMarginCm, listStyleOverridden, type ListStyle as ListStyleDef } from '../styles/listStyles';
import { outlineIsEmpty, type OutlineNumbering } from '../styles/outlineNumbering';
import { defaultBulletChar } from '../utils/bulletListTypes';
import { normalizeColor, GENERATOR, mergeJoinedParagraphsJson, twinFontName, frameRank, labelledItems, type HfExport } from './odt';
import { MAX_HEADING_LEVEL } from '../styles/headings';
import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../storage/docProperties';
import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
import { EMPTY_PAGE_DECOR, isEmptyPageDecor, type PageDecor, type Watermark } from '../storage/pageDecor';
import { FOLD_MARK_MM, PUNCH_MARK_MM, MARK_START_MM, FOLD_MARK_LEN_MM, PUNCH_MARK_LEN_MM, FOLD_MARK_NAME } from '../storage/foldMarks';
import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../storage/lineNumbering';
import { DEFAULT_LINE_GRID, type LineGrid } from '../storage/lineGrid';

// The five page-number formats both word processors offer → Word's own names.
const DOCX_PAGE_NUM_FORMAT = {
  '1': NumberFormat.DECIMAL, i: NumberFormat.LOWER_ROMAN, I: NumberFormat.UPPER_ROMAN,
  a: NumberFormat.LOWER_LETTER, A: NumberFormat.UPPER_LETTER,
} as const;
import { builtinStyleSheet, DEFAULT_STYLE, resolveStyle, type Style, type StyleSheet, type TextProps } from '../styles/styleSheet';
import { parseTableLook, regionText, type TableStyle } from '../styles/tableStyles';
import { findFormat, renderFormat, docxPicture, localeTag, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from '../utils/dateTime';
import { parseLatex } from '../math/latex';
import { ommlDocument, OMML_NS } from '../math/omml';
import { deobfuscateOdttf, type EmbeddedFont } from '../fonts/embeddedFonts';

// BCP-47 tag for rendering a fixed field's cached text; set at buildDocx start from
// the document language (Word recomputes an auto field on open using its own locale).
let docLangTag = 'en-US';
// The sheet of the export in flight, so the table/cell emitters can resolve a named
// table style without threading it through every helper (mirrors odt.ts).
let exportSheet: StyleSheet = builtinStyleSheet();
let exportSpacingModel: SpacingModel = 'add';

// DOCX export. Mirrors export/odt.ts feature-for-feature, but builds OOXML via the
// `docx` library instead of odf-kit. Lazy-loaded from App.svelte so neither this
// module nor `docx` enters the initial bundle. Import is a later, separate step.

type Writable<T> = { -readonly [P in keyof T]: T[P] };

// Font shown on screen (bundled, metric-identical to Times New Roman) vs. the font
// declared in the file — same trade-off as odt.ts.
const SCREEN_FONT = 'Liberation Serif';
const DOC_FONT = 'Times New Roman';


// A font pair as w:rFonts: the western font in the slots Word sets Latin and complex text
// from, the asian one in w:eastAsia. A slot left out inherits, as the pair does on screen.
function fontPair(west: unknown, asian: unknown, map: (f: string) => string): IFontAttributesProperties | undefined {
  const w = typeof west === 'string' && west ? map(west) : undefined;
  const a = typeof asian === 'string' && asian ? map(asian) : undefined;
  return w || a ? { ascii: w, hAnsi: w, cs: w, eastAsia: a } : undefined;
}
const screenToDoc = (f: string) => (f === SCREEN_FONT ? DOC_FONT : f);

// Word keeps three languages per run; Chinese, Japanese and Korean text is read from the
// east-asian one alone, so each tag goes to the slot of its script and w:val stays free
// for the Latin words among it. A later tag wins its slot: the run's over the block's.
function langProp(...tags: unknown[]): { value?: string; eastAsia?: string } | undefined {
  const out: { value?: string; eastAsia?: string } = {};
  for (const tag of tags) if (typeof tag === 'string' && tag) out[isAsianTag(tag) ? 'eastAsia' : 'value'] = tag;
  return out.value || out.eastAsia ? out : undefined;
}

function langXml(...tags: unknown[]): string {
  const p = langProp(...tags);
  if (!p) return '';
  return `<w:lang${p.value ? ` w:val="${escapeXml(p.value)}"` : ''}${p.eastAsia ? ` w:eastAsia="${escapeXml(p.eastAsia)}"` : ''}/>`;
}

// Effective bullet glyph of a list node: its bulletChar attr, else its named list
// style's level, else the default cycle.
function bulletCharOf(node: TiptapNode, depth0: number, style: ListStyleDef | null = null): string {
  const ch = effectiveListLevel(node.attrs ?? {}, node.type === 'orderedList', style, depth0 + 1).bulletChar;
  return ch ?? defaultBulletChar(depth0);
}

// The named list style governing a top-level list (null = none, or an unknown name).
function listStyleOf(node: TiptapNode): ListStyleDef | null {
  const name = node.attrs?.listStyleName;
  return typeof name === 'string' && name ? exportSheet.list?.[name] ?? null : null;
}

// The list's numbering key after its style (node attr ?? style level ?? null).
function effOrderedKey(node: TiptapNode, style: ListStyleDef | null, depth0: number): string | null {
  return effectiveListLevel(node.attrs ?? {}, node.type === 'orderedList', style, depth0 + 1).listStyleType;
}

// A `start` attr anywhere means a numbering continued across a split — only a private
// reference can carry that; the style's shared abstract starts every instance at 1.
function subtreeHasStart(node: TiptapNode): boolean {
  if (typeof node.attrs?.start === 'number' && node.attrs.start > 1) return true;
  return (node.content ?? []).some(subtreeHasStart);
}

// List geometry: 0.5in left step per level, 0.25in hanging for the marker (Word defaults).
const LIST_LEFT_STEP_CM = 1.27;
const LIST_HANGING_CM = 0.635;
// A list's hang as Word splits it by sign: a negative one is a first-line indent.
function listHangIndent(hangingCm: number | null): { hanging?: number; firstLine?: number } {
  const cm = hangingCm ?? LIST_HANGING_CM;
  return cm < 0 ? { firstLine: cmToTwip(-cm) } : { hanging: cmToTwip(cm) };
}

// ODF num-format char → Word numbering format.
const ORDERED_FORMAT: Record<string, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  '1': LevelFormat.DECIMAL,
  a: LevelFormat.LOWER_LETTER,
  A: LevelFormat.UPPER_LETTER,
  i: LevelFormat.LOWER_ROMAN,
  I: LevelFormat.UPPER_ROMAN,
  // Word has one letter format per alphabet and repeats the letter past the last one;
  // LibreOffice writes both of its counting modes to it.
  aa: LevelFormat.LOWER_LETTER,
  AA: LevelFormat.UPPER_LETTER,
  'а, б, .., аа, аб, ... (ru)': LevelFormat.RUSSIAN_LOWER,
  'а, б, .., аа, бб, ... (ru)': LevelFormat.RUSSIAN_LOWER,
  'А, Б, .., Аа, Аб, ... (ru)': LevelFormat.RUSSIAN_UPPER,
  'А, Б, .., Аа, Бб, ... (ru)': LevelFormat.RUSSIAN_UPPER,
  // Probed: LibreOffice writes chineseCountingThousand for 一、二、三 and reads
  // chineseCounting as the same thing.
  '一, 二, 三, ...': LevelFormat.CHINESE_COUNTING_THOUSAND,
  '壹, 贰, 叁, ...': LevelFormat.CHINESE_LEGAL_SIMPLIFIED,
  '甲, 乙, 丙, ...': LevelFormat.IDEOGRAPH_TRADITIONAL,
  '①, ②, ③, ...': LevelFormat.DECIMAL_ENCLOSED_CIRCLE,
  'ア, イ, ウ, ...': LevelFormat.AIUEO_FULL_WIDTH,
  'イ, ロ, ハ, ...': LevelFormat.IROHA_FULL_WIDTH,
};

// ---- unit conversions ------------------------------------------------------
const TWIPS_PER_CM = 1440 / 2.54; // 566.929
const cmToTwip = (cm: number) => Math.round(cm * TWIPS_PER_CM);
const ptToTwip = (pt: number) => Math.round(pt * 20);
const pxToTwip = (px: number) => Math.round((px * 1440) / 96); // px @96dpi → twips

const DOCX_TAB_TYPE: Record<TabAlign, (typeof TabStopType)[keyof typeof TabStopType]> = {
  left: TabStopType.LEFT, center: TabStopType.CENTER,
  right: TabStopType.RIGHT, decimal: TabStopType.DECIMAL,
};
// The fill character a stop repeats across its gap; anything else means none.
const DOCX_LEADER: Record<string, (typeof LeaderType)[keyof typeof LeaderType] | undefined> = {
  '.': LeaderType.DOT, '-': LeaderType.HYPHEN, '_': LeaderType.UNDERSCORE, '·': LeaderType.MIDDLE_DOT,
};
const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
const EMU_PER_CM = 360000;

// Sentinel wrapping a formula's index inside its own run; the library has no OMML, so
// applyFormulasDocx swaps that run for <m:oMath> in the same post-pack pass. U+E012,
// matching export/odt.ts's MTH.
const MTH = '';

// Sentinel wrapping a ruby annotation's index inside its own run; the library has no
// w:ruby, so applyRubyDocx swaps that run for one. U+E021, matching export/odt.ts.
const RBY = '\uE021';

// A placeholder field becomes a tagged <w:sdt> content control the package can't emit;
// applyPlaceholdersDocx swaps the sentinel run for one. U+E022, matching export/odt.ts.
const PLH = '\uE022';
export const PLACEHOLDER_SDT_TAG = 'edentext-placeholder';

// Formulas collected while serializing, in document order (module-level like
// docLangTag: inlineToRuns is reached from every block path without a collector).
type FormulaDocx = { latex: string; display: boolean; align?: unknown };
let docFormulas: FormulaDocx[] = [];

// The ruby annotations, in the same document order their sentinels are met in.
type RubyDocx = { base: string; text: string };
let docRubies: RubyDocx[] = [];
let docPlaceholders: string[] = [];
// Every list instance a header or footer uses (zoneLists): the package writes
// numbering.xml before its header parts, so their instances are registered ahead.
let docZoneLists: { reference: string; instance: number }[] | null = null;

// The sources cited, one per tag in document order — Word keeps them in a custom-XML
// part and the CITATION fields only name the tag. Module-level like docFormulas.
let docSources: BibSource[] = [];

// The document's citation style: its bibliography index carries it, as in both formats.
function docCitationStyle(node: TiptapNode): CitationStyle {
  if (node.type === 'tableOfContents' && node.attrs?.index === 'bibliography'
    && isCitationStyle(node.attrs?.citationStyle)) return node.attrs.citationStyle;
  for (const child of node.content ?? []) {
    const found = docCitationStyle(child);
    if (found !== 'key') return found;
  }
  return 'key';
}

// Word numbers footnotes and endnotes in separate files, so each class counts from 1.
// Filled from the note section before the body is walked, then read by the anchor —
// module-level for the same reason as docFormulas.
let docNoteIds = new Map<string, { id: number; kind: NoteKind; label: string | null }>();
// The boxes inlineToRuns met, in document order; applyTextBoxesDocx writes them. A
// module-level collector like docNoteIds: a box sits in a run, and the run builder is
// reached from every paragraph path there is.
let docTextBoxes: TextBoxDocx[] = [];
// A box's tables: tableToDocx needs the package's numbering and styles, so each is
// staged at the body's end and applyTextBoxesDocx moves its XML into the box.
let docBoxTables: { node: TiptapNode; widthCm: number }[] = [];

// Comments, numbered in document order before the runs are built — Word's ids are
// integers and word/comments.xml has to exist before the Document is constructed.
type CommentDocx = { id: number; author: string; date: Date; text: string; resolved: boolean; parent?: number };
let docComments: CommentDocx[] = [];
let docCommentIds = new Map<string, number>();
// The answers in each comment's thread, by the comment's Word id: each is a comment of
// its own, referenced at the same anchor and tied to its parent in commentsExtended.xml.
let docCommentReplies = new Map<number, number[]>();

function collectComments(node: TiptapNode): void {
  for (const child of node.content ?? []) {
    const marks = child.type === 'text' ? (child.marks ?? []).filter(m => m.type === 'comment' && m.attrs?.id) : [];
    for (const mark of marks) {
      const id = String(mark.attrs?.id);
      if (docCommentIds.has(id)) continue;
      const parsed = (raw: string) => {
        const date = new Date(raw);
        return Number.isNaN(date.getTime()) ? new Date() : date;
      };
      const parent = docComments.length;
      docCommentIds.set(id, parent);
      docComments.push({
        id: parent,
        author: String(mark.attrs?.author ?? ''),
        date: parsed(String(mark.attrs?.date ?? '')),
        text: String(mark.attrs?.text ?? ''),
        resolved: mark.attrs?.resolved === true,
      });
      const replies = Array.isArray(mark.attrs?.replies) ? mark.attrs.replies : [];
      if (replies.length) {
        docCommentReplies.set(parent, replies.map((r: { author?: string; date?: string; text?: string }) => {
          const id = docComments.length;
          docComments.push({
            id, parent,
            author: String(r?.author ?? ''),
            date: parsed(String(r?.date ?? '')),
            text: String(r?.text ?? ''),
            resolved: false,
          });
          return id;
        }));
      }
    }
    if (!marks.length) collectComments(child);
  }
}

// Sentinel wrapping a text box's index in a marker paragraph (same trick as
// export/odt.ts): the docx library can't emit DrawingML shapes, so buildDocx swaps
// the marker for a hand-built <w:drawing><wps:wsp> in a zip post-processing pass.
const TBX = '';
// Brackets a box's staged table (S/E), whose place in the box is a `boxTable` block.
const TBT = '';
// Wraps the index of a numbering definition minted for a box's list; the ids only
// become known once the packed numbering.xml is in hand.
const TXBX_NUM = '';
// Marks a paragraph whose w:pPr must gain <w:suppressAutoHyphens/> — the docx package
// has no option for it, so a post-pack pass writes it and drops this run.
const NOHYP = '';
// Marks a paragraph off the page's line grid: <w:snapToGrid w:val="0"/>, the same way.
const NOSNAP = '\uE023';
// Wraps the w:ind character attributes the docx package lacks (leftChars, rightChars, …),
// which the same pass adds to the paragraph's w:ind.
const INDC = '\uE025';

// Wraps a picture's crop in its name (docPr); the docx package writes an empty
// <a:srcRect/>, which a post-pack pass fills from it. Its colour mode rides the same way.
const CROP = '\uE030';
const COLOR = '\uE031';

// Brackets the runs of a recorded atom (picture, formula, field): the package's revision
// runs hold only text, so applyAtomRevisionsDocx swaps each pair for its w:ins or w:del.
const ARV = '\uE032';
type AtomRevisionDocx = { el: 'w:ins' | 'w:del'; id: number; author: string; date: string };
let docAtomRevisions: AtomRevisionDocx[] = [];

// The two bracket texts for an atom carrying a recorded change, else null.
function atomRevisionMarks(node: TiptapNode): [string, string] | null {
  if (node.type === 'text' || node.type === 'hardBreak') return null;
  const rev = revisionOf(node), under = stackedOf(node);
  if (!rev) return null;
  docAtomRevisions.push({ el: rev.kind === 'insertion' ? 'w:ins' : 'w:del',
    id: under ? stackedDelId(rev, under) : docRevisionId(rev.attrs.id), author: rev.attrs.author, date: rev.attrs.date });
  const i = docAtomRevisions.length - 1;
  return [`${ARV}o${i}${ARV}`, `${ARV}c${i}${ARV}`];
}
let docPictureMarks = false;
const srcRectXml = (c: Crop | null) => c
  ? `<a:srcRect l="${Math.round(c.l * 100000)}" t="${Math.round(c.t * 100000)}" r="${Math.round(c.r * 100000)}" b="${Math.round(c.b * 100000)}"/>`
  : '<a:srcRect/>';
// The blip effect for a colour mode: the washout pair is what both word processors write.
const BLIP_EFFECT: Record<ColorMode, string> = {
  greyscale: '<a:grayscl/>',
  mono: '<a:biLevel thresh="50000"/>',
  watermark: '<a:lum bright="70000" contrast="-70000"/>',
};

const WP_NS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// CSS font-size string ("12pt", "16px", "1.2em") → Word half-points. em is relative
// to the 12pt body. Returns undefined when unparseable.
function fontSizeToHalfPoints(css: string): number | undefined {
  const m = /^([\d.]+)\s*(pt|px|em|rem)?$/.exec(css.trim());
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2] || 'pt';
  const pt = unit === 'px' ? n * 0.75 : unit === 'em' || unit === 'rem' ? n * 12 : n;
  return Math.max(1, Math.round(pt * 2));
}

// normalizeColor → Word's #-less uppercase hex; named colors pass through (rarely used).
function hexColor(input: string): string | undefined {
  const n = normalizeColor(input);
  if (!n) return undefined;
  return n.startsWith('#') ? n.slice(1) : n;
}

// The level's number/bullet formatting (w:lvl/w:rPr) — Word carries it per level, so
// only a list whose items agree has one (listMarkerFormat).
function markerRunProps(node: TiptapNode): Writable<IRunStylePropertiesOptions> | undefined {
  const format = listMarkerFormat(node, charStyleProps(exportSheet));
  if (!format) return undefined;
  const props: Writable<IRunStylePropertiesOptions> = {};
  if (format.fontFamily) props.font = format.fontFamily === SCREEN_FONT ? DOC_FONT : format.fontFamily;
  if (format.fontWeight) props.bold = !/^(normal|400)$/.test(format.fontWeight);
  if (format.fontStyle === 'italic') props.italics = true;
  if (format.fontSize) props.size = fontSizeToHalfPoints(format.fontSize);
  if (format.color) props.color = hexColor(format.color);
  return props;
}

// ---- numbering registry ----------------------------------------------------
// docx needs every numbering definition up front, so the body is built first: one
// reference per top-level list, each nesting level's format filled in when first met.
class Numbering {
  readonly config: { reference: string; levels: ILevelsOptions[] }[] = [];
  private map = new Map<string, ILevelsOptions[]>();
  private mlRefs = new Set<string>();
  private counter = 0;
  private styleRefs = new Map<string, { reference: string; configIndex: number; instances: number; lastEnd: number }>();
  // The last ordered list written, which a continued one (orderedList.ts) shares its
  // numbering with, as Word counts one numId on across whatever stands between.
  lastOrdered: { reference: string; instance: number; end: number } | null = null;

  newReference(): string {
    const reference = `num-${this.counter++}`;
    const levels: ILevelsOptions[] = [];
    this.map.set(reference, levels);
    this.config.push({ reference, levels });
    return reference;
  }

  // One shared reference per named list style, all 9 levels pre-filled from its
  // definition; each list gets its own instance, so every one restarts at the style's
  // start (the library writes one w:num with a startOverride per instance). A list whose
  // `start` is one past the previous list's last number shares that instance, so the
  // count runs on; any other `start` gets null and a private reference.
  refForStyle(style: ListStyleDef, start: number | null, items: number): { reference: string; instance: number } | null {
    let entry = this.styleRefs.get(style.name);
    if (!entry) {
      const reference = `num-style-${this.styleRefs.size}`;
      const levels: ILevelsOptions[] = [];
      for (let l = 0; l < 9; l++) {
        const def = style.levels[l];
        const indent: IIndentAttributesProperties = {
          left: cmToTwip(listStyleMarginCm(style, l + 1)), hanging: cmToTwip(LIST_HANGING_CM),
        };
        const alignment = def?.markerAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
        if (def?.kind === 'bullet') {
          levels.push({
            level: l, format: LevelFormat.BULLET, text: def.bulletChar ?? defaultBulletChar(l),
            alignment, style: { paragraph: { indent } },
          });
        } else {
          const t = orderedTypeDef(style.multilevel ? 'decimal' : def?.numType ?? 'decimal');
          levels.push({
            level: l,
            format: ORDERED_FORMAT[t.numFormat] ?? LevelFormat.DECIMAL,
            text: style.multilevel ? Array.from({ length: l + 1 }, (_, i) => `%${i + 1}.`).join('') : `%${l + 1}${t.numSuffix}`,
            alignment, start: def?.startAt ?? 1,
            style: { paragraph: { indent } },
          });
        }
      }
      this.map.set(reference, levels);
      if (style.multilevel) this.mlRefs.add(reference);
      entry = { reference, configIndex: this.config.length, instances: 0, lastEnd: 0 };
      this.config.push({ reference, levels });
      this.styleRefs.set(style.name, entry);
    }
    const continues = start != null && start > 1;
    if (continues && (entry.instances === 0 || start !== entry.lastEnd + 1)) return null;
    entry.lastEnd = (continues ? start : style.levels[0]?.startAt ?? 1) + items - 1;
    return { reference: entry.reference, instance: continues ? entry.instances - 1 : entry.instances++ };
  }

  // Chapter numbering: one multilevel abstract the heading styles are bound to
  // post-pack (Word's own shape — w:pStyle per level, w:numPr on the style).
  outlineRef(outline: OutlineNumbering): number {
    const reference = 'num-outline';
    const levels: ILevelsOptions[] = [];
    for (let l = 0; l < 9; l++) {
      const def = outline[l];
      if (!def || def.format === 'none') {
        levels.push({ level: l, format: LevelFormat.NONE, text: '', start: 1 });
        continue;
      }
      const from = Math.max(1, l + 1 - Math.max(1, def.displayLevels) + 1);
      const chain = [];
      for (let k = from; k <= l + 1; k++) if (outline[k - 1]?.format !== 'none') chain.push(`%${k}`);
      // The label's own run and the indent it hangs out of; a level with no stop to
      // run to is followed by nothing, its gap already part of the label text.
      const run = def.labelText ? runPropsOf(def.labelText) : {};
      const indent: Writable<IIndentAttributesProperties> = {};
      if (def.indentCm) indent.left = cmToTwip(def.indentCm);
      if (def.firstIndentCm) {
        if (def.firstIndentCm < 0) indent.hanging = cmToTwip(-def.firstIndentCm);
        else indent.firstLine = cmToTwip(def.firstIndentCm);
      }
      const style: { run?: IRunStylePropertiesOptions; paragraph?: { indent: IIndentAttributesProperties } } = {};
      if (Object.keys(run).length) style.run = run;
      if (Object.keys(indent).length) style.paragraph = { indent };
      levels.push({
        level: l,
        format: ORDERED_FORMAT[def.format] ?? LevelFormat.DECIMAL,
        text: `${def.prefix}${chain.join('.')}${def.suffix}`,
        start: def.start ?? 1,
        alignment: AlignmentType.LEFT,
        suffix: def.tabCm == null ? LevelSuffix.NOTHING : LevelSuffix.TAB,
        ...(Object.keys(style).length ? { style } : {}),
      });
    }
    this.map.set(reference, levels);
    const index = this.config.length;
    this.config.push({ reference, levels });
    return index;
  }

  // The styles whose shared abstract the post-pack pass links (w:styleLink); the
  // config index locates it in numbering.xml behind the library's default abstract.
  styleLinks(): { name: string; configIndex: number }[] {
    return [...this.styleRefs.entries()].map(([name, e]) => ({ name, configIndex: e.configIndex }));
  }

  // A level keeps the first format it saw, so a sibling nested list of another kind,
  // number format, bullet char or label formatting forks its own reference (the ODT side mints its own
  // list style). The fork copies the shallower levels so the importer's cycle walk
  // (listBaseCycle) still sees the ancestry.
  forkFor(reference: string, depth: number, node: TiptapNode, cycle: OrderedCycle, style: ListStyleDef | null = null): string {
    const levels = this.map.get(reference)!;
    const l = levels.find((lv) => lv.level === depth);
    if (!l) return reference;
    // The style level's kind decides what the depth renders, whatever the node species.
    const eff = effectiveListLevel(node.attrs ?? {}, node.type === 'orderedList', style, depth + 1);
    let format: string, text: string;
    if (eff.kind === 'number') {
      const attr = eff.listStyleType;
      const def = effectiveOrderedDefAt(attr === 'multilevel' ? 'decimal' : attr, cycle);
      format = ORDERED_FORMAT[def.numFormat] ?? LevelFormat.DECIMAL;
      text = `%${depth + 1}${def.numSuffix}`;
      if (this.mlRefs.has(reference) && !node.attrs?.listStyleType) return reference; // chain member inherits
    } else {
      format = LevelFormat.BULLET;
      text = bulletCharOf(node, depth, style);
    }
    if (l.format === format && l.text === text
      && JSON.stringify(l.style?.run ?? null) === JSON.stringify(markerRunProps(node) ?? null)) return reference;
    const fork = this.newReference();
    this.map.get(fork)!.push(...levels.filter((lv) => lv.level < depth));
    return fork;
  }

  ensureLevel(reference: string, depth: number, node: TiptapNode, extraIndentCm: number, cycle: OrderedCycle, style: ListStyleDef | null = null): void {
    // A multilevel top list turns the whole reference into a "%1.%2." chain; its
    // attr-less nested lists inherit it (the top registers first — pre-order walk).
    if (depth === 0 && effOrderedKey(node, style, 0) === 'multilevel') this.mlRefs.add(reference);
    const levels = this.map.get(reference)!;
    if (levels.some((l) => l.level === depth)) return;
    // w:lvlJc: which end of the hanging indent the label is set against.
    const eff = effectiveListLevel(node.attrs ?? {}, node.type === 'orderedList', style, depth + 1);
    const alignment = eff.markerAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
    const indent: IIndentAttributesProperties = {
      left: cmToTwip((depth + 1) * LIST_LEFT_STEP_CM + extraIndentCm),
      ...listHangIndent(eff.hanging),
    };
    const suffix = eff.markerSuffix === 'space' ? LevelSuffix.SPACE : eff.markerSuffix === 'nothing' ? LevelSuffix.NOTHING : undefined;
    if (eff.kind === 'number') {
      const attr = eff.listStyleType;
      const chained = this.mlRefs.has(reference) && (depth === 0 || !attr || attr === 'multilevel');
      const def = effectiveOrderedDefAt(attr === 'multilevel' ? 'decimal' : attr, cycle);
      levels.push({
        level: depth,
        format: chained ? LevelFormat.DECIMAL : ORDERED_FORMAT[def.numFormat] ?? LevelFormat.DECIMAL,
        text: chained
          ? Array.from({ length: depth + 1 }, (_, i) => `%${i + 1}.`).join('')
          : `%${depth + 1}${def.numSuffix}`,
        alignment,
        start: typeof node.attrs?.start === 'number' ? node.attrs.start : eff.startAt ?? 1,
        style: { paragraph: { indent }, run: markerRunProps(node) },
        ...(suffix ? { suffix } : {}),
      });
    } else {
      levels.push({
        level: depth,
        format: LevelFormat.BULLET,
        // The Unicode char goes into w:lvlText literally; Word renders it in the
        // paragraph font (no Wingdings/Symbol rFonts needed).
        text: bulletCharOf(node, depth, style),
        alignment,
        style: { paragraph: { indent }, run: markerRunProps(node) },
        ...(suffix ? { suffix } : {}),
      });
    }
  }
}

// ---- inline runs -----------------------------------------------------------
function markPresent(marks: TiptapNode['marks'], type: string): boolean {
  return !!marks?.some((m) => m.type === type);
}

// The underline mark's CSS line style → Word's name for the same shape, plus its colour.
function wordUnderline(attrs: Record<string, unknown> | undefined): { type: (typeof UnderlineType)[keyof typeof UnderlineType]; color?: string } {
  const byStyle: Record<string, (typeof UnderlineType)[keyof typeof UnderlineType]> = {
    double: UnderlineType.DOUBLE, dotted: UnderlineType.DOTTED,
    dashed: UnderlineType.DASH, wavy: UnderlineType.WAVE,
  };
  const type = byStyle[String(attrs?.lineStyle ?? '')] ?? UnderlineType.SINGLE;
  const color = attrs?.lineColor ? hexColor(String(attrs.lineColor)) : undefined;
  return color ? { type, color } : { type };
}

// TipTap marks + textStyle attrs → Word run properties. `force` bakes a cell's
// presentational formatting (header row, table-style region) onto every run,
// respecting an explicit fontWeight:normal un-bold.
function runPropsFromMarks(marks: TiptapNode['marks'] = [], force: TextProps = {}): Writable<IRunStylePropertiesOptions> {
  const ts = marks.find((m) => m.type === 'textStyle');
  const props: Writable<IRunStylePropertiesOptions> & { style?: string } = {};

  // A named character style (w:rStyle); the run's own marks below still win.
  const charStyle = marks.find((m) => m.type === 'charStyle')?.attrs?.name;
  if (typeof charStyle === 'string' && charStyle) props.style = docxStyleId(charStyle);

  let bold: boolean | undefined = markPresent(marks, 'bold') || undefined;
  const fw = ts?.attrs?.fontWeight;
  if (fw != null) {
    const s = String(fw);
    if (s === 'normal' || s === '400') bold = false;
    else if (s === 'bold' || /^[5-9]\d\d$/.test(s)) bold = true;
  }
  if (force.bold && bold !== false) bold = true;
  if (bold !== undefined) props.bold = bold;

  if (markPresent(marks, 'italic') || force.italic) props.italics = true;
  const u = marks.find((m) => m.type === 'underline');
  if (u) props.underline = wordUnderline(u.attrs);
  const st = marks.find((m) => m.type === 'strike');
  if (st) { if (st.attrs?.lineStyle === 'double') props.doubleStrike = true; else props.strike = true; }
  if (markPresent(marks, 'superscript')) props.superScript = true;
  else if (markPresent(marks, 'subscript')) props.subScript = true;

  // Word reads a run's language from its own w:rPr only, so the paragraph's rides in
  // via `force` — ODF needs none of this, LibreOffice passes the block's on to the runs.
  const language = langProp(force.lang, force.langAsian, ts?.attrs?.lang, ts?.attrs?.langAsian);
  if (language) props.language = language;

  const caps = ts?.attrs?.caps;
  if (caps === 'smallCaps') props.smallCaps = true;
  else if (caps === 'uppercase') props.allCaps = true;
  const pos = ts?.attrs?.textPosition;
  // Half-points, as Word writes them: LibreOffice takes the number and ignores a unit
  // behind it. The library's type wants the unit, the file does not.
  if (typeof pos === 'number' && pos) props.position = String(Math.round(pos * 2)) as `${number}pt`;
  const em = ts?.attrs?.emphasis;
  if (isEmphasis(em)) props.emphasisMark = { type: emphasisToWord(em) as 'dot' };

  const font = fontPair(ts?.attrs?.fontFamily ?? force.fontFamily, ts?.attrs?.fontFamilyAsian ?? force.fontFamilyAsian, screenToDoc);
  if (font) props.font = font;
  const fs = ts?.attrs?.fontSize ?? (force.fontSizePt != null ? `${force.fontSizePt}pt` : null);
  if (fs) {
    const hp = fontSizeToHalfPoints(String(fs));
    if (hp) props.size = hp;
  }
  const col = ts?.attrs?.color ?? force.color;
  if (col) {
    const h = hexColor(String(col));
    if (h) props.color = h;
  }
  const hl = marks.find((m) => m.type === 'highlight');
  if (hl?.attrs?.color) {
    const h = hexColor(String(hl.attrs.color));
    if (h) props.shading = { type: ShadingType.CLEAR, fill: h };
  }
  // Visible hyperlink styling (the ExternalHyperlink wrapper carries the target), unless
  // the link came in without one — Word draws those like the text around them. The blue
  // outranks a baked region color, as the editor's a-rule beats the region CSS.
  if (marks?.some((m) => m.type === 'link' && !m.attrs?.plain)) {
    if (!ts?.attrs?.color) props.color = '0563C1';
    if (!props.underline) props.underline = { type: UnderlineType.SINGLE };
  }
  return props;
}

// A text node → one run; tab chars become <w:tab/> via mixed children (a literal \t
// would otherwise be dropped). Returned as an array so a link wrapper can adopt it.
function textNodeToRuns(node: TiptapNode, force: TextProps): Inline[] {
  const text = node.text ?? '';
  const props = runPropsFromMarks(node.marks, force);
  const opts = text.includes('\t')
    ? { children: tabbedChildren(text), ...props }
    : { text, ...props };
  return [revisedRun(node, opts, force)];
}

// A format change is the run's w:rPrChange, the earlier properties from the same builder.
function formatRevision(node: TiptapNode, force: TextProps): Pick<IRunOptions, 'revision'> {
  const m = node.marks?.find((x) => x.type === 'formatChange');
  if (!m) return {};
  const a = m.attrs as { id: string; author: string; date: string; old: TiptapNode['marks'] | null };
  return { revision: { ...runPropsFromMarks(a.old ?? [], force), id: docRevisionId(a.id), author: a.author, date: a.date } };
}

// A recorded revision wraps the run: w:ins keeps its text, w:del turns it into
// w:delText — the package's own two run kinds. A line break takes its mark the same way.
function revisedRun(node: TiptapNode, plain: IRunOptions, force: TextProps = {}): TextRun | InsertedTextRun | DeletedTextRun {
  const rev = revisionOf(node), under = stackedOf(node), opts = { ...plain, ...formatRevision(node, force) };
  if (!rev) return new TextRun(opts);
  const attrs = { id: under ? stackedDelId(rev, under) : docRevisionId(rev.attrs.id), author: rev.attrs.author, date: rev.attrs.date };
  return rev.kind === 'insertion'
    ? new InsertedTextRun({ ...opts, ...attrs })
    : new DeletedTextRun({ ...opts, ...attrs });
}

function tabbedChildren(text: string): (string | Tab)[] {
  const children: (string | Tab)[] = [];
  text.split('\t').forEach((p, i) => {
    if (i > 0) children.push(new Tab());
    if (p) children.push(p);
  });
  return children;
}

// The insertion/deletion mark on a run, if any (trackChanges.ts); the deletion where one
// author struck what another inserted, the insertion then lying under it (`stackedOf`).
function revisionOf(node: TiptapNode): { kind: 'insertion' | 'deletion'; attrs: { id: string; author: string; date: string } } | null {
  const m = node.marks?.find((x) => x.type === 'deletion') ?? node.marks?.find((x) => x.type === 'insertion');
  if (!m) return null;
  return revisionAttrsOf(m);
}

function stackedOf(node: TiptapNode): ReturnType<typeof revisionOf> {
  const m = node.marks?.some((x) => x.type === 'deletion') ? node.marks.find((x) => x.type === 'insertion') : undefined;
  return m ? revisionAttrsOf(m) : null;
}

function revisionAttrsOf(m: NonNullable<TiptapNode['marks']>[number]): NonNullable<ReturnType<typeof revisionOf>> {
  const a = m.attrs ?? {};
  return {
    kind: m.type as 'insertion' | 'deletion',
    attrs: {
      id: String(a.id ?? ''),
      author: String(a.author ?? '') || GENERATOR,
      // Word wants a UTC stamp; a file's own is kept when it parses.
      date: typeof a.date === 'string' && a.date ? a.date : new Date().toISOString(),
    },
  };
}

// Word numbers its revisions; the editor's ids are strings, so they are handed out in
// first-seen order and every run of one change keeps the same number.
let docRevisionIds = new Map<string, number>();
// Word nests the deletion of another's insertion in that w:ins; the package cannot, so each
// such w:del gets an id of its own and `applyStackedRevisionsDocx` wraps it.
let docStacked = new Map<number, { id: number; author: string; date: string }>();

function stackedDelId(rev: NonNullable<ReturnType<typeof revisionOf>>, under: NonNullable<ReturnType<typeof revisionOf>>): number {
  const id = docRevisionId(`${rev.attrs.id} ${under.attrs.id}`);
  docStacked.set(id, { id: docRevisionId(under.attrs.id), author: under.attrs.author, date: under.attrs.date });
  return id;
}

// A run as raw XML in its w:ins or w:del — the w:del inside the w:ins it struck through.
function wrapRevisionXml(run: string, rev: NonNullable<ReturnType<typeof revisionOf>>, under: ReturnType<typeof revisionOf>): string {
  const el = rev.kind === 'insertion' ? 'w:ins' : 'w:del';
  const open = (tag: string, r: NonNullable<ReturnType<typeof revisionOf>>, id: number) =>
    `<${tag} w:id="${id}" w:author="${escapeXml(r.attrs.author)}" w:date="${escapeXml(r.attrs.date)}">`;
  const wrapped = `${open(el, rev, docRevisionId(rev.attrs.id))}${run}</${el}>`;
  return under ? `${open('w:ins', under, docRevisionId(under.attrs.id))}${wrapped}</w:ins>` : wrapped;
}

// A recorded paragraph mark: <w:ins> and <w:del> in the mark's own run properties.
function revMarkRevisions(revMark: unknown) {
  const out: { insertion?: { id: number; author: string; date: string }; deletion?: { id: number; author: string; date: string } } = {};
  for (const kind of ['insertion', 'deletion'] as const) {
    const attrs = (revMark as Record<string, Record<string, unknown>> | null | undefined)?.[kind];
    if (attrs) out[kind] = { ...revisionAttrsOf({ type: kind, attrs }).attrs, id: docRevisionId(String(attrs.id ?? '')) };
  }
  return out;
}

function docRevisionId(id: string): number {
  const seen = docRevisionIds.get(id);
  if (seen != null) return seen;
  const next = docRevisionIds.size;
  docRevisionIds.set(id, next);
  return next;
}

type Inline = TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | SimpleField
  | CommentRangeStart | CommentRangeEnd | InsertedTextRun | DeletedTextRun;
// docx types a paragraph's children without the split bookmark ends its own examples put there.
const bookmarkEdge = (edge: BookmarkStart | BookmarkEnd) => edge as unknown as Inline;

// A date/time field. A fixed field is plain text (Word has no fixed-date field); an
// auto field is a DATE/TIME field with the picture switch and a cached value.
function dateTimeFieldParts(node: TiptapNode): { fixed: boolean; instr: string; text: string } {
  const a = node.attrs ?? {};
  const kind = a.kind === 'time' ? 'time' : 'date';
  const fmt = findFormat(String(a.format ?? ''))
    ?? findFormat(kind === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT)!;
  const parsed = a.fixed && typeof a.value === 'string' && a.value ? new Date(a.value) : new Date();
  const when = isNaN(parsed.getTime()) ? new Date() : parsed;
  return {
    fixed: a.fixed === true,
    instr: `${kind === 'time' ? 'TIME' : 'DATE'} \\@ "${docxPicture(fmt)}"`,
    text: renderFormat(fmt, when, docLangTag),
  };
}

// SimpleField's own cached run is a bare TextRun, so a field carrying marks would lose
// its look; this pushes the run with the marks' props instead.
class StyledField extends SimpleField {
  constructor(instruction: string, cachedValue: string, marks: TiptapNode['marks']) {
    super(instruction);
    this.addChildElement(new TextRun({ text: cachedValue, ...runPropsFromMarks(marks) }));
  }
}

function dateTimeRun(node: TiptapNode): Inline {
  const { fixed, instr, text } = dateTimeFieldParts(node);
  // A fixed field is a plain run — Word has no fixed-date field.
  if (fixed) return new TextRun({ text, ...runPropsFromMarks(node.marks) });
  return new StyledField(instr, text, node.marks);
}

// The XE field instruction; a literal quote is backslash-escaped, as Word writes it,
// and indexEntryFromInstr (import) unescapes the same way.
function xeInstr(attrs: Record<string, unknown> | undefined): string | null {
  const term = String(attrs?.term ?? '').trim();
  const key1 = String(attrs?.key1 ?? '').trim();
  if (!term) return null;
  return `XE "${(key1 ? `${key1}:${term}` : term).replace(/([\\"])/g, '\\$1')}"`;
}

// A marker field must be a complex field, as Word writes it: updating an INDEX over
// a result-less fldSimple XE makes Word splice the document apart at the field.
function markerFieldXml(instr: string): string {
  return '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + `<w:r><w:instrText xml:space="preserve"> ${escapeXml(instr)} </w:instrText></w:r>`
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
}

function runsFromXml(xml: string): Inline[] {
  // `root` is typed protected; the run components sit under the parsed wrapper element.
  return (ImportedXmlComponent.fromXmlString(`<w:root>${xml}</w:root>`) as any).root[0].root as Inline[];
}

const markerFieldRuns = (instr: string): Inline[] => runsFromXml(markerFieldXml(instr));

// Word's numeric-picture switch per ODF num-format — the SEQ field's own formatting.
const DOCX_SEQ_SWITCH: Record<NoteNumFormat, string> = {
  '1': 'ARABIC', a: 'alphabetic', A: 'ALPHABETIC', i: 'roman', I: 'ROMAN',
};

// A caption's running number: a SEQ field whose cached result is the rank the editor
// resolved, so Word and LibreOffice show it before anyone updates fields.
function sequenceFieldParts(node: TiptapNode): { instr: string; text: string } {
  const a = node.attrs ?? {};
  const format = (typeof a.format === 'string' && a.format ? a.format : '1') as NoteNumFormat;
  const number = typeof a.number === 'number' && a.number > 0 ? a.number : 1;
  const name = DOCX_SEQ_NAME[seqCategoryOf(a.category as string)];
  return { instr: `SEQ ${name} \\* ${DOCX_SEQ_SWITCH[format] ?? 'ARABIC'}`, text: formatOrdinal(number, format) };
}

function sequenceField(node: TiptapNode): SimpleField {
  const { instr, text } = sequenceFieldParts(node);
  return new SimpleField(instr, text);
}

// A cross-reference: a REF/PAGEREF/NOTEREF field with the resolved text as its cached
// result, so Word and LibreOffice show it before anyone updates fields. Word carries the
// format in the field's switches where ODF has an attribute for it.
const REF_SWITCH: Partial<Record<CrossRefFormat, string>> = {
  number: '\\r',
  'number-no-superior': '\\n',
  'number-all-superior': '\\w',
  direction: '\\p',
};

// A note reference names a bookmark Word expects *inside* the note; the editor addresses
// the note itself, so the name is derived here and planted by applyNoteBookmarksDocx.
let docNoteBookmarks = new Map<string, string>();
const noteRefBookmark = (noteId: string) => docxBookmarkName(`_Ref${noteId}`);

function crossRefInstr(attrs: Record<string, unknown> | undefined): string {
  const a = attrs ?? {};
  const format: CrossRefFormat = isCrossRefFormat(a.format) ? a.format : 'text';
  const kind: CrossRefKind = isCrossRefKind(a.kind) ? a.kind : 'bookmark';
  const raw = String(a.name ?? '');
  const name = kind === 'note' ? noteRefBookmark(raw) : docxBookmarkName(raw);
  if (kind === 'note') docNoteBookmarks.set(raw, name);
  const verb = format === 'page' ? 'PAGEREF' : kind === 'note' ? 'NOTEREF' : 'REF';
  const parts = [verb, name];
  if (kind === 'note' && verb === 'NOTEREF') parts.push('\\f');
  const sw = REF_SWITCH[format];
  if (sw) parts.push(sw);
  const sep = typeof a.sep === 'string' ? a.sep.replace(/["\\]/g, '') : '';
  if (sep && format === 'number-all-superior') parts.push(`\\d "${sep}"`);
  if (a.link !== false) parts.push('\\h');
  return parts.join(' ');
}

function crossRefField(node: TiptapNode): SimpleField {
  return new SimpleField(crossRefInstr(node.attrs), String(node.attrs?.text ?? ''));
}

// The Word ids of every comment on a run: ranges overlap, as bookmarks' do.
const commentIdsOf = (node: TiptapNode): number[] =>
  (node.marks ?? []).filter((m) => m.type === 'comment')
    .map((m) => docCommentIds.get(String(m.attrs?.id ?? ''))).filter((n) => n !== undefined);

// w:bookmarkStart ids for the body; the box path mints its own, clear of these.
let nextBookmarkId = 0;
// The id each range opened with, by `stampBookmarkEdges`'s span, for the paragraph that ends it.
let docBookmarkIds = new Map<number, number>();

// A name an ODF reference mark brought ("Moving toolbars") is none Word accepts, so it is
// mapped once per export — target and reference have to come out with the same one.
let docxBookmarkNames = new Map<string, string>();
function docxBookmarkName(raw: string): string {
  const seen = docxBookmarkNames.get(raw);
  if (seen) return seen;
  const taken = new Set(docxBookmarkNames.values());
  const base = sanitizeBookmarkName(raw) || 'Bookmark';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 36)}_${i}`;
  docxBookmarkNames.set(raw, name);
  return name;
}

function inlineToRuns(content: TiptapNode[] = [], force: TextProps = {}): Inline[] {
  const out: Inline[] = [];
  // A bookmark brackets its runs as two points, not as a wrapper: ranges overlap — a
  // heading's own name inside the contents' one — and no nesting holds them all. Its
  // edges come from `stampBookmarkEdges`, so a range across paragraphs is written once.
  const ends: number[] = [];
  const edgesAt = (node: TiptapNode) => {
    flush();
    for (const e of bookmarkEdgesOf(node)) {
      if (e.first) {
        const id = ++nextBookmarkId;
        docBookmarkIds.set(e.span, id);
        out.push(bookmarkEdge(new BookmarkStart(docxBookmarkName(e.name), id)));
      }
      const id = docBookmarkIds.get(e.span);
      if (e.last && id != null) ends.push(id);
    }
  };
  function flush() { for (const id of ends.splice(0)) out.push(bookmarkEdge(new BookmarkEnd(id))); }

  // A comment's range brackets its runs; the reference run at the end is what Word
  // draws the bubble from.
  const openComments = new Set<number>();
  const commentsAt = (ids: number[]) => {
    for (const id of openComments) {
      if (ids.includes(id)) continue;
      out.push(new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] }));
      // An answer needs no range of its own: its reference at the same anchor is what
      // carries it, and commentsExtended.xml names the comment it belongs to.
      for (const r of docCommentReplies.get(id) ?? []) out.push(new TextRun({ children: [new CommentReference(r)] }));
      openComments.delete(id);
    }
    for (const id of ids) {
      if (openComments.has(id)) continue;
      out.push(new CommentRangeStart(id));
      openComments.add(id);
    }
  };

  let closeAtom: string | null = null;
  for (const node of content) {
    if (closeAtom) out.push(new TextRun({ text: closeAtom }));
    commentsAt(commentIdsOf(node));
    edgesAt(node);
    const atom = atomRevisionMarks(node);
    if (atom) out.push(new TextRun({ text: atom[0] }));
    closeAtom = atom?.[1] ?? null;
    if (node.type === 'text' && node.text) {
      const runs = textNodeToRuns(node, force);
      const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
      const link = href ? String(href) : '';
      // An internal href targets a bookmark in this document, not a URL.
      if (link.startsWith('#')) out.push(new InternalHyperlink({ anchor: docxBookmarkName(link.slice(1)), children: runs }));
      else if (link) out.push(new ExternalHyperlink({ link, children: runs }));
      else out.push(...runs);
      continue;
    }
    if (node.type === 'crossRef') { out.push(crossRefField(node)); continue; }
    if (node.type === 'noteRef') {
      const note = docNoteIds.get(String(node.attrs?.id ?? ''));
      if (note) {
        out.push(note.kind === 'endnote' ? new EndnoteReferenceRun(note.id) : new FootnoteReferenceRun(note.id));
      }
      continue;
    }
    if (node.type === 'hardBreak') {
      // Carry the run's props so an empty line between two breaks keeps its font size.
      out.push(revisedRun(node, { break: 1, ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'image') {
      const img = imageRun(node);
      if (img) out.push(img);
    } else if (node.type === 'textBox') {
      // A marker run; applyTextBoxesDocx swaps it for the DrawingML shape, which the
      // `docx` package has no API for.
      docTextBoxes.push(textBoxDocxDescriptor(node));
      out.push(new TextRun({ text: `${TBX}${docTextBoxes.length - 1}${TBX}` }));
    } else if (node.type === 'pageNumber') {
      out.push(new TextRun({ children: [PageNumber.CURRENT], ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'pageCount') {
      out.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'chapterField') {
      // Word's running head: STYLEREF picks the heading of that level in force on the
      // page. The numeric form means outline level; a style name would be looked up
      // localized ("Heading 1" errors in a German Word, which wants "Überschrift 1").
      out.push(new StyledField(`STYLEREF ${Number(node.attrs?.level) || 1} \\* MERGEFORMAT`, String(node.attrs?.text ?? ''), node.marks));
    } else if (node.type === 'dateTimeField') {
      out.push(dateTimeRun(node));
    } else if (node.type === 'sequenceField') {
      out.push(sequenceField(node));
    } else if (node.type === 'ruby') {
      // The reading over its base text; applyRubyDocx swaps this run for <w:ruby>.
      docRubies.push({ base: String(node.attrs?.base ?? ''), text: String(node.attrs?.text ?? '') });
      out.push(new TextRun({ text: `${RBY}${docRubies.length - 1}${RBY}` }));
    } else if (node.type === 'placeholderField') {
      // applyPlaceholdersDocx swaps this run for a tagged <w:sdt> content control.
      docPlaceholders.push(String(node.attrs?.text ?? ''));
      out.push(new TextRun({ text: `${PLH}${docPlaceholders.length - 1}${PLH}`, ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'indexEntry') {
      // Word's index entry: a hidden XE field, its term in the instruction. A key files
      // the term under it, "key:term", exactly as LibreOffice's text:key1 does.
      const instr = xeInstr(node.attrs);
      if (instr) out.push(...markerFieldRuns(instr));
    } else if (node.type === 'bibliographyEntry') {
      // Word's citation: a CITATION field naming the source's tag, its cached result the
      // text the reader sees. applyBibliographyDocx writes the source itself.
      const identifier = String(node.attrs?.identifier ?? '').trim();
      if (identifier) {
        if (!docSources.some(s => s.identifier === identifier)) {
          docSources.push({
            identifier,
            type: String(node.attrs?.type ?? 'misc'),
            fields: (node.attrs?.fields ?? {}) as Record<string, string>,
          });
        }
        const shown = String(node.attrs?.text || citationText(identifier));
        out.push(new SimpleField(`CITATION "${docxTag(identifier)}"`, shown));
      }
    } else if (node.type === FORMULA_CELL) {
      // Word keeps a table formula in a field inside the cell, where ODF puts it on
      // the cell; `formulaCellContent` mints this node for a cell that carries one.
      // Word's number format is the field's own `\#` switch, its picture the same one
      // its dialog shows.
      const format = isCellFormat(node.attrs?.format) ? node.attrs.format : null;
      const picture = format ? cellFormatCode(format, docLangTag) : '';
      // A date is the field's date-time picture; Word's own formula dialog offers none,
      // so that switch is ours to write and read back.
      const switches = picture ? ` \\${format === 'date' ? '@' : '#'} "${picture}"` : '';
      out.push(new SimpleField(`=${node.attrs?.formula ?? ''}${switches}`, String(node.attrs?.text ?? '')));
    } else if (node.type === 'formula') {
      const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
      if (latex) {
        docFormulas.push({ latex, display: node.attrs?.display === true, align: node.attrs?.align });
        out.push(new TextRun({ text: `${MTH}${docFormulas.length - 1}${MTH}` }));
      }
    }
  }
  if (closeAtom) out.push(new TextRun({ text: closeAtom }));
  commentsAt([]);
  flush(); // the ends owed after the paragraph's last run
  return out;
}

// ---- images ----------------------------------------------------------------
const DOCX_IMG_TYPE: Record<string, 'png' | 'jpg' | 'gif' | 'bmp'> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp',
};

function decodeDataUri(src: string): { bytes: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null {
  const m = /^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/.exec(src);
  if (!m) return null;
  const type = DOCX_IMG_TYPE[m[1] || 'image/png'];
  if (!type) return null; // svg / unsupported → skip (Word needs a raster fallback)
  const isB64 = (m[2] ?? '').includes('base64');
  try {
    if (isB64) {
      const bin = atob(m[3]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.length ? { bytes, type } : null;
    }
    const bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
    return bytes.length ? { bytes, type } : null;
  } catch {
    return null;
  }
}

// A frame sitting exactly on its paragraph's top edge derails LibreOffice's wrap
// layout around a neighbouring inline box (text paints outside the box, probed);
// LO itself never writes a paragraph offset below one twip.
function paraOffsetEmu(cm: number): number {
  const emu = Math.round(cm * 360000);
  return emu >= 0 && emu < 635 ? 635 : emu;
}

// offsetCm places the frame in the text column (Word's posOffset); without one it is
// flush to its side. offsetYCm is how far below the anchor paragraph it sits.
// relativeHeight counts up from where Word numbers a new drawing, by rank and then in
// document order: readers break a tie differently, so every frame gets its own height.
const RELATIVE_HEIGHT_BASE = 251658240;
let frameSeq = 0;
const relativeHeight = (rank: number) => RELATIVE_HEIGHT_BASE + rank * 65536 + frameSeq++;

const emuOf = (cm: number) => Math.round(cm * 360000);

function floatingFor(wrap: string, offsetCm: number | null, offsetYCm: number | null, alignH?: string | null, dist?: unknown, inFront?: boolean, fromPage?: boolean, fromBody?: boolean): IFloating | undefined {
  if (wrap === 'inline') return undefined;
  // The gap on every side the frame keeps one (a plain number is both sides).
  const g = wrapGapAttr(wrapGap(dist));
  const margins = g ? { top: emuOf(g.top), bottom: emuOf(g.bottom), left: emuOf(g.left), right: emuOf(g.right) } : undefined;
  // A page-relative offset counts from the top of the page the anchor lands on and may
  // start above it, so it is written as it stands rather than floored at one twip.
  // Against the body text, Word's margin is the same edge.
  const verticalPosition = fromPage || fromBody
    ? { relative: fromPage ? VerticalPositionRelativeFrom.PAGE : VerticalPositionRelativeFrom.MARGIN, offset: Math.round((offsetYCm ?? 0) * 360000) }
    : { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: paraOffsetEmu(offsetYCm ?? 0) };
  if (wrap === 'through') {
    // Word's in-front-of / behind-text: no wrap at all, and behindDoc names which side
    // of the text the frame lands on. It overlaps by definition, so allowOverlap holds.
    // Where it sits across the text column is its own, as it is for a wrapped frame:
    // a full-width figure behind the text is centred, not flush left. One with neither
    // sits at its anchor character.
    const through = alignH === 'right' ? HorizontalPositionAlign.RIGHT
      : alignH === 'center' ? HorizontalPositionAlign.CENTER : alignH === 'left' ? HorizontalPositionAlign.LEFT : null;
    return {
      horizontalPosition: offsetCm != null
        ? { relative: HorizontalPositionRelativeFrom.MARGIN, offset: Math.round(offsetCm * 360000) }
        : through ? { relative: HorizontalPositionRelativeFrom.MARGIN, align: through }
          : { relative: HorizontalPositionRelativeFrom.CHARACTER, offset: 0 },
      verticalPosition,
      wrap: { type: TextWrappingType.NONE },
      behindDocument: !inFront,
      allowOverlap: true,
    };
  }
  if (wrap === 'topBottom') {
    // A frame sharing its band with another is set against one end of it, and the two
    // may overlap vertically — that is what puts them side by side.
    const end = alignH === 'right' ? HorizontalPositionAlign.RIGHT
      : alignH === 'left' ? HorizontalPositionAlign.LEFT : null;
    // Centred is a place in the band, not an end of it: it shares with nobody, so it
    // keeps the overlap off that a side-by-side pair needs.
    const mid = alignH === 'center' ? HorizontalPositionAlign.CENTER : null;
    return {
      horizontalPosition: end || mid
        ? { relative: HorizontalPositionRelativeFrom.MARGIN, align: (end ?? mid)! }
        : offsetCm != null
          ? { relative: HorizontalPositionRelativeFrom.MARGIN, offset: Math.round(offsetCm * 360000) }
          : { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.LEFT },
      verticalPosition,
      wrap: { type: TextWrappingType.TOP_AND_BOTTOM },
      allowOverlap: !!end,
      margins,
    };
  }
  // left: image at left, text on the right; right: mirror.
  const align = wrap === 'right' ? HorizontalPositionAlign.RIGHT : HorizontalPositionAlign.LEFT;
  const side = wrap === 'right' ? TextWrappingSide.LEFT : TextWrappingSide.RIGHT;
  const horizontalPosition = offsetCm != null
    ? { relative: HorizontalPositionRelativeFrom.MARGIN, offset: Math.round(offsetCm * 360000) }
    : { relative: HorizontalPositionRelativeFrom.MARGIN, align };
  return {
    horizontalPosition,
    verticalPosition,
    wrap: { type: TextWrappingType.SQUARE, side },
    allowOverlap: false,
    margins,
  };
}

// An SVG picture — which is also what the importer makes of an EMF — has no place in a
// .docx, so it is drawn to PNG first. Where no canvas can (the test suite), the node is
// left alone and the emitters skip it, as they did before.
async function rasterizeSvgImages(node: TiptapNode): Promise<TiptapNode> {
  if (node.type === 'image' && isSvgDataUrl(node.attrs?.src)) {
    const w = typeof node.attrs?.width === 'number' && node.attrs.width > 0 ? node.attrs.width : 200;
    const h = typeof node.attrs?.height === 'number' && node.attrs.height > 0 ? node.attrs.height : 150;
    const png = await svgToPngDataUrl(node.attrs.src as string, w, h);
    return png ? { ...node, attrs: { ...node.attrs, src: png } } : node;
  }
  if (!node.content?.length) return node;
  return { ...node, content: await Promise.all(node.content.map(rasterizeSvgImages)) };
}

function imageRun(node: TiptapNode): ImageRun | null {
  const src = node.attrs?.src;
  if (typeof src !== 'string' || !src.startsWith('data:')) return null;
  const decoded = decodeDataUri(src);
  if (!decoded) return null;
  const width = typeof node.attrs?.width === 'number' && node.attrs.width > 0 ? Math.round(node.attrs.width) : 200;
  const height = typeof node.attrs?.height === 'number' && node.attrs.height > 0 ? Math.round(node.attrs.height) : 150;
  const rotation = typeof node.attrs?.rotation === 'number' ? node.attrs.rotation : 0;
  const wrap = String(node.attrs?.wrap ?? 'inline');
  const offsetCm = typeof node.attrs?.wrapOffset === 'number' ? node.attrs.wrapOffset : null;
  const offsetYCm = typeof node.attrs?.wrapOffsetY === 'number' ? node.attrs.wrapOffsetY : null;
  const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
  const crop = cropOf(node.attrs?.crop);
  const mode = colorModeOf(node.attrs?.colorMode);
  docPictureMarks ||= !!crop || !!mode;
  const mark = (crop ? `${CROP}${[crop.l, crop.t, crop.r, crop.b].join(',')}${CROP}` : '')
    + (mode ? `${COLOR}${mode}${COLOR}` : '');
  const floating = floatingFor(wrap, offsetCm, offsetYCm, node.attrs?.wrapAlign as string | null, node.attrs?.wrapDist, node.attrs?.inFront === true, node.attrs?.wrapFromPage === true, node.attrs?.wrapFromBody === true);
  return new ImageRun({
    type: decoded.type,
    data: decoded.bytes,
    altText: alt ? { name: alt + mark, title: alt, description: alt } : mark ? { name: mark } : undefined,
    transformation: { width, height, rotation: rotation || undefined },
    floating: floating && { ...floating, zIndex: relativeHeight(frameRank(node.attrs?.zIndex)) },
  });
}

// ---- text boxes / shapes ---------------------------------------------------
// A textBox node collected by blocksToDocx; applyTextBoxesDocx rewrites its marker
// paragraph into DrawingML (wp:inline/wp:anchor > wps:wsp > wps:txbx) after packing.
type TextBoxDocx = {
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
  wrap: 'inline' | 'left' | 'right' | 'topBottom' | 'through';
  offsetCm: number | null;
  offsetYCm: number | null;
  dist: WrapGap | null;
  alignH: string | null;
  fromPage: boolean;
  fromBody: boolean;
  inFront: boolean;
  zIndex: number;
  shapeKind: ShapeKind;
  shapePath: string | null;
  shapeTextArea: TextArea | null;
  shapePreset: DrawingMlPreset | null;
  arrowHeads: PathHeads | null;
  flipV: boolean;
  flipH: boolean;
  textVertical: boolean;
  textVAlign: TextVAlign;
  fill: string | null;
  stroke: string | null;
  strokeWidthPt: number;
  paddingCm: number;
  paddingTopCm: number | null;
  paddingBottomCm: number | null;
  content: TiptapNode[];
};

function textBoxDocxDescriptor(node: TiptapNode): TextBoxDocx {
  const a = node.attrs ?? {};
  const wrapAttr = a.wrap;
  // A line has no box (see odt.ts): standing in the default height for a divider of
  // none draws it across the frame's diagonal.
  const line = isShapeKind(a.shapeKind) && isLineKind(a.shapeKind);
  return {
    widthPx: typeof a.width === 'number' && a.width > 0 ? Math.round(a.width) : 280,
    heightPx: typeof a.height === 'number' && a.height > 0 ? Math.round(a.height) : line ? 0 : 96,
    rotationDeg: typeof a.rotation === 'number' ? a.rotation : 0,
    wrap: wrapAttr === 'left' || wrapAttr === 'right' || wrapAttr === 'topBottom' || wrapAttr === 'through' ? wrapAttr : 'inline',
    offsetCm: typeof a.wrapOffset === 'number' ? a.wrapOffset : null,
    offsetYCm: typeof a.wrapOffsetY === 'number' ? a.wrapOffsetY : null,
    dist: wrapGapAttr(wrapGap(a.wrapDist)),
    alignH: a.wrapAlign === 'center' || a.wrapAlign === 'right' || a.wrapAlign === 'left' ? a.wrapAlign : null,
    fromPage: a.wrapFromPage === true,
    fromBody: a.wrapFromBody === true,
    inFront: a.inFront === true,
    zIndex: relativeHeight(frameRank(a.zIndex)),
    shapeKind: isShapeKind(a.shapeKind) ? a.shapeKind : 'textbox',
    shapePath: typeof a.shapePath === 'string' && a.shapePath ? a.shapePath : null,
    shapeTextArea: asTextArea(a.shapeTextArea),
    shapePreset: typeof a.shapePath === 'string' && a.shapePath ? asShapePreset(a.shapePreset) : null,
    arrowHeads: a.arrowHeads === 'start' || a.arrowHeads === 'end' || a.arrowHeads === 'both' ? a.arrowHeads : null,
    flipV: a.flipV === true,
    flipH: a.flipH === true,
    textVertical: a.textVertical === true,
    textVAlign: a.textVAlign === 'middle' || a.textVAlign === 'bottom' ? a.textVAlign : 'top',
    fill: typeof a.fillColor === 'string' && a.fillColor ? a.fillColor : null,
    stroke: typeof a.strokeColor === 'string' && a.strokeColor ? a.strokeColor : null,
    strokeWidthPt: typeof a.strokeWidthPt === 'number' && a.strokeWidthPt > 0 ? a.strokeWidthPt : 1,
    // The attr is only set where the box disagrees with the editor's own ring.
    paddingCm: typeof a.paddingCm === 'number' && a.paddingCm >= 0 ? a.paddingCm : TEXTBOX_PADDING_CM,
    paddingTopCm: typeof a.paddingTopCm === 'number' && a.paddingTopCm >= 0 ? a.paddingTopCm : null,
    paddingBottomCm: typeof a.paddingBottomCm === 'number' && a.paddingBottomCm >= 0 ? a.paddingBottomCm : null,
    content: (node.content ?? []).map((c) => c.type !== 'table' ? c
      : { type: 'boxTable', attrs: { index: docBoxTables.push({ node: c, widthCm: boxTextWidthCm(a) }) - 1 } }),
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Run properties for the hand-serialized txbxContent, in CT_RPr schema order
// (rFonts, b, i, strike, color, sz, u, shd, vertAlign). Mirrors runPropsFromMarks.
function txbxRevAttrs(a: Record<string, unknown>): string {
  return `w:id="${docRevisionId(String(a.id ?? ''))}" w:author="${escapeXml(String(a.author ?? ''))}" w:date="${escapeXml(String(a.date ?? ''))}"`;
}

function rFontsXml(font: NonNullable<ReturnType<typeof fontPair>>): string {
  const slots = (['ascii', 'eastAsia', 'hAnsi', 'cs'] as const).filter((k) => font[k]);
  return `<w:rFonts${slots.map((k) => ` w:${k}="${escapeXml(font[k]!)}"`).join('')}/>`;
}

function szXml(size: unknown): string {
  const hp = size ? fontSizeToHalfPoints(String(size)) : undefined;
  return hp ? `<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>` : '';
}

function txbxRunPropsXml(marks: TiptapNode['marks'] = [], blockLangs: unknown[] = [], block: TiptapNode['attrs'] = {}): string {
  const ts = marks.find((m) => m.type === 'textStyle');
  const parts: string[] = [];
  // w:rStyle leads w:rPr; the run's own properties below still win, as in the body.
  const cs = marks.find((m) => m.type === 'charStyle')?.attrs?.name;
  if (typeof cs === 'string' && cs) parts.push(`<w:rStyle w:val="${escapeXml(docxStyleId(cs))}"/>`);
  const font = fontPair(ts?.attrs?.fontFamily ?? block?.fontFamily, ts?.attrs?.fontFamilyAsian ?? block?.fontFamilyAsian, screenToDoc);
  if (font) parts.push(rFontsXml(font));
  let bold = markPresent(marks, 'bold');
  const fw = ts?.attrs?.fontWeight;
  if (fw != null) {
    const s = String(fw);
    if (s === 'normal' || s === '400') bold = false;
    else if (s === 'bold' || /^[5-9]\d\d$/.test(s)) bold = true;
  }
  if (bold) parts.push('<w:b/>');
  if (markPresent(marks, 'italic')) parts.push('<w:i/>');
  const st = marks.find((m) => m.type === 'strike');
  if (st) parts.push(st.attrs?.lineStyle === 'double' ? '<w:dstrike/>' : '<w:strike/>');
  const caps = ts?.attrs?.caps;
  if (caps === 'smallCaps') parts.push('<w:smallCaps/>');
  else if (caps === 'uppercase') parts.push('<w:caps/>');
  const pos = ts?.attrs?.textPosition;
  if (typeof pos === 'number' && pos) parts.push(`<w:position w:val="${Math.round(pos * 2)}"/>`);
  if (isEmphasis(ts?.attrs?.emphasis)) parts.push(`<w:em w:val="${emphasisToWord(ts.attrs.emphasis)}"/>`);
  const col = ts?.attrs?.color;
  if (col) {
    const h = hexColor(String(col));
    if (h) parts.push(`<w:color w:val="${h}"/>`);
  }
  const sz = szXml(ts?.attrs?.fontSize ?? block?.fontSize);
  if (sz) parts.push(sz);
  const u = marks.find((m) => m.type === 'underline');
  if (u) {
    const line = wordUnderline(u.attrs);
    parts.push(`<w:u w:val="${line.type}"${line.color ? ` w:color="${line.color}"` : ''}/>`);
  }
  // Visible hyperlink styling, as runPropsFromMarks paints it for the body.
  if (marks.some((m) => m.type === 'link' && !m.attrs?.plain)) {
    if (!col) parts.push('<w:color w:val="0563C1"/>');
    if (!u) parts.push('<w:u w:val="single"/>');
  }
  const hl = marks.find((m) => m.type === 'highlight');
  if (hl?.attrs?.color) {
    const h = hexColor(String(hl.attrs.color));
    if (h) parts.push(`<w:shd w:val="clear" w:fill="${h}"/>`);
  }
  if (markPresent(marks, 'superscript')) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (markPresent(marks, 'subscript')) parts.push('<w:vertAlign w:val="subscript"/>');
  // Last in CT_RPr's order, and the only place Word reads a run's language from.
  const lang = langXml(...blockLangs, ts?.attrs?.lang, ts?.attrs?.langAsian);
  if (lang) parts.push(lang);
  const change = marks.find((m) => m.type === 'formatChange')?.attrs;
  if (change) parts.push(`<w:rPrChange ${txbxRevAttrs(change)}>${txbxRunPropsXml((change.old ?? []) as TiptapNode['marks'], blockLangs, block) || '<w:rPr/>'}</w:rPrChange>`);
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

// The package parts a box's content needs beyond word/document.xml: a picture is a
// media entry plus a relationship, a list a numbering definition. applyTextBoxesDocx
// runs after packing, so it holds the whole zip and can mint all three.
type TxbxParts = {
  media: { path: string; bytes: Uint8Array; rid: string; type: string }[];
  nums: { id: number; levels: string[] }[];
  // External hyperlink targets of box runs, each a relationship to mint.
  links: { rid: string; href: string }[];
  nextRid: () => string;
  // w:bookmarkStart ids minted for box content — offset clear of the package's own.
  nextBookmarkId: () => number;
  // The staged tables' XML, by docBoxTables index.
  tables: Map<number, string>;
};

// One picture inside a box, as an as-char <wp:inline> drawing.
function txbxImageXml(node: TiptapNode, parts: TxbxParts): string {
  const src = node.attrs?.src;
  if (typeof src !== 'string') return '';
  const decoded = decodeDataUri(src);
  if (!decoded) return '';
  const n = parts.media.length + 1;
  const ext = decoded.type === 'jpg' ? 'jpeg' : decoded.type;
  const rid = parts.nextRid();
  parts.media.push({ path: `word/media/tbx${n}.${ext}`, bytes: decoded.bytes, rid, type: ext });
  const cx = Math.round((typeof node.attrs?.width === 'number' && node.attrs.width > 0 ? node.attrs.width : 200) * EMU_PER_PX);
  const cy = Math.round((typeof node.attrs?.height === 'number' && node.attrs.height > 0 ? node.attrs.height : 150) * EMU_PER_PX);
  const alt = escapeXml(typeof node.attrs?.alt === 'string' ? node.attrs.alt : '');
  return (
    `<w:drawing><wp:inline ${WP_NS} distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${9000 + n}" name="Picture ${n}" descr="${alt}"/>` +
    `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}">` +
    `<pic:pic xmlns:pic="${PIC_NS}"><pic:nvPicPr><pic:cNvPr id="${9000 + n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}" xmlns:r="${R_NS}">${BLIP_EFFECT[colorModeOf(node.attrs?.colorMode)!] ?? ''}</a:blip>${srcRectXml(cropOf(node.attrs?.crop))}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm${typeof node.attrs?.rotation === 'number' && node.attrs.rotation ? ` rot="${Math.round(node.attrs.rotation * 60000)}"` : ''}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

// The box paragraph's own formatting, hand-serialized in CT_PPr child order
// (pBdr, shd, bidi, spacing, ind, jc) — mirrors what paragraphToDocx hands the package.
function txbxPPrXml(attrs: TiptapNode['attrs'], indentTwip: number, pt: number): string {
  const out: string[] = [];
  const borders = paraBordersOf(attrs);
  if (borders) {
    const side = (name: string, b?: IBorderOptions) =>
      b ? `<w:${name} w:val="single" w:sz="${b.size}" w:space="1" w:color="${b.color}"/>` : '';
    out.push(`<w:pBdr>${side('top', borders.top)}${side('left', borders.left)}${side('bottom', borders.bottom)}${side('right', borders.right)}</w:pBdr>`);
  }
  const shd = paraShadingOf(attrs);
  if (shd) out.push(`<w:shd w:val="clear" w:fill="${shd.fill}"/>`);
  const stops = parseTabStops(attrs?.tabStops);
  if (stops.length) {
    out.push(`<w:tabs>${stops.map((t) => {
      const leader = DOCX_LEADER[t.leader ?? ''];
      return `<w:tab w:val="${DOCX_TAB_TYPE[t.align]}"${leader ? ` w:leader="${leader}"` : ''} w:pos="${cmToTwip(t.pos)}"/>`;
    }).join('')}</w:tabs>`);
  }
  if (attrs?.noHyphenation === true) out.push('<w:suppressAutoHyphens/>');
  if (attrs?.dir === 'rtl') out.push('<w:bidi/>');
  if (attrs?.snapToGrid === false) out.push('<w:snapToGrid w:val="0"/>');
  const s = spacingOf(attrs);
  if (s) {
    out.push(`<w:spacing${s.before != null ? ` w:before="${s.before}"` : ''}`
      + `${s.after != null ? ` w:after="${s.after}"` : ''}`
      + `${s.line != null ? ` w:line="${s.line}" w:lineRule="${s.lineRule === LineRuleType.EXACT ? 'exact' : 'auto'}"` : ''}/>`);
  }
  const ind: string[] = [];
  const left = leftCm(attrs, pt);
  if (left > 0) ind.push(` w:left="${cmToTwip(left)}"`);
  else if (indentTwip) ind.push(` w:left="${indentTwip}"`);
  const right = rightCm(attrs, pt);
  if (right > 0) ind.push(` w:right="${cmToTwip(right)}"`);
  const first = firstLineCm(attrs, pt);
  if (first) ind.push(first < 0 ? ` w:hanging="${cmToTwip(-first)}"` : ` w:firstLine="${cmToTwip(first)}"`);
  const chars = indentCharsPayload(attrs);
  if (chars) ind.push(...chars.split(' ').map((kv) => ` w:${kv.replace('=', '="')}"`));
  if (ind.length) out.push(`<w:ind${ind.join('')}/>`);
  const ta = attrs?.textAlign;
  const jc = ta === 'center' ? 'center' : ta === 'right' ? 'right' : ta === 'justify' ? 'both' : '';
  if (jc) out.push(`<w:jc w:val="${jc}"/>`);
  // w:rPr closes CT_PPr; it formats the paragraph mark and names the block's language.
  const font = fontPair(attrs?.fontFamily, attrs?.fontFamilyAsian, screenToDoc);
  const revMark = attrs?.revMark as Record<string, Record<string, unknown>> | null | undefined;
  const revs = (['insertion', 'deletion'] as const).map((k) => (revMark?.[k] ? `<w:${k === 'insertion' ? 'ins' : 'del'} ${txbxRevAttrs(revMark[k])}/>` : ''));
  const mark = [...revs, font ? rFontsXml(font) : '', szXml(attrs?.fontSize), langXml(attrs?.lang, attrs?.langAsian)].join('');
  if (mark) out.push(`<w:rPr>${mark}</w:rPr>`);
  return out.join('');
}

// A box block's w:pPr content, in CT_PPr order.
function txbxBlockPPr(node: TiptapNode, indentTwip: number, numPr: string): string {
  const attrs = node.attrs ?? {};
  const pPr: string[] = [];
  if (node.type === 'heading') {
    const lvl = Math.min(MAX_HEADING_LEVEL, Math.max(1, Number(attrs.level) || 1));
    pPr.push(`<w:pStyle w:val="Heading${lvl}"/>`);
  }
  // CT_PPr puts both right after the style; an explicit off overrides a heading's keep.
  if (typeof attrs.keepNext === 'boolean') pPr.push(attrs.keepNext ? '<w:keepNext/>' : '<w:keepNext w:val="0"/>');
  if (attrs.keepLines === true) pPr.push('<w:keepLines/>');
  if (attrs.widowControl === false) pPr.push('<w:widowControl w:val="0"/>');
  pPr.push(numPr, txbxPPrXml(attrs, indentTwip, blockPt(node)));
  return pPr.join('');
}

// One paragraph/heading of a text box. `numPr` makes it a list item of one of the
// numbering definitions minted for the box.
function txbxParagraphXml(node: TiptapNode, parts: TxbxParts, indentTwip = 0, numPr = ''): string {
  const attrs = node.attrs ?? {};
  // A list change has a form only where the paragraph was made a list, as in the body.
  const format = attrs.revFormat as RevFormat | null | undefined;
  const madeList = format?.old?.list?.length === 0 && !!numPr;
  const noForm = !!format?.old?.list && !madeList && sameBlockFormat(blockFormat(node.type, attrs), format.old);
  const pPr = [txbxBlockPPr(node, indentTwip, numPr)];
  if (format && !noForm) {
    // CT_PPrBase: the earlier properties have no paragraph mark of their own.
    const old = txbxBlockPPr({ ...node, ...format.old }, indentTwip, madeList ? '' : numPr).replace(/<w:rPr>.*<\/w:rPr>$/, '');
    pPr.push(`<w:pPrChange ${txbxRevAttrs(format)}><w:pPr>${old}</w:pPr></w:pPrChange>`);
  }
  const runProps = (marks: TiptapNode['marks']) => txbxRunPropsXml(marks, [attrs.lang, attrs.langAsian], attrs);
  let runs = '';
  // Comment ranges and bookmarks bracket consecutive runs sharing the mark, as
  // inlineToRuns does for the body; the reference run is what Word draws the bubble from.
  const openComments = new Set<number>();
  const commentsAt = (ids: number[]) => {
    for (const id of openComments) {
      if (ids.includes(id)) continue;
      runs += `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;
      for (const r of docCommentReplies.get(id) ?? []) runs += `<w:r><w:commentReference w:id="${r}"/></w:r>`;
      openComments.delete(id);
    }
    for (const id of ids) {
      if (openComments.has(id)) continue;
      runs += `<w:commentRangeStart w:id="${id}"/>`;
      openComments.add(id);
    }
  };
  const ends: number[] = [];
  const closeBookmark = () => { for (const id of ends.splice(0)) runs += `<w:bookmarkEnd w:id="${id}"/>`; };
  const edgesAt = (child: TiptapNode) => {
    closeBookmark();
    for (const e of bookmarkEdgesOf(child)) {
      if (e.first) {
        const id = parts.nextBookmarkId();
        docBookmarkIds.set(e.span, id);
        runs += `<w:bookmarkStart w:id="${id}" w:name="${escapeXml(docxBookmarkName(e.name))}"/>`;
      }
      const id = docBookmarkIds.get(e.span);
      if (e.last && id != null) ends.push(id);
    }
  };
  for (const child of node.content ?? []) {
    commentsAt(commentIdsOf(child));
    edgesAt(child);
    const atom = atomRevisionMarks(child);
    if (atom) runs += `<w:r><w:t>${atom[0]}</w:t></w:r>`;
    if (child.type === 'image') {
      const drawing = txbxImageXml(child, parts);
      if (drawing) runs += `<w:r>${drawing}</w:r>`;
    } else if (child.type === 'sequenceField') {
      // A caption inside a frame keeps its running number as a field, like any other.
      const { instr, text } = sequenceFieldParts(child);
      runs += `<w:fldSimple w:instr="${escapeXml(instr)}"><w:r>` +
        `${runProps(child.marks)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:fldSimple>`;
    } else if (child.type === 'crossRef') {
      runs += `<w:fldSimple w:instr="${escapeXml(crossRefInstr(child.attrs))}">` +
        `<w:r><w:t xml:space="preserve">${escapeXml(String(child.attrs?.text ?? ''))}</w:t></w:r></w:fldSimple>`;
    } else if (child.type === 'indexEntry') {
      const instr = xeInstr(child.attrs);
      if (instr) runs += markerFieldXml(instr);
    } else if (child.type === 'bibliographyEntry') {
      // Same CITATION field as the body; the source record joins docSources, which
      // applyBibliographyDocx (running after the boxes are packed) writes out.
      const identifier = String(child.attrs?.identifier ?? '').trim();
      if (identifier) {
        if (!docSources.some(s => s.identifier === identifier)) {
          docSources.push({
            identifier,
            type: String(child.attrs?.type ?? 'misc'),
            fields: (child.attrs?.fields ?? {}) as Record<string, string>,
          });
        }
        const shown = String(child.attrs?.text || citationText(identifier));
        runs += `<w:fldSimple w:instr="${escapeXml(`CITATION "${docxTag(identifier)}"`)}"><w:r>` +
          `${runProps(child.marks)}<w:t xml:space="preserve">${escapeXml(shown)}</w:t></w:r></w:fldSimple>`;
      }
    } else if (child.type === 'dateTimeField') {
      const { fixed, instr, text } = dateTimeFieldParts(child);
      runs += fixed
        ? `<w:r>${runProps(child.marks)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
        : `<w:fldSimple w:instr="${escapeXml(instr)}"><w:r>` +
          `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:fldSimple>`;
    } else if (child.type === 'pageNumber' || child.type === 'pageCount' || child.type === 'chapterField') {
      // A header's page fields, the same fields the zone's own runs carry.
      const instr = child.type === 'pageNumber' ? 'PAGE' : child.type === 'pageCount' ? 'NUMPAGES'
        : `STYLEREF ${Number(child.attrs?.level) || 1} \\* MERGEFORMAT`;
      const shown = child.type === 'chapterField' ? String(child.attrs?.text ?? '') : '1';
      runs += `<w:fldSimple w:instr="${escapeXml(instr)}"><w:r>` +
        `${runProps(child.marks)}<w:t xml:space="preserve">${escapeXml(shown)}</w:t></w:r></w:fldSimple>`;
    } else if (child.type === 'formula') {
      // A sentinel run, resolved by applyFormulasDocx — it runs after the boxes are packed.
      const latex = typeof child.attrs?.latex === 'string' ? child.attrs.latex : '';
      if (latex) {
        docFormulas.push({ latex, display: child.attrs?.display === true, align: child.attrs?.align });
        runs += `<w:r><w:t xml:space="preserve">${MTH}${docFormulas.length - 1}${MTH}</w:t></w:r>`;
      }
    } else if (child.type === 'ruby') {
      docRubies.push({ base: String(child.attrs?.base ?? ''), text: String(child.attrs?.text ?? '') });
      runs += `<w:r><w:t xml:space="preserve">${RBY}${docRubies.length - 1}${RBY}</w:t></w:r>`;
    } else if (child.type === 'placeholderField') {
      docPlaceholders.push(String(child.attrs?.text ?? ''));
      runs += `<w:r>${runProps(child.marks)}<w:t xml:space="preserve">${PLH}${docPlaceholders.length - 1}${PLH}</w:t></w:r>`;
    } else if (child.type === 'text' && child.text) {
      const rPr = runProps(child.marks);
      // A recorded revision wraps the run; a deletion's text sits in w:delText.
      const rev = revisionOf(child);
      const tag = rev?.kind === 'deletion' ? 'w:delText' : 'w:t';
      let inner = '';
      child.text.split('\t').forEach((seg, i) => {
        if (i > 0) inner += '<w:tab/>';
        if (seg) inner += `<${tag} xml:space="preserve">${escapeXml(seg)}</${tag}>`;
      });
      let run = `<w:r>${rPr}${inner}</w:r>`;
      if (rev) run = wrapRevisionXml(run, rev, stackedOf(child));
      const href = child.marks?.find((m) => m.type === 'link')?.attrs?.href;
      const link = href ? String(href) : '';
      if (link.startsWith('#')) {
        runs += `<w:hyperlink w:anchor="${escapeXml(link.slice(1))}">${run}</w:hyperlink>`;
      } else if (link) {
        const rid = parts.nextRid();
        parts.links.push({ rid, href: link });
        runs += `<w:hyperlink r:id="${rid}">${run}</w:hyperlink>`;
      } else {
        runs += run;
      }
    } else if (child.type === 'hardBreak') {
      const rev = revisionOf(child);
      const run = `<w:r>${runProps(child.marks)}<w:br/></w:r>`;
      runs += rev ? wrapRevisionXml(run, rev, stackedOf(child)) : run;
    }
    if (atom) runs += `<w:r><w:t>${atom[1]}</w:t></w:r>`;
  }
  closeBookmark();
  commentsAt([]);
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
}

// One <w:lvl> of a numbering definition minted for a box — the same shape
// Numbering.ensureLevel hands the package for a body list.
function txbxLevelXml(node: TiptapNode, depth: number, chained: boolean, cycle: OrderedCycle): string {
  const ordered = node.type === 'orderedList';
  const attr = node.attrs?.listStyleType as string | null | undefined;
  const def = effectiveOrderedDefAt(attr === 'multilevel' ? 'decimal' : attr, cycle);
  const fmt = ordered
    ? (chained ? 'decimal' : String(ORDERED_FORMAT[def.numFormat] ?? 'decimal'))
    : 'bullet';
  const text = !ordered
    ? bulletCharOf(node, depth)
    : chained
      ? Array.from({ length: depth + 1 }, (_, i) => `%${i + 1}.`).join('')
      : `%${depth + 1}${def.numSuffix}`;
  const start = ordered && typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
  const jc = node.attrs?.markerAlign === 'right' ? 'right' : 'left';
  const suff = node.attrs?.markerSuffix === 'space' || node.attrs?.markerSuffix === 'nothing' ? `<w:suff w:val="${node.attrs.markerSuffix}"/>` : '';
  const hang = listHangIndent(typeof node.attrs?.hanging === 'number' ? node.attrs.hanging : null);
  const hangXml = hang.firstLine != null ? ` w:firstLine="${hang.firstLine}"` : ` w:hanging="${hang.hanging}"`;
  return (
    `<w:lvl w:ilvl="${depth}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/>${suff}` +
    `<w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="${jc}"/>` +
    `<w:pPr><w:ind w:left="${cmToTwip((depth + 1) * LIST_LEFT_STEP_CM)}"${hangXml}/></w:pPr></w:lvl>`
  );
}

// A list inside a box, as a real Word list: one numbering definition per top-level
// list, each nesting level's format filled in when first met — as the body's
// Numbering registry does, only written straight to XML.
function txbxListXml(
  node: TiptapNode, depth: number, parts: TxbxParts,
  num: TxbxParts['nums'][number] | null = null, chainRoot = false, cycle: OrderedCycle = ROOT_ORDERED_CYCLE,
): string {
  const ordered = node.type === 'orderedList';
  const attr = node.attrs?.listStyleType as string | null | undefined;
  const chained = ordered && (attr === 'multilevel' || (chainRoot && !attr));
  const cChild = childCycle(cycle, attr, ordered);
  const def = num ?? { id: 0, levels: [] as string[] };
  if (!num) {
    def.id = parts.nums.length;
    parts.nums.push(def);
  }
  if (!def.levels[depth]) def.levels[depth] = txbxLevelXml(node, depth, chained, cycle);
  const numPr = `<w:numPr><w:ilvl w:val="${depth}"/><w:numId w:val="${TXBX_NUM}${def.id}${TXBX_NUM}"/></w:numPr>`;
  let out = '';
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        out += txbxListXml(child, depth + 1, parts, def, chained, cChild);
      } else if (child.type === 'paragraph' || child.type === 'heading') {
        out += txbxParagraphXml(child, parts, 0, numPr);
      }
    }
  }
  return out;
}

function txbxContentXml(blocks: TiptapNode[], parts: TxbxParts): string {
  let out = '';
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') out += txbxParagraphXml(b, parts);
    else if (b.type === 'bulletList' || b.type === 'orderedList') out += txbxListXml(b, 0, parts);
    else if (b.type === 'boxTable') out += parts.tables.get(Number(b.attrs?.index)) ?? '';
  }
  // A table may not end the box, as it may not end a cell.
  return !out || blocks[blocks.length - 1]?.type === 'boxTable' ? `${out}<w:p/>` : out;
}

// The full <w:drawing> for one text box. Namespaces are declared inline on the
// wp/a/wps elements so the output never depends on what the library declares on
// the document root.
function textBoxDrawingXml(box: TextBoxDocx, index: number, parts: TxbxParts): string {
  const cx = Math.round(box.widthPx * EMU_PER_PX);
  const cy = Math.round(box.heightPx * EMU_PER_PX);
  const rot = box.rotationDeg ? ` rot="${Math.round(box.rotationDeg * 60000)}"` : '';
  const fill = box.fill
    ? `<a:solidFill><a:srgbClr val="${hexColor(box.fill) ?? 'FFFFFF'}"/></a:solidFill>`
    : '<a:noFill/>';
  // A line is only its stroke, and its heads ride the same <a:ln> (an outline's too).
  const line = SHAPES[box.shapeKind].line;
  const heads = boxHeads(box.shapeKind, box.arrowHeads, box.shapePath);
  const ends = (heads.start ? '<a:headEnd type="triangle"/>' : '') + (heads.end ? '<a:tailEnd type="triangle"/>' : '');
  const ln = box.stroke
    ? `<a:ln w="${Math.round(box.strokeWidthPt * EMU_PER_PT)}"><a:solidFill><a:srgbClr val="${hexColor(box.stroke) ?? '000000'}"/></a:solidFill>${ends}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const inset = Math.round(box.paddingCm * EMU_PER_CM);
  const insetT = Math.round((box.paddingTopCm ?? box.paddingCm) * EMU_PER_CM);
  const insetB = Math.round((box.paddingBottomCm ?? box.paddingCm) * EMU_PER_CM);
  // The box keeps the height it declares — LibreOffice's own DOCX export writes this for
  // the same frame, and read as spAutoFit it lays the text out detached from the shape
  // (probed: the text lands in the body, over whatever follows).
  const autofit = '<a:noAutofit/>';
  // A freeform is its own outline: custGeom over the same 0…100 box, in the shape's
  // own EMU extent so the path needs no second scale. A preset is only its name.
  const preset = box.shapePreset;
  const area = box.shapeTextArea;
  const rect = area ? `<a:rect l="${Math.round((area[0] * cx) / 100)}" t="${Math.round((area[1] * cy) / 100)}"`
    + ` r="${Math.round((area[2] * cx) / 100)}" b="${Math.round((area[3] * cy) / 100)}"/>` : '';
  const geom = preset
    ? `<a:prstGeom prst="${preset.name}"><a:avLst>${Object.entries(preset.adj)
      .map(([n, v]) => `<a:gd name="${escapeXml(n)}" fmla="val ${Math.round(v)}"/>`).join('')}</a:avLst></a:prstGeom>`
    : box.shapePath
    ? `<a:custGeom><a:avLst/>${rect}<a:pathLst>${drawingMlPath(box.shapePath, cx, cy)}</a:pathLst></a:custGeom>`
    : `<a:prstGeom prst="${SHAPES[box.shapeKind].prst}"><a:avLst/></a:prstGeom>`;
  // Word draws the `line` preset down the frame's diagonal and flips it to reach the
  // other one; a line carries no fill and no text body.
  const flip = ((line && box.flipH) || preset?.flipH ? ' flipH="1"' : '') + ((line && box.flipV) || preset?.flipV ? ' flipV="1"' : '');
  const body = line
    ? ''
    : `<wps:txbx><w:txbxContent>${txbxContentXml(box.content, parts)}</w:txbxContent></wps:txbx>`;
  const wsp =
    `<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm${rot}${flip}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `${geom}${line ? '<a:noFill/>' : fill}${ln}</wps:spPr>` +
    body +
    `<wps:bodyPr rot="0" vert="${box.textVertical ? 'vert' : 'horz'}" wrap="square"` +
    ` lIns="${inset}" tIns="${insetT}" rIns="${inset}" bIns="${insetB}" anchor="${box.textVAlign === 'middle' ? 'ctr' : box.textVAlign === 'bottom' ? 'b' : 't'}">${autofit}</wps:bodyPr>` +
    `</wps:wsp>`;
  const graphic =
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${wsp}</a:graphicData></a:graphic>`;
  const docPr = `<wp:docPr id="${9001 + index}" name="TextBox${index + 1}"/>`;
  const extent = `<wp:extent cx="${cx}" cy="${cy}"/>`;
  if (box.wrap === 'inline') {
    return `<w:drawing><wp:inline ${WP_NS} distT="0" distB="0" distL="0" distR="0">${extent}${docPr}${graphic}</wp:inline></w:drawing>`;
  }
  // wrapText names the side TEXT flows on (inverse of the box side), like ODT.
  const wrapEl = box.wrap === 'through' ? '<wp:wrapNone/>'
    : box.wrap === 'topBottom' ? '<wp:wrapTopAndBottom/>'
    : `<wp:wrapSquare wrapText="${box.wrap === 'right' ? 'left' : 'right'}"/>`;
  // A side wrap names the side itself; a box spanning the column — banded or behind the
  // text — has a place across it to choose, and a figure usually sits in the middle.
  const align = box.wrap === 'right' ? 'right'
    : box.wrap === 'topBottom' || box.wrap === 'through' ? box.alignH ?? 'left' : 'left';
  const emu = (cm: number) => Math.round(cm * 360000);
  // The x rides topBottom too: it moves the frame within its full-width band.
  const posH = box.offsetCm != null
    ? `<wp:posOffset>${emu(box.offsetCm)}</wp:posOffset>`
    : `<wp:align>${align}</wp:align>`;
  return (
    `<w:drawing><wp:anchor ${WP_NS} distT="${emu(box.dist?.top ?? 0)}" distB="${emu(box.dist?.bottom ?? 0)}" distL="${emu(box.dist?.left ?? 0)}" distR="${emu(box.dist?.right ?? 0)}"` +
    ` simplePos="0" relativeHeight="${box.zIndex}" behindDoc="${box.wrap === 'through' && !box.inFront ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="${box.wrap === 'through' ? 1 : 0}">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="margin">${posH}</wp:positionH>` +
    (box.fromPage || box.fromBody
      ? `<wp:positionV relativeFrom="${box.fromPage ? 'page' : 'margin'}"><wp:posOffset>${Math.round((box.offsetYCm ?? 0) * 360000)}</wp:posOffset></wp:positionV>`
      : `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${paraOffsetEmu(box.offsetYCm ?? 0)}</wp:posOffset></wp:positionV>`) +
    `${extent}${wrapEl}${docPr}${graphic}</wp:anchor></w:drawing>`
  );
}

// The highest number already used by `attr` in `xml`, so a part we add gets a free one.
function maxIdIn(xml: string, attr: RegExp): number {
  let max = 0;
  for (const m of xml.matchAll(attr)) max = Math.max(max, parseInt(m[1], 10) || 0);
  return max;
}

// The parts a run can land in: a note's text and a header or footer are parts of their
// own, so a sentinel pass that only rewrote document.xml would leave it standing there.
const textParts = (files: Record<string, Uint8Array>): string[] =>
  Object.keys(files).filter((p) => /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(p));
const relsOf = (part: string) => part.replace(/^word\/(.*)$/, 'word/_rels/$1.rels');
const EMPTY_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

// Post-pack pass: a picture whose name carries a crop gets it as its a:srcRect, a colour
// mode as its blip's effect, and the name loses the marks.
function applyPictureMarksDocx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  let hit = false;
  const cropMark = new RegExp(`${CROP}([\\d.,e-]+)${CROP}`);
  const colorMark = new RegExp(`${COLOR}([a-z]+)${COLOR}`);
  for (const part of textParts(files)) {
    const xml = strFromU8(files[part]);
    if (!xml.includes(CROP) && !xml.includes(COLOR)) continue;
    hit = true;
    files[part] = strToU8(xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, (d) => {
      const c = cropMark.exec(d);
      const mode = colorModeOf(colorMark.exec(d)?.[1]);
      if (c) {
        const [l, t, r, b] = c[1].split(',').map(Number);
        d = d.replace('<a:srcRect/>', srcRectXml(cropOf({ l, t, r, b })));
      }
      if (mode) d = d.replace(/<a:blip\b([^>]*?)\/>/, `<a:blip$1>${BLIP_EFFECT[mode]}</a:blip>`);
      return d.replace(new RegExp(`${CROP}[\\d.,e-]+${CROP}|${COLOR}[a-z]+${COLOR}`, 'g'), '');
    }));
  }
  if (!hit) return bytes;
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: swap each marker paragraph in a text part for its drawing.
// The tempered pattern keeps the match inside one paragraph. A box's pictures and
// lists need parts of their own — the pass holds the whole zip, so it appends the
// media entries, their relationships and the numbering definitions here.
function applyTextBoxesDocx(bytes: Uint8Array, boxes: TextBoxDocx[]): Uint8Array {
  if (!boxes.length) return bytes;
  const files = unzipSync(bytes);
  let nextBm = 8000;
  // Media and numbering are named package-wide; relationships are each part's own.
  const media: TxbxParts['media'] = [];
  const nums: TxbxParts['nums'] = [];
  // The staged box tables leave the body. A box in a header or footer takes them too,
  // though a picture or link in one keeps a relationship id of the body's part.
  const tables = new Map<number, string>();
  const bodyPath = 'word/document.xml';
  if (files[bodyPath] && strFromU8(files[bodyPath]).includes(TBT)) {
    const para = (mark: string) => `<w:p\\b(?:(?!</w:p>)[\\s\\S])*?${TBT}${mark}${TBT}(?:(?!</w:p>)[\\s\\S])*?</w:p>`;
    files[bodyPath] = strToU8(strFromU8(files[bodyPath]).replace(new RegExp(`${para('S(\\d+)')}([\\s\\S]*?)${para('E\\1')}`, 'g'),
      (_m, i: string, inner: string) => { tables.set(Number(i), inner); return ''; }));
  }

  for (const part of textParts(files)) {
    let xml = strFromU8(files[part]);
    if (!xml.includes(TBX)) continue;
    const relsPath = relsOf(part);
    const rels = files[relsPath] ? strFromU8(files[relsPath]) : EMPTY_RELS;
    let nextRid = maxIdIn(rels, /Id="rId(\d+)"/g);
    const from = media.length;
    const parts: TxbxParts = { media, nums, links: [], nextRid: () => `rId${++nextRid}`, nextBookmarkId: () => ++nextBm, tables };

    // Only the marker run is rebuilt — the paragraph around it keeps its own properties
    // and whatever text stands beside the box. Tempered so a match can't span two runs.
    xml = xml.replace(
      new RegExp(`<w:r\\b[^>]*?>(?:(?!</w:r>)[\\s\\S])*?${TBX}(\\d+)${TBX}(?:(?!</w:r>)[\\s\\S])*?</w:r>`, 'g'),
      (_m, idx: string) => {
        const box = boxes[Number(idx)];
        return box ? `<w:r>${textBoxDrawingXml(box, Number(idx), parts)}</w:r>` : '';
      },
    );
    files[part] = strToU8(xml);

    const added = media.slice(from);
    if (added.length || parts.links.length) {
      files[relsPath] = strToU8(rels.replace('</Relationships>', added.map((m) =>
        `<Relationship Id="${m.rid}" Type="${R_NS}/image" Target="media/${m.path.split('/').pop()}"/>`).join('') +
        parts.links.map((l) =>
          `<Relationship Id="${l.rid}" Type="${R_NS}/hyperlink" Target="${escapeXml(l.href)}" TargetMode="External"/>`).join('') +
        '</Relationships>'));
    }
  }
  for (const m of media) files[m.path] = m.bytes as Uint8Array<ArrayBuffer>;

  const numPath = 'word/numbering.xml';
  const numXml = files[numPath] ? strFromU8(files[numPath]) : '';
  if (nums.length && numXml) {
    // Both id spaces are the package's, so one free number above its highest serves
    // as the abstract id and the concrete one alike.
    const base = Math.max(maxIdIn(numXml, /w:abstractNumId="(\d+)"/g), maxIdIn(numXml, /w:numId="(\d+)"/g)) + 1;
    const abstracts = nums.map((n, i) =>
      `<w:abstractNum w:abstractNumId="${base + i}"><w:multiLevelType w:val="hybridMultilevel"/>` +
      `${n.levels.filter(Boolean).join('')}</w:abstractNum>`).join('');
    const concretes = nums.map((_n, i) =>
      `<w:num w:numId="${base + i}"><w:abstractNumId w:val="${base + i}"/></w:num>`).join('');
    // w:abstractNum must precede every w:num, so both go where the first w:num is.
    const at = numXml.indexOf('<w:num ');
    files[numPath] = strToU8(at < 0
      ? numXml.replace('</w:numbering>', `${abstracts}${concretes}</w:numbering>`)
      : numXml.slice(0, at) + abstracts + concretes + numXml.slice(at));
    for (const part of textParts(files)) {
      files[part] = strToU8(strFromU8(files[part]).replace(new RegExp(`${TXBX_NUM}(\\d+)${TXBX_NUM}`, 'g'), (_m, i: string) => String(base + Number(i))));
    }
  }

  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Link each named list style to its shared abstract numbering: the library cannot
// express w:styleLink, so the pass injects it and points the numbering style's
// placeholder w:numId at the first concrete num over that abstract.
function applyListStylesDocx(bytes: Uint8Array, links: { name: string; configIndex: number }[]): Uint8Array {
  if (!links.length) return bytes;
  const files = unzipSync(bytes);
  const numberingBytes = files['word/numbering.xml'];
  const stylesBytes = files['word/styles.xml'];
  if (!numberingBytes || !stylesBytes) return bytes;

  let numbering = strFromU8(numberingBytes);
  let stylesXml = strFromU8(stylesBytes);
  // Abstract definitions in document order: the library's own default bullet abstract
  // first, then one per config entry — configIndex + 1 is the style's.
  const abstracts = numbering.match(/<w:abstractNum [\s\S]*?<\/w:abstractNum>/g) ?? [];
  for (const { name, configIndex } of links) {
    const abstract = abstracts[configIndex + 1];
    const absId = abstract && /w:abstractNumId="(\d+)"/.exec(abstract)?.[1];
    if (absId == null) continue;
    const styleId = docxStyleId(name);
    numbering = numbering.replace(abstract!,
      abstract!.replace(/(<w:multiLevelType[^>]*\/>)/, `$1<w:styleLink w:val="${styleId}"/>`));
    const numId = new RegExp(`<w:num w:numId="(\\d+)"[^>]*>\\s*<w:abstractNumId w:val="${absId}"/>`).exec(numbering)?.[1];
    if (!numId) continue;
    stylesXml = stylesXml.replace(
      new RegExp(`(<w:style w:type="numbering" w:styleId="${styleId}">[\\s\\S]*?<w:numId w:val=")0("/>)`),
      `$1${numId}$2`);
  }

  files['word/numbering.xml'] = strToU8(numbering);
  files['word/styles.xml'] = strToU8(stylesXml);
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Bind the outline abstract to the heading styles: each level names the style it
// numbers (w:pStyle) and each style points back at the numbering (w:numPr) — which is
// how Word writes chapter numbering, and what makes a new heading count on its own.
function applyOutlineNumberingDocx(bytes: Uint8Array, configIndex: number): Uint8Array {
  if (configIndex < 0) return bytes;
  const files = unzipSync(bytes);
  const numberingBytes = files['word/numbering.xml'];
  const stylesBytes = files['word/styles.xml'];
  if (!numberingBytes || !stylesBytes) return bytes;
  let numbering = strFromU8(numberingBytes);
  let stylesXml = strFromU8(stylesBytes);
  const abstract = (numbering.match(/<w:abstractNum [\s\S]*?<\/w:abstractNum>/g) ?? [])[configIndex + 1];
  const absId = abstract && /w:abstractNumId="(\d+)"/.exec(abstract)?.[1];
  if (absId == null) return bytes;
  let level = -1;
  const bound = abstract!
    .replace(/(<w:multiLevelType[^>]*\/>)/, '<w:multiLevelType w:val="multilevel"/>')
    // w:pStyle sits between w:lvlRestart and w:suff in the element's fixed order.
    .replace(/<w:lvl\b[\s\S]*?<\/w:lvl>/g, (lvl) => {
      level += 1;
      return lvl.replace(/(<w:numFmt[^>]*\/>)/, `$1<w:pStyle w:val="Heading${level + 1}"/>`);
    });
  numbering = numbering.replace(abstract!, bound);
  // No paragraph references the abstract — the styles do — so the library writes no
  // w:num for it and one has to be minted past the ids it did write.
  let numId = new RegExp(`<w:num w:numId="(\\d+)"[^>]*>\\s*<w:abstractNumId w:val="${absId}"/>`).exec(numbering)?.[1];
  if (!numId) {
    const ids = [...numbering.matchAll(/<w:num w:numId="(\d+)"/g)].map((m) => Number(m[1]));
    numId = String(Math.max(0, ...ids) + 1);
    numbering = numbering.replace('</w:numbering>', `<w:num w:numId="${numId}"><w:abstractNumId w:val="${absId}"/></w:num></w:numbering>`);
  }
  // w:numPr has its place in w:pPr's fixed order: after the keep/break flags, before
  // the borders, shading and tabs.
  for (let n = 1; n <= 9; n++) {
    const numPr = `<w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="${numId}"/></w:numPr>`;
    stylesXml = stylesXml.replace(
      new RegExp(`(<w:style w:type="paragraph"[^>]*w:styleId="Heading${n}"[\\s\\S]*?<w:pPr>(?:<w:(?:pStyle|keepNext|keepLines|pageBreakBefore|framePr|widowControl)\\b[^>]*/>)*)`),
      `$1${numPr}`);
  }
  files['word/numbering.xml'] = strToU8(numbering);
  files['word/styles.xml'] = strToU8(stylesXml);
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

const B_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';
const DS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/customXml';
// The part's identity inside the package, not the document's — one fixed value serves.
const BIB_ITEM_GUID = '{6A3C1F0E-7B12-4B4D-9E42-1B7C0D4A6F31}';

// A source's author list. Word's model is a list of persons, so "Last, First" splits and
// several are separated by a semicolon; anything else travels whole as a corporate name.
function bibAuthorXml(value: string): string {
  const names = value.split(';').map(s => s.trim()).filter(Boolean);
  const people = names.map((name) => {
    const at = name.indexOf(',');
    return at > 0
      ? `<b:Person><b:Last>${escapeXml(name.slice(0, at).trim())}</b:Last>`
        + `<b:First>${escapeXml(name.slice(at + 1).trim())}</b:First></b:Person>`
      : '';
  });
  const inner = people.every(Boolean) && people.length
    ? `<b:NameList>${people.join('')}</b:NameList>`
    : `<b:Corporate>${escapeXml(value)}</b:Corporate>`;
  return `<b:Author><b:Author>${inner}</b:Author></b:Author>`;
}

// The tag as the CITATION instruction and the source agree on it: the instruction is a
// quoted field argument, so a quote in the short name has nowhere to go.
const docxTag = (identifier: string): string => identifier.replace(/"/g, '');

function bibSourceXml(s: BibSource): string {
  const fields = Object.entries(s.fields)
    .filter(([k, v]) => k !== 'author' && DOCX_BIB_FIELD[k] && String(v ?? '').trim())
    .map(([k, v]) => `<b:${DOCX_BIB_FIELD[k]}>${escapeXml(String(v))}</b:${DOCX_BIB_FIELD[k]}>`)
    .join('');
  const author = String(s.fields.author ?? '').trim();
  return `<b:Source><b:Tag>${escapeXml(docxTag(s.identifier))}</b:Tag>`
    + `<b:SourceType>${DOCX_SOURCE_TYPE[s.type] ?? 'Misc'}</b:SourceType>`
    + (author ? bibAuthorXml(author) : '') + fields + '</b:Source>';
}

// Post-pack pass: the sources the CITATION fields name. Word keeps them in a custom-XML
// part of their own, which needs its properties part, two relationships and a content
// type — none of which the package knows about, so all four are minted here.
function applyBibliographyDocx(bytes: Uint8Array, sources: BibSource[], cite: CitationStyle): Uint8Array {
  // The part is also the citation style's only carrier (its StyleName attribute), so a
  // non-default style still writes it with no sources in it.
  if (!sources.length && cite === 'key') return bytes;
  const files = unzipSync(bytes);
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = files[relsPath] ? strFromU8(files[relsPath]) : '';
  const types = files['[Content_Types].xml'] ? strFromU8(files['[Content_Types].xml']) : '';
  if (!rels || !types) return bytes;

  files['customXml/item1.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<b:Sources xmlns:b="${B_NS}" SelectedStyle="\\${DOCX_STYLE_NAME[cite]}.XSL" StyleName="${DOCX_STYLE_NAME[cite]}">`
    + sources.map(bibSourceXml).join('') + '</b:Sources>');
  files['customXml/itemProps1.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<ds:datastoreItem xmlns:ds="${DS_NS}" ds:itemID="${BIB_ITEM_GUID}">`
    + `<ds:schemaRefs><ds:schemaRef ds:uri="${B_NS}"/></ds:schemaRefs></ds:datastoreItem>`);
  files['customXml/_rels/item1.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="${R_NS}/customXmlProps" Target="itemProps1.xml"/></Relationships>`);

  files[relsPath] = strToU8(rels.replace('</Relationships>',
    `<Relationship Id="rId${maxIdIn(rels, /Id="rId(\d+)"/g) + 1}" Type="${R_NS}/customXml" Target="../customXml/item1.xml"/></Relationships>`));
  files['[Content_Types].xml'] = strToU8(types.replace('</Types>',
    '<Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>'));

  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}


// Post-pack pass: swap each sentinel run for its <m:oMath>. A display formula
// additionally wraps its paragraph's content in <m:oMathPara>, which is how Word
// centers a formula on its own line.
function applyFormulasDocx(bytes: Uint8Array, formulas: FormulaDocx[]): Uint8Array {
  if (!formulas.length) return bytes;
  const files = unzipSync(bytes);
  // Tempered pattern: the match stays inside the one run that holds the sentinel — it
  // may cross neither </w:r> nor a nested <w:r> (a box's drawing run wraps whole
  // paragraphs, so matching from it would swallow the box preamble).
  const pattern = new RegExp(`<w:r\\b[^>]*?>(?:(?!</?w:r[\\s>])[\\s\\S])*?${MTH}(\\d+)${MTH}(?:(?!</?w:r[\\s>])[\\s\\S])*?</w:r>`, 'g');
  for (const part of textParts(files)) {
    const partBytes = files[part];
    if (!partBytes) continue;
    files[part] = strToU8(strFromU8(partBytes).replace(pattern, (_m, idx: string) => {
      const f = formulas[Number(idx)];
      if (!f) return '';
      const omath = ommlDocument(parseLatex(f.latex));
      // Centered is the math paragraph's default, so only another edge is written.
      const jc = f.align === 'left' || f.align === 'right' ? `<m:oMathParaPr><m:jc m:val="${f.align}"/></m:oMathParaPr>` : '';
      return f.display ? `<m:oMathPara xmlns:m="${OMML_NS}">${jc}${omath}</m:oMathPara>` : omath;
    }));
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: swap each sentinel run for a <w:ruby>. The sizes are half-points of
// the body default (12pt): Word wants the base size and the reading's, and recomputes
// neither — LibreOffice's own export writes the same four properties.
function applyRubyDocx(bytes: Uint8Array, rubies: RubyDocx[]): Uint8Array {
  if (!rubies.length) return bytes;
  const files = unzipSync(bytes);
  // Tempered like the formula pass: crossing a nested <w:r> would let a match starting
  // at a box's drawing run swallow the box preamble.
  const pattern = new RegExp(`<w:r\\b[^>]*?>(?:(?!</?w:r[\\s>])[\\s\\S])*?${RBY}(\\d+)${RBY}(?:(?!</?w:r[\\s>])[\\s\\S])*?</w:r>`, 'g');
  const rewrite = (xml: string) => xml.replace(pattern,
    (_m, idx: string) => {
      const r = rubies[Number(idx)];
      if (!r) return '';
      const run = (text: string, size = 0) =>
        `<w:r>${size ? `<w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` : ''}`
        + `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
      return '<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="center"/><w:hps w:val="12"/>'
        + `<w:hpsRaise w:val="24"/><w:hpsBaseText w:val="24"/><w:lid w:val="${docLangTag}"/></w:rubyPr>`
        + `<w:rt>${run(r.text, 12)}</w:rt><w:rubyBase>${run(r.base)}</w:rubyBase></w:ruby></w:r>`;
    },
  );
  for (const part of textParts(files)) {
    files[part] = strToU8(rewrite(strFromU8(files[part])));
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: swap each PLH sentinel run for a tagged inline <w:sdt> content
// control. w:temporary makes Word drop the control once the user types over it; the
// run keeps its own <w:rPr> and gains placeholder gray unless it has a color already.
function applyPlaceholdersDocx(bytes: Uint8Array, placeholders: string[]): Uint8Array {
  if (!placeholders.length) return bytes;
  const files = unzipSync(bytes);
  for (const part of textParts(files)) files[part] = strToU8(strFromU8(files[part]).replace(
    new RegExp(`<w:r\\b[^>]*?>(?:(?!</?w:r[\\s>])[\\s\\S])*?${PLH}(\\d+)${PLH}(?:(?!</?w:r[\\s>])[\\s\\S])*?</w:r>`, 'g'),
    (m, idx: string) => {
      const label = placeholders[Number(idx)];
      if (label === undefined) return '';
      let rpr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(m)?.[0] ?? '<w:rPr></w:rPr>';
      if (!rpr.includes('<w:color')) rpr = rpr.replace('<w:rPr>', '<w:rPr><w:color w:val="808080"/>');
      return `<w:sdt><w:sdtPr><w:alias w:val="${escapeXml(label)}"/><w:tag w:val="${PLACEHOLDER_SDT_TAG}"/>`
        + '<w:temporary/><w:text/></w:sdtPr><w:sdtContent>'
        + `<w:r>${rpr}<w:t xml:space="preserve">${escapeXml(label)}</w:t></w:r></w:sdtContent></w:sdt>`;
    },
  ));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

const W14_NS = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NS = 'http://schemas.microsoft.com/office/word/2012/wordml';

// Post-pack pass: word/commentsExtended.xml, which carries what w:comment cannot — a
// comment is handled (w15:done) and an answer names its comment (w15:paraIdParent).
// Both are keyed by the w14:paraId of a comment body's last paragraph, and the package
// writes neither part.
// Post-pack pass: each bracketed atom goes into its w:ins or w:del, after the passes that
// swap a formula, ruby or placeholder in. A field there is a complex one, as w:fldSimple
// may not sit in a revision; deleted, its text and instruction are w:delText/w:delInstrText.
function applyAtomRevisionsDocx(bytes: Uint8Array): Uint8Array {
  if (!docAtomRevisions.length) return bytes;
  const files = unzipSync(bytes);
  const run = (tag: string) => `<w:r\\b[^>]*?>(?:(?!</?w:r[\\s>])[\\s\\S])*?${ARV}${tag}${ARV}(?:(?!</?w:r[\\s>])[\\s\\S])*?</w:r>`;
  const pattern = new RegExp(`${run('o(\\d+)')}([\\s\\S]*?)${run('c\\1')}`, 'g');
  for (const part of textParts(files)) files[part] = strToU8(strFromU8(files[part]).replace(pattern, (_m, idx: string, inner: string) => {
    const r = docAtomRevisions[Number(idx)];
    if (!r) return inner;
    let xml = inner.replace(/<w:fldSimple w:instr="([^"]*)"[^>]*>([\s\S]*?)<\/w:fldSimple>/g, (_f, instr: string, result: string) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instr}</w:instrText></w:r>`
      + `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`);
    if (r.el === 'w:del') xml = xml.replace(/<(\/?)w:t\b/g, '<$1w:delText').replace(/<(\/?)w:instrText\b/g, '<$1w:delInstrText');
    return `<${r.el} w:id="${r.id}" w:author="${escapeXml(r.author)}" w:date="${escapeXml(r.date)}">${xml}</${r.el}>`;
  }));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: each w:del struck through another's insertion goes into that w:ins.
function applyStackedRevisionsDocx(bytes: Uint8Array): Uint8Array {
  if (!docStacked.size) return bytes;
  const files = unzipSync(bytes);
  for (const path of textParts(files)) {
    files[path] = strToU8(strFromU8(files[path]).replace(/<w:del w:id="(\d+)"[^>]*>[\s\S]*?<\/w:del>/g, (m, id: string) => {
      const ins = docStacked.get(Number(id));
      return ins ? `<w:ins w:id="${ins.id}" w:author="${escapeXml(ins.author)}" w:date="${escapeXml(ins.date)}">${m}</w:ins>` : m;
    }));
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// The changes each move is made of, by revision id: the deletion's and the insertion's.
function collectMoves(node: TiptapNode, out: Map<string, { del: Set<string>; ins: Set<string> }>): void {
  const note = (kind: string, a: Record<string, unknown> | undefined) => {
    if (!a?.moveId) return;
    const move = out.get(String(a.moveId)) ?? { del: new Set<string>(), ins: new Set<string>() };
    (kind === 'deletion' ? move.del : move.ins).add(String(a.id));
    out.set(String(a.moveId), move);
  };
  for (const m of node.marks ?? []) if (m.type === 'insertion' || m.type === 'deletion') note(m.type, m.attrs);
  const rev = node.attrs?.revMark as Record<string, Record<string, unknown>> | null | undefined;
  note('insertion', rev?.insertion);
  note('deletion', rev?.deletion);
  node.content?.forEach((child) => collectMoves(child, out));
}

// Post-pack pass: a move's w:del and w:ins runs become w:moveFrom and w:moveTo, each side inside
// one named range, and a moved text's deleted form is plain text again. Paragraph marks stay
// w:del and w:ins under the same id: LibreOffice ignores the move forms there (probed).
function applyMovesDocx(bytes: Uint8Array, doc: TiptapNode): Uint8Array {
  const moves = new Map<string, { del: Set<string>; ins: Set<string> }>();
  collectMoves(doc, moves);
  const pairs = [...moves.values()].filter((m) => m.del.size && m.ins.size);
  if (!pairs.length) return bytes;
  const files = unzipSync(bytes);
  const ATTRS = '((?:\\s+[\\w:]+="[^"]*")*)';
  for (const path of textParts(files)) {
    let xml = strFromU8(files[path]);
    pairs.forEach((move, n) => {
      for (const [ids, el, side] of [[move.del, 'w:del', 'From'], [move.ins, 'w:ins', 'To']] as const) {
        const nums = [...ids].map((id) => docRevisionIds.get(id)).filter((id) => id != null).join('|');
        if (!nums) continue;
        const tag = `w:move${side}`;
        xml = xml.replace(new RegExp(`<${el} w:id="(${nums})"${ATTRS}>([\\s\\S]*?)</${el}>`, 'g'), (_m, id: string, attrs: string, inner: string) =>
            `<${tag} w:id="${id}"${attrs}>${inner.replace(/<(\/?)w:delText\b/g, '<$1w:t').replace(/<(\/?)w:delInstrText\b/g, '<$1w:instrText')}</${tag}>`);
        const parts = [...xml.matchAll(new RegExp(`<${tag} w:id="(?:${nums})"${ATTRS}>`, 'g'))];
        if (!parts.length) continue;
        const first = parts[0], range = docRevisionId(`move range ${n} ${side} ${path}`);
        const start = first.index, end = xml.indexOf(`</${tag}>`, parts[parts.length - 1].index) + tag.length + 3;
        xml = `${xml.slice(0, start)}<w:move${side}RangeStart w:id="${range}"${first[1]} w:name="move${n + 1}"/>${xml.slice(start, end)}<w:move${side}RangeEnd w:id="${range}"/>${xml.slice(end)}`;
      }
    });
    files[path] = strToU8(xml);
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

function applyCommentsExtendedDocx(bytes: Uint8Array): Uint8Array {
  const threaded = docComments.filter((c) => c.resolved || c.parent !== undefined);
  if (!threaded.length) return bytes;
  const files = unzipSync(bytes);
  const relsPath = 'word/_rels/document.xml.rels';
  const comments = files['word/comments.xml'] ? strFromU8(files['word/comments.xml']) : '';
  const rels = files[relsPath] ? strFromU8(files[relsPath]) : '';
  const types = files['[Content_Types].xml'] ? strFromU8(files['[Content_Types].xml']) : '';
  if (!comments || !rels || !types) return bytes;

  const paraId = (id: number) => (0x10000000 + id).toString(16).toUpperCase().padStart(8, '0');
  let xml = comments.replace(/<w:comments\b(?![^>]*xmlns:w14=)/, `<w:comments xmlns:w14="${W14_NS}"`);
  // w14:paraId needs w14 declared mc:Ignorable, or a strict reader rejects the part.
  xml = xml.replace(/<w:comments\b(?![^>]*xmlns:mc=)/,
    '<w:comments xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"');
  xml = /<w:comments\b[^>]*\bmc:Ignorable="/.test(xml)
    ? xml.replace(/(<w:comments\b[^>]*\bmc:Ignorable=")((?:(?!w14\b)[^"])*")/, '$1w14 $2')
    : xml.replace(/<w:comments\b/, '<w:comments mc:Ignorable="w14"');
  // Every comment in a thread needs its own paraId, not only the ones being marked.
  const stamped = docComments.filter((c) => threaded.some((t) => t === c || t.parent === c.id));
  for (const c of stamped) {
    // Stamp the comment's last body paragraph (Word keys the whole comment off it);
    // the greedy tempered scan ends at the last <w:p before </w:comment>.
    xml = xml.replace(
      new RegExp(`(<w:comment w:id="${c.id}"(?:(?!</w:comment>)[\\s\\S])*)<w:p\\b`),
      `$1<w:p w14:paraId="${paraId(c.id)}"`,
    );
  }
  files['word/comments.xml'] = strToU8(xml);
  files['word/commentsExtended.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w15:commentsEx xmlns:w15="${W15_NS}">`
    + stamped.map((c) => `<w15:commentEx w15:paraId="${paraId(c.id)}"`
      + (c.parent === undefined ? '' : ` w15:paraIdParent="${paraId(c.parent)}"`)
      + ` w15:done="${c.resolved ? 1 : 0}"/>`).join('')
    + '</w15:commentsEx>');
  files[relsPath] = strToU8(rels.replace('</Relationships>',
    `<Relationship Id="rId${maxIdIn(rels, /Id="rId(\d+)"/g) + 1}" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>`));
  files['[Content_Types].xml'] = strToU8(types.replace('</Types>',
    '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>'));

  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// CT_Settings fixes its children's sequence (extracted from wml.xsd); several passes
// prepend into word/settings.xml, so the final pass re-sorts the part into this order.
const SETTINGS_ORDER = ['writeProtection', 'view', 'zoom', 'removePersonalInformation',
  'removeDateAndTime', 'doNotDisplayPageBoundaries', 'displayBackgroundShape',
  'printPostScriptOverText', 'printFractionalCharacterWidth', 'printFormsData',
  'embedTrueTypeFonts', 'embedSystemFonts', 'saveSubsetFonts', 'saveFormsData',
  'mirrorMargins', 'alignBordersAndEdges', 'bordersDoNotSurroundHeader',
  'bordersDoNotSurroundFooter', 'gutterAtTop', 'hideSpellingErrors',
  'hideGrammaticalErrors', 'activeWritingStyle', 'proofState', 'formsDesign',
  'attachedTemplate', 'linkStyles', 'stylePaneFormatFilter', 'stylePaneSortMethod',
  'documentType', 'mailMerge', 'revisionView', 'trackRevisions', 'doNotTrackMoves',
  'doNotTrackFormatting', 'documentProtection', 'autoFormatOverride', 'styleLockTheme',
  'styleLockQFSet', 'defaultTabStop', 'autoHyphenation', 'consecutiveHyphenLimit',
  'hyphenationZone', 'doNotHyphenateCaps', 'showEnvelope', 'summaryLength',
  'clickAndTypeStyle', 'defaultTableStyle', 'evenAndOddHeaders', 'bookFoldRevPrinting',
  'bookFoldPrinting', 'bookFoldPrintingSheets', 'drawingGridHorizontalSpacing',
  'drawingGridVerticalSpacing', 'displayHorizontalDrawingGridEvery',
  'displayVerticalDrawingGridEvery', 'doNotUseMarginsForDrawingGridOrigin',
  'drawingGridHorizontalOrigin', 'drawingGridVerticalOrigin', 'doNotShadeFormData',
  'noPunctuationKerning', 'characterSpacingControl', 'printTwoOnOne',
  'strictFirstAndLastChars', 'noLineBreaksAfter', 'noLineBreaksBefore',
  'savePreviewPicture', 'doNotValidateAgainstSchema', 'saveInvalidXml',
  'ignoreMixedContent', 'alwaysShowPlaceholderText', 'doNotDemarcateInvalidXml',
  'saveXmlDataOnly', 'useXSLTWhenSaving', 'saveThroughXslt', 'showXMLTags',
  'alwaysMergeEmptyNamespace', 'updateFields', 'hdrShapeDefaults', 'footnotePr',
  'endnotePr', 'compat', 'docVars', 'rsids', 'mathPr', 'attachedSchema',
  'themeFontLang', 'clrSchemeMapping', 'doNotIncludeSubdocsInStats',
  'doNotAutoCompressPictures', 'forceUpgrade', 'captions', 'readModeInkLockDown',
  'smartTagType', 'shapeDefaults', 'doNotEmbedSmartTags', 'decimalSymbol',
  'listSeparator'];

// LibreOffice's form has no hash; a file of another program keeps its own.
function applyRecordLockDocx(bytes: Uint8Array, lock: RecordLock | null): Uint8Array {
  if (!lock) return bytes;
  const files = unzipSync(bytes);
  const attrs = lock.word ?? ' w:edit="trackedChanges" w:enforcement="1"';
  files['word/settings.xml'] = strToU8(strFromU8(files['word/settings.xml']).replace('</w:settings>', `<w:documentProtection${attrs}/></w:settings>`));
  return zipSync(files);
}

// Post-pack pass (runs last): sort w:settings children into the schema sequence.
function orderDocxSettings(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const setBytes = files['word/settings.xml'];
  if (!setBytes) return bytes;
  const xml = strFromU8(setBytes);
  const m = /(<w:settings\b[^>]*>)([\s\S]*)(<\/w:settings>)/.exec(xml);
  if (!m) return bytes;
  const children = m[2].match(/<((?:w|m):\w+)\b(?:[^>]*\/>|[^>]*>[\s\S]*?<\/\1>)/g) ?? [];
  // Only reorder what the tokenizer accounted for completely.
  if (children.join('') !== m[2]) return bytes;
  const rank = (c: string) => {
    const i = SETTINGS_ORDER.indexOf(/^<[wm]+:(\w+)/.exec(c)?.[1] ?? '');
    return i < 0 ? SETTINGS_ORDER.length : i;
  };
  const sorted = [...children].sort((a, b) => rank(a) - rank(b));
  if (sorted.join('') === m[2]) return bytes;
  files['word/settings.xml'] = strToU8(xml.replace(m[0], m[1] + sorted.join('') + m[3]));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass (runs last) over what the library writes: a paragraph's w:pBdr sides
// as top, bottom, left, right (the schema's sequence is top, left, bottom, right, between,
// bar), and a page field with no cached result (a reader shows what it finds there).
const PBDR_ORDER = ['w:top', 'w:left', 'w:bottom', 'w:right', 'w:between', 'w:bar'];
function patchPackedXml(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  let changed = false;
  for (const [path, data] of Object.entries(files)) {
    if (!/^word\/.*\.xml$/.test(path)) continue;
    const xml = strFromU8(data);
    const sorted = xml.replace(/<w:pBdr>([\s\S]*?)<\/w:pBdr>/g, (_m, inner: string) => {
      const sides = inner.match(/<w:(?:top|left|bottom|right|between|bar)\b[^>]*\/>/g) ?? [];
      if (sides.join('') !== inner) return _m;
      const rank = (s: string) => PBDR_ORDER.indexOf(/^<(w:\w+)/.exec(s)![1]);
      return `<w:pBdr>${[...sides].sort((a, b) => rank(a) - rank(b)).join('')}</w:pBdr>`;
    }).replace(/(<w:instrText[^>]*>\s*(?:PAGE|NUMPAGES)\s*<\/w:instrText><w:fldChar w:fldCharType="separate"\/>)(<w:fldChar w:fldCharType="end"\/>)/g, '$1<w:t>1</w:t>$2');
    if (sorted === xml) continue;
    files[path] = strToU8(sorted);
    changed = true;
  }
  if (!changed) return bytes;
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: compatibility options, which the docx lib cannot write — flags in
// CT_Compat's order, since they go in ahead of its own w:compatSetting entries.
function applyCompatDocx(bytes: Uint8Array, flags: string[]): Uint8Array {
  if (!flags.length) return bytes;
  const files = unzipSync(bytes);
  const setBytes = files['word/settings.xml'];
  if (!setBytes) return bytes;
  const xml = strFromU8(setBytes);
  const els = flags.filter((f) => !xml.includes(`w:${f}`)).map((f) => `<w:${f}/>`).join('');
  files['word/settings.xml'] = strToU8(/<w:compat\b[^>]*>/.test(xml)
    ? xml.replace(/(<w:compat\b[^>]*>)/, `$1${els}`)
    : xml.replace(/(<w:settings\b[^>]*>)/, `$1<w:compat>${els}</w:compat>`));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: Word's mirror margins are a document setting (w:mirrorMargins in
// word/settings.xml); the docx lib writes only the per-section w:pgMar, where left and
// right are already the inner/outer pair the editor holds.
function applyMirrorMarginsDocx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const setBytes = files['word/settings.xml'];
  if (!setBytes) return bytes;
  const xml = strFromU8(setBytes);
  if (xml.includes('w:mirrorMargins')) return bytes;
  files['word/settings.xml'] = strToU8(
    xml.replace(/(<w:settings\b[^>]*>)/, '$1<w:mirrorMargins/>'),
  );
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: the package registers a footnote's pictures in
// word/_rels/footnotes.xml.rels and leaves the endnotes' `rId{file}` placeholders
// unresolved — a drawing no reader can follow. Mint the relationship and fill them in.
function applyEndnoteImagesDocx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const xmlBytes = files['word/endnotes.xml'];
  const xml = xmlBytes ? strFromU8(xmlBytes) : '';
  if (!xml.includes('rId{')) return bytes;
  const relsPath = 'word/_rels/endnotes.xml.rels';
  const rels = (files[relsPath] ? strFromU8(files[relsPath]) : `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`)
    .replace(/<Relationships([^>]*)\/>/, '<Relationships$1></Relationships>');
  let next = maxIdIn(rels, /Id="rId(\d+)"/g) + 1;
  const ids = new Map<string, string>();
  const added: string[] = [];
  files['word/endnotes.xml'] = strToU8(xml.replace(/rId\{([^}]+)\}/g, (_m, name: string) => {
    let id = ids.get(name);
    if (!id) {
      id = `rId${next++}`;
      ids.set(name, id);
      added.push(`<Relationship Id="${id}" Type="${R_NS}/image" Target="media/${name}"/>`);
    }
    return id;
  }));
  files[relsPath] = strToU8(rels.replace('</Relationships>', added.join('') + '</Relationships>'));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: the fonts the opened file carried, embedded again. A Word font part is
// obfuscated with a key of its own — the same XOR the importer undoes — so each cut gets a
// fresh GUID, a relationship, and its <w:embed…> inside the family's <w:font>.
function applyEmbeddedFontsDocx(bytes: Uint8Array, fonts: EmbeddedFont[]): Uint8Array {
  if (!fonts.length) return bytes;
  const files = unzipSync(bytes);
  const relsPath = 'word/_rels/fontTable.xml.rels';
  const tableBytes = files['word/fontTable.xml'];
  if (!tableBytes || !files[relsPath]) return bytes;
  const rels = strFromU8(files[relsPath]).replace(/<Relationships([^>]*)\/>/, '<Relationships$1></Relationships>');
  let next = maxIdIn(rels, /Id="rId(\d+)"/g) + 1;
  const added: string[] = [];
  // CT_Font is a sequence, so a family's cuts are written in this order.
  const CUTS = ['embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic'];
  const byFamily = new Map<string, [number, string][]>();
  fonts.forEach((font, i) => {
    const name = `font${i + 1}.odttf`;
    // getRandomValues, unlike randomUUID, exists outside a secure context too.
    const hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    const key = `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}}`;
    files[`word/fonts/${name}`] = deobfuscateOdttf(font.data.slice(), key) as Uint8Array<ArrayBuffer>;
    added.push(`<Relationship Id="rId${next}" Type="${R_NS}/font" Target="fonts/${name}"/>`);
    const rank = font.weight === 'bold' ? (font.style === 'italic' ? 3 : 1) : (font.style === 'italic' ? 2 : 0);
    const list = byFamily.get(font.family) ?? [];
    list.push([rank, `<w:${CUTS[rank]} r:id="rId${next++}" w:fontKey="${key}"/>`]);
    byFamily.set(font.family, list);
  });

  let table = strFromU8(tableBytes).replace(/<w:fonts([^>]*)\/>/, '<w:fonts$1></w:fonts>');
  for (const [family, cuts] of byFamily) {
    const name = escapeXml(family);
    const xml = cuts.sort((a, b) => a[0] - b[0]).map(([, x]) => x).join('');
    const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const empty = new RegExp(`<w:font w:name="${quoted}"([^>]*)/>`);
    const open = new RegExp(`(<w:font w:name="${quoted}"[^>]*>[\\s\\S]*?)</w:font>`);
    if (empty.test(table)) table = table.replace(empty, `<w:font w:name="${name}"$1>${xml}</w:font>`);
    else if (open.test(table)) table = table.replace(open, `$1${xml}</w:font>`);
    else table = table.replace('</w:fonts>', `<w:font w:name="${name}">${xml}</w:font></w:fonts>`);
  }
  files['word/fontTable.xml'] = strToU8(table);
  files[relsPath] = strToU8(rels.replace('</Relationships>', added.join('') + '</Relationships>'));

  const ct = files['[Content_Types].xml'] && strFromU8(files['[Content_Types].xml']);
  if (ct && !ct.includes('Extension="odttf"')) {
    files['[Content_Types].xml'] = strToU8(ct.replace(/(<Types\b[^>]*>)/,
      '$1<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'));
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: the page's own decoration. Word keeps the background on w:document
// (switched on in settings.xml), the border in every w:sectPr, and the watermark as a
// VML fontwork shape in each header part — the shapes LibreOffice writes, probed.
function applyPageDecorDocx(bytes: Uint8Array, decor: PageDecor, widthPt: number, heightPt: number): Uint8Array {
  const files = unzipSync(bytes);
  const docBytes = files['word/document.xml'];
  if (!docBytes) return bytes;
  let doc = strFromU8(docBytes);

  if (decor.background) {
    const color = decor.background.replace('#', '').toUpperCase();
    doc = doc.replace(/(<w:document\b[^>]*>)/, `$1<w:background w:color="${color}"/>`);
    const setBytes = files['word/settings.xml'];
    // Without this Word stores the colour but paints nothing. The docx package already
    // writes one; a duplicate breaks the CT_Settings sequence and Word repairs the file.
    if (setBytes) {
      const settings = strFromU8(setBytes);
      if (!settings.includes('<w:displayBackgroundShape')) {
        files['word/settings.xml'] = strToU8(
          settings.replace(/(<w:settings\b[^>]*>)/, '$1<w:displayBackgroundShape/>'),
        );
      }
    }
  }

  if (decor.border) {
    const color = decor.border.color.replace('#', '').toUpperCase();
    // w:sz is eighths of a point, w:space whole points from the text.
    const sz = Math.max(2, Math.round(decor.border.widthPt * 8));
    const space = Math.min(31, Math.round((decor.border.paddingCm / 2.54) * 72));
    const side = (name: string) => `<w:${name} w:val="single" w:sz="${sz}" w:space="${space}" w:color="${color}"/>`;
    const borders = `<w:pgBorders w:display="allPages" w:offsetFrom="text">`
      + `${side('top')}${side('left')}${side('bottom')}${side('right')}</w:pgBorders>`;
    // w:sectPr has a fixed child order and pgBorders belongs after pgMar; put ahead of
    // the header references, Word's reader drops those instead (probed in LibreOffice).
    doc = doc.replace(/<w:pgMar\b[^>]*\/>/g, (m) => `${m}${borders}`);
  }

  files['word/document.xml'] = strToU8(doc);

  const wm = decor.watermark;
  if (wm?.text) {
    const shape = watermarkVml(wm, widthPt, heightPt);
    for (const path of Object.keys(files)) {
      if (!/^word\/header\d*\.xml$/.test(path)) continue;
      const xml = strFromU8(files[path]);
      if (xml.includes(WATERMARK_NAME)) continue;
      // The shape has to sit inside a paragraph — as a child of w:hdr it is dropped
      // without a word. An empty zone serializes as a self-closed <w:p/>.
      files[path] = strToU8(xml.replace(/<w:p\b[^>]*\/>|(<w:p\b[^>]*>(?:<w:pPr>.*?<\/w:pPr>)?)/,
        (m, opening: string | undefined) =>
          opening ? `${opening}<w:r>${shape}</w:r>` : `<w:p><w:r>${shape}</w:r></w:p>`));
    }
  }

  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: fold + punch marks as named VML lines in every header part — the one
// place that repeats on every page — positioned from the page corner like the watermark.
function applyFoldMarksDocx(bytes: Uint8Array, on: boolean, pageWidthMm: number): Uint8Array {
  if (!on) return bytes;
  const files = unzipSync(bytes);
  const pt = (mm: number) => Math.round((mm / 25.4) * 72 * 100) / 100;
  const line = (id: string, xMm: number, mm: number, lenMm: number) =>
    `<v:line id="${id}" o:allowincell="f"` +
    ` style="position:absolute;mso-position-horizontal-relative:page;mso-position-vertical-relative:page;mso-wrap-style:none"` +
    ` from="${pt(xMm)}pt,${pt(mm)}pt" to="${pt(xMm + lenMm)}pt,${pt(mm)}pt"` +
    ` strokecolor="black" strokeweight=".72pt"><w10:wrap type="none"/></v:line>`;
  // Fold marks on both edges; the punch mark only left, where the pages are filed.
  const rightX = pageWidthMm - MARK_START_MM - FOLD_MARK_LEN_MM;
  const shapes = '<w:pict>'
    + FOLD_MARK_MM.map((mm, i) =>
      line(`${FOLD_MARK_NAME}${i + 1}`, MARK_START_MM, mm, FOLD_MARK_LEN_MM)
      + line(`${FOLD_MARK_NAME}${i + 1}R`, rightX, mm, FOLD_MARK_LEN_MM)).join('')
    + line(`${FOLD_MARK_NAME}Punch`, MARK_START_MM, PUNCH_MARK_MM, PUNCH_MARK_LEN_MM) + '</w:pict>';
  let changed = false;
  for (const path of Object.keys(files)) {
    if (!/^word\/header\d*\.xml$/.test(path)) continue;
    const xml = strFromU8(files[path]);
    if (xml.includes(FOLD_MARK_NAME)) continue;
    // Inside a paragraph, like the watermark: as a child of w:hdr the pict is dropped.
    files[path] = strToU8(xml.replace(/<w:p\b[^>]*\/>|(<w:p\b[^>]*>(?:<w:pPr>.*?<\/w:pPr>)?)/,
      (m, opening: string | undefined) =>
        opening ? `${opening}<w:r>${shapes}</w:r>` : `<w:p><w:r>${shapes}</w:r></w:p>`));
    changed = true;
  }
  if (!changed) return bytes;
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

const WATERMARK_NAME = 'PowerPlusWaterMarkObject';
// The shape's aspect ratio, measured off LibreOffice's own watermark.
const WATERMARK_RATIO = 4.487;

// Word has the `_x0000_t136` WordArt preset built in; LibreOffice resolves the shape's
// type only when the definition travels with it (probed: without this the watermark is
// silently dropped), so it is written out the way LibreOffice writes it itself.
const WATERMARK_SHAPETYPE =
  '<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800"' +
  ' path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas>' +
  '<v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/>' +
  '<v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/>' +
  '<v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/>' +
  '<v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/>' +
  '<v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas>' +
  '<v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800"' +
  ' o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/>' +
  '<v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles>' +
  '<o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>';

// Word's WordArt shape for a watermark: the `_x0000_t136` preset, positioned relative to
// the margins and centred, which is what makes it sit behind the whole page.
function watermarkVml(wm: Watermark, widthPt: number, heightPt: number): string {
  const w = Math.round(widthPt * 10) / 10;
  const h = Math.round((widthPt / WATERMARK_RATIO) * 10) / 10;
  // VML counts rotation clockwise, the dialog counter-clockwise.
  const rotation = ((-wm.angle % 360) + 360) % 360;
  const opacity = Math.round((1 - wm.transparency / 100) * 100) / 100;
  const style = `position:absolute;margin-left:0pt;margin-top:${Math.round((heightPt - h) / 2 * 10) / 10}pt;`
    + `width:${w}pt;height:${h}pt;mso-wrap-style:none;v-text-anchor:middle;rotation:${rotation};`
    + 'mso-position-horizontal:center;mso-position-horizontal-relative:margin;'
    + 'mso-position-vertical:center;mso-position-vertical-relative:margin';
  return '<w:pict>' + WATERMARK_SHAPETYPE
    + `<v:shape id="${WATERMARK_NAME}" o:spid="_x0000_s2049" type="#_x0000_t136" adj="10800"`
    + ` fillcolor="${wm.color}" stroked="f" o:allowincell="f" style="${style}">`
    + '<v:path textpathok="t"/>'
    + `<v:textpath on="t" fitshape="t" string="${escapeXmlAttr(wm.text)}"`
    + ` style="font-family:&quot;${escapeXmlAttr(wm.font)}&quot;;font-size:1pt" trim="t"/>`
    + `<v:fill type="solid" opacity="${opacity}"/><w10:wrap type="none"/></v:shape></w:pict>`;
}

const escapeXmlAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Word's num-format ids for the five ODF ones.
const DOCX_NUM_FMT: Record<string, string> = {
  '1': 'decimal', a: 'lowerLetter', A: 'upperLetter', i: 'lowerRoman', I: 'upperRoman',
};

// Post-pack pass: <w:footnotePr>/<w:endnotePr>, which the docx package does not expose.
// Word keeps the document's in settings.xml, LibreOffice reads a section's alone, so
// every w:sectPr repeats them (ahead of w:type, in the element's fixed order).
function applyNotePrDocx(bytes: Uint8Array, notes: NoteSettings): Uint8Array {
  const files = unzipSync(bytes);
  const setBytes = files['word/settings.xml'];
  if (!setBytes) return bytes;
  const block = (kind: NoteKind) => {
    const s = notes[kind];
    const tag = kind === 'footnote' ? 'footnotePr' : 'endnotePr';
    // Word's restart values; ODF's 'chapter' is its 'eachSect'.
    const restart = s.restart === 'page' ? 'eachPage' : s.restart === 'chapter' ? 'eachSect' : 'continuous';
    const pos = kind === 'footnote'
      ? `<w:pos w:val="${s.position === 'document' ? 'docEnd' : 'pageBottom'}"/>`
      : '<w:pos w:val="docEnd"/>';
    return `<w:${tag}>${pos}<w:numFmt w:val="${DOCX_NUM_FMT[s.numFormat] ?? 'decimal'}"/>`
      + `<w:numStart w:val="${Math.max(1, s.startAt)}"/><w:numRestart w:val="${restart}"/></w:${tag}>`;
  };
  files['word/settings.xml'] = strToU8(
    strFromU8(setBytes).replace(/(<w:settings\b[^>]*>)/, `$1${block('footnote')}${block('endnote')}`),
  );
  const docBytes = files['word/document.xml'];
  if (docBytes) {
    files['word/document.xml'] = strToU8(strFromU8(docBytes).replace(
      /<w:sectPr\b[^>]*>(?:<w:(?:header|footer)Reference\b[^>]*\/>)*/g, (m) => `${m}${block('footnote')}${block('endnote')}`));
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: the bookmark a NOTEREF field points at. Word marks the note's own
// reference mark inside footnotes.xml, not the anchor in the text, so the range is
// planted around the run holding <w:footnoteRef/> — the docx package has no hook there.
function applyNoteBookmarksDocx(bytes: Uint8Array): Uint8Array {
  if (!docNoteBookmarks.size) return bytes;
  const files = unzipSync(bytes);
  let id = 900000;
  for (const [noteId, name] of docNoteBookmarks) {
    const note = docNoteIds.get(noteId);
    const path = note ? `word/${note.kind}s.xml` : '';
    if (!note || !files[path]) continue;
    const bm = id++;
    const run = `<w:r>(?:(?!</w:r>)[\\s\\S])*?<w:${note.kind}Ref/>(?:(?!</w:r>)[\\s\\S])*?</w:r>`;
    files[path] = strToU8(strFromU8(files[path]).replace(
      new RegExp(`(<w:${note.kind} w:id="${note.id}"[^>]*>[\\s\\S]*?)(${run})`),
      `$1<w:bookmarkStart w:id="${bm}" w:name="${escapeXml(name)}"/>$2<w:bookmarkEnd w:id="${bm}"/>`));
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: a custom note mark (w:customMarkFollows), which the docx package
// cannot express. The anchor's reference gains the flag plus the literal character,
// and the note text shows the same character where <w:footnoteRef/> always sits.
function applyNoteMarksDocx(bytes: Uint8Array): Uint8Array {
  const marked = [...docNoteIds.values()].filter((n) => n.label);
  if (!marked.length) return bytes;
  const files = unzipSync(bytes);
  const patch = (path: string, from: RegExp, to: string) => {
    if (files[path]) files[path] = strToU8(strFromU8(files[path]).replace(from, to));
  };
  for (const n of marked) {
    const mark = `<w:t>${escapeXml(n.label!)}</w:t>`;
    patch('word/document.xml',
      new RegExp(`<w:${n.kind}Reference w:id="${n.id}"/>`),
      `<w:${n.kind}Reference w:customMarkFollows="1" w:id="${n.id}"/>${mark}`);
    patch(`word/${n.kind}s.xml`,
      new RegExp(`(<w:${n.kind} w:id="${n.id}">(?:(?!</w:${n.kind}>)[\\s\\S])*?)<w:${n.kind}Ref/>`),
      `$1${mark}`);
  }
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: a right-to-left section is <w:bidi/> in every w:sectPr, which the
// docx package does not expose (it has the paragraph-level flag only).
function applyBidiDocx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const docBytes = files['word/document.xml'];
  if (!docBytes) return bytes;
  files['word/document.xml'] = strToU8(
    strFromU8(docBytes).replace(/<w:sectPr\b[^>]*>/g, (m) => `${m}<w:bidi/>`),
  );
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Paragraph flags the docx package does not expose, each with the w:pPr children that
// follow it in CT_PPrBase — Word's schema is a sequence, so it goes in before the first.
const PPR_TAIL = 'spacing|ind|contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr';
const PPR_FLAGS = [
  { mark: NOHYP, xml: '<w:suppressAutoHyphens/>',
    before: new RegExp(`<w:(kinsoku|wordWrap|overflowPunct|topLinePunct|autoSpace|bidi|adjustRightInd|snapToGrid|${PPR_TAIL})\\b`) },
  { mark: NOSNAP, xml: '<w:snapToGrid w:val="0"/>', before: new RegExp(`<w:(${PPR_TAIL})\\b`) },
];

// Post-pack pass: the paragraph carries a marker run per flag instead; this drops the
// run and writes the flag into w:pPr.
function applyParagraphFlagsDocx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  let changed = false;
  for (const part of textParts(files)) {
    let xml = strFromU8(files[part]);
    const flags = PPR_FLAGS.filter((f) => xml.includes(f.mark));
    if (!flags.length && !xml.includes(INDC)) continue;
    changed = true;
    xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
      let p = para;
      const indc = new RegExp(`<w:r>(?:(?!</w:r>)[\\s\\S])*${INDC}([^${INDC}]*)${INDC}(?:(?!</w:r>)[\\s\\S])*</w:r>`).exec(p);
      // The payload is 'name=value' pairs; the run text would escape an XML quote.
      const indAttrs = indc?.[1].split(' ').map((kv) => ` w:${kv.replace('=', '="')}"`).join('');
      if (indc) p = p.replace(indc[0], '').replace(/<w:ind\b/, `$&${indAttrs}`);
      for (const f of flags) {
        if (!p.includes(f.mark)) continue;
        p = p.replace(new RegExp(`<w:r>(?:(?!</w:r>)[\\s\\S])*${f.mark}(?:(?!</w:r>)[\\s\\S])*</w:r>`, 'g'), '');
        // The block's own part: a w:pPrChange closes it and holds a w:pPr of its own.
        const pPr = /<w:pPr>(?:(?!<w:pPrChange\b)[\s\S])*?(?=<w:pPrChange\b|<\/w:pPr>)/.exec(p);
        if (!pPr) { p = p.replace(/^(<w:p\b[^>]*>)/, `$1<w:pPr>${f.xml}</w:pPr>`); continue; }
        const patched = f.before.test(pPr[0]) ? pPr[0].replace(f.before, `${f.xml}$&`) : `${pPr[0]}${f.xml}`;
        p = p.replace(pPr[0], patched);
      }
      return p;
    });
    files[part] = strToU8(xml);
  }
  if (!changed) return bytes;
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Post-pack pass: the docx package ends each section in an empty paragraph of its own,
// a blank line in Word that LibreOffice folds into the paragraph before, which loses its
// space below. The section mark goes onto that paragraph instead, where Word writes it;
// an empty one keeps its marker, which the importers drop as just that.
function applySectionMarksDocx(bytes: Uint8Array): Uint8Array {
  const files = unzipSync(bytes);
  const doc = files['word/document.xml'];
  if (!doc) return bytes;
  const xml = strFromU8(doc);
  const marker = /<w:p><w:pPr>(<w:sectPr\b[\s\S]*?<\/w:sectPr>)<\/w:pPr><\/w:p>/g;
  let out = '', last = 0;
  for (let m = marker.exec(xml); m; m = marker.exec(xml)) {
    const before = xml.slice(last, m.index);
    const start = before.endsWith('</w:p>') ? paragraphStart(before) : -1;
    const prev = start < 0 ? '' : before.slice(start);
    // One ending in a line break keeps it too: LibreOffice drops a break ending a section.
    if (!/<w:(r|hyperlink)\b/.test(prev) || /<w:br\b[^>]*\/><\/w:r>(?:<w:bookmarkEnd\b[^>]*\/>)*<\/w:p>$/.test(prev)) {
      out += before + m[0]; last = m.index + m[0].length; continue;
    }
    const own = /^(<w:p\b[^>]*>)(<w:pPr>[\s\S]*?<\/w:pPr>)?/.exec(prev)!;
    const pPr = own[2]
      ? own[2].includes('<w:pPrChange') ? own[2].replace('<w:pPrChange', `${m[1]}<w:pPrChange`) : own[2].replace(/<\/w:pPr>$/, `${m[1]}</w:pPr>`)
      : `<w:pPr>${m[1]}</w:pPr>`;
    out += before.slice(0, start) + own[1] + pPr + prev.slice(own[0].length);
    last = m.index + m[0].length;
  }
  if (!last) return bytes;
  files['word/document.xml'] = strToU8(out + xml.slice(last));
  const zipped: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) zipped[path] = [data, { level: 6 }];
  return zipSync(zipped);
}

// Where the top-level paragraph `xml` ends with opens: its own w:p, past any nested in a
// drawing's text.
function paragraphStart(xml: string): number {
  const tags = [...xml.matchAll(/<w:p(?=[\s>/])[^>]*?(\/?)>|<\/w:p>/g)];
  let depth = 0;
  for (let i = tags.length - 1; i >= 0; i--) {
    const t = tags[i];
    if (t[0] === '</w:p>') depth++;
    else if (!t[1] && --depth === 0) return t.index!;
  }
  return -1;
}

// ---- paragraphs ------------------------------------------------------------
// w:jc names the physical edge, as LibreOffice reads it. docx mirrors left and right on a
// `bidirectional` paragraph, so an rtl one passes the opposite edge to come out unchanged.
function alignOf(attrs: TiptapNode['attrs'], rtl = false): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (attrs?.textAlign) {
    case 'center': return AlignmentType.CENTER;
    case 'right': return rtl ? AlignmentType.LEFT : AlignmentType.RIGHT;
    case 'justify': return AlignmentType.BOTH;
    case 'left': return rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;
    default: return undefined;
  }
}

// Word's table styles carry w:spacing after=0 and LibreOffice's Table Contents zeroes both,
// which is what editor.css renders — written onto the paragraph itself, where a file without
// a table style needs it anyway.
function cellSpacingOf(attrs: TiptapNode['attrs'], node: TiptapNode): ISpacingProperties | undefined {
  const s = spacingOf(attrs);
  if (attrs?.styleName || node.type !== 'paragraph') return s;
  const def = resolveStyle(exportSheet, DEFAULT_STYLE).para;
  if (!def.spaceBefore && !def.spaceAfter) return s;
  return { ...(exportSpacingModel === 'max' ? { after: 0 } : { before: 0, after: 0 }), ...s };
}

function spacingOf(attrs: TiptapNode['attrs']): ISpacingProperties | undefined {
  const s: Writable<ISpacingProperties> = {};
  if (typeof attrs?.spaceBefore === 'number') s.before = ptToTwip(attrs.spaceBefore);
  if (typeof attrs?.spaceAfter === 'number') s.after = ptToTwip(attrs.spaceAfter);
  const lh = attrs?.lineHeight;
  if (lh != null) {
    const n = parseFloat(String(lh));
    if (Number.isFinite(n) && !/pt|px/.test(String(lh))) {
      s.line = Math.round(n * 240);
      s.lineRule = LineRuleType.AUTO;
    } else if (Number.isFinite(n)) {
      s.line = ptToTwip(/px/.test(String(lh)) ? n * 0.75 : n);
      s.lineRule = LineRuleType.EXACT;
    }
  }
  return Object.keys(s).length ? s : undefined;
}


type ParaOpts = { numbering?: { reference: string; level: number; instance?: number }; indentLeftTwip?: number; force?: TextProps; inCell?: boolean };

// Paragraph background ("colored field") → w:shd; per-side borders ("rule line") → w:pBdr.
function paraShadingOf(attrs: TiptapNode['attrs']) {
  const c = typeof attrs?.backgroundColor === 'string' ? hexColor(attrs.backgroundColor) : undefined;
  return c ? { type: ShadingType.CLEAR, fill: c, color: 'auto' } : undefined;
}

function paraBordersOf(attrs: TiptapNode['attrs']) {
  const out: { top?: IBorderOptions; left?: IBorderOptions; bottom?: IBorderOptions; right?: IBorderOptions } = {};
  for (const [attr, side] of [['borderTop', 'top'], ['borderLeft', 'left'], ['borderBottom', 'bottom'], ['borderRight', 'right']] as const) {
    const b = parseBorderAttr(attrs?.[attr] as string | null);
    // w:space is the gap to the rule in points; the editor draws none unless one is set.
    if (b && b !== 'none') out[side] = { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(b.widthPt * 8)), color: hexColor(b.color) ?? '000000', space: Number(attrs?.borderPadding) || 0 };
  }
  return Object.keys(out).length ? out : undefined;
}

// A block's w:pPr; a recorded format change writes the earlier one with the same builder.
function paragraphProps(node: TiptapNode, opts: ParaOpts): IParagraphPropertiesOptions {
  const attrs = node.attrs ?? {};
  const indent: Writable<IIndentAttributesProperties> = {};
  const pt = blockPt(node);
  const right = rightCm(attrs, pt);
  if (right !== 0) indent.right = cmToTwip(right);
  if (!opts.numbering) {
    const left = leftCm(attrs, pt);
    // An explicit 0 is kept: it overrides the named style's indent.
    if (left !== 0 || attrs.indent === 0) indent.left = cmToTwip(left);
    else if (opts.indentLeftTwip) indent.left = opts.indentLeftTwip;
    // Word splits the first-line indent into two exclusive attributes by sign.
    const first = firstLineCm(attrs, pt);
    if (first < 0) indent.hanging = cmToTwip(-first);
    else if (first > 0) indent.firstLine = cmToTwip(first);
  }
  // The block's named style (a heading style id is what HeadingLevel references anyway).
  const style = docxStyleId(styleOf(node));
  // w:tabs. Word measures w:pos from the left text margin, the same origin the attr
  // uses, so the position goes out unshifted by the paragraph's own indent.
  const stops = parseTabStops(attrs.tabStops);
  return {
    style,
    alignment: alignOf(attrs, attrs.dir === 'rtl'),
    spacing: opts.inCell ? cellSpacingOf(attrs, node) : spacingOf(attrs),
    indent: Object.keys(indent).length ? indent : undefined,
    pageBreakBefore: attrs.breakBefore === 'page' || undefined,
    // w:outlineLvl — the locale- and name-independent heading signal. A heading wearing
    // a style of its own ("Appendix 1") has nothing else that says what level it is.
    outlineLevel: node.type === 'heading' ? ((attrs.level as number) ?? 1) - 1 : undefined,
    widowControl: attrs.widowControl === false ? false : undefined,
    keepNext: typeof attrs.keepNext === 'boolean' ? attrs.keepNext : undefined,
    keepLines: attrs.keepLines === true || undefined,
    // w:bidi — the block's own base direction (textDirection.ts).
    bidirectional: attrs.dir === 'rtl' ? true : attrs.dir === 'ltr' ? false : undefined,
    tabStops: stops.length
      ? stops.map((s) => ({ type: DOCX_TAB_TYPE[s.align], position: cmToTwip(s.pos), leader: DOCX_LEADER[s.leader ?? ''] }))
      : undefined,
    numbering: opts.numbering,
    shading: paraShadingOf(attrs),
    border: paraBordersOf(attrs),
  };
}

function paragraphToDocx(node: TiptapNode, opts: ParaOpts = {}): Paragraph {
  const attrs = node.attrs ?? {};
  const indChars = indentCharsPayload(opts.numbering ? { indentRightChars: attrs.indentRightChars } : attrs);
  // Of a list change only a paragraph made a list has a form here: no old numbering.
  const format = attrs.revFormat as RevFormat | null | undefined;
  const madeList = format?.old?.list?.length === 0 && !!opts.numbering;
  const noForm = !!format?.old?.list && !madeList && sameBlockFormat(blockFormat(node.type, attrs), format.old);
  // Paragraph-mark run props carry the block's own font (see import/docx.ts).
  const markSize = typeof attrs.fontSize === 'string' ? fontSizeToHalfPoints(attrs.fontSize) : undefined;
  const markFont = fontPair(attrs.fontFamily, attrs.fontFamilyAsian, (f) => f);
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const blockLang = langProp(attrs.lang, attrs.langAsian);
  // Unmarked text renders at the block's size and font; a run without its own takes the
  // style's in Word, so the block's goes onto the runs as well as the paragraph mark.
  const runForce: TextProps = { ...opts.force };
  if (markSize) runForce.fontSizePt = markSize / 2;
  if (str(attrs.fontFamily)) runForce.fontFamily = attrs.fontFamily as string;
  if (str(attrs.fontFamilyAsian)) runForce.fontFamilyAsian = attrs.fontFamilyAsian as string;
  if (blockLang) Object.assign(runForce, { lang: str(attrs.lang) ?? opts.force?.lang, langAsian: str(attrs.langAsian) ?? opts.force?.langAsian });
  return new Paragraph({
    ...paragraphProps(node, opts),
    ...(format && !noForm ? { revision: { ...paragraphProps({ ...node, ...format.old }, madeList ? { ...opts, numbering: undefined } : opts), id: docRevisionId(format.id), author: format.author, date: format.date } } : {}),
    // The paragraph mark's own run properties; the language there formats the mark alone.
    run: markSize || markFont || blockLang || attrs.revMark
      ? { size: markSize, font: markFont, language: blockLang, ...revMarkRevisions(attrs.revMark) } : undefined,
    children: [
      ...(attrs.noHyphenation === true ? [new TextRun(NOHYP)] : []),
      ...(attrs.snapToGrid === false ? [new TextRun(NOSNAP)] : []),
      ...(indChars ? [new TextRun(`${INDC}${indChars}${INDC}`)] : []),
      ...inlineToRuns(node.content, runForce),
    ],
  });
}

// ---- lists -----------------------------------------------------------------
function listToParagraphs(
  node: TiptapNode, depth: number, reference: string, extraIndentCm: number,
  num: Numbering, out: (Paragraph | Table | TableOfContents)[], cycle: OrderedCycle = ROOT_ORDERED_CYCLE,
  style: ListStyleDef | null = null, instance = 0,
): void {
  const eff = effectiveListLevel(node.attrs ?? {}, node.type === 'orderedList', style, depth + 1);
  const indentCm = extraIndentCm + eff.indent;
  num.ensureLevel(reference, depth, node, indentCm, cycle, style);
  const levelLeftTwip = cmToTwip((depth + 1) * LIST_LEFT_STEP_CM + indentCm);
  const cChild = childCycle(cycle, eff.listStyleType, eff.kind === 'number');
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    let numberedFirst = false;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        const ref = num.forkFor(reference, depth + 1, child, cChild, style);
        listToParagraphs(child, depth + 1, ref, indentCm, num, out, cChild, style, ref === reference ? instance : 0);
      } else if (child.type === 'paragraph' || child.type === 'heading') {
        if (!numberedFirst) {
          docZoneLists?.push({ reference, instance });
          out.push(paragraphToDocx(child, { numbering: { reference, level: depth, instance } }));
          numberedFirst = true;
        } else {
          out.push(paragraphToDocx(child, { indentLeftTwip: levelLeftTwip }));
        }
      }
    }
  }
}

// A list carrying an unoverridden named list style shares the style's numbering
// definition (its own instance); anything else keeps a private, fully resolved one.
function listEntryToDocx(node: TiptapNode, num: Numbering, out: (Paragraph | Table | TableOfContents)[]): void {
  const style = listStyleOf(node);
  const start = typeof node.attrs?.start === 'number' ? node.attrs.start : null;
  const items = labelledItems(node);
  const last = num.lastOrdered;
  const continued = node.type === 'orderedList' && node.attrs?.continueNumbering === true
    && last && start === last.end + 1 ? last : null;
  const shared = continued ? null : style && !listStyleOverridden(node) && !(node.content ?? []).some(subtreeHasStart)
    ? num.refForStyle(style, start, items) : null;
  const target = continued ?? (style && shared ? shared : { reference: num.newReference(), instance: 0 });
  listToParagraphs(node, 0, target.reference, 0, num, out, ROOT_ORDERED_CYCLE, style, target.instance);
  if (node.type === 'orderedList') {
    num.lastOrdered = { reference: target.reference, instance: target.instance, end: (start ?? style?.levels[0]?.startAt ?? 1) + items - 1 };
  }
}

// ---- tables ----------------------------------------------------------------
// Per-column widths (cm) from the first row's proportional colwidth weights, scaled
// to fill the text column exactly. Mirrors odt.ts tableColumnWidthsCm.
function columnWidthsCm(node: TiptapNode, contentWidthCm: number): number[] | undefined {
  const firstRow = (node.content ?? []).find((r) => r.type === 'tableRow');
  if (!firstRow) return undefined;
  const weights: (number | null)[] = [];
  for (const cell of firstRow.content ?? []) {
    if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
    const colspan = (cell.attrs?.colspan as number) ?? 1;
    const cw = cell.attrs?.colwidth as number[] | null | undefined;
    for (let k = 0; k < colspan; k++) weights.push(cw && cw[k] ? cw[k] : null);
  }
  if (weights.length === 0) return undefined;
  const present = weights.filter((w): w is number => w != null);
  const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : 1;
  const filled = weights.map((w) => (w != null ? w : avg));
  const total = filled.reduce((a, b) => a + b, 0) || 1;
  const round3 = (v: number) => Math.round(v * 1000) / 1000;
  const cm = filled.map((w) => round3((w / total) * contentWidthCm));
  const sum = cm.reduce((a, b) => a + b, 0);
  cm[cm.length - 1] = round3(cm[cm.length - 1] + (contentWidthCm - sum));
  return cm;
}

const cellBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '000000' }; // 0.5pt

// A cell's per-side border attr → w:tcBorders options (size in eighth-points).
// Header cells and a table style's regions render bold/font via CSS in the editor, so
// bake that onto the cell's runs for Word.
function cellForce(style: TableStyle | undefined, cell: TiptapNode, bg: unknown): TextProps {
  const force = regionText(style, cell.attrs?.region);
  if (bg === HEADER_SHADE) force.bold = true;
  return force;
}

// "nil" is the explicit absence that wins every border-conflict rule in Word — a cell's
// "none" can still lose against table-level borders there; LibreOffice reads both alike.
const noneBorder: IBorderOptions = { style: BorderStyle.NIL, size: 0, color: 'auto' };

function docxCellBorder(attrs: Record<string, unknown> | undefined, side: BorderSide, fallback: IBorderOptions = cellBorder): IBorderOptions {
  const b = parseBorderAttr(attrs?.[side] as string | null);
  if (b === 'none') return noneBorder;
  if (b) return { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(b.widthPt * 8)), color: hexColor(b.color) ?? '000000' };
  return fallback;
}

// A synthetic inline node standing for the whole content of a formula cell; the
// inline walker turns it into the field Word reads.
const FORMULA_CELL = '__formula_cell__';

// The cell's blocks with its first paragraph replaced by that field, or null when the
// cell carries no formula. Everything the paragraph itself sets is kept.
function formulaCellContent(cell: TiptapNode): TiptapNode[] | null {
  const formula = typeof cell.attrs?.formula === 'string' ? cell.attrs.formula : '';
  const first = (cell.content ?? [])[0];
  if (!formula || !first || (first.type !== 'paragraph' && first.type !== 'heading')) return null;
  const text = (first.content ?? []).map(function textOf(n: TiptapNode): string {
    return n.type === 'text' ? n.text ?? '' : (n.content ?? []).map(textOf).join('');
  }).join('');
  const format = isCellFormat(cell.attrs?.cellFormat) ? cell.attrs.cellFormat : null;
  const field: TiptapNode = { type: FORMULA_CELL, attrs: { formula, text, format } };
  return [{ ...first, content: [field] }, ...(cell.content ?? []).slice(1)];
}

function cellBlocksToDocx(content: TiptapNode[] = [], force: TextProps, num: Numbering, contentWidthCm: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const child of content) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      listEntryToDocx(child, num, out);
    } else if (child.type === 'table') {
      out.push(tableToDocx(child, contentWidthCm, num));
    } else if (child.type === 'paragraph' || child.type === 'heading') {
      out.push(paragraphToDocx(emitFloatingTables(child, contentWidthCm, num, out), { force, inCell: true }));
    }
  }
  // A cell ends with a paragraph, or Word reports the file damaged.
  if (!(out[out.length - 1] instanceof Paragraph)) out.push(new Paragraph({}));
  return out;
}

function tableToDocx(node: TiptapNode, contentWidthCm: number, num: Numbering, float?: ITableFloatOptions): Table {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
  // LibreOffice's reject takes the whole table for a column some row has no cell of (probed).
  const mergedColumn = rows.some((row) => !row.attrs?.revMark && !row.content?.some((c) => c.attrs?.revMark));
  // The named table style, if the registry still knows it: Word gets the reference
  // (w:tblStyle) plus the baked cell formatting, since w:tblStylePr isn't emitted.
  const styleName = typeof node.attrs?.tableStyle === 'string' ? node.attrs.tableStyle : null;
  const tableStyle = styleName ? exportSheet.table?.[styleName] : undefined;
  const look = parseTableLook(node.attrs?.tableLook);
  // A dragged table edge (tableColumnResize.ts) → w:tblInd + the narrower grid.
  let ml = Number(node.attrs?.marginLeft) || 0;
  let mr = Number(node.attrs?.marginRight) || 0;
  if (ml + mr > contentWidthCm - 1) { ml = 0; mr = 0; }
  const pad = parseCellPadding(node.attrs?.cellPadding) ?? DEFAULT_CELL_PADDING;
  const colsCm = columnWidthsCm(node, contentWidthCm - ml - mr);
  const colsTwip = colsCm?.map(cmToTwip);
  const totalTwip = colsTwip ? colsTwip.reduce((a, b) => a + b, 0) : cmToTwip(contentWidthCm - ml - mr);

  // w:tblHeader on the first row is what makes Word repeat it on every page.
  const repeatHeader = node.attrs?.repeatHeader === true;
  // Every cell writes all four sides itself, so the table level adds nothing — and on a
  // styled table its black default shows in Word, whose table borders beat a cell's
  // "none" (only "nil" loses). The editor's base grid still arrives via the cell fallback.
  const tableBorder = tableStyle ? noneBorder : cellBorder;
  const gridCols = Math.max(1, (rows[0]?.content ?? []).reduce((n, c) => n + ((c.attrs?.colspan as number) || 1), 0));
  const tableRows = rows.map((row, rowIndex) => {
    const rh = row.attrs?.rowHeight;
    let col = 0;
    const cells: TableCell[] = [];
    for (const cell of row.content ?? []) {
      if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') continue;
      const colspan = (cell.attrs?.colspan as number) ?? 1;
      const rowspan = (cell.attrs?.rowspan as number) ?? 1;
      const bg = cell.attrs?.backgroundColor;
      const fill = typeof bg === 'string' ? hexColor(bg) : undefined;
      const widthTwip = colsTwip ? colsTwip.slice(col, col + colspan).reduce((a, b) => a + b, 0) : undefined;
      col += colspan;
      // The cell's own margins (w:tcMar); absent, Word falls back to the table's.
      const ownPad = parseCellPadding(cell.attrs?.cellPadding);
      const content = formulaCellContent(cell) ?? cell.content;
      cells.push(new TableCell({
        ...(mergedColumn ? {} : revMarkRevisions(cell.attrs?.revMark)),
        columnSpan: colspan > 1 ? colspan : undefined,
        rowSpan: rowspan > 1 ? rowspan : undefined,
        margins: ownPad
          ? { marginUnitType: WidthType.DXA, top: cmToTwip(ownPad[0]), right: cmToTwip(ownPad[1]), bottom: cmToTwip(ownPad[2]), left: cmToTwip(ownPad[3]) }
          : undefined,
        shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
        // Content set against the middle/bottom of the box → w:vAlign.
        verticalAlign: cell.attrs?.verticalAlign === 'middle' ? 'center'
          : cell.attrs?.verticalAlign === 'bottom' ? 'bottom' : undefined,
        width: widthTwip ? { size: widthTwip, type: WidthType.DXA } : undefined,
        borders: {
          top: docxCellBorder(cell.attrs, 'borderTop'),
          bottom: docxCellBorder(cell.attrs, 'borderBottom'),
          left: docxCellBorder(cell.attrs, 'borderLeft'),
          right: docxCellBorder(cell.attrs, 'borderRight'),
        },
        // A nested table measures against the cell's text width, as on import.
        children: cellBlocksToDocx(content, cellForce(tableStyle, cell, bg), num,
          (widthTwip ? widthTwip * 2.54 / 1440 : (contentWidthCm - ml - mr) * colspan / gridCols)
            - (ownPad ?? pad)[1] - (ownPad ?? pad)[3]),
      }));
    }
    return new TableRow({
      ...revMarkRevisions(row.attrs?.revMark),
      height: typeof rh === 'number' && rh > 0 ? { value: pxToTwip(rh), rule: HeightRule.ATLEAST } : undefined,
      ...(row.attrs?.cantSplit === true ? { cantSplit: true } : {}),
      // The flag marks a header row, whether the table asked for the repeat or only the
      // row's own cells say they head it — ODF spells both with one element.
      ...((repeatHeader && rowIndex === 0) || (row.content ?? []).some((c) => c.type === 'tableHeader')
        ? { tableHeader: true } : {}),
      children: cells,
    });
  });

  return new Table({
    ...(float ? { float } : {}),
    ...(tableStyle ? {
      style: docxStyleId(tableStyle.name),
      // Word's Table Style Options are w:tblLook (its band flags are inverted).
      tableLook: {
        firstRow: look.headerRow, lastRow: look.lastRow,
        firstColumn: look.firstColumn, lastColumn: look.lastColumn,
        noHBand: !look.bandedRow, noVBand: !look.bandedColumn,
      },
    } : {}),
    rows: tableRows,
    columnWidths: colsTwip,
    width: { size: totalTwip, type: WidthType.DXA },
    // The table's own edge, negative where it hangs into the page margin: what we write
    // declares Word 2013 compatibility, where w:tblInd means exactly that.
    indent: ml ? { size: cmToTwip(ml), type: WidthType.DXA } : undefined,
    layout: TableLayoutType.FIXED,
    margins: { marginUnitType: WidthType.DXA, top: cmToTwip(pad[0]), right: cmToTwip(pad[1]), bottom: cmToTwip(pad[2]), left: cmToTwip(pad[3]) },
    borders: {
      top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder,
      insideHorizontal: tableBorder, insideVertical: tableBorder,
    },
  });
}

// An index (TOC/INDEX/BIBLIOGRAPHY) as a complex field whose result is the editor's
// cached rows: Word shows them as saved — Word for Mac never updates fields on open —
// and a field update regenerates them.
function indexFieldParagraphs(node: TiptapNode, kind: IndexKind, maxLevel: number, contentWidthCm: number, breakBefore = false): Paragraph[] {
  const a = node.attrs ?? {};
  const noPages = a.pageNumbers === false;
  const instr =
    // `\n` is a TOC switch that INDEX has no counterpart for; Word ignores the unknown
    // one and regenerates its rows, and this side reads it back.
    kind === 'alphabetical' ? `INDEX \\c "${indexColumns(node)?.count ?? 1}" \\e "\t"${noPages ? ' \\n' : ''}`
    : kind === 'bibliography' ? 'BIBLIOGRAPHY'
    // `\n` over the whole range: Word's switch takes levels, the editor's index is
    // all-or-nothing.
    : kind === 'toc' ? `TOC \\h \\o "1-${maxLevel}"${noPages ? ` \\n 1-${maxLevel}` : ''}`
    // `\c`, not `\a`: Word's own Insert Table of Figures keeps the label and number
    // in the entry, which is what the editor's cached entries already read.
    : `TOC \\h \\c "${DOCX_SEQ_NAME[kind === 'tables' ? 'table' : 'figure']}"${noPages ? ' \\n' : ''}`;
  const raw = Array.isArray(a.entries) ? (a.entries as { text?: unknown; level?: unknown; page?: unknown; pages?: unknown }[]) : [];
  const entries = raw.map((e) => ({
    text: typeof e.text === 'string' ? e.text : '',
    level: typeof e.level === 'number' && e.level >= 1 ? Math.round(e.level) : 1,
    // '' is a term heading its subentries, which lists no page.
    pages: Array.isArray(e.pages) ? e.pages.join(', ') : String(typeof e.page === 'number' ? e.page : 1),
  }));
  const noPage = kind === 'bibliography' || noPages;
  const leader = DOCX_LEADER[String(a.leader ?? '')];
  // In columns the rows end at their column's edge.
  const cols = indexColumns(node);
  const rowWidthCm = cols ? (contentWidthCm - cols.gapCm * (cols.count - 1)) / cols.count : contentWidthCm;
  const tabCm = typeof a.tabPosCm === 'number' && a.tabPosCm > 0 ? a.tabPosCm : rowWidthCm;
  const open = runsFromXml(
    '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'
    + `<w:r><w:instrText xml:space="preserve"> ${escapeXml(instr)} </w:instrText></w:r>`
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>');
  const close = runsFromXml('<w:r><w:fldChar w:fldCharType="end"/></w:r>');
  const brk = breakBefore ? { pageBreakBefore: true } : {};
  if (!entries.length) return [new Paragraph({ children: [...open, ...close], ...brk })];
  const levelStyles = Array.isArray(a.levelStyles) ? (a.levelStyles as unknown[]) : [];
  // A level's own style where the file named one, else one level = 0.5cm — the indent the
  // editor draws (LibreOffice's own Contents 1…5).
  const own = (level: number): string | null => {
    const name = levelStyles[level - 1];
    return typeof name === 'string' && name ? name : null;
  };
  return entries.map((e, i) => new Paragraph({
    ...(i === 0 ? brk : {}),
    style: own(e.level) ? docxStyleId(own(e.level)!) : undefined,
    indent: own(e.level) || e.level === 1 ? undefined : { left: cmToTwip(0.5 * (e.level - 1)) },
    // Written even with no page number running to it: it is where the row's leader is
    // kept, and a stop no tab reaches changes nothing on the page.
    tabStops: [{ type: TabStopType.RIGHT, position: cmToTwip(tabCm), ...(leader ? { leader } : {}) }],
    children: [
      ...(i === 0 ? open : []),
      ...e.text.split('\n').flatMap((line, li) => line.split('\t').flatMap((part, ti) => [
        ...(ti ? runsFromXml('<w:r><w:tab/></w:r>') : []),
        new TextRun(li && !ti ? { text: part, break: 1 } : { text: part }),
      ])),
      ...(noPage || !e.pages ? [] : runsFromXml(`<w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">${escapeXml(e.pages)}</w:t></w:r>`)),
      ...(i === entries.length - 1 ? close : []),
    ],
  }));
}

// A text box whose whole content is one table — the editor's floating table. w:tblpPr
// has no place for the frame's own outline or fill; the table's borders carry over.
function floatingTableOf(node: TiptapNode): TiptapNode | null {
  if (node.type !== 'textBox' || node.content?.length !== 1) return null;
  return node.content[0].type === 'table' ? node.content[0] : null;
}

function frameWidthCm(box: TiptapNode, fallbackCm: number): number {
  const w = box.attrs?.width;
  return typeof w === 'number' && w > 0 ? (w * 2.54) / 96 : fallbackCm;
}

// Each of a paragraph's floating-table frames becomes a table of its own ahead of it,
// and the paragraph comes back without them.
function emitFloatingTables(
  node: TiptapNode, contentWidthCm: number, num: Numbering, out: (Paragraph | Table | TableOfContents)[],
): TiptapNode {
  const floats = (node.content ?? []).filter(c => floatingTableOf(c));
  if (!floats.length) return node;
  for (const box of floats) {
    out.push(tableToDocx(floatingTableOf(box)!, frameWidthCm(box, contentWidthCm), num, tableFloatOptions(box)));
  }
  return { ...node, content: (node.content ?? []).filter(c => !floats.includes(c)) };
}

// The frame's place as w:tblpPr: the x either an offset or the side it takes, the y
// counted from the page or from the text it rides, and the wrap gap on both sides.
function tableFloatOptions(box: TiptapNode): ITableFloatOptions {
  const a = box.attrs ?? {};
  const g = wrapGap(a.wrapDist);
  const x = typeof a.wrapOffset === 'number' ? a.wrapOffset : null;
  return {
    horizontalAnchor: TableAnchorType.MARGIN,
    ...(x != null
      ? { absoluteHorizontalPosition: cmToTwip(x) }
      : { relativeHorizontalPosition: a.wrap === 'right' ? RelativeHorizontalPosition.RIGHT : RelativeHorizontalPosition.LEFT }),
    verticalAnchor: a.wrapFromPage === true ? TableAnchorType.PAGE : TableAnchorType.TEXT,
    absoluteVerticalPosition: cmToTwip(typeof a.wrapOffsetY === 'number' ? a.wrapOffsetY : 0),
    leftFromText: cmToTwip(g.left),
    rightFromText: cmToTwip(g.right),
    topFromText: cmToTwip(g.top),
    bottomFromText: cmToTwip(g.bottom),
  };
}

// Word has no page break on a table: its first cell's paragraph asks for the page, and
// both word processors move the whole table there.
function breakInFirstCell(table: TiptapNode): TiptapNode {
  const [row, ...rows] = table.content ?? [];
  const [cell, ...cells] = row?.content ?? [];
  const [para, ...rest] = cell?.content ?? [];
  if (table.attrs?.breakBefore !== 'page' || (para?.type !== 'paragraph' && para?.type !== 'heading')) return table;
  const first = { ...para, attrs: { ...para.attrs, breakBefore: 'page' } };
  return { ...table, content: [{ ...row, content: [{ ...cell, content: [first, ...rest] }, ...cells] }, ...rows] };
}

// ---- top-level walk --------------------------------------------------------
function blocksToDocx(content: TiptapNode[], num: Numbering, contentWidthCm: number): (Paragraph | Table | TableOfContents)[] {
  const out: (Paragraph | Table | TableOfContents)[] = [];
  for (const node of content) {
    if (node.type === 'paragraph' || node.type === 'heading') {
      // A frame holding nothing but a table is Word's floating table: a table of its own
      // ahead of the paragraph anchoring it, placed by w:tblpPr, not a shape in its run.
      out.push(paragraphToDocx(emitFloatingTables(node, contentWidthCm, num, out)));
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      listEntryToDocx(node, num, out);
    } else if (node.type === 'table') {
      out.push(tableToDocx(breakInFirstCell(node), contentWidthCm, num));
    } else if (node.type === 'image') {
      out.push(new Paragraph({ children: inlineToRuns([node]) }));
    } else if (node.type === 'tableOfContents') {
      // A real field (TOC/INDEX/BIBLIOGRAPHY) whose result is the editor's cached rows.
      // A list of figures/tables is the same field over a caption label (\c) instead of
      // the heading levels. The title is a plain bold paragraph so it isn't itself
      // listed, and is omitted where the index has none.
      const kind = indexKindOf(node.attrs?.index);
      const tocTitle = indexTitleOf(node);
      const depth = Number(node.attrs?.maxLevel);
      const maxLevel = depth >= 1 ? Math.min(MAX_HEADING_LEVEL, depth) : MAX_HEADING_LEVEL;
      // The break rides whichever paragraph the index opens with — its title, else the
      // field's own first row, which is where Word keeps it.
      const brk = node.attrs?.breakBefore === 'page';
      if (tocTitle) out.push(new Paragraph({ children: [new TextRun({ text: tocTitle, bold: true, size: 32 })], spacing: { after: cmToTwip(0.3) }, ...(brk ? { pageBreakBefore: true } : {}) }));
      out.push(...indexFieldParagraphs(node, kind, maxLevel, contentWidthCm, brk && !tocTitle));
    }
  }
  return out;
}

const indexTitleOf = (node: TiptapNode): string => {
  const raw = node.attrs?.title;
  return typeof raw === 'string' ? raw : INDEX_TITLES[indexKindOf(node.attrs?.index)];
};

// The columns an index lays its rows out in, null for one.
function indexColumns(node: TiptapNode): { count: number; gapCm: number } | null {
  const n = Number(node.attrs?.columns);
  if (node.type !== 'tableOfContents' || !(n > 1)) return null;
  return { count: Math.min(3, Math.round(n)), gapCm: Number(node.attrs?.columnGapCm) || INDEX_COLUMN_GAP_CM };
}

// One body section: a run of ordinary blocks (columns: null) or one columns node's
// content. DOCX has no block-level column container — a mid-document multi-column
// region is its own section, delimited by continuous section breaks.
type BodyGroup = {
  // Which header/footer set the group belongs to (index into HfExport.sections).
  section: number;
  columns: { count: number; gapCm: number } | null;
  children: (Paragraph | Table | TableOfContents)[];
};

// A block carrying `sectionBreak` opens the next section — on import it may already sit
// inside a columns node, so its first child counts too.
function startsSection(node: TiptapNode): boolean {
  if (node.attrs?.sectionBreak === true) return true;
  return node.type === 'columns' && node.content?.[0]?.attrs?.sectionBreak === true;
}

// `widthCm(section)`: the text width the section's blocks are sized against.
function bodyGroups(content: TiptapNode[], num: Numbering, widthCm: (section: number) => number): BodyGroup[] {
  const groups: BodyGroup[] = [];
  let section = 0;
  let plain: TiptapNode[] = [];
  // Adjacent equal-attr fragments (a columnsFlow page-split chain) = one section;
  // their blocks are collected raw so page-split paragraphs merge before serializing.
  let cols: { count: number; gapCm: number; blocks: TiptapNode[] } | null = null;
  const flushPlain = () => {
    if (!plain.length) return;
    groups.push({ section, columns: null, children: blocksToDocx(plain, num, widthCm(section)) });
    plain = [];
  };
  const flushCols = () => {
    if (!cols) return;
    groups.push({
      section,
      columns: { count: cols.count, gapCm: cols.gapCm },
      // A table in the section fills one column.
      children: blocksToDocx(mergeJoinedParagraphsJson(cols.blocks), num,
        (widthCm(section) - cols.gapCm * (cols.count - 1)) / cols.count),
    });
    cols = null;
  };
  for (const node of content) {
    if (startsSection(node)) {
      flushCols();
      flushPlain();
      section++;
    }
    if (node.type === 'columns') {
      const a = node.attrs ?? {};
      const count = typeof a.count === 'number' ? Math.min(3, Math.max(2, Math.round(a.count))) : 2;
      const gapCm = typeof a.gapCm === 'number' && Number.isFinite(a.gapCm) ? Math.min(5, Math.max(0, a.gapCm)) : 0.5;
      if (cols && cols.count === count && cols.gapCm === gapCm) {
        cols.blocks.push(...(node.content ?? []));
      } else {
        flushCols();
        flushPlain();
        cols = { count, gapCm, blocks: [...(node.content ?? [])] };
      }
    } else if (indexColumns(node)) {
      // An index in columns is a columns section of its own, its title above it.
      flushCols();
      flushPlain();
      const children = blocksToDocx([node], num, widthCm(section));
      if (indexTitleOf(node)) groups.push({ section, columns: null, children: children.splice(0, 1) });
      groups.push({ section, columns: indexColumns(node), children });
    } else {
      flushCols();
      plain.push(node);
    }
  }
  flushCols();
  flushPlain();
  if (!groups.length) groups.push({ section: 0, columns: null, children: [] });
  return groups;
}

// The style name a block carries: its own, else the node type's default.
// The w:ind character attributes of a block, as 'name=value' pairs (hundredths of a
// character). A hanging count adds to the left one on import, so it is taken off here.
function indentCharsPayload(attrs: TiptapNode['attrs']): string {
  const n = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) : 0);
  const first = n(attrs?.indentFirstChars);
  const left = n(attrs?.indentChars);
  const right = n(attrs?.indentRightChars);
  // A hanging count alone would read back as a left indent too, so it needs a left count.
  const hanging = first < 0 && left ? -first : 0;
  return [left ? `leftChars=${Math.max(0, left - hanging)}` : '', first > 0 ? `firstLineChars=${first}` : '',
    hanging ? `hangingChars=${hanging}` : '', right ? `rightChars=${right}` : ''].filter(Boolean).join(' ');
}

// The size a block's unmarked text is set in, in points; a character indent counts in it.
function blockPt(node: TiptapNode): number {
  const own = node.attrs?.fontSize;
  if (typeof own === 'string' && own) return parseFloat(own);
  return resolveStyle(exportSheet, styleOf(node)).text.fontSizePt ?? 12;
}

// Stamps each display formula with its paragraph's alignment, the attr over the named
// style's, for its m:jc: Word places a math paragraph by that alone, not by w:jc.
// shortcut: an unaligned rtl paragraph counts as left; resolve its direction if one shows up.
function alignDisplayFormulas(node: TiptapNode): TiptapNode {
  if (!node.content?.length) return node;
  const ta = node.attrs?.textAlign;
  const align = node.type === 'paragraph' || node.type === 'heading'
    ? (ta === 'center' || ta === 'right' || ta === 'justify' ? ta : resolveStyle(exportSheet, styleOf(node)).para.textAlign ?? 'left')
    : null;
  return { ...node, content: node.content.map((c) => c.type === 'formula' && c.attrs?.display === true && align
    ? { ...c, attrs: { ...c.attrs, align: align === 'justify' ? 'left' : align } }
    : alignDisplayFormulas(c)) };
}

function styleOf(node: TiptapNode): string {
  const own = node.attrs?.styleName;
  if (typeof own === 'string' && own) return own;
  return node.type === 'heading' ? `Heading ${(node.attrs?.level as number) ?? 1}` : DEFAULT_STYLE;
}

// The paragraph style a note names, if it is not the stock note look.
function noteStyleName(node: TiptapNode): string | null {
  const own = node.attrs?.styleName;
  return typeof own === 'string' && own ? own : null;
}

// Styles to define in the file: the built-ins (Word defines its standard styles too)
// plus the user styles the document references, each with its parent chain.
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
    if (node.type === 'note') { const n = noteStyleName(node); if (n) addChain(n); }
    // An index's rows are generated, but the styles their levels name are the file's own.
    if (node.type === 'tableOfContents' && Array.isArray(node.attrs?.levelStyles)) {
      for (const name of node.attrs.levelStyles as unknown[]) if (typeof name === 'string') addChain(name);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return used;
}

// ---- document styles -------------------------------------------------------
// Word style ids are XML names; "Heading 1" → "Heading1" (which is also what
// HeadingLevel.HEADING_1 references), "Standard" → Word's own default style "Normal".
export function docxStyleId(name: string): string {
  return name === DEFAULT_STYLE ? 'Normal' : name.replace(/[^A-Za-z0-9]/g, '');
}

// One registry style → a Word paragraph style with its parent chain.
function paragraphStyleOf(style: Style): IParagraphStyleOptions {
  const p = style.para;
  const t = style.text;
  const run: Writable<IRunStylePropertiesOptions> = {};
  // The registry holds the on-screen family; the file declares its metric twin.
  const font = fontPair(t.fontFamily, t.fontFamilyAsian, twinFontName);
  if (font) run.font = font;
  if (t.fontSizePt != null) run.size = Math.round(t.fontSizePt * 2);
  if (t.letterSpacingPt) run.characterSpacing = Math.round(t.letterSpacingPt * 20);
  // Word kerns nothing unless a size to start at is named, so the on state is the one
  // this side has to write — half a point, i.e. every run.
  if (t.kerning !== false) run.kern = 1;
  if (t.bold != null) run.bold = t.bold;
  if (t.italic != null) run.italics = t.italic;
  if (t.underline) run.underline = {};
  if (t.strike) run.strike = t.strike;
  if (t.color) run.color = t.color.replace('#', '');
  if (t.caps === 'smallCaps') run.smallCaps = true;
  else if (t.caps === 'uppercase') run.allCaps = true;
  const spacing: Record<string, number> = {};
  if (p.spaceBefore != null) spacing.before = ptToTwip(p.spaceBefore);
  if (p.spaceAfter != null) spacing.after = ptToTwip(p.spaceAfter);
  // A proportional spacing is a factor of the single line (240 twips), a fixed one pt.
  const factor = Number(p.lineHeight);
  const fixedPt = /pt$/.test(p.lineHeight ?? '') ? parseFloat(p.lineHeight!) : NaN;
  if (Number.isFinite(factor) && factor > 0 && factor !== 1) spacing.line = Math.round(factor * 240);
  else if (fixedPt > 0) spacing.line = ptToTwip(fixedPt);
  const paragraph: Record<string, unknown> = {};
  const lineRule = fixedPt > 0 ? LineRuleType.EXACT : LineRuleType.AUTO;
  if (Object.keys(spacing).length) paragraph.spacing = { ...spacing, ...(spacing.line ? { lineRule } : {}) };
  if (p.textAlign) paragraph.alignment = alignOf({ textAlign: p.textAlign });
  const first = typeof p.indentFirst === 'number' ? p.indentFirst : null;
  if (p.indent != null || first != null) {
    paragraph.indent = {
      ...(p.indent != null ? { left: cmToTwip(p.indent) } : {}),
      ...(first != null ? (first < 0 ? { hanging: cmToTwip(-first) } : { firstLine: cmToTwip(first) }) : {}),
    };
  }
  if (style.outlineLevel) paragraph.keepNext = true;
  // The style's own colored field and rule lines.
  const shading = paraShadingOf(p);
  if (shading) paragraph.shading = shading;
  const border = paraBordersOf(p);
  if (border) paragraph.border = border;
  return {
    id: docxStyleId(style.name),
    name: wordStyleName(style.name),
    basedOn: style.parent ? docxStyleId(style.parent) : undefined,
    next: style.next ? docxStyleId(style.next) : undefined,
    quickFormat: true,
    run: Object.keys(run).length ? run : undefined,
    paragraph: Object.keys(paragraph).length ? paragraph : undefined,
  };
}

// A run of text the model describes → Word's run properties.
function runPropsOf(t: TextProps): Writable<IRunStylePropertiesOptions> {
  const run: Writable<IRunStylePropertiesOptions> = {};
  const font = fontPair(t.fontFamily, t.fontFamilyAsian, screenToDoc);
  if (font) run.font = font;
  if (t.fontSizePt != null) run.size = Math.round(t.fontSizePt * 2);
  if (t.letterSpacingPt) run.characterSpacing = Math.round(t.letterSpacingPt * 20);
  if (t.kerning !== false) run.kern = 1;
  if (t.bold != null) run.bold = t.bold;
  if (t.italic != null) run.italics = t.italic;
  if (t.underline) run.underline = {};
  if (t.strike) run.strike = t.strike;
  if (t.color) run.color = t.color.replace('#', '');
  return run;
}

// One registry character style → a Word character style (w:type="character").
function characterStyleOf(style: Style): ICharacterStyleOptions {
  return { id: docxStyleId(style.name), name: wordStyleName(style.name), quickFormat: true, run: runPropsOf(style.text) };
}

// LibreOffice maps a DOCX style by its name: "Normal" is its Standard, any other name a
// style of its own beside it ("Standard (WW)"). Word's other names buy nothing: "Strong"
// comes back as a paragraph style, "Quote" as a new one (probed).
const wordStyleName = (name: string): string => (name === DEFAULT_STYLE ? 'Normal' : name);

// Word needs a referenced table style to exist. ODF/our model hold the banding, and the
// look is baked into the cells, so a name-only definition is enough (no w:tblStylePr).
function tableStyleXml(name: string): string {
  return `<w:style w:type="table" w:styleId="${docxStyleId(name)}">`
    + `<w:name w:val="${escapeXml(name)}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/>`
    + '</w:style>';
}

// The table styles the document actually references, and the registry still defines.
function usedTableStyles(doc: TiptapNode, sheet: StyleSheet): string[] {
  const names = new Set<string>();
  const walk = (node: TiptapNode) => {
    const name = node.type === 'table' ? node.attrs?.tableStyle : null;
    if (typeof name === 'string' && sheet.table?.[name]) names.add(name);
    node.content?.forEach(walk);
  };
  walk(doc);
  return [...names];
}

// Word needs a referenced numbering style to exist; its w:numId placeholder (0) is
// rewritten by applyListStylesDocx once the packed numbering ids are known.
function numberingStyleXml(name: string): string {
  return `<w:style w:type="numbering" w:styleId="${docxStyleId(name)}">`
    + `<w:name w:val="${escapeXml(name)}"/><w:uiPriority w:val="99"/>`
    + '<w:pPr><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>'
    + '</w:style>';
}

// Styles the library writes for its own TOC, citations, captions and line numbers. Unused,
// they would restyle LibreOffice's Contents and Caption styles and read back as TOC levels.
const FACTORY_EXTRAS = /<w:style w:type="(?:paragraph|character)" w:styleId="(TOC[1-9]|Bibliography|Caption|LineNumber)">.*?<\/w:style>/g;

// Table and numbering styles are spliced post-pack: handing them to the library as
// importedStyles makes its Styles merge drop the factory set — w:docDefaults included.
function applyRawStylesDocx(bytes: Uint8Array, snippets: string[], own: Set<string>): Uint8Array {
  const files = unzipSync(bytes);
  const stylesXml = strFromU8(files['word/styles.xml']);
  const refs = Object.entries(files).filter(([path]) => /^word\/[^/]+\.xml$/.test(path))
    .map(([, data]) => strFromU8(data)).join('');
  // The default style says so (w:default): a reader falls back to its docDefaults
  // otherwise, and the style's own size and kerning never apply.
  files['word/styles.xml'] = strToU8(stylesXml
    .replace(FACTORY_EXTRAS, (style, id: string) =>
      own.has(id) || new RegExp(`w:val="${id}"`).test(refs) ? style : '')
    .replace('<w:style w:type="paragraph" w:styleId="Normal">', '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">')
    .replace('</w:styles>', snippets.join('') + '</w:styles>'));
  const out: Record<string, [Uint8Array, { level: 6 }]> = {};
  for (const [path, data] of Object.entries(files)) out[path] = [data, { level: 6 }];
  return zipSync(out);
}

// Styles the library always writes itself; ours must ride its override slots — a second
// definition under the same styleId makes Word and LibreOffice drop the basedOn chain.
const FACTORY_SLOTS: Record<string, string> = {
  Title: 'title', Heading1: 'heading1', Heading2: 'heading2', Heading3: 'heading3',
  Heading4: 'heading4', Heading5: 'heading5', Heading6: 'heading6',
};

function buildStyles(sheet: StyleSheet, used: Set<string>, language?: ExportLanguage | null) {
  const run: Writable<IRunStylePropertiesOptions> = { font: DOC_FONT, size: 24 };
  if (language) {
    const tag = `${language.language}-${language.country}`;
    run.language = langProp(language.other, tag);
    // A plain font name reaches all four w:rFonts slots, east-asian included, which would
    // make Times New Roman the default for every Han run that names no asian font.
    const cjk = cjkDocFont(tag);
    if (cjk) run.font = { ascii: DOC_FONT, hAnsi: DOC_FONT, cs: DOC_FONT, eastAsia: cjk };
  }
  const slotted: Record<string, Omit<IParagraphStyleOptions, 'id' | 'name'>> = {};
  const paragraphStyles = Object.values(sheet.paragraph)
    .filter(st => used.has(st.name)).map(paragraphStyleOf)
    .filter((st) => {
      const slot = FACTORY_SLOTS[st.id];
      if (!slot) return true;
      const { id: _id, name: _name, ...rest } = st;
      slotted[slot] = rest;
      return false;
    });
  // LibreOffice's note-text look (probed off its own DOCX export): 10pt plus the 0.6cm
  // hanging pair the marker's tab jumps into. The slot merge is shallow, so the factory's
  // spacing must ride along inside the replaced paragraph block.
  const noteText = {
    paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO }, indent: { start: 340, hanging: 340 } },
    run: { size: 20 },
  };
  return {
    default: {
      document: { run, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } } },
      footnoteText: noteText, endnoteText: noteText,
      ...slotted,
    },
    // The document's named styles, chain intact — Word shows them in its style list.
    paragraphStyles,
    characterStyles: Object.values(sheet.character ?? {}).map(characterStyleOf),
  };
}

// ---- entry point -----------------------------------------------------------
export async function buildDocx(
  docJson: TiptapNode,
  margins: PageMargins = DEFAULT_MARGINS,
  orientation: Orientation = 'portrait',
  hf?: HfExport,
  language?: ExportLanguage | null,
  pageFormat: PageFormat = 'A4',
  styles: StyleSheet = builtinStyleSheet(),
  tabIntervalCm: number = DEFAULT_TAB_INTERVAL_CM,
  spacingModel: SpacingModel = 'add',
  rtl = false,
  notesSettings: NoteSettings = DEFAULT_NOTE_SETTINGS,
  props: DocProperties = EMPTY_DOC_PROPERTIES,
  hyphenate = false,
  pageNumbering: PageNumbering = DEFAULT_PAGE_NUMBERING,
  decor: PageDecor = EMPTY_PAGE_DECOR,
  lineNumbering: LineNumbering = DEFAULT_LINE_NUMBERING,
  recordChanges = false,
  foldMarks = false,
  spacingAtPageStart = true,
  fonts: EmbeddedFont[] = [],
  lineGrid: LineGrid = DEFAULT_LINE_GRID,
  balanceSpaces = false,
  recordLock: RecordLock | null = null,
): Promise<Uint8Array> {
  docLangTag = localeTag(language ? language.language : 'en');
  // Before the walk: every picture the file can hold has to be a raster by then, and
  // rasterizing is async where the emitters that place them are not.
  docJson = await rasterizeSvgImages(docJson);
  exportSheet = styles;
  docJson = stampBookmarkEdges(alignDisplayFormulas(docJson));
  exportSpacingModel = spacingModel;
  docFormulas = [];
  nextBookmarkId = 0;
  docBookmarkIds = new Map();
  docxBookmarkNames = new Map();
  docRubies = [];
  docAtomRevisions = [];
  docPictureMarks = false;
  frameSeq = 0;
  docPlaceholders = [];
  docSources = [];
  const num = new Numbering();
  // Registered before the body walk, so its abstract keeps a stable place in the config.
  const outlineIndex = outlineIsEmpty(styles.outline) ? -1 : num.outlineRef(styles.outline!);
  const { w: pageWidthCm, h: pageHeightCm } = pageDimsCm(pageFormat, orientation);
  const contentWidthCm = pageWidthCm - margins.left - margins.right;

  // The note section holds the notes in anchor order (notes.ts), which is the order
  // Word numbers them in; each class counts from 1 because each has its own part.
  // Numbered before the body is walked, so an anchor already knows its id.
  const noteBlocks = (docJson.content ?? []).filter((n) => n.type === 'noteSection')
    .flatMap((n) => n.content ?? []);
  docNoteIds = new Map();
  docNoteBookmarks = new Map();
  docTextBoxes = [];
  docBoxTables = [];
  docComments = [];
  docCommentIds = new Map();
  docCommentReplies = new Map();
  docRevisionIds = new Map();
  docStacked = new Map();
  collectComments(docJson);
  const notesByClass: Record<NoteKind, Record<string, { children: Paragraph[] }>> = { footnote: {}, endnote: {} };
  for (const note of noteBlocks) {
    const kind: NoteKind = note.attrs?.kind === 'endnote' ? 'endnote' : 'footnote';
    const id = Object.keys(notesByClass[kind]).length + 1;
    const label = typeof note.attrs?.label === 'string' && note.attrs.label ? note.attrs.label : null;
    docNoteIds.set(String(note.attrs?.id ?? ''), { id, kind, label });
    notesByClass[kind][String(id)] = {
      // The tab after the marker jumps to the note style's hanging indent (the gap the
      // editor draws itself); the importer strips it back off.
      children: [new Paragraph({
        // The note keeps the paragraph style it names; without one it falls to the
        // stock note style, which is the 10pt look a styleName-less note renders.
        style: noteStyleName(note) ? docxStyleId(noteStyleName(note)!) : kind === 'endnote' ? 'EndnoteText' : 'FootnoteText',
        children: [new TextRun({ children: [new Tab()] }), ...inlineToRuns(note.content ?? [])],
      })],
    };
  }
  const body = (docJson.content ?? []).filter((n) => n.type !== 'noteSection');
  // A section with a paper or margins of its own sizes its tables and indexes to them.
  const sectionWidthCm = (i: number): number => {
    const sets = hf?.sections ?? [];
    const s: Partial<HfSet> = sets[Math.min(i, sets.length - 1)] ?? {};
    const m = s.margins ?? margins;
    return pageDimsCm(s.format ?? pageFormat, s.orientation ?? orientation).w - m.left - m.right;
  };
  const groups = bodyGroups(body, num, sectionWidthCm);

  // The index fields carry the editor's rows as their cached result; still ask the
  // reader to update fields on open, so a capable one repaginates + hyperlinks them.
  const hasToc = (docJson.content ?? []).some(n => n.type === 'tableOfContents');

  // One set per section; a document with no section breaks has exactly one. The flat
  // fields describe section 1, so they are the fallback when `sections` is absent.
  const hfSets: HfSet[] = hf?.sections?.length ? hf.sections : [{
    header: hf?.header ?? null, footer: hf?.footer ?? null,
    headerFirst: hf?.headerFirst ?? null, footerFirst: hf?.footerFirst ?? null,
    differentFirstPage: !!hf?.differentFirstPage,
    headerEven: hf?.headerEven ?? null, footerEven: hf?.footerEven ?? null,
    differentOddEven: !!hf?.differentOddEven,
  }];
  const setAt = (i: number) => hfSets[Math.min(i, hfSets.length - 1)];
  const zone = (d: HfDoc) => (hfIsEmpty(d) ? null : (d!.content as TiptapNode[]));
  // Different odd & even pages is a document setting (w:evenAndOddHeaders), not a
  // section one, so any section asking for it turns it on.
  const differentOddEven = hfSets.some((s) => s.differentOddEven);
  // Word's model: header/footer distance is from the page edge; the body still starts
  // at the body margin. Clamp the distance below the margin (matches odt.ts).
  const headerDist = Math.min(hf?.headerDistanceCm ?? HF_DISTANCE_CM, margins.top);
  const footerDist = Math.min(hf?.footerDistanceCm ?? HF_DISTANCE_CM, margins.bottom);

  // Page geometry rides every sectPr (Word requires it per section): size and margins
  // alike are the section's own where it has them. Fresh Header/Footer instances per
  // section, or a later one inherits ("Link to Previous").
  const pagePropsFor = (i: number) => {
    const s = setAt(i);
    const m = s.margins ?? margins;
    const sectionLandscape = (s.orientation ?? orientation) === 'landscape';
    // The package swaps the pair itself for a landscape section, so it wants the
    // **portrait** box — handed the swapped one it writes a portrait page merely
    // labelled landscape, which is what LibreOffice then renders.
    const dims = formatDimsCm(s.format ?? pageFormat);
    // A section's own edge→zone distances, where its page setup gives it others.
    const hDist = s.distances ? Math.min(s.distances.header, m.top) : Math.min(headerDist, m.top);
    const fDist = s.distances ? Math.min(s.distances.footer, m.bottom) : Math.min(footerDist, m.bottom);
    return {
      size: { width: cmToTwip(dims.w), height: cmToTwip(dims.h), orientation: sectionLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: {
        top: cmToTwip(m.top), bottom: cmToTwip(m.bottom),
        left: cmToTwip(m.left), right: cmToTwip(m.right),
        header: cmToTwip(hDist), footer: cmToTwip(fDist),
      },
      // w:pgNumType. Word restarts numbering at every section carrying a start, so a
      // later section gets one only where it really restarts. w:fmt has no document
      // default behind it, so every section names the document's unless it has its own.
      ...(i === 0
        ? (pageNumbering.format !== '1' || pageNumbering.start !== 1
          ? { pageNumbers: { formatType: DOCX_PAGE_NUM_FORMAT[pageNumbering.format], ...(pageNumbering.start !== 1 ? { start: pageNumbering.start } : {}) } }
          : {})
        : (s.pageNumberStart != null || (s.pageNumberFormat ?? pageNumbering.format) !== '1'
          ? { pageNumbers: {
              formatType: DOCX_PAGE_NUM_FORMAT[s.pageNumberFormat ?? pageNumbering.format],
              ...(s.pageNumberStart != null ? { start: s.pageNumberStart } : {}),
            } }
          : {})),
    };
  };
  // A zone's blocks at its section's text width; a header has no index to hold.
  const blocks = (content: TiptapNode[], i: number) =>
    blocksToDocx(content, num, sectionWidthCm(i)) as (Paragraph | Table)[];
  docZoneLists = [];
  // Fresh instances per section (Word's per-sectPr references, i.e. no "Link to
  // Previous"). A first-page variant rides `first:` and is activated by titlePage below.
  const mkHeaders = (i: number) => {
    const s = setAt(i);
    // Odd/even is the document's setting: a section not asking for it repeats its
    // running zone on even pages, so that is what its even part holds.
    const d = zone(s.header), f = s.differentFirstPage ? zone(s.headerFirst) : null,
      e = s.differentOddEven ? zone(s.headerEven) : differentOddEven ? d : null;
    // A watermark (and the fold marks) lives in a header part, so every page variant
    // needs one — empty where the zone has no text — for the post-passes to inject
    // into; a variant without its own part would blank the decor on those pages.
    const decorated = Boolean(decor.watermark?.text) || foldMarks;
    // A section past the first says what it has, blank included: a zone naming no part
    // of its own is Word's "Link to Previous" and repeats the section above it — which
    // put a chapter's running head on the pages a blank one was meant for.
    const spellOut = decorated || i > 0;
    const h: { default?: Header; first?: Header; even?: Header } = {};
    if (d) h.default = new Header({ children: blocks(d, i) });
    else if (spellOut) h.default = new Header({ children: [new Paragraph({})] });
    if (f) h.first = new Header({ children: blocks(f, i) });
    else if (s.differentFirstPage && spellOut) h.first = new Header({ children: [new Paragraph({})] });
    if (e) h.even = new Header({ children: blocks(e, i) });
    else if (differentOddEven && spellOut) h.even = new Header({ children: [new Paragraph({})] });
    return Object.keys(h).length ? h : undefined;
  };
  const mkFooters = (i: number) => {
    const s = setAt(i);
    const d = zone(s.footer), f = s.differentFirstPage ? zone(s.footerFirst) : null,
      e = s.differentOddEven ? zone(s.footerEven) : differentOddEven ? d : null;
    if (!d && !f && !e && i === 0) return undefined;
    const fo: { default?: Footer; first?: Footer; even?: Footer } = {};
    // Spelled out past the first section, for the reason the headers are.
    if (d) fo.default = new Footer({ children: blocks(d, i) });
    else if (i > 0) fo.default = new Footer({ children: [new Paragraph({})] });
    if (f) fo.first = new Footer({ children: blocks(f, i) });
    else if (s.differentFirstPage && i > 0) fo.first = new Footer({ children: [new Paragraph({})] });
    if (e) fo.even = new Footer({ children: blocks(e, i) });
    else if (differentOddEven && i > 0) fo.even = new Footer({ children: [new Paragraph({})] });
    return fo;
  };

  // The zones are walked before the document is built: their lists register numbering
  // the document reads when it is constructed. Only the group that begins a section's
  // set carries them; a later columns group links to them ("Link to Previous"): a
  // reference of its own makes LibreOffice switch page styles there, which breaks the
  // page as a continuous break never may.
  const groupZones = groups.map((g, i) => (groups.findIndex((x) => x.section === g.section) === i
    ? { headers: mkHeaders(g.section), footers: mkFooters(g.section) } : { headers: undefined, footers: undefined }));
  // Styles the zones name count as used, as the body's do.
  // A box's tables go after the body's last block, for applyTextBoxesDocx to move.
  const marker = (text: string) => new Paragraph({ children: [new TextRun({ text })] });
  docBoxTables.forEach(({ node, widthCm }, i) => groups[groups.length - 1]?.children.push(
    marker(`${TBT}S${i}${TBT}`), tableToDocx(node, widthCm, num), marker(`${TBT}E${i}${TBT}`)));
  const withZones: TiptapNode = { ...docJson, content: [...(docJson.content ?? []),
    ...hfSets.flatMap((set) => HF_ZONE_KEYS.flatMap((k) => (set[k]?.content ?? []) as TiptapNode[]))] };
  const docStyles = buildStyles(styles, usedStyleNames(withZones, styles), language);
  const doc = new Document({
    // Word's File ▸ Info; an empty field is left out so it does not overwrite Word's own.
    // Creator and last modifier are what the library fills in ("Un-named") otherwise,
    // and LibreOffice shows the modifier as the author.
    creator: props.author.trim(),
    lastModifiedBy: props.author.trim(),
    ...(props.title.trim() ? { title: props.title.trim() } : {}),
    ...(props.subject.trim() ? { subject: props.subject.trim() } : {}),
    ...(props.keywords.trim() ? { keywords: props.keywords.trim() } : {}),
    ...(props.description.trim() ? { description: props.description.trim() } : {}),
    defaultTabStop: cmToTwip(tabIntervalCm),
    // Word's Layout > Hyphenation (w:autoHyphenation in settings.xml).
    ...(hyphenate ? { hyphenation: { autoHyphenation: true } } : {}),
    ...(differentOddEven ? { evenAndOddHeaderAndFooters: true } : {}),
    // w:updateFields and w:trackRevisions are both settings.xml flags the package
    // takes under one key, so a document wanting both must ask for them together.
    ...(hasToc || recordChanges
      ? { features: { ...(hasToc ? { updateFields: true } : {}), ...(recordChanges ? { trackRevisions: true } : {}) } }
      : {}),
    styles: docStyles,
    numbering: { config: num.config },
    ...(Object.keys(notesByClass.footnote).length ? { footnotes: notesByClass.footnote } : {}),
    ...(Object.keys(notesByClass.endnote).length ? { endnotes: notesByClass.endnote } : {}),
    // word/comments.xml; the range and reference components in the runs point at these ids.
    ...(docComments.length
      ? { comments: { children: docComments.map((c) => ({
          id: c.id, author: c.author, date: c.date,
          initials: c.author.split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 3),
          children: c.text.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })),
        })) } }
      : {}),
    // A columns group is its own section; w:type=continuous describes the break
    // BEFORE a section, so it goes on every section but the first — except one that
    // restarts the page numbering, which both word processors only honour on a section
    // that begins a page (probed: LibreOffice drops w:start off a continuous one).
    sections: groups.map((g, i) => ({
      properties: {
        page: pagePropsFor(g.section),
        // Word's Document Grid, lines only; ODF keeps it on the page layout.
        ...(lineGrid.on ? { grid: { type: DocumentGridType.LINES, linePitch: Math.round(lineGrid.pitchPt * 20) } } : {}),
        // Word's Layout ▸ Line Numbers; ODF keeps the same five values document-wide.
        ...(lineNumbering.on
          ? { lineNumbers: {
              countBy: lineNumbering.interval,
              restart: lineNumbering.restart === 'page' ? LineNumberRestartFormat.NEW_PAGE : LineNumberRestartFormat.CONTINUOUS,
              distance: cmToTwip(lineNumbering.distanceCm),
            } }
          : {}),
        // Word blanks a titlePg section's first page when no w:type="first" header is
        // referenced, and every section restarts that logic — even a continuous one
        // that a page break pushes onto a fresh page. So only the group that begins
        // its header set carries titlePg; later groups of the set must not repeat it.
        ...(setAt(g.section).differentFirstPage && g.section < hfSets.length
          && groups.findIndex((x) => x.section === g.section) === i ? { titlePage: true } : {}),
        // A section that must open on a right or left page says so here. One with zones
        // or a page setup of its own begins a page, as its master page does in ODF; one
        // with neither flows on, as the editor lays it out — like a columns group does.
        ...(i > 0 && groups.findIndex((x) => x.section === g.section) === i
          ? (setAt(g.section).startsOn
            ? { type: setAt(g.section).startsOn === 'odd' ? SectionType.ODD_PAGE : SectionType.EVEN_PAGE }
            : g.section < hfSets.length ? {} : { type: SectionType.CONTINUOUS })
          : i > 0 ? { type: SectionType.CONTINUOUS } : {}),
        ...(g.columns
          ? { column: { count: g.columns.count, space: cmToTwip(g.columns.gapCm), equalWidth: true } }
          : {}),
      },
      ...groupZones[i],
      children: g.children.length ? g.children : [new Paragraph({})],
    })),
  });

  for (const { reference, instance } of docZoneLists) doc.Numbering.createConcreteNumberingInstance(reference, instance);
  docZoneLists = null;
  const blob = await Packer.toBlob(doc);
  const styled = applyRawStylesDocx(new Uint8Array(await blob.arrayBuffer()), [
    ...usedTableStyles(withZones, styles).map(tableStyleXml),
    ...num.styleLinks().map((l) => numberingStyleXml(l.name)),
  ], new Set([...docStyles.paragraphStyles, ...docStyles.characterStyles].map((s) => s.id)));
  const linked = applyOutlineNumberingDocx(applyListStylesDocx(styled, num.styleLinks()), outlineIndex);
  const formulas = applyFormulasDocx(applyTextBoxesDocx(linked, docTextBoxes), docFormulas);
  const packed = docPictureMarks ? applyPictureMarksDocx(formulas) : formulas;
  const cited = applyBibliographyDocx(applyPlaceholdersDocx(applyRubyDocx(packed, docRubies), docPlaceholders), docSources, docCitationStyle(docJson));
  // The note configuration goes out whether or not a note exists yet, as Word keeps its
  // own in settings.xml — a document numbering its first footnote from 3 must still say so.
  const withNotePr = applyNotePrDocx(cited, notesSettings);
  const withNotes = docNoteIds.size ? applyEndnoteImagesDocx(applyNoteMarksDocx(applyNoteBookmarksDocx(withNotePr))) : withNotePr;
  const threaded = applyMovesDocx(applyStackedRevisionsDocx(applyAtomRevisionsDocx(applyCommentsExtendedDocx(withNotes))), withZones);
  // Word mirrors the whole document or nothing: any mirrored section mirrors it.
  const mirrorAny = margins.mirrored || !!hf?.sections?.some((s) => s.margins?.mirrored);
  const mirrored = mirrorAny ? applyMirrorMarginsDocx(threaded) : threaded;
  const bidi = applyParagraphFlagsDocx(rtl ? applyBidiDocx(mirrored) : mirrored);
  const dims = pageDimsCm(pageFormat, orientation);
  const foldMarked = applyFoldMarksDocx(bidi, foldMarks, dims.w * 10);
  // No space above the block opening a page is Word's w:suppressSpBfAfterPgBrk.
  const spaced = applyCompatDocx(foldMarked, [
    ...(balanceSpaces ? ['balanceSingleByteDoubleByteWidth'] : []),
    ...(spacingAtPageStart ? [] : ['suppressSpBfAfterPgBrk']),
  ]);
  const marked = applyRecordLockDocx(applySectionMarksDocx(applyEmbeddedFontsDocx(spaced, fonts)), recordLock);
  if (isEmptyPageDecor(decor)) return patchPackedXml(orderDocxSettings(marked));
  const pt = (cm: number) => (cm / 2.54) * 72;
  return patchPackedXml(orderDocxSettings(applyPageDecorDocx(marked, decor,
    pt(dims.w - margins.left - margins.right), pt(dims.h - margins.top - margins.bottom))));
}
