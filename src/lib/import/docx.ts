import { unzipSync, strFromU8 } from 'fflate';
import { DocxStyles, parseRunProps, mergeRunProps, readNumPr, readTabStops, toggle as onOff, wVal, W, R, WP, A, B, WPS, MC, VML, PKG_REL, type RunProps, type ParaSpacing } from './docxStyles';
import { lengthToPt, WATERMARK_NAME } from './styleResolver';
import { HEADING_STYLE_OVERRIDES, MAX_HEADING_LEVEL, normalizeColor } from '../export/odt';
import { builtinStyleSheet, DEFAULT_STYLE, type ParaProps, type Style, type StyleSheet, type TextProps } from '../styles/styleSheet';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { fitInlineImage, framePx } from '../editor/extensions/image';
import { formatTabStops } from '../editor/extensions/tabStops';
import type { CapsMode, LineStyle } from '../editor/extensions/textEffects';
import { tableLookAttr } from '../styles/tableStyles';
import { formatOrdinal, orderedTypeFromFormat, orderedTypeAttrAt, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { bulletCharAttr, bulletCharFromDocx } from '../utils/bulletListTypes';
import { DATE_FORMATS, TIME_FORMATS, docxPicture, toDateValue } from '../utils/dateTime';
import { shapeFromPrst, isLineKind, lineKindFor, parseSvgPath, parseVmlPath, fitPath } from '../utils/shapes';
import { imageDataUrl, placeholderImage, type ConvertedImages } from './imageFormats';
import { PX_PER_CM, cmToPx, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { formatFromCm, type PageFormat } from '../storage/pageFormat';
import { clampTabInterval, DOCX_IMPLIED_TAB_CM } from '../storage/tabInterval';
import { languageFromOdf, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
import { EMPTY_HF_SET, type HfDoc, type HfSet } from '../storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteNumFormat, type NoteSettings } from '../storage/noteSettings';
import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../storage/docProperties';
import { clampPageStart, DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
import { citationStyleFromDocx, type CitationStyle } from '../utils/citationStyle';
import { applyUniformRunFont, pairAlignedFrames, sinkOffsetFrames, type OdtImportResult } from './odt';
import { chartDataUrl } from './chart';
import { deobfuscateOdttf, type EmbeddedFont } from '../fonts/embeddedFonts';
import { cellPaddingAttr, DEFAULT_CELL_PADDING, type CellPadding } from '../editor/extensions/tableCellPadding';
import { fromWriterFormula } from '../utils/tableFormula';
import { cellFormatFromCode, type CellFormat } from '../utils/cellFormat';
import { ODF_SEQ_CATEGORY } from '../editor/extensions/caption';
import type { IndexKind } from '../editor/extensions/tableOfContents';
import { bibTypeFromDocx, DOCX_BIB_FIELD, type BibSource } from '../editor/extensions/bibliographyEntry';
import { normalizePageDecor, type PageDecor } from '../storage/pageDecor';
import { DEFAULT_LINE_NUMBERING, normalizeLineNumbering, type LineNumbering } from '../storage/lineNumbering';
import { clampColumnGap } from '../editor/extensions/columns';
import { astToLatex } from '../math/latex';
import { parseOmml, OMML_NS } from '../math/omml';

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
  // Word styleId → registry name, and the ids blocks actually reference.
  styleNames: Map<string, string>;
  usedStyles: Set<string>;
  charStyleNames: Map<string, string>;
  usedCharStyles: Set<string>;
  warnings: Set<string>;
  files: Record<string, Uint8Array>;
  rels: Map<string, RelInfo>;
  imageCache: Map<string, string>;
  convertedImages: ConvertedImages;
  pendingBlocks: Node[];
  listCounters: Map<number, Map<number, number>>; // numId → ilvl → last number used
  // Text width (cm) of the file's page setup; a table's margins are relative to it.
  contentWidthCm: number;
  // Left page margin (cm), the origin a page-relative frame offset is measured against.
  leftMarginCm: number;
  // The section's own direction: a block declaring the same one is inheriting, not
  // formatted, so only a block that differs carries a `dir` attr.
  pageRtl: boolean;
  // Word's document-wide automatic hyphenation: a paragraph can only turn it off.
  hyphenate: boolean;
  // The citation style the sources part names (b:Sources StyleName).
  citationStyle: CitationStyle;
  // The enclosing table style's w:pPr/w:spacing, applied to its cells' paragraphs.
  cellSpacing: ParaSpacing;
  // Whether w:tblInd is measured to the cell's text rather than the table's edge.
  tblIndToText: boolean;
  // theme1.xml's accent1..6, the colours a chart series names instead of an sRGB.
  accents: string[];
  // Bookmarks open at this point of the walk (w:id → name). A range may start beside a
  // paragraph and end inside a later one, so the state outlives both walks.
  openBookmarks: Map<string, string>;
  // Comment ranges currently open, by Word's numeric id → the mark's attrs.
  openComments: Map<string, Record<string, unknown>>;
  // word/comments.xml, by id.
  commentDefs: Map<string, Record<string, unknown>>;
  // The bibliography sources of the custom-XML part, by tag; a CITATION names one.
  bibSources: Map<string, BibSource>;
  // word/footnotes.xml and endnotes.xml by w:id, and the notes the body referenced, in
  // anchor order — the editor keeps them in one section at the document end (notes.ts).
  noteParts: Record<NoteKind, Map<string, Element>>;
  notes: { id: string; kind: NoteKind; label: string | null; text: string; content: Node[]; styleName: string | null }[];
};

// The real notes of a part, by w:id: Word's own separator entries carry a w:type and
// are referenced by nothing.
function noteParts(files: Record<string, Uint8Array>, part: string, tag: string): Map<string, Element> {
  const out = new Map<string, Element>();
  const bytes = files[`word/${part}.xml`];
  if (!bytes) return out;
  const root = parseXml(strFromU8(bytes)).documentElement;
  for (const el of Array.from(root.getElementsByTagNameNS(W, tag))) {
    if (el.getAttributeNS(W, 'type')) continue;
    const id = el.getAttributeNS(W, 'id');
    if (id != null) out.set(id, el);
  }
  return out;
}

// ---- units & editor defaults to suppress -----------------------------------
const twipToCm = (tw: number) => (tw / 1440) * 2.54;
const twipToPt = (tw: number) => tw / 20;
const twipToPx = (tw: number) => (tw / 1440) * 96;
const emuToPx = (emu: number) => emu / 9525;
const cmToEmu = (cm: number) => cm * 360000;
const round2 = (v: number) => Math.round(v * 100) / 100;

// A run-level <w:br w:type="page"/> becomes this sentinel inline node in convertInline;
// splitParaAtPageBreaks consumes it (body only) into breakBefore, and it never survives.
const PB_MARKER = '__docxPageBreak__';

const BODY_FONT_SIZE_PT = 12;
// Rounded to half points: that is all Word can store, so it is what our own export
// writes and what an imported heading must be compared against.
const HEADING_SIZES = HEADING_STYLE_OVERRIDES.map((h) => Math.round(lengthToPt(h.fontSize)! * 2) / 2);
const HEADING_ITALIC = HEADING_STYLE_OVERRIDES.map((h) => h.italic === true);
const DEFAULT_FONTS = new Set(['times new roman', 'liberation serif']);
// Headings render sans (HEADING_FONT); Word writes Arial, LibreOffice Liberation Sans.
const DEFAULT_HEADING_FONTS = new Set(['arial', 'liberation sans']);
const LIST_LEFT_STEP_CM = 1.27; // matches export/docx.ts
const LIST_INDENT_EPS_CM = 0.05;
const LINK_BLUE = '#0563C1'; // the visual the exporter paints on hyperlink runs

// ---- small DOM helpers ------------------------------------------------------
function fc(el: Element | null, localName: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.namespaceURI === W && c.localName === localName) return c;
  return null;
}
function fcAll(el: Element, localName: string, ns: string = W): Element[] {
  return Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === localName);
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

// ---- entry ------------------------------------------------------------------
export function importDocx(bytes: Uint8Array, convertedImages: ConvertedImages = new Map()): OdtImportResult {
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

  const styleNames = new Map<string, string>();
  const defaultStyleId = styles.defaultParagraphStyle();
  for (const [id, def] of styles.namedParagraphStyles()) styleNames.set(id, registryName(id, def.name, id === defaultStyleId));
  const charStyleNames = styles.namedCharacterStyles();
  const body = docDoc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('Not a Word document (no w:body).');

  const sectPr = fc(body, 'sectPr');
  const contentWidthCm = sectionContentWidthCm(sectPr);
  const leftMarginCm = twipToCm(intAttr(fc(sectPr, 'pgMar'), W, 'left') ?? 1440);
  const ctx: Ctx = { styles, styleNames, usedStyles: new Set(), charStyleNames, usedCharStyles: new Set(), warnings, files, rels: parseRels(files['word/_rels/document.xml.rels']), imageCache: new Map(), convertedImages, pendingBlocks: [], listCounters: new Map(), contentWidthCm, leftMarginCm, pageRtl: sectPrRtl(sectPr), hyphenate: docAutoHyphenation(files), cellSpacing: {}, tblIndToText: tblIndIsToText(files), accents: themeAccents(themeDoc), openBookmarks: new Map(), openComments: new Map(), commentDefs: docxComments(files), bibSources: docxSources(files), citationStyle: docxCitationStyle(files), notes: [], noteParts: {
    footnote: noteParts(files, 'footnotes', 'footnote'),
    endnote: noteParts(files, 'endnotes', 'endnote'),
  } };

  // Mid-body sectPr paragraphs delimit sections; a section whose w:cols declares
  // more than one column becomes a columns node (the trailing group is described
  // by the body-final sectPr, covering whole-document multi-column files).
  const { groups, midSectPrs } = splitBodySections(Array.from(body.children));
  const finalSectPr = fc(body, 'sectPr');
  const blocks: Node[] = [];
  const groupCols = groups.map((g) => sectPrColumns(g.sectPr ?? finalSectPr, ctx));
  // A continuous break where the column setup changes only encodes a columns region
  // (the export splits there without opening a section): no section break, and the
  // group shares the previous one's header/footer set.
  const colsOnly = groups.map((g, gi) => gi > 0
    && !sectionStartsNewPage(g.sectPr ?? finalSectPr)
    && JSON.stringify(groupCols[gi]) !== JSON.stringify(groupCols[gi - 1]));
  groups.forEach((g, gi) => {
    const inner = convertBlocks(g.els, ctx, 'body');
    // A section's own w:type says how it begins: a page-starting break (nextPage/odd/even,
    // or the default) puts its first block on a new page; continuous/nextColumn flow on.
    if (gi > 0 && !colsOnly[gi] && inner.length) {
      const first = inner[0];
      if (first.type === 'paragraph' || first.type === 'heading') {
        first.attrs = { ...(first.attrs ?? {}), sectionBreak: true };
        if (sectionStartsNewPage(g.sectPr ?? finalSectPr)) first.attrs.breakBefore = 'page';
      }
    }
    const cols = groupCols[gi];
    if (cols) pushColumnRuns(inner, cols, blocks, ctx);
    else blocks.push(...inner);
  });
  if (blocks.length === 0) blocks.push({ type: 'paragraph' });
  pairAlignedFrames(blocks, Math.floor(cmToPx(ctx.contentWidthCm)));

  // The notes the walk collected, in anchor order, as the one section the editor keeps
  // at the document end.
  if (ctx.notes.length) {
    blocks.push({ type: 'noteSection', content: ctx.notes.map((n) => ({
      type: 'note',
      attrs: { id: n.id, kind: n.kind, label: n.label, text: n.text, styleName: n.styleName },
      ...(n.content.length ? { content: n.content } : {}),
    })) });
  }

  // Odd/even pages: a document-level setting (settings.xml), not a section property.
  const oddEven = docHasEvenOddHeaders(files);
  const mirrored = docHasMirrorMargins(files);
  // The document's own page setup is the body-final sectPr's; the margins are the first
  // section's, since that is the pair .tiptap's padding draws and every later section is
  // measured against (Editor.svelte's --pb-section-inset).
  const sect = parseSectPr(finalSectPr, ctx, oddEven);
  // The paper is the *first* section's, as the margins are: a document whose last
  // section is one landscape page is not a landscape document.
  const docPaper = sectPaper(groups[0]?.sectPr ?? finalSectPr);
  const hfSections = sectionHfSets(
    groups.filter((_, gi) => !colsOnly[gi]).map((g) => g.sectPr ?? finalSectPr), ctx, oddEven, docPaper);
  const first = hfSections[0];
  // A first-page/even zone reserves the header/footer band even when its default is empty;
  // the distance is document-wide, so any section having one is enough.
  const hasHeader = hfSections.some((s) => s.header || (s.differentFirstPage && s.headerFirst) || (s.differentOddEven && s.headerEven));
  const hasFooter = hfSections.some((s) => s.footer || (s.differentFirstPage && s.footerFirst) || (s.differentOddEven && s.footerEven));

  return {
    content: { type: 'doc', content: blocks },
    styles: collectStyleSheet(ctx),
    notes: docNoteSettings(files),
    margins: withMirror(first.margins ?? sect.margins, mirrored),
    rtl: sectPrRtl(finalSectPr),
    decor: docxPageDecor(docDoc, finalSectPr, files),
    lineNumbering: docxLineNumbering(finalSectPr),
    hyphenate: docAutoHyphenation(files),
    recordChanges: docRecordsChanges(files),
    pageNumbering: docxPageNumbering(sectPr),
    orientation: docPaper.orientation,
    format: docPaper.format,
    tabIntervalCm: docTabInterval(files),
    // Word takes the larger of the two spacings, and LibreOffice follows it for a
    // Word document — its own ODF default adds them (probed).
    spacingModel: 'max' as const,
    header: first.header,
    footer: first.footer,
    headerFirst: first.differentFirstPage ? first.headerFirst : null,
    footerFirst: first.differentFirstPage ? first.footerFirst : null,
    differentFirstPage: first.differentFirstPage,
    headerEven: first.differentOddEven ? first.headerEven : null,
    footerEven: first.differentOddEven ? first.footerEven : null,
    differentOddEven: first.differentOddEven,
    hfSections,
    headerDistanceCm: hasHeader ? sect.headerDistCm : null,
    footerDistanceCm: hasFooter ? sect.footerDistCm : null,
    language: documentLanguage(stylesDoc, warnings),
    props: docxDocProperties(files),
    fonts: extractDocxFonts(files),
    warnings: [...warnings],
  };
}

// Fonts embedded via word/fontTable.xml: each <w:font> may reference regular/bold/italic/
// bold-italic .odttf binaries (obfuscated). Resolve r:id → package path, read + de-obfuscate.
function extractDocxFonts(files: Record<string, Uint8Array>): EmbeddedFont[] {
  const ftBytes = files['word/fontTable.xml'];
  if (!ftBytes) return [];
  let doc: Document;
  try { doc = parseXml(strFromU8(ftBytes)); } catch { return []; }
  const rels = parseRels(files['word/_rels/fontTable.xml.rels']);
  const embeds: [string, 'normal' | 'bold', 'normal' | 'italic'][] = [
    ['embedRegular', 'normal', 'normal'], ['embedBold', 'bold', 'normal'],
    ['embedItalic', 'normal', 'italic'], ['embedBoldItalic', 'bold', 'italic'],
  ];
  const out: EmbeddedFont[] = [];
  for (const font of Array.from(doc.getElementsByTagNameNS(W, 'font'))) {
    const family = font.getAttributeNS(W, 'name');
    if (!family) continue;
    for (const [tag, weight, style] of embeds) {
      const el = fc(font, tag);
      const rel = el ? rels.get(el.getAttributeNS(R, 'id') ?? '') : undefined;
      if (!el || !rel || rel.external) continue;
      const data = files['word/' + rel.target.replace(/^\/+/, '')];
      if (!data) continue;
      const key = el.getAttributeNS(W, 'fontKey');
      out.push({ family, weight, style, data: key ? deobfuscateOdttf(data, key) : data });
    }
  }
  return out;
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
// A TOC is a `TOC` field spanning several paragraphs, each entry a nested PAGEREF field,
// so field depth is tracked (across one convertBlocks call) to match the TOC's own end.
type TocFieldState = { fieldDepth: number; tocDepth: number; instr: string[] };

// The deepest heading level a TOC field lists: the end of its `\o "1-3"` range (Word's
// own default is 1-9). Anything deeper only inflates the block on screen.
function tocMaxLevel(instr: string): number {
  const m = /\\o\s+"?\s*\d+\s*-\s*(\d+)/.exec(instr);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 ? Math.min(MAX_HEADING_LEVEL, n) : MAX_HEADING_LEVEL;
}

// The TOC field's \c switch names a caption label, which makes it a list of figures or
// tables rather than a contents. Word's own labels and LibreOffice's travel alike.
function tocIndexKind(instr: string): IndexKind {
  // INDEX is Word's alphabetical index, BIBLIOGRAPHY its source list; the rest are TOC
  // fields differing by \\c.
  if (/\bBIBLIOGRAPHY\b/.test(instr)) return 'bibliography';
  if (/\bINDEX\b/.test(instr)) return 'alphabetical';
  const m = /\\c\s+"?([^"\\]+)/.exec(instr);
  const cat = m ? ODF_SEQ_CATEGORY[m[1].trim()] : undefined;
  return cat === 'table' ? 'tables' : cat === 'figure' ? 'figures' : 'toc';
}

const instrTextOf = (el: Element): string =>
  Array.from(el.getElementsByTagNameNS(W, 'instrText')).map(i => i.textContent ?? '').join('');

// A cell's own formula field: `=SUM(ABOVE)`, written either way a field can be. Its
// picture switch is the number format (`\@` for a date), not part of the formula.
function cellFormulaOf(tc: Element): { formula: string; format: CellFormat | null } {
  const instrs = [
    instrTextOf(tc),
    ...Array.from(tc.getElementsByTagNameNS(W, 'fldSimple')).map(f => f.getAttributeNS(W, 'instr') ?? ''),
  ];
  const found = instrs.find(i => /^\s*=\s*\S/.test(i));
  if (!found) return { formula: '', format: null };
  const picture = /\\[#@]\s*"([^"]*)"/.exec(found);
  return {
    formula: fromWriterFormula(found.replace(/\\[#@]\s*"[^"]*"/, '')),
    format: picture ? cellFormatFromCode(picture[1]) : null,
  };
}

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
        if (st.tocDepth < 0 && /\b(TOC|INDEX)\b/.test(st.instr[st.fieldDepth])) {
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

// The heading Word caches above a TOC's entries ("Inhalt", "Sommaire", …): the control's
// first paragraph, when it is plain text rather than part of the field itself.
function tocHeading(content: Element | null): string | null {
  const first = content ? fcAll(content, 'p')[0] : null;
  if (!first || first.getElementsByTagNameNS(W, 'fldChar').length || first.getElementsByTagNameNS(W, 'instrText').length) return null;
  const text = (first.textContent ?? '').trim();
  return text && text.length <= 60 ? text : null;
}

// Word's own cursor bookkeeping, never a reference target.
const BOOKMARK_SKIP = new Set(['_GoBack']);

// w:bookmarkStart/w:bookmarkEnd sit beside runs, beside paragraphs, or split across
// both, so both walks feed the same open-range map. Returns true when the element was
// one of them.
function trackBookmark(el: Element, ctx: Ctx): boolean {
  if (el.localName === 'bookmarkStart') {
    const id = el.getAttributeNS(W, 'id');
    const name = el.getAttributeNS(W, 'name');
    if (id && name && !BOOKMARK_SKIP.has(name)) ctx.openBookmarks.set(id, name);
    return true;
  }
  if (el.localName === 'bookmarkEnd') {
    const id = el.getAttributeNS(W, 'id');
    if (id) ctx.openBookmarks.delete(id);
    return true;
  }
  return false;
}

// w:commentRangeStart/-End bracket the annotated runs; w:commentReference marks the
// anchor and needs no handling. Returns true when the element was one of the three.
function trackComment(el: Element, ctx: Ctx): boolean {
  if (el.localName === 'commentRangeStart') {
    const id = el.getAttributeNS(W, 'id');
    const def = id ? ctx.commentDefs.get(id) : undefined;
    if (id && def) ctx.openComments.set(id, def);
    return true;
  }
  if (el.localName === 'commentRangeEnd') {
    const id = el.getAttributeNS(W, 'id');
    if (id) ctx.openComments.delete(id);
    return true;
  }
  return el.localName === 'commentReference';
}

// A mark can hold one comment, so overlapping ranges collapse to the outermost.
function openCommentMark(ctx: Ctx): Mark | null {
  const attrs = ctx.openComments.values().next().value;
  return attrs ? { type: 'comment', attrs } : null;
}

// A mark can hold one bookmark, so overlapping ranges collapse to the outermost.
function openBookmarkMark(ctx: Ctx): Mark | null {
  const name = ctx.openBookmarks.values().next().value;
  return name ? { type: 'bookmark', attrs: { name } } : null;
}

function convertBlocks(children: Element[], ctx: Ctx, kind: BlockKind, boldByDefault = false): Node[] {
  const out: Node[] = [];
  const stack: { ilvl: number; numId: number; list: Node }[] = [];
  // A page break ending one paragraph moves the next block to a new page (breakBefore).
  // Only body paragraphs/headings carry it; other block kinds clear it (break dropped).
  let breakPending = false;
  const applyBreakBefore = (node: Node | undefined) => {
    if (node && (node.type === 'paragraph' || node.type === 'heading')) {
      node.attrs = { ...(node.attrs ?? {}), breakBefore: 'page' };
    }
  };
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
    if (trackBookmark(el, ctx) || trackComment(el, ctx)) continue;
    if (el.localName === 'p') {
      // A paragraph owned by a TOC field is skipped; the field emits one node.
      const startedInToc = tocState.tocDepth >= 0;
      // A simple INDEX field is a whole index in one element — the form our own export
      // writes, since the package has no INDEX class to spread over runs.
      const simple = Array.from(el.getElementsByTagNameNS(W, 'fldSimple'))
        .map((f) => f.getAttributeNS(W, 'instr') ?? '').join(' ');
      if ((/\bINDEX\b/.test(simple) || /\bBIBLIOGRAPHY\b/.test(simple)) && kind === 'body') {
        flush();
        const index = /\bBIBLIOGRAPHY\b/.test(simple) ? 'bibliography' : 'alphabetical';
        out.push({ type: 'tableOfContents', attrs: { entries: [], title: '', index,
          ...(index === 'bibliography' ? { citationStyle: ctx.citationStyle } : {}) } });
        continue;
      }
      const { emit } = scanTocField(el, tocState);
      if (emit && kind === 'body') {
        flush();
        // The field carries no heading of its own — Word's sits in a separate paragraph.
        const instr = instrTextOf(el);
        out.push({ type: 'tableOfContents', attrs: { entries: [], title: '', maxLevel: tocMaxLevel(instr), index: tocIndexKind(instr) } });
      }
      if (startedInToc || emit) continue;
      const num = paragraphNum(el, ctx);
      if (num) {
        breakPending = false; // a break before a list item can't be modeled; drop it
        const para = splitParaAtPageBreaks(convertParagraph(el, ctx, 'list', boldByDefault), 'list').blocks[0];
        while (stack.length && stack[stack.length - 1].ilvl > num.ilvl) closeTop();
        let top = stack[stack.length - 1];
        if (top && top.ilvl === num.ilvl && top.numId !== num.numId) { closeTop(); top = stack[stack.length - 1]; }
        while (stack.length === 0 || stack[stack.length - 1].ilvl < num.ilvl) {
          const ilvl = stack.length ? stack[stack.length - 1].ilvl + 1 : 0;
          stack.push({ ilvl, numId: num.numId, list: makeListNode(ctx, num.numId, ilvl) });
          if (ilvl === num.ilvl) break;
        }
        const targetList = stack[stack.length - 1].list;
        const number = nextListNumber(ctx, num.numId, num.ilvl);
        // A non-list paragraph splits one Word list into separate nodes here; carry the
        // running count onto a fresh ordered node so numbering continues, not restarts at 1.
        if (targetList.type === 'orderedList' && targetList.content!.length === 0 && number > 1) {
          targetList.attrs = { ...(targetList.attrs ?? {}), start: number };
        }
        targetList.content!.push({ type: 'listItem', content: [para] });
      } else {
        flush();
        const { blocks, trailingBreak } = splitParaAtPageBreaks(convertParagraph(el, ctx, kind, boldByDefault), kind);
        if (breakPending) { applyBreakBefore(blocks[0]); breakPending = false; }
        for (const b of blocks) pushWithPending(b);
        breakPending = trailingBreak;
      }
    } else if (el.localName === 'tbl') {
      breakPending = false; // a break before a table can't be modeled; drop it
      flush();
      if (kind === 'body') {
        const t = convertTable(el, ctx);
        if (t) out.push(t);
      } else {
        ctx.warnings.add('Nested tables were flattened to paragraphs');
        out.push(...flattenTable(el, ctx));
      }
    } else if (el.localName === 'sdt') {
      breakPending = false;
      flush();
      if (sdtIsToc(el)) {
        // A content-control-wrapped TOC → one node (regenerated live); skip its content.
        if (kind === 'body') {
          const content = fc(el, 'sdtContent');
          const instr = content ? instrTextOf(content) : '';
          out.push({ type: 'tableOfContents', attrs: {
            entries: [],
            title: tocHeading(content) ?? '',
            maxLevel: tocMaxLevel(instr),
            index: tocIndexKind(instr),
          } });
        }
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

// Word numbering is document-global per numId: a level keeps counting across intervening
// non-list paragraphs (which split the list into separate nodes here) and resets its deeper
// levels whenever a shallower level advances. Returns this item's number.
function nextListNumber(ctx: Ctx, numId: number, ilvl: number): number {
  let per = ctx.listCounters.get(numId);
  if (!per) { per = new Map(); ctx.listCounters.set(numId, per); }
  const cur = per.get(ilvl);
  const n = cur == null ? (ctx.styles.level(numId, ilvl).start ?? 1) : cur + 1;
  per.set(ilvl, n);
  for (const l of Array.from(per.keys())) if (l > ilvl) per.delete(l);
  return n;
}

function paragraphNum(el: Element, ctx: Ctx): { numId: number; ilvl: number } | null {
  const ppr = fc(el, 'pPr');
  let np: { numId: number; ilvl: number } | null = null;
  const numPr = fc(ppr, 'numPr');
  if (numPr) np = readNumPr(numPr);
  if (!np) { const ps = fc(ppr, 'pStyle'); np = ctx.styles.styleNumPr(ps ? wVal(ps) : null); }
  return np && np.numId !== 0 ? np : null; // numId 0 = "no list"
}

// Cycle position of level `ilvl` — walks the shallower levels of the same numbering,
// advancing one slot each and re-anchoring slot + suffix at explicit ordered formats
// (like the ODT importer), so an attr-less nested default advances past its parent.
function listBaseCycle(ctx: Ctx, numId: number, ilvl: number): OrderedCycle {
  let cycle = ROOT_ORDERED_CYCLE;
  for (let l = 0; l < ilvl; l++) {
    const d = ctx.styles.level(numId, l);
    const bullet = !d.numFmt || d.numFmt === 'bullet' || d.numFmt === 'none';
    const key = bullet ? null : orderedTypeFromFormat(wordFmtChar(d.numFmt), lvlSuffix(d.lvlText));
    cycle = childCycle(cycle, key, !bullet);
  }
  return cycle;
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
      const attr = orderedTypeAttrAt(key, listBaseCycle(ctx, numId, ilvl));
      if (attr) attrs.listStyleType = attr;
    }
    if (def.start != null && def.start > 1) attrs.start = def.start;
  }
  if (def.leftTwip != null) {
    // A level's w:ind w:left is absolute, the editor nests one LIST_LEFT_STEP_CM per
    // level — so the attr is this level's step past the one above. Signed (w:left="360"
    // is a common one) and floored there, so the list stays in the text column.
    const leftCm = (l: number) => {
      const t = ctx.styles.level(numId, l).leftTwip;
      return t != null ? twipToCm(t) : (l + 1) * LIST_LEFT_STEP_CM;
    };
    const step = leftCm(ilvl) - (ilvl === 0 ? 0 : leftCm(ilvl - 1));
    const extra = round2(Math.max(-LIST_LEFT_STEP_CM, step - LIST_LEFT_STEP_CM));
    if (Math.abs(extra) > LIST_INDENT_EPS_CM) attrs.indent = extra;
  }
  if (def.rightAligned) attrs.markerAlign = 'right';
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

// Split a converted body paragraph at run-level page breaks (PB_MARKER): each break
// starts a new block via breakBefore: 'page'. A break at the paragraph's end reports
// trailingBreak so the caller moves the NEXT block. Cells/lists just strip the markers.
function splitParaAtPageBreaks(para: Node, kind: BlockKind): { blocks: Node[]; trailingBreak: boolean } {
  const content = para.content ?? [];
  if (!content.some((n) => n.type === PB_MARKER)) return { blocks: [para], trailingBreak: false };
  if (kind !== 'body') {
    const kept = content.filter((n) => n.type !== PB_MARKER);
    if (kept.length) para.content = kept; else delete para.content;
    return { blocks: [para], trailingBreak: false };
  }
  const segs: Node[][] = [[]];
  for (const n of content) {
    if (n.type === PB_MARKER) segs.push([]);
    else segs[segs.length - 1].push(n);
  }
  let trailingBreak = false;
  if (segs.length > 1 && segs[segs.length - 1].length === 0) { segs.pop(); trailingBreak = true; }
  const blocks = segs.map((seg, i) => {
    const node: Node = { type: para.type };
    const attrs = { ...(para.attrs ?? {}) };
    if (i > 0) attrs.breakBefore = 'page';
    if (Object.keys(attrs).length) node.attrs = attrs;
    if (seg.length) node.content = seg;
    return node;
  });
  return { blocks, trailingBreak };
}

// What a block's named style already provides — the yardstick for "is this direct
// formatting?" (mirrors import/odt.ts blockDefaults).
type BlockDefaults = {
  fontSizePt: number;
  boldByDefault: boolean;
  fonts: Set<string>;
  color: string;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  caps: CapsMode | null;
};

const FONT_TWINS: Record<string, string[]> = {
  'times new roman': ['liberation serif'],
  'liberation serif': ['times new roman'],
  arial: ['liberation sans'],
  'liberation sans': ['arial'],
};

// baseRun = docDefaults ← the paragraph style's basedOn chain, i.e. exactly what the
// style gives its runs.
function blockDefaults(baseRun: RunProps, headingLevel: number | null, boldByDefault: boolean): BlockDefaults {
  const fonts = new Set(headingLevel != null ? DEFAULT_HEADING_FONTS : DEFAULT_FONTS);
  const family = baseRun.font?.toLowerCase();
  if (family) {
    fonts.add(family);
    for (const twin of FONT_TWINS[family] ?? []) fonts.add(twin);
  }
  return {
    fontSizePt: baseRun.sizeHalfPt != null ? baseRun.sizeHalfPt / 2
      : headingLevel != null ? HEADING_SIZES[headingLevel - 1] : BODY_FONT_SIZE_PT,
    boldByDefault: baseRun.bold ?? (headingLevel != null || boldByDefault),
    fonts,
    color: hexColor(baseRun.color) ?? '#000000',
    italic: baseRun.italic ?? (headingLevel != null && HEADING_ITALIC[headingLevel - 1]),
    underline: !!baseRun.underline,
    strike: !!baseRun.strike,
    caps: baseRun.caps || null,
  };
}

// The style a paragraph names, else Word's default paragraph style.
function styleIdOf(ppr: Element | null, ctx: Ctx): string | null {
  const ps = fc(ppr, 'pStyle');
  return (ps ? wVal(ps) : null) ?? ctx.styles.defaultParagraphStyle();
}

// Word's own names for the standard styles map onto the editor's registry names.
// `isDefault` marks the document's default paragraph style (Word calls it Normal,
// LibreOffice writes styleId "Standard" with the name "Normal").
function registryName(id: string, wordName: string, isDefault: boolean): string {
  if (isDefault || id === 'Normal' || /^normal$/i.test(wordName)) return DEFAULT_STYLE;
  const heading = /^Heading\s?(10|[1-9])$/i.exec(id) ?? /^heading\s?(10|[1-9])$/i.exec(wordName);
  if (heading) return `Heading ${heading[1]}`;
  if (/^Title$/i.test(id)) return 'Title';
  if (/^Subtitle$/i.test(id)) return 'Subtitle';
  if (/^Quote$/i.test(id) || /^Quotations?$/i.test(id)) return 'Quotations';
  return wordName || id;
}

// What a style declares itself: its resolved props minus the parent's.
function ownProps<T extends object>(resolved: T, parent: T): T {
  const out = {} as T;
  for (const key of Object.keys(resolved) as (keyof T)[]) {
    if (resolved[key] !== undefined && resolved[key] !== parent[key]) out[key] = resolved[key];
  }
  return out;
}

function stylePara(ctx: Ctx, id: string | null): ParaProps {
  if (!id) return {};
  const out: ParaProps = {};
  const sp = ctx.styles.paragraphSpacing(id);
  if (sp.before != null) out.spaceBefore = snapPt(twipToPt(sp.before));
  if (sp.after != null) out.spaceAfter = snapPt(twipToPt(sp.after));
  // Not suppressed against single spacing — the document default may be something else
  // (Word writes 1.08), and a style declaring 1 would then inherit that instead. What
  // the parent style already supplies is dropped by the caller's ownProps.
  if (sp.line != null && (!sp.lineRule || sp.lineRule === 'auto')) {
    out.lineHeight = String(round2(sp.line / 240));
  }
  const jc = ctx.styles.paragraphAlign(id);
  if (jc === 'center') out.textAlign = 'center';
  else if (jc === 'both' || jc === 'distribute') out.textAlign = 'justify';
  else if (jc === 'right' || jc === 'end') out.textAlign = 'right';
  else if (jc === 'left' || jc === 'start') out.textAlign = 'left';
  const ind = ctx.styles.styleIndentTwip(id);
  if (ind != null) out.indent = round2(twipToCm(ind));
  // The style's own rule lines and colored field — a Title's rule lives here, not on the
  // block, so every paragraph the style governs draws it (styleCss).
  const shd = ctx.styles.paragraphShading(id);
  const fill = shd ? hexColor(shd.getAttributeNS(W, 'fill')) : undefined;
  if (fill) out.backgroundColor = fill;
  let space: number | null = null;
  for (const [wSide, attr] of PARA_BORDER_SIDES) {
    for (const pBdr of ctx.styles.paragraphBorders(id)) {
      const side = fc(pBdr, wSide);
      if (!side) continue;
      const v = paraBorderAttr(side);
      if (v) {
        out[attr] = v;
        // w:space is in whole points, per side; the widest gap is the paragraph's.
        space = Math.max(space ?? 0, intAttr(side, W, 'space') ?? 0);
      }
      break; // the nearest level that declares the side decides it
    }
  }
  if (space) out.borderPadding = space;
  return out;
}

// `own` reads the style's own chain without docDefaults — a character style adds to the
// paragraph's formatting, so the document defaults are not its properties.
function styleText(ctx: Ctx, id: string | null, own = false): TextProps {
  if (!id) return {};
  // A character style adds to the run it decorates, so its own chain saying nothing
  // about kerning means "unchanged", not Word's off.
  if (own) { const t = runTextProps(ctx.styles.styleOwn(id)); delete t.kerning; return t; }
  // A paragraph style naming no font uses the document's theme (minorHAnsi for body,
  // majorHAnsi for headings) — the family single line spacing is measured against.
  const run = ctx.styles.paragraphRun(id);
  const font = run.font ?? ctx.styles.themeFont(run.fontTheme ?? 'minor');
  return runTextProps(font ? { ...run, font } : run);
}

function runTextProps(run: RunProps): TextProps {
  const out: TextProps = {};
  // Our own export declares the metric twin; keep the registry on the on-screen name.
  if (run.font) out.fontFamily = run.font === 'Times New Roman' ? 'Liberation Serif'
    : run.font === 'Arial' ? 'Liberation Sans' : run.font;
  if (run.sizeHalfPt != null) out.fontSizePt = Math.round((run.sizeHalfPt / 2) * 10) / 10;
  if (run.spacingTwip) out.letterSpacingPt = Math.round((run.spacingTwip / 20) * 100) / 100;
  // Word kerns nothing unless w:kern names the size to start at, and a document that
  // says so for headings only leaves body text unkerned (probed against LibreOffice).
  const kern = run.kernHalfPt ?? 0;
  out.kerning = kern > 0 && (run.sizeHalfPt == null || run.sizeHalfPt >= kern);
  if (run.bold != null) out.bold = run.bold;
  if (run.italic != null) out.italic = run.italic;
  if (run.underline != null) out.underline = run.underline;
  if (run.strike != null) out.strike = run.strike;
  const color = hexColor(run.color);
  if (color) out.color = color;
  if (run.caps) out.caps = run.caps;
  return out;
}

// The document's style registry: the built-ins with the file's own definitions merged
// over them — only the styles blocks reference, plus their parent chains.
function collectStyleSheet(ctx: Ctx): StyleSheet {
  const defs = ctx.styles.namedParagraphStyles();
  const sheet = builtinStyleSheet();
  const keep = new Set<string>();
  // Body paragraphs carry no w:pStyle, so the default style never reaches usedStyles —
  // yet run suppression resolves against it, so Standard has to carry it or the file's
  // body font is dropped without any run mark taking its place.
  const roots = new Set(ctx.usedStyles);
  const defaultId = ctx.styles.defaultParagraphStyle();
  if (defaultId) roots.add(defaultId);
  for (const id of roots) {
    let cur: string | null = id;
    const seen = new Set<string>();
    while (cur && defs.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      keep.add(cur);
      cur = defs.get(cur)!.basedOn;
    }
  }
  for (const id of keep) {
    const def = defs.get(id)!;
    const name = ctx.styleNames.get(id) ?? def.name;
    const parentId = def.basedOn;
    const parent = parentId ? ctx.styleNames.get(parentId) ?? parentId : null;
    const builtin = sheet.paragraph[name];
    const style: Style = {
      name,
      parent: parent && parent !== name ? parent : builtin?.parent ?? null,
      next: builtin?.next ?? null,
      builtin: builtin?.builtin,
      para: ownProps(stylePara(ctx, id), stylePara(ctx, parentId)),
      text: ownProps(styleText(ctx, id), styleText(ctx, parentId)),
    };
    const level = /^Heading (\d+)$/.exec(name);
    if (level) style.outlineLevel = Number(level[1]);
    sheet.paragraph[name] = style;
  }
  // w:docDefaults alone can carry the body font (a file need not declare a default
  // style), and it is what run suppression compares against — so Standard tracks it.
  const standard = sheet.paragraph[DEFAULT_STYLE];
  if (standard) standard.text = { ...standard.text, ...runTextProps(ctx.styles.paragraphRun(null)) };
  for (const id of ctx.usedCharStyles) {
    const name = ctx.charStyleNames.get(id) ?? id;
    const builtin = sheet.character[name];
    sheet.character[name] = {
      name, parent: null, next: null, builtin: builtin?.builtin,
      para: {}, text: styleText(ctx, id, true),
    };
  }
  return sheet;
}

function convertParagraph(el: Element, ctx: Ctx, kind: BlockKind, boldByDefault: boolean): Node {
  const ppr = fc(el, 'pPr');
  const pStyle = fc(ppr, 'pStyle');
  const level = headingLevelOf(ppr, ctx);
  // Alignment: direct w:pPr/w:jc wins, else resolve it from the style chain (the default
  // paragraph style commonly carries justify), so style-level alignment isn't lost.
  const directJc = fc(ppr, 'jc');
  const jcVal = directJc ? wVal(directJc) : ctx.styles.paragraphAlign(pStyle ? wVal(pStyle) : null);
  const styleId = styleIdOf(ppr, ctx);
  // Only DIRECT w:pPr counts as formatting on the block; the style's own lives in the
  // registry — except in a cell, which carries no style name, so its chain is baked in
  // over the table style's w:pPr (probed: that ranks *below* the paragraph style).
  const attrs = blockAttrs(ppr, kind, level, directJc ? jcVal : null,
    kind === 'cell' ? ctx.styles.paragraphSpacing(styleId, ctx.cellSpacing) : {});
  applyContextualSpacing(el, ppr, ctx, styleId, attrs);
  // The baked-in cell chain must not accrete no-op direct formatting: in a cell,
  // unset spacing renders 0/0 (no word processor passes the default style's spacing
  // into a cell), and single line height is only kept over a non-single default.
  if (kind === 'cell') {
    if (attrs.spaceBefore === 0) delete attrs.spaceBefore;
    if (attrs.spaceAfter === 0) delete attrs.spaceAfter;
    const def = ctx.styles.paragraphSpacing(null);
    const defSingle = (def.line ?? 240) === 240 && (!def.lineRule || def.lineRule === 'auto');
    if (attrs.lineHeight === '1' && defSingle) delete attrs.lineHeight;
  }
  // Widow-orphan control has no registry home, so the resolved value rides the block.
  const directWc = fc(ppr, 'widowControl');
  if (!(directWc ? onOff(directWc) : ctx.styles.paragraphWidowControl(styleId))) {
    attrs.widowControl = false;
  }
  const directKn = fc(ppr, 'keepNext');
  if (!level && (directKn ? onOff(directKn) : ctx.styles.paragraphKeepNext(styleId))) attrs.keepNext = true;
  const directKl = fc(ppr, 'keepLines');
  if (!level && (directKl ? onOff(directKl) : ctx.styles.paragraphKeepLines(styleId))) attrs.keepLines = true;
  // "Don't hyphenate this paragraph" — only formatting where the document hyphenates
  // at all; below that switch it says what is already true.
  const directSah = fc(ppr, 'suppressAutoHyphens');
  if (ctx.hyphenate && directSah && onOff(directSah)) attrs.noHyphenation = true;
  // w:bidi — the block's own base direction; the section's own is inheritance, not
  // formatting, so only a block that differs from it carries the attr.
  const directBidi = fc(ppr, 'bidi');
  const bidi = directBidi ? onOff(directBidi) : ctx.styles.paragraphBidi(styleId);
  if (bidi != null && bidi !== ctx.pageRtl) attrs.dir = bidi ? 'rtl' : 'ltr';
  // Tab stops: a direct w:tabs replaces the style's, which the resolver walks for.
  const directTabs = fc(ppr, 'tabs');
  const stops = formatTabStops(directTabs ? readTabStops(directTabs) : ctx.styles.paragraphTabs(styleId));
  if (stops) attrs.tabStops = stops;
  const baseRun = ctx.styles.paragraphRun(styleId);
  const name = styleId && kind === 'body' ? ctx.styleNames.get(styleId) : undefined;
  // A block that cannot carry its style's name — one in a cell or a text box — has to
  // carry the formatting instead, so it is measured against the default style: the only
  // thing re-applied on import. A caption's italic and colour live nowhere else.
  const defaults = blockDefaults(name ? baseRun : ctx.styles.paragraphRun(ctx.styles.defaultParagraphStyle()), level, boldByDefault);
  // A run inherits the block's own size, not the default style's, so that is what it is
  // measured against — else a size the block overrides is suppressed and lost (odt.ts).
  const ownSizePt = blockDefaults(baseRun, level, boldByDefault).fontSizePt;
  const runDefaults = Math.abs(ownSizePt - defaults.fontSizePt) > 0.05
    ? { ...defaults, fontSizePt: ownSizePt }
    : defaults;
  const content = convertInline(el, ctx, baseRun, runDefaults, false);

  if (name) {
    ctx.usedStyles.add(styleId!);
    if (name !== (level ? `Heading ${level}` : DEFAULT_STYLE)) attrs.styleName = name;
  }

  // The paragraph mark's own run props (w:pPr/w:rPr) set the line-height floor for
  // every line, not just an empty one — a block whose text is smaller than its style
  // would otherwise keep the style's taller strut. Carried as a block attr.
  const fs = paragraphMarkFontSize(ppr, ctx, baseRun, defaults.fontSizePt);
  if (fs) attrs.fontSize = fs;
  const ff = paragraphMarkFont(ppr, ctx, baseRun, defaults.fonts);
  if (ff) attrs.fontFamily = ff;
  applyUniformRunFont(attrs, content);
  sinkOffsetFrames(content);

  const node: Node = { type: level ? 'heading' : 'paragraph' };
  if (level) attrs.level = level;
  if (Object.keys(attrs).length) node.attrs = attrs;
  if (content.length) node.content = content;
  return node;
}

// w:contextualSpacing drops a paragraph's own spacing towards a neighbour of the same
// style — Word's List Paragraph carries it, which is why list points sit line-tight. The
// editor has no such mode, so the suppressed side becomes an explicit 0.
function applyContextualSpacing(el: Element, ppr: Element | null, ctx: Ctx, styleId: string | null, attrs: Record<string, unknown>): void {
  const direct = fc(ppr, 'contextualSpacing');
  if (!(direct ? onOff(direct) : ctx.styles.paragraphContextualSpacing(styleId))) return;
  const sameStyle = (sib: Element | null) =>
    !!sib && sib.namespaceURI === W && sib.localName === 'p' && styleIdOf(fc(sib, 'pPr'), ctx) === styleId;
  if (sameStyle(el.previousElementSibling)) attrs.spaceBefore = 0;
  if (sameStyle(el.nextElementSibling)) attrs.spaceAfter = 0;
}

// The paragraph mark's resolved font size (w:pPr/w:rPr, incl. its rStyle), as a CSS
// pt string, or null when it matches what the block renders at anyway (suppressed
// like run sizes, against the same yardstick).
function paragraphMarkFontSize(ppr: Element | null, ctx: Ctx, baseRun: RunProps, defaultPt: number): string | null {
  const rPr = fc(ppr, 'rPr');
  const rStyle = fc(rPr, 'rStyle');
  const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
  if (props.sizeHalfPt == null) return null;
  const sizePt = props.sizeHalfPt / 2;
  return Math.abs(sizePt - defaultPt) > 0.05 ? `${Math.round(sizePt * 10) / 10}pt` : null;
}

// The paragraph mark's resolved font family (w:pPr/w:rPr/w:rFonts, incl. its rStyle),
// or null when it is what the block renders at anyway.
function paragraphMarkFont(ppr: Element | null, ctx: Ctx, baseRun: RunProps, blockFonts: Set<string>): string | null {
  const rPr = fc(ppr, 'rPr');
  const rStyle = fc(rPr, 'rStyle');
  const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
  const font = props.font ?? ctx.styles.themeFont(props.fontTheme ?? 'minor');
  return !font || blockFonts.has(font.toLowerCase()) ? null : font;
}

// Heading + clamped level. Detect via the paragraph style id (fast path for our own
// files / English Word), then the style's resolved outline level (locale-independent,
// catches LibreOffice/localized heading styles), then a direct paragraph outline level.
function headingLevelOf(ppr: Element | null, ctx: Ctx): number | null {
  const clamp = (n: number) => Math.min(MAX_HEADING_LEVEL, Math.max(1, n));
  if (!ppr) return null;
  const ps = fc(ppr, 'pStyle');
  const id = ps ? wVal(ps) : null;
  if (id) {
    const m = /^Heading\s?(10|[1-9])$/i.exec(id);
    if (m) return clamp(parseInt(m[1], 10));
    const ol = ctx.styles.styleOutlineLvl(id);
    if (ol != null && ol >= 0 && ol <= 8) return clamp(ol + 1);
  }
  const olEl = fc(ppr, 'outlineLvl');
  const n = olEl ? parseInt(wVal(olEl) ?? '', 10) : NaN;
  if (Number.isFinite(n) && n >= 0 && n <= 8) return clamp(n + 1);
  return null;
}

// Spacing = the style chain's w:spacing (styleSpacing, resolved by the caller) overridden
// per-attribute by DIRECT w:pPr; indent comes from direct w:pPr only. jcVal is resolved
// through the chain by the caller.
function blockAttrs(ppr: Element | null, kind: BlockKind, headingLevel: number | null, jcVal: string | null, styleSpacing: ParaSpacing): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  if (jcVal === 'center') attrs.textAlign = 'center';
  else if (jcVal === 'both' || jcVal === 'distribute') attrs.textAlign = 'justify';
  else if (jcVal === 'right' || jcVal === 'end') attrs.textAlign = 'right';

  const sp = ppr ? fc(ppr, 'spacing') : null;
  const before = (sp ? intAttr(sp, W, 'before') : null) ?? styleSpacing.before ?? null;
  const after = (sp ? intAttr(sp, W, 'after') : null) ?? styleSpacing.after ?? null;
  const line = (sp ? intAttr(sp, W, 'line') : null) ?? styleSpacing.line ?? null;
  const rule = (sp && sp.getAttributeNS(W, 'lineRule')) || styleSpacing.lineRule || null;
  // An attribute no layer sets is Word's implied 0, which is also the editor's paragraph
  // default (editor.css) — so it stays unset rather than accreting an explicit 0.
  if (before != null) attrs.spaceBefore = snapPt(twipToPt(before));
  if (after != null) attrs.spaceAfter = snapPt(twipToPt(after));
  // Single spacing is written out too: the block's own style may set another one, and
  // then an unset attr is not the same thing.
  if (line != null && (!rule || rule === 'auto')) attrs.lineHeight = String(round2(line / 240));

  if (!ppr) return attrs;

  if (kind !== 'list') {
    const ind = fc(ppr, 'ind');
    const left = ind ? intAttr(ind, W, 'left') ?? intAttr(ind, W, 'start') : null;
    if (left != null) { const cm = round2(twipToCm(left)); if (cm > LIST_INDENT_EPS_CM) attrs.indent = cm; }
    const right = ind ? intAttr(ind, W, 'right') ?? intAttr(ind, W, 'end') : null;
    if (right != null) { const cm = round2(twipToCm(right)); if (cm > LIST_INDENT_EPS_CM) attrs.indentRight = cm; }
    // w:hanging outdents the first line, w:firstLine indents it; they are exclusive.
    const hanging = ind ? intAttr(ind, W, 'hanging') : null;
    const firstLine = ind ? intAttr(ind, W, 'firstLine') : null;
    const first = hanging != null ? -twipToCm(hanging) : firstLine != null ? twipToCm(firstLine) : null;
    if (first != null && Math.abs(first) > LIST_INDENT_EPS_CM) attrs.indentFirst = round2(first);
  }

  if (kind === 'body') {
    const pb = fc(ppr, 'pageBreakBefore');
    if (pb && onOff(pb)) attrs.breakBefore = 'page';
  }

  // Paragraph background ("colored field", w:shd) + per-side borders ("rule line", w:pBdr).
  Object.assign(attrs, readParaBox(ppr));
  return attrs;
}

// Paragraph background + per-side border attrs (paragraphBox.ts) from direct w:pPr.
// Shading: w:shd/@w:fill; borders: w:pBdr/w:{top,right,bottom,left} (w:sz in eighths of a
// point). Sides with w:val none/nil are skipped. Matches the ODF paraBoxAttrs shape.
function readParaBox(ppr: Element | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!ppr) return out;
  const shd = fc(ppr, 'shd');
  const fill = shd ? hexColor(shd.getAttributeNS(W, 'fill')) : undefined;
  if (fill) out.backgroundColor = fill;

  const pBdr = fc(ppr, 'pBdr');
  if (pBdr) {
    for (const [wSide, attr] of PARA_BORDER_SIDES) {
      const v = paraBorderAttr(fc(pBdr, wSide));
      if (v) out[attr] = v;
    }
  }
  return out;
}

const PARA_BORDER_SIDES = [
  ['top', 'borderTop'], ['right', 'borderRight'], ['bottom', 'borderBottom'], ['left', 'borderLeft'],
] as const;

// One w:pBdr side → the canonical '<W>pt solid #RRGGBB'. null when it draws nothing:
// unlike a table cell, a paragraph has no 0.5pt-black default to collapse against.
function paraBorderAttr(b: Element | null): string | null {
  if (!b) return null;
  const val = b.getAttributeNS(W, 'val');
  if (!val || val === 'none' || val === 'nil') return null;
  const sz = intAttr(b, W, 'sz'); // eighths of a point
  const widthPt = sz != null ? Math.round((sz / 8) * 100) / 100 : 0.5;
  return `${widthPt}pt solid ${hexColor(b.getAttributeNS(W, 'color')) ?? '#000000'}`;
}

function snapPt(v: number): number {
  const r = Math.round(v * 100) / 100;
  const i = Math.round(r);
  return Math.abs(r - i) <= 0.03 ? i : r;
}

// ---- inline conversion (runs, marks, fields, images) -----------------------

// Word wraps a citation or any content control in a w:sdt holding ordinary inline
// content — walk through the wrapper, or those runs never reach the paragraph.
function inlineChildren(el: Element): Element[] {
  return Array.from(el.children).flatMap((c) => {
    if (c.namespaceURI !== W || c.localName !== 'sdt') return [c];
    const content = fc(c, 'sdtContent');
    return content ? inlineChildren(content) : [];
  });
}

// A w:footnoteReference → the anchor node, with the note's own paragraphs collected
// into ctx for the section the document end gets. Word's numbering is implicit, so the
// citation is counted here; several paragraphs flatten to hard breaks.
function noteRefNode(wid: string | null, kind: NoteKind, ctx: Ctx, baseRun: RunProps, defaults: BlockDefaults, label: string | null = null): Node | null {
  const note = wid == null ? null : ctx.noteParts[kind].get(wid);
  if (!note) return null;
  const content: Node[] = [];
  for (const para of Array.from(note.children)) {
    if (para.namespaceURI !== W || para.localName !== 'p') continue;
    const runs = convertInline(para, ctx, baseRun, defaults, false);
    if (content.length && runs.length) content.push({ type: 'hardBreak' });
    content.push(...runs);
  }
  // Word opens the note with its own marker run and a tab; the editor draws both from
  // the note's own indent, so the leading tab would be a second one.
  const first = content[0];
  if (first?.type === 'text' && typeof first.text === 'string') {
    first.text = first.text.replace(/^\t+/, '');
    if (!first.text) content.shift();
  }
  const seen = ctx.notes.filter((n) => n.kind === kind).length;
  const text = label ?? formatOrdinal(seen + 1, kind === 'endnote' ? 'i' : '1');
  // A custom-marked note repeats the literal character where <w:footnoteRef/> would
  // sit; the editor draws the mark itself, so strip it off the body.
  const bodyFirst = content[0];
  if (label && bodyFirst?.type === 'text' && typeof bodyFirst.text === 'string' && bodyFirst.text.startsWith(label)) {
    bodyFirst.text = bodyFirst.text.slice(label.length).replace(/^\t+/, '');
    if (!bodyFirst.text) content.shift();
  }
  const id = `${kind}${wid}`;
  // The note renders at the file's own size and indent: its first paragraph names the
  // style (Word's FootnoteText), and collectStyleSheet only keeps a style in use.
  // A style that only re-states the stock look (10pt, nothing else changed against the
  // default) equals a styleName-less note and is suppressed like any default-equal value.
  const firstPara = Array.from(note.children).find((c) => c.namespaceURI === W && c.localName === 'p');
  const pStyle = fc(fc(firstPara ?? null, 'pPr'), 'pStyle');
  const styleId = pStyle ? wVal(pStyle) : null;
  const styleName = styleId && !isStockNoteStyle(ctx, styleId) ? ctx.styleNames.get(styleId) ?? null : null;
  if (styleId && styleName) ctx.usedStyles.add(styleId);
  ctx.notes.push({ id, kind, label, text, content, styleName });
  return { type: 'noteRef', attrs: { id, kind, text } };
}

// A note style is "stock" when it resolves to 10pt over the default style with nothing
// else of its own — the look a styleName-less note already renders.
function isStockNoteStyle(ctx: Ctx, styleId: string): boolean {
  const run = ctx.styles.paragraphRun(styleId), base = ctx.styles.paragraphRun(null);
  if (run.sizeHalfPt !== 20) return false;
  const keys = ['bold', 'italic', 'underline', 'strike', 'color', 'font', 'fontTheme', 'highlightFill', 'caps'] as const;
  if (!keys.every((k) => (run[k] ?? null) === (base[k] ?? null))) return false;
  if (ctx.styles.paragraphAlign(styleId) !== ctx.styles.paragraphAlign(null)) return false;
  const sp = ctx.styles.paragraphSpacing(styleId);
  return !sp.before && !sp.after && (ctx.styles.styleIndentTwip(styleId) ?? 0) === 0;
}

function convertInline(p: Element, ctx: Ctx, baseRun: RunProps, defaults: BlockDefaults, hfFields: boolean): Node[] {
  const out: Node[] = [];
  let fieldMode: 'none' | 'instr' | 'result' = 'none';
  let fieldInstr = '';
  // A recognized body date/time field: its cached result runs are dropped and a live
  // dateTimeField node is emitted in their place when the field ends.
  let fieldDateTime: Node | null = null;
  // Same for a REF/PAGEREF field, a CITATION and a caption's SEQ: the cached result runs
  // are collected as the node's display text instead of being pushed.
  let fieldShown: Node | null = null;
  let fieldSeq: Node | null = null;
  let fieldResultText = '';

  const pushText = (text: string, marks: Mark[]) => {
    if (!text) return;
    // The one-paragraph header/footer schema has neither a bookmark nor a comment mark.
    const bookmark = hfFields ? null : openBookmarkMark(ctx);
    const comment = hfFields ? null : openCommentMark(ctx);
    const all = [...marks, ...(bookmark ? [bookmark] : []), ...(comment ? [comment] : [])];
    const node: Node = { type: 'text', text };
    if (all.length) node.marks = all;
    out.push(node);
  };

  // A run may hold a whole field (begin/instrText/separate/end) or just part of one,
  // so walk its children in order and keep the field state across runs.
  // Resolved marks for a run element (font/size/color/etc.), including a link mark.
  const runMarks = (r: Element, linkHref?: string): Mark[] => {
    const rPr = fc(r, 'rPr');
    const rStyle = fc(rPr, 'rStyle');
    const charId = rStyle ? wVal(rStyle) : null;
    const charName = charId ? ctx.charStyleNames.get(charId) : undefined;
    // A named character style: its formatting belongs to the style, so it joins the
    // yardstick and the run only keeps what goes beyond it.
    const styleRun = ctx.styles.styleOwn(charId);
    const runDefaults = charName ? blockDefaults(mergeRunProps(baseRun, styleRun), null, defaults.boldByDefault) : defaults;
    const props = mergeRunProps(mergeRunProps(baseRun, styleRun), parseRunProps(rPr));
    // No font resolved anywhere: fall back to the document's own theme (not the editor
    // default) — Word's implicit default is the minor font for body text, the major one
    // for headings.
    if (!props.font) {
      props.font = ctx.styles.themeFont(props.fontTheme ?? (runDefaults.boldByDefault ? 'major' : 'minor'));
    }
    const marks = marksFor(props, runDefaults, !!linkHref);
    if (charName) {
      ctx.usedCharStyles.add(charId!);
      marks.push({ type: 'charStyle', attrs: { name: charName } });
    }
    if (linkHref) {
      // Word never paints a hyperlink for being one: the blue is its Hyperlink character
      // style, which arrives as an ordinary run mark, so the editor must add nothing of
      // its own. Only our exporter's blue is an editor link — it is stripped above.
      const ours = hexColor(props.color)?.toUpperCase() === LINK_BLUE;
      marks.push({ type: 'link', attrs: { href: linkHref, plain: !ours } });
    }
    return marks;
  };

  // A recorded revision (w:ins/w:del). Its runs keep their formatting and take the
  // mark; a deletion's text sits in w:delText, which handleRun reads as ordinary text.
  const handleRevision = (el: Element, linkHref?: string) => {
    const kind = el.localName === 'del' ? 'deletion' : 'insertion';
    const attrs = {
      id: el.getAttributeNS(W, 'id') ?? '',
      author: el.getAttributeNS(W, 'author') ?? '',
      date: el.getAttributeNS(W, 'date') ?? '',
    };
    const before = out.length;
    for (const r of fcAll(el, 'r')) handleRun(r, linkHref);
    if (!hfFields) {
      for (let i = before; i < out.length; i++) {
        if (out[i].type !== 'text') continue;
        out[i].marks = [...(out[i].marks ?? []), { type: kind, attrs }];
      }
    }
  };

  const handleRun = (r: Element, linkHref?: string) => {
    const marks = runMarks(r, linkHref);
    // Hide a field's cached result: always for a hf field, and for a recognized body
    // date/time field (replaced by its live node).
    const skipResult = () => fieldMode === 'result' && (hfFields || !!fieldDateTime || !!fieldShown);

    // Route a drawing/pict result: an image is inline, a text box a block node riding
    // ctx.pendingBlocks. The one-paragraph header/footer zone takes as-char images only —
    // boxes and floating page-sized drawings (backgrounds, watermarks) are dropped there.
    const pushDrawn = (n: Node | null, floating: boolean) => {
      if (!n) return;
      if (hfFields) {
        if (n.type === 'image' && !floating) { out.push({ ...n, attrs: { ...n.attrs, wrap: 'inline' } }); return; }
        ctx.warnings.add('Drawings were removed');
        return;
      }
      if (n.type !== 'textBox') { out.push(n); return; }
      ctx.pendingBlocks.push(n);
    };

    // Set when this run's w:footnoteReference declares a custom mark: the run's own
    // w:t is the mark, consumed by the anchor rather than pushed as text.
    let customMark: string | null = null;
    for (const child of Array.from(r.children)) {
      // Word wraps every shape in mc:AlternateContent; use only the mc:Choice branch
      // (the mc:Fallback VML duplicates it and would double-import).
      if (child.namespaceURI === MC && child.localName === 'AlternateContent') {
        const choice = Array.from(child.children).find((c) => c.namespaceURI === MC && c.localName === 'Choice');
        const drawing = choice?.getElementsByTagNameNS(W, 'drawing')[0];
        if (drawing) pushDrawn(convertDrawing(drawing, ctx), drawingIsFloating(drawing));
        else {
          const pict = Array.from(child.children)
            .find((c) => c.namespaceURI === MC && c.localName === 'Fallback')
            ?.getElementsByTagNameNS(W, 'pict')[0];
          if (pict) pushDrawn(convertPict(pict, ctx), drawingIsFloating(pict));
          else ctx.warnings.add('Drawings were removed');
        }
        continue;
      }
      if (child.namespaceURI !== W) continue;
      switch (child.localName) {
        case 'fldChar': {
          const t = child.getAttributeNS(W, 'fldCharType');
          if (t === 'begin') { fieldMode = 'instr'; fieldInstr = ''; fieldDateTime = null; fieldShown = null; fieldSeq = null; fieldResultText = ''; }
          else if (t === 'separate') {
            fieldMode = 'result';
            if (!hfFields) {
              fieldDateTime = dateTimeFieldFromInstr(fieldInstr);
              fieldSeq = fieldDateTime ? null : seqFieldFromInstr(fieldInstr);
              fieldShown = fieldDateTime || fieldSeq ? null : (crossRefFromInstr(fieldInstr) ?? citationFromInstr(fieldInstr, ctx));
              fieldResultText = '';
              // Carry the field run's marks so the atom renders in the run's font.
              const field = fieldDateTime ?? fieldSeq ?? fieldShown;
              if (field && marks.length) field.marks = marks;
            }
          } else if (t === 'end') {
            // A reference Word never resolved has no w:separate and so no cached result
            // (it shows nothing until the field is updated); the node view fills it in
            // when the bookmark is still there.
            if (!hfFields && !fieldDateTime && !fieldShown && !fieldSeq) {
              fieldShown = crossRefFromInstr(fieldInstr) ?? citationFromInstr(fieldInstr, ctx);
              if (fieldShown && marks.length) fieldShown.marks = marks;
            }
            if (fieldDateTime) out.push(fieldDateTime);
            else if (fieldSeq) out.push({ ...fieldSeq, attrs: { ...fieldSeq.attrs, number: seqNumberOf(fieldResultText) } });
            else if (fieldShown) out.push({ ...fieldShown, attrs: { ...fieldShown.attrs, text: fieldResultText } });
            else {
              const mark = !hfFields && indexEntryFromInstr(fieldInstr);
              if (mark) out.push(mark);
              else emitField(out, fieldInstr, hfFields, marks);
            }
            fieldMode = 'none';
            fieldDateTime = null;
            fieldShown = null;
            fieldSeq = null;
          }
          break;
        }
        case 'instrText': if (fieldMode === 'instr') fieldInstr += child.textContent ?? ''; break;
        // w:delText is a deleted run's text — the same content, kept because the
        // revision is only recorded, not applied.
        case 'delText':
        case 't':
          if (customMark !== null && (child.textContent ?? '') === customMark) { customMark = null; break; }
          if ((fieldShown || fieldSeq) && fieldMode === 'result') fieldResultText += child.textContent ?? '';
          else if (!skipResult()) pushText(child.textContent ?? '', marks);
          break;
        case 'ruby': {
          // Word nests both halves in runs of their own; the editor keeps them as one
          // atom, so only their text is read.
          const base = fcAll(child, 'rubyBase')[0]?.textContent ?? '';
          const reading = fcAll(child, 'rt')[0]?.textContent ?? '';
          if (base.trim() && !skipResult()) out.push({ type: 'ruby', attrs: { base: base.trim(), text: reading.trim() } });
          break;
        }
        case 'tab': if (!skipResult()) pushText('\t', marks); break;
        case 'br': out.push(child.getAttributeNS(W, 'type') === 'page' ? { type: PB_MARKER } : hardBreakNode(marks)); break;
        case 'cr': out.push(hardBreakNode(marks)); break;
        case 'drawing': pushDrawn(convertDrawing(child, ctx), drawingIsFloating(child)); break;
        case 'pict': pushDrawn(convertPict(child, ctx), drawingIsFloating(child)); break;
        case 'footnoteReference':
        case 'endnoteReference': {
          // The zone schema has no notes, and Word's own separator notes are referenced
          // by nothing — only a real anchor reaches here.
          const kind: NoteKind = child.localName === 'endnoteReference' ? 'endnote' : 'footnote';
          // w:customMarkFollows: the literal mark is the rest of this run's text, part
          // of the anchor rather than body text.
          let label: string | null = null;
          if (child.getAttributeNS(W, 'customMarkFollows') === '1' || child.getAttributeNS(W, 'customMarkFollows') === 'true') {
            label = (child.parentElement?.getElementsByTagNameNS(W, 't')[0]?.textContent ?? '') || null;
            if (label) customMark = label;
          }
          const ref = hfFields ? null : noteRefNode(child.getAttributeNS(W, 'id'), kind, ctx, baseRun, defaults, label);
          if (ref) out.push(ref);
          break;
        }
      }
    }
  };

  for (const el of inlineChildren(p)) {
    // Math is its own namespace and sits beside the w:r runs, so it has to be picked
    // up before the w:-only guard below drops it.
    if (el.namespaceURI === OMML_NS && (el.localName === 'oMath' || el.localName === 'oMathPara')) {
      const formula = formulaNode(el, ctx);
      if (formula) out.push(formula);
      continue;
    }
    if (el.namespaceURI !== W) continue;
    if (trackBookmark(el, ctx) || trackComment(el, ctx)) continue;
    switch (el.localName) {
      case 'r': handleRun(el); break;
      case 'hyperlink': {
        const rid = el.getAttributeNS(R, 'id');
        // No relationship id: an internal link to a bookmark in this document.
        const anchor = el.getAttributeNS(W, 'anchor');
        const href = rid ? ctx.rels.get(rid)?.target : anchor ? `#${anchor}` : undefined;
        // A revision wraps its runs inside the link element, so walk both shapes.
        for (const child of Array.from(el.children)) {
          if (child.localName === 'r') handleRun(child, href);
          else if (child.localName === 'ins' || child.localName === 'del') handleRevision(child, href);
        }
        break;
      }
      case 'fldSimple': {
        const instr = el.getAttributeNS(W, 'instr') ?? '';
        if (hfFields) { const first = fcAll(el, 'r')[0]; emitField(out, instr, true, first ? runMarks(first) : []); break; }
        const xref = crossRefFromInstr(instr);
        if (xref) {
          const first = fcAll(el, 'r')[0];
          const m = first ? runMarks(first) : [];
          if (m.length) xref.marks = m;
          out.push({ ...xref, attrs: { ...xref.attrs, text: el.textContent ?? '' } });
          break;
        }
        const mark = indexEntryFromInstr(instr);
        if (mark) { out.push(mark); break; }
        const cite = citationFromInstr(instr, ctx);
        if (cite) { out.push({ ...cite, attrs: { ...cite.attrs, text: el.textContent ?? '' } }); break; }
        const seq = seqFieldFromInstr(instr);
        if (seq) {
          const first = fcAll(el, 'r')[0];
          const m = first ? runMarks(first) : [];
          if (m.length) seq.marks = m;
          out.push({ ...seq, attrs: { ...seq.attrs, number: seqNumberOf(el.textContent ?? '') } });
          break;
        }
        const field = dateTimeFieldFromInstr(instr);
        if (field) {
          const first = fcAll(el, 'r')[0];
          const m = first ? runMarks(first) : [];
          if (m.length) field.marks = m;
          out.push(field);
          break;
        }
        for (const r of fcAll(el, 'r')) handleRun(r); // body: keep the shown value
        break;
      }
      case 'ins':
      case 'del':
        handleRevision(el);
        break;
      case 'smartTag':
        for (const r of fcAll(el, 'r')) handleRun(r);
        break;
    }
  }
  return mergeAdjacentText(out);
}

// <m:oMath> / <m:oMathPara> → a formula node. Word stores no size for a formula, so
// the node view measures it once on screen and writes the ODF frame geometry back.
function formulaNode(el: Element, ctx: Ctx): Node | null {
  const { ast, display } = parseOmml(el);
  // Stored verbatim, not trimmed: a macro's own trailing space is what makes the
  // source re-serialize to itself, so trimming it would rewrite the formula on edit.
  const latex = astToLatex(ast);
  if (!latex.trim()) { ctx.warnings.add('Some formulas could not be read and were skipped'); return null; }
  return { type: 'formula', attrs: { latex, display } };
}

function emitField(out: Node[], instr: string, hfFields: boolean, marks: Mark[] = []): void {
  if (!hfFields) return;
  // The atom carries the field run's marks so its digits render in the run's font/size.
  const push = (type: string) => out.push(marks.length ? { type, marks } : { type });
  if (/\bNUMPAGES\b/.test(instr)) push('pageCount');
  else if (/\bPAGE\b/.test(instr)) push('pageNumber');
  // Word's running head: STYLEREF on a heading style → the live chapter field. The
  // level rides in the style name ("Heading 2", or a localized "Überschrift 2").
  else {
    const m = /\bSTYLEREF\s+"?[^"\d]*(\d)/i.exec(instr);
    if (m) out.push({ type: 'chapterField', attrs: { level: Number(m[1]), text: '' }, ...(marks.length ? { marks } : {}) });
  }
}

// The citation style the sources part names, where it names one we know.
function docxCitationStyle(files: Record<string, Uint8Array>): CitationStyle {
  for (const path of Object.keys(files)) {
    if (!/^customXml\/item\d+\.xml$/.test(path)) continue;
    let root: Element;
    try { root = parseXml(strFromU8(files[path])).documentElement; } catch { continue; }
    if (root.localName !== 'Sources') continue;
    return citationStyleFromDocx(root.getAttribute('StyleName') ?? '') ?? 'key';
  }
  return 'key';
}

// Every source Word keeps, by its tag. They live in a custom-XML part of their own —
// which part is not fixed, so each is probed for the bibliography root.
function docxSources(files: Record<string, Uint8Array>): Map<string, BibSource> {
  const out = new Map<string, BibSource>();
  for (const path of Object.keys(files)) {
    if (!/^customXml\/item\d+\.xml$/.test(path)) continue;
    let root: Element;
    try { root = parseXml(strFromU8(files[path])).documentElement; } catch { continue; }
    if (root.localName !== 'Sources') continue;
    for (const src of Array.from(root.getElementsByTagNameNS(B, 'Source'))) {
      const identifier = fcAll(src, 'Tag', B)[0]?.textContent?.trim() ?? '';
      if (!identifier || out.has(identifier)) continue;
      const fields: Record<string, string> = {};
      for (const [odf, word] of Object.entries(DOCX_BIB_FIELD)) {
        const v = fcAll(src, word, B)[0]?.textContent?.trim();
        if (v) fields[odf] = v;
      }
      const author = bibAuthorFrom(src);
      if (author) fields.author = author;
      const type = fcAll(src, 'SourceType', B)[0]?.textContent?.trim() ?? '';
      out.set(identifier, { identifier, type: bibTypeFromDocx(type), fields });
    }
  }
  return out;
}

// Word's author list back to one string: persons as "Last, First", several separated by
// a semicolon, a corporate name verbatim.
function bibAuthorFrom(src: Element): string {
  const holder = fcAll(src, 'Author', B)[0];
  const inner = holder ? fcAll(holder, 'Author', B)[0] : null;
  if (!inner) return '';
  const corporate = fcAll(inner, 'Corporate', B)[0]?.textContent?.trim();
  if (corporate) return corporate;
  return Array.from(inner.getElementsByTagNameNS(B, 'Person'))
    .map((p) => [fcAll(p, 'Last', B)[0]?.textContent?.trim(), fcAll(p, 'First', B)[0]?.textContent?.trim()]
      .filter(Boolean).join(', '))
    .filter(Boolean)
    .join('; ');
}

// A CITATION field instruction → a citation, its record taken from the sources part. A
// tag no source declares still cites: the field's cached text is what the reader saw.
function citationFromInstr(instr: string, ctx: Ctx): Node | null {
  const m = /^\s*CITATION\s+("[^"]+"|\S+)/i.exec(instr);
  if (!m) return null;
  const identifier = m[1].replace(/^"|"$/g, '').trim();
  if (!identifier) return null;
  const source = ctx.bibSources.get(identifier);
  return {
    type: 'bibliographyEntry',
    attrs: { identifier, type: source?.type ?? 'misc', fields: source?.fields ?? {}, text: '' },
  };
}

// An XE field instruction → an index entry. Word files the term under a key with
// "key:term", exactly as LibreOffice's text:key1 does.
function indexEntryFromInstr(instr: string): Node | null {
  const m = /^\s*XE\s+"((?:[^"\\]|\\.)*)"/i.exec(instr);
  if (!m) return null;
  const raw = m[1].replace(/\\(.)/g, '$1').trim();
  if (!raw) return null;
  const at = raw.indexOf(':');
  const key1 = at > 0 ? raw.slice(0, at).trim() : '';
  const term = at > 0 ? raw.slice(at + 1).trim() : raw;
  return term ? { type: 'indexEntry', attrs: { term, key1 } } : null;
}

// A REF/PAGEREF field instruction → a cross-reference node; its cached result text is
// filled in by the caller when the field closes. Every other field (SEQ, CITATION, …)
// returns null and keeps showing the text the producer cached.
function crossRefFromInstr(instr: string): Node | null {
  const m = /^\s*(PAGEREF|REF)\s+(\S+)/i.exec(instr);
  if (!m) return null;
  return { type: 'crossRef', attrs: { name: m[2], format: /^PAGEREF$/i.test(m[1]) ? 'page' : 'text', text: '' } };
}

// Word's numeric-picture switch → the ODF num-format the editor stores. Anything else
// counts in arabic, which is what Word itself falls back to.
const DOCX_SEQ_FORMAT: Record<string, NoteNumFormat> = {
  alphabetic: 'a', ALPHABETIC: 'A', roman: 'i', ROMAN: 'I',
};

// `SEQ Figure \* ARABIC` → a caption's running number. A counter under a name the
// editor doesn't count (a footnote sequence, a user's own) stays the field's text.
function seqFieldFromInstr(instr: string): Node | null {
  const m = /^\s*SEQ\s+("[^"]*"|\S+)/i.exec(instr);
  if (!m) return null;
  const category = ODF_SEQ_CATEGORY[m[1].replace(/"/g, '')];
  if (!category) return null;
  const sw = /\\\*\s*(\w+)/.exec(instr)?.[1] ?? '';
  return { type: 'sequenceField', attrs: { category, format: DOCX_SEQ_FORMAT[sw] ?? '1', number: 1 } };
}

// The rank a field cached, from its result text. Only an arabic one reads back; the
// editor's own numbering pass fixes the rest on load.
function seqNumberOf(text: string): number {
  const n = parseInt(text.replace(/\D/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

// A DATE/TIME field instruction with a picture switch we recognize → a live
// dateTimeField node (always auto: Word writes a fixed date as plain text). Returns
// null for an unknown picture so the caller keeps the field's shown text.
function dateTimeFieldFromInstr(instr: string): Node | null {
  if (!/\b(DATE|TIME)\b/i.test(instr)) return null;
  const m = /\\@\s*"([^"]*)"/.exec(instr);
  if (!m) return null;
  const fmt = [...DATE_FORMATS, ...TIME_FORMATS].find((f) => docxPicture(f) === m[1]);
  if (!fmt) return null;
  return { type: 'dateTimeField', attrs: { kind: fmt.kind, format: fmt.key, fixed: false, value: toDateValue(new Date()) } };
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

// A hardBreak carries its run's marks so an empty line between two breaks keeps the run's
// font size (Word/LibreOffice render such a line at that size, not the paragraph default).
function hardBreakNode(marks: Mark[]): Node {
  const n: Node = { type: 'hardBreak' };
  if (marks.length) n.marks = marks;
  return n;
}

function marksFor(props: RunProps, defaults: BlockDefaults, inLink: boolean): Mark[] {
  const marks: Mark[] = [];
  const textStyle: Record<string, unknown> = {};

  // Headings and header-row cells render bold via CSS: only a non-bold run needs a mark.
  if (defaults.boldByDefault) {
    if (props.bold === false) textStyle.fontWeight = 'normal';
  } else if (props.bold === true) {
    marks.push({ type: 'bold' });
  }

  // Marks the block's named style already renders need no mark of their own.
  if (props.italic && !defaults.italic) marks.push({ type: 'italic' });
  if (props.underline && !inLink && !defaults.underline) { // link underline is the CSS default
    const line = underlineAttrs(props);
    marks.push(line ? { type: 'underline', attrs: line } : { type: 'underline' });
  }
  if (props.strike && !defaults.strike) {
    marks.push({ type: 'strike', ...(props.doubleStrike ? { attrs: { lineStyle: 'double' } } : {}) });
  }
  if (props.vertAlign === 'superscript') marks.push({ type: 'superscript' });
  else if (props.vertAlign === 'subscript') marks.push({ type: 'subscript' });

  if (props.highlightFill) { const c = hexColor(props.highlightFill); if (c) marks.push({ type: 'highlight', attrs: { color: c } }); }

  let color = hexColor(props.color);
  if (inLink && color === LINK_BLUE) color = undefined; // strip the exporter's link visual
  if (color && color !== defaults.color) textStyle.color = color;

  const sizePt = props.sizeHalfPt != null ? props.sizeHalfPt / 2 : null;
  if (sizePt != null && Math.abs(sizePt - defaults.fontSizePt) > 0.05) textStyle.fontSize = `${Math.round(sizePt * 10) / 10}pt`;

  if (props.font && !defaults.fonts.has(props.font.toLowerCase())) textStyle.fontFamily = props.font;

  if (props.caps && props.caps !== defaults.caps) textStyle.caps = props.caps;
  if (props.positionPt) textStyle.textPosition = props.positionPt;

  if (Object.keys(textStyle).length) marks.push({ type: 'textStyle', attrs: textStyle });
  return marks;
}

// Word names a dozen underline styles; CSS draws four shapes, so each name maps to the
// one it looks like. 'single' is the default and needs no attr.
const UNDERLINE_STYLE: Record<string, LineStyle> = {
  double: 'double', wavyDouble: 'double',
  dotted: 'dotted', dottedHeavy: 'dotted', dotDash: 'dotted', dotDotDash: 'dotted',
  dash: 'dashed', dashedHeavy: 'dashed', dashLong: 'dashed', dashLongHeavy: 'dashed',
  dashDotHeavy: 'dashed', dashDotDotHeavy: 'dashed',
  wave: 'wavy', wavyHeavy: 'wavy',
};

function underlineAttrs(props: RunProps): Record<string, unknown> | undefined {
  const attrs: Record<string, unknown> = {};
  const style = props.underlineVal ? UNDERLINE_STYLE[props.underlineVal] : undefined;
  if (style) attrs.lineStyle = style;
  const color = hexColor(props.underlineColor);
  if (color) attrs.lineColor = color;
  return Object.keys(attrs).length ? attrs : undefined;
}

// ---- images -----------------------------------------------------------------
function loadImageDataUrl(path: string, ctx: Ctx): string | null {
  const cached = ctx.imageCache.get(path);
  if (cached) return cached;
  // A format the browser can't render may have been pre-decoded to PNG by the async pass.
  const converted = ctx.convertedImages.get(path);
  if (converted) { ctx.imageCache.set(path, converted); return converted; }
  const bytes = ctx.files[path];
  if (!bytes) return null;
  const url = imageDataUrl(bytes, path);
  if (!url) return null;
  ctx.imageCache.set(path, url);
  return url;
}

// True when a drawing floats rather than sitting in the text flow: DrawingML `wp:anchor`,
// or a VML shape with `position:absolute`. Header/footer import drops these (see pushDrawn).
function drawingIsFloating(el: Element): boolean {
  if (el.localName === 'drawing') return el.getElementsByTagNameNS(WP, 'anchor').length > 0;
  const shape = Array.from(el.getElementsByTagNameNS(VML, '*')).find((c) =>
    ['shape', 'rect', 'oval', 'roundrect'].includes(c.localName),
  );
  return /(^|;)\s*position\s*:\s*absolute/i.test(shape?.getAttribute('style') ?? '');
}

function convertDrawing(drawing: Element, ctx: Ctx): Node | null {
  // The drawing's own root, as a direct child: a text box holding a picture nests a
  // second drawing, and a subtree search finds *its* wp:inline first — the box, and
  // the caption in it, are then read as the bare picture.
  const root = Array.from(drawing.children).find(
    (c) => c.namespaceURI === WP && (c.localName === 'inline' || c.localName === 'anchor'),
  );
  if (!root) return null;
  const anchor = root.localName === 'anchor' ? root : undefined;
  // A wordprocessingShape (text box / preset shape) has no blip — convert it first.
  const wsp = root.getElementsByTagNameNS(WPS, 'wsp')[0];
  if (wsp) return convertWpsShape(wsp, root, !!anchor, ctx);
  const extentEl = root.getElementsByTagNameNS(WP, 'extent')[0];
  const boxPx = {
    w: framePx(emuToPx(intAttr(extentEl, '', 'cx') ?? 0)),
    h: framePx(emuToPx(intAttr(extentEl, '', 'cy') ?? 0)),
  };
  const blip = drawing.getElementsByTagNameNS(A, 'blip')[0];
  if (!blip) {
    if (boxPx.w > 0 && boxPx.h > 0) {
      // A chart is drawn from its own part as a picture; anything else the editor
      // cannot draw still occupies its box, as a placeholder of that size.
      const drawn = chartImage(drawing, boxPx, ctx);
      if (drawn) return frameNode(drawn, boxPx, 'Chart', anchor, ctx);
      ctx.warnings.add('Charts and other drawings were replaced by a placeholder');
      return frameNode(placeholderImage('Chart', boxPx.w, boxPx.h), boxPx, 'Chart', anchor, ctx);
    }
    ctx.warnings.add('Drawings were removed');
    return null;
  }
  // Candidate media: the primary blip plus any SVG alternative (Word 2016+ stores an
  // svgBlip beside a raster fallback) — prefer whichever the browser can display.
  const candidates: string[] = [];
  const pushEmbed = (id: string | null) => {
    const rel = id ? ctx.rels.get(id) : undefined;
    if (rel && !rel.external) candidates.push(`word/${rel.target.replace(/^\/+/, '')}`);
  };
  pushEmbed(blip.getAttributeNS(R, 'embed'));
  for (const sb of Array.from(blip.getElementsByTagName('*')))
    if (sb.localName === 'svgBlip') pushEmbed(sb.getAttributeNS(R, 'embed'));
  if (!candidates.length) { ctx.warnings.add('Some images could not be read and were skipped'); return null; }
  const path = candidates.find(p => loadImageDataUrl(p, ctx)) ?? candidates[0];
  const src = loadImageDataUrl(path, ctx);
  if (!src) {
    if (boxPx.w > 0 && boxPx.h > 0) {
      ctx.warnings.add('Images in a format the browser can’t display (e.g. WMF, EMF) were replaced by a placeholder');
      return frameNode(placeholderImage('Image', boxPx.w, boxPx.h), boxPx, 'Image', anchor, ctx);
    }
    ctx.warnings.add('Some images could not be read and were skipped');
    return null;
  }

  const attrs: Record<string, unknown> = { src };
  const extent = root.getElementsByTagNameNS(WP, 'extent')[0];
  const cx = intAttr(extent, '', 'cx');
  const cy = intAttr(extent, '', 'cy');
  if (cx) attrs.width = framePx(emuToPx(cx));
  if (cy) attrs.height = framePx(emuToPx(cy));
  const docPr = root.getElementsByTagNameNS(WP, 'docPr')[0];
  const alt = docPr?.getAttribute('title') || docPr?.getAttribute('descr');
  if (alt) attrs.alt = alt;
  const xfrm = drawing.getElementsByTagNameNS(A, 'xfrm')[0];
  const rot = xfrm ? parseInt(xfrm.getAttribute('rot') ?? '', 10) : NaN;
  if (Number.isFinite(rot) && rot) attrs.rotation = ((Math.round(rot / 60000) % 360) + 360) % 360;

  if (anchor) {
    const { wrap, offsetCm, offsetYCm, alignH, distCm } = anchorWrap(anchor, ctx);
    attrs.wrap = wrap;
    if (offsetCm != null) attrs.wrapOffset = offsetCm;
    if (offsetYCm != null) attrs.wrapOffsetY = offsetYCm;
    if (distCm != null) attrs.wrapDist = distCm;
    if (alignH && wrap === 'topBottom') attrs.wrapAlign = alignH;
  } else {
    fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  }
  return { type: 'image', attrs };
}

// theme1.xml's accent1..6 as #RRGGBB, in order — a chart series names them by role.
function themeAccents(theme: Document | null): string[] {
  const scheme = theme?.getElementsByTagNameNS(A, 'clrScheme')[0];
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const el = scheme ? Array.from(scheme.children).find((c) => c.localName === `accent${n}`) : null;
    const srgb = el ? el.getElementsByTagNameNS(A, 'srgbClr')[0]?.getAttribute('val') : null;
    return srgb ? `#${srgb}` : '';
  }).filter(Boolean);
}

// <c:chart r:id> → the chart part, drawn as a picture of the frame's own size.
function chartImage(drawing: Element, box: { w: number; h: number }, ctx: Ctx): string | null {
  const ref = Array.from(drawing.getElementsByTagName('*')).find((e) => e.localName === 'chart' && e.getAttributeNS(R, 'id'));
  const rel = ref ? ctx.rels.get(ref.getAttributeNS(R, 'id')!) : undefined;
  if (!rel || rel.external) return null;
  const bytes = ctx.files[`word/${rel.target.replace(/^\/+/, '')}`];
  return bytes ? chartDataUrl(strFromU8(bytes), box.w, box.h, ctx.accents) : null;
}

// A frame the editor draws itself (a chart) or cannot draw at all, as an image node of
// the same size, wrapped like the real one.
function frameNode(src: string, box: { w: number; h: number }, label: string, anchor: Element | undefined, ctx: Ctx): Node {
  const attrs: Record<string, unknown> = { src, width: box.w, height: box.h, alt: label };
  if (anchor) {
    const { wrap, offsetCm, offsetYCm, alignH, distCm } = anchorWrap(anchor, ctx);
    attrs.wrap = wrap;
    if (offsetCm != null) attrs.wrapOffset = offsetCm;
    if (offsetYCm != null) attrs.wrapOffsetY = offsetYCm;
    if (distCm != null) attrs.wrapDist = distCm;
    if (alignH && wrap === 'topBottom') attrs.wrapAlign = alignH;
  } else {
    fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  }
  return { type: 'image', attrs };
}

// How far below its anchor paragraph the frame sits. Only the paragraph- and
// line-relative forms have a CSS equivalent (the float's top margin); page- or
// margin-relative ones are absolute on the sheet, which a frame in flow cannot be.
function anchorOffsetY(anchor: Element): number | null {
  const posV = anchor.getElementsByTagNameNS(WP, 'positionV')[0];
  const from = posV?.getAttribute('relativeFrom');
  if (from !== 'paragraph' && from !== 'line') return null;
  const off = parseInt(posV?.getElementsByTagNameNS(WP, 'posOffset')[0]?.textContent ?? '', 10);
  return Number.isFinite(off) && off > 0 ? round2(off / 360000) : null;
}

// The frame's own x in the text column, cm from its left edge. null where the file
// names an alignment instead of a coordinate. A page-relative offset counts from the
// sheet edge — shift it to the column so one number serves both.
function anchorOffsetX(anchor: Element, ctx: Ctx): number | null {
  const posH = anchor.getElementsByTagNameNS(WP, 'positionH')[0];
  if (posH?.getElementsByTagNameNS(WP, 'align')[0]) return null;
  const off = parseInt(posH?.getElementsByTagNameNS(WP, 'posOffset')[0]?.textContent ?? '', 10);
  if (!Number.isFinite(off)) return null;
  const base = posH?.getAttribute('relativeFrom') === 'page' ? -cmToEmu(ctx.leftMarginCm) : 0;
  return round2((off + base) / 360000);
}

// Wrap mode and place are independent: the mode is what the file's wrap element says,
// the place its position offsets. Only where neither names a side does the frame's own
// x decide which half of the column it fills (text flows on one side of a CSS float).
function anchorWrap(anchor: Element, ctx: Ctx): { wrap: 'left' | 'right' | 'topBottom'; offsetCm: number | null; offsetYCm: number | null; alignH: 'left' | 'right' | null; distCm: number | null } {
  const offsetYCm = anchorOffsetY(anchor);
  const offsetCm = anchorOffsetX(anchor, ctx);
  const align = anchor.getElementsByTagNameNS(WP, 'positionH')[0]
    ?.getElementsByTagNameNS(WP, 'align')[0]?.textContent?.trim();
  const alignH: 'left' | 'right' | null = align === 'right' || align === 'outside' ? 'right'
    : align === 'left' || align === 'inside' ? 'left' : null;
  // Only the side the text flows on: the gap on the other one is the frame's offset.
  const distOf = (wrap: string) => {
    const emu = parseInt(anchor.getAttribute(wrap === 'right' ? 'distL' : 'distR') ?? '', 10);
    return Number.isFinite(emu) && emu > 0 ? round2(emu / 360000) : null;
  };
  const at = (wrap: 'left' | 'right' | 'topBottom') => ({ wrap, offsetCm, offsetYCm, alignH, distCm: distOf(wrap) });
  if (anchor.getElementsByTagNameNS(WP, 'wrapTopAndBottom')[0]) return at('topBottom');
  const wt = anchor.getElementsByTagNameNS(WP, 'wrapSquare')[0]?.getAttribute('wrapText');
  if (wt === 'right') return at('left'); // text on right ⇒ image on left
  if (wt === 'left') return at('right');
  if (align === 'right' || align === 'outside') return at('right');
  if (align) return at('left');
  if (offsetCm == null) return at('left');
  const cx = intAttr(anchor.getElementsByTagNameNS(WP, 'extent')[0], '', 'cx') ?? 0;
  return at(cmToEmu(offsetCm) + cx / 2 > cmToEmu(ctx.contentWidthCm) / 2 ? 'right' : 'left');
}

// ---- text boxes / shapes ------------------------------------------------------
function nsChild(el: Element | null, ns: string, localName: string): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) if (c.namespaceURI === ns && c.localName === localName) return c;
  return null;
}

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

// <a:custGeom> read as the shape's own outline, in the coordinate space its path
// declares. A segment no outline can hold (an arc) leaves the shape unsupported.
function custGeomPath(spPr: Element | null): string {
  const path = nsChild(nsChild(nsChild(spPr, A, 'custGeom'), A, 'pathLst'), A, 'path');
  const w = intAttr(path, '', 'w') ?? 0;
  const h = intAttr(path, '', 'h') ?? 0;
  if (!path || w <= 0 || h <= 0) return '';
  const parts: string[] = [];
  for (const seg of Array.from(path.children)) {
    const pts = Array.from(seg.getElementsByTagNameNS(A, 'pt'))
      .map((p) => `${p.getAttribute('x') ?? 0} ${p.getAttribute('y') ?? 0}`).join(' ');
    const cmd = { moveTo: 'M', lnTo: 'L', cubicBezTo: 'C', quadBezTo: 'Q', close: 'Z' }[seg.localName];
    if (!cmd) return '';
    parts.push(`${cmd} ${pts}`);
  }
  return fitPath(parseSvgPath(parts.join(' ')), w, h);
}

// A DrawingML <wps:wsp> (text box, preset shape or freeform) → a textBox node. A preset
// `utils/shapes.ts` can't draw and has no path of its own (a connector) is dropped with a
// warning. All property lookups are scoped to spPr so a nested image's fill/xfrm can't leak in.
function convertWpsShape(wsp: Element, root: Element, isAnchor: boolean, ctx: Ctx): Node | null {
  const spPr = nsChild(wsp, WPS, 'spPr');
  const outline = custGeomPath(spPr);
  const kind = outline ? 'textbox' : shapeFromPrst(nsChild(spPr, A, 'prstGeom')?.getAttribute('prst') ?? 'rect');
  if (!kind) { ctx.warnings.add('Unsupported shapes were removed'); return null; }

  const attrs: Record<string, unknown> = {};
  if (kind !== 'textbox') attrs.shapeKind = kind;
  if (outline) attrs.shapePath = outline;
  const extent = root.getElementsByTagNameNS(WP, 'extent')[0];
  const cx = intAttr(extent, '', 'cx');
  const cy = intAttr(extent, '', 'cy');
  if (cx) attrs.width = framePx(emuToPx(cx));
  if (cy) attrs.height = framePx(emuToPx(cy));
  const rot = intAttr(nsChild(spPr, A, 'xfrm'), '', 'rot');
  if (rot) attrs.rotation = ((Math.round(rot / 60000) % 360) + 360) % 360;
  if (isAnchor) {
    const { wrap, offsetCm, offsetYCm, distCm } = anchorWrap(root, ctx);
    attrs.wrap = wrap;
    if (offsetCm != null) attrs.wrapOffset = offsetCm;
    if (offsetYCm != null) attrs.wrapOffsetY = offsetYCm;
    if (distCm != null) attrs.wrapDist = distCm;
  }

  const fillClr = nsChild(nsChild(spPr, A, 'solidFill'), A, 'srgbClr')?.getAttribute('val');
  const fill = fillClr ? hexColor(fillClr) ?? null : null;
  const ln = nsChild(spPr, A, 'ln');
  const lnClr = nsChild(nsChild(ln, A, 'solidFill'), A, 'srgbClr')?.getAttribute('val');
  const stroke = ln && !nsChild(ln, A, 'noFill') ? hexColor(lnClr ?? '000000') ?? '#000000' : null;
  const lnW = intAttr(ln, '', 'w');
  setShapeStyleAttrs(attrs, fill, stroke, lnW != null ? lnW / 12700 : null);
  // A line's heads live on its <a:ln>, and they are what tells the three kinds apart;
  // Word reaches the frame's other diagonal by flipping it.
  if (isLineKind(kind)) {
    const head = (name: string) => (nsChild(ln, A, name)?.getAttribute('type') ?? 'none') !== 'none';
    attrs.shapeKind = lineKindFor(head('headEnd'), head('tailEnd'));
    if (nsChild(spPr, A, 'xfrm')?.getAttribute('flipV') === '1') attrs.flipV = true;
  }

  // Vertical text: every one of Word's top-to-bottom flows, the editor having the one
  // direction the browser lays out (`vert270` reads bottom-to-top and is not one).
  const vert = nsChild(wsp, WPS, 'bodyPr')?.getAttribute('vert') ?? 'horz';
  if (['vert', 'eaVert', 'mongolianVert', 'wordArtVert'].includes(vert)) attrs.textVertical = true;

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
  if (!shape) { ctx.warnings.add('Drawings were removed'); return null; }
  // The watermark rides the page decoration (storage/pageDecor.ts), not the header's
  // content, so it must not also arrive here as a shape.
  if (shape.getAttribute('id') === WATERMARK_NAME) return null;

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

  // A v:imagedata is a legacy inline picture (no text box) → an image node.
  const imagedata = shape.getElementsByTagNameNS(VML, 'imagedata')[0];
  const imgRel = imagedata ? ctx.rels.get(imagedata.getAttributeNS(R, 'id') ?? '') : undefined;
  if (imagedata && imgRel && !imgRel.external) {
    const path = `word/${imgRel.target.replace(/^\/+/, '')}`;
    const src = loadImageDataUrl(path, ctx);
    if (!src) {
      ctx.warnings.add(ctx.files[path]
        ? 'Images in a format the browser can’t display (e.g. WMF, EMF, TIFF) were removed'
        : 'Some images could not be read and were skipped');
      return null;
    }
    const imgAttrs: Record<string, unknown> = { src };
    if (w) imgAttrs.width = w;
    if (h) imgAttrs.height = h;
    return { type: 'image', attrs: imgAttrs };
  }

  const textbox = shape.getElementsByTagNameNS(VML, 'textbox')[0] ?? null;
  const txbxContent = nsChild(textbox, W, 'txbxContent');
  // A freeform is a v:shape drawn by its own path over a declared coordinate space,
  // and it holds no text box — LibreOffice's .docx filter writes one that way.
  const coord = (shape.getAttribute('coordsize') ?? '').split(',').map(Number);
  const outline = coord.length === 2 && coord[0] > 0 && coord[1] > 0 && shape.getAttribute('path')
    ? fitPath(parseVmlPath(shape.getAttribute('path') ?? ''), coord[0], coord[1]) : '';
  if (!txbxContent && !outline) { ctx.warnings.add('Drawings were removed'); return null; }

  const attrs: Record<string, unknown> = {};
  if (outline) attrs.shapePath = outline;
  // VML says vertical text in the box's own style, as `layout-flow:vertical`.
  if (/layout-flow\s*:\s*vertical/.test(textbox?.getAttribute('style') ?? '')) attrs.textVertical = true;
  const kind = shape.localName === 'oval' ? 'ellipse' : shape.localName === 'roundrect' ? 'roundRect' : 'textbox';
  if (kind !== 'textbox') attrs.shapeKind = kind;
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

  const blocks = txbxContent ? convertBlocks(Array.from(txbxContent.children), ctx, 'cell') : [];
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

// A conditional table-style area (w:tblStylePr) and the grid box it covers. A band's box
// is the whole banded region, not the single band: that is what makes its insideH the
// line *between* two band rows, which is how Word and LibreOffice draw one.
type GridBox = { row: number; col: number; rowEnd: number; colEnd: number };
type CondArea = { el: Element; box: GridBox };
type LookFlags = { firstRow: boolean; lastRow: boolean; firstCol: boolean; lastCol: boolean; hBand: boolean; vBand: boolean };

// w:tblLook: Word 2010+ writes the named attributes, older files only the w:val bitmask.
// No element at all means no conditional area applies.
function docxLookFlags(tblPr: Element | null): LookFlags {
  const el = fc(tblPr, 'tblLook');
  const bits = parseInt(el?.getAttributeNS(W, 'val') ?? '', 16);
  const on = (name: string, bit: number) => {
    const v = el?.getAttributeNS(W, name);
    if (v != null) return v === '1' || v === 'true';
    return Number.isFinite(bits) && (bits & bit) !== 0;
  };
  if (!el) return { firstRow: false, lastRow: false, firstCol: false, lastCol: false, hBand: false, vBand: false };
  return {
    firstRow: on('firstRow', 0x020), lastRow: on('lastRow', 0x040),
    firstCol: on('firstColumn', 0x080), lastCol: on('lastColumn', 0x100),
    hBand: !on('noHBand', 0x200), vBand: !on('noVBand', 0x400),
  };
}

// The areas covering one cell, lowest precedence first. Banding counts from the first body
// row/column, so the row under a header row is the first band (as in Word and LibreOffice).
function condAreasFor(
  conds: Map<string, Element>, flags: LookFlags, band: { row: number; col: number },
  cell: GridBox, rows: number, cols: number,
): CondArea[] {
  const out: CondArea[] = [];
  const push = (type: string, box: GridBox) => {
    const el = conds.get(type);
    if (el) out.push({ el, box });
  };
  const r0 = flags.firstRow ? 1 : 0, r1 = flags.lastRow ? rows - 2 : rows - 1;
  const c0 = flags.firstCol ? 1 : 0, c1 = flags.lastCol ? cols - 2 : cols - 1;
  if (flags.vBand && cell.col >= c0 && cell.col <= c1) {
    const even = Math.floor((cell.col - c0) / band.col) % 2 === 0;
    push(even ? 'band1Vert' : 'band2Vert', { row: 0, rowEnd: rows, col: c0, colEnd: c1 + 1 });
  }
  if (flags.hBand && cell.row >= r0 && cell.row <= r1) {
    const even = Math.floor((cell.row - r0) / band.row) % 2 === 0;
    push(even ? 'band1Horz' : 'band2Horz', { row: r0, rowEnd: r1 + 1, col: 0, colEnd: cols });
  }
  if (flags.lastCol && cell.colEnd === cols) push('lastCol', { row: 0, rowEnd: rows, col: cols - 1, colEnd: cols });
  if (flags.firstCol && cell.col === 0) push('firstCol', { row: 0, rowEnd: rows, col: 0, colEnd: 1 });
  if (flags.lastRow && cell.rowEnd === rows) push('lastRow', { row: rows - 1, rowEnd: rows, col: 0, colEnd: cols });
  if (flags.firstRow && cell.row === 0) push('firstRow', { row: 0, rowEnd: 1, col: 0, colEnd: cols });
  return out;
}

// How many rows a vertically merged cell covers. Its box has to say so before the covered
// rows are read, or a merge reaching the table's last row reads as an inside line there —
// which a style whose band declares insideH nil then drops.
function vMergeRows(trs: Element[], from: number, col: number): number {
  let n = 1;
  for (let ri = from + 1; ri < trs.length; ri++) {
    let c = 0;
    let covered = false;
    for (const tc of fcAll(trs[ri], 'tc')) {
      if (c >= col) {
        const el = fc(fc(tc, 'tcPr'), 'vMerge');
        covered = c === col && !!el && (wVal(el) ?? 'continue') !== 'restart';
        break;
      }
      c += intAttr(fc(fc(tc, 'tcPr'), 'gridSpan'), W, 'val') ?? 1;
    }
    if (!covered) break;
    n++;
  }
  return n;
}

// Which side of an area a cell's edge is: its own outer side where the cell sits on the
// area's edge, the area's inside line otherwise.
function areaSide(area: GridBox, cell: GridBox, side: 'top' | 'bottom' | 'left' | 'right'): string {
  if (side === 'top') return cell.row <= area.row ? 'top' : 'insideH';
  if (side === 'bottom') return cell.rowEnd >= area.rowEnd ? 'bottom' : 'insideH';
  if (side === 'left') return cell.col <= area.col ? 'left' : 'insideV';
  return cell.colEnd >= area.colEnd ? 'right' : 'insideV';
}

// A cell's shading and run properties from the table style, layered over its areas. The
// runs are baked below: a file's own table style has no entry in the editor's registry.
function condPaint(areas: CondArea[]): { fill?: string; run: RunProps } {
  let fill: string | undefined;
  let run: RunProps = {};
  for (const a of areas) {
    const shd = fc(fc(a.el, 'tcPr'), 'shd');
    if (shd) fill = hexColor(shd.getAttributeNS(W, 'fill'));
    run = mergeRunProps(run, parseRunProps(fc(a.el, 'rPr')));
  }
  return { fill, run };
}

// A conditional area's bold/italic/colour as real marks on the cell's text, skipping what
// a run already declares — the file's own formatting outranks its table style.
function bakeCellRuns(nodes: Node[], props: RunProps): void {
  const color = hexColor(props.color);
  if (!props.bold && !props.italic && !color) return;
  for (const n of nodes) {
    if (n.content) bakeCellRuns(n.content, props);
    if (n.type !== 'text') continue;
    const marks = n.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    if (props.bold && !has('bold')) marks.push({ type: 'bold' });
    if (props.italic && !has('italic')) marks.push({ type: 'italic' });
    if (color) {
      const ts = marks.find((m) => m.type === 'textStyle');
      if (!ts) marks.push({ type: 'textStyle', attrs: { color } });
      else if (!ts.attrs?.color) ts.attrs = { ...ts.attrs, color };
    }
    if (marks.length) n.marks = marks;
  }
}

function convertTable(tbl: Element, ctx: Ctx): Node | null {
  // The table style's own w:pPr/w:spacing reaches its cells' paragraphs (Word's Table Grid
  // zeroes the space after and the line spacing), under their own style chain. Restored
  // for a nested table.
  const outerSpacing = ctx.cellSpacing;
  const tblStyleEl = fc(fc(tbl, 'tblPr'), 'tblStyle');
  ctx.cellSpacing = ctx.styles.tableSpacing(tblStyleEl ? wVal(tblStyleEl) : null);
  try {
    return buildTable(tbl, ctx);
  } finally {
    ctx.cellSpacing = outerSpacing;
  }
}

// A w:tblCellMar / w:tcMar's four sides in cm, taking the first element that declares
// each. w:type="nil" is an explicit zero; a side nobody declares comes back null.
// Hundredth-cm: a twip is 0.0018cm, so an authored round2 value reads back exactly.
function cellMarginsCm(els: (Element | null)[]): (number | null)[] {
  return [['top'], ['right', 'end'], ['bottom'], ['left', 'start']].map((names) => {
    for (const el of els) {
      for (const name of names) {
        const s = el && fc(el, name);
        if (!s) continue;
        if (s.getAttributeNS(W, 'type') === 'nil') return 0;
        const w = intAttr(s, W, 'w');
        if (w != null) return round2(twipToCm(w));
      }
    }
    return null;
  });
}

// The table's own cell margins: direct before the table style's.
function docxCellPadding(tbl: Element, styleId: string | null, ctx: Ctx): CellPadding | null {
  return cellPaddingAttr(cellMarginsCm([fc(fc(tbl, 'tblPr'), 'tblCellMar'), ctx.styles.tableCellMar(styleId)]));
}

function buildTable(tbl: Element, ctx: Ctx): Node | null {
  const grid = fc(tbl, 'tblGrid');
  const weights = grid ? fcAll(grid, 'gridCol').map((g) => Math.max(1, intAttr(g, W, 'w') ?? 1)) : null;
  const useWeights = weights && weights.length ? weights : null;

  const styleEl = fc(fc(tbl, 'tblPr'), 'tblStyle');
  const styleId = styleEl ? wVal(styleEl) : null;
  const pad = docxCellPadding(tbl, styleId, ctx);
  const padBase = pad ?? DEFAULT_CELL_PADDING;

  // The table's own w:tblBorders, then its style's; a side nobody declares is not drawn
  // (Word's Normal Table has no border — its on-screen gridlines are not printed).
  const tblBorders = fc(fc(tbl, 'tblPr'), 'tblBorders');
  const tblBorderEls = [tblBorders, ...ctx.styles.tableBorders(styleId)];

  const rows: Node[] = [];
  const pending: (Node | null)[] = []; // origin cell per grid column, for vMerge spans
  const trs = fcAll(tbl, 'tr');

  // The table style's conditional areas paint what only the style declares, so they are
  // baked into the cells: a foreign style is not in the editor's registry, which is where
  // an assigned table style's regions otherwise come from (refreshTableStyles).
  const conds = ctx.styles.tableConditional(styleId);
  const flags = docxLookFlags(fc(tbl, 'tblPr'));
  const band = ctx.styles.tableBandSize(styleId);
  const gridCols = useWeights?.length
    ?? Math.max(1, ...trs.map((tr) => fcAll(tr, 'tc').reduce((n, tc) => n + (intAttr(fc(fc(tc, 'tcPr'), 'gridSpan'), W, 'val') ?? 1), 0)));
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
      const rowEnd = ri + (vMerge === 'restart' ? vMergeRows(trs, ri, col) : 1);
      const box: GridBox = { row: ri, col, rowEnd, colEnd: col + colspan };
      const areas = conds.size ? condAreasFor(conds, flags, band, box, trs.length, gridCols) : [];
      const paint = condPaint(areas);
      const fill = fc(tcPr, 'shd')?.getAttributeNS(W, 'fill');
      const bg = fill ? hexColor(fill) : paint.fill;
      const blocks = convertBlocks(Array.from(tc.children), ctx, 'cell', bg === HEADER_SHADE);
      bakeCellRuns(blocks, paint.run);
      const attrs: Record<string, unknown> = { colspan, rowspan: 1 };
      if (bg) attrs.backgroundColor = bg;
      // w:vAlign — Word's "center" is the editor's "middle"; "top"/"both" stay the default.
      const vAlignEl = fc(tcPr, 'vAlign');
      const vAlign = vAlignEl ? wVal(vAlignEl) : null;
      if (vAlign === 'center') attrs.verticalAlign = 'middle';
      else if (vAlign === 'bottom') attrs.verticalAlign = 'bottom';
      // The cell's own margins (w:tcMar), kept only where they differ from the table's.
      const ownPad = cellPaddingAttr(cellMarginsCm([fc(tcPr, 'tcMar')]), padBase);
      if (ownPad) attrs.cellPadding = ownPad;
      // Per side: the table's borders, then each conditional area over them, then the
      // cell's own w:tcBorders. An edge of the box a layer covers takes that layer's
      // outer side, anything inside it the layer's insideH/insideV.
      const tcBorders = fc(tcPr, 'tcBorders');
      const table: GridBox = { row: 0, col: 0, rowEnd: trs.length, colEnd: gridCols };
      const layers: { els: (Element | null)[]; box: GridBox }[] = [
        { els: tblBorderEls, box: table },
        ...areas.map((a) => ({ els: [fc(fc(a.el, 'tcPr'), 'tcBorders')], box: a.box })),
        { els: [tcBorders], box },
      ];
      const resolve = (side: 'top' | 'bottom' | 'left' | 'right') => {
        let v: string | null | undefined;
        for (const layer of layers) {
          const name = areaSide(layer.box, box, side);
          for (const el of layer.els) {
            const got = docxBorderAttr(fc(el, name));
            if (got !== undefined) { v = got; break; }
          }
        }
        return v === undefined ? 'none' : v;
      };
      const sides: [string, string | null][] = [
        ['borderTop', resolve('top')], ['borderBottom', resolve('bottom')],
        ['borderLeft', resolve('left')], ['borderRight', resolve('right')],
      ];
      // undefined (nothing declared) and null (= editor default) both leave the attr off.
      for (const [attr, v] of sides) if (typeof v === 'string') attrs[attr] = v;
      if (useWeights) attrs.colwidth = useWeights.slice(col, col + colspan);
      // A `= …` field in the cell is Word's table formula; its cached result is already
      // the cell's text, so only the formula itself moves onto the cell.
      const { formula, format } = cellFormulaOf(tc);
      if (formula) attrs.formula = formula;
      if (formula && format) attrs.cellFormat = format;
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
  if (rows.length === 0) return null;
  const named = ctx.styles.tableStyleName(styleId);
  const attrs: Record<string, unknown> = { ...(tableMargins(tbl, useWeights, ctx, padBase[3]) ?? {}) };
  if (pad) attrs.cellPadding = pad;
  // w:tblHeader on the first row: Word repeats it at the top of every page the table
  // continues on. Only a leading run of rows can carry it, so the first one decides.
  const firstTrPr = fc(fcAll(tbl, 'tr')[0] ?? null, 'trPr');
  const hdr = fc(firstTrPr, 'tblHeader');
  if (hdr && onOff(hdr)) attrs.repeatHeader = true;
  if (named) {
    attrs.tableStyle = named;
    const look = docxTableLook(fc(tbl, 'tblPr'));
    if (look) attrs.tableLook = look;
  }
  return Object.keys(attrs).length ? { type: 'table', attrs, content: rows } : { type: 'table', content: rows };
}

// Word's w:tblLook → the editor's tableLook attr (its band flags are inverted).
// null when the file declares none, so the default look applies.
function docxTableLook(tblPr: Element | null): string | null {
  if (!fc(tblPr, 'tblLook')) return null;
  const f = docxLookFlags(tblPr);
  return tableLookAttr({
    headerRow: f.firstRow, lastRow: f.lastRow, firstColumn: f.firstCol,
    lastColumn: f.lastCol, bandedRow: f.hBand, bandedColumn: f.vBand,
  });
}

// A table narrower than the text width: w:tblInd is its left indent, the grid (or
// w:tblW) its width — the rest becomes the editor's right margin. Under the older
// compatibility mode the indent is measured to the cell's *text*, so the table hangs its
// left cell margin into the page margin (tblIndIsToText).
function tableMargins(tbl: Element, weights: number[] | null, ctx: Ctx, leftPadCm: number): { marginLeft?: number; marginRight?: number } | null {
  const tblPr = fc(tbl, 'tblPr');
  const content = ctx.contentWidthCm;
  const dxa = (el: Element | null) => (el?.getAttributeNS(W, 'type') ?? 'dxa') === 'dxa' ? intAttr(el, W, 'w') : null;
  const left = twipToCm(dxa(fc(tblPr, 'tblInd')) ?? 0) - (ctx.tblIndToText ? leftPadCm : 0);
  const declared = dxa(fc(tblPr, 'tblW'));
  const width = declared && declared > 0
    ? twipToCm(declared)
    : weights ? twipToCm(weights.reduce((a, b) => a + b, 0)) : null;
  const right = width != null ? content - left - width : 0;

  if (Math.abs(left) < 0.05 && Math.abs(right) < 0.05) return null;
  if (left + right > content - 1) return null;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const l = round2(left), r = round2(right);
  // A zero side is the attr's default (null); rounding may also leave a -0 behind.
  return { ...(Math.abs(l) >= 0.005 ? { marginLeft: l } : {}), ...(Math.abs(r) >= 0.005 ? { marginRight: r } : {}) };
}

function flattenTable(tbl: Element, ctx: Ctx): Node[] {
  const out: Node[] = [];
  for (const tr of fcAll(tbl, 'tr')) for (const tc of fcAll(tr, 'tc')) out.push(...convertBlocks(Array.from(tc.children), ctx, 'cell'));
  return out;
}

// ---- section: page geometry + headers/footers ------------------------------
// Text width of a section (A4 with Word's 2.54cm margins when it declares none).
function sectionContentWidthCm(sect: Element | null): number {
  const w = intAttr(fc(sect, 'pgSz'), W, 'w') ?? 11906;
  const pgMar = fc(sect, 'pgMar');
  const left = intAttr(pgMar, W, 'left') ?? 1440;
  const right = intAttr(pgMar, W, 'right') ?? 1440;
  return Math.max(1, twipToCm(w - left - right));
}

// Split body children into sections: a <w:p> whose pPr carries a sectPr ends the
// group before it (dropped unless it has run content). The trailing group has
// sectPr null — the caller pairs it with the body-final <w:sectPr>.
function splitBodySections(children: Element[]): {
  groups: { els: Element[]; sectPr: Element | null }[];
  midSectPrs: Element[];
} {
  const groups: { els: Element[]; sectPr: Element | null }[] = [];
  const midSectPrs: Element[] = [];
  let els: Element[] = [];
  for (const el of children) {
    if (el.namespaceURI === W && el.localName === 'sectPr') continue; // body-final
    const sectPr = el.namespaceURI === W && el.localName === 'p' ? fc(fc(el, 'pPr'), 'sectPr') : null;
    if (sectPr) {
      if (fc(el, 'r') || fc(el, 'hyperlink')) els.push(el);
      groups.push({ els, sectPr });
      midSectPrs.push(sectPr);
      els = [];
      continue;
    }
    els.push(el);
  }
  groups.push({ els, sectPr: null });
  return { groups, midSectPrs };
}

// The page's own decoration: Word keeps the background on w:document, the border in the
// section, and the watermark as a VML fontwork shape in a header part — the same three
// places LibreOffice writes them (probed).
function docxPageDecor(docDoc: Document, sectPr: Element | null, files: Record<string, Uint8Array>): PageDecor {
  const bg = fc(docDoc.documentElement, 'background')?.getAttributeNS(W, 'color');
  const borders = fc(sectPr, 'pgBorders');
  const top = borders ? fc(borders, 'top') : null;
  const sz = top ? intAttr(top, W, 'sz') : null;
  const color = top?.getAttributeNS(W, 'color');
  return normalizePageDecor({
    background: bg && bg !== 'auto' ? `#${bg}` : null,
    // w:sz is eighths of a point, w:space whole points from the text.
    border: sz && top && wVal(top) !== 'none'
      ? { widthPt: Math.round((sz / 8) * 100) / 100,
          color: color && color !== 'auto' ? `#${color}` : '#000000',
          paddingCm: Math.round(((intAttr(top, W, 'space') ?? 0) / 72) * 2.54 * 100) / 100 }
      : null,
    watermark: docxWatermark(files),
  });
}

// The VML shape Word and LibreOffice both name PowerPlusWaterMarkObject, in whichever
// header part carries it. Its text rides v:textpath, its angle the style's rotation.
function docxWatermark(files: Record<string, Uint8Array>): unknown {
  for (const path of Object.keys(files)) {
    if (!/^word\/header\d*\.xml$/.test(path)) continue;
    const xml = strFromU8(files[path]);
    const i = xml.indexOf(WATERMARK_NAME);
    if (i < 0) continue;
    const shape = xml.slice(i, xml.indexOf('</v:shape>', i));
    const text = /\bstring="([^"]*)"/.exec(shape)?.[1];
    if (!text) continue;
    const style = /<v:textpath[^>]*\bstyle="([^"]*)"/.exec(shape)?.[1] ?? '';
    const rotation = Number(/rotation:\s*(-?[\d.]+)/.exec(shape)?.[1] ?? '0');
    const opacity = Number(/<v:fill[^>]*\bopacity="([\d.]+)"/.exec(shape)?.[1] ?? '1');
    return {
      text: decodeXml(text),
      font: decodeXml(/font-family:\s*&quot;?([^;&"]+)/.exec(style)?.[1] ?? '').trim() || undefined,
      color: /\bfillcolor="([^"]*)"/.exec(shape)?.[1],
      // VML counts clockwise, the editor (and ODF) counter-clockwise.
      angle: -(((rotation % 360) + 360) % 360) + (rotation > 180 ? 360 : 0),
      transparency: Math.round((1 - opacity) * 100),
    };
  }
  return null;
}

