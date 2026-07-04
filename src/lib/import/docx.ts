import { unzipSync, strFromU8 } from 'fflate';
import { DocxStyles, parseRunProps, mergeRunProps, readNumPr, wVal, W, R, WP, A, WPS, MC, VML, PKG_REL, type RunProps } from './docxStyles';
import { lengthToPt } from './styleResolver';
import { HEADING_STYLE_OVERRIDES, normalizeColor } from '../export/odt';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { orderedTypeFromFormat, orderedTypeAttr } from '../utils/orderedListTypes';
import { bulletCharAttr, bulletCharFromDocx } from '../utils/bulletListTypes';
import { PX_PER_CM, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { languageFromOdf, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
import type { HfDoc } from '../storage/headerFooter';
import type { OdtImportResult } from './odt';

// .docx → TipTap JSON, inverting export/docx.ts. Editor-expressible OOXML becomes its
// native node/mark/attr; values matching the editor's defaults are suppressed so round
// trips don't accrete attrs. Real Word/LibreOffice files degrade gracefully (reported).

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: Mark[]; text?: string };
type BlockKind = 'body' | 'list' | 'cell';

type RelInfo = { target: string; external: boolean };
// pendingBlocks: text boxes/shapes found inside runs — block nodes that convertBlocks
// flushes after the anchor paragraph (mirrors import/odt.ts).
type Ctx = {
  styles: DocxStyles;
  warnings: Set<string>;
  files: Record<string, Uint8Array>;
  rels: Map<string, RelInfo>;
  imageCache: Map<string, string>;
  pendingBlocks: Node[];
};

// ---- units & editor defaults to suppress -----------------------------------
const twipToCm = (tw: number) => (tw / 1440) * 2.54;
const twipToPt = (tw: number) => tw / 20;
const twipToPx = (tw: number) => (tw / 1440) * 96;
const emuToPx = (emu: number) => emu / 9525;
const round2 = (v: number) => Math.round(v * 100) / 100;

const BODY_FONT_SIZE_PT = 12;
const HEADING_SIZES = HEADING_STYLE_OVERRIDES.map((h) => lengthToPt(h.fontSize)!); // [20,16,14]
const DEFAULT_FONTS = new Set(['times new roman', 'liberation serif']);
const LIST_LEFT_STEP_CM = 1.27; // matches export/docx.ts
const LIST_INDENT_EPS_CM = 0.05;
const LINK_BLUE = '#0563C1'; // the visual the exporter paints on hyperlink runs

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp',
};

// ---- small DOM helpers ------------------------------------------------------
function fc(el: Element | null, localName: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.namespaceURI === W && c.localName === localName) return c;
  return null;
}
function fcAll(el: Element, localName: string): Element[] {
  return Array.from(el.children).filter((c) => c.namespaceURI === W && c.localName === localName);
}
function intAttr(el: Element | null, ns: string, name: string): number | null {
  if (!el) return null;
  const v = ns ? el.getAttributeNS(ns, name) : el.getAttribute(name);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid .docx file (malformed XML).');
  return doc;
}

// '#RRGGBB' from a Word color (6-hex without #, or named). null for auto/empty.
function hexColor(v: string | null | undefined): string | undefined {
  if (!v || v === 'auto') return undefined;
  return /^[0-9a-fA-F]{6}$/.test(v) ? normalizeColor(`#${v}`) : normalizeColor(v);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ---- entry ------------------------------------------------------------------
export function importDocx(bytes: Uint8Array): OdtImportResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('Not a valid .docx file (could not read the archive).');
  }
  const docBytes = files['word/document.xml'];
  if (!docBytes) throw new Error('Not a valid .docx file (word/document.xml is missing).');

  const docDoc = parseXml(strFromU8(docBytes));
  const stylesDoc = files['word/styles.xml'] ? parseXml(strFromU8(files['word/styles.xml'])) : null;
  const numberingDoc = files['word/numbering.xml'] ? parseXml(strFromU8(files['word/numbering.xml'])) : null;
  const themeDoc = files['word/theme/theme1.xml'] ? parseXml(strFromU8(files['word/theme/theme1.xml'])) : null;
  const styles = new DocxStyles(stylesDoc, numberingDoc, themeDoc);
  const warnings = new Set<string>();

  const ctx: Ctx = { styles, warnings, files, rels: parseRels(files['word/_rels/document.xml.rels']), imageCache: new Map(), pendingBlocks: [] };

  const body = docDoc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('Not a Word document (no w:body).');

  const blocks = convertBlocks(Array.from(body.children), ctx, 'body');
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });

  const sect = parseSectPr(fc(body, 'sectPr'), ctx);

  return {
    content: { type: 'doc', content: blocks },
    margins: sect.margins,
    orientation: sect.orientation,
    header: sect.header,
    footer: sect.footer,
    headerDistanceCm: sect.header ? sect.headerDistCm : null,
    footerDistanceCm: sect.footer ? sect.footerDistCm : null,
    language: documentLanguage(stylesDoc, warnings),
    warnings: [...warnings],
  };
}

function parseRels(bytes: Uint8Array | undefined): Map<string, RelInfo> {
  const map = new Map<string, RelInfo>();
  if (!bytes) return map;
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return map; }
  for (const rel of Array.from(doc.getElementsByTagNameNS(PKG_REL, 'Relationship'))) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) map.set(id, { target, external: rel.getAttribute('TargetMode') === 'External' });
  }
  return map;
}

