import {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, Tab,
  TableOfContents,
  Table, TableRow, TableCell, Header, Footer, PageNumber,
  AlignmentType, HeadingLevel, LevelFormat, UnderlineType, BorderStyle, ShadingType,
  WidthType, HeightRule, PageOrientation, LineRuleType, TableLayoutType,
  HorizontalPositionAlign, VerticalPositionRelativeFrom, HorizontalPositionRelativeFrom,
  TextWrappingType, TextWrappingSide,
} from 'docx';
import type { TiptapNode } from 'odf-kit';
import type {
  IRunStylePropertiesOptions, ISpacingProperties, IIndentAttributesProperties,
  ILevelsOptions, IFloating, IBorderOptions,
} from 'docx';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { HF_DISTANCE_CM, hfIsEmpty } from '../storage/headerFooter';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { orderedTypeDef } from '../utils/orderedListTypes';
import { normalizeColor, HEADING_STYLE_OVERRIDES, type HfExport } from './odt';

// DOCX export. Mirrors export/odt.ts feature-for-feature, but builds OOXML via the
// `docx` library instead of odf-kit. Lazy-loaded from App.svelte so neither this
// module nor `docx` enters the initial bundle. Import is a later, separate step.

type Writable<T> = { -readonly [P in keyof T]: T[P] };

// Font shown on screen (bundled, metric-identical to Times New Roman) vs. the font
// declared in the file — same trade-off as odt.ts.
const SCREEN_FONT = 'Liberation Serif';
const DOC_FONT = 'Times New Roman';

// Word's bullet glyph per nesting level (matches odt.ts CELL_BULLET_CHARS).
const BULLET_CHARS = ['•', '◦', '▪', '▸', '–', '·'];

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

// ---- numbering registry ----------------------------------------------------
// docx needs all numbering definitions up front (passed to the Document). We build
// the body paragraphs first, allocating one reference per top-level list and filling
// in each nesting level's format the first time we meet a list node at that depth.
class Numbering {
  readonly config: { reference: string; levels: ILevelsOptions[] }[] = [];
  private map = new Map<string, ILevelsOptions[]>();
  private counter = 0;

  newReference(): string {
    const reference = `num-${this.counter++}`;
    const levels: ILevelsOptions[] = [];
    this.map.set(reference, levels);
    this.config.push({ reference, levels });
    return reference;
  }

  ensureLevel(reference: string, depth: number, node: TiptapNode, extraIndentCm: number): void {
    const levels = this.map.get(reference)!;
    if (levels.some((l) => l.level === depth)) return;
    const indent: IIndentAttributesProperties = {
      left: cmToTwip((depth + 1) * LIST_LEFT_STEP_CM + extraIndentCm),
      hanging: cmToTwip(LIST_HANGING_CM),
    };
    if (node.type === 'orderedList') {
      const def = orderedTypeDef(node.attrs?.listStyleType as string | undefined);
      levels.push({
        level: depth,
        format: ORDERED_FORMAT[def.numFormat] ?? LevelFormat.DECIMAL,
        text: `%${depth + 1}${def.numSuffix}`,
        alignment: AlignmentType.LEFT,
        start: typeof node.attrs?.start === 'number' ? node.attrs.start : 1,
        style: { paragraph: { indent } },
      });
    } else {
      levels.push({
        level: depth,
        format: LevelFormat.BULLET,
        text: BULLET_CHARS[depth % BULLET_CHARS.length],
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent } },
      });
    }
  }
}

// ---- inline runs -----------------------------------------------------------
function markPresent(marks: TiptapNode['marks'], type: string): boolean {
  return !!marks?.some((m) => m.type === type);
}