const decodeXml = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// <w:lnNumType> in the section: Word's line numbers. Absent = not numbered, which is
// also ODF's meaning for a missing configuration element.
function docxLineNumbering(sectPr: Element | null): LineNumbering {
  const ln = fc(sectPr, 'lnNumType');
  if (!ln) return DEFAULT_LINE_NUMBERING;
  return normalizeLineNumbering({
    on: true,
    interval: intAttr(ln, W, 'countBy') ?? DEFAULT_LINE_NUMBERING.interval,
    distanceCm: twipToCm(intAttr(ln, W, 'distance') ?? 283),
    restart: ln.getAttributeNS(W, 'restart') === 'newPage' ? 'page' : 'continuous',
    // Word has no "count empty lines" switch; it always does, as ODF defaults to.
    countEmpty: true,
  });
}

// A right-to-left section (w:bidi): the columns fill from the right, and it is the
// direction a block inherits when it declares none of its own.
function sectPrRtl(sectPr: Element | null): boolean {
  const b = fc(sectPr, 'bidi');
  return !!b && onOff(b);
}

// A section break's w:type: 'continuous'/'nextColumn' flow within the page; anything
// else (nextPage/oddPage/evenPage, or absent = the default nextPage) begins a new page.
function sectionStartsNewPage(sectPr: Element | null): boolean {
  const t = fc(sectPr, 'type');
  const val = t ? wVal(t) : null;
  return val !== 'continuous' && val !== 'nextColumn';
}