function documentLanguage(stylesDoc: Document | null, warnings: Set<string>): DocumentLanguage | null {
  const lang = stylesDoc?.getElementsByTagNameNS(W, 'docDefaults')[0]
    ?.getElementsByTagNameNS(W, 'lang')[0]?.getAttributeNS(W, 'val');
  if (!lang) return null;
  const [language, country] = lang.split('-');
  const code = languageFromOdf(language, country);
  if (code) return code;
  warnings.add(`Spell-check language "${lang}" has no bundled dictionary — spell check was turned off`);
  return NO_LANGUAGE;
}

// ---- block conversion (paragraphs, lists, tables) --------------------------
// A Word/LibreOffice TOC is a `TOC` field spanning several paragraphs (begin+instrText
// first, cached entries between, end last), each entry itself a nested PAGEREF field — so
// field depth is tracked (across one convertBlocks call) to match the TOC's own end.
type TocFieldState = { fieldDepth: number; tocDepth: number; instr: string[] };

function scanTocField(p: Element, st: TocFieldState): { emit: boolean } {
  let emit = false;
  for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
    for (const c of Array.from(r.children)) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === 'fldChar') {
        const t = c.getAttributeNS(W, 'fldCharType');
        if (t === 'begin') { st.fieldDepth++; st.instr[st.fieldDepth] = ''; }
        else if (t === 'end') {
          if (st.tocDepth === st.fieldDepth) st.tocDepth = -1;
          st.instr[st.fieldDepth] = '';
          st.fieldDepth = Math.max(0, st.fieldDepth - 1);
        }
      } else if (c.localName === 'instrText' && st.fieldDepth > 0) {
        st.instr[st.fieldDepth] += c.textContent ?? '';
        if (st.tocDepth < 0 && /\bTOC\b/.test(st.instr[st.fieldDepth])) {
          st.tocDepth = st.fieldDepth;
          emit = true;
        }
      }
    }
  }
  return { emit };
}

// docx-lib (and Word) wrap a TOC in a content control; detect it by its gallery type or
// a TOC field instruction inside its content.
function sdtIsToc(sdt: Element): boolean {
  const gallery = fc(sdt, 'sdtPr')?.getElementsByTagNameNS(W, 'docPartGallery')[0];
  if (gallery && /table of contents/i.test(gallery.getAttributeNS(W, 'val') ?? '')) return true;
  const content = fc(sdt, 'sdtContent');
  if (!content) return false;
  return Array.from(content.getElementsByTagNameNS(W, 'instrText')).some(i => /\bTOC\b/.test(i.textContent ?? ''));
}

function convertBlocks(children: Element[], ctx: Ctx, kind: BlockKind, boldByDefault = false): Node[] {
  const out: Node[] = [];
  const stack: { ilvl: number; numId: number; list: Node }[] = [];
  // Table-of-contents field tracking (see scanTocField). A TOC node is emitted for the
  // body only; its cached paragraphs are skipped. The node view regenerates entries live.
  const tocState: TocFieldState = { fieldDepth: 0, tocDepth: -1, instr: [] };

  const closeTop = () => {
    const top = stack.pop()!;
    if (stack.length) {
      const parent = stack[stack.length - 1].list;
      let item = parent.content![parent.content!.length - 1];
      if (!item) { item = { type: 'listItem', content: [{ type: 'paragraph' }] }; parent.content!.push(item); }
      item.content!.push(top.list);
    } else {
      out.push(top.list);
    }
  };
  const flush = () => { while (stack.length) closeTop(); };

  // Emit an anchor paragraph, then any text boxes found inside it. In the body they
  // follow the anchor at top level — and an empty anchor (our own export's wrapper
  // paragraph) is dropped; elsewhere their blocks are unwrapped in place.
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

  for (const el of children) {
    if (el.namespaceURI !== W) continue;
    if (el.localName === 'p') {
      // A paragraph owned by a TOC field is skipped; the field emits one node.
      const startedInToc = tocState.tocDepth >= 0;
      const { emit } = scanTocField(el, tocState);
      if (emit && kind === 'body') { flush(); out.push({ type: 'tableOfContents', attrs: { entries: [] } }); }
      if (startedInToc || emit) continue;
      const num = paragraphNum(el, ctx);
      if (num) {
        const para = convertParagraph(el, ctx, 'list', boldByDefault);
        while (stack.length && stack[stack.length - 1].ilvl > num.ilvl) closeTop();
        let top = stack[stack.length - 1];
        if (top && top.ilvl === num.ilvl && top.numId !== num.numId) { closeTop(); top = stack[stack.length - 1]; }
        while (stack.length === 0 || stack[stack.length - 1].ilvl < num.ilvl) {
          const ilvl = stack.length ? stack[stack.length - 1].ilvl + 1 : 0;
          stack.push({ ilvl, numId: num.numId, list: makeListNode(ctx, num.numId, ilvl) });
          if (ilvl === num.ilvl) break;
        }
        stack[stack.length - 1].list.content!.push({ type: 'listItem', content: [para] });
      } else {
        flush();
        pushWithPending(convertParagraph(el, ctx, kind, boldByDefault));
      }
    } else if (el.localName === 'tbl') {
      flush();
      if (kind === 'body') {
        const t = convertTable(el, ctx);
        if (t) out.push(t);
      } else {
        ctx.warnings.add('Nested tables were flattened to paragraphs');
        out.push(...flattenTable(el, ctx));
      }
    } else if (el.localName === 'sdt') {
      flush();
      if (sdtIsToc(el)) {
        // A content-control-wrapped TOC → one node (regenerated live); skip its content.
        if (kind === 'body') out.push({ type: 'tableOfContents', attrs: { entries: [] } });
      } else {
        const content = fc(el, 'sdtContent');
        if (content) out.push(...convertBlocks(Array.from(content.children), ctx, kind, boldByDefault));
      }
    }
  }
  flush();
  // Boxes anchored inside list items land after the whole list.
  pushWithPending(null);
  return out;
}