// TipTap marks + textStyle attrs → Word run properties. forceBold bakes bold onto
// every run (header-row cells), respecting an explicit fontWeight:normal un-bold.
function runPropsFromMarks(marks: TiptapNode['marks'] = [], forceBold = false): Writable<IRunStylePropertiesOptions> {
  const ts = marks.find((m) => m.type === 'textStyle');
  const props: Writable<IRunStylePropertiesOptions> = {};

  let bold: boolean | undefined = markPresent(marks, 'bold') || undefined;
  const fw = ts?.attrs?.fontWeight;
  if (fw != null) {
    const s = String(fw);
    if (s === 'normal' || s === '400') bold = false;
    else if (s === 'bold' || /^[5-9]\d\d$/.test(s)) bold = true;
  }
  if (forceBold && bold !== false) bold = true;
  if (bold !== undefined) props.bold = bold;

  if (markPresent(marks, 'italic')) props.italics = true;
  if (markPresent(marks, 'underline')) props.underline = { type: UnderlineType.SINGLE };
  if (markPresent(marks, 'strike')) props.strike = true;
  if (markPresent(marks, 'superscript')) props.superScript = true;
  else if (markPresent(marks, 'subscript')) props.subScript = true;

  const ff = ts?.attrs?.fontFamily;
  if (ff) props.font = String(ff) === SCREEN_FONT ? DOC_FONT : String(ff);
  const fs = ts?.attrs?.fontSize;
  if (fs) {
    const hp = fontSizeToHalfPoints(String(fs));
    if (hp) props.size = hp;
  }
  const col = ts?.attrs?.color;
  if (col) {
    const h = hexColor(String(col));
    if (h) props.color = h;
  }
  const hl = marks.find((m) => m.type === 'highlight');
  if (hl?.attrs?.color) {
    const h = hexColor(String(hl.attrs.color));
    if (h) props.shading = { type: ShadingType.CLEAR, fill: h };
  }
  // Visible hyperlink styling (the ExternalHyperlink wrapper carries the target).
  if (markPresent(marks, 'link')) {
    if (!props.color) props.color = '0563C1';
    if (!props.underline) props.underline = { type: UnderlineType.SINGLE };
  }
  return props;
}

// A text node → one run; tab chars become <w:tab/> via mixed children (a literal \t
// would otherwise be dropped). Returned as an array so a link wrapper can adopt it.
function textNodeToRuns(node: TiptapNode, forceBold: boolean): TextRun[] {
  const text = node.text ?? '';
  const props = runPropsFromMarks(node.marks, forceBold);
  if (!text.includes('\t')) return [new TextRun({ text, ...props })];
  const parts = text.split('\t');
  const children: (string | Tab)[] = [];
  parts.forEach((p, i) => {
    if (i > 0) children.push(new Tab());
    if (p) children.push(p);
  });
  return [new TextRun({ children, ...props })];
}

type Inline = TextRun | ImageRun | ExternalHyperlink;

function inlineToRuns(content: TiptapNode[] = [], forceBold = false): Inline[] {
  const out: Inline[] = [];
  for (const node of content) {
    if (node.type === 'text' && node.text) {
      const runs = textNodeToRuns(node, forceBold);
      const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href;
      if (href) out.push(new ExternalHyperlink({ link: String(href), children: runs }));
      else out.push(...runs);
    } else if (node.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }));
    } else if (node.type === 'image') {
      const img = imageRun(node);
      if (img) out.push(img);
    } else if (node.type === 'pageNumber') {
      out.push(new TextRun({ children: [PageNumber.CURRENT] }));
    } else if (node.type === 'pageCount') {
      out.push(new TextRun({ children: [PageNumber.TOTAL_PAGES] }));
    }
  }
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

function floatingFor(wrap: string): IFloating | undefined {
  if (wrap === 'inline') return undefined;
  const verticalPosition = { relative: VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 };
  if (wrap === 'topBottom') {
    return {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align: HorizontalPositionAlign.LEFT },
      verticalPosition,
      wrap: { type: TextWrappingType.TOP_AND_BOTTOM },
      allowOverlap: false,
    };
  }
  // left: image at left, text on the right; right: mirror.
  const align = wrap === 'right' ? HorizontalPositionAlign.RIGHT : HorizontalPositionAlign.LEFT;
  const side = wrap === 'right' ? TextWrappingSide.LEFT : TextWrappingSide.RIGHT;
  return {
    horizontalPosition: { relative: HorizontalPositionRelativeFrom.MARGIN, align },
    verticalPosition,
    wrap: { type: TextWrappingType.SQUARE, side },
    allowOverlap: false,
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
  return new ImageRun({
    type: decoded.type,
    data: decoded.bytes,
    altText: typeof node.attrs?.alt === 'string' && node.attrs.alt ? { name: node.attrs.alt, title: node.attrs.alt, description: node.attrs.alt } : undefined,
    transformation: { width, height, rotation: rotation || undefined },
    floating: floatingFor(wrap),
  });
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

const HEADING_LEVEL: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
};