// A sectPr's w:cols → columns attrs when it declares more than one column.
function sectPrColumns(sectPr: Element | null, ctx: Ctx): { count: number; gapCm: number } | null {
  const cols = fc(sectPr, 'cols');
  if (!cols) return null;
  const colEls = fcAll(cols, 'col');
  const num = intAttr(cols, W, 'num') ?? (colEls.length > 1 ? colEls.length : null);
  if (!num || num <= 1) return null;
  let count = num;
  if (count > 3) {
    ctx.warnings.add('Sections with more than 3 columns were reduced to 3 columns');
    count = 3;
  }
  const space = intAttr(cols, W, 'space') ?? (colEls[0] ? intAttr(colEls[0], W, 'space') : null) ?? 283;
  // A gap the section's text has no room for is a producer's unit slip — EMU written into
  // a twips attribute — and lays out as no gap at all, not as columns too narrow to hold a
  // word. Below that LibreOffice honours the declared value literally (probed).
  const gapCm = round2(twipToCm(space));
  const fits = gapCm > 0 && (count - 1) * gapCm < sectionContentWidthCm(sectPr);
  return { count, gapCm: fits ? clampColumnGap(gapCm) : 0 };
}

// Block types a columns node can contain (mirrors import/odt.ts).
const COLUMNS_ALLOWED = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);