function paragraphNum(el: Element, ctx: Ctx): { numId: number; ilvl: number } | null {
  const ppr = fc(el, 'pPr');
  let np: { numId: number; ilvl: number } | null = null;
  const numPr = fc(ppr, 'numPr');
  if (numPr) np = readNumPr(numPr);
  if (!np) { const ps = fc(ppr, 'pStyle'); np = ctx.styles.styleNumPr(ps ? wVal(ps) : null); }
  return np && np.numId !== 0 ? np : null; // numId 0 = "no list"
}

function makeListNode(ctx: Ctx, numId: number, ilvl: number): Node {
  const def = ctx.styles.level(numId, ilvl);
  const bullet = !def.numFmt || def.numFmt === 'bullet' || def.numFmt === 'none';
  const attrs: Record<string, unknown> = {};
  if (bullet) {
    const ch = bulletCharAttr(bulletCharFromDocx(def.lvlText, def.bulletFont), ilvl);
    if (ch) attrs.bulletChar = ch;
  } else {
    const placeholders = (def.lvlText?.match(/%\d/g) ?? []).length;
    // Multilevel chains ("%1.%2." lvlText below level 0): the attr sits on the top
    // list only; chain members stay attr-less.
    const chainBelow = ((ctx.styles.level(numId, 1).lvlText ?? '').match(/%\d/g) ?? []).length > 1;
    if (ilvl === 0 && chainBelow) {
      attrs.listStyleType = 'multilevel';
    } else if (placeholders <= 1) {
      const key = orderedTypeFromFormat(wordFmtChar(def.numFmt), lvlSuffix(def.lvlText));
      const attr = orderedTypeAttr(key, ilvl);
      if (attr) attrs.listStyleType = attr;
    }
    if (def.start != null && def.start > 1) attrs.start = def.start;
  }
  if (ilvl === 0 && def.leftTwip != null) {
    const extra = round2(twipToCm(def.leftTwip) - LIST_LEFT_STEP_CM);
    if (extra > LIST_INDENT_EPS_CM) attrs.indent = extra;
  }
  const node: Node = { type: bullet ? 'bulletList' : 'orderedList', content: [] };
  if (Object.keys(attrs).length) node.attrs = attrs;
  return node;
}

function wordFmtChar(fmt: string | undefined): string {
  switch (fmt) {
    case 'lowerLetter': return 'a';
    case 'upperLetter': return 'A';
    case 'lowerRoman': return 'i';
    case 'upperRoman': return 'I';
    default: return '1';
  }
}
function lvlSuffix(lvlText: string | undefined): string {
  if (!lvlText) return '.';
  const trail = lvlText.replace(/^.*%\d+/, '');
  return trail.charAt(0) === ')' ? ')' : '.';
}

