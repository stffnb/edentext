import { unzipSync, strFromU8 } from 'fflate';
import { StyleResolver, NS, lengthToPt, lengthToCm, layerTextProps, type PropMap } from './styleResolver';
import { HEADING_STYLE_OVERRIDES, normalizeColor } from '../export/odt';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { orderedTypeFromFormat, orderedTypeAttrAt, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { bulletCharAttr, bulletCharFromOdf } from '../utils/bulletListTypes';
import { PX_PER_CM, cmToPx, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { languageFromOdf, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
import type { HfDoc } from '../storage/headerFooter';

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
  // Single-paragraph docs in the hfExtensions schema; null = no zone.
  header: HfDoc;
  footer: HfDoc;
  // Edge→zone distance (cm): header from top, footer from bottom. null = no zone.
  headerDistanceCm: number | null;
  footerDistanceCm: number | null;
  // Document spell-check language; NO_LANGUAGE when the file's language has no
  // bundled dictionary; null when the file declares none.
  language: DocumentLanguage | null;
  warnings: string[];
}

// 'list' zeroes the default bottom margin (export rewrites List_20_* to 0cm to
// match the editor); body/cell paragraphs default to Standard's 0.212cm.
type BlockKind = 'body' | 'list' | 'cell';

// `files` is the full unzipped archive so image converters can read Pictures/
// binaries; imageCache dedupes repeated hrefs into one data-URI. pendingBlocks is
// the side channel for text boxes/shapes found while converting inline content —
// they are block nodes, so convertBlocks flushes them after the anchor paragraph.
type Ctx = {
  resolver: StyleResolver;
  warnings: Set<string>;
  files: Record<string, Uint8Array>;
  imageCache: Map<string, string>;
  pendingBlocks: Node[];
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000; // chunk so String.fromCharCode doesn't blow the call stack
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Read a Pictures/ entry from the archive into a base64 data-URI (mime by extension).
function loadImageDataUrl(href: string, ctx: Ctx): string | null {
  const cached = ctx.imageCache.get(href);
  if (cached) return cached;
  const bytes = ctx.files[href];
  if (!bytes) return null;
  const ext = href.split('.').pop()?.toLowerCase() ?? '';
  const url = `data:${MIME_BY_EXT[ext] ?? 'image/png'};base64,${bytesToBase64(bytes)}`;
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

// Set rotation + wrap attrs shared by images, text boxes and shapes. A non-as-char
// anchor or an explicit style:wrap makes the element floating (free x/y positions
// collapse to the nearest side — the editor's anchor-float model). An explicit
// as-char anchor is always inline: LibreOffice's named Graphics style carries a
// style:wrap that would otherwise float every inherited as-char frame.
function applyFrameRotationAndWrap(el: Element, attrs: Record<string, unknown>, gp: PropMap): void {
  const deg = frameRotationDeg(el);
  if (deg) attrs.rotation = deg;
  const anchor = el.getAttributeNS(NS.text, 'anchor-type');
  if (anchor === 'as-char') return;
  const wrapVal = gp['style:wrap'];
  if (anchor || wrapVal) {
    attrs.wrap = wrapModeFromOdf(wrapVal, gp['style:horizontal-pos']);
  }
}

// A <draw:frame><draw:image> → an image node. Size comes from the frame's svg
// geometry (cm → px). as-char frames stay inline; paragraph/page-anchored frames
// with a wrap become floating (wrap mode + svg:x/svg:y position).
function convertFrame(frame: Element, ctx: Ctx): Node | null {
  const image = frame.getElementsByTagNameNS(NS.draw, 'image')[0];
  if (!image) return null;
  const href = (image.getAttributeNS(NS.xlink, 'href') ?? '').replace(/^\.\//, '');
  if (!href) return null;
  const src = loadImageDataUrl(href, ctx);
  if (!src) {
    ctx.warnings.add('Some images could not be read and were skipped');
    return null;
  }
  const attrs: Record<string, unknown> = { src };
  const wCm = lengthToCm(frame.getAttributeNS(NS.svg, 'width'));
  const hCm = lengthToCm(frame.getAttributeNS(NS.svg, 'height'));
  if (wCm != null) attrs.width = Math.round(cmToPx(wCm));
  if (hCm != null) attrs.height = Math.round(cmToPx(hCm));
  const title = frame.getElementsByTagNameNS(NS.svg, 'title')[0]?.textContent;
  if (title) attrs.alt = title;
  applyFrameRotationAndWrap(frame, attrs, ctx.resolver.graphicProps(frame.getAttributeNS(NS.draw, 'style-name')));
  return { type: 'image', attrs };
}

// Fill/stroke attrs from a shape's graphic style, suppressing the editor defaults
// (white fill, 1pt black stroke). Absent/none → explicit null (transparent/no border),
// since omitting the attr would re-apply the default.
function shapeStyleAttrs(gp: PropMap, attrs: Record<string, unknown>): void {
  const fillColor = gp['draw:fill'] === 'solid' ? normalizeColor(gp['draw:fill-color'] ?? '') ?? null : null;
  if (fillColor !== '#FFFFFF') attrs.fillColor = fillColor;
  const strokeColor = gp['draw:stroke'] && gp['draw:stroke'] !== 'none'
    ? normalizeColor(gp['svg:stroke-color'] ?? '#000000') ?? '#000000'
    : null;
  if (strokeColor !== '#000000') attrs.strokeColor = strokeColor;
  if (strokeColor) {
    const widthPt = lengthToPt(gp['svg:stroke-width']);
    if (widthPt != null && Math.abs(widthPt - 1) > 0.1) {
      attrs.strokeWidthPt = Math.round(widthPt * 100) / 100;
    }
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
  if (wCm != null) attrs.width = Math.round(cmToPx(wCm));
  const hCm = lengthToCm(textBoxEl.getAttributeNS(NS.fo, 'min-height'))
    ?? lengthToCm(frame.getAttributeNS(NS.svg, 'height'));
  if (hCm != null) attrs.height = Math.round(cmToPx(hCm));
  const gp = ctx.resolver.graphicProps(frame.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(frame, attrs, gp);
  shapeStyleAttrs(gp, attrs);
  return { type: 'textBox', attrs, content: textBoxContent(Array.from(textBoxEl.children), ctx) };
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
  if (wCm != null) attrs.width = Math.round(cmToPx(wCm));
  if (hCm != null) attrs.height = Math.round(cmToPx(hCm));
  const gp = ctx.resolver.graphicProps(el.getAttributeNS(NS.draw, 'style-name'));
  applyFrameRotationAndWrap(el, attrs, gp);
  shapeStyleAttrs(gp, attrs);
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
  ctx.warnings.add('Drawings were removed');
  return null;
}

// ---- editor defaults to suppress on import -----------------------------------

const BODY_FONT_SIZE_PT = 12;
// Standard paragraph style's fo:margin-bottom as odf-kit emits it.
const STD_MARGIN_BOTTOM_PT = lengthToPt('0.212cm')!;
// Match LO/Word producer rounding noise (cm: ≤0.014pt, twips: ≤0.025pt), not
// genuine user values.
const EPS_PT = 0.15;

const HEADING_DEFAULTS = HEADING_STYLE_OVERRIDES.map(h => ({
  fontSizePt: lengthToPt(h.fontSize)!,
  marginTopPt: lengthToPt(h.marginTop)!,
  marginBottomPt: lengthToPt(h.marginBottom)!,
}));

// The editor's on-screen default (Liberation Serif) and what the export declares
// in its place (Times New Roman) — both mean "default font", so no mark.
const DEFAULT_FONTS = new Set(['times new roman', 'liberation serif']);

// ODF line spacing multiplies the font's natural line height; see lineHeight.ts.
const LINE_HEIGHT_RATIO = 1.15;

// odf-kit emits each list level at margin-left = level × 1.27cm (label-alignment).
// A top-level list's margin beyond this level-1 base is its whole-list indent.
const LIST_BASE_MARGIN_CM = 1.27;
const LIST_INDENT_EPS_CM = 0.05;

// ---- entry --------------------------------------------------------------------

export function importOdt(bytes: Uint8Array): OdtImportResult {
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

  const ctx: Ctx = { resolver, warnings, files, imageCache: new Map(), pendingBlocks: [] };
  let blocks = convertBlocks(Array.from(body.children), ctx, 'body');
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });

  // Whole-document columns declared on the page layout (Word-style) instead of a
  // text:section: wrap the body's wrappable runs the way a section would be.
  const pageCols = resolver.pageColumns();
  if (pageCols) {
    const wrapped: Node[] = [];
    pushColumnRuns(blocks, pageCols, wrapped, ctx);
    blocks = wrapped;
  }

  const hf = resolver.masterPageHF();
  if (hf.hasVariants) {
    warnings.add('Per-page header/footer variants (first/even pages) are not supported — the default one was used');
  }

  const geometry = resolver.pageGeometry();
  const edge = resolver.edgeDistancesCm();

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

  return {
    content: { type: 'doc', content: blocks },
    margins: geometry?.margins ?? null,
    orientation: geometry?.orientation ?? null,
    header: hf.header ? convertHfZone(hf.header, ctx) : null,
    footer: hf.footer ? convertHfZone(hf.footer, ctx) : null,
    headerDistanceCm: hf.header ? edge?.top ?? null : null,
    footerDistanceCm: hf.footer ? edge?.bottom ?? null : null,
    language,
    warnings: [...warnings],
  };
}

// A header/footer zone → one single-paragraph doc (hfExtensions schema). Multiple
// paragraphs collapse to hard line breaks; block structures flatten to their text.
function convertHfZone(zoneEl: Element, ctx: Ctx): HfDoc {
  const inline: Node[] = [];
  let textAlign: string | null = null;

  const addPara = (p: Element) => {
    if (inline.length) inline.push({ type: 'hardBreak' });
    const styleName = p.getAttributeNS(NS.text, 'style-name');
    if (textAlign === null) {
      const ta = ctx.resolver.paraProps(styleName)['fo:text-align'] ?? '';
      textAlign = ta === 'center' || ta === 'justify' ? ta : ta === 'right' || ta === 'end' ? 'right' : null;
      if (textAlign === null) textAlign = ''; // only the first paragraph decides
    }
    inline.push(...convertInline(p, ctx, ctx.resolver.paraTextProps(styleName), null, true));
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
  // Trim leading/trailing breaks from empty source paragraphs.
  while (inline[0]?.type === 'hardBreak') inline.shift();
  while (inline[inline.length - 1]?.type === 'hardBreak') inline.pop();
  if (inline.length === 0) return null;

  const para: Node = { type: 'paragraph', content: inline };
  if (textAlign) para.attrs = { textAlign };
  return { type: 'doc', content: [para] };
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
  // ctx.pendingBlocks). In the body they follow the anchor at top level — and an
  // empty anchor (our own export's wrapper paragraph) is dropped; elsewhere (cells,
  // other boxes) their blocks are unwrapped in place.
  const pushWithPending = (anchor: Node | null) => {
    const pending = ctx.pendingBlocks.splice(0);
    const anchorIsEmpty = anchor?.type === 'paragraph' && !anchor.content?.length;
    if (anchor && !(pending.length && anchorIsEmpty)) out.push(anchor);
    if (!pending.length) return;
    if (kind === 'body') {
      out.push(...pending);
    } else {
      ctx.warnings.add('Text boxes nested in table cells or other text boxes were flattened');
      for (const box of pending) out.push(...(box.content ?? [{ type: 'paragraph' }]));
    }
  };

  for (const el of elements) {
    if (el.namespaceURI === NS.text) {
      if (el.localName === 'p' || el.localName === 'h') {
        pushWithPending(convertParaLike(el, ctx, kind, boldByDefault));
      } else if (el.localName === 'list') {
        const list = convertList(el, ctx, null, 1);
        if (list) out.push(list);
        pushWithPending(null);
      } else if (el.localName === 'section') {
        const inner = convertBlocks(Array.from(el.children), ctx, kind, boldByDefault);
        const cols = ctx.resolver.sectionColumns(el.getAttributeNS(NS.text, 'style-name'));
        if (kind === 'body' && cols) pushColumnRuns(inner, cols, out, ctx);
        else out.push(...inner);
      } else if (el.localName === 'table-of-content' && kind === 'body') {
        // Generated table of contents → a tableOfContents node (regenerated live).
        out.push(convertToc(el));
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
  return out;
}

// A <text:table-of-content> → a tableOfContents node. Entries (text + level + page) are
// parsed from the cached index-body as a starting cache; the node view recomputes page
// numbers live after mount, so parse fidelity isn't critical.
function convertToc(el: Element): Node {
  const indexBody = el.getElementsByTagNameNS(NS.text, 'index-body')[0];
  const entries: { text: string; level: number; page: number }[] = [];
  if (indexBody) {
    for (const p of Array.from(indexBody.children)) {
      if (p.namespaceURI !== NS.text || p.localName !== 'p') continue; // skip index-title
      const style = p.getAttributeNS(NS.text, 'style-name') ?? '';
      const m = /Contents_20_(\d+)/.exec(style);
      const level = m ? Math.min(3, Math.max(1, parseInt(m[1], 10))) : 1;
      const { text, page } = tocEntryTextAndPage(p);
      if (text) entries.push({ text, level, page: Math.max(1, parseInt(page, 10) || 1) });
    }
  }
  return { type: 'tableOfContents', attrs: { entries } };
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

function convertParaLike(el: Element, ctx: Ctx, kind: BlockKind, boldByDefault = false): Node {
  const { resolver } = ctx;
  const styleName = el.getAttributeNS(NS.text, 'style-name');
  const paraProps = resolver.paraProps(styleName);
  const baseTextProps = resolver.paraTextProps(styleName);

  const isHeading = el.localName === 'h' && kind !== 'list';
  let level = 1;
  if (isHeading) {
    const raw = parseInt(el.getAttributeNS(NS.text, 'outline-level') ?? '1', 10);
    level = Math.min(3, Math.max(1, Number.isFinite(raw) ? raw : 1));
  }

  const attrs = blockAttrs(paraProps, baseTextProps, isHeading ? level : null, kind);
  const content = convertInline(el, ctx, baseTextProps, isHeading ? level : null, false, boldByDefault);

  // An empty line has no runs, so its height comes from the paragraph style's own
  // font size; carry it as a block attr (mirrors the docx paragraph-mark size).
  if (content.length === 0) {
    const sizePt = lengthToPt(baseTextProps['fo:font-size']);
    const defSize = isHeading ? HEADING_DEFAULTS[level - 1].fontSizePt : BODY_FONT_SIZE_PT;
    if (sizePt != null && Math.abs(sizePt - defSize) > 0.05) attrs.fontSize = formatPt(sizePt);
  }

  const node: Node = { type: isHeading ? 'heading' : 'paragraph' };
  if (isHeading) attrs.level = level;
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

// textAlign / lineHeight / spaceBefore / spaceAfter from resolved paragraph
// props, suppressing values that match the editor's defaults for this context.
function blockAttrs(paraProps: PropMap, textProps: PropMap, headingLevel: number | null, kind: BlockKind): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  const hdef = headingLevel != null ? HEADING_DEFAULTS[headingLevel - 1] : null;

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
      const fontPt = lengthToPt(textProps['fo:font-size']) ?? hdef?.fontSizePt ?? BODY_FONT_SIZE_PT;
      if (pt != null && fontPt > 0) mult = pt / (fontPt * LINE_HEIGHT_RATIO);
    }
    if (mult != null) {
      mult = Math.round(mult * 100) / 100;
      if (Math.abs(mult - 1) > 0.01) attrs.lineHeight = String(mult);
    }
  }

  const defTop = hdef ? hdef.marginTopPt : 0;
  const defBottom = hdef ? hdef.marginBottomPt : kind === 'list' ? 0 : STD_MARGIN_BOTTOM_PT;
  // An unspecified fo:margin is ODF's default of 0 (not the editor's 6pt body
  // default), so a foreign paragraph that omits it gets 0 spacing like
  // Word/LibreOffice. Editor exports write the margins explicitly, so suppressed.
  const mt = lengthToPt(paraProps['fo:margin-top']) ?? 0;
  const mb = lengthToPt(paraProps['fo:margin-bottom']) ?? 0;
  if (Math.abs(mt - defTop) > EPS_PT) attrs.spaceBefore = snapPt(mt);
  if (Math.abs(mb - defBottom) > EPS_PT) attrs.spaceAfter = snapPt(mb);

  // Left indent → fo:margin-left (cm). Skip lists: their indent lives in the
  // list-style level properties, not paraProps. Default 0 is suppressed.
  if (kind !== 'list') {
    const ml = lengthToPt(paraProps['fo:margin-left']);
    if (ml != null && ml > EPS_PT) attrs.indent = Math.round((ml / 72) * 2.54 * 100) / 100;
  }

  // Manual page break (fo:break-before). Honored for top-level blocks only
  // (pageBreaks.ts forces them to the next page top); the editor has no column
  // breaks, so only "page". Cell/list blocks can't carry it.
  if (kind === 'body' && paraProps['fo:break-before'] === 'page') attrs.breakBefore = 'page';

  return attrs;
}

// Round to 2 decimals; snap to the integer when within producer rounding noise
// (6pt → LO's 0.212cm → 6.0094pt → 6).
function snapPt(v: number): number {
  const r = Math.round(v * 100) / 100;
  const i = Math.round(r);
  return Math.abs(r - i) <= 0.03 ? i : r;
}

// ---- inline conversion --------------------------------------------------------

function convertInline(root: Element, ctx: Ctx, baseProps: PropMap, headingLevel: number | null, hfFields = false, boldByDefault = false): Node[] {
  const out: Node[] = [];

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
    const marks = marksFor(props, ctx.resolver, headingLevel, boldByDefault);
    if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
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
          case 'span':
            walk(e, layerTextProps(props, ctx.resolver.spanTextProps(e.getAttributeNS(NS.text, 'style-name'))), linkHref);
            continue;
          case 's': {
            const c = parseInt(e.getAttributeNS(NS.text, 'c') ?? '1', 10);
            pushText(' '.repeat(Number.isFinite(c) && c > 0 ? c : 1), props, linkHref);
            continue;
          }
          case 'tab':
            pushText('\t', props, linkHref);
            continue;
          case 'line-break':
            out.push({ type: 'hardBreak' });
            continue;
          case 'a': {
            // ODF hyperlink → link mark on the contained text (internal #bookmark
            // links are kept as-is though the editor has no bookmark targets).
            const href = e.getAttributeNS(NS.xlink, 'href') ?? '';
            walk(e, props, href || linkHref);
            continue;
          }
          case 'note':
            ctx.warnings.add('Footnotes and endnotes were removed');
            continue;
          case 'bookmark':
          case 'bookmark-start':
          case 'bookmark-end':
          case 'soft-page-break':
          case 'change':
          case 'change-start':
          case 'change-end':
            continue;
          default:
            // In headers/footers, page fields stay live fields (pageField.ts).
            if (hfFields && e.localName === 'page-number') {
              out.push({ type: 'pageNumber' });
              continue;
            }
            if (hfFields && e.localName === 'page-count') {
              out.push({ type: 'pageCount' });
              continue;
            }
            // Other text fields (date, title, …) store their evaluated value as
            // element text — keep what the source document showed.
            if (e.textContent) pushText(e.textContent, props, linkHref);
            continue;
        }
      }
      if (e.namespaceURI === NS.draw) {
        // The one-paragraph header/footer schema can't hold images or boxes.
        if (hfFields) {
          ctx.warnings.add('Drawings were removed');
          continue;
        }
        const conv = convertDrawElement(e, ctx);
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

function marksFor(props: PropMap, resolver: StyleResolver, headingLevel: number | null, boldByDefault = false): Mark[] {
  const marks: Mark[] = [];
  const textStyle: Record<string, unknown> = {};

  const weight = props['fo:font-weight'];
  const bold = weight ? weight === 'bold' || parseInt(weight, 10) >= 600 : null;
  // Headings and header-row cells render bold by default (CSS): only a *non*-bold run
  // needs a mark (fontWeight:normal), and a bold run needs none.
  if (headingLevel != null || boldByDefault) {
    if (bold === false) textStyle.fontWeight = 'normal';
  } else if (bold === true) {
    marks.push({ type: 'bold' });
  }

  const fs = props['fo:font-style'];
  if (fs === 'italic' || fs === 'oblique') marks.push({ type: 'italic' });
  const ul = props['style:text-underline-style'];
  if (ul && ul !== 'none') marks.push({ type: 'underline' });
  const lt = props['style:text-line-through-style'];
  if (lt && lt !== 'none') marks.push({ type: 'strike' });

  // "super 58%" / "sub" / bare percentage (positive = raised, negative = lowered).
  const pos = props['style:text-position'];
  if (pos) {
    if (pos.startsWith('super')) marks.push({ type: 'superscript' });
    else if (pos.startsWith('sub')) marks.push({ type: 'subscript' });
    else {
      const p = parseFloat(pos);
      if (p > 0) marks.push({ type: 'superscript' });
      else if (p < 0) marks.push({ type: 'subscript' });
    }
  }

  const bg = props['fo:background-color'];
  if (bg && bg !== 'transparent') {
    const c = normalizeColor(bg);
    if (c) marks.push({ type: 'highlight', attrs: { color: c } });
  }

  const color = props['fo:color'] ? normalizeColor(props['fo:color']) : undefined;
  // Pure black is the theme default; an explicit mark would fight dark/allBlack.
  if (color && color !== '#000000') textStyle.color = color;

  const sizePt = lengthToPt(props['fo:font-size']);
  const defSize = headingLevel != null ? HEADING_DEFAULTS[headingLevel - 1].fontSizePt : BODY_FONT_SIZE_PT;
  if (sizePt != null && Math.abs(sizePt - defSize) > 0.05) textStyle.fontSize = formatPt(sizePt);

  const family = resolver.fontFamilyOf(props);
  if (family && !DEFAULT_FONTS.has(family.toLowerCase())) textStyle.fontFamily = family;

  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });
  return marks;
}

function formatPt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r}pt`;
}

// ---- lists -----------------------------------------------------------------------

// `inheritedStyleName`: nested text:list elements usually carry no style-name of
// their own — the outermost list's style governs, with one level def per depth.
// `govMultilevel`: this list sits inside a multilevel (display-levels) chain, so an
// explicit numbering here must never be suppressed to null (null = rejoin the chain).
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

  // Whole-list indent (top level only): margin beyond the level-1 base. Nested
  // lists inherit it visually through DOM nesting, so only depth 1 carries it.
  let indent: number | null = null;
  if (depth === 1) {
    const mlCm = listLevelMarginLeftCm(levelDef);
    if (mlCm != null) {
      const extra = Math.round((mlCm - LIST_BASE_MARGIN_CM) * 100) / 100;
      if (extra > LIST_INDENT_EPS_CM) indent = extra;
    }
  }

  if (!ordered) {
    const raw = levelDef?.getAttributeNS(NS.text, 'bullet-char') ?? null;
    const bulletChar = bulletCharAttr(bulletCharFromOdf(raw, listLevelFontName(levelDef)), depth - 1);
    const attrs: Record<string, unknown> = {};
    if (bulletChar) attrs.bulletChar = bulletChar;
    if (indent != null) attrs.indent = indent;
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
  const node: Node = { type: 'orderedList', content: items };
  if (Object.keys(attrs).length) node.attrs = attrs;
  return node;
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

// ODF border ("0.5pt solid #000000" / "none" / absent) → border attr value: null for
// the editor default (0.5pt black, tolerance for producer unit rounding), 'none' for
// no border, else the canonical '<W>pt solid #RRGGBB'. Non-solid styles are coerced
// to solid (the editor only renders solid lines).
export function borderAttrFromOdf(raw: string | null | undefined): string | null {
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
  if (Math.abs(w - 0.5) < 0.11 && c === '#000000') return null;
  return `${w}pt solid ${c}`;
}

function convertTable(el: Element, ctx: Ctx): Node | null {
  const weights = columnWeights(el, ctx.resolver);

  const rows: Node[] = [];
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
        if (backgroundColor) attrs.backgroundColor = backgroundColor;
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

  return rows.length ? { type: 'table', content: rows } : null;
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