// Wrap a multi-column section's converted blocks into columns nodes: maximal runs of
// allowed types become one node each; anything else is emitted between them.
function pushColumnRuns(inner: Node[], cols: { count: number; gapCm: number }, out: Node[], ctx: Ctx): void {
  let run: Node[] = [];
  const flush = () => {
    if (run.length) out.push({ type: 'columns', attrs: { count: cols.count, gapCm: cols.gapCm }, content: run });
    run = [];
  };
  for (const block of inner) {
    if (COLUMNS_ALLOWED.has(block.type)) {
      run.push(block);
    } else {
      ctx.warnings.add('Tables and text boxes inside a multi-column layout were moved out of the columns');
      flush();
      out.push(block);
    }
  }
  flush();
}

// Word's mirror margins are a document setting too: w:pgMar's left/right then read as
// the inner/outer pair and an even page swaps them.
// Word 2013 (compatibilityMode 15) made w:tblInd the table's own edge; before that it was
// measured to the cell's text, so the table hangs its left cell margin into the page
// margin. Probed against `soffice`, which follows the setting: the same table sits at the
// margin under 15 and 2.1mm left of it under 14. No setting at all is an old file.
function tblIndIsToText(files: Record<string, Uint8Array>): boolean {
  const bytes = files['word/settings.xml'];
  if (!bytes) return true;
  try {
    for (const el of Array.from(parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'compatSetting'))) {
      if (el.getAttributeNS(W, 'name') !== 'compatibilityMode') continue;
      const n = parseInt(el.getAttributeNS(W, 'val') ?? '', 10);
      return !Number.isFinite(n) || n < 15;
    }
  } catch { /* an unreadable settings.xml is no setting */ }
  return true;
}