function convertParagraph(el: Element, ctx: Ctx, kind: BlockKind, boldByDefault: boolean): Node {
  const ppr = fc(el, 'pPr');
  const pStyle = fc(ppr, 'pStyle');
  const level = headingLevelOf(ppr, ctx);
  // Alignment: direct w:pPr/w:jc wins, else resolve it from the style chain (the default
  // paragraph style commonly carries justify), so style-level alignment isn't lost.
  const directJc = fc(ppr, 'jc');
  const jcVal = directJc ? wVal(directJc) : ctx.styles.paragraphAlign(pStyle ? wVal(pStyle) : null);
  const attrs = blockAttrs(ppr, kind, level, jcVal);
  const baseRun = mergeRunProps(ctx.styles.defaultRun(), ctx.styles.styleOwn(pStyle ? wVal(pStyle) : null));
  const content = convertInline(el, ctx, baseRun, level, false, boldByDefault);

  // An empty line's height comes from the paragraph mark's own run props (w:pPr/w:rPr),
  // which convertInline never sees (there are no runs). Carry its font size as a block
  // attr so the empty line renders at the right height (and typed text inherits it).
  if (content.length === 0) {
    const fs = emptyLineFontSize(ppr, ctx, baseRun, level);
    if (fs) attrs.fontSize = fs;
  }

  const node: Node = { type: level ? 'heading' : 'paragraph' };
  if (level) attrs.level = level;
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

// The paragraph mark's resolved font size (w:pPr/w:rPr, incl. its rStyle), as a CSS
// pt string, or null when it matches the block's default (suppressed like run sizes).
function emptyLineFontSize(ppr: Element | null, ctx: Ctx, baseRun: RunProps, level: number | null): string | null {
  const rPr = fc(ppr, 'rPr');
  const rStyle = fc(rPr, 'rStyle');
  const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
  if (props.sizeHalfPt == null) return null;
  const sizePt = props.sizeHalfPt / 2;
  const defSize = level != null ? HEADING_SIZES[level - 1] : BODY_FONT_SIZE_PT;
  return Math.abs(sizePt - defSize) > 0.05 ? `${Math.round(sizePt * 10) / 10}pt` : null;
}

// Heading + clamped level. Detect via the paragraph style id (fast path for our own
// files / English Word), then the style's resolved outline level (locale-independent,
// catches LibreOffice/localized heading styles), then a direct paragraph outline level.
function headingLevelOf(ppr: Element | null, ctx: Ctx): number | null {
  const clamp = (n: number) => Math.min(3, Math.max(1, n));
  if (!ppr) return null;
  const ps = fc(ppr, 'pStyle');
  const id = ps ? wVal(ps) : null;
  if (id) {
    const m = /^Heading\s?([1-9])$/i.exec(id);
    if (m) return clamp(parseInt(m[1], 10));
    const ol = ctx.styles.styleOutlineLvl(id);
    if (ol != null && ol >= 0 && ol <= 8) return clamp(ol + 1);
  }
  const olEl = fc(ppr, 'outlineLvl');
  const n = olEl ? parseInt(wVal(olEl) ?? '', 10) : NaN;
  if (Number.isFinite(n) && n >= 0 && n <= 8) return clamp(n + 1);
  return null;
}

// Spacing/indent come from DIRECT w:pPr only — Word stores per-paragraph formatting
// inline (style-level defaults stay in the style and are left as the editor's defaults).
// Alignment (jcVal) is resolved through the style chain by the caller.
function blockAttrs(ppr: Element | null, kind: BlockKind, headingLevel: number | null, jcVal: string | null): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  if (jcVal === 'center') attrs.textAlign = 'center';
  else if (jcVal === 'both' || jcVal === 'distribute') attrs.textAlign = 'justify';
  else if (jcVal === 'right' || jcVal === 'end') attrs.textAlign = 'right';

  if (!ppr) return attrs;

  const sp = fc(ppr, 'spacing');
  if (sp) {
    const before = intAttr(sp, W, 'before');
    const after = intAttr(sp, W, 'after');
    if (before != null) attrs.spaceBefore = snapPt(twipToPt(before));
    if (after != null) attrs.spaceAfter = snapPt(twipToPt(after));
    const line = intAttr(sp, W, 'line');
    const rule = sp.getAttributeNS(W, 'lineRule');
    if (line != null && (!rule || rule === 'auto')) {
      const mult = round2(line / 240);
      if (Math.abs(mult - 1) > 0.01) attrs.lineHeight = String(mult);
    }
  }

  if (kind !== 'list') {
    const ind = fc(ppr, 'ind');
    const left = ind ? intAttr(ind, W, 'left') ?? intAttr(ind, W, 'start') : null;
    if (left != null) { const cm = round2(twipToCm(left)); if (cm > LIST_INDENT_EPS_CM) attrs.indent = cm; }
  }

  if (kind === 'body') {
    const pb = fc(ppr, 'pageBreakBefore');
    if (pb && wVal(pb) !== 'false' && wVal(pb) !== '0') attrs.breakBefore = 'page';
  }
  return attrs;
}

function snapPt(v: number): number {
  const r = Math.round(v * 100) / 100;
  const i = Math.round(r);
  return Math.abs(r - i) <= 0.03 ? i : r;
}

// ---- inline conversion (runs, marks, fields, images) -----------------------
function convertInline(p: Element, ctx: Ctx, baseRun: RunProps, headingLevel: number | null, hfFields: boolean, boldByDefault: boolean): Node[] {
  const out: Node[] = [];
  let fieldMode: 'none' | 'instr' | 'result' = 'none';
  let fieldInstr = '';

  const pushText = (text: string, marks: Mark[]) => {
    if (!text) return;
    const node: Node = { type: 'text', text };
    if (marks.length) node.marks = marks;
    out.push(node);
  };

  // A run may hold a whole field (begin/instrText/separate/end) or just part of one,
  // so walk its children in order and keep the field state across runs.
  const handleRun = (r: Element, linkHref?: string) => {
    const rPr = fc(r, 'rPr');
    const rStyle = fc(rPr, 'rStyle');
    const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
    if (!props.font && props.fontTheme) props.font = ctx.styles.themeFont(props.fontTheme);
    const marks = marksFor(props, headingLevel, boldByDefault, !!linkHref);
    if (linkHref) marks.push({ type: 'link', attrs: { href: linkHref } });
    const skipResult = () => fieldMode === 'result' && hfFields; // hide a hf field's cached value

    // Route a drawing/pict result: an image is inline; a text box is a block node
    // riding ctx.pendingBlocks (dropped in the one-paragraph header/footer schema).
    const pushDrawn = (n: Node | null) => {
      if (!n) return;
      if (n.type !== 'textBox') { out.push(n); return; }
      if (hfFields) ctx.warnings.add('Drawings were removed');
      else ctx.pendingBlocks.push(n);
    };

    for (const child of Array.from(r.children)) {
      // Word wraps every shape in mc:AlternateContent; use only the mc:Choice branch
      // (the mc:Fallback VML duplicates it and would double-import).
      if (child.namespaceURI === MC && child.localName === 'AlternateContent') {
        const choice = Array.from(child.children).find((c) => c.namespaceURI === MC && c.localName === 'Choice');
        const drawing = choice?.getElementsByTagNameNS(W, 'drawing')[0];
        if (drawing) pushDrawn(convertDrawing(drawing, ctx));
        else {
          const pict = Array.from(child.children)
            .find((c) => c.namespaceURI === MC && c.localName === 'Fallback')
            ?.getElementsByTagNameNS(W, 'pict')[0];
          if (pict) pushDrawn(convertPict(pict, ctx));
          else ctx.warnings.add('Drawings were removed');
        }
        continue;
      }
      if (child.namespaceURI !== W) continue;
      switch (child.localName) {
        case 'fldChar': {
          const t = child.getAttributeNS(W, 'fldCharType');
          if (t === 'begin') { fieldMode = 'instr'; fieldInstr = ''; }
          else if (t === 'separate') fieldMode = 'result';
          else if (t === 'end') { emitField(out, fieldInstr, hfFields); fieldMode = 'none'; }
          break;
        }
        case 'instrText': if (fieldMode === 'instr') fieldInstr += child.textContent ?? ''; break;
        case 't': if (!skipResult()) pushText(child.textContent ?? '', marks); break;
        case 'tab': if (!skipResult()) pushText('\t', marks); break;
        case 'br': case 'cr': out.push({ type: 'hardBreak' }); break;
        case 'drawing': pushDrawn(convertDrawing(child, ctx)); break;
        case 'pict': pushDrawn(convertPict(child, ctx)); break;
      }
    }
  };

  for (const el of Array.from(p.children)) {
    if (el.namespaceURI !== W) continue;
    switch (el.localName) {
      case 'r': handleRun(el); break;
      case 'hyperlink': {
        const rid = el.getAttributeNS(R, 'id');
        const href = rid ? ctx.rels.get(rid)?.target : undefined;
        for (const r of fcAll(el, 'r')) handleRun(r, href);
        break;
      }
      case 'fldSimple': {
        const instr = el.getAttributeNS(W, 'instr') ?? '';
        if (hfFields) emitField(out, instr, true);
        else for (const r of fcAll(el, 'r')) handleRun(r); // body: keep the shown value
        break;
      }
      case 'ins': // accepted tracked-change insertion → keep its runs
        for (const r of fcAll(el, 'r')) handleRun(r);
        break;
      case 'smartTag':
        for (const r of fcAll(el, 'r')) handleRun(r);
        break;
    }
  }
  return mergeAdjacentText(out);
}

