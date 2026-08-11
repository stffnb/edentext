import { unzipSync, strFromU8 } from 'fflate';
import { StyleResolver, NS, lengthToPt, lengthToCm, layerTextProps, type PropMap } from './styleResolver';
import { HEADING_STYLE_OVERRIDES, MAX_HEADING_LEVEL, ODF_LOOK_ATTRS, normalizeColor } from '../export/odt';
import { builtinStyleSheet, DEFAULT_STYLE, type ParaProps, type Style, type StyleSheet, type TextProps } from '../styles/styleSheet';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { fitInlineImage, framePx } from '../editor/extensions/image';
import { odfChartDataUrl } from './chart';
import { formatTabStops, normalizeLeader } from '../editor/extensions/tabStops';
import type { CapsMode, LineStyle } from '../editor/extensions/textEffects';
import { TABLE_REGIONS, tableLookAttr, type TableLook, type TableRegion } from '../styles/tableStyles';
import { orderedTypeFromFormat, orderedTypeAttrAt, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { bulletCharAttr, bulletCharFromOdf } from '../utils/bulletListTypes';
import { matchFormat, toDateValue, type Token } from '../utils/dateTime';
import { imageDataUrl, placeholderImage, type ConvertedImages } from './imageFormats';
import { astToLatex } from '../math/latex';
import { parseMathml } from '../math/mathml';
import { PX_PER_CM, cmToPx, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import type { SpacingModel } from '../storage/spacingModel';
import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
import { languageFromOdf, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
import type { HfDoc, HfSet } from '../storage/headerFooter';
import type { EmbeddedFont } from '../fonts/embeddedFonts';
import { cellPaddingAttr, DEFAULT_CELL_PADDING, type CellPadding } from '../editor/extensions/tableCellPadding';
import { TEXTBOX_PADDING_CM } from '../editor/extensions/textBox';
import { getSchema } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { hfExtensions } from '../editor/extensions/headerFooter';

// .odt → TipTap JSON, inverting export/odt.ts. Editor-expressible content becomes its
// native node/mark/attr; values matching the editor's defaults are suppressed so round
// trips don't accrete explicit attrs. Unsupported content degrades gracefully (reported).

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = {
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
  // The grid every tab past the last custom stop falls on; the format's own fallback
  // when the file declares none.
  tabIntervalCm: number;
  // How the space between two blocks is measured; 'max' only where the file says so
  // (settings.xml AddParaTableSpacing=false, what LibreOffice writes for a Word import).
  spacingModel: SpacingModel;
  // Single-paragraph docs in the hfExtensions schema; null = no zone.
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
  // Fonts embedded in the package, to register via FontFace so they render.
  fonts: EmbeddedFont[];
  // The document's named paragraph styles: the file's own (only those it uses, plus
  // their parent chains) merged over the editor's built-ins.
  styles: StyleSheet;
  warnings: string[];
}

// Where a block sits: only 'body' takes page breaks/columns/TOCs, and a 'list'
// paragraph's indent lives in the list style rather than its own margin.
type BlockKind = 'body' | 'list' | 'cell';

// `files` is the full unzipped archive so image converters can read Pictures/ binaries;
// imageCache dedupes repeated hrefs into one data-URI. pendingBlocks is the side channel
// for text boxes found in inline content — convertBlocks flushes them after the anchor.
type Ctx = {
  resolver: StyleResolver;
  // ODF style name → display name, and the names blocks actually reference: the
  // document's style registry is built from these (only used styles are kept).
  styleNames: Map<string, string>;
  usedStyles: Set<string>;
  charStyleNames: Map<string, string>;
  usedCharStyles: Set<string>;
  warnings: Set<string>;
  files: Record<string, Uint8Array>;
  imageCache: Map<string, string>;
  convertedImages: ConvertedImages;
  pendingBlocks: Node[];
  // Text width (cm) of the file's page setup; a table's margins are relative to it.
  contentWidthCm: number;
  // Master pages the body switches to, in order — one section each past the first.
  masterPages: string[];
  // How many body blocks each of them governs: the largest count is the document's own
  // page geometry, which is not per section.
  masterBlocks: Map<string, number>;
  // Bookmark ranges open at this point of the walk, outermost first; a range may end in
  // a later paragraph than it started in, so the set outlives one convertInline call.
  openBookmarks: Set<string>;
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
function wrapModeFromOdf(wrapVal: string | undefined, hpos: string | undefined): 'left' | 'right' | 'topBottom' {
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

// Rotation + wrap attrs, shared by images, text boxes and shapes. A non-as-char anchor or
// an explicit style:wrap floats the element (free x/y collapse to the nearest side). An
// explicit as-char anchor stays inline: LibreOffice's Graphics style carries a style:wrap.
// Where an as-char frame sits against the line. `baseline`/`char` measure from the text
// baseline, `text`/`line` from the character area, and `from-top` puts the frame's top
// svg:y below the baseline whatever the relation says (all probed against LibreOffice).
function applyInlineVAlign(el: Element, attrs: Record<string, unknown>, gp: PropMap): void {
  const pos = gp['style:vertical-pos'];
  const rel = gp['style:vertical-rel'];
  const area = rel === 'text' || rel === 'line';
  if (pos === 'from-top') {
    const y = lengthToCm(el.getAttributeNS(NS.svg, 'y'));
    if (y == null) return;
    attrs.vAlign = 'offset';
    attrs.wrapOffsetY = Math.round(y * 1000) / 1000;
  } else if (pos === 'middle') attrs.vAlign = area ? 'text-middle' : 'middle';
  else if (pos === 'bottom') attrs.vAlign = area ? 'text-bottom' : 'below';
  else if (pos === 'top' && area) attrs.vAlign = 'text-top';
}

function applyFrameRotationAndWrap(el: Element, attrs: Record<string, unknown>, gp: PropMap): void {
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
  // Only the text side of the gap is drawn — the other one is the frame's own offset.
  if (attrs.wrap === 'left' || attrs.wrap === 'right') {
    const side = attrs.wrap === 'right' ? 'fo:margin-left' : 'fo:margin-right';
    const dist = lengthToCm(gp[side] ?? gp['fo:margin']);
    if (dist != null && dist > 0) attrs.wrapDist = Math.round(dist * 1000) / 1000;
  }
  // A frame placed by coordinate (style:horizontal-pos="from-left") keeps its x in the
  // column; the wrap mode alone would snap it to a side.
  const hpos = gp['style:horizontal-pos'];
  const x = hpos === 'from-left' ? lengthToCm(el.getAttributeNS(NS.svg, 'x')) : null;
  if (x != null && attrs.wrap) attrs.wrapOffset = Math.round(x * 100) / 100;
  // Set against one end of its band rather than filling it (Word's positionH align).
  if (attrs.wrap === 'topBottom' && (hpos === 'left' || hpos === 'right')) attrs.wrapAlign = hpos;
  // Likewise down the page, but only against the anchor paragraph — a page-relative
  // frame is placed absolutely, which one in the text flow cannot be.
  const rel = gp['style:vertical-rel'];
  const y = gp['style:vertical-pos'] === 'from-top' && (!rel || rel.startsWith('paragraph') || rel === 'line')
    ? lengthToCm(el.getAttributeNS(NS.svg, 'y')) : null;
  if (y != null && y > 0 && attrs.wrap) attrs.wrapOffsetY = Math.round(y * 100) / 100;
  // A page-anchored frame is out of the text flow, placed from its page's corner: the
  // cover graphic or watermark of a title page. Its offsets are that corner's, not the
  // column's, so they replace whatever the wrap rules above read.
  if (anchor === 'page') {
    const page = Number(el.getAttributeNS(NS.text, 'anchor-page-number'));
    attrs.anchorPage = Number.isInteger(page) && page > 0 ? page : 1;
    attrs.wrapOffset = Math.max(0, lengthToCm(el.getAttributeNS(NS.svg, 'x')) ?? 0);
    attrs.wrapOffsetY = Math.max(0, lengthToCm(el.getAttributeNS(NS.svg, 'y')) ?? 0);
  }
}

// A paragraph mark that declares nothing keeps the style's font, but the runs may all
// agree on another one — then that is the paragraph's font, strut included. Without it
// the taller style strut governs every line and the block renders too high.
export function applyUniformRunFont(attrs: Record<string, unknown>, content: { type: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }[]): void {
  let family: string | null | undefined;
  let size: string | null | undefined;
  let runs = 0;
  for (const n of content) {
    if (n.type !== 'text') continue;
    const ts = (n.marks ?? []).find((m) => m.type === 'textStyle')?.attrs ?? {};
    const f = (ts.fontFamily as string) ?? null;
    const s = (ts.fontSize as string) ?? null;
    if (runs && f !== family) family = undefined;
    if (runs && s !== size) size = undefined;
    if (!runs) { family = f; size = s; }
    runs++;
  }
  if (!runs) return;
  if (attrs.fontFamily == null && family) attrs.fontFamily = family;
  if (attrs.fontSize == null && size) attrs.fontSize = size;
}

// A top-and-bottom frame set below its paragraph's top sinks behind the paragraph's
// text: a full-width float pushes every following line under itself, so where there is
// text the offset can only be drawn as the lines standing above the frame.
export function sinkOffsetFrames(content: { type: string; text?: string; attrs?: Record<string, unknown> }[]): void {
  const sinks = (n: { type: string; attrs?: Record<string, unknown> }) =>
    n.type === 'image' && n.attrs?.wrap === 'topBottom' && (n.attrs.wrapOffsetY as number) > 0;
  if (!content.some(sinks) || !content.some(n => n.type === 'text' && n.text?.trim())) return;
  const frames = content.filter(sinks);
  for (const f of frames) content.splice(content.indexOf(f), 1);
  content.push(...frames);
}

// Two top-and-bottom frames set against opposite ends of nearby paragraphs share one
// band and sit side by side, as they do in LibreOffice and Word. Only such a pair keeps
// its wrapAlign: a lone frame reserves the whole band, which is what the wrap means.
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
      ctx.warnings.add('Some images could not be read and were skipped');
      return null;
    }
    ctx.warnings.add('Images in a format the browser can’t display (e.g. WMF, EMF, SVM) were replaced by a placeholder');
    src = placeholderImage('Image', cmToPx(wCm), cmToPx(hCm));
  }
  const attrs: Record<string, unknown> = { src };
  if (wCm != null) attrs.width = framePx(cmToPx(wCm));
  if (hCm != null) attrs.height = framePx(cmToPx(hCm));
  const title = frame.getElementsByTagNameNS(NS.svg, 'title')[0]?.textContent;
  if (title) attrs.alt = title;
  applyFrameRotationAndWrap(frame, attrs, ctx.resolver.graphicProps(frame.getAttributeNS(NS.draw, 'style-name')));
  if (!attrs.wrap || attrs.wrap === 'inline') fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  return { type: 'image', attrs };
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
  const border = gp['fo:border'];
  if (border !== undefined) {
    let widthPt: number | null = null, color: string | null = null, styleTok: string | null = null;
    for (const part of border.trim().split(/\s+/)) {
      if (/^-?[\d.]+\s*(pt|cm|mm|in|px|pc)?$/.test(part)) widthPt = lengthToPt(part);
      else if (part.startsWith('#')) color = normalizeColor(part) ?? part;
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

// The block content of a text box / shape: its text:* children via the cell path
// (which flattens whatever the box schema can't hold), at least one paragraph.
function textBoxContent(children: Element[], ctx: Ctx): Node[] {
  const textChildren = children.filter(c => c.namespaceURI === NS.text);
  const blocks = convertBlocks(textChildren, ctx, 'cell');
  return blocks.length ? blocks : [{ type: 'paragraph' }];
}

// A <draw:frame><draw:text-box> → a textBox node. The height is the text-box's
// fo:min-height when present (our own export; height = minimum, content grows the
// box), else the frame's computed svg:height (LibreOffice re-saves).
function convertTextBoxFrame(frame: Element, textBoxEl: Element, ctx: Ctx): Node {
  const attrs: Record<string, unknown> = {};
  const wCm = lengthToCm(frame.getAttributeNS(NS.svg, 'width'));
  if (wCm != null) attrs.width = framePx(cmToPx(wCm));
  const hCm = lengthToCm(textBoxEl.getAttributeNS(NS.fo, 'min-height'))
    ?? lengthToCm(frame.getAttributeNS(NS.svg, 'height'));
  if (hCm != null) attrs.height = framePx(cmToPx(hCm));
  const gp = ctx.resolver.graphicProps(frame.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(frame, attrs, gp);
  // A box is a block of its own here, so the centring of a figure frame — which its
  // as-char anchor paragraph would otherwise give it — has to ride the box itself.
  // An image needs none: with no side to float to it is centred anyway.
  if (gp['style:horizontal-pos'] === 'center' && attrs.wrapOffset == null) attrs.wrapAlign = 'center';
  const padCm = lengthToCm(gp['fo:padding']);
  if (padCm != null && Math.abs(padCm - TEXTBOX_PADDING_CM) > 0.01) attrs.paddingCm = Math.round(padCm * 1000) / 1000;
  shapeStyleAttrs(gp, attrs, false);
  return { type: 'textBox', attrs, content: textBoxContent(Array.from(textBoxEl.children), ctx) };
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
  applyFrameRotationAndWrap(frame, attrs, ctx.resolver.graphicProps(frame.getAttributeNS(NS.draw, 'style-name')));
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
  const doc = new DOMParser().parseFromString(strFromU8(bytes), 'text/xml');
  return doc.documentElement && !doc.getElementsByTagName('parsererror').length ? doc : null;
}

// draw:rect / draw:ellipse / draw:custom-shape (rect/round-rect/ellipse preset) → a
// textBox with the matching shapeKind; the shape's text is its content. Other
// custom-shape presets (stars, arrows, …) are dropped with a warning.
function convertShape(el: Element, ctx: Ctx): Node | null {
  let kind: 'textbox' | 'roundRect' | 'ellipse' | null = null;
  if (el.localName === 'rect') kind = 'textbox';
  else if (el.localName === 'ellipse') kind = 'ellipse';
  else {
    const geo = el.getElementsByTagNameNS(NS.draw, 'enhanced-geometry')[0];
    const type = geo?.getAttributeNS(NS.draw, 'type') ?? '';
    if (type === 'ellipse' || type === 'circle') kind = 'ellipse';
    else if (type === 'round-rectangle') kind = 'roundRect';
    else if (type === 'rectangle' || !type) kind = 'textbox';
  }
  if (!kind) {
    ctx.warnings.add('Unsupported shapes were removed');
    return null;
  }
  const attrs: Record<string, unknown> = {};
  if (kind !== 'textbox') attrs.shapeKind = kind;
  const wCm = lengthToCm(el.getAttributeNS(NS.svg, 'width'));
  const hCm = lengthToCm(el.getAttributeNS(NS.svg, 'height'));
  if (wCm != null) attrs.width = framePx(cmToPx(wCm));
  if (hCm != null) attrs.height = framePx(cmToPx(hCm));
  const gp = ctx.resolver.graphicProps(el.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(el, attrs, gp);
  shapeStyleAttrs(gp, attrs, true);
  return { type: 'textBox', attrs, content: textBoxContent(Array.from(el.children), ctx) };
}

// Dispatch any draw:* element: an image stays inline; a text box / shape is a block
// node routed through ctx.pendingBlocks; everything else is dropped with a warning.
function convertDrawElement(e: Element, ctx: Ctx): { inline?: Node; block?: Node } | null {
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
    if (!hasImage) ctx.warnings.add('Drawings were removed');
    return null;
  }
  if (e.localName === 'rect' || e.localName === 'ellipse' || e.localName === 'custom-shape') {
    const shape = convertShape(e, ctx);
    return shape ? { block: shape } : null;
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
  ctx.warnings.add('Drawings were removed');
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
}));

// The editor's on-screen default (Liberation Serif) and what the export declares
// in its place (Times New Roman) — both mean "default font", so no mark. Headings
// render sans (HEADING_FONT), so their default pair is the metric-identical one.
const DEFAULT_FONTS = new Set(['times new roman', 'liberation serif']);
const DEFAULT_HEADING_FONTS = new Set(['arial', 'liberation sans']);

// ODF line spacing multiplies the font's natural line height; see lineHeight.ts.
const LINE_HEIGHT_RATIO = 1.15;

// odf-kit emits each list level at margin-left = level × 1.27cm (label-alignment).
// A top-level list's margin beyond this level-1 base is its whole-list indent.
const LIST_BASE_MARGIN_CM = 1.27;
const LIST_INDENT_EPS_CM = 0.05;

// ---- entry --------------------------------------------------------------------

// LibreOffice writes AddParaTableSpacing=false for a document it imported from Word,
// and then takes the larger of two adjoining spacings instead of adding them.
function odfSpacingModel(files: Record<string, Uint8Array>): SpacingModel {
  const xml = files['settings.xml'] ? strFromU8(files['settings.xml']) : '';
  return /AddParaTableSpacing"[^>]*>false</.test(xml) ? 'max' : 'add';
}

export function importOdt(bytes: Uint8Array, convertedImages: ConvertedImages = new Map()): OdtImportResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Not a valid .odt file (could not read the archive).');
  }
  const contentBytes = files['content.xml'];
  if (!contentBytes) throw new Error('Not a valid .odt file (content.xml is missing).');

  const contentDoc = parseXml(strFromU8(contentBytes));
  const stylesDoc = files['styles.xml'] ? parseXml(strFromU8(files['styles.xml'])) : null;
  const resolver = new StyleResolver(contentDoc, stylesDoc);
  const warnings = new Set<string>();

  const body = contentDoc.getElementsByTagNameNS(NS.office, 'text')[0];
  if (!body) throw new Error('Not a text document (no office:text body).');

  const styleNames = new Map<string, string>();
  for (const [name, def] of resolver.namedParagraphStyles()) styleNames.set(name, displayStyleName(name, def.display));
  const charStyleNames = new Map<string, string>();
  for (const [name, def] of resolver.namedTextStyles()) charStyleNames.set(name, displayStyleName(name, def.display));
  // Text width of the file's own page setup — the reference a table's margins are
  // measured against (falls back to A4 with the ODF default margins).
  const geo = resolver.pageGeometry();
  const contentWidthCm = geo
    ? pageDimsCm(geo.format, geo.orientation).w - geo.margins.left - geo.margins.right
    : pageDimsCm('A4', 'portrait').w - 2 * 2.12;
  const ctx: Ctx = { resolver, styleNames, usedStyles: new Set(), charStyleNames, usedCharStyles: new Set(), warnings, files, imageCache: new Map(), convertedImages, pendingBlocks: [], contentWidthCm, masterPages: [], masterBlocks: new Map(), openBookmarks: new Set() };
  let blocks = convertBlocks(Array.from(body.children), ctx, 'body');
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });
  pairAlignedFrames(blocks, Math.floor(cmToPx(contentWidthCm)));

  // Whole-document columns declared on the page layout instead of a
  // text:section: wrap the body's wrappable runs the way a section would be.
  const pageCols = resolver.pageColumns();
  if (pageCols) {
    const wrapped: Node[] = [];
    pushColumnRuns(blocks, pageCols, wrapped, ctx);
    blocks = wrapped;
  }

  // Page geometry — margins, format, and the band a header/footer reserves — is
  // document-wide, so it comes from the master governing most of the body rather than
  // from one the file merely declares (`geo` above only sized the tables).
  let dominant = '';
  let governed = 0;
  for (const [name, count] of ctx.masterBlocks) {
    if (count > governed) { dominant = name; governed = count; }
  }
  resolver.setDefaultMaster(dominant || null);

  const hf = resolver.masterPageHF();
  const geometry = resolver.pageGeometry() ?? geo;
  const edge = resolver.edgeDistancesCm();

  const fonts: EmbeddedFont[] = [];
  for (const s of resolver.embeddedFontSources()) {
    const data = files[s.href];
    if (data) fonts.push({ family: s.family, weight: s.weight, style: s.style, data });
  }

  const odfLang = resolver.documentLanguage();
  let language: DocumentLanguage | null = null;
  if (odfLang) {
    const code = languageFromOdf(odfLang.language, odfLang.country || undefined);
    if (code) {
      language = code;
    } else {
      language = NO_LANGUAGE;
      const tag = odfLang.country ? `${odfLang.language}-${odfLang.country}` : odfLang.language;
      warnings.add(`Spell-check language "${tag}" has no bundled dictionary — spell check was turned off`);
    }
  }

  const headerFirst = hf.headerFirst ? convertHfZone(hf.headerFirst, ctx) : null;
  const footerFirst = hf.footerFirst ? convertHfZone(hf.footerFirst, ctx) : null;
  // The presence of a first-page element is the flag, even when it's empty (an empty
  // first-page zone deliberately blanks page 1 while the default fills later pages).
  const differentFirstPage = !!(hf.headerFirst || hf.footerFirst || hf.firstPageOnly);
  const headerEven = hf.headerLeft ? convertHfZone(hf.headerLeft, ctx) : null;
  const footerEven = hf.footerLeft ? convertHfZone(hf.footerLeft, ctx) : null;
  const differentOddEven = !!(hf.headerLeft || hf.footerLeft);
  // A first-page/even zone reserves the band even if its default counterpart is empty.
  const hasHeader = hf.header || headerFirst || headerEven;
  const hasFooter = hf.footer || footerFirst || footerEven;

  const header = hf.header ? convertHfZone(hf.header, ctx) : null;
  const footer = hf.footer ? convertHfZone(hf.footer, ctx) : null;

  return {
    content: { type: 'doc', content: blocks },
    margins: geometry?.margins ?? null,
    orientation: geometry?.orientation ?? null,
    format: geometry?.format ?? null,
    tabIntervalCm: resolver.defaultTabInterval(),
    spacingModel: odfSpacingModel(files),
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
      ...ctx.masterPages.map((name) => hfSetOfMasterPage(name, ctx)),
    ],
    headerDistanceCm: hasHeader ? edge?.top ?? null : null,
    footerDistanceCm: hasFooter ? edge?.bottom ?? null : null,
    language,
    fonts,
    styles: collectStyleSheet(resolver, ctx),
    warnings: [...warnings],
  };
}

