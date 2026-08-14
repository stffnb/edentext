import {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, InternalHyperlink, Bookmark, Tab,
  FootnoteReferenceRun, EndnoteReferenceRun,
  TableOfContents,
  Table, TableRow, TableCell, Header, Footer, PageNumber, SimpleField,
  CommentRangeStart, CommentRangeEnd, CommentReference, InsertedTextRun, DeletedTextRun,
  AlignmentType, LevelFormat, UnderlineType, BorderStyle, ShadingType,
  WidthType, HeightRule, PageOrientation, LineRuleType, LineNumberRestartFormat, TableLayoutType, SectionType, NumberFormat,
  HorizontalPositionAlign, VerticalPositionRelativeFrom, HorizontalPositionRelativeFrom,
  TextWrappingType, TextWrappingSide, ImportedXmlComponent, TabStopType, LeaderType,
} from 'docx';
import type { TiptapNode } from 'odf-kit';
import type {
  IRunStylePropertiesOptions, ISpacingProperties, IIndentAttributesProperties,
  ILevelsOptions, IFloating, IBorderOptions, IParagraphStyleOptions, ICharacterStyleOptions,
} from 'docx';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { TEXTBOX_PADDING_CM } from '../editor/extensions/textBox';
import { SHAPES, isShapeKind, type ShapeKind } from '../utils/shapes';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { pageDimsCm, PAGE_FORMAT_CM, type PageFormat } from '../storage/pageFormat';
import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
import type { SpacingModel } from '../storage/spacingModel';
import { HF_DISTANCE_CM, hfIsEmpty, type HfDoc, type HfSet } from '../storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteNumFormat, type NoteSettings } from '../storage/noteSettings';
import { DOCX_SEQ_NAME, seqCategoryOf } from '../editor/extensions/caption';
import { indexKindOf, INDEX_TITLES } from '../editor/extensions/tableOfContents';
import { citationText, DOCX_BIB_FIELD, DOCX_SOURCE_TYPE, type BibSource } from '../editor/extensions/bibliographyEntry';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { parseBorderAttr, type BorderSide } from '../editor/extensions/tableCellBorders';
import { parseCellPadding, DEFAULT_CELL_PADDING } from '../editor/extensions/tableCellPadding';
import { parseTabStops, type TabAlign } from '../editor/extensions/tabStops';
import { charStyleProps, listMarkerFormat } from '../editor/extensions/listMarker';
import { effectiveOrderedDefAt, formatOrdinal, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { defaultBulletChar } from '../utils/bulletListTypes';
import { normalizeColor, GENERATOR, MAX_HEADING_LEVEL, mergeJoinedParagraphsJson, twinFontName, type HfExport } from './odt';
import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../storage/docProperties';
import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
import { EMPTY_PAGE_DECOR, isEmptyPageDecor, type PageDecor, type Watermark } from '../storage/pageDecor';
import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../storage/lineNumbering';

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

// Effective bullet glyph of a list node: its bulletChar attr, else the default cycle.
function bulletCharOf(node: TiptapNode, depth0: number): string {
  const ch = node.attrs?.bulletChar;
  return typeof ch === 'string' && ch ? ch : defaultBulletChar(depth0);
}

// List geometry: 0.5in left step per level, 0.25in hanging for the marker (Word defaults).
const LIST_LEFT_STEP_CM = 1.27;
const LIST_HANGING_CM = 0.635;

// ODF num-format char → Word numbering format.
const ORDERED_FORMAT: Record<string, (typeof LevelFormat)[keyof typeof LevelFormat]> = {
  '1': LevelFormat.DECIMAL,
  a: LevelFormat.LOWER_LETTER,
  A: LevelFormat.UPPER_LETTER,
  i: LevelFormat.LOWER_ROMAN,
  I: LevelFormat.UPPER_ROMAN,
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

// Formulas collected while serializing, in document order (module-level like
// docLangTag: inlineToRuns is reached from every block path without a collector).
type FormulaDocx = { latex: string; display: boolean };
let docFormulas: FormulaDocx[] = [];

// The sources cited, one per tag in document order — Word keeps them in a custom-XML
// part and the CITATION fields only name the tag. Module-level like docFormulas.
let docSources: BibSource[] = [];

// Word numbers footnotes and endnotes in separate files, so each class counts from 1.
// Filled from the note section before the body is walked, then read by the anchor —
// module-level for the same reason as docFormulas.
let docNoteIds = new Map<string, { id: number; kind: NoteKind }>();

// Comments, numbered in document order before the runs are built — Word's ids are
// integers and word/comments.xml has to exist before the Document is constructed.
type CommentDocx = { id: number; author: string; date: Date; text: string };
let docComments: CommentDocx[] = [];
let docCommentIds = new Map<string, number>();

function collectComments(node: TiptapNode): void {
  for (const child of node.content ?? []) {
    const mark = child.type === 'text' ? child.marks?.find(m => m.type === 'comment') : undefined;
    const id = mark ? String(mark.attrs?.id ?? '') : '';
    if (id && !docCommentIds.has(id)) {
      docCommentIds.set(id, docComments.length);
      const raw = String(mark!.attrs?.date ?? '');
      const date = new Date(raw);
      docComments.push({
        id: docComments.length,
        author: String(mark!.attrs?.author ?? ''),
        date: Number.isNaN(date.getTime()) ? new Date() : date,
        text: String(mark!.attrs?.text ?? ''),
      });
    }
    if (!id) collectComments(child);
  }
}

// Sentinel wrapping a text box's index in a marker paragraph (same trick as
// export/odt.ts): the docx library can't emit DrawingML shapes, so buildDocx swaps
// the marker for a hand-built <w:drawing><wps:wsp> in a zip post-processing pass.
const TBX = '';
// Wraps the index of a numbering definition minted for a box's list; the ids only
// become known once the packed numbering.xml is in hand.
const TXBX_NUM = '';

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

  newReference(): string {
    const reference = `num-${this.counter++}`;
    const levels: ILevelsOptions[] = [];
    this.map.set(reference, levels);
    this.config.push({ reference, levels });
    return reference;
  }

  ensureLevel(reference: string, depth: number, node: TiptapNode, extraIndentCm: number, cycle: OrderedCycle): void {
    // A multilevel top list turns the whole reference into a "%1.%2." chain; its
    // attr-less nested lists inherit it (the top registers first — pre-order walk).
    if (depth === 0 && node.attrs?.listStyleType === 'multilevel') this.mlRefs.add(reference);
    const levels = this.map.get(reference)!;
    if (levels.some((l) => l.level === depth)) return;
    const indent: IIndentAttributesProperties = {
      left: cmToTwip((depth + 1) * LIST_LEFT_STEP_CM + extraIndentCm),
      hanging: cmToTwip(LIST_HANGING_CM),
    };
    // w:lvlJc: which end of the hanging indent the label is set against.
    const alignment = node.attrs?.markerAlign === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;
    if (node.type === 'orderedList') {
      const attr = node.attrs?.listStyleType as string | null | undefined;
      const chained = this.mlRefs.has(reference) && (depth === 0 || !attr);
      const def = effectiveOrderedDefAt(attr === 'multilevel' ? 'decimal' : attr, cycle);
      levels.push({
        level: depth,
        format: chained ? LevelFormat.DECIMAL : ORDERED_FORMAT[def.numFormat] ?? LevelFormat.DECIMAL,
        text: chained
          ? Array.from({ length: depth + 1 }, (_, i) => `%${i + 1}.`).join('')
          : `%${depth + 1}${def.numSuffix}`,
        alignment,
        start: typeof node.attrs?.start === 'number' ? node.attrs.start : 1,
        style: { paragraph: { indent }, run: markerRunProps(node) },
      });
    } else {
      levels.push({
        level: depth,
        format: LevelFormat.BULLET,
        // The Unicode char goes into w:lvlText literally; Word renders it in the
        // paragraph font (no Wingdings/Symbol rFonts needed).
        text: bulletCharOf(node, depth),
        alignment,
        style: { paragraph: { indent }, run: markerRunProps(node) },
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

  const caps = ts?.attrs?.caps;
  if (caps === 'smallCaps') props.smallCaps = true;
  else if (caps === 'uppercase') props.allCaps = true;
  const pos = ts?.attrs?.textPosition;
  if (typeof pos === 'number' && pos) props.position = `${pos}pt`;

  const ff = ts?.attrs?.fontFamily ?? force.fontFamily;
  if (ff) props.font = String(ff) === SCREEN_FONT ? DOC_FONT : String(ff);
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
  // the link came in without one — Word draws those like the text around them.
  if (marks?.some((m) => m.type === 'link' && !m.attrs?.plain)) {
    if (!props.color) props.color = '0563C1';
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
  // A recorded revision wraps the run: w:ins keeps its text, w:del turns it into
  // w:delText — the package's own two run kinds.
  const rev = revisionOf(node);
  if (rev) {
    const attrs = { id: docRevisionId(rev.attrs.id), author: rev.attrs.author, date: rev.attrs.date };
    return [rev.kind === 'insertion'
      ? new InsertedTextRun({ ...opts, ...attrs })
      : new DeletedTextRun({ ...opts, ...attrs })];
  }
  return [new TextRun(opts)];
}

function tabbedChildren(text: string): (string | Tab)[] {
  const children: (string | Tab)[] = [];
  text.split('\t').forEach((p, i) => {
    if (i > 0) children.push(new Tab());
    if (p) children.push(p);
  });
  return children;
}

// The insertion/deletion mark on a run, if any (trackChanges.ts).
function revisionOf(node: TiptapNode): { kind: 'insertion' | 'deletion'; attrs: { id: string; author: string; date: string } } | null {
  const m = node.marks?.find((x) => x.type === 'insertion' || x.type === 'deletion');
  if (!m) return null;
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
function docRevisionId(id: string): number {
  const seen = docRevisionIds.get(id);
  if (seen != null) return seen;
  const next = docRevisionIds.size;
  docRevisionIds.set(id, next);
  return next;
}

type Inline = TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | SimpleField | Bookmark
  | CommentRangeStart | CommentRangeEnd | InsertedTextRun | DeletedTextRun;

// A date/time field. A fixed field is plain text (Word has no fixed-date field); an
// auto field is a DATE/TIME field with the picture switch and a cached value.
function dateTimeRun(node: TiptapNode): Inline {
  const a = node.attrs ?? {};
  const kind = a.kind === 'time' ? 'time' : 'date';
  const fmt = findFormat(String(a.format ?? ''))
    ?? findFormat(kind === 'time' ? DEFAULT_TIME_FORMAT : DEFAULT_DATE_FORMAT)!;
  const parsed = a.fixed && typeof a.value === 'string' && a.value ? new Date(a.value) : new Date();
  const when = isNaN(parsed.getTime()) ? new Date() : parsed;
  const text = renderFormat(fmt, when, docLangTag);
  // A fixed field is a plain run, so carry its font/size/etc.; SimpleField takes no
  // run props, so an auto field inherits the paragraph font (Word recomputes it).
  if (a.fixed) return new TextRun({ text, ...runPropsFromMarks(node.marks) });
  return new SimpleField(`${kind === 'time' ? 'TIME' : 'DATE'} \\@ "${docxPicture(fmt)}"`, text);
}

// Word's numeric-picture switch per ODF num-format — the SEQ field's own formatting.
const DOCX_SEQ_SWITCH: Record<NoteNumFormat, string> = {
  '1': 'ARABIC', a: 'alphabetic', A: 'ALPHABETIC', i: 'roman', I: 'ROMAN',
};

// A caption's running number: a SEQ field whose cached result is the rank the editor
// resolved, so Word and LibreOffice show it before anyone updates fields.
function sequenceField(node: TiptapNode): SimpleField {
  const a = node.attrs ?? {};
  const format = (typeof a.format === 'string' && a.format ? a.format : '1') as NoteNumFormat;
  const number = typeof a.number === 'number' && a.number > 0 ? a.number : 1;
  const name = DOCX_SEQ_NAME[seqCategoryOf(a.category as string)];
  return new SimpleField(`SEQ ${name} \\* ${DOCX_SEQ_SWITCH[format] ?? 'ARABIC'}`, formatOrdinal(number, format));
}

// A cross-reference: a REF/PAGEREF field with the resolved text as its cached result,
// so Word and LibreOffice show it before anyone updates fields.
function crossRefField(node: TiptapNode): SimpleField {
  const a = node.attrs ?? {};
  const verb = a.format === 'page' ? 'PAGEREF' : 'REF';
  return new SimpleField(`${verb} ${String(a.name ?? '')} \\h`, String(a.text ?? ''));
}

// The Word comment id of a run's comment mark, or null.
const commentIdOf = (node: TiptapNode): number | null => {
  const id = node.marks?.find((m) => m.type === 'comment')?.attrs?.id;
  const n = typeof id === 'string' ? docCommentIds.get(id) : undefined;
  return n ?? null;
};

const bookmarkNameOf = (node: TiptapNode): string | null => {
  const name = node.marks?.find((m) => m.type === 'bookmark')?.attrs?.name;
  return typeof name === 'string' && name ? name : null;
};

function inlineToRuns(content: TiptapNode[] = [], force: TextProps = {}): Inline[] {
  const out: Inline[] = [];
  // Consecutive nodes sharing a bookmark become one w:bookmarkStart/End pair.
  // ponytail: a range spanning paragraphs is emitted per paragraph — Word tolerates the
  // repeated name, and splitting it would need a second pass over the whole document.
  let open: { name: string; children: Inline[] } | null = null;
  const flush = () => {
    if (!open) return;
    out.push(new Bookmark({ id: open.name, children: open.children }));
    open = null;
  };
  const emit = (runs: Inline[], name: string | null) => {
    if (name !== (open?.name ?? null)) flush();
    if (!name) { out.push(...runs); return; }
    if (!open) open = { name, children: [] };
    open.children.push(...runs);
  };

  // A comment's range brackets its runs; the reference run at the end is what Word
  // draws the bubble from. Both live outside any bookmark, so they flush it first.
  let openComment: number | null = null;
  const closeComment = () => {
    if (openComment === null) return;
    flush();
    out.push(new CommentRangeEnd(openComment), new TextRun({ children: [new CommentReference(openComment)] }));
    openComment = null;
  };
  const openCommentAt = (id: number | null) => {
    if (id === openComment) return;
    closeComment();
    if (id !== null) { flush(); out.push(new CommentRangeStart(id)); openComment = id; }
  };

  for (const node of content) {
    openCommentAt(commentIdOf(node));
    const bookmark = bookmarkNameOf(node);
    if (node.type === 'text' && node.text) {
      const runs = textNodeToRuns(node, force);
      const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
      const link = href ? String(href) : '';
      // An internal href targets a bookmark in this document, not a URL.
      if (link.startsWith('#')) emit([new InternalHyperlink({ anchor: link.slice(1), children: runs })], bookmark);
      else if (link) emit([new ExternalHyperlink({ link, children: runs })], bookmark);
      else emit(runs, bookmark);
      continue;
    }
    if (node.type === 'crossRef') { emit([crossRefField(node)], bookmark); continue; }
    if (node.type === 'noteRef') {
      const note = docNoteIds.get(String(node.attrs?.id ?? ''));
      if (note) {
        emit([note.kind === 'endnote' ? new EndnoteReferenceRun(note.id) : new FootnoteReferenceRun(note.id)], bookmark);
      }
      continue;
    }
    flush();
    if (node.type === 'hardBreak') {
      // Carry the run's props so an empty line between two breaks keeps its font size.
      out.push(new TextRun({ break: 1, ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'image') {
      const img = imageRun(node);
      if (img) out.push(img);
    } else if (node.type === 'pageNumber') {
      out.push(new TextRun({ children: [PageNumber.CURRENT], ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'pageCount') {
      out.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], ...runPropsFromMarks(node.marks) }));
    } else if (node.type === 'chapterField') {
      // Word's running head: STYLEREF picks the heading of that level in force on the page.
      out.push(new SimpleField(`STYLEREF "Heading ${Number(node.attrs?.level) || 1}" \\* MERGEFORMAT`, String(node.attrs?.text ?? '')));
    } else if (node.type === 'dateTimeField') {
      out.push(dateTimeRun(node));
    } else if (node.type === 'sequenceField') {
      out.push(sequenceField(node));
    } else if (node.type === 'indexEntry') {
      // Word's index entry: a hidden XE field, its term in the instruction. A key files
      // the term under it, "key:term", exactly as LibreOffice's text:key1 does.
      const term = String(node.attrs?.term ?? '').trim();
      const key1 = String(node.attrs?.key1 ?? '').trim();
      if (term) out.push(new SimpleField(`XE "${(key1 ? `${key1}:${term}` : term).replace(/"/g, "'")}"`, ''));
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
      out.push(new SimpleField(`=${node.attrs?.formula ?? ''}`, String(node.attrs?.text ?? '')));
    } else if (node.type === 'formula') {
      const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
      if (latex) {
        docFormulas.push({ latex, display: node.attrs?.display === true });
        out.push(new TextRun({ text: `${MTH}${docFormulas.length - 1}${MTH}` }));
      }
    }
  }
  closeComment();
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

// offsetCm places the frame in the text column (Word's posOffset); without one it is
// flush to its side. offsetYCm is how far below the anchor paragraph it sits.
function floatingFor(wrap: string, offsetCm: number | null, offsetYCm: number | null, alignH?: string | null, distCm?: number | null): IFloating | undefined {
  if (wrap === 'inline') return undefined;
  // The gap beside the frame, on both sides as Word writes it; none above or below.
  const margins = distCm ? { left: Math.round(distCm * 360000), right: Math.round(distCm * 360000) } : undefined;
  const verticalPosition = {
    relative: VerticalPositionRelativeFrom.PARAGRAPH,
    offset: offsetYCm != null ? Math.round(offsetYCm * 360000) : 0,
  };
  if (wrap === 'topBottom') {
    // A frame sharing its band with another is set against one end of it, and the two
    // may overlap vertically — that is what puts them side by side.
    const end = alignH === 'right' ? HorizontalPositionAlign.RIGHT
      : alignH === 'left' ? HorizontalPositionAlign.LEFT : null;
    return {
      horizontalPosition: end
        ? { relative: HorizontalPositionRelativeFrom.MARGIN, align: end }
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
  const distCm = typeof node.attrs?.wrapDist === 'number' ? node.attrs.wrapDist : null;
  return new ImageRun({
    type: decoded.type,
    data: decoded.bytes,
    altText: typeof node.attrs?.alt === 'string' && node.attrs.alt ? { name: node.attrs.alt, title: node.attrs.alt, description: node.attrs.alt } : undefined,
    transformation: { width, height, rotation: rotation || undefined },
    floating: floatingFor(wrap, offsetCm, offsetYCm, node.attrs?.wrapAlign as string | null, distCm),
  });
}

// ---- text boxes / shapes ---------------------------------------------------
// A textBox node collected by blocksToDocx; applyTextBoxesDocx rewrites its marker
// paragraph into DrawingML (wp:inline/wp:anchor > wps:wsp > wps:txbx) after packing.
type TextBoxDocx = {
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
  wrap: 'inline' | 'left' | 'right' | 'topBottom';
  offsetCm: number | null;
  offsetYCm: number | null;
  distCm: number | null;
  shapeKind: ShapeKind;
  flipV: boolean;
  fill: string | null;
  stroke: string | null;
  strokeWidthPt: number;
  content: TiptapNode[];
};

function textBoxDocxDescriptor(node: TiptapNode): TextBoxDocx {
  const a = node.attrs ?? {};
  const wrapAttr = a.wrap;
  return {
    widthPx: typeof a.width === 'number' && a.width > 0 ? Math.round(a.width) : 280,
    heightPx: typeof a.height === 'number' && a.height > 0 ? Math.round(a.height) : 96,
    rotationDeg: typeof a.rotation === 'number' ? a.rotation : 0,
    wrap: wrapAttr === 'left' || wrapAttr === 'right' || wrapAttr === 'topBottom' ? wrapAttr : 'inline',
    offsetCm: typeof a.wrapOffset === 'number' ? a.wrapOffset : null,
    offsetYCm: typeof a.wrapOffsetY === 'number' ? a.wrapOffsetY : null,
    distCm: typeof a.wrapDist === 'number' ? a.wrapDist : null,
    shapeKind: isShapeKind(a.shapeKind) ? a.shapeKind : 'textbox',
    flipV: a.flipV === true,
    fill: typeof a.fillColor === 'string' && a.fillColor ? a.fillColor : null,
    stroke: typeof a.strokeColor === 'string' && a.strokeColor ? a.strokeColor : null,
    strokeWidthPt: typeof a.strokeWidthPt === 'number' && a.strokeWidthPt > 0 ? a.strokeWidthPt : 1,
    content: node.content ?? [],
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Run properties for the hand-serialized txbxContent, in CT_RPr schema order
// (rFonts, b, i, strike, color, sz, u, shd, vertAlign). Mirrors runPropsFromMarks.
function txbxRunPropsXml(marks: TiptapNode['marks'] = []): string {
  const ts = marks.find((m) => m.type === 'textStyle');
  const parts: string[] = [];
  const ff = ts?.attrs?.fontFamily;
  if (ff) {
    const f = escapeXml(String(ff) === SCREEN_FONT ? DOC_FONT : String(ff));
    parts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
  }
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
  const col = ts?.attrs?.color;
  if (col) {
    const h = hexColor(String(col));
    if (h) parts.push(`<w:color w:val="${h}"/>`);
  }
  const fs = ts?.attrs?.fontSize;
  if (fs) {
    const hp = fontSizeToHalfPoints(String(fs));
    if (hp) parts.push(`<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/>`);
  }
  const u = marks.find((m) => m.type === 'underline');
  if (u) {
    const line = wordUnderline(u.attrs);
    parts.push(`<w:u w:val="${line.type}"${line.color ? ` w:color="${line.color}"` : ''}/>`);
  }
  const hl = marks.find((m) => m.type === 'highlight');
  if (hl?.attrs?.color) {
    const h = hexColor(String(hl.attrs.color));
    if (h) parts.push(`<w:shd w:val="clear" w:fill="${h}"/>`);
  }
  if (markPresent(marks, 'superscript')) parts.push('<w:vertAlign w:val="superscript"/>');
  else if (markPresent(marks, 'subscript')) parts.push('<w:vertAlign w:val="subscript"/>');
  return parts.length ? `<w:rPr>${parts.join('')}</w:rPr>` : '';
}

// The package parts a box's content needs beyond word/document.xml: a picture is a
// media entry plus a relationship, a list a numbering definition. applyTextBoxesDocx
// runs after packing, so it holds the whole zip and can mint all three.
type TxbxParts = {
  media: { path: string; bytes: Uint8Array; rid: string; type: string }[];
  nums: { id: number; levels: string[] }[];
  nextRid: () => string;
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
    `<pic:blipFill><a:blip r:embed="${rid}" xmlns:r="${R_NS}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

// One paragraph/heading of a text box. `numPr` makes it a list item of one of the
// numbering definitions minted for the box.
function txbxParagraphXml(node: TiptapNode, parts: TxbxParts, indentTwip = 0, numPr = ''): string {
  const attrs = node.attrs ?? {};
  const pPr: string[] = [numPr];
  if (node.type === 'heading') {
    const lvl = Math.min(MAX_HEADING_LEVEL, Math.max(1, Number(attrs.level) || 1));
    pPr.push(`<w:pStyle w:val="Heading${lvl}"/>`);
  }
  if (indentTwip) pPr.push(`<w:ind w:left="${indentTwip}"/>`);
  const ta = attrs.textAlign;
  const jc = ta === 'center' ? 'center' : ta === 'right' ? 'right' : ta === 'justify' ? 'both' : '';
  if (jc) pPr.push(`<w:jc w:val="${jc}"/>`);
  let runs = '';
  for (const child of node.content ?? []) {
    if (child.type === 'image') {
      const drawing = txbxImageXml(child, parts);
      if (drawing) runs += `<w:r>${drawing}</w:r>`;
    } else if (child.type === 'text' && child.text) {
      const rPr = txbxRunPropsXml(child.marks);
      let inner = '';
      child.text.split('\t').forEach((seg, i) => {
        if (i > 0) inner += '<w:tab/>';
        if (seg) inner += `<w:t xml:space="preserve">${escapeXml(seg)}</w:t>`;
      });
      runs += `<w:r>${rPr}${inner}</w:r>`;
    } else if (child.type === 'hardBreak') {
      runs += `<w:r>${txbxRunPropsXml(child.marks)}<w:br/></w:r>`;
    }
  }
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
  return (
    `<w:lvl w:ilvl="${depth}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/>` +
    `<w:lvlText w:val="${escapeXml(text)}"/><w:lvlJc w:val="${jc}"/>` +
    `<w:pPr><w:ind w:left="${cmToTwip((depth + 1) * LIST_LEFT_STEP_CM)}"` +
    ` w:hanging="${cmToTwip(LIST_HANGING_CM)}"/></w:pPr></w:lvl>`
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
  }
  return out || '<w:p/>';
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
  // A line is only its stroke, and its heads ride the same <a:ln>.
  const line = SHAPES[box.shapeKind].line;
  const ends = line === 'end' ? '<a:tailEnd type="triangle"/>'
    : line === 'both' ? '<a:headEnd type="triangle"/><a:tailEnd type="triangle"/>' : '';
  const ln = box.stroke
    ? `<a:ln w="${Math.round(box.strokeWidthPt * EMU_PER_PT)}"><a:solidFill><a:srgbClr val="${hexColor(box.stroke) ?? '000000'}"/></a:solidFill>${ends}</a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const inset = Math.round(TEXTBOX_PADDING_CM * EMU_PER_CM);
  // Auto-grow only for plain text boxes, matching the ODT export.
  const autofit = box.shapeKind === 'textbox' ? '<a:spAutoFit/>' : '';
  // Word draws the `line` preset down the frame's diagonal and flips it to reach the
  // other one; a line carries no fill and no text body.
  const flip = line && box.flipV ? ' flipV="1"' : '';
  const body = line
    ? ''
    : `<wps:txbx><w:txbxContent>${txbxContentXml(box.content, parts)}</w:txbxContent></wps:txbx>`;
  const wsp =
    `<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm${rot}${flip}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="${SHAPES[box.shapeKind].prst}"><a:avLst/></a:prstGeom>${line ? '<a:noFill/>' : fill}${ln}</wps:spPr>` +
    body +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" anchor="t">${autofit}</wps:bodyPr>` +
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
  const wrapEl = box.wrap === 'topBottom'
    ? '<wp:wrapTopAndBottom/>'
    : `<wp:wrapSquare wrapText="${box.wrap === 'right' ? 'left' : 'right'}"/>`;
  const align = box.wrap === 'right' ? 'right' : 'left';
  const emu = (cm: number) => Math.round(cm * 360000);
  const posH = box.offsetCm != null && box.wrap !== 'topBottom'
    ? `<wp:posOffset>${emu(box.offsetCm)}</wp:posOffset>`
    : `<wp:align>${align}</wp:align>`;
  return (
    `<w:drawing><wp:anchor ${WP_NS} distT="0" distB="0" distL="${emu(box.distCm ?? 0)}" distR="${emu(box.distCm ?? 0)}"` +
    ` simplePos="0" relativeHeight="${251658240 + index}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="margin">${posH}</wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(box.offsetYCm ?? 0)}</wp:posOffset></wp:positionV>` +
    `${extent}${wrapEl}${docPr}${graphic}</wp:anchor></w:drawing>`
  );
}

// The highest number already used by `attr` in `xml`, so a part we add gets a free one.
function maxIdIn(xml: string, attr: RegExp): number {
  let max = 0;
  for (const m of xml.matchAll(attr)) max = Math.max(max, parseInt(m[1], 10) || 0);
  return max;
}

// Post-pack pass: swap each marker paragraph in word/document.xml for its drawing.
// The tempered pattern keeps the match inside one paragraph. A box's pictures and
// lists need parts of their own — the pass holds the whole zip, so it appends the
// media entries, their relationships and the numbering definitions here.
function applyTextBoxesDocx(bytes: Uint8Array, boxes: TextBoxDocx[]): Uint8Array {
  if (!boxes.length) return bytes;
  const files = unzipSync(bytes);
  const docBytes = files['word/document.xml'];
  if (!docBytes) return bytes;
  let xml = strFromU8(docBytes);

  const relsPath = 'word/_rels/document.xml.rels';
  const rels = files[relsPath] ? strFromU8(files[relsPath]) : '';
  let nextRid = maxIdIn(rels, /Id="rId(\d+)"/g);
  const parts: TxbxParts = { media: [], nums: [], nextRid: () => `rId${++nextRid}` };

  xml = xml.replace(
    new RegExp(`<w:p\\b[^>]*?>(?:(?!</w:p>)[\\s\\S])*?${TBX}(\\d+)${TBX}(?:(?!</w:p>)[\\s\\S])*?</w:p>`, 'g'),
    (_m, idx: string) => {
      const box = boxes[Number(idx)];
      return box ? `<w:p><w:r>${textBoxDrawingXml(box, Number(idx), parts)}</w:r></w:p>` : '';
    },
  );

  const numPath = 'word/numbering.xml';
  const numXml = files[numPath] ? strFromU8(files[numPath]) : '';
  if (parts.nums.length && numXml) {
    // Both id spaces are the package's, so one free number above its highest serves
    // as the abstract id and the concrete one alike.
    const base = Math.max(maxIdIn(numXml, /w:abstractNumId="(\d+)"/g), maxIdIn(numXml, /w:numId="(\d+)"/g)) + 1;
    const abstracts = parts.nums.map((n, i) =>
      `<w:abstractNum w:abstractNumId="${base + i}"><w:multiLevelType w:val="hybridMultilevel"/>` +
      `${n.levels.filter(Boolean).join('')}</w:abstractNum>`).join('');
    const concretes = parts.nums.map((_n, i) =>
      `<w:num w:numId="${base + i}"><w:abstractNumId w:val="${base + i}"/></w:num>`).join('');
    // w:abstractNum must precede every w:num, so both go where the first w:num is.
    const at = numXml.indexOf('<w:num ');
    files[numPath] = strToU8(at < 0
      ? numXml.replace('</w:numbering>', `${abstracts}${concretes}</w:numbering>`)
      : numXml.slice(0, at) + abstracts + concretes + numXml.slice(at));
    xml = xml.replace(new RegExp(`${TXBX_NUM}(\\d+)${TXBX_NUM}`, 'g'), (_m, i: string) => String(base + Number(i)));
  }

  if (parts.media.length && rels) {
    for (const m of parts.media) files[m.path] = m.bytes as Uint8Array<ArrayBuffer>;
    files[relsPath] = strToU8(rels.replace('</Relationships>', parts.media.map((m) =>
      `<Relationship Id="${m.rid}" Type="${R_NS}/image" Target="media/${m.path.split('/').pop()}"/>`).join('') +
      '</Relationships>'));
  }

  files['word/document.xml'] = strToU8(xml);
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
function applyBibliographyDocx(bytes: Uint8Array, sources: BibSource[]): Uint8Array {
  if (!sources.length) return bytes;
  const files = unzipSync(bytes);
  const relsPath = 'word/_rels/document.xml.rels';
  const rels = files[relsPath] ? strFromU8(files[relsPath]) : '';
  const types = files['[Content_Types].xml'] ? strFromU8(files['[Content_Types].xml']) : '';
  if (!rels || !types) return bytes;

  files['customXml/item1.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<b:Sources xmlns:b="${B_NS}" SelectedStyle="" StyleName="">`
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

// Post-pack pass: swap each sentinel run in word/document.xml for its <m:oMath>. A
// display formula additionally wraps its paragraph's content in <m:oMathPara>, which
// is how Word centers a formula on its own line.
function applyFormulasDocx(bytes: Uint8Array, formulas: FormulaDocx[]): Uint8Array {
  if (!formulas.length) return bytes;
  const files = unzipSync(bytes);
  const docBytes = files['word/document.xml'];
  if (!docBytes) return bytes;
  let xml = strFromU8(docBytes);
  // Tempered pattern: the match stays inside the one run that holds the sentinel.
  xml = xml.replace(
    new RegExp(`<w:r\\b[^>]*?>(?:(?!</w:r>)[\\s\\S])*?${MTH}(\\d+)${MTH}(?:(?!</w:r>)[\\s\\S])*?</w:r>`, 'g'),
    (_m, idx: string) => {
      const f = formulas[Number(idx)];
      if (!f) return '';
      const omath = ommlDocument(parseLatex(f.latex));
      return f.display ? `<m:oMathPara xmlns:m="${OMML_NS}">${omath}</m:oMathPara>` : omath;
    },
  );
  files['word/document.xml'] = strToU8(xml);
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
    // Without this Word stores the colour but paints nothing.
    if (setBytes) {
      files['word/settings.xml'] = strToU8(
        strFromU8(setBytes).replace(/(<w:settings\b[^>]*>)/, '$1<w:displayBackgroundShape/>'),
      );
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

// Post-pack pass: the document-wide <w:footnotePr>/<w:endnotePr>, which the docx
// package does not expose. Word keeps its defaults in settings.xml, beside
// w:mirrorMargins.
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

// ---- paragraphs ------------------------------------------------------------
function alignOf(attrs: TiptapNode['attrs']): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (attrs?.textAlign) {
    case 'center': return AlignmentType.CENTER;
    case 'right': return AlignmentType.RIGHT;
    case 'justify': return AlignmentType.BOTH;
    case 'left': return AlignmentType.LEFT;
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


type ParaOpts = { numbering?: { reference: string; level: number }; indentLeftTwip?: number; force?: TextProps; inCell?: boolean };

// Paragraph background ("colored field") → w:shd; per-side borders ("rule line") → w:pBdr.
function paraShadingOf(attrs: TiptapNode['attrs']) {
  const c = typeof attrs?.backgroundColor === 'string' ? hexColor(attrs.backgroundColor) : undefined;
  return c ? { type: ShadingType.CLEAR, fill: c, color: 'auto' } : undefined;
}

function paraBordersOf(attrs: TiptapNode['attrs']) {
  const out: { top?: IBorderOptions; right?: IBorderOptions; bottom?: IBorderOptions; left?: IBorderOptions } = {};
  for (const [attr, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const b = parseBorderAttr(attrs?.[attr] as string | null);
    if (b && b !== 'none') out[side] = { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(b.widthPt * 8)), color: hexColor(b.color) ?? '000000', space: 1 };
  }
  return Object.keys(out).length ? out : undefined;
}

function paragraphToDocx(node: TiptapNode, opts: ParaOpts = {}): Paragraph {
  const attrs = node.attrs ?? {};
  const indent: Writable<IIndentAttributesProperties> = {};
  if (!opts.numbering) {
    if (typeof attrs.indent === 'number' && attrs.indent > 0) indent.left = cmToTwip(attrs.indent);
    else if (opts.indentLeftTwip) indent.left = opts.indentLeftTwip;
    if (typeof attrs.indentRight === 'number' && attrs.indentRight > 0) indent.right = cmToTwip(attrs.indentRight);
    // Word splits the first-line indent into two exclusive attributes by sign.
    if (typeof attrs.indentFirst === 'number' && attrs.indentFirst !== 0) {
      if (attrs.indentFirst < 0) indent.hanging = cmToTwip(-attrs.indentFirst);
      else indent.firstLine = cmToTwip(attrs.indentFirst);
    }
  }
  // The block's named style (a heading style id is what HeadingLevel references anyway).
  const style = docxStyleId(styleOf(node));
  // w:tabs. Word measures w:pos from the left text margin, the same origin the attr
  // uses, so the position goes out unshifted by the paragraph's own indent.
  const stops = parseTabStops(attrs.tabStops);
  // Paragraph-mark run props carry the block's own font (see import/docx.ts).
  const markSize = typeof attrs.fontSize === 'string' ? fontSizeToHalfPoints(attrs.fontSize) : undefined;
  const markFont = typeof attrs.fontFamily === 'string' && attrs.fontFamily ? attrs.fontFamily : undefined;
  return new Paragraph({
    style,
    alignment: alignOf(attrs),
    spacing: opts.inCell ? cellSpacingOf(attrs, node) : spacingOf(attrs),
    indent: Object.keys(indent).length ? indent : undefined,
    pageBreakBefore: attrs.breakBefore === 'page' || undefined,
    widowControl: attrs.widowControl === false ? false : undefined,
    keepNext: attrs.keepNext === true || undefined,
    keepLines: attrs.keepLines === true || undefined,
    // w:bidi — the block's own base direction (textDirection.ts).
    bidirectional: attrs.dir === 'rtl' ? true : attrs.dir === 'ltr' ? false : undefined,
    tabStops: stops.length
      ? stops.map((s) => ({ type: DOCX_TAB_TYPE[s.align], position: cmToTwip(s.pos), leader: DOCX_LEADER[s.leader ?? ''] }))
      : undefined,
    numbering: opts.numbering,
    shading: paraShadingOf(attrs),
    border: paraBordersOf(attrs),
    run: markSize || markFont ? { size: markSize, font: markFont } : undefined,
    children: inlineToRuns(node.content, opts.force),
  });
}

// ---- lists -----------------------------------------------------------------
function listToParagraphs(
  node: TiptapNode, depth: number, reference: string, extraIndentCm: number,
  num: Numbering, out: (Paragraph | Table | TableOfContents)[], cycle: OrderedCycle = ROOT_ORDERED_CYCLE,
): void {
  const indentCm = extraIndentCm + (typeof node.attrs?.indent === 'number' ? node.attrs.indent : 0);
  num.ensureLevel(reference, depth, node, indentCm, cycle);
  const levelLeftTwip = cmToTwip((depth + 1) * LIST_LEFT_STEP_CM + indentCm);
  const cChild = childCycle(cycle, node.attrs?.listStyleType as string | null | undefined, node.type === 'orderedList');
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    let numberedFirst = false;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        listToParagraphs(child, depth + 1, reference, indentCm, num, out, cChild);
      } else if (child.type === 'paragraph' || child.type === 'heading') {
        if (!numberedFirst) {
          out.push(paragraphToDocx(child, { numbering: { reference, level: depth } }));
          numberedFirst = true;
        } else {
          out.push(paragraphToDocx(child, { indentLeftTwip: levelLeftTwip }));
        }
      }
    }
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

function docxCellBorder(attrs: Record<string, unknown> | undefined, side: BorderSide): IBorderOptions {
  const b = parseBorderAttr(attrs?.[side] as string | null);
  if (b === 'none') return { style: BorderStyle.NONE, size: 0, color: 'auto' };
  if (b) return { style: BorderStyle.SINGLE, size: Math.max(2, Math.round(b.widthPt * 8)), color: hexColor(b.color) ?? '000000' };
  return cellBorder;
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
  const field: TiptapNode = { type: FORMULA_CELL, attrs: { formula, text } };
  return [{ ...first, content: [field] }, ...(cell.content ?? []).slice(1)];
}

function cellBlocksToDocx(content: TiptapNode[] = [], force: TextProps, num: Numbering, contentWidthCm: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const child of content) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      listToParagraphs(child, 0, num.newReference(), 0, num, out);
    } else if (child.type === 'table') {
      out.push(tableToDocx(child, contentWidthCm, num));
    } else if (child.type === 'paragraph' || child.type === 'heading') {
      out.push(paragraphToDocx(child, { force, inCell: true }));
    }
  }
  if (out.length === 0) out.push(new Paragraph({}));
  return out;
}

function tableToDocx(node: TiptapNode, contentWidthCm: number, num: Numbering): Table {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
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
        children: cellBlocksToDocx(content, cellForce(tableStyle, cell, bg), num, contentWidthCm),
      }));
    }
    return new TableRow({
      height: typeof rh === 'number' && rh > 0 ? { value: pxToTwip(rh), rule: HeightRule.ATLEAST } : undefined,
      ...(repeatHeader && rowIndex === 0 ? { tableHeader: true } : {}),
      children: cells,
    });
  });

  return new Table({
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
      top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder,
      insideHorizontal: cellBorder, insideVertical: cellBorder,
    },
  });
}

// ---- top-level walk --------------------------------------------------------
function blocksToDocx(content: TiptapNode[], num: Numbering, contentWidthCm: number, textBoxes: TextBoxDocx[]): (Paragraph | Table | TableOfContents)[] {
  const out: (Paragraph | Table | TableOfContents)[] = [];
  for (const node of content) {
    if (node.type === 'paragraph' || node.type === 'heading') {
      out.push(paragraphToDocx(node));
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      listToParagraphs(node, 0, num.newReference(), 0, num, out);
    } else if (node.type === 'table') {
      out.push(tableToDocx(node, contentWidthCm, num));
    } else if (node.type === 'image') {
      out.push(new Paragraph({ children: inlineToRuns([node]) }));
    } else if (node.type === 'textBox') {
      // Marker paragraph; applyTextBoxesDocx swaps it for the DrawingML shape.
      const i = textBoxes.length;
      textBoxes.push(textBoxDocxDescriptor(node));
      out.push(new Paragraph({ children: [new TextRun({ text: `${TBX}${i}${TBX}` })] }));
    } else if (node.type === 'tableOfContents') {
      // A real TOC field, populated and linked on field update (features.updateFields).
      // A list of figures/tables is the same field over a caption label (\c) instead of
      // the heading levels. The title is a plain bold paragraph so it isn't itself
      // listed, and is omitted where the index has none.
      const kind = indexKindOf(node.attrs?.index);
      const rawTitle = node.attrs?.title;
      const tocTitle = typeof rawTitle === 'string' ? rawTitle : INDEX_TITLES[kind];
      const depth = Number(node.attrs?.maxLevel);
      const maxLevel = depth >= 1 ? Math.min(MAX_HEADING_LEVEL, depth) : MAX_HEADING_LEVEL;
      if (tocTitle) out.push(new Paragraph({ children: [new TextRun({ text: tocTitle, bold: true, size: 32 })], spacing: { after: cmToTwip(0.3) } }));
      if (kind === 'alphabetical') {
        // Word's INDEX field, which it fills from the XE entries on a field update —
        // the same contract the TOC field above works under.
        out.push(new Paragraph({ children: [new SimpleField('INDEX \\h "A" \\c "1" \\e "\t"', '')] }));
        continue;
      }
      if (kind === 'bibliography') {
        // Word's BIBLIOGRAPHY field, filled from the sources in the custom-XML part on a
        // field update — the same contract the TOC and INDEX fields work under.
        out.push(new Paragraph({ children: [new SimpleField('BIBLIOGRAPHY', '')] }));
        continue;
      }
      out.push(new TableOfContents(tocTitle, kind === 'toc'
        ? { hyperlink: true, headingStyleRange: `1-${maxLevel}` }
        // `\c`, not `\a`: Word's own Insert Table of Figures keeps the label and number
        // in the entry, which is what the editor's cached entries already read.
        : { hyperlink: true, captionLabelIncludingNumbers: DOCX_SEQ_NAME[kind === 'tables' ? 'table' : 'figure'] }));
    }
  }
  return out;
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

function bodyGroups(content: TiptapNode[], num: Numbering, contentWidthCm: number, textBoxes: TextBoxDocx[]): BodyGroup[] {
  const groups: BodyGroup[] = [];
  let section = 0;
  let plain: TiptapNode[] = [];
  // Adjacent equal-attr fragments (a columnsFlow page-split chain) = one section;
  // their blocks are collected raw so page-split paragraphs merge before serializing.
  let cols: { count: number; gapCm: number; blocks: TiptapNode[] } | null = null;
  const flushPlain = () => {
    if (!plain.length) return;
    groups.push({ section, columns: null, children: blocksToDocx(plain, num, contentWidthCm, textBoxes) });
    plain = [];
  };
  const flushCols = () => {
    if (!cols) return;
    groups.push({
      section,
      columns: { count: cols.count, gapCm: cols.gapCm },
      children: blocksToDocx(mergeJoinedParagraphsJson(cols.blocks), num, contentWidthCm, textBoxes),
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
function styleOf(node: TiptapNode): string {
  const own = node.attrs?.styleName;
  if (typeof own === 'string' && own) return own;
  return node.type === 'heading' ? `Heading ${(node.attrs?.level as number) ?? 1}` : DEFAULT_STYLE;
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
  if (t.fontFamily) run.font = twinFontName(t.fontFamily);
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
  const paragraph: Record<string, unknown> = {};
  if (Object.keys(spacing).length) paragraph.spacing = { ...spacing, line: 240, lineRule: LineRuleType.AUTO };
  if (p.textAlign) paragraph.alignment = alignOf({ textAlign: p.textAlign });
  if (p.indent != null) paragraph.indent = { left: cmToTwip(p.indent) };
  if (style.outlineLevel) paragraph.keepNext = true;
  return {
    id: docxStyleId(style.name),
    name: style.name,
    basedOn: style.parent ? docxStyleId(style.parent) : undefined,
    next: style.next ? docxStyleId(style.next) : undefined,
    quickFormat: true,
    run: Object.keys(run).length ? run : undefined,
    paragraph: Object.keys(paragraph).length ? paragraph : undefined,
  };
}

// One registry character style → a Word character style (w:type="character").
function characterStyleOf(style: Style): ICharacterStyleOptions {
  const t = style.text;
  const run: Writable<IRunStylePropertiesOptions> = {};
  if (t.fontFamily) run.font = t.fontFamily === 'Liberation Serif' ? DOC_FONT : t.fontFamily;
  if (t.fontSizePt != null) run.size = Math.round(t.fontSizePt * 2);
  if (t.letterSpacingPt) run.characterSpacing = Math.round(t.letterSpacingPt * 20);
  if (t.kerning !== false) run.kern = 1;
  if (t.bold != null) run.bold = t.bold;
  if (t.italic != null) run.italics = t.italic;
  if (t.underline) run.underline = {};
  if (t.strike) run.strike = t.strike;
  if (t.color) run.color = t.color.replace('#', '');
  return { id: docxStyleId(style.name), name: style.name, quickFormat: true, run };
}

// Word needs a referenced table style to exist. ODF/our model hold the banding, and the
// look is baked into the cells, so a name-only definition is enough (no w:tblStylePr).
function tableStyleXml(name: string): ImportedXmlComponent {
  return ImportedXmlComponent.fromXmlString(
    `<w:style w:type="table" w:styleId="${docxStyleId(name)}">`
    + `<w:name w:val="${escapeXml(name)}"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/>`
    + '</w:style>',
  );
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

function buildStyles(sheet: StyleSheet, used: Set<string>, language?: { language: string; country: string } | null, usedTables: string[] = []) {
  const run: Writable<IRunStylePropertiesOptions> = { font: DOC_FONT, size: 24 };
  if (language) run.language = { value: `${language.language}-${language.country}` };
  return {
    default: {
      document: { run, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } } },
    },
    // The document's named styles, chain intact — Word shows them in its style list.
    paragraphStyles: Object.values(sheet.paragraph).filter(st => used.has(st.name)).map(paragraphStyleOf),
    characterStyles: Object.values(sheet.character ?? {}).map(characterStyleOf),
    ...(usedTables.length ? { importedStyles: usedTables.map(tableStyleXml) } : {}),
  };
}

// ---- entry point -----------------------------------------------------------
export async function buildDocx(
  docJson: TiptapNode,
  margins: PageMargins = DEFAULT_MARGINS,
  orientation: Orientation = 'portrait',
  hf?: HfExport,
  language?: { language: string; country: string } | null,
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
): Promise<Uint8Array> {
  docLangTag = localeTag(language ? language.language : 'en');
  exportSheet = styles;
  exportSpacingModel = spacingModel;
  docFormulas = [];
  docSources = [];
  const num = new Numbering();
  const { w: pageWidthCm, h: pageHeightCm } = pageDimsCm(pageFormat, orientation);
  const contentWidthCm = pageWidthCm - margins.left - margins.right;

  const textBoxes: TextBoxDocx[] = [];
  // The note section holds the notes in anchor order (notes.ts), which is the order
  // Word numbers them in; each class counts from 1 because each has its own part.
  // Numbered before the body is walked, so an anchor already knows its id.
  const noteBlocks = (docJson.content ?? []).filter((n) => n.type === 'noteSection')
    .flatMap((n) => n.content ?? []);
  docNoteIds = new Map();
  docComments = [];
  docCommentIds = new Map();
  docRevisionIds = new Map();
  collectComments(docJson);
  const notesByClass: Record<NoteKind, Record<string, { children: Paragraph[] }>> = { footnote: {}, endnote: {} };
  for (const note of noteBlocks) {
    const kind: NoteKind = note.attrs?.kind === 'endnote' ? 'endnote' : 'footnote';
    const id = Object.keys(notesByClass[kind]).length + 1;
    docNoteIds.set(String(note.attrs?.id ?? ''), { id, kind });
    notesByClass[kind][String(id)] = {
      children: [new Paragraph({ style: kind === 'endnote' ? 'EndnoteText' : 'FootnoteText', children: inlineToRuns(note.content ?? []) })],
    };
  }
  const body = (docJson.content ?? []).filter((n) => n.type !== 'noteSection');
  const groups = bodyGroups(body, num, contentWidthCm, textBoxes);

  // A TOC field is empty until its field is calculated; ask the reader to update fields
  // on open so Word/LibreOffice populate + hyperlink it (standard for TOC fields).
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
  const para = (d: HfDoc) => (hfIsEmpty(d) ? null : (d!.content![0] as TiptapNode));
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
    const dims = PAGE_FORMAT_CM[s.format ?? pageFormat];
    return {
      size: { width: cmToTwip(dims.w), height: cmToTwip(dims.h), orientation: sectionLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
      margin: {
        top: cmToTwip(m.top), bottom: cmToTwip(m.bottom),
        left: cmToTwip(m.left), right: cmToTwip(m.right),
        header: cmToTwip(Math.min(headerDist, m.top)), footer: cmToTwip(Math.min(footerDist, m.bottom)),
      },
      // w:pgNumType. Word restarts numbering at every section carrying it, so only the
      // first gets it — the rest continue.
      ...(i === 0 && (pageNumbering.format !== '1' || pageNumbering.start !== 1)
        ? { pageNumbers: { formatType: DOCX_PAGE_NUM_FORMAT[pageNumbering.format], ...(pageNumbering.start !== 1 ? { start: pageNumbering.start } : {}) } }
        : {}),
    };
  };
  // Fresh instances per section (Word's per-sectPr references, i.e. no "Link to
  // Previous"). A first-page variant rides `first:` and is activated by titlePage below.
  const mkHeaders = (i: number) => {
    const s = setAt(i);
    const d = para(s.header), f = s.differentFirstPage ? para(s.headerFirst) : null, e = s.differentOddEven ? para(s.headerEven) : null;
    // A watermark lives in a header part, so a document without one still needs the
    // (empty) default header for applyPageDecorDocx to inject the shape into.
    if (!d && !f && !e) return decor.watermark?.text ? { default: new Header({ children: [new Paragraph({})] }) } : undefined;
    const h: { default?: Header; first?: Header; even?: Header } = {};
    if (d) h.default = new Header({ children: [paragraphToDocx(d)] });
    else if (decor.watermark?.text) h.default = new Header({ children: [new Paragraph({})] });
    if (f) h.first = new Header({ children: [paragraphToDocx(f)] });
    if (e) h.even = new Header({ children: [paragraphToDocx(e)] });
    return h;
  };
  const mkFooters = (i: number) => {
    const s = setAt(i);
    const d = para(s.footer), f = s.differentFirstPage ? para(s.footerFirst) : null, e = s.differentOddEven ? para(s.footerEven) : null;
    if (!d && !f && !e) return undefined;
    const fo: { default?: Footer; first?: Footer; even?: Footer } = {};
    if (d) fo.default = new Footer({ children: [paragraphToDocx(d)] });
    if (f) fo.first = new Footer({ children: [paragraphToDocx(f)] });
    if (e) fo.even = new Footer({ children: [paragraphToDocx(e)] });
    return fo;
  };

  const doc = new Document({
    // Word's File ▸ Info; an empty field is left out so it does not overwrite Word's own.
    creator: props.author.trim() || GENERATOR,
    ...(props.title.trim() ? { title: props.title.trim() } : {}),
    ...(props.subject.trim() ? { subject: props.subject.trim() } : {}),
    ...(props.keywords.trim() ? { keywords: props.keywords.trim() } : {}),
    ...(props.description.trim() ? { description: props.description.trim() } : {}),
    defaultTabStop: cmToTwip(tabIntervalCm),
    // Word's Layout > Hyphenation (w:autoHyphenation in settings.xml).
    ...(hyphenate ? { hyphenation: { autoHyphenation: true } } : {}),
    ...(differentOddEven ? { evenAndOddHeaderAndFooters: true } : {}),
    ...(hasToc ? { features: { updateFields: true } } : {}),
    styles: buildStyles(styles, usedStyleNames(docJson, styles), language, usedTableStyles(docJson, styles)),
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
    // BEFORE a section, so it goes on every section but the first.
    sections: groups.map((g, i) => ({
      properties: {
        page: pagePropsFor(g.section),
        // Word's Layout ▸ Line Numbers; ODF keeps the same five values document-wide.
        ...(lineNumbering.on
          ? { lineNumbers: {
              countBy: lineNumbering.interval,
              restart: lineNumbering.restart === 'page' ? LineNumberRestartFormat.NEW_PAGE : LineNumberRestartFormat.CONTINUOUS,
              distance: cmToTwip(lineNumbering.distanceCm),
            } }
          : {}),
        ...(setAt(g.section).differentFirstPage ? { titlePage: true } : {}),
        ...(i > 0 ? { type: SectionType.CONTINUOUS } : {}),
        ...(g.columns
          ? { column: { count: g.columns.count, space: cmToTwip(g.columns.gapCm), equalWidth: true } }
          : {}),
      },
      headers: mkHeaders(g.section),
      footers: mkFooters(g.section),
      children: g.children.length ? g.children : [new Paragraph({})],
    })),
  });

  const blob = await Packer.toBlob(doc);
  const packed = applyFormulasDocx(applyTextBoxesDocx(new Uint8Array(await blob.arrayBuffer()), textBoxes), docFormulas);
  const cited = applyBibliographyDocx(packed, docSources);
  const withNotes = docNoteIds.size ? applyNotePrDocx(cited, notesSettings) : cited;
  const mirrored = margins.mirrored ? applyMirrorMarginsDocx(withNotes) : withNotes;
  const bidi = rtl ? applyBidiDocx(mirrored) : mirrored;
  if (isEmptyPageDecor(decor)) return bidi;
  const dims = pageDimsCm(pageFormat, orientation);
  const pt = (cm: number) => (cm / 2.54) * 72;
  return applyPageDecorDocx(bidi, decor,
    pt(dims.w - margins.left - margins.right), pt(dims.h - margins.top - margins.bottom));
}
