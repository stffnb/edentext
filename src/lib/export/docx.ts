import {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, InternalHyperlink, Bookmark, Tab,
  FootnoteReferenceRun, EndnoteReferenceRun,
  TableOfContents,
  Table, TableRow, TableCell, Header, Footer, PageNumber, SimpleField,
  CommentRangeStart, CommentRangeEnd, CommentReference,
  AlignmentType, LevelFormat, UnderlineType, BorderStyle, ShadingType,
  WidthType, HeightRule, PageOrientation, LineRuleType, TableLayoutType, SectionType, NumberFormat,
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
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
import { DEFAULT_TAB_INTERVAL_CM } from '../storage/tabInterval';
import type { SpacingModel } from '../storage/spacingModel';
import { HF_DISTANCE_CM, hfIsEmpty, type HfDoc, type HfSet } from '../storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteSettings } from '../storage/noteSettings';
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
function textNodeToRuns(node: TiptapNode, force: TextProps): TextRun[] {
  const text = node.text ?? '';
  const props = runPropsFromMarks(node.marks, force);
  if (!text.includes('\t')) return [new TextRun({ text, ...props })];
  const parts = text.split('\t');
  const children: (string | Tab)[] = [];
  parts.forEach((p, i) => {
    if (i > 0) children.push(new Tab());
    if (p) children.push(p);
  });
  return [new TextRun({ children, ...props })];
}

type Inline = TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | SimpleField | Bookmark
  | CommentRangeStart | CommentRangeEnd;

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
  shapeKind: 'textbox' | 'roundRect' | 'ellipse';
  fill: string | null;
  stroke: string | null;
  strokeWidthPt: number;
  content: TiptapNode[];
};