// The zones of a named master page — what a section past the first switches to.
function hfSetOfMasterPage(name: string, ctx: Ctx): HfSet {
  const hf = ctx.resolver.masterPageHF(name);
  const zone = (el: Element | null) => (el ? convertHfZone(el, ctx) : null);
  return {
    header: zone(hf.header),
    footer: zone(hf.footer),
    headerFirst: zone(hf.headerFirst),
    footerFirst: zone(hf.footerFirst),
    differentFirstPage: !!(hf.headerFirst || hf.footerFirst || hf.firstPageOnly),
    headerEven: zone(hf.headerLeft),
    footerEven: zone(hf.footerLeft),
    differentOddEven: !!(hf.headerLeft || hf.footerLeft),
  };
}

// A header/footer zone → one single-paragraph doc (hfExtensions schema). Multiple
// paragraphs collapse to hard line breaks; block structures flatten to their text.
function convertHfZone(zoneEl: Element, ctx: Ctx): HfDoc {
  const inline: Node[] = [];
  let textAlign: string | null = null;
  let stops: string | null = null;
  const boxMaps: Record<string, string>[] = [];

  // The zone's paragraphs collapse into one, so the outer two margins become its own:
  // what the band has to be tall enough to hold (Editor.svelte's hfReachPx).
  let spaceBefore: number | null = null;
  let spaceAfter = 0;

  const addPara = (p: Element) => {
    if (inline.length) inline.push({ type: 'hardBreak' });
    const styleName = p.getAttributeNS(NS.text, 'style-name');
    const outer = ctx.resolver.paraProps(styleName);
    spaceBefore ??= snapPt(lengthToPt(outer['fo:margin-top']) ?? 0);
    spaceAfter = snapPt(lengthToPt(outer['fo:margin-bottom']) ?? 0);
    // The zone is one paragraph, so the first line's stops are the zone's.
    stops ??= formatTabStops(ctx.resolver.tabStops(styleName));
    if (textAlign === null) {
      const ta = ctx.resolver.paraProps(styleName)['fo:text-align'] ?? '';
      textAlign = ta === 'center' || ta === 'justify' ? ta : ta === 'right' || ta === 'end' ? 'right' : null;
      if (textAlign === null) textAlign = ''; // only the first paragraph decides
    }
    boxMaps.push(paraBoxAttrs(ctx.resolver.paraProps(styleName)));
    inline.push(...convertInline(p, ctx, ctx.resolver.paraTextProps(styleName), blockDefaults(ctx.resolver, null, null, false), true));
  };

  for (const child of Array.from(zoneEl.children)) {
    if (child.namespaceURI === NS.text && (child.localName === 'p' || child.localName === 'h')) {
      addPara(child);
    } else if (child.namespaceURI === NS.text || child.namespaceURI === NS.table) {
      // Lists/tables in headers are beyond the one-paragraph model — keep their text.
      ctx.warnings.add('Lists/tables in headers or footers were flattened to text');
      for (const p of Array.from(child.getElementsByTagNameNS(NS.text, 'p'))) addPara(p);
    }
  }
  // Empty source paragraphs become blank lines (hardBreaks); an all-empty zone has no
  // runs and no inter-paragraph break, so inline stays empty. Keep such a zone only when
  // it carries a background/rule line (a footer that is just a colored line has no text).
  const box = mergeHfBox(boxMaps);
  const content = fitZoneSchema(inline);
  if (content.length === 0 && Object.keys(box).length === 0) return null;

  const para: Node = { type: 'paragraph', content };
  const attrs: Record<string, string | number> = {};
  // The zone is one paragraph here, so its strut is the whole band's line height —
  // runs that agree on a size must set it, or a 10pt footer reserves 12pt lines.
  applyUniformRunFont(attrs, content);
  if (textAlign) attrs.textAlign = textAlign;
  if (stops) attrs.tabStops = stops;
  if (spaceBefore) attrs.spaceBefore = spaceBefore;
  if (spaceAfter) attrs.spaceAfter = spaceAfter;
  Object.assign(attrs, box);
  if (Object.keys(attrs).length) para.attrs = attrs;
  return { type: 'doc', content: [para] };
}