function emitField(out: Node[], instr: string, hfFields: boolean): void {
  if (!hfFields) return;
  if (/\bNUMPAGES\b/.test(instr)) out.push({ type: 'pageCount' });
  else if (/\bPAGE\b/.test(instr)) out.push({ type: 'pageNumber' });
}

function mergeAdjacentText(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (prev && n.type === 'text' && prev.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      prev.text! += n.text!;
    } else {
      out.push(n);
    }
  }
  return out;
}

function marksFor(props: RunProps, headingLevel: number | null, boldByDefault: boolean, inLink: boolean): Mark[] {
  const marks: Mark[] = [];
  const textStyle: Record<string, unknown> = {};

  // Headings and header-row cells render bold via CSS: only a non-bold run needs a mark.
  if (headingLevel != null || boldByDefault) {
    if (props.bold === false) textStyle.fontWeight = 'normal';
  } else if (props.bold === true) {
    marks.push({ type: 'bold' });
  }

  if (props.italic) marks.push({ type: 'italic' });
  if (props.underline && !inLink) marks.push({ type: 'underline' }); // link underline is the CSS default
  if (props.strike) marks.push({ type: 'strike' });
  if (props.vertAlign === 'superscript') marks.push({ type: 'superscript' });
  else if (props.vertAlign === 'subscript') marks.push({ type: 'subscript' });

  if (props.highlightFill) { const c = hexColor(props.highlightFill); if (c) marks.push({ type: 'highlight', attrs: { color: c } }); }

  let color = hexColor(props.color);
  if (inLink && color === LINK_BLUE) color = undefined; // strip the exporter's link visual
  if (color && color !== '#000000') textStyle.color = color;

  const sizePt = props.sizeHalfPt != null ? props.sizeHalfPt / 2 : null;
  const defSize = headingLevel != null ? HEADING_SIZES[headingLevel - 1] : BODY_FONT_SIZE_PT;
  if (sizePt != null && Math.abs(sizePt - defSize) > 0.05) textStyle.fontSize = `${Math.round(sizePt * 10) / 10}pt`;

  if (props.font && !DEFAULT_FONTS.has(props.font.toLowerCase())) textStyle.fontFamily = props.font;

  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });
  return marks;
}

// ---- images -----------------------------------------------------------------
function loadImageDataUrl(path: string, ctx: Ctx): string | null {
  const cached = ctx.imageCache.get(path);
  if (cached) return cached;
  const bytes = ctx.files[path];
  if (!bytes) return null;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const url = `data:${MIME_BY_EXT[ext] ?? 'image/png'};base64,${bytesToBase64(bytes)}`;
  ctx.imageCache.set(path, url);
  return url;
}

function convertDrawing(drawing: Element, ctx: Ctx): Node | null {
  const anchor = drawing.getElementsByTagNameNS(WP, 'anchor')[0];
  const root = drawing.getElementsByTagNameNS(WP, 'inline')[0] ?? anchor;
  if (!root) return null;
  // A wordprocessingShape (text box / preset shape) has no blip — convert it first.
  const wsp = root.getElementsByTagNameNS(WPS, 'wsp')[0];
  if (wsp) return convertWpsShape(wsp, root, !!anchor, ctx);
  const blip = drawing.getElementsByTagNameNS(A, 'blip')[0];
  if (!blip) { ctx.warnings.add('Drawings were removed'); return null; }
  const embed = blip.getAttributeNS(R, 'embed');
  const rel = embed ? ctx.rels.get(embed) : undefined;
  if (!rel || rel.external) { ctx.warnings.add('Some images could not be read and were skipped'); return null; }
  const src = loadImageDataUrl(`word/${rel.target.replace(/^\/+/, '')}`, ctx);
  if (!src) { ctx.warnings.add('Some images could not be read and were skipped'); return null; }

  const attrs: Record<string, unknown> = { src };
  const extent = root.getElementsByTagNameNS(WP, 'extent')[0];
  const cx = intAttr(extent, '', 'cx');
  const cy = intAttr(extent, '', 'cy');
  if (cx) attrs.width = Math.round(emuToPx(cx));
  if (cy) attrs.height = Math.round(emuToPx(cy));
  const docPr = root.getElementsByTagNameNS(WP, 'docPr')[0];
  const alt = docPr?.getAttribute('title') || docPr?.getAttribute('descr');
  if (alt) attrs.alt = alt;
  const xfrm = drawing.getElementsByTagNameNS(A, 'xfrm')[0];
  const rot = xfrm ? parseInt(xfrm.getAttribute('rot') ?? '', 10) : NaN;
  if (Number.isFinite(rot) && rot) attrs.rotation = ((Math.round(rot / 60000) % 360) + 360) % 360;

  if (anchor) attrs.wrap = anchorWrap(anchor);
  return { type: 'image', attrs };
}