// Whether the document records revisions — settings.xml, like the two below (probed:
// LibreOffice writes and reads exactly this element for its own Record Changes).
function docRecordsChanges(files: Record<string, Uint8Array>): boolean {
  const bytes = files['word/settings.xml'];
  if (!bytes) return false;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'trackRevisions')[0];
    return !!el && onOff(el);
  } catch {
    return false;
  }
}

function docHasMirrorMargins(files: Record<string, Uint8Array>): boolean {
  const bytes = files['word/settings.xml'];
  if (!bytes) return false;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'mirrorMargins')[0];
    return !!el && onOff(el);
  } catch {
    return false;
  }
}

// Word's "Different Odd & Even Pages" toggle lives in settings.xml, not the sectPr.
// Word's num-format ids, reversed onto the five ODF ones.
const NUM_FMT_FROM_DOCX: Record<string, NoteNumFormat> = {
  decimal: '1', lowerLetter: 'a', upperLetter: 'A', lowerRoman: 'i', upperRoman: 'I',
};

// The document-wide <w:footnotePr>/<w:endnotePr> in settings.xml. The separator is not
// Word's to describe — it draws a fixed one — so it keeps the editor's.
function docNoteSettings(files: Record<string, Uint8Array>): NoteSettings {
  const bytes = files['word/settings.xml'];
  if (!bytes) return DEFAULT_NOTE_SETTINGS;
  const out: NoteSettings = {
    footnote: { ...DEFAULT_NOTE_SETTINGS.footnote },
    endnote: { ...DEFAULT_NOTE_SETTINGS.endnote },
    separator: { ...DEFAULT_NOTE_SETTINGS.separator },
  };
  try {
    const root = parseXml(strFromU8(bytes)).documentElement;
    for (const kind of ['footnote', 'endnote'] as NoteKind[]) {
      const el = root.getElementsByTagNameNS(W, `${kind}Pr`)[0];
      if (!el) continue;
      const cls = out[kind];
      const val = (name: string) => { const c = fc(el, name); return c ? wVal(c) : null; };
      const fmt = NUM_FMT_FROM_DOCX[val('numFmt') ?? ''];
      if (fmt) cls.numFormat = fmt;
      const start = Number(val('numStart'));
      if (Number.isFinite(start) && start > 0) cls.startAt = start;
      const restart = val('numRestart');
      if (restart === 'eachPage') cls.restart = 'page';
      else if (restart === 'eachSect') cls.restart = 'chapter';
      else if (restart === 'continuous') cls.restart = 'document';
      if (kind === 'footnote' && val('pos') === 'docEnd') cls.position = 'document';
    }
  } catch { /* a malformed settings part just keeps the defaults */ }
  return out;
}