type ParaOpts = { numbering?: { reference: string; level: number }; indentLeftTwip?: number; forceBold?: boolean };

function paragraphToDocx(node: TiptapNode, opts: ParaOpts = {}): Paragraph {
  const attrs = node.attrs ?? {};
  const indent: Writable<IIndentAttributesProperties> = {};
  if (!opts.numbering) {
    if (typeof attrs.indent === 'number' && attrs.indent > 0) indent.left = cmToTwip(attrs.indent);
    else if (opts.indentLeftTwip) indent.left = opts.indentLeftTwip;
  }
  const heading = node.type === 'heading' ? HEADING_LEVEL[Math.min(3, Math.max(1, Number(attrs.level) || 1))] : undefined;
  // Paragraph-mark run props carry an empty line's font size (see import/docx.ts).
  const markSize = typeof attrs.fontSize === 'string' ? fontSizeToHalfPoints(attrs.fontSize) : undefined;
  return new Paragraph({
    heading,
    alignment: alignOf(attrs),
    spacing: spacingOf(attrs),
    indent: indent.left != null ? indent : undefined,
    pageBreakBefore: attrs.breakBefore === 'page' || undefined,
    numbering: opts.numbering,
    run: markSize ? { size: markSize } : undefined,
    children: inlineToRuns(node.content, opts.forceBold),
  });
}

// ---- lists -----------------------------------------------------------------
function listToParagraphs(
  node: TiptapNode, depth: number, reference: string, extraIndentCm: number,
  num: Numbering, out: (Paragraph | Table | TableOfContents)[],
): void {
  const indentCm = extraIndentCm + (typeof node.attrs?.indent === 'number' ? node.attrs.indent : 0);
  num.ensureLevel(reference, depth, node, indentCm);
  const levelLeftTwip = cmToTwip((depth + 1) * LIST_LEFT_STEP_CM + indentCm);
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    let numberedFirst = false;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        listToParagraphs(child, depth + 1, reference, indentCm, num, out);
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

function cellBlocksToDocx(content: TiptapNode[] = [], headerBold: boolean, num: Numbering, contentWidthCm: number): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const child of content) {
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      listToParagraphs(child, 0, num.newReference(), 0, num, out);
    } else if (child.type === 'table') {
      out.push(tableToDocx(child, contentWidthCm, num));
    } else if (child.type === 'paragraph' || child.type === 'heading') {
      out.push(paragraphToDocx(child, { forceBold: headerBold }));
    }
  }
  if (out.length === 0) out.push(new Paragraph({}));
  return out;
}

function tableToDocx(node: TiptapNode, contentWidthCm: number, num: Numbering): Table {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow');
  const colsCm = columnWidthsCm(node, contentWidthCm);
  const colsTwip = colsCm?.map(cmToTwip);
  const totalTwip = colsTwip ? colsTwip.reduce((a, b) => a + b, 0) : cmToTwip(contentWidthCm);

  const tableRows = rows.map((row) => {
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
      cells.push(new TableCell({
        columnSpan: colspan > 1 ? colspan : undefined,
        rowSpan: rowspan > 1 ? rowspan : undefined,
        shading: fill ? { type: ShadingType.CLEAR, fill } : undefined,
        width: widthTwip ? { size: widthTwip, type: WidthType.DXA } : undefined,
        borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
        children: cellBlocksToDocx(cell.content, bg === HEADER_SHADE, num, contentWidthCm),
      }));
    }
    return new TableRow({
      height: typeof rh === 'number' && rh > 0 ? { value: pxToTwip(rh), rule: HeightRule.ATLEAST } : undefined,
      children: cells,
    });
  });

  return new Table({
    rows: tableRows,
    columnWidths: colsTwip,
    width: { size: totalTwip, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    margins: { marginUnitType: WidthType.DXA, top: cmToTwip(0.05), bottom: cmToTwip(0.05), left: cmToTwip(0.1), right: cmToTwip(0.1) },
    borders: {
      top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder,
      insideHorizontal: cellBorder, insideVertical: cellBorder,
    },
  });
}