function anchorWrap(anchor: Element): 'left' | 'right' | 'topBottom' {
  if (anchor.getElementsByTagNameNS(WP, 'wrapTopAndBottom')[0]) return 'topBottom';
  const sq = anchor.getElementsByTagNameNS(WP, 'wrapSquare')[0];
  const wt = sq?.getAttribute('wrapText');
  if (wt === 'right') return 'left'; // text on right ⇒ image on left
  if (wt === 'left') return 'right';
  const align = anchor.getElementsByTagNameNS(WP, 'align')[0]?.textContent;
  return align === 'right' ? 'right' : 'left';
}

// ---- text boxes / shapes ------------------------------------------------------
function nsChild(el: Element | null, ns: string, localName: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.namespaceURI === ns && c.localName === localName) return c;
  return null;
}

const KIND_BY_PRST: Record<string, 'textbox' | 'roundRect' | 'ellipse'> = {
  rect: 'textbox',
  roundRect: 'roundRect',
  ellipse: 'ellipse',
};

// Fill/stroke attrs from a shape's spPr (or VML equivalents), suppressing the editor
// defaults (white fill, 1pt black stroke); none → explicit null, since omitting the
// attr would re-apply the default.
function setShapeStyleAttrs(attrs: Record<string, unknown>, fill: string | null, stroke: string | null, strokeWidthPt: number | null): void {
  if (fill !== '#FFFFFF') attrs.fillColor = fill;
  if (stroke !== '#000000') attrs.strokeColor = stroke;
  if (stroke && strokeWidthPt != null && Math.abs(strokeWidthPt - 1) > 0.1) {
    attrs.strokeWidthPt = Math.round(strokeWidthPt * 100) / 100;
  }
}