function textBoxDocxDescriptor(node: TiptapNode): TextBoxDocx {
  const a = node.attrs ?? {};
  const wrapAttr = a.wrap;
  const kind = a.shapeKind;
  return {
    widthPx: typeof a.width === 'number' && a.width > 0 ? Math.round(a.width) : 280,
    heightPx: typeof a.height === 'number' && a.height > 0 ? Math.round(a.height) : 96,
    rotationDeg: typeof a.rotation === 'number' ? a.rotation : 0,
    wrap: wrapAttr === 'left' || wrapAttr === 'right' || wrapAttr === 'topBottom' ? wrapAttr : 'inline',
    offsetCm: typeof a.wrapOffset === 'number' ? a.wrapOffset : null,
    offsetYCm: typeof a.wrapOffsetY === 'number' ? a.wrapOffsetY : null,
    distCm: typeof a.wrapDist === 'number' ? a.wrapDist : null,
    shapeKind: kind === 'roundRect' || kind === 'ellipse' ? kind : 'textbox',
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

// One paragraph/heading of a text box. markerText prefixes a literal list marker
// (in-box lists are flattened, like ODT cell lists once were); images are dropped
// (media/rels can't be minted from a string pass).
function txbxParagraphXml(node: TiptapNode, indentTwip = 0, markerText = ''): string {
  const attrs = node.attrs ?? {};
  const pPr: string[] = [];
  if (node.type === 'heading') {
    const lvl = Math.min(MAX_HEADING_LEVEL, Math.max(1, Number(attrs.level) || 1));
    pPr.push(`<w:pStyle w:val="Heading${lvl}"/>`);
  }
  if (indentTwip) pPr.push(`<w:ind w:left="${indentTwip}"/>`);
  const ta = attrs.textAlign;
  const jc = ta === 'center' ? 'center' : ta === 'right' ? 'right' : ta === 'justify' ? 'both' : '';
  if (jc) pPr.push(`<w:jc w:val="${jc}"/>`);
  let runs = markerText ? `<w:r><w:t xml:space="preserve">${escapeXml(markerText)}</w:t></w:r>` : '';
  for (const child of node.content ?? []) {
    if (child.type === 'text' && child.text) {
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

// In-box lists flatten to literal-marker paragraphs (real numbering would need
// numbering.xml references, which the post-pack string pass can't mint).
// `mlPrefix`: parent chain ("1.2.") when inside a multilevel list, else null.
function txbxListXml(node: TiptapNode, depth: number, mlPrefix: string | null = null, cycle: OrderedCycle = ROOT_ORDERED_CYCLE): string {
  const ordered = node.type === 'orderedList';
  const attr = node.attrs?.listStyleType as string | null | undefined;
  const chained = ordered && (attr === 'multilevel' || (mlPrefix !== null && !attr));
  const def = effectiveOrderedDefAt(attr === 'multilevel' ? 'decimal' : attr, cycle);
  const cChild = childCycle(cycle, attr, ordered);
  let n = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
  let out = '';
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        out += txbxListXml(child, depth + 1, chained ? `${mlPrefix ?? ''}${n}.` : null, cChild);
      } else if (child.type === 'paragraph' || child.type === 'heading') {
        const ordinal = chained ? `${mlPrefix ?? ''}${n}. ` : `${formatOrdinal(n, def.numFormat)}${def.numSuffix} `;
        const marker = first ? (ordered ? ordinal : `${bulletCharOf(node, depth)} `) : '';
        out += txbxParagraphXml(child, cmToTwip((depth + 1) * LIST_HANGING_CM), marker);
        first = false;
      }
    }
    n++;
  }
  return out;
}

function txbxContentXml(blocks: TiptapNode[]): string {
  let out = '';
  for (const b of blocks) {
    if (b.type === 'paragraph' || b.type === 'heading') out += txbxParagraphXml(b);
    else if (b.type === 'bulletList' || b.type === 'orderedList') out += txbxListXml(b, 0);
  }
  return out || '<w:p/>';
}

const PRST_BY_KIND: Record<TextBoxDocx['shapeKind'], string> = {
  textbox: 'rect',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
};

// The full <w:drawing> for one text box. Namespaces are declared inline on the
// wp/a/wps elements so the output never depends on what the library declares on
// the document root.
function textBoxDrawingXml(box: TextBoxDocx, index: number): string {
  const cx = Math.round(box.widthPx * EMU_PER_PX);
  const cy = Math.round(box.heightPx * EMU_PER_PX);
  const rot = box.rotationDeg ? ` rot="${Math.round(box.rotationDeg * 60000)}"` : '';
  const fill = box.fill
    ? `<a:solidFill><a:srgbClr val="${hexColor(box.fill) ?? 'FFFFFF'}"/></a:solidFill>`
    : '<a:noFill/>';
  const ln = box.stroke
    ? `<a:ln w="${Math.round(box.strokeWidthPt * EMU_PER_PT)}"><a:solidFill><a:srgbClr val="${hexColor(box.stroke) ?? '000000'}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const inset = Math.round(TEXTBOX_PADDING_CM * EMU_PER_CM);
  // Auto-grow only for plain text boxes, matching the ODT export.
  const autofit = box.shapeKind === 'textbox' ? '<a:spAutoFit/>' : '';
  const wsp =
    `<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:cNvSpPr txBox="1"/>` +
    `<wps:spPr><a:xfrm${rot}><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="${PRST_BY_KIND[box.shapeKind]}"><a:avLst/></a:prstGeom>${fill}${ln}</wps:spPr>` +
    `<wps:txbx><w:txbxContent>${txbxContentXml(box.content)}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" anchor="t">${autofit}</wps:bodyPr>` +
    `</wps:wsp>`;
  const graphic =
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${wsp}</a:graphicData></a:graphic>`;
  const docPr = `<wp:docPr id="${9001 + index}" name="TextBox${index + 1}"/>`;
  const extent = `<wp:extent cx="${cx}" cy="${cy}"/>`;
  const wpNs = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  if (box.wrap === 'inline') {
    return `<w:drawing><wp:inline ${wpNs} distT="0" distB="0" distL="0" distR="0">${extent}${docPr}${graphic}</wp:inline></w:drawing>`;
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
    `<w:drawing><wp:anchor ${wpNs} distT="0" distB="0" distL="${emu(box.distCm ?? 0)}" distR="${emu(box.distCm ?? 0)}"` +
    ` simplePos="0" relativeHeight="${251658240 + index}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="margin">${posH}</wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(box.offsetYCm ?? 0)}</wp:posOffset></wp:positionV>` +
    `${extent}${wrapEl}${docPr}${graphic}</wp:anchor></w:drawing>`
  );
}

// Post-pack pass: swap each marker paragraph in word/document.xml for its drawing.
// The tempered pattern keeps the match inside one paragraph.
function applyTextBoxesDocx(bytes: Uint8Array, boxes: TextBoxDocx[]): Uint8Array {
  if (!boxes.length) return bytes;
  const files = unzipSync(bytes);
  const docBytes = files['word/document.xml'];
  if (!docBytes) return bytes;
  let xml = strFromU8(docBytes);
  xml = xml.replace(
    new RegExp(`<w:p\\b[^>]*?>(?:(?!</w:p>)[\\s\\S])*?${TBX}(\\d+)${TBX}(?:(?!</w:p>)[\\s\\S])*?</w:p>`, 'g'),
    (_m, idx: string) => {
      const box = boxes[Number(idx)];
      return box ? `<w:p><w:r>${textBoxDrawingXml(box, Number(idx))}</w:r></w:p>` : '';
    },
  );
  files['word/document.xml'] = strToU8(xml);
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
        children: cellBlocksToDocx(cell.content, cellForce(tableStyle, cell, bg), num, contentWidthCm),
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
      // A real TOC field over the index's own heading levels, populated and linked on
      // field update (features.updateFields). The title is a plain bold paragraph so it
      // isn't itself listed, and is omitted where the index has none.
      const rawTitle = node.attrs?.title;
      const tocTitle = typeof rawTitle === 'string' ? rawTitle : 'Table of Contents';
      const depth = Number(node.attrs?.maxLevel);
      const maxLevel = depth >= 1 ? Math.min(MAX_HEADING_LEVEL, depth) : MAX_HEADING_LEVEL;
      if (tocTitle) out.push(new Paragraph({ children: [new TextRun({ text: tocTitle, bold: true, size: 32 })], spacing: { after: cmToTwip(0.3) } }));
      out.push(new TableOfContents(tocTitle, { hyperlink: true, headingStyleRange: `1-${maxLevel}` }));
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
): Promise<Uint8Array> {
  docLangTag = localeTag(language ? language.language : 'en');
  exportSheet = styles;
  exportSpacingModel = spacingModel;
  docFormulas = [];
  const num = new Numbering();
  const landscape = orientation === 'landscape';
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

  // Page geometry rides every sectPr (Word requires it per section): the size is
  // document-wide, the margins the section's own where it has them. Fresh Header/Footer
  // instances per section, or a later one inherits ("Link to Previous").
  const pagePropsFor = (i: number) => {
    const m = setAt(i).margins ?? margins;
    return {
      size: { width: cmToTwip(pageWidthCm), height: cmToTwip(pageHeightCm), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
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
    if (!d && !f && !e) return undefined;
    const h: { default?: Header; first?: Header; even?: Header } = {};
    if (d) h.default = new Header({ children: [paragraphToDocx(d)] });
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
  const withNotes = docNoteIds.size ? applyNotePrDocx(packed, notesSettings) : packed;
  const mirrored = margins.mirrored ? applyMirrorMarginsDocx(withNotes) : withNotes;
  return rtl ? applyBidiDocx(mirrored) : mirrored;
}