// The header/footer schema is a subset of the body's, and it is not forgiving: one node
// or mark it doesn't know (a hyperlink, a date field) makes the whole zone fail to render
// and come out blank. Drop what it can't hold, keeping the text.
let zoneSchema: Schema | null = null;
function fitZoneSchema(nodes: Node[]): Node[] {
  zoneSchema ??= getSchema(hfExtensions());
  const out: Node[] = [];
  for (const n of nodes) {
    if (!zoneSchema.nodes[n.type]) {
      const text = typeof n.attrs?.text === 'string' ? n.attrs.text : '';
      if (text) out.push({ type: 'text', text });
      continue;
    }
    const marks = n.marks?.filter((m) => zoneSchema!.marks[m.type]);
    out.push(marks && marks.length !== n.marks?.length ? { ...n, marks } : n);
  }
  return out;
}

// The zone collapses several source paragraphs into one, so pick the box props that
// reproduce the visible band+rule: background/side rules from the first that declares
// them, but the bottom rule from the LAST paragraph (it sits under the whole band).
function mergeHfBox(maps: Record<string, string>[]): Record<string, string> {
  const out: Record<string, string> = {};
  const first = (key: string) => maps.find((m) => m[key] !== undefined)?.[key];
  const last = (key: string) => [...maps].reverse().find((m) => m[key] !== undefined)?.[key];
  for (const [key, val] of [
    ['backgroundColor', first('backgroundColor')],
    ['borderTop', first('borderTop')],
    ['borderLeft', first('borderLeft')],
    ['borderRight', first('borderRight')],
    ['borderBottom', last('borderBottom')],
  ] as const) {
    if (val !== undefined) out[key] = val;
  }
  return out;
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Not a valid .odt file (malformed XML).');
  }
  return doc;
}