// A DrawingML <wps:wsp> (text box or preset shape) → a textBox node. Unsupported
// preset geometries (stars, arrows, …) are dropped with a warning. All property
// lookups are scoped to spPr so a nested image's fill/xfrm can't leak in.
function convertWpsShape(wsp: Element, root: Element, isAnchor: boolean, ctx: Ctx): Node | null {
  const spPr = nsChild(wsp, WPS, 'spPr');
  const prst = nsChild(spPr, A, 'prstGeom')?.getAttribute('prst') ?? 'rect';
  const kind = KIND_BY_PRST[prst];
  if (!kind) { ctx.warnings.add('Unsupported shapes were removed'); return null; }

  const attrs: Record<string, unknown> = {};
  if (kind !== 'textbox') attrs.shapeKind = kind;
  const extent = root.getElementsByTagNameNS(WP, 'extent')[0];
  const cx = intAttr(extent, '', 'cx');
  const cy = intAttr(extent, '', 'cy');
  if (cx) attrs.width = Math.round(emuToPx(cx));
  if (cy) attrs.height = Math.round(emuToPx(cy));
  const rot = intAttr(nsChild(spPr, A, 'xfrm'), '', 'rot');
  if (rot) attrs.rotation = ((Math.round(rot / 60000) % 360) + 360) % 360;
  if (isAnchor) attrs.wrap = anchorWrap(root);

  const fillClr = nsChild(nsChild(spPr, A, 'solidFill'), A, 'srgbClr')?.getAttribute('val');
  const fill = fillClr ? hexColor(fillClr) ?? null : null;
  const ln = nsChild(spPr, A, 'ln');
  const lnClr = nsChild(nsChild(ln, A, 'solidFill'), A, 'srgbClr')?.getAttribute('val');
  const stroke = ln && !nsChild(ln, A, 'noFill') ? hexColor(lnClr ?? '000000') ?? '#000000' : null;
  const lnW = intAttr(ln, '', 'w');
  setShapeStyleAttrs(attrs, fill, stroke, lnW != null ? lnW / 12700 : null);

  const txbxContent = nsChild(nsChild(wsp, WPS, 'txbx'), W, 'txbxContent');
  const blocks = txbxContent ? convertBlocks(Array.from(txbxContent.children), ctx, 'cell') : [];
  return { type: 'textBox', attrs, content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

// Legacy VML (w:pict): v:rect/v:oval/v:roundrect/v:shape with a v:textbox. Geometry
// comes from the CSS-ish style string; shapes without text content are dropped.
function convertPict(pict: Element, ctx: Ctx): Node | null {
  const shape = Array.from(pict.children).find(
    (c) => c.namespaceURI === VML && ['shape', 'rect', 'oval', 'roundrect'].includes(c.localName),
  );
  const txbxContent = shape
    ? nsChild(shape.getElementsByTagNameNS(VML, 'textbox')[0] ?? null, W, 'txbxContent')
    : null;
  if (!shape || !txbxContent) { ctx.warnings.add('Drawings were removed'); return null; }

  const attrs: Record<string, unknown> = {};
  const kind = shape.localName === 'oval' ? 'ellipse' : shape.localName === 'roundrect' ? 'roundRect' : 'textbox';
  if (kind !== 'textbox') attrs.shapeKind = kind;

  const style = shape.getAttribute('style') ?? '';
  const dimPx = (key: string): number | null => {
    const m = new RegExp(`(?:^|;)\\s*${key}:\\s*([\\d.]+)(pt|in|cm|mm|px)?`).exec(style);
    if (!m) return null;
    const v = parseFloat(m[1]);
    const u = m[2] ?? 'pt';
    const pt = u === 'pt' ? v : u === 'in' ? v * 72 : u === 'cm' ? (v * 72) / 2.54 : u === 'mm' ? (v * 7.2) / 2.54 : v * 0.75;
    return Math.round((pt * 96) / 72);
  };
  const w = dimPx('width');
  const h = dimPx('height');
  if (w) attrs.width = w;
  if (h) attrs.height = h;

  const fillAttr = shape.getAttribute('fillcolor');
  const fill = fillAttr ? normalizeColor(fillAttr) ?? null : null;
  const stroked = shape.getAttribute('stroked');
  const stroke = stroked === 'f' || stroked === 'false'
    ? null
    : normalizeColor(shape.getAttribute('strokecolor') ?? '#000000') ?? '#000000';
  const swm = /^([\d.]+)\s*(pt)?$/.exec(shape.getAttribute('strokeweight') ?? '');
  setShapeStyleAttrs(attrs, fill, stroke, swm ? parseFloat(swm[1]) : null);

  const blocks = convertBlocks(Array.from(txbxContent.children), ctx, 'cell');
  return { type: 'textBox', attrs, content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

// ---- tables -----------------------------------------------------------------

// A w:tcBorders/w:tblBorders side element → border attr value: null = the editor
// default (0.5pt black), 'none', or '<W>pt solid #RRGGBB' (w:sz is eighth-points).
// undefined when the element is absent (side not declared at this level).
function docxBorderAttr(el: Element | null): string | null | undefined {
  if (!el) return undefined;
  const val = el.getAttributeNS(W, 'val');
  if (!val || val === 'none' || val === 'nil') return 'none';
  const sz = intAttr(el, W, 'sz');
  const w = Math.round(((sz != null ? sz / 8 : 0.5)) * 100) / 100;
  const c = (hexColor(el.getAttributeNS(W, 'color')) ?? '#000000').toUpperCase();
  if (Math.abs(w - 0.5) < 0.11 && c === '#000000') return null;
  return `${w}pt solid ${c}`;
}

function convertTable(tbl: Element, ctx: Ctx): Node | null {
  const grid = fc(tbl, 'tblGrid');
  const weights = grid ? fcAll(grid, 'gridCol').map((g) => Math.max(1, intAttr(g, W, 'w') ?? 1)) : null;
  const useWeights = weights && weights.length ? weights : null;

  // Table-level border defaults; per-cell w:tcBorders override per side. Edge cells
  // fall back to the outer sides, interior cells to insideH/insideV.
  const tblBorders = fc(fc(tbl, 'tblPr'), 'tblBorders');
  const tblSide = (name: string) => docxBorderAttr(fc(tblBorders, name));
  const tblDef = {
    top: tblSide('top'), bottom: tblSide('bottom'), left: tblSide('left'),
    right: tblSide('right'), insideH: tblSide('insideH'), insideV: tblSide('insideV'),
  };
  const gridWidth = useWeights?.length ?? null;

  const rows: Node[] = [];
  const pending: (Node | null)[] = []; // origin cell per grid column, for vMerge spans
  const trs = fcAll(tbl, 'tr');
  for (let ri = 0; ri < trs.length; ri++) {
    const tr = trs[ri];
    const cells: Node[] = [];
    let col = 0;
    for (const tc of fcAll(tr, 'tc')) {
      const tcPr = fc(tc, 'tcPr');
      const colspan = intAttr(fc(tcPr, 'gridSpan'), W, 'val') ?? 1;
      const vMergeEl = fc(tcPr, 'vMerge');
      const vMerge = vMergeEl ? wVal(vMergeEl) ?? 'continue' : null;
      if (vMerge && vMerge !== 'restart') {
        const origin = pending[col];
        if (origin) origin.attrs!.rowspan = ((origin.attrs!.rowspan as number) || 1) + 1;
        col += colspan;
        continue; // covered cell — dropped, span folded into its origin
      }
      const fill = fc(tcPr, 'shd')?.getAttributeNS(W, 'fill');
      const bg = fill ? hexColor(fill) : undefined;
      const blocks = convertBlocks(Array.from(tc.children), ctx, 'cell', bg === HEADER_SHADE);
      const attrs: Record<string, unknown> = { colspan, rowspan: 1 };
      if (bg) attrs.backgroundColor = bg;
      const tcBorders = fc(tcPr, 'tcBorders');
      const isRight = gridWidth != null && col + colspan >= gridWidth;
      const resolve = (name: string, tblVal: string | null | undefined) => {
        const own = docxBorderAttr(fc(tcBorders, name));
        return own !== undefined ? own : tblVal;
      };
      const sides: [string, string | null | undefined][] = [
        ['borderTop', resolve('top', ri === 0 ? tblDef.top : tblDef.insideH)],
        ['borderBottom', resolve('bottom', ri === trs.length - 1 ? tblDef.bottom : tblDef.insideH)],
        ['borderLeft', resolve('left', col === 0 ? tblDef.left : tblDef.insideV)],
        ['borderRight', resolve('right', isRight ? tblDef.right : tblDef.insideV)],
      ];
      // undefined (nothing declared) and null (= editor default) both leave the attr off.
      for (const [attr, v] of sides) if (typeof v === 'string') attrs[attr] = v;
      if (useWeights) attrs.colwidth = useWeights.slice(col, col + colspan);
      const cell: Node = { type: 'tableCell', attrs, content: blocks.length ? blocks : [{ type: 'paragraph' }] };
      cells.push(cell);
      for (let c = col; c < col + colspan; c++) pending[c] = vMerge === 'restart' ? cell : null;
      col += colspan;
    }
    if (cells.length === 0) continue;
    const row: Node = { type: 'tableRow', content: cells };
    const h = intAttr(fc(fc(tr, 'trPr'), 'trHeight'), W, 'val');
    if (h && h > 0) row.attrs = { rowHeight: Math.round(twipToPx(h)) };
    rows.push(row);
  }
  return rows.length ? { type: 'table', content: rows } : null;
}

function flattenTable(tbl: Element, ctx: Ctx): Node[] {
  const out: Node[] = [];
  for (const tr of fcAll(tbl, 'tr')) for (const tc of fcAll(tr, 'tc')) out.push(...convertBlocks(Array.from(tc.children), ctx, 'cell'));
  return out;
}

// ---- section: page geometry + headers/footers ------------------------------
function parseSectPr(sect: Element | null, ctx: Ctx): {
  margins: PageMargins | null; orientation: Orientation | null;
  header: HfDoc; footer: HfDoc; headerDistCm: number | null; footerDistCm: number | null;
} {
  const empty = { margins: null, orientation: null, header: null, footer: null, headerDistCm: null, footerDistCm: null };
  if (!sect) return empty;

  const pgSz = fc(sect, 'pgSz');
  const w = intAttr(pgSz, W, 'w');
  const h = intAttr(pgSz, W, 'h');
  const orientation: Orientation = pgSz?.getAttributeNS(W, 'orient') === 'landscape' || (w && h && w > h) ? 'landscape' : 'portrait';

  const pgMar = fc(sect, 'pgMar');
  const clampCm = (tw: number | null) => (tw == null ? null : Math.min(10, Math.max(0, round2(twipToCm(tw)))));
  const margins: PageMargins | null = pgMar
    ? { top: clampCm(intAttr(pgMar, W, 'top')) ?? 2.54, bottom: clampCm(intAttr(pgMar, W, 'bottom')) ?? 2.54, left: clampCm(intAttr(pgMar, W, 'left')) ?? 2.12, right: clampCm(intAttr(pgMar, W, 'right')) ?? 2.12 }
    : null;

  const refId = (type: string) => {
    for (const ref of fcAll(sect, `${type}Reference`)) {
      const t = ref.getAttributeNS(W, 'type') ?? 'default';
      if (t === 'first' || t === 'even') ctx.warnings.add('Per-page header/footer variants (first/even pages) are not supported — the default one was used');
    }
    const def = fcAll(sect, `${type}Reference`).find((r) => (r.getAttributeNS(W, 'type') ?? 'default') === 'default');
    return def?.getAttributeNS(R, 'id') ?? null;
  };

  const header = convertHfPart(refId('header'), ctx);
  const footer = convertHfPart(refId('footer'), ctx);
  return {
    margins, orientation, header, footer,
    headerDistCm: clampCm(intAttr(pgMar, W, 'header')),
    footerDistCm: clampCm(intAttr(pgMar, W, 'footer')),
  };
}

function convertHfPart(relId: string | null, ctx: Ctx): HfDoc {
  if (!relId) return null;
  const target = ctx.rels.get(relId)?.target;
  if (!target) return null;
  const path = `word/${target.replace(/^\/+/, '')}`;
  const bytes = ctx.files[path];
  if (!bytes) return null;
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return null; }
  const root = doc.getElementsByTagNameNS(W, 'hdr')[0] ?? doc.getElementsByTagNameNS(W, 'ftr')[0];
  if (!root) return null;

  const relsPath = path.replace(/^word\/(.*)$/, 'word/_rels/$1.rels');
  const hfCtx: Ctx = { ...ctx, rels: parseRels(ctx.files[relsPath]) };

  const inline: Node[] = [];
  let textAlign: string | null = null;
  for (const p of fcAll(root, 'p')) {
    if (inline.length) inline.push({ type: 'hardBreak' });
    const ppr = fc(p, 'pPr');
    if (textAlign === null) {
      const ta = (fc(ppr, 'jc') ? wVal(fc(ppr, 'jc')!) : null) ?? '';
      textAlign = ta === 'center' || ta === 'both' ? (ta === 'both' ? 'justify' : 'center') : ta === 'right' || ta === 'end' ? 'right' : '';
    }
    const baseRun = mergeRunProps(hfCtx.styles.defaultRun(), hfCtx.styles.styleOwn(fc(ppr, 'pStyle') ? wVal(fc(ppr, 'pStyle')!) : null));
    inline.push(...convertInline(p, hfCtx, baseRun, null, true, false));
  }
  while (inline[0]?.type === 'hardBreak') inline.shift();
  while (inline[inline.length - 1]?.type === 'hardBreak') inline.pop();
  if (inline.length === 0) return null;

  const para: Node = { type: 'paragraph', content: inline };
  if (textAlign) para.attrs = { textAlign };
  return { type: 'doc', content: [para] };
}