function docHasEvenOddHeaders(files: Record<string, Uint8Array>): boolean {
  const bytes = files['word/settings.xml'];
  if (!bytes) return false;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'evenAndOddHeaders')[0];
    return !!el && onOff(el);
  } catch {
    return false;
  }
}

// The grid every tab past the last custom stop falls on, also from settings.xml. A file
// that declares none gets Word's own fallback of 720 twips.
function docTabInterval(files: Record<string, Uint8Array>): number {
  const bytes = files['word/settings.xml'];
  if (!bytes) return DOCX_IMPLIED_TAB_CM;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'defaultTabStop')[0];
    const tw = el && intAttr(el, W, 'val');
    return tw ? clampTabInterval(round2(twipToCm(tw))) : DOCX_IMPLIED_TAB_CM;
  } catch {
    return DOCX_IMPLIED_TAB_CM;
  }
}

// w:pgNumType on the first section: how the page-number field counts.
const DOCX_PAGE_NUM_FORMAT: Record<string, NoteNumFormat> = {
  decimal: '1', lowerRoman: 'i', upperRoman: 'I', lowerLetter: 'a', upperLetter: 'A',
};

function docxPageNumbering(sectPr: Element | null): PageNumbering {
  const el = fc(sectPr, 'pgNumType');
  if (!el) return { ...DEFAULT_PAGE_NUMBERING };
  const start = intAttr(el, W, 'start');
  return {
    format: DOCX_PAGE_NUM_FORMAT[el.getAttributeNS(W, 'fmt') ?? ''] ?? '1',
    start: start != null ? clampPageStart(start) : 1,
  };
}