// ---- block conversion -----------------------------------------------------------

// Block types a columns section (columns.ts) can contain.
const COLUMNS_ALLOWED = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);

// Wrap a multi-column region's converted blocks into columns nodes: maximal runs of
// allowed types become one node each; anything else is emitted between the runs at
// top level — with a warning, except columns nodes (they keep their own layout).
function pushColumnRuns(inner: Node[], cols: { count: number; gapCm: number }, out: Node[], ctx: Ctx): void {
  let count = cols.count;
  if (count > 3) {
    ctx.warnings.add('Sections with more than 3 columns were reduced to 3 columns');
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
    } else {
      if (block.type !== 'columns') {
        ctx.warnings.add('Tables and text boxes inside a multi-column layout were moved out of the columns');
      }
      flush();
      out.push(block);
    }
  }
  flush();
}

function convertBlocks(elements: Element[], ctx: Ctx, kind: BlockKind, boldByDefault = false): Node[] {
  const out: Node[] = [];

  // Emit an anchor block, then any text boxes found inside it (block nodes riding
  // ctx.pendingBlocks). In the body they follow the anchor at top level, and an empty
  // anchor (our export's wrapper) is dropped; in cells/boxes they unwrap in place.
  const pushWithPending = (anchor: Node | null) => {
    const pending = ctx.pendingBlocks.splice(0);
    const anchorIsEmpty = anchor?.type === 'paragraph' && !anchor.content?.length;
    if (anchor && !(pending.length && anchorIsEmpty)) out.push(anchor);
    if (!pending.length) return;
    if (kind === 'body') {
      // A box lifted out of its anchor paragraph keeps the alignment that paragraph gave
      // it: an as-char figure frame is set against the middle of the column by the
      // paragraph it sits in, not by anything of its own.
      const align = anchor?.attrs?.textAlign;
      if (align === 'center' || align === 'right') {
        for (const b of pending) {
          if (b.type === 'textBox' && b.attrs && b.attrs.wrapOffset == null && !b.attrs.wrapAlign) {
            b.attrs.wrapAlign = align;
          }
        }
      }
      out.push(...pending);
    } else {
      ctx.warnings.add('Text boxes nested in table cells or other text boxes were flattened');
      for (const box of pending) out.push(...(box.content ?? [{ type: 'paragraph' }]));
    }
  };

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
        pushWithPending(hoistPageFrames(convertParaLike(el, ctx, kind, boldByDefault)));
      } else if (el.localName === 'list') {
        // A list wrapping only headings is ODF outline (chapter) numbering, not a real
        // list — unwrap it to plain headings instead of empty nested list levels.
        const headingEls = kind === 'body' ? outlineHeadingEls(el) : null;
        if (headingEls) {
          for (const h of headingEls) out.push(convertParaLike(h, ctx, 'body'));
        } else {
          const list = convertList(el, ctx, null, 1);
          if (list) out.push(list);
        }
        pushWithPending(null);
      } else if (el.localName === 'section') {
        const inner = convertBlocks(Array.from(el.children), ctx, kind, boldByDefault);
        const cols = ctx.resolver.sectionColumns(el.getAttributeNS(NS.text, 'style-name'));
        if (kind === 'body' && cols) pushColumnRuns(inner, cols, out, ctx);
        else out.push(...inner);
      } else if (el.localName === 'table-of-content' && kind === 'body') {
        // Generated table of contents → a tableOfContents node (regenerated live).
        out.push(convertToc(el, ctx));
      } else if (/-index$|^table-of-content$|^bibliography$/.test(el.localName)) {
        // Other generated indexes (bibliography, …) or a TOC nested in a cell: keep the
        // rendered text from index-body.
        const indexBody = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
        if (indexBody) out.push(...convertBlocks(Array.from(indexBody.children), ctx, kind, boldByDefault));
      }
      // tracked-changes registry, decls, soft-page-break, … → no visual content
    } else if (el.namespaceURI === NS.table && el.localName === 'table') {
      if (kind === 'body') {
        const table = convertTable(el, ctx);
        if (table) out.push(table);
      } else {
        // The editor (and its export) can't nest tables in cells/list items.
        ctx.warnings.add('Nested tables were flattened to paragraphs');
        out.push(...flattenTable(el, ctx));
      }
    } else if (el.namespaceURI === NS.draw) {
      const conv = convertDrawElement(el, ctx);
      // An image at block level (rare) → wrapped in a paragraph.
      if (conv?.inline) out.push({ type: 'paragraph', content: [conv.inline] });
      else if (conv?.block) {
        ctx.pendingBlocks.push(conv.block);
        pushWithPending(null);
      }
    }
  }
  // A block's own "break after" becomes the next block's break before — the same page
  // break, and the only one the editor stores. A trailing one has nothing left to break,
  // and only a paragraph/heading carries the attr.
  for (let i = 0; i < out.length; i++) {
    if (out[i].attrs?.breakAfter !== 'page') continue;
    delete out[i].attrs!.breakAfter;
    const next = out[i + 1];
    if (next && (next.type === 'paragraph' || next.type === 'heading')) {
      next.attrs = { ...next.attrs, breakBefore: 'page' };
    }
  }
  return out;
}

// A <text:table-of-content> → a tableOfContents node. Entries (text + level + page) are
// parsed from the cached index-body as a starting cache; the node view recomputes page
// numbers live after mount, so parse fidelity isn't critical.
function convertToc(el: Element, ctx: Ctx): Node {
  const indexBody = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
  const entries: { text: string; level: number; page: number }[] = [];
  if (indexBody) {
    for (const p of Array.from(indexBody.children)) {
      if (p.namespaceURI !== NS.text || p.localName !== 'p') continue; // skip index-title
      const style = p.getAttributeNS(NS.text, 'style-name') ?? '';
      const m = /Contents_20_(\d+)/.exec(style);
      const level = m ? Math.min(MAX_HEADING_LEVEL, Math.max(1, parseInt(m[1], 10))) : 1;
      const { text, page } = tocEntryTextAndPage(p);
      if (text) entries.push({ text, level, page: Math.max(1, parseInt(page, 10) || 1) });
    }
  }
  // The file's own heading ("Inhalt", "Sommaire", …), so a reopened index keeps its name.
  // No <text:index-title> means the index really has none — its heading is an ordinary
  // paragraph above it, and adding ours would double it.
  const title = el.getElementsByTagNameNS(NS.text, 'index-title')[0]?.textContent?.trim() ?? '';
  const source = el.getElementsByTagNameNS(NS.text, 'table-of-content-source')[0];
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
  const templates = Array.from(source?.getElementsByTagNameNS(NS.text, 'table-of-content-entry-template') ?? []);
  const template = templates[0];
  const styled = ctx.resolver.tabStops(template?.getAttributeNS(NS.text, 'style-name') ?? null);
  const tabPosCm = lengthToCm(stop?.getAttributeNS(NS.style, 'position'))
    ?? [...styled].reverse().find(t => t.align === 'right')?.pos ?? null;
  // Each level's own paragraph style: the entry rows carry its name, so the document
  // stylesheet gives them the file's indent, spacing and font instead of our defaults.
  const levelStyles: (string | null)[] = [];
  for (const tpl of templates) {
    const level = Number(tpl.getAttributeNS(NS.text, 'outline-level'));
    const named = ctx.resolver.namedAncestor(tpl.getAttributeNS(NS.text, 'style-name'));
    if (!(level >= 1) || !named) continue;
    ctx.usedStyles.add(named);
    levelStyles[level - 1] = ctx.styleNames.get(named) ?? named;
  }
  const attrs: Record<string, unknown> = { entries, title, maxLevel, leader, tabPosCm };
  if (levelStyles.some(Boolean)) attrs.levelStyles = Array.from(levelStyles, (s) => s ?? null);
  return { type: 'tableOfContents', attrs };
}