// ---- top-level walk --------------------------------------------------------
function blocksToDocx(content: TiptapNode[], num: Numbering, contentWidthCm: number): (Paragraph | Table | TableOfContents)[] {
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
    } else if (node.type === 'tableOfContents') {
      // A real, recognized TOC field (levels 1–3, hyperlinked); Word/LibreOffice populate
      // + link it on field update (features.updateFields does this on open). Title is a
      // plain bold paragraph so it isn't itself listed; our importer regenerates the node.
      out.push(new Paragraph({ children: [new TextRun({ text: 'Table of Contents', bold: true, size: 32 })], spacing: { after: cmToTwip(0.3) } }));
      out.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }));
    }
  }
  return out;
}

// ---- document styles -------------------------------------------------------
function headingStyle(o: { fontSize: string; marginTop: string; marginBottom: string }) {
  return {
    run: { bold: true, color: '000000', font: DOC_FONT, size: Math.round(parseFloat(o.fontSize) * 2) },
    paragraph: { spacing: { before: cmToTwip(parseFloat(o.marginTop)), after: cmToTwip(parseFloat(o.marginBottom)), line: 240, lineRule: LineRuleType.AUTO }, keepNext: true },
  };
}

function buildStyles(language?: { language: string; country: string } | null) {
  const run: Writable<IRunStylePropertiesOptions> = { font: DOC_FONT, size: 24 };
  if (language) run.language = { value: `${language.language}-${language.country}` };
  return {
    default: {
      document: { run, paragraph: { spacing: { after: 0, line: 240, lineRule: LineRuleType.AUTO } } },
      heading1: headingStyle(HEADING_STYLE_OVERRIDES[0]),
      heading2: headingStyle(HEADING_STYLE_OVERRIDES[1]),
      heading3: headingStyle(HEADING_STYLE_OVERRIDES[2]),
    },
  };
}

// ---- entry point -----------------------------------------------------------
export async function buildDocx(
  docJson: TiptapNode,
  margins: PageMargins = DEFAULT_MARGINS,
  orientation: Orientation = 'portrait',
  hf?: HfExport,
  language?: { language: string; country: string } | null,
): Promise<Uint8Array> {
  const num = new Numbering();
  const landscape = orientation === 'landscape';
  const pageWidthCm = landscape ? 29.7 : 21;
  const pageHeightCm = landscape ? 21 : 29.7;
  const contentWidthCm = pageWidthCm - margins.left - margins.right;

  const body = blocksToDocx(docJson.content ?? [], num, contentWidthCm);
  if (body.length === 0) body.push(new Paragraph({}));

  // A TOC field is empty until its field is calculated; ask the reader to update fields
  // on open so Word/LibreOffice populate + hyperlink it (standard for TOC fields).
  const hasToc = (docJson.content ?? []).some(n => n.type === 'tableOfContents');

  const headerPara = hf && !hfIsEmpty(hf.header) ? (hf.header!.content![0] as TiptapNode) : null;
  const footerPara = hf && !hfIsEmpty(hf.footer) ? (hf.footer!.content![0] as TiptapNode) : null;
  // Word's model: header/footer distance is from the page edge; the body still starts
  // at the body margin. Clamp the distance below the margin (matches odt.ts).
  const headerDist = Math.min(hf?.headerDistanceCm ?? HF_DISTANCE_CM, margins.top);
  const footerDist = Math.min(hf?.footerDistanceCm ?? HF_DISTANCE_CM, margins.bottom);

  const doc = new Document({
    creator: 'Web ODF Editor',
    defaultTabStop: cmToTwip(1.25),
    ...(hasToc ? { features: { updateFields: true } } : {}),
    styles: buildStyles(language),
    numbering: { config: num.config },
    sections: [{
      properties: {
        page: {
          size: { width: cmToTwip(pageWidthCm), height: cmToTwip(pageHeightCm), orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: {
            top: cmToTwip(margins.top), bottom: cmToTwip(margins.bottom),
            left: cmToTwip(margins.left), right: cmToTwip(margins.right),
            header: cmToTwip(headerDist), footer: cmToTwip(footerDist),
          },
        },
      },
      headers: headerPara ? { default: new Header({ children: [paragraphToDocx(headerPara)] }) } : undefined,
      footers: footerPara ? { default: new Footer({ children: [paragraphToDocx(footerPara)] }) } : undefined,
      children: body,
    }],
  });

  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