// Word's Layout ▸ Hyphenation, from settings.xml (absent = off, as in Word).
function docAutoHyphenation(files: Record<string, Uint8Array>): boolean {
  const bytes = files['word/settings.xml'];
  if (!bytes) return false;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'autoHyphenation')[0];
    return !!el && onOff(el);
  } catch {
    return false;
  }
}

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

// word/commentsExtended.xml → the w14:paraId set of resolved (w15:done) comments.
function docxResolvedParaIds(files: Record<string, Uint8Array>): Set<string> {
  const out = new Set<string>();
  const bytes = files['word/commentsExtended.xml'];
  if (!bytes) return out;
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return out; }
  for (const ex of Array.from(doc.getElementsByTagNameNS(W15, 'commentEx'))) {
    const done = ex.getAttributeNS(W15, 'done');
    const pid = ex.getAttributeNS(W15, 'paraId');
    if (pid && (done === '1' || done === 'true')) out.add(pid);
  }
  return out;
}

// word/comments.xml → the comment mark's attrs, by Word's numeric id. Whether it is
// resolved lives in commentsExtended.xml, keyed by the last body paragraph's w14:paraId.
function docxComments(files: Record<string, Uint8Array>): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  const bytes = files['word/comments.xml'];
  if (!bytes) return out;
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return out; }
  const done = docxResolvedParaIds(files);
  for (const c of Array.from(doc.getElementsByTagNameNS(W, 'comment'))) {
    const id = c.getAttributeNS(W, 'id');
    if (!id) continue;
    const paras = fcAll(c, 'p');
    const lastPid = paras.length ? paras[paras.length - 1].getAttributeNS(W14, 'paraId') : null;
    out.set(id, {
      id: `w${id}`,
      author: c.getAttributeNS(W, 'author') ?? '',
      date: c.getAttributeNS(W, 'date') ?? '',
      text: paras.map((p) => p.textContent ?? '').join('\n').trim(),
      resolved: lastPid != null && done.has(lastPid),
    });
  }
  return out;
}