// Split a TOC entry paragraph around its last <text:tab/>: the text before it is the
// entry text, the run after it is the page number. Tabs contribute no textContent, so
// partition the text nodes by their document position relative to the tab element.
function tocEntryTextAndPage(p: Element): { text: string; page: string } {
  const FOLLOWING = 0x04; // Node.DOCUMENT_POSITION_FOLLOWING (the DOM Node is shadowed here)
  const tabs = p.getElementsByTagNameNS(NS.text, 'tab');
  const lastTab = tabs.length ? tabs[tabs.length - 1] : null;
  let before = '';
  let after = '';
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n: ChildNode | null;
  while ((n = walker.nextNode() as ChildNode | null)) {
    const txt = n.nodeValue ?? '';
    if (lastTab && lastTab.compareDocumentPosition(n) & FOLLOWING) after += txt;
    else before += txt;
  }
  return { text: before.trim(), page: after.trim() };
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
  lineHeight: number;
  boldByDefault: boolean;
  fonts: Set<string>;
  color: string;
  // Marks the style already provides. A run that opts *out* of one can't be expressed
  // (only bold has fontWeight:'normal'), so it keeps the style's rendering.
  // ponytail: per-mark "off" overrides need mark attrs like fontWeight's; add if files need it.
  italic: boolean;
  underline: boolean;
  strike: boolean;
  caps: CapsMode | null;
};

// Metric twins: the on-screen font and the name we declare in files mean the same thing.
const FONT_TWINS: Record<string, string[]> = {
  'times new roman': ['liberation serif'],
  'liberation serif': ['times new roman'],
  arial: ['liberation sans'],
  'liberation sans': ['arial'],
};

// fo:line-height as a factor; null for a length or `normal`, which is not a percentage.
function linePercent(lh: string | undefined): number | null {
  if (!lh || !lh.endsWith('%')) return null;
  const p = parseFloat(lh);
  return Number.isFinite(p) ? Math.round(p) / 100 : null;
}

function blockDefaults(resolver: StyleResolver, named: string | null, headingLevel: number | null, boldByDefault: boolean): BlockDefaults {
  const hdef = headingLevel != null ? HEADING_DEFAULTS[headingLevel - 1] : null;
  const fallback: BlockDefaults = {
    fontSizePt: hdef ? hdef.fontSizePt : BODY_FONT_SIZE_PT,
    marginTopPt: hdef ? hdef.marginTopPt : 0,
    marginBottomPt: hdef ? hdef.marginBottomPt : 0,
    indentPt: 0,
    lineHeight: 1,
    boldByDefault: headingLevel != null || boldByDefault,
    fonts: new Set(headingLevel != null ? DEFAULT_HEADING_FONTS : DEFAULT_FONTS),
    color: '#000000',
    italic: false,
    underline: false,
    strike: false,
    caps: null,
  };
  if (!named) return fallback;
  const para = resolver.paraProps(named);
  const text = resolver.paraTextProps(named);
  const family = resolver.fontFamilyOf(text)?.toLowerCase();
  const fonts = new Set(fallback.fonts);
  if (family) {
    fonts.add(family);
    for (const twin of FONT_TWINS[family] ?? []) fonts.add(twin);
  }
  const weight = text['fo:font-weight'];
  const fontStyle = text['fo:font-style'];
  return {
    fontSizePt: lengthToPt(text['fo:font-size']) ?? fallback.fontSizePt,
    marginTopPt: lengthToPt(para['fo:margin-top']) ?? 0,
    marginBottomPt: lengthToPt(para['fo:margin-bottom']) ?? 0,
    indentPt: lengthToPt(para['fo:margin-left']) ?? 0,
    lineHeight: linePercent(para['fo:line-height']) ?? 1,
    boldByDefault: weight ? weight === 'bold' || parseInt(weight, 10) >= 600 : fallback.boldByDefault,
    fonts,
    color: (text['fo:color'] && normalizeColor(text['fo:color'])) || fallback.color,
    italic: fontStyle === 'italic' || fontStyle === 'oblique',
    underline: !!text['style:text-underline-style'] && text['style:text-underline-style'] !== 'none',
    strike: !!text['style:text-line-through-style'] && text['style:text-line-through-style'] !== 'none',
    caps: capsFromOdf(text),
  };
}

// The inverse of export/odt.ts twinFontName: a declared metric twin reads back as the
// bundled family the editor renders.
function screenFontName(family: string): string {
  if (family === 'Times New Roman') return 'Liberation Serif';
  if (family === 'Arial') return 'Liberation Sans';
  return family;
}

// ODF encodes spaces as _20_; a style:display-name (when present) is authoritative.
function displayStyleName(odfName: string, display?: string): string {
  return display || odfName.replace(/_20_/g, ' ');
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
  // The ODF percentage itself, as everywhere else in the model (blockAttrs, both DOCX
  // paths, and the export, which writes it straight back out as a percentage).
  const lh = props['fo:line-height'];
  if (lh && lh.endsWith('%')) {
    const mult = parseFloat(lh) / 100;
    if (Number.isFinite(mult)) out.lineHeight = String(Math.round(mult * 100) / 100);
  }
  const bg = props['fo:background-color'];
  if (bg && bg !== 'transparent') out.backgroundColor = normalizeColor(bg) ?? undefined;
  for (const [key, side] of [['borderTop', 'top'], ['borderRight', 'right'], ['borderBottom', 'bottom'], ['borderLeft', 'left']] as const) {
    const v = props[`fo:border-${side}`] ?? props['fo:border'];
    if (v && v !== 'none') out[key] = borderAttrFromOdf(v) ?? undefined;
  }
  return out;
}

function textPropsFromOdf(props: PropMap, resolver: StyleResolver): TextProps {
  const out: TextProps = {};
  const family = resolver.fontFamilyOf(props);
  // Our own export declares the metric twin; keep the registry on the on-screen name
  // so an export→import loop doesn't drift.
  if (family) out.fontFamily = screenFontName(family);
  const size = lengthToPt(props['fo:font-size']);
  if (size != null) out.fontSizePt = Math.round(size * 10) / 10;
  const spacing = lengthToPt(props['fo:letter-spacing']);
  if (spacing) out.letterSpacingPt = Math.round(spacing * 100) / 100;
  // Kerning is on unless the file says otherwise (probed), which is the browser default
  // too — so only the "off" is worth carrying.
  if (props['style:letter-kerning'] === 'false') out.kerning = false;
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
      next: builtin?.next ?? null,
      builtin: builtin?.builtin,
      para: ownProps(paraPropsFromOdf(resolver.paraProps(odfName)), paraPropsFromOdf(def.parent ? resolver.paraProps(def.parent) : {})),
      text: ownProps(textPropsFromOdf(resolver.paraTextProps(odfName), resolver), textPropsFromOdf(def.parent ? resolver.paraTextProps(def.parent) : {}, resolver)),
    };
    const level = /^Heading (\d)$/.exec(name);
    if (level) style.outlineLevel = Number(level[1]);
    sheet.paragraph[name] = style;
  }
  for (const odfName of ctx.usedCharStyles) {
    const name = ctx.charStyleNames.get(odfName) ?? odfName;
    const builtin = sheet.character[name];
    sheet.character[name] = {
      name, parent: null, next: null, builtin: builtin?.builtin,
      para: {}, text: textPropsFromOdf(resolver.spanTextProps(odfName), resolver),
    };
  }
  return sheet;
}

// The block's yardstick plus what the run's character style provides.
function charDefaults(ctx: Ctx, base: BlockDefaults, odfName: string): BlockDefaults {
  const props = ctx.resolver.spanTextProps(odfName);
  const family = ctx.resolver.fontFamilyOf(props)?.toLowerCase();
  const fonts = new Set(base.fonts);
  if (family) {
    fonts.add(family);
    for (const twin of FONT_TWINS[family] ?? []) fonts.add(twin);
  }
  const weight = props['fo:font-weight'];
  const fontStyle = props['fo:font-style'];
  return {
    ...base,
    fontSizePt: lengthToPt(props['fo:font-size']) ?? base.fontSizePt,
    boldByDefault: weight ? weight === 'bold' || parseInt(weight, 10) >= 600 : base.boldByDefault,
    fonts,
    color: (props['fo:color'] && normalizeColor(props['fo:color'])) || base.color,
    italic: fontStyle ? fontStyle === 'italic' || fontStyle === 'oblique' : base.italic,
    underline: props['style:text-underline-style'] ? props['style:text-underline-style'] !== 'none' : base.underline,
    strike: props['style:text-line-through-style'] ? props['style:text-line-through-style'] !== 'none' : base.strike,
    caps: capsFromOdf(props) ?? base.caps,
  };
}

