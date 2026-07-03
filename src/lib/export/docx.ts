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
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { TEXTBOX_PADDING_CM } from '../editor/extensions/textBox';
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
const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
const EMU_PER_CM = 360000;

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

// ---- text boxes / shapes ---------------------------------------------------
// A textBox node collected by blocksToDocx; applyTextBoxesDocx rewrites its marker
// paragraph into DrawingML (wp:inline/wp:anchor > wps:wsp > wps:txbx) after packing.
type TextBoxDocx = {
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
  wrap: 'inline' | 'left' | 'right' | 'topBottom';
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
  if (markPresent(marks, 'strike')) parts.push('<w:strike/>');
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
  if (markPresent(marks, 'underline')) parts.push('<w:u w:val="single"/>');
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
    const lvl = Math.min(3, Math.max(1, Number(attrs.level) || 1));
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
      runs += '<w:r><w:br/></w:r>';
    }
  }
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs}</w:p>`;
}

// In-box lists flatten to literal-marker paragraphs (real numbering would need
// numbering.xml references, which the post-pack string pass can't mint).
function txbxListXml(node: TiptapNode, depth: number): string {
  const ordered = node.type === 'orderedList';
  let n = typeof node.attrs?.start === 'number' ? node.attrs.start : 1;
  let out = '';
  for (const item of node.content ?? []) {
    if (item.type !== 'listItem') continue;
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        out += txbxListXml(child, depth + 1);
      } else if (child.type === 'paragraph' || child.type === 'heading') {
        const marker = first ? (ordered ? `${n}. ` : `${BULLET_CHARS[depth % BULLET_CHARS.length]} `) : '';
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
  return (
    `<w:drawing><wp:anchor ${wpNs} distT="0" distB="0" distL="114300" distR="114300"` +
    ` simplePos="0" relativeHeight="${251658240 + index}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="margin"><wp:align>${align}</wp:align></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
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

  const textBoxes: TextBoxDocx[] = [];
  const body = blocksToDocx(docJson.content ?? [], num, contentWidthCm, textBoxes);
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
  return applyTextBoxesDocx(new Uint8Array(await blob.arrayBuffer()), textBoxes);
}