// docProps/core.xml → the document's descriptive properties (Word's File ▸ Info).
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const CP_NS = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';

function docxDocProperties(files: Record<string, Uint8Array>): DocProperties {
  const bytes = files['docProps/core.xml'];
  if (!bytes) return { ...EMPTY_DOC_PROPERTIES };
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return { ...EMPTY_DOC_PROPERTIES }; }
  const text = (ns: string, name: string) =>
    doc.getElementsByTagNameNS(ns, name)[0]?.textContent?.trim() ?? '';
  return {
    title: text(DC_NS, 'title'),
    subject: text(DC_NS, 'subject'),
    author: text(DC_NS, 'creator'),
    keywords: text(CP_NS, 'keywords'),
    description: text(DC_NS, 'description'),
  };
}

// A section's paper (w:pgSz). A box wider than it is tall is landscape even where the
// producer left the attribute off, which is how LibreOffice's own DOCX reads.
function sectPaper(sect: Element | null): { orientation: Orientation; format: PageFormat | null } {
  const pgSz = sect ? fc(sect, 'pgSz') : null;
  const w = intAttr(pgSz, W, 'w');
  const h = intAttr(pgSz, W, 'h');
  return {
    orientation: pgSz?.getAttributeNS(W, 'orient') === 'landscape' || (w && h && w > h) ? 'landscape' : 'portrait',
    format: w && h ? (formatFromCm(twipToCm(w), twipToCm(h)) ?? 'A4') : null,
  };
}

function parseSectPr(sect: Element | null, ctx: Ctx, oddEven = false): {
  margins: PageMargins | null; orientation: Orientation | null; format: PageFormat | null;
  header: HfDoc; footer: HfDoc; headerFirst: HfDoc; footerFirst: HfDoc; differentFirstPage: boolean;
  headerEven: HfDoc; footerEven: HfDoc; differentOddEven: boolean;
  headerDistCm: number | null; footerDistCm: number | null;
} {
  const empty = { margins: null, orientation: null, format: null, header: null, footer: null, headerFirst: null, footerFirst: null, differentFirstPage: false, headerEven: null, footerEven: null, differentOddEven: false, headerDistCm: null, footerDistCm: null };
  if (!sect) return empty;

  const { orientation, format } = sectPaper(sect);

  const pgMar = fc(sect, 'pgMar');
  const clampCm = (tw: number | null) => (tw == null ? null : Math.min(10, Math.max(0, round2(twipToCm(tw)))));
  const margins = sectMargins(sect);

  // Different first page: w:titlePg turns on the "first"-type refs for page 1.
  const titlePgEl = fc(sect, 'titlePg');
  const titlePg = !!titlePgEl && onOff(titlePgEl);
  const refId = (type: string, variant: 'default' | 'first' | 'even' = 'default') => {
    const ref = fcAll(sect, `${type}Reference`).find((r) => (r.getAttributeNS(W, 'type') ?? 'default') === variant);
    return ref?.getAttributeNS(R, 'id') ?? null;
  };

  const header = convertHfPart(refId('header'), ctx);
  const footer = convertHfPart(refId('footer'), ctx);
  const headerFirst = titlePg ? convertHfPart(refId('header', 'first'), ctx) : null;
  const footerFirst = titlePg ? convertHfPart(refId('footer', 'first'), ctx) : null;
  // Odd/even pages: settings.xml w:evenAndOddHeaders turns on the "even"-type refs.
  const headerEven = oddEven ? convertHfPart(refId('header', 'even'), ctx) : null;
  const footerEven = oddEven ? convertHfPart(refId('footer', 'even'), ctx) : null;
  return {
    margins, orientation, format, header, footer,
    headerFirst, footerFirst, differentFirstPage: titlePg,
    headerEven, footerEven, differentOddEven: oddEven,
    headerDistCm: clampCm(intAttr(pgMar, W, 'header')),
    footerDistCm: clampCm(intAttr(pgMar, W, 'footer')),
  };
}

// The section's own page margins (w:pgMar). Word has no first-page variant of them.
const withMirror = (m: PageMargins | null, mirrored: boolean): PageMargins | null =>
  m && mirrored ? { ...m, mirrored: true } : m;

function sectMargins(sect: Element | null): PageMargins | null {
  const pgMar = sect ? fc(sect, 'pgMar') : null;
  if (!pgMar) return null;
  const cm = (a: string, fallback: number) => {
    const tw = intAttr(pgMar, W, a);
    return tw == null ? fallback : Math.min(10, Math.max(0, round2(twipToCm(tw))));
  };
  return { top: cm('top', 2.54), bottom: cm('bottom', 2.54), left: cm('left', 2.12), right: cm('right', 2.12) };
}

// One HfSet per section, in body order, resolving Word's "Link to Previous": a section
// that declares no reference of a type keeps the previous section's. w:titlePg is per
// section, odd/even is document-wide (settings.xml).
function sectionHfSets(
  sectPrs: (Element | null)[], ctx: Ctx, oddEven: boolean,
  doc: { format: PageFormat | null; orientation: Orientation | null },
): HfSet[] {
  const out: HfSet[] = [];
  for (const sect of sectPrs) {
    const prev = out[out.length - 1] ?? EMPTY_HF_SET;
    const titlePgEl = sect ? fc(sect, 'titlePg') : null;
    const titlePg = !!titlePgEl && onOff(titlePgEl);
    const zone = (type: 'header' | 'footer', variant: string, inherited: HfDoc): HfDoc => {
      const ref = sect
        ? fcAll(sect, `${type}Reference`).find((r) => (r.getAttributeNS(W, 'type') ?? 'default') === variant)
        : null;
      return ref ? convertHfPart(ref.getAttributeNS(R, 'id'), ctx) : inherited;
    };
    // Only a section disagreeing with the document carries its own paper: matching it is
    // inheritance, not formatting, exactly as for the margins.
    const paper = sectPaper(sect);
    // w:pgNumType w:start restarts the numbering at this section; without it it counts
    // on. The first section's is the document's own start (read separately).
    const pgStart = sect ? intAttr(fc(sect, 'pgNumType'), W, 'start') : null;
    out.push({
      margins: sectMargins(sect),
      pageNumberStart: out.length && pgStart != null ? clampPageStart(pgStart) : null,
      format: paper.format && paper.format !== doc.format ? paper.format : null,
      orientation: paper.orientation && paper.orientation !== doc.orientation ? paper.orientation : null,
      header: zone('header', 'default', prev.header),
      footer: zone('footer', 'default', prev.footer),
      headerFirst: titlePg ? zone('header', 'first', prev.headerFirst) : null,
      footerFirst: titlePg ? zone('footer', 'first', prev.footerFirst) : null,
      differentFirstPage: titlePg,
      headerEven: oddEven ? zone('header', 'even', prev.headerEven) : null,
      footerEven: oddEven ? zone('footer', 'even', prev.footerEven) : null,
      differentOddEven: oddEven,
    });
  }
  return out.length ? out : [{ ...EMPTY_HF_SET }];
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

  // One line per source paragraph, joined by hard breaks below: an empty leading line
  // is a line of the zone too, and the body starts under the whole of it.
  const lines: Node[][] = [];
  let textAlign: string | null = null;
  let stops: string | null = null;
  const boxMaps: Record<string, string>[] = [];
  for (const p of hfParagraphs(root)) {
    const ppr = fc(p, 'pPr');
    // The zone is one paragraph, so the first line's stops are the zone's. Word puts a
    // header's centre/right pair on the Header style rather than the paragraph.
    const tabs = ppr && fc(ppr, 'tabs');
    stops ??= formatTabStops(tabs ? readTabStops(tabs)
      : hfCtx.styles.paragraphTabs(fc(ppr, 'pStyle') ? wVal(fc(ppr, 'pStyle')!) : null));
    if (textAlign === null) {
      const ta = (fc(ppr, 'jc') ? wVal(fc(ppr, 'jc')!) : null) ?? '';
      textAlign = ta === 'center' || ta === 'both' ? (ta === 'both' ? 'justify' : 'center') : ta === 'right' || ta === 'end' ? 'right' : '';
    }
    boxMaps.push(readParaBox(ppr));
    const baseRun = hfCtx.styles.paragraphRun(fc(ppr, 'pStyle') ? wVal(fc(ppr, 'pStyle')!) : null);
    // The zone carries no styleName and no style CSS reaches it, so the yardstick is the
    // editor's own defaults — what the Header/Footer style provides has to become marks
    // (mirrors odt.ts convertHfZone, which passes no style name either).
    lines.push(convertInline(p, hfCtx, baseRun, blockDefaults({}, null, false), true).filter((n) => n.type !== PB_MARKER));
  }
  // An all-empty zone is dropped unless it carries a background/rule line (a footer that
  // is just a colored line has no text). The zone collapses to one paragraph (mergeHfBox).
  const box = mergeHfBox(boxMaps);
  if (lines.every((l) => l.length === 0) && Object.keys(box).length === 0) return null;
  const inline: Node[] = [];
  lines.forEach((line, i) => {
    if (i) inline.push({ type: 'hardBreak' });
    inline.push(...line);
  });

  const para: Node = { type: 'paragraph', content: inline };
  const attrs: Record<string, string> = {};
  // The zone is one paragraph here, so its strut is the whole band's line height —
  // runs that agree on a size must set it, or a 10pt footer reserves 12pt lines.
  applyUniformRunFont(attrs, inline);
  if (textAlign) attrs.textAlign = textAlign;
  if (stops) attrs.tabStops = stops;
  Object.assign(attrs, box);
  if (Object.keys(attrs).length) para.attrs = attrs;
  return { type: 'doc', content: [para] };
}

// A zone's paragraphs in document order, unwrapping the content controls Word puts
// around an inserted page number — its w:p is not a child of w:hdr/w:ftr.
function hfParagraphs(el: Element): Element[] {
  const out: Element[] = [];
  for (const c of Array.from(el.children)) {
    if (c.namespaceURI !== W) continue;
    if (c.localName === 'p') out.push(c);
    else if (c.localName === 'sdt') {
      const content = fc(c, 'sdtContent');
      if (content) out.push(...hfParagraphs(content));
    }
  }
  return out;
}

// Collapse several source paragraphs' box props into one (mirror of odt.ts mergeHfBox).
function mergeHfBox(maps: Record<string, string>[]): Record<string, string> {
  const out: Record<string, string> = {};
  const first = (k: string) => maps.find((m) => m[k] !== undefined)?.[k];
  const last = (k: string) => [...maps].reverse().find((m) => m[k] !== undefined)?.[k];
  for (const [k, v] of [
    ['backgroundColor', first('backgroundColor')],
    ['borderTop', first('borderTop')],
    ['borderLeft', first('borderLeft')],
    ['borderRight', first('borderRight')],
    ['borderBottom', last('borderBottom')],
  ] as const) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