function convertParaLike(el: Element, ctx: Ctx, kind: BlockKind, boldByDefault = false): Node {
  const { resolver } = ctx;
  const styleName = el.getAttributeNS(NS.text, 'style-name');
  const paraProps = resolver.paraProps(styleName);
  const baseTextProps = resolver.paraTextProps(styleName);

  const isHeading = el.localName === 'h' && kind !== 'list';
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
  // style instead: the only one re-applied on import.
  const defaults = blockDefaults(resolver, kind === 'body' ? named : null, isHeading ? level : null, boldByDefault);

  const attrs = blockAttrs(paraProps, baseTextProps, defaults, kind);
  // A style:master-page-name switches the page master, which is how ODF gives a section
  // its own header/footer; the block that does it opens that section.
  const master = kind === 'body' ? resolver.masterPageOf(styleName) : null;
  if (master) {
    // Naming a master *is* a page break, even where the page already uses that one
    // (probed) — which is how a book starts every chapter on a fresh page. Only the
    // document's first block has nothing above it to break from.
    if (ctx.masterBlocks.size) attrs.breakBefore = 'page';
    if (ctx.masterPages[ctx.masterPages.length - 1] !== master) {
      ctx.masterPages.push(master);
      attrs.sectionBreak = true;
    }
  }
  // '' = the file's own default master, which the blocks before the first switch use.
  const governing = kind === 'body' ? ctx.masterPages[ctx.masterPages.length - 1] ?? '' : null;
  if (governing != null) ctx.masterBlocks.set(governing, (ctx.masterBlocks.get(governing) ?? 0) + 1);
  // Tab stops live in a child element of the paragraph properties, so they come from
  // the resolver's own walk rather than the flattened paraProps.
  const stops = formatTabStops(resolver.tabStops(styleName));
  if (stops) attrs.tabStops = stops;
  // A run inherits the block's own size (attrs.fontSize below), not the default style's,
  // so that is what it is measured against — else a list item whose style sets 11pt drops
  // every 12pt run as "the style supplies it" and renders them at 11.
  const markSizePt = lengthToPt(baseTextProps['fo:font-size']);
  const runDefaults = markSizePt != null && Math.abs(markSizePt - defaults.fontSizePt) > 0.05
    ? { ...defaults, fontSizePt: markSizePt }
    : defaults;
  const content = convertInline(el, ctx, baseTextProps, runDefaults, false);

  // A box lifted out of a paragraph that held nothing else replaces it in the flow, so
  // it takes that paragraph's own space above and below — resolved, not the direct half:
  // the box carries no style name to inherit the rest from.
  if (kind === 'body' && !content.length && ctx.pendingBlocks.length) {
    const mt = snapPt(lengthToPt(paraProps['fo:margin-top']) ?? 0);
    const mb = snapPt(lengthToPt(paraProps['fo:margin-bottom']) ?? 0);
    for (const b of ctx.pendingBlocks) {
      // A floating box is out of the flow and placed by its own offsets instead.
      const wrap = b.attrs?.wrap;
      if (b.type !== 'textBox' || wrap === 'left' || wrap === 'right') continue;
      if (mt) b.attrs!.spaceBefore = mt;
      if (mb) b.attrs!.spaceAfter = mb;
    }
  }

  // The paragraph style's own font size is the block's line-height floor on every
  // line, not only on an empty one; carry it as a block attr (mirrors the docx
  // paragraph-mark size), or text smaller than the style keeps the taller strut.
  const markSize = lengthToPt(baseTextProps['fo:font-size']);
  if (markSize != null && Math.abs(markSize - defaults.fontSizePt) > 0.05) attrs.fontSize = formatPt(markSize);
  // Keep with next: a heading does that anyway (pageBreaks.ts), so only a plain
  // paragraph carries it — otherwise every heading would accrete the producer's flag.
  if (!isHeading && paraProps['fo:keep-with-next'] === 'always') attrs.keepNext = true;
  if (!isHeading && paraProps['fo:keep-together'] === 'always') attrs.keepLines = true;
  const markFont = resolver.fontFamilyOf(baseTextProps);
  if (markFont && !defaults.fonts.has(markFont.toLowerCase())) attrs.fontFamily = markFont;
  applyUniformRunFont(attrs, content);
  sinkOffsetFrames(content);

  const node: Node = { type: isHeading ? 'heading' : 'paragraph' };
  if (isHeading) attrs.level = level;
  // Only top-level blocks carry a style: list items and cells reference the producer's
  // own plumbing styles (List_20_Bullet, Table_20_Contents), which are not user styles.
  if (named && kind === 'body') {
    const display = ctx.styleNames.get(named) ?? named;
    ctx.usedStyles.add(named);
    if (display !== (isHeading ? `Heading ${level}` : DEFAULT_STYLE)) attrs.styleName = display;
  }
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

// textAlign / lineHeight / spaceBefore / spaceAfter from resolved paragraph
// props, suppressing values that match the editor's defaults for this context.
function blockAttrs(paraProps: PropMap, textProps: PropMap, defaults: BlockDefaults, kind: BlockKind): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  const ta = paraProps['fo:text-align'];
  if (ta === 'center' || ta === 'justify') attrs.textAlign = ta;
  else if (ta === 'right' || ta === 'end') attrs.textAlign = 'right';

  const lh = paraProps['fo:line-height'];
  if (lh && lh !== 'normal') {
    let mult: number | null = null;
    if (lh.endsWith('%')) {
      const p = parseFloat(lh);
      if (Number.isFinite(p)) mult = p / 100;
    } else {
      // Fixed line height: best-effort multiplier against the resolved font size.
      const pt = lengthToPt(lh);
      const fontPt = lengthToPt(textProps['fo:font-size']) ?? defaults.fontSizePt;
      if (pt != null && fontPt > 0) mult = pt / (fontPt * LINE_HEIGHT_RATIO);
    }
    if (mult != null) {
      mult = Math.round(mult * 100) / 100;
      if (Math.abs(mult - defaults.lineHeight) > 0.01) attrs.lineHeight = String(mult);
    }
  }

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
  if (kind !== 'list') {
    const ml = lengthToPt(paraProps['fo:margin-left']) ?? 0;
    if (Math.abs(ml - defaults.indentPt) > EPS_PT) attrs.indent = Math.round((ml / 72) * 2.54 * 100) / 100;
    // fo:text-indent is the first line only; negative is a hanging indent.
    const ti = lengthToCm(paraProps['fo:text-indent']);
    if (ti != null && Math.abs(ti) > 0.02) attrs.indentFirst = Math.round(ti * 100) / 100;
    const mr = lengthToCm(paraProps['fo:margin-right']);
    if (mr != null && mr > 0.02) attrs.indentRight = Math.round(mr * 100) / 100;
  }

  // Manual page break (fo:break-before). Honored for top-level blocks only
  // (pageBreaks.ts forces them to the next page top); the editor has no column
  // breaks, so only "page". Cell/list blocks can't carry it.
  if (kind === 'body' && paraProps['fo:break-before'] === 'page') attrs.breakBefore = 'page';
  // fo:break-after is the same break seen from the block above; convertBlocks moves it
  // onto the next block, which is what the editor can express.
  if (kind === 'body' && paraProps['fo:break-after'] === 'page') attrs.breakAfter = 'page';

  // Widow-orphan control: LibreOffice writes 0 for "off", absent means the XSL-FO
  // default of 2 (on) — so only an explicit 0 disables it.
  if (paraProps['fo:widows'] === '0' || paraProps['fo:orphans'] === '0') attrs.widowControl = false;

  // Paragraph background ("colored field") + per-side borders ("rule line").
  Object.assign(attrs, paraBoxAttrs(paraProps));

  return attrs;
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

// ISO local datetime for the node's `value`: a date-value is kept; a time-value
// (PThHmMsS) is placed on today's date (only its time part is rendered).
function fieldValue(kind: 'date' | 'time', raw: string | null): string {
  if (kind === 'date') {
    const d = raw ? new Date(raw) : null;
    return d && !isNaN(d.getTime()) ? raw! : '';
  }
  const m = raw ? /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(raw) : null;
  if (!m) return '';
  const now = new Date();
  now.setHours(Number(m[1] ?? 0), Number(m[2] ?? 0), Number(m[3] ?? 0), 0);
  return toDateValue(now);
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
  const format = matchFormat(tokens, kind);
  if (!format) return null;
  const fixed = e.getAttributeNS(NS.text, 'fixed') === 'true';
  const raw = e.getAttributeNS(NS.text, 'date-value') ?? e.getAttributeNS(NS.text, 'time-value');
  return { type: 'dateTimeField', attrs: { kind, format, fixed, value: fieldValue(kind, raw) } };
}

// A number style with any calendar token is a date style; hours/minutes → time; else null.
function numberStyleKind(tokens: Token[]): 'date' | 'time' | null {
  if (tokens.some(t => t.t === 'year' || t.t === 'month' || t.t === 'day' || t.t === 'weekday')) return 'date';
  if (tokens.some(t => t.t === 'hour24' || t.t === 'hour12' || t.t === 'minute' || t.t === 'second' || t.t === 'ampm')) return 'time';
  return null;
}

// ---- inline conversion --------------------------------------------------------

function convertInline(root: Element, ctx: Ctx, baseProps: PropMap, defaults: BlockDefaults, hfFields = false): Node[] {
  const out: Node[] = [];

  // The named character style of the enclosing span, if any: its formatting belongs to
  // the style, so the run only keeps what goes beyond it.
  let charStyle: string | null = null;

  const pushText = (text: string, props: PropMap, linkHref?: string) => {
    // Strip our export sentinels (SEG/LBR) defensively — never legitimate text.
    let clean = text.replace(/[-]/g, '');
    if (clean.includes('\n')) {
      // Newlines in ODF text content are formatting whitespace (real breaks
      // are text:line-break): drop whitespace-only nodes, collapse the rest.
      if (!clean.trim()) return;
      clean = clean.replace(/[ \t]*\n[ \t]*/g, ' ');
    }
    if (!clean) return;
    const marks = marksFor(props, ctx.resolver, charStyle ? charDefaults(ctx, defaults, charStyle) : defaults);
    if (charStyle) {
      const display = ctx.charStyleNames.get(charStyle) ?? charStyle;
      ctx.usedCharStyles.add(charStyle);
      marks.push({ type: 'charStyle', attrs: { name: display } });
    }
    if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
    // A mark can hold one bookmark, so overlapping ranges collapse to the outermost.
    // The one-paragraph header/footer schema has no bookmark mark.
    const bookmark = hfFields ? undefined : ctx.openBookmarks.values().next().value;
    if (bookmark) marks.push({ type: 'bookmark', attrs: { name: bookmark } });
    const node: Node = { type: 'text', text: clean };
    if (marks.length) node.marks = marks;
    out.push(node);
  };

  const walk = (el: Element, props: PropMap, linkHref?: string) => {
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 /* text */) {
        pushText(child.nodeValue ?? '', props, linkHref);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const e = child as Element;

      if (e.namespaceURI === NS.text) {
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
            const c = parseInt(e.getAttributeNS(NS.text, 'c') ?? '1', 10);
            pushText(' '.repeat(Number.isFinite(c) && c > 0 ? c : 1), props, linkHref);
            continue;
          }
          case 'tab':
            pushText('\t', props, linkHref);
            continue;
          case 'line-break': {
            // Carry the run's marks so an empty line between two breaks keeps its font size.
            const marks = marksFor(props, ctx.resolver, defaults);
            const br: Node = { type: 'hardBreak' };
            if (marks.length) br.marks = marks;
            out.push(br);
            continue;
          }
          case 'a': {
            // ODF hyperlink → link mark on the contained text; an internal #bookmark
            // href is kept as-is and resolved against the document's bookmarks.
            const href = e.getAttributeNS(NS.xlink, 'href') ?? '';
            walk(e, props, href || linkHref);
            continue;
          }
          case 'note':
            ctx.warnings.add('Footnotes and endnotes were removed');
            continue;
          case 'bookmark-start':
          case 'bookmark-end': {
            // A named range → a bookmark mark on the text it covers. A point bookmark
            // (<text:bookmark/>) has no range to mark, so it is dropped.
            const name = e.getAttributeNS(NS.text, 'name');
            if (name) {
              if (e.localName === 'bookmark-start') ctx.openBookmarks.add(name);
              else ctx.openBookmarks.delete(name);
            }
            continue;
          }
          case 'bookmark-ref': {
            const name = e.getAttributeNS(NS.text, 'ref-name');
            const fmt = e.getAttributeNS(NS.text, 'reference-format');
            // Only the two formats the editor models; any other one (chapter, number,
            // …) keeps the value the file cached.
            // Same for the crossRef node: in a zone the reference stays its shown text.
            if (!hfFields && name && (fmt === 'text' || fmt === 'page')) {
              const field: Node = { type: 'crossRef', attrs: { name, format: fmt, text: e.textContent ?? '' } };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            if (e.textContent) pushText(e.textContent, props, linkHref);
            continue;
          }
          case 'bookmark':
          case 'soft-page-break':
          case 'change':
          case 'change-start':
          case 'change-end':
            continue;
          default:
            // In headers/footers, page fields stay live fields (pageField.ts). The atom
            // carries the run's marks so its digits render in the run's font/size.
            if (hfFields && (e.localName === 'page-number' || e.localName === 'page-count')) {
              const field: Node = { type: e.localName === 'page-count' ? 'pageCount' : 'pageNumber' };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            // The running head's chapter name; text:display="number"/"plain-number" is a
            // numbering we don't track, so those keep the file's cached string.
            if (hfFields && e.localName === 'chapter' && e.getAttributeNS(NS.text, 'display') === 'name') {
              const level = Number(e.getAttributeNS(NS.text, 'outline-level')) || 1;
              const field: Node = { type: 'chapterField', attrs: { level, text: e.textContent ?? '' } };
              const marks = marksFor(props, ctx.resolver, defaults);
              if (marks.length) field.marks = marks;
              out.push(field);
              continue;
            }
            // Date/time fields become live dateTimeField nodes in the body (a known
            // format; falls through to the shown text otherwise). The one-paragraph
            // header/footer schema has no such node, so there they stay text.
            if (!hfFields && (e.localName === 'date' || e.localName === 'time')) {
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
            // Other text fields (title, …) store their evaluated value as element
            // text — keep what the source document showed.
            if (e.textContent) pushText(e.textContent, props, linkHref);
            continue;
        }
      }
      if (e.namespaceURI === NS.draw) {
        const conv = convertDrawElement(e, ctx);
        // The one-paragraph zone flows as-char images; a positioned frame is out of
        // flow — the page-anchored letterhead or watermark a title page is made of —
        // and keeps its wrap plus its position from the page corner. Boxes are dropped.
        if (hfFields) {
          const img = conv?.inline?.type === 'image' ? conv.inline : null;
          const wrap = img?.attrs?.wrap;
          if (img && (!wrap || wrap === 'inline')) {
            out.push({ ...img, attrs: { ...img.attrs, wrap: 'inline' } });
          } else if (img) {
            const at = (a: string) => Math.max(0, lengthToCm(e.getAttributeNS(NS.svg, a)) ?? 0);
            out.push({ ...img, attrs: { ...img.attrs, wrapOffset: at('x'), wrapOffsetY: at('y') } });
          } else if (conv) ctx.warnings.add('Drawings were removed');
          continue;
        }
        if (conv?.inline) out.push(conv.inline);
        else if (conv?.block) ctx.pendingBlocks.push(conv.block);
        continue;
      }
      if (e.namespaceURI === NS.office && e.localName === 'annotation') {
        ctx.warnings.add('Comments were removed');
        continue;
      }
    }
  };

  walk(root, baseProps);
  return mergeAdjacentText(out);
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

function capsFromOdf(props: PropMap): CapsMode | null {
  if (props['fo:font-variant'] === 'small-caps') return 'smallCaps';
  const t = props['fo:text-transform'];
  return t === 'uppercase' || t === 'lowercase' || t === 'capitalize' ? t : null;
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
  if (ul && ul !== 'none' && !defaults.underline) {
    const line = lineAttrs(ul, props['style:text-underline-type'], props['style:text-underline-color']);
    marks.push(line ? { type: 'underline', attrs: line } : { type: 'underline' });
  }
  const lt = props['style:text-line-through-style'];
  if (lt && lt !== 'none' && !defaults.strike) {
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

  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });
  return marks;
}

function formatPt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r}pt`;
}

// ---- lists -----------------------------------------------------------------------

// The heading elements of a <text:list> whose leaves are all headings (each list-item
// holds only a text:h and/or nested such lists) — ODF outline/chapter numbering, not a
// real list, so they import as plain headings. null when it's a genuine list.
function outlineHeadingEls(listEl: Element): Element[] | null {
  const out: Element[] = [];
  for (const item of Array.from(listEl.children)) {
    if (item.namespaceURI !== NS.text || (item.localName !== 'list-item' && item.localName !== 'list-header')) continue;
    for (const child of Array.from(item.children)) {
      if (child.namespaceURI !== NS.text) return null;
      if (child.localName === 'h') {
        out.push(child);
      } else if (child.localName === 'list') {
        const nested = outlineHeadingEls(child);
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
function convertList(el: Element, ctx: Ctx, inheritedStyleName: string | null, depth: number, govMultilevel = false, baseCycle: OrderedCycle = ROOT_ORDERED_CYCLE): Node | null {
  const styleName = el.getAttributeNS(NS.text, 'style-name') ?? inheritedStyleName;
  const levelDef = listLevelDef(ctx.resolver.listStyle(styleName), depth);
  const ordered = levelDef?.localName === 'list-level-style-number';
  const displayLevels = parseInt(levelDef?.getAttributeNS(NS.text, 'display-levels') ?? '1', 10);
  // A multilevel top shows plain numbers itself — detect it from its level-2 def.
  const isMultilevelTop = ordered && depth === 1
    && parseInt(listLevelDef(ctx.resolver.listStyle(styleName), 2)?.getAttributeNS(NS.text, 'display-levels') ?? '1', 10) > 1;
  const inChain = ordered && (isMultilevelTop || displayLevels > 1);
  // This list's rendered numbering re-anchors its children's default cycle (slot + suffix).
  const renderedKey = ordered && !inChain
    ? orderedTypeFromFormat(levelDef!.getAttributeNS(NS.style, 'num-format'), levelDef!.getAttributeNS(NS.style, 'num-suffix'))
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
        blocks.push(convertParaLike(child, ctx, 'list'));
      } else if (child.namespaceURI === NS.text && child.localName === 'list') {
        const nested = convertList(child, ctx, styleName, depth + 1, inChain, childBaseCycle);
        if (nested) blocks.push(nested);
      } else if (child.namespaceURI === NS.table && child.localName === 'table') {
        ctx.warnings.add('Nested tables were flattened to paragraphs');
        blocks.push(...flattenTable(child, ctx));
      }
    }
    // listItem requires a leading paragraph (e.g. an item holding only a sub-list).
    if (blocks[0]?.type !== 'paragraph') blocks.unshift({ type: 'paragraph' });
    items.push({ type: 'listItem', content: blocks });
  }
  if (items.length === 0) return null;

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
    const raw = levelDef?.getAttributeNS(NS.text, 'bullet-char') ?? null;
    const bulletChar = bulletCharAttr(bulletCharFromOdf(raw, listLevelFontName(levelDef)), depth - 1);
    const attrs: Record<string, unknown> = {};
    if (bulletChar) attrs.bulletChar = bulletChar;
    if (indent != null) attrs.indent = indent;
    if (listLevelRightAligned(levelDef)) attrs.markerAlign = 'right';
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
  if (listStyleType) attrs.listStyleType = listStyleType;
  if (indent != null) attrs.indent = indent;
  if (listLevelRightAligned(levelDef)) attrs.markerAlign = 'right';
  const node: Node = { type: 'orderedList', content: items };
  if (Object.keys(attrs).length) node.attrs = attrs;
  return node;
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
    else if (part.startsWith('#')) color = normalizeColor(part) ?? part;
    else styleTok = part;
  }
  if (styleTok === 'none' || styleTok === 'hidden') return 'none';
  if (widthPt != null && widthPt <= 0) return 'none';
  const w = Math.round((widthPt ?? 0.5) * 100) / 100;
  const c = (color ?? '#000000').toUpperCase();
  if (treatDefaultAsNull && Math.abs(w - 0.5) < 0.11 && c === '#000000') return null;
  return `${w}pt solid ${c}`;
}

function convertTable(el: Element, ctx: Ctx): Node | null {
  const weights = columnWeights(el, ctx.resolver);

  const rows: Node[] = [];
  let cellPad: CellPadding | null | undefined;
  const addRow = (rowEl: Element, header: boolean) => {
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
      // ODF has no table-level cell margin — it sits on each cell's style, so the first
      // cell's stands for the table and any cell that disagrees keeps its own.
      // fo:padding defaults to 0 in ODF, so a side nobody declares really is zero —
      // leaving it open would hand the cell Word's implicit 0.19cm instead (probed:
      // LibreOffice sets an unstyled cell's text flush against the column edge).
      const padSides = ctx.resolver.cellPadding(cellStyleName).map((v) => v ?? 0);
      if (cellPad === undefined) cellPad = cellPaddingAttr(padSides);
      const ownPad = cellPaddingAttr(padSides, cellPad ?? DEFAULT_CELL_PADDING);
      const verticalAlign = ctx.resolver.cellVerticalAlign(cellStyleName);
      const rawBg = ctx.resolver.cellBackgroundColor(cellStyleName);
      const backgroundColor = rawBg ? normalizeColor(rawBg) ?? rawBg : null;
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
      // Header-shaded cells render bold by default (CSS); convert their runs like headings
      // so a baked-bold run needs no mark and only an explicitly normal run gets one.
      const blocks = convertBlocks(Array.from(cellEl.children), ctx, 'cell', backgroundColor === HEADER_SHADE);
      for (let r = 0; r < repeated; r++) {
        const attrs: Record<string, unknown> = { colspan, rowspan, ...borders };
        if (ownPad) attrs.cellPadding = ownPad;
        if (backgroundColor) attrs.backgroundColor = backgroundColor;
        if (verticalAlign) attrs.verticalAlign = verticalAlign;
        if (weights) attrs.colwidth = weights.slice(colIndex, colIndex + colspan);
        cells.push({
          type: header ? 'tableHeader' : 'tableCell',
          attrs,
          content: blocks.length ? structuredClone(blocks) : [{ type: 'paragraph' }],
        });
        colIndex += colspan;
      }
    }
    if (cells.length === 0) return;

    const row: Node = { type: 'tableRow', content: cells };
    const heightCm = ctx.resolver.rowMinHeightCm(rowEl.getAttributeNS(NS.table, 'style-name'));
    if (heightCm != null && heightCm > 0) row.attrs = { rowHeight: Math.round(heightCm * PX_PER_CM) };
    rows.push(row);
  };

  for (const child of Array.from(el.children)) {
    if (child.namespaceURI !== NS.table) continue;
    if (child.localName === 'table-row') addRow(child, false);
    else if (child.localName === 'table-header-rows' || child.localName === 'table-rows') {
      const header = child.localName === 'table-header-rows';
      for (const rowEl of Array.from(child.children)) {
        if (rowEl.namespaceURI === NS.table && rowEl.localName === 'table-row') addRow(rowEl, header);
      }
    }
  }

  if (rows.length === 0) return null;
  // The named table style behind the automatic one. ODF stores no banding, so only the
  // name comes back — the look rides on the cell attrs above, and the editor re-derives
  // the regions from the registry (refreshTableStyles).
  const named = ctx.resolver.namedAncestor(el.getAttributeNS(NS.table, 'style-name'), 'table');
  const attrs: Record<string, unknown> = { ...(tableMargins(el, ctx) ?? {}), ...tableSpacing(el, ctx) };
  if (cellPad) attrs.cellPadding = cellPad;
  // The default is to allow a break, so only the explicit "no" is worth an attr.
  if (ctx.resolver.tableProps(el.getAttributeNS(NS.table, 'style-name'))['style:may-break-between-rows'] === 'false') {
    attrs.keepRows = true;
  }
  if (named) {
    attrs.tableStyle = displayStyleName(named);
    // Which conditional areas the table opts into (ODF's table template attributes).
    // Absent ⇒ leave the attr null, so parseTableLook falls back to the default.
    const look = odfTableLook(el);
    if (look) attrs.tableLook = look;
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
function tableMargins(el: Element, ctx: Ctx): { marginLeft: number; marginRight: number } | null {
  const props = ctx.resolver.tableProps(el.getAttributeNS(NS.table, 'style-name'));
  const content = ctx.contentWidthCm;
  const rel = parseFloat(props['style:rel-width'] ?? '');
  const width = lengthToCm(props['style:width'])
    ?? (Number.isFinite(rel) && rel > 0 ? (Math.min(rel, 100) / 100) * content : null);

  let left = lengthToCm(props['fo:margin-left']);
  let right = lengthToCm(props['fo:margin-right']);
  if (left == null && width != null) {
    const align = props['table:align'];
    left = align === 'center' ? (content - width) / 2 : align === 'right' ? content - width : 0;
  }
  left = Math.max(0, left ?? 0);
  if (right == null) right = width != null ? content - left - width : 0;
  right = Math.max(0, right);

  // Rounding noise from the producer, or a table that would be left with no room.
  if (left < 0.05 && right < 0.05) return null;
  if (left + right > content - 1) return null;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return { marginLeft: round2(left), marginRight: round2(right) };
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

// Salvage a nested table's text: its cells' blocks, in reading order. Walks
// direct rows only — deeper tables recurse through convertBlocks again.
function flattenTable(el: Element, ctx: Ctx): Node[] {
  const out: Node[] = [];
  const walkRows = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child.namespaceURI !== NS.table) continue;
      if (child.localName === 'table-row') {
        for (const cellEl of Array.from(child.children)) {
          if (cellEl.namespaceURI === NS.table && cellEl.localName === 'table-cell') {
            out.push(...convertBlocks(Array.from(cellEl.children), ctx, 'cell'));
          }
        }
      } else if (child.localName === 'table-header-rows' || child.localName === 'table-rows') {
        walkRows(child);
      }
    }
  };
  walkRows(el);
  return out;
}
