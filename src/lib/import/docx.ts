import { UNFORMATTED_MARKS, blockFormat, type RevMark } from '../editor/extensions/trackChanges';
import { strFromU8 } from 'fflate';
import en from '../i18n/locales/en';
import { DocxStyles, parseRunProps, mergeRunProps, readNumPr, readSpacing, readTabStops, toggle as onOff, wVal, W, R, WP, A, B, WPS, WPG, MC, VML, O, W10, PKG_REL, type RunProps, type ParaSpacing } from './docxStyles';
import { mostlyAsian } from '../utils/script';
import { lengthToPt, WATERMARK_NAME } from './styleResolver';
import { normalizeColor, labelledItems } from '../export/odt';
import { HEADING_STYLE_OVERRIDES, MAX_HEADING_LEVEL } from '../styles/headings';
import { PLACEHOLDER_SDT_TAG } from '../export/docx';
import { isAllowedUri } from '@tiptap/extension-link';
import { FOLD_MARK_NAME } from '../storage/foldMarks';
import { builtinStyleSheet, DEFAULT_STYLE, screenFontName, type ParaProps, type Style, type StyleSheet, type TextProps } from '../styles/styleSheet';
import { DEFAULT_OUTLINE_LEVEL, MAX_OUTLINE_LEVELS, type OutlineNumbering } from '../styles/outlineNumbering';
import { markerFormatFromText, pruneImportedMarkers } from '../editor/extensions/listMarker';
import { MAX_LIST_LEVELS, type ListLevelStyle, type ListStyle } from '../styles/listStyles';
import { HEADER_SHADE } from '../editor/extensions/tableHeaderRow';
import { cropOf, fitInlineImage, framePx, stackRank, wrapGap, wrapGapAttr, type ColorMode, type WrapGap } from '../editor/extensions/image';
import { TEXTBOX_PADDING_CM, boxTextWidthCm } from '../editor/extensions/textBox';
import { formatTabStops } from '../editor/extensions/tabStops';
import type { CapsMode, LineStyle } from '../editor/extensions/textEffects';
import { builtinTableStyles, parseTableLook, resolveTableCell, tableLookAttr } from '../styles/tableStyles';
import { formatOrdinal, knownNumFormat, orderedTypeFromFormat, orderedTypeAttrAt, childCycle, ROOT_ORDERED_CYCLE, type OrderedCycle } from '../utils/orderedListTypes';
import { bulletCharAttr, bulletCharFromDocx } from '../utils/bulletListTypes';
import { DATE_FORMATS, TIME_FORMATS, docxPicture, findFormat, toDateValue } from '../utils/dateTime';
import { shapeFromPrst, isLineKind, lineKindFor, parseSvgPath, parseVmlPath, fitPath, pathHeadsFor, isOpenOutline, joinOutlineParts, shadeFromDrawingMl, asTextArea, type OutlinePart, type PathCmd, type DrawingMlPreset } from '../utils/shapes';
import { drawingMlArc, drawingMlGuides, drawingMlValue, type ResolvedGeometry } from '../utils/enhancedGeometry';
import { presetGeometry } from '../utils/shapePresets';
import { imageDataUrl, placeholderImage, unzipArchive, type ConvertedImages } from './imageFormats';
import { parseImportXml } from './importLimits';
import { PX_PER_CM, cmToPx, fitMargins, type PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import type { RecordLock } from '../storage/trackChanges.svelte';
import { pageFormatOf, type PageFormat } from '../storage/pageFormat';
import { clampTabInterval, DOCX_IMPLIED_TAB_CM } from '../storage/tabInterval';
import { languageFromOdf, mainOfPair, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';
import { EMPTY_HF_SET, HF_DISTANCE_CM, hfIsEmpty, type HfDistances, type HfDoc, type HfSet } from '../storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS, type NoteKind, type NoteNumFormat, type NoteSettings } from '../storage/noteSettings';
import { EMPTY_DOC_PROPERTIES, type DocProperties } from '../storage/docProperties';
import { clampPageStart, DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
import { citationStyleFromDocx, type CitationStyle } from '../utils/citationStyle';
import { applyUniformRunFont, dropDefaultAsianFont, pairAlignedFrames, sinkOffsetFrames, unnestBoxes, type OdtImportResult } from './odt';
import { chartDataUrl } from './chart';
import { deobfuscateOdttf, type EmbeddedFont } from '../fonts/embeddedFonts';
import { cellPaddingAttr, DEFAULT_CELL_PADDING, type CellPadding } from '../editor/extensions/tableCellPadding';
import { fromWriterFormula } from '../utils/tableFormula';
import { cellFormatFromCode, type CellFormat } from '../utils/cellFormat';
import { ODF_SEQ_CATEGORY } from '../editor/extensions/caption';
import type { CrossRefFormat } from '../editor/extensions/crossReference';
import type { IndexKind, TocEntry } from '../editor/extensions/tableOfContents';
import { bibTypeFromDocx, DOCX_BIB_FIELD, type BibSource } from '../editor/extensions/bibliographyEntry';
import { normalizePageDecor, type PageDecor } from '../storage/pageDecor';
import { DEFAULT_LINE_NUMBERING, normalizeLineNumbering, type LineNumbering } from '../storage/lineNumbering';
import { DEFAULT_LINE_GRID, normalizeLineGrid, type LineGrid } from '../storage/lineGrid';
import { clampColumnGap } from '../editor/extensions/columns';
import { astToLatex } from '../math/latex';
import { parseOmml, OMML_NS } from '../math/omml';

// Warnings are the English catalog text; localizeImportMessage maps them at display time.
const WARN = en.importWarn;

// .docx → TipTap JSON, inverting export/docx.ts. Editor-expressible OOXML becomes its
// native node/mark/attr; values matching the editor's defaults are suppressed so round
// trips don't accrete attrs. Real Word/LibreOffice files degrade gracefully (reported).

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: Mark[]; text?: string };
type BlockKind = 'body' | 'list' | 'cell' | 'zone';

type RelInfo = { target: string; external: boolean };
type Ctx = {
  styles: DocxStyles;
  // A page break ending a body run of blocks with nothing after it to move (convertBlocks).
  breakCarry?: boolean;
  // The document's main language tag (mainOfPair).
  mainLang: string | null;
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
  listCounters: Map<number, Map<number, number>>; // numId → ilvl → last number used
  // Heading level → the first w:numPr a heading of it states on itself, for chapter
  // numbering where the heading style carries none.
  headingNumPr: Map<number, { numId: number; ilvl: number }>;
  // `numId:ilvl` levels that also number a body paragraph: on a heading, a list's level.
  bodyNumLevels: Set<string>;
  usedListStyles: Map<number, string>; // numId → the named numbering style it links to
  // Text width (cm) of the file's page setup; a table's margins are relative to it.
  contentWidthCm: number;
  // Text width (cm) of the cell being converted: what a table nested in it measures against.
  cellWidthCm?: number;
  // Left page margin (cm), the origin a page-relative frame offset is measured against.
  leftMarginCm: number;
  rightMarginCm: number;
  // Page and text-area height (cm): what a frame centred or set to the bottom of either sits in.
  pageHeightCm: number;
  textHeightCm: number;
  // The section's own direction: a block declaring the same one is inheriting, not
  // formatted, so only a block that differs carries a `dir` attr.
  pageRtl: boolean;
  // Word's document-wide automatic hyphenation: a paragraph can only turn it off.
  hyphenate: boolean;
  // settings.xml m:defJc: where a math paragraph without its own m:jc stands.
  mathJc?: string | null;
  // The citation style the sources part names (b:Sources StyleName).
  citationStyle: CitationStyle;
  // The enclosing table style's w:pPr/w:spacing, applied to its cells' paragraphs.
  cellSpacing: ParaSpacing;
  // Whether w:tblInd is measured to the cell's text rather than the table's edge.
  compatMode: number; // w:compatibilityMode, 0 for an old file that states none
  // theme1.xml's accent1..6, the colours a chart series names instead of an sRGB.
  accents: string[];
  // The whole colour scheme by slot name (accent1, tx2, …), which a shape's fill names.
  themeColors: Map<string, string>;
  // The theme's line widths in pt, which a shape's wps:style lnRef picks by index.
  themeLineWidths: number[];
  // Bookmarks open at this point of the walk (w:id → name). A range may start beside a
  // paragraph and end inside a later one, so the state outlives both walks.
  /** Bookmarks whose range is open, by w:id; `used` once a run has carried the name. */
  openBookmarks: Map<string, { name: string; used: boolean }>;
  /** Names of empty bookmarks (start and end with no run between), for the next run. */
  pointBookmarks: Set<string>;
  // Comment ranges currently open, by Word's numeric id → the mark's attrs.
  openComments: Map<string, Record<string, unknown>>;
  // word/comments.xml, by id.
  commentDefs: Map<string, Record<string, unknown>>;
  /** Each w:moveFrom and w:moveTo of the part, by the move it belongs to. */
  moveNames: Map<Element, string>;
  // The bibliography sources of the custom-XML part, by tag; a CITATION names one.
  bibSources: Map<string, BibSource>;
  // word/footnotes.xml and endnotes.xml by w:id, and the notes the body referenced, in
  // anchor order — the editor keeps them in one section at the document end (notes.ts).
  noteParts: Record<NoteKind, Map<string, Element>>;
  // Bookmark name → note id, for the NOTEREF/PAGEREF fields Word points at a mark
  // inside a note rather than at the anchor in the text.
  noteBookmarks: Map<string, string>;
  notes: { id: string; kind: NoteKind; label: string | null; text: string; content: Node[]; styleName: string | null }[];
  // Converting a header/footer part: page fields, no notes, comments or revisions.
  zone?: boolean;
  // The body's open index field. Word may open one in the paragraph that ends a section
  // and fill it in the next, so it outlives the per-section walk.
  bodyField?: BodyField;
  // The columns of the section being walked, which an index laid out in them takes.
  sectionCols?: { count: number; gapCm: number } | null;
};

// The bookmark around a note's own reference mark, mapped to the note — the target a
// NOTEREF field names, and the one the export plants there. Only that one addresses the
// note: an ordinary bookmark elsewhere in the note's text marks that text, and reading
// every name in the note as the note made a reference to a caption inside it point at
// the note's number instead. The id matches the one noteRefNode mints for the anchor.
function noteBookmarkNames(parts: Record<NoteKind, Map<string, Element>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const kind of ['footnote', 'endnote'] as NoteKind[]) {
    const marker = `${kind}Ref`;
    for (const [wid, el] of parts[kind]) {
      const open = new Map<string, string>();
      for (const node of Array.from(el.getElementsByTagNameNS(W, '*'))) {
        const id = node.getAttributeNS(W, 'id');
        if (node.localName === 'bookmarkStart') {
          const name = node.getAttributeNS(W, 'name');
          if (name && id) open.set(id, name);
        } else if (node.localName === 'bookmarkEnd') {
          if (id) open.delete(id);
        } else if (node.localName === marker) {
          for (const name of open.values()) if (!out.has(name)) out.set(name, `${kind}${wid}`);
        }
      }
    }
  }
  return out;
}

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
// A twip length in cm, to the hundredth where that still names the same twip (a length
// typed in cm comes back as typed), else to the thousandth — so it saves back unchanged.
const twipCm = (tw: number) => {
  const cm = round2(twipToCm(tw));
  return Math.round((cm / 2.54) * 1440) === tw ? cm : Math.round(twipToCm(tw) * 1000) / 1000;
};

// A run-level <w:br w:type="page"/> becomes this sentinel inline node in convertInline;
// splitParaAtPageBreaks consumes it (body only) into breakBefore, and it never survives.
const PB_MARKER = '__docxPageBreak__';

// The block types that can open a section: they carry `sectionBreak`/`breakBefore`
// (pageBreak.ts) and both exports write the pair from them.
const SECTION_CARRIERS = new Set(['paragraph', 'heading', 'table', 'tableOfContents']);

const BODY_FONT_SIZE_PT = 12;
// Rounded to half points: that is all Word can store, so it is what our own export
// writes and what an imported heading must be compared against.
const HEADING_SIZES = HEADING_STYLE_OVERRIDES.map((h) => Math.round(lengthToPt(h.fontSize)! * 2) / 2);
// The vertical margins a heading renders with when the block carries none of its own.
const HEADING_MARGINS = HEADING_STYLE_OVERRIDES.map((h) => ({
  topPt: lengthToPt(h.marginTop)!, bottomPt: lengthToPt(h.marginBottom)!,
}));
const HEADING_ITALIC = HEADING_STYLE_OVERRIDES.map((h) => h.italic === true);
const DEFAULT_FONTS = new Set(['times new roman', 'liberation serif']);
// Headings render sans (HEADING_FONT); Word writes Arial, LibreOffice Liberation Sans.
const DEFAULT_HEADING_FONTS = new Set(['arial', 'liberation sans']);
const LIST_LEFT_STEP_CM = 1.27; // matches export/docx.ts
const LIST_HANGING_CM = 0.635; // matches export/docx.ts
const LIST_INDENT_EPS_CM = 0.05;
const LINK_BLUE = '#0563C1'; // the visual the exporter paints on hyperlink runs

// ---- small DOM helpers ------------------------------------------------------
// Child walks go by sibling and whole-part queries through `list`: jsdom (the tests) answers
// every `length` read of a live collection with a scan of it, so iterating one is quadratic.
const list = <T extends Element>(c: HTMLCollectionOf<T>): T[] => Array.prototype.slice.call(c);
function fc(el: Element | null, localName: string): Element | null {
  for (let c = el?.firstElementChild ?? null; c; c = c.nextElementSibling) if (c.namespaceURI === W && c.localName === localName) return c;
  return null;
}
function fcAll(el: Element, localName: string, ns: string = W): Element[] {
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.namespaceURI === ns && c.localName === localName) out.push(c);
  return out;
}
function intAttr(el: Element | null, ns: string, name: string): number | null {
  if (!el) return null;
  const v = ns ? el.getAttributeNS(ns, name) : el.getAttribute(name);
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function parseXml(xml: string): Document {
  const doc = parseImportXml(xml, 'docx');
  // A content control around a row or a cell holds nothing a table walk reads but the
  // w:tr / w:tc itself, so it is unwrapped where it stands.
  for (const sdt of list(doc.getElementsByTagNameNS(W, 'sdt'))) {
    const parent = sdt.parentNode as Element | null;
    if (parent?.namespaceURI !== W || (parent.localName !== 'tbl' && parent.localName !== 'tr')) continue;
    const content = fc(sdt, 'sdtContent');
    if (content) while (content.firstChild) parent.insertBefore(content.firstChild, sdt);
    parent.removeChild(sdt);
  }
  // A range marker beside a table's rows or cells moves into the cell paragraph next to it,
  // where the paragraph walk reads it: the walk over rows and cells passes it by.
  const moved = new Set<Element>();
  for (const m of [...RANGE_MARKERS].flatMap((n) => list(doc.getElementsByTagNameNS(W, n)))) {
    const parent = m.parentNode as Element | null;
    if (parent?.namespaceURI !== W || (parent.localName !== 'tbl' && parent.localName !== 'tr')) continue;
    let next = m.nextElementSibling;
    while (next && next.localName !== 'tr' && next.localName !== 'tc') next = next.nextElementSibling;
    let prev = m.previousElementSibling;
    while (prev && prev.localName !== 'tr' && prev.localName !== 'tc') prev = prev.previousElementSibling;
    const nextP = next?.getElementsByTagNameNS(W, 'p')[0];
    const prevPs = prev?.getElementsByTagNameNS(W, 'p');
    if (nextP) {
      let at = nextP.firstElementChild;
      while (at && (at.localName === 'pPr' || moved.has(at))) at = at.nextElementSibling;
      nextP.insertBefore(m, at);
    } else if (prevPs?.length) prevPs[prevPs.length - 1].appendChild(m);
    moved.add(m);
  }
  return doc;
}
const RANGE_MARKERS = new Set(['bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd']);

// '#RRGGBB' from a Word color (6-hex without #, or named). null for auto/empty.
function hexColor(v: string | null | undefined): string | undefined {
  if (!v || v === 'auto') return undefined;
  return /^[0-9a-fA-F]{6}$/.test(v) ? normalizeColor(`#${v}`) : normalizeColor(v);
}

// ---- entry ------------------------------------------------------------------
export function importDocx(bytes: Uint8Array, convertedImages: ConvertedImages = new Map()): OdtImportResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipArchive(bytes);
  } catch {
    throw new Error(en.importError.docxArchive);
  }
  const docBytes = files['word/document.xml'];
  if (!docBytes) throw new Error(en.importError.docxMissing);

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
  if (!body) throw new Error(en.importError.docxNoBody);

  const docLangs = documentLanguage(styles.paragraphRun(null), body, warnings);

  const sectPr = fc(body, 'sectPr');
  const contentWidthCm = sectionContentWidthCm(sectPr);
  const leftMarginCm = twipToCm(intAttr(fc(sectPr, 'pgMar'), W, 'left') ?? 1440);
  const rightMarginCm = twipToCm(intAttr(fc(sectPr, 'pgMar'), W, 'right') ?? 1440);
  const ctx: Ctx = { styles, styleNames, usedStyles: new Set(), charStyleNames, usedCharStyles: new Set(), warnings, files, rels: parseRels(files['word/_rels/document.xml.rels']), imageCache: new Map(), convertedImages, listCounters: new Map(), headingNumPr: new Map(), bodyNumLevels: new Set(), usedListStyles: new Map(), contentWidthCm, leftMarginCm, rightMarginCm, ...sectionHeightsCm(sectPr), pageRtl: sectPrRtl(sectPr), mainLang: docLangs.main, hyphenate: docSetting(files, 'autoHyphenation'), mathJc: docMathJc(files), cellSpacing: {}, compatMode: wordCompatMode(files), accents: themeAccents(themeDoc), themeColors: themeColors(themeDoc), themeLineWidths: Array.from(themeDoc?.getElementsByTagNameNS(A, 'lnStyleLst')[0]?.children ?? [], (ln) => (Number(ln.getAttribute('w')) || 12700) / 12700), openBookmarks: new Map(), pointBookmarks: new Set(), openComments: new Map(), commentDefs: docxComments(files), moveNames: moveNames(body), bibSources: docxSources(files), citationStyle: docxCitationStyle(files), notes: [], noteParts: {
    footnote: noteParts(files, 'footnotes', 'footnote'),
    endnote: noteParts(files, 'endnotes', 'endnote'),
  }, noteBookmarks: new Map() };
  ctx.noteBookmarks = noteBookmarkNames(ctx.noteParts);
  for (const p of list(body.getElementsByTagNameNS(W, 'p'))) {
    const np = headingLevelOf(fc(p, 'pPr'), ctx) == null ? paragraphNum(p, ctx) : null;
    if (np) ctx.bodyNumLevels.add(`${np.numId}:${np.ilvl}`);
  }

  // Mid-body sectPr paragraphs delimit sections; a section whose w:cols declares
  // more than one column becomes a columns node (the trailing group is described
  // by the body-final sectPr, covering whole-document multi-column files).
  const { groups, midSectPrs } = splitBodySections(list(body.children));
  ctx.bodyField = newBodyField();
  const finalSectPr = fc(body, 'sectPr');
  const blocks: Node[] = [];
  const groupCols = groups.map((g) => sectPrColumns(g.sectPr ?? finalSectPr, ctx));
  // A continuous break where the column setup changes only encodes a columns region
  // (the export splits there without opening a section): no section break, and the
  // group shares the previous one's header/footer set.
  const colsOnly = groups.map((g, gi) => gi > 0
    && !sectionStartsNewPage(g.sectPr ?? finalSectPr)
    && JSON.stringify(groupCols[gi]) !== JSON.stringify(groupCols[gi - 1]));
  // Whether each group could be marked. The marker is ordinal — the editor counts the
  // blocks carrying it to index the header/footer sets — so a group that carries none
  // must drop its set too, or every later section would render the one before it.
  const marked = groups.map(() => true);
  groups.forEach((g, gi) => {
    // Blocks measure against their own section's text width.
    const sect = g.sectPr ?? finalSectPr;
    ctx.contentWidthCm = sectionContentWidthCm(sect);
    ctx.leftMarginCm = twipToCm(intAttr(fc(sect, 'pgMar'), W, 'left') ?? 1440);
    ctx.rightMarginCm = twipToCm(intAttr(fc(sect, 'pgMar'), W, 'right') ?? 1440);
    Object.assign(ctx, sectionHeightsCm(sect));
    ctx.sectionCols = groupCols[gi];
    // A page break ending the last section moves this one's first block, which keeps its
    // space above there (measured in LibreOffice), unlike one moved within a section.
    const carried = gi > 0 && ctx.breakCarry;
    const inner = convertBlocks(g.els, ctx, 'body');
    if (carried && inner[0] && SECTION_CARRIERS.has(inner[0].type)) inner[0].attrs = { ...(inner[0].attrs ?? {}), breakBefore: 'page' };
    // A section's own w:type says how it begins: a page-starting break (nextPage/odd/even,
    // or the default) puts its first block on a new page; continuous/nextColumn flow on.
    if (gi > 0 && !colsOnly[gi]) {
      // Only these three carry the marker and the page break in front of it (pageBreak.ts),
      // so a section opening with anything else is not modelled as one and keeps the
      // previous section's page setup. Marking a later block instead would break the page
      // inside the section and leave two sections on one page, which the grid cannot draw.
      const first = inner[0];
      if (first && SECTION_CARRIERS.has(first.type)) {
        first.attrs = { ...(first.attrs ?? {}), sectionBreak: true };
        if (sectionStartsNewPage(sect)) first.attrs.breakBefore = 'page';
      } else marked[gi] = false;
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
  // The edge→zone distances are the first section's too, as its zones are.
  const firstSect = parseSectPr(groups[0]?.sectPr ?? finalSectPr, ctx, oddEven);
  // The paper is the *first* section's, as the margins are: a document whose last
  // section is one landscape page is not a landscape document.
  const docPaper = sectPaper(groups[0]?.sectPr ?? finalSectPr);
  // The *first* section's, as the paper and the margins are: a document whose front
  // matter is roman is not a roman document, and vice versa.
  const docNumbering = docxPageNumbering(groups[0]?.sectPr ?? finalSectPr);
  const hfSections = sectionHfSets(
    groups.filter((_, gi) => !colsOnly[gi] && marked[gi]).map((g) => g.sectPr ?? finalSectPr), ctx, oddEven,
    { ...docPaper, numFormat: docNumbering.format, mirrored });
  const first = hfSections[0];
  // A first-page/even zone reserves the header/footer band even when its default is empty;
  // the distance is document-wide, so any section having one is enough.
  const hasHeader = hfSections.some((s) => s.header || (s.differentFirstPage && s.headerFirst) || (s.differentOddEven && s.headerEven));
  const hasFooter = hfSections.some((s) => s.footer || (s.differentFirstPage && s.footerFirst) || (s.differentOddEven && s.footerEven));

  const result: OdtImportResult = {
    content: { type: 'doc', content: blocks },
    styles: collectStyleSheet(ctx),
    notes: docNoteSettings(files),
    margins: withMirror(first.margins ?? sect.margins, mirrored),
    rtl: sectPrRtl(finalSectPr),
    decor: docxPageDecor(docDoc, finalSectPr, files,
      shownHeaderParts([...groups.map((g) => g.sectPr), finalSectPr], ctx, oddEven)),
    lineNumbering: docxLineNumbering(finalSectPr),
    // The first section's, as the margins and the paper are.
    lineGrid: docxLineGrid(groups[0]?.sectPr ?? finalSectPr),
    foldMarks: docxFoldMarks(files),
    // Word's Layout ▸ Hyphenation.
    hyphenate: docSetting(files, 'autoHyphenation'),
    recordChanges: docRecordsChanges(files),
    recordLock: docRecordLock(files),
    pageNumbering: docNumbering,
    orientation: docPaper.orientation,
    format: docPaper.format,
    tabIntervalCm: docTabInterval(files),
    // Word takes the larger of the two spacings, and LibreOffice follows it for a
    // Word document — its own ODF default adds them (probed).
    spacingModel: 'max' as const,
    // Word applies space above at a page top unless its own compatibility flag says not to.
    spacingAtPageStart: !docSetting(files, 'suppressSpBfAfterPgBrk'),
    balanceSpaces: docSetting(files, 'balanceSingleByteDoubleByteWidth'),
    header: first.header,
    footer: first.footer,
    headerFirst: first.differentFirstPage ? first.headerFirst : null,
    footerFirst: first.differentFirstPage ? first.footerFirst : null,
    differentFirstPage: first.differentFirstPage,
    headerEven: first.differentOddEven ? first.headerEven : null,
    footerEven: first.differentOddEven ? first.footerEven : null,
    differentOddEven: first.differentOddEven,
    hfSections,
    headerDistanceCm: hasHeader ? firstSect.headerDistCm : null,
    footerDistanceCm: hasFooter ? firstSect.footerDistCm : null,
    language: docLangs.language,
    languageOther: docLangs.other,
    props: docxDocProperties(files),
    fonts: extractDocxFonts(files),
    warnings: [...warnings],
  };
  rankRowLevels(result.content as Node);
  pruneImportedMarkers(result as unknown as Parameters<typeof pruneImportedMarkers>[0]);
  return result;
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

// The default style's two languages (docDefaults included), and which is the main one.
function documentLanguage(run: RunProps, body: Element, warnings: Set<string>): { language: DocumentLanguage | null; main: string | null; other: string | null } {
  const { main, other } = mainOfPair(run.lang ?? null, run.langEastAsia ?? null, mostlyAsian(body.textContent ?? ''));
  if (!main) return { language: null, main, other };
  const [language, country] = main.split('-');
  const code = languageFromOdf(language, country);
  if (!code) warnings.add(WARN.noDictionary(main));
  return { language: code ?? NO_LANGUAGE, main, other };
}

// ---- block conversion (paragraphs, lists, tables) --------------------------
// An index row runs its page number out to a right tab stop, and the dots in between are
// that stop's leader. The field opens on its own first row, so the look sits on the very
// paragraph the node is built from.
function tocRowTab(el: Element, ctx: Ctx): { leader?: string; tabPosCm?: number } {
  const tabs = fc(fc(el, 'pPr'), 'tabs');
  const stop = tabs ? readTabStops(tabs).find((t) => t.align === 'right') : undefined;
  if (!stop) return {};
  // A stop at the text width (or the column's, in columns) is where a row's number lands
  // anyway, so it names no position of its own — the ODF side suppresses it the same way.
  const columnCm = columnWidthCm(ctx);
  const own = stop.pos > 0 && Math.abs(stop.pos - ctx.contentWidthCm) > 0.05 && Math.abs(stop.pos - columnCm) > 0.05;
  return { ...(stop.leader ? { leader: stop.leader } : {}), ...(own ? { tabPosCm: stop.pos } : {}) };
}

// The width of one column of the section being read: the text width outside columns.
function columnWidthCm(ctx: Ctx): number {
  const cols = ctx.sectionCols;
  return cols ? (ctx.contentWidthCm - cols.gapCm * (cols.count - 1)) / cols.count : ctx.contentWidthCm;
}

// A TOC is a `TOC` field spanning several paragraphs, each entry a nested PAGEREF field,
// so field depth is tracked (across one convertBlocks call) to match the TOC's own end.
type TocFieldState = { fieldDepth: number; tocDepth: number; instr: string[] };
type BodyField = { state: TocFieldState; into: { entries: TocEntry[]; kind: IndexKind; pages: boolean; node: Node } | null };
const newBodyField = (): BodyField => ({ state: { fieldDepth: 0, tocDepth: -1, instr: [] }, into: null });

// INDEX's \c is its column count (a TOC's names a caption label instead).
function indexColumns(instr: string): { columns?: number } {
  const n = Number(/\\c\s+"?\s*(\d+)/.exec(instr)?.[1]);
  return n > 1 ? { columns: Math.min(n, 3) } : {};
}

// The deepest heading level a TOC field lists: the end of its `\o "1-3"` range (Word's
// own default is 1-9). Anything deeper only inflates the block on screen.
function tocMaxLevel(instr: string): number {
  const m = /\\o\s+"?\s*\d+\s*-\s*(\d+)/.exec(instr);
  const n = m ? Number(m[1]) : NaN;
  // \t "Style;level;Style;level" lists styles at levels of their own, past \o's range too.
  const t = /\\t\s+"([^"]*)"/.exec(instr)?.[1].split(/[;,]/).filter((_, i) => i % 2).map(Number) ?? [];
  const deepest = Math.max(n >= 1 ? n : 0, ...t.filter((l) => l >= 1));
  return deepest >= 1 && (m || t.length) ? Math.min(MAX_HEADING_LEVEL, deepest) : MAX_HEADING_LEVEL;
}

// `\n` drops the page numbers. Word names a level range with it; the editor's index is
// all-or-nothing, so any range reads as an index of text alone. Only the off state is
// carried, as on the ODF side, where it is the entry template's missing page number.
const tocPageNumbers = (instr: string): { pageNumbers?: false } =>
  (/\\n\b/.test(instr) ? { pageNumbers: false } : {});

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

// A recorded deletion keeps a field's instruction in w:delInstrText, read the same.
const instrTextOf = (el: Element): string =>
  Array.from(el.getElementsByTagNameNS(W, '*')).filter(i => i.localName === 'instrText' || i.localName === 'delInstrText')
    .map(i => i.textContent ?? '').join('');

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

// `closedAt` is the index of the run whose end closes the TOC field: the runs after it
// are the paragraph's own text again.
function scanTocField(p: Element, st: TocFieldState): { emit: boolean; closedAt: number } {
  let emit = false;
  let closedAt = -1;
  for (const [ri, r] of Array.from(p.getElementsByTagNameNS(W, 'r')).entries()) {
    for (const c of Array.from(r.children)) {
      if (c.namespaceURI !== W) continue;
      if (c.localName === 'fldChar') {
        const t = c.getAttributeNS(W, 'fldCharType');
        if (t === 'begin') { st.fieldDepth++; st.instr[st.fieldDepth] = ''; }
        else if (t === 'end') {
          if (st.tocDepth === st.fieldDepth) { st.tocDepth = -1; closedAt = ri; }
          st.instr[st.fieldDepth] = '';
          st.fieldDepth = Math.max(0, st.fieldDepth - 1);
        }
      } else if (c.localName === 'instrText' && st.fieldDepth > 0) {
        st.instr[st.fieldDepth] += c.textContent ?? '';
        if (st.tocDepth < 0 && /\b(TOC|INDEX|BIBLIOGRAPHY)\b/.test(st.instr[st.fieldDepth])) {
          st.tocDepth = st.fieldDepth;
          emit = true;
        }
      }
    }
  }
  return { emit, closedAt };
}

// The paragraph's runs up to and including run `at` (`head`) or only those after it.
function splitRunsAt(p: Element, at: number, head: boolean): Element {
  const copy = p.cloneNode(true) as Element;
  Array.from(copy.getElementsByTagNameNS(W, 'r')).forEach((r, i) => {
    if (head ? i > at : i <= at) r.parentNode?.removeChild(r);
  });
  return copy;
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

// One cached row of an index field: its text up to the last tab, the page number after
// it, the level from its entry style. The index shows these as saved until updated.
function cachedIndexEntry(p: Element, ctx: Ctx, kind: IndexKind, pages: boolean): TocEntry | null {
  let text = '';
  for (const r of Array.from(p.getElementsByTagNameNS(W, 'r'))) {
    for (const c of Array.from(r.children)) {
      if (c.namespaceURI === W && c.localName === 't') text += c.textContent ?? '';
      else if (c.namespaceURI === W && c.localName === 'tab') text += '\t';
    }
  }
  // An INDEX field without \e puts ", " before the numbers instead of a tab.
  const comma = pages && kind === 'alphabetical' && !text.includes('\t') ? /,\s*(?=\d[\d,;\s]*$)/.exec(text) : null;
  const cut = comma ? comma.index : pages ? text.lastIndexOf('\t') : -1;
  // A tab inside the text stays one: it sets the title at the level's hanging indent.
  const body = (cut < 0 ? text : text.slice(0, cut)).replace(/\t+/g, '\t').trim();
  const nums = cut < 0 ? [] : text.slice(cut + (comma ? comma[0].length : 1)).split(/[,;]/).map((n) => parseInt(n, 10)).filter((n) => n > 0);
  if (!body) return null;
  // A style the file names but does not define still says its level in its id (TOC2).
  const id = styleIdOf(fc(p, 'pPr'), ctx) ?? '';
  const name = ctx.styleNames.get(id);
  const levelMatch = name ? INDEX_LEVEL_STYLES[kind]?.exec(name) : /(\d+)$/.exec(id);
  const level = Number(levelMatch?.[1]) || 1;
  const indent = levelMatch ? null : intAttr(fc(fc(p, 'pPr'), 'ind'), W, 'left') ?? intAttr(fc(fc(p, 'pPr'), 'ind'), W, 'start') ?? 0;
  // An alphabetical row with no number is a letter row, which is no entry, or — in a
  // level's own style — a term heading its subentries, which lists no page (`pages: []`).
  if (kind === 'alphabetical' && pages && !nums.length) {
    return levelMatch ? { text: body, level: Math.min(MAX_HEADING_LEVEL, level), page: 1, pages: [] } : null;
  }
  const entry: TocEntry = { text: body, level: Math.min(MAX_HEADING_LEVEL, level), page: nums[0] ?? 1, ...(nums.length > 1 ? { pages: nums } : {}) };
  if (indent != null) rowIndents.set(entry, indent);
  return entry;
}

// Rows whose style names no level (a web export's own) take it from how far in they sit,
// as they are drawn: the least indented is level 1. Run once an index has all its rows.
const rowIndents = new WeakMap<TocEntry, number>();
function rankRowLevels(node: Node): void {
  if (node.type === 'tableOfContents' && Array.isArray(node.attrs?.entries)) {
    const entries = node.attrs.entries as TocEntry[];
    const indents = [...new Set(entries.map((e) => rowIndents.get(e)).filter((v): v is number => v != null))].sort((a, b) => a - b);
    if (indents.length > 1) for (const e of entries) {
      const at = rowIndents.get(e);
      if (at != null) e.level = Math.min(MAX_HEADING_LEVEL, indents.indexOf(at) + 1);
    }
  }
  for (const c of node.content ?? []) rankRowLevels(c);
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
    if (id && name && !BOOKMARK_SKIP.has(name)) ctx.openBookmarks.set(id, { name, used: false });
    return true;
  }
  if (el.localName === 'bookmarkEnd') {
    const id = el.getAttributeNS(W, 'id');
    const open = id ? ctx.openBookmarks.get(id) : undefined;
    // A bookmark Word set on a point rather than a range — what it writes for a
    // "current position" target — has no text to mark, so the next run carries it.
    if (open && !open.used) ctx.pointBookmarks.add(open.name);
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

// The range markers inside content the import collapses or skips: its text is gone, the
// ranges it opens or closes are not, or a missed end would run to the document end.
function trackRanges(el: Element, ctx: Ctx): void {
  for (const m of Array.from(el.getElementsByTagNameNS(W, '*'))) if (!trackBookmark(m, ctx)) trackComment(m, ctx);
}

// Every comment the run sits in: ranges overlap, and each is a mark of its own.
function openCommentMarks(ctx: Ctx): Mark[] {
  return Array.from(ctx.openComments.values(), (attrs) => ({ type: 'comment', attrs }));
}

// Every bookmark the run sits in, plus the point bookmarks waiting for a run to land on.
function openBookmarkMarks(ctx: Ctx): Mark[] {
  const names = new Set<string>();
  for (const open of ctx.openBookmarks.values()) { open.used = true; names.add(open.name); }
  for (const name of ctx.pointBookmarks) names.add(name);
  ctx.pointBookmarks.clear();
  return [...names].map((name) => ({ type: 'bookmark', attrs: { name } }));
}

function convertBlocks(children: Element[], ctx: Ctx, kind: BlockKind, boldByDefault = false): Node[] {
  const out: Node[] = [];
  // `textTwip`: where the level's item text starts, which a further paragraph of an item lines up with.
  const stack: { ilvl: number; numId: number; list: Node; textTwip: number | null }[] = [];
  // A page break ending one paragraph moves the next block to a new page (breakBefore).
  // Only SECTION_CARRIERS hold it; any other block kind clears it (break dropped).
  let breakPending = false;
  const applyBreakBefore = (node: Node | undefined) => {
    if (node && SECTION_CARRIERS.has(node.type)) {
      node.attrs = { ...(node.attrs ?? {}), breakBefore: 'page', ...breakCharSpace(node) };
    }
  };
  // Table-of-contents field tracking (see scanTocField). A TOC node is emitted for the
  // body only; its cached paragraphs (a bibliography's table rows) become its entries.
  const field = kind === 'body' && ctx.bodyField ? ctx.bodyField : newBodyField();
  const tocState = field.state;
  // Floating tables, each with the place in `out` its anchor follows (floatingTableBox).
  const floatBoxes: { box: Node; at: number }[] = [];

  // The last ordered list `out` took, which a later one of the same numId continues.
  type Ordered = { list: Node; numId: number };
  let lastOrdered = null as Ordered | null;
  const closeTop = () => {
    const top = stack.pop()!;
    if (stack.length) {
      const parent = stack[stack.length - 1].list;
      let item = parent.content![parent.content!.length - 1];
      // A level opened with no item above it is an item without a label of its own.
      if (!item) { item = { type: 'listItem', content: [] }; parent.content!.push(item); }
      item.content!.push(top.list);
    } else {
      out.push(top.list);
      if (top.list.type === 'orderedList') lastOrdered = { list: top.list, numId: top.numId };
    }
  };
  const flush = () => { while (stack.length) closeTop(); };

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
        out.push({ type: 'tableOfContents', attrs: { entries: null, title: '', index,
          ...(index === 'bibliography' ? { citationStyle: ctx.citationStyle } : {}) } });
        trackRanges(el, ctx);
        continue;
      }
      const { emit, closedAt } = scanTocField(el, tocState);
      // The paragraph the field ends in goes on as body text after the end.
      const tail = closedAt >= 0 ? splitRunsAt(el, closedAt, false) : null;
      const tailKept = !!tail && ['t', 'drawing', 'pict', 'object'].some((n) =>
        Array.from(tail.getElementsByTagNameNS(W, n)).some((e) => n !== 't' || e.textContent));
      if (emit && kind === 'body') {
        flush();
        // The field carries no heading of its own — Word's sits in a separate paragraph.
        const instr = instrTextOf(el);
        const index = tocIndexKind(instr);
        // A bibliography has no levels; every other index does, the alphabetical one's
        // being its own three, as the ODF side reads them off its entry templates.
        const levels = index === 'bibliography' ? null : tocMaxLevel(instr);
        const levelStyles = levels == null ? null : tocLevelStyles(ctx, levels, index);
        const pageNumbers = tocPageNumbers(instr);
        const node: Node = { type: 'tableOfContents', attrs: { entries: [], title: '', index, ...pageNumbers,
          ...tocRowTab(el, ctx),
          ...(index === 'alphabetical' ? indexColumns(instr) : {}),
          ...(levels == null ? {} : { maxLevel: levels }),
          ...(levelStyles ? { levelStyles } : {}),
          ...(index === 'bibliography' ? { citationStyle: ctx.citationStyle } : {}) } };
        field.into = { entries: node.attrs!.entries as TocEntry[], kind: index, pages: pageNumbers.pageNumbers !== false && index !== 'bibliography', node };
        out.push(node);
      }
      if (startedInToc || emit) {
        const into = kind === 'body' ? field.into : null;
        const row = closedAt >= 0 ? splitRunsAt(el, closedAt, true) : el;
        trackRanges(row, ctx);
        const entry = into ? cachedIndexEntry(row, ctx, into.kind, into.pages) : null;
        if (entry) {
          into!.entries.push(entry);
          // The gap is the one of the section the rows land in, which Word wraps them in.
          const a = into!.node.attrs!;
          if (a.columns && a.columnGapCm == null && ctx.sectionCols?.count === a.columns) a.columnGapCm = ctx.sectionCols.gapCm;
        }
        if (!tailKept) continue;
      }
      const src = tailKept ? tail! : el;
      const num = paragraphNum(src, ctx);
      const continued = num ? -1 : continuedLevel(src, stack);
      if (num) {
        breakPending = false; // a break before a list item can't be modeled; drop it
        const para = splitParaAtPageBreaks(convertParagraph(src, ctx, 'list', boldByDefault), 'list').blocks[0];
        while (stack.length && stack[stack.length - 1].ilvl > num.ilvl) closeTop();
        let top = stack[stack.length - 1];
        if (top && top.ilvl === num.ilvl && top.numId !== num.numId) { closeTop(); top = stack[stack.length - 1]; }
        // Only the item's own level takes its w:ind; the levels opened above it to reach
        // it have no item of their own to speak for them.
        const own = listItemIndent(src, ctx);
        while (stack.length === 0 || stack[stack.length - 1].ilvl < num.ilvl) {
          const ilvl = stack.length ? stack[stack.length - 1].ilvl + 1 : 0;
          const list = makeListNode(ctx, num.numId, ilvl, ilvl === num.ilvl ? own : EMPTY_ITEM_INDENT);
          // Opened by a deeper paragraph, the first level has no item of its own yet; it
          // continues the list before it where that one ends on the numId's count.
          const count = ctx.listCounters.get(num.numId)?.get(0);
          const prev = lastOrdered as Ordered | null;
          if (ilvl === 0 && num.ilvl > 0 && list.type === 'orderedList' && count != null && prev?.numId === num.numId
            && (Number(prev.list.attrs?.start) || 1) + labelledItems(prev.list) - 1 === count) {
            list.attrs = { ...(list.attrs ?? {}), start: count + 1, continueNumbering: true };
          }
          stack.push({ ilvl, numId: num.numId, list,
            textTwip: (ilvl === num.ilvl ? own.left : null) ?? ctx.styles.level(num.numId, ilvl).leftTwip ?? null });
          if (ilvl === num.ilvl) break;
        }
        const targetList = stack[stack.length - 1].list;
        const number = nextListNumber(ctx, num.numId, num.ilvl);
        // A non-list paragraph splits one Word list into separate nodes here; carry the
        // running count onto a fresh ordered node so numbering continues, not restarts at 1.
        // A level opened under an item without a label counts on by itself (listStarts).
        const underLabelless = stack.length > 1 && stack[stack.length - 2].list.content!.length === 0;
        if (targetList.type === 'orderedList' && targetList.content!.length === 0 && number > 1 && !underLabelless) {
          targetList.attrs = { ...(targetList.attrs ?? {}), start: number };
          // Word counts the numId on wherever it resumes: the editor's continuation does
          // the same while the list before it is that numId and ends right before.
          const prev = lastOrdered as Ordered | null;
          if (stack.length === 1 && prev && prev.numId === num.numId
            && (Number(prev.list.attrs?.start) || 1) + labelledItems(prev.list) === number) {
            targetList.attrs.continueNumbering = true;
          }
        }
        targetList.content!.push({ type: 'listItem', content: [para] });
      } else if (continued >= 0) {
        // An item's further paragraph: unnumbered, indented to an open level's text.
        while (stack.length > continued + 1) closeTop();
        const items = stack[stack.length - 1].list.content!;
        items[items.length - 1].content!.push(...splitParaAtPageBreaks(convertParagraph(src, ctx, 'list', boldByDefault), 'list').blocks);
      } else {
        flush();
        const { blocks, trailingBreak } = splitParaAtPageBreaks(convertParagraph(src, ctx, kind, boldByDefault), kind);
        if (breakPending) { applyBreakBefore(blocks[0]); breakPending = false; }
        out.push(...blocks);
        breakPending = trailingBreak;
      }
    } else if (tocState.tocDepth >= 0) {
      // Still inside an open TOC/INDEX/BIBLIOGRAPHY field: a bibliography's table holds
      // one source per row.
      if (el.localName === 'tbl' && field.into) {
        for (const tr of fcAll(el, 'tr')) {
          const text = fcAll(tr, 'tc').map((tc) => (tc.textContent ?? '').trim()).filter(Boolean).join(' ');
          if (text) field.into.entries.push({ text, level: 1, page: 1 });
        }
      }
      trackRanges(el, ctx);
      continue;
    } else if (el.localName === 'tbl') {
      // A page break ending the paragraph above, or Word's own spelling of one: the first
      // cell's paragraph asking for it. A floating table has no place in the flow to move.
      const pageBreak = breakPending || tableAsksForPage(el);
      breakPending = false;
      flush();
      if (kind === 'body' || kind === 'zone') {
        const floated = floatingTableBox(el, ctx);
        if (floated) { floatBoxes.push({ box: floated, at: out.length }); continue; }
        // A table in a columns section fills its column, so it is measured against one.
        const outerCm = ctx.contentWidthCm;
        if (kind === 'body') ctx.contentWidthCm = columnWidthCm(ctx);
        let t: Node | null;
        try { t = convertTable(el, ctx); } finally { ctx.contentWidthCm = outerCm; }
        if (t && pageBreak) applyBreakBefore(t);
        if (t) out.push(t);
      } else if (ctx.cellWidthCm != null) {
        // A nested table: in its cell's flow, never floated, measured against the cell.
        const outerCm = ctx.contentWidthCm;
        ctx.contentWidthCm = ctx.cellWidthCm;
        try {
          const t = convertTable(el, ctx);
          if (t) out.push(t);
        } finally { ctx.contentWidthCm = outerCm; }
      }
    } else if (el.localName === 'sdt') {
      breakPending = false;
      flush();
      if (sdtIsToc(el)) {
        // A content-control-wrapped TOC → one node (regenerated live); skip its content.
        if (kind === 'body') {
          const content = fc(el, 'sdtContent');
          const instr = content ? instrTextOf(content) : '';
          const maxLevel = tocMaxLevel(instr);
          const sdtKind = tocIndexKind(instr);
          const levelStyles = tocLevelStyles(ctx, maxLevel, sdtKind);
          const heading = tocHeading(content);
          const pages = tocPageNumbers(instr).pageNumbers !== false;
          const rows = content ? fcAll(content, 'p').slice(heading == null ? 0 : 1) : [];
          out.push({ type: 'tableOfContents', attrs: {
            entries: rows.map((p) => cachedIndexEntry(p, ctx, sdtKind, pages && sdtKind !== 'bibliography')).filter((e) => e != null),
            title: heading ?? '',
            maxLevel,
            index: sdtKind,
            ...tocPageNumbers(instr),
            ...(levelStyles ? { levelStyles } : {}),
          } });
        }
        trackRanges(el, ctx);
      } else {
        const content = fc(el, 'sdtContent');
        if (content) out.push(...convertBlocks(Array.from(content.children), ctx, kind, boldByDefault));
      }
    }
  }
  flush();
  if (kind === 'body') ctx.breakCarry = breakPending;
  // A floating table's frame rides the block that follows it, the paragraph LibreOffice
  // anchors its own frame to; where no block does, it takes a paragraph of its own.
  for (let i = floatBoxes.length - 1; i >= 0; i--) {
    const { box, at } = floatBoxes[i];
    const host = out[at];
    if (host && (host.type === 'paragraph' || host.type === 'heading')) host.content = [box, ...(host.content ?? [])];
    else out.splice(at, 0, { type: 'paragraph', content: [box] });
  }
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

// The open list level whose item text a paragraph's own left indent lines up with, as
// LibreOffice (numId 0) and this editor write an item's further paragraphs; -1 = none.
function continuedLevel(el: Element, stack: { textTwip: number | null }[]): number {
  const ind = fc(fc(el, 'pPr'), 'ind');
  const left = ind ? intAttr(ind, W, 'left') ?? intAttr(ind, W, 'start') : null;
  if (left == null || (intAttr(ind!, W, 'hanging') ?? 0) !== 0 || (intAttr(ind!, W, 'firstLine') ?? 0) !== 0) return -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    const t = stack[i].textTwip;
    if (t != null && Math.abs(t - left) <= 10) return i;
  }
  return -1;
}

function paragraphNum(el: Element, ctx: Ctx): { numId: number; ilvl: number } | null {
  const ppr = fc(el, 'pPr');
  const numPr = fc(ppr, 'numPr');
  let np = numPr ? readNumPr(numPr) : null;
  const ps = fc(ppr, 'pStyle');
  const styleNp = ctx.styles.styleNumPr(ps ? wVal(ps) : null);
  // A numbered heading is chapter numbering — whether the numbering rides its style, the
  // paragraph (WPS repeats it there) or both — unless the paragraph names another list
  // than its style, or, where the style has none, a bullet or a list level body text shares.
  const level = headingLevelOf(ppr, ctx);
  if (level != null) {
    if (!np || np.numId === 0) return null;
    const bullet = ctx.styles.level(np.numId, np.ilvl).numFmt === 'bullet';
    if (styleNp && styleNp.numId !== 0 ? styleNp.numId !== np.numId : bullet || ctx.bodyNumLevels.has(`${np.numId}:${np.ilvl}`)) return np;
    if (!ctx.headingNumPr.has(level)) ctx.headingNumPr.set(level, np);
    return null;
  }
  np ??= styleNp;
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

// A list item's own left indent and hang (twips), which override the level's — Word
// resolves direct paragraph properties over the numbering's. The editor keeps one
// geometry per list, so the item opening it is the one that sets it. A character count
// wins over the twips and counts in the paragraph style's size, as blockAttrs reads it.
type ItemIndent = { left: number | null; hang: number | null };
const EMPTY_ITEM_INDENT: ItemIndent = { left: null, hang: null };
function listItemIndent(el: Element, ctx: Ctx): ItemIndent {
  const ppr = fc(el, 'pPr');
  const ind = fc(ppr, 'ind');
  // Numbering the paragraph style brings is outranked by that style's own indent, which
  // a direct w:numPr ranks below the level's again (probed in LibreOffice).
  const styleId = styleIdOf(ppr, ctx);
  const own = !fc(ppr, 'numPr') ? ctx.styles.numberedStyleIndent(styleId) : { left: null, first: null };
  const styled: ItemIndent = { left: own.left, hang: own.first != null ? -own.first : null };
  if (!ind) return styled;
  const charTwip = blockDefaults(ctx.styles.paragraphRun(styleId), null, false).fontSizePt * 20 / 100;
  const pick = (chars: string, twips: string) => {
    const c = intAttr(ind, W, chars);
    return c ? Math.round(c * charTwip) : intAttr(ind, W, twips);
  };
  const hanging = pick('hangingChars', 'hanging');
  const first = pick('firstLineChars', 'firstLine');
  return {
    left: pick('leftChars', 'left') ?? intAttr(ind, W, 'start') ?? styled.left,
    hang: hanging ?? (first != null ? -first : null) ?? styled.hang,
  };
}

function makeListNode(ctx: Ctx, numId: number, ilvl: number, own: ItemIndent = EMPTY_ITEM_INDENT): Node {
  const def = ctx.styles.level(numId, ilvl);
  const bullet = !def.numFmt || def.numFmt === 'bullet' || def.numFmt === 'none';
  // A linked numbering style travels as `listStyleName` on the outermost list; its
  // levels stay in the registry, so no per-level attrs are derived.
  const styleName = ctx.styles.numberingStyleOf(numId);
  if (styleName) {
    ctx.usedListStyles.set(numId, styleName);
    const node: Node = { type: bullet ? 'bulletList' : 'orderedList', content: [] };
    if (ilvl === 0) node.attrs = { listStyleName: styleName };
    return node;
  }
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
  const ownLeft = own.left ?? def.leftTwip;
  if (ownLeft != null) {
    // A level's w:ind w:left is absolute, the editor nests one LIST_LEFT_STEP_CM per
    // level — so the attr is this level's step past the one above. Signed (w:left="360"
    // is a common one) and floored there, so the list stays in the text column.
    const leftCm = (l: number) => {
      const t = l === ilvl ? ownLeft : ctx.styles.level(numId, l).leftTwip;
      return t != null ? twipToCm(t) : (l + 1) * LIST_LEFT_STEP_CM;
    };
    const step = leftCm(ilvl) - (ilvl === 0 ? 0 : leftCm(ilvl - 1));
    const extra = round2(Math.max(-LIST_LEFT_STEP_CM, step - LIST_LEFT_STEP_CM));
    if (Math.abs(extra) > LIST_INDENT_EPS_CM) attrs.indent = extra;
  }
  if (def.rightAligned) attrs.markerAlign = 'right';
  // The family as a run reads it, which is what the first portion it is held against has.
  const marker = def.run ? markerFormatFromText({ ...runTextProps(def.run), ...(def.run.font ? { fontFamily: def.run.font } : {}) }) : null;
  if (marker) attrs.markerFormat = marker;
  const hang = own.hang ?? def.hangingTwip;
  if (hang != null && Math.abs(twipToCm(hang) - LIST_HANGING_CM) > LIST_INDENT_EPS_CM) attrs.hanging = round2(twipToCm(hang));
  if (def.suffix === 'space' || def.suffix === 'nothing') attrs.markerSuffix = def.suffix;
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
    // LibreOffice reads these as the "аа, аб" kind; the letter-repeating kind writes them too.
    case 'russianLower': return 'а, б, .., аа, аб, ... (ru)';
    case 'russianUpper': return 'А, Б, .., Аа, Аб, ... (ru)';
    // Several Word formats render as 一、二、三; LibreOffice folds them together too.
    case 'chineseCounting': case 'chineseCountingThousand':
    case 'ideographDigital': case 'japaneseCounting': case 'taiwaneseCounting':
      return '一, 二, 三, ...';
    case 'chineseLegalSimplified': return '壹, 贰, 叁, ...';
    case 'ideographTraditional': return '甲, 乙, 丙, ...';
    case 'decimalEnclosedCircle': return '①, ②, ③, ...';
    // The half-width variants count the same way; the editor keeps the full-width one.
    case 'aiueo': case 'aiueoFullWidth': return 'ア, イ, ウ, ...';
    case 'iroha': case 'irohaFullWidth': return 'イ, ロ, ハ, ...';
    default: return '1';
  }
}
function lvlSuffix(lvlText: string | undefined): string {
  if (!lvlText) return '.';
  const trail = lvlText.replace(/^.*%\d+/, '');
  return trail.charAt(0) === ')' ? ')' : '.';
}

function tableAsksForPage(tbl: Element): boolean {
  const pb = fc(fc(fc(fc(fc(tbl, 'tr'), 'tc'), 'p'), 'pPr'), 'pageBreakBefore');
  return !!pb && onOff(pb);
}

// A block a page break character moves to a new page starts it without its space above,
// unlike one whose own pageBreakBefore does (probed in LibreOffice): that is an explicit 0.
function breakCharSpace(node: Node): Record<string, number> {
  return node.type === 'paragraph' || node.type === 'heading' ? { spaceBefore: 0 } : {};
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
    if (i > 0) Object.assign(attrs, { breakBefore: 'page' }, breakCharSpace(node));
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
  // The asian fonts the block already sets its CJK text in (w:eastAsia).
  asianFonts: Set<string>;
  color: string;
  italic: boolean;
  // The line the style draws (lineSig), null where it draws none.
  underline: string | null;
  strike: string | null;
  caps: CapsMode | null;
  // The languages the style chain (docDefaults included) already gives the runs.
  lang: string | null;
  langAsian: string | null;
};

const FONT_TWINS: Record<string, string[]> = {
  'times new roman': ['liberation serif'],
  'liberation serif': ['times new roman'],
  arial: ['liberation sans'],
  'liberation sans': ['arial'],
};

// baseRun = docDefaults ← the paragraph style's basedOn chain, i.e. exactly what the
// style gives its runs. `headingBold` is false where the registry renders the heading
// with the file's own style, which inherits Standard rather than the bold built-in.
function blockDefaults(baseRun: RunProps, headingLevel: number | null, boldByDefault: boolean, headingBold = true): BlockDefaults {
  const withFont = (set: Set<string>, font: string | undefined) => {
    const f = font?.toLowerCase();
    return f ? new Set([...set, f, ...(FONT_TWINS[f] ?? [])]) : set;
  };
  const fonts = withFont(new Set(headingLevel != null ? DEFAULT_HEADING_FONTS : DEFAULT_FONTS), baseRun.font);
  const asianFonts = withFont(DEFAULT_FONTS, baseRun.fontEastAsia);
  return {
    fontSizePt: baseRun.sizeHalfPt != null ? baseRun.sizeHalfPt / 2
      : headingLevel != null ? HEADING_SIZES[headingLevel - 1] : BODY_FONT_SIZE_PT,
    boldByDefault: baseRun.bold ?? ((headingLevel != null && headingBold) || boldByDefault),
    fonts,
    asianFonts,
    color: hexColor(baseRun.color) ?? '#000000',
    italic: baseRun.italic ?? (headingLevel != null && HEADING_ITALIC[headingLevel - 1]),
    underline: lineSig(baseRun).underline,
    strike: lineSig(baseRun).strike,
    caps: baseRun.caps || null,
    lang: baseRun.lang ?? null,
    langAsian: baseRun.langEastAsia ?? null,
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
  // The index entry styles: LibreOffice calls them Contents 1…10 and Index 1…9, and naming them that
  // keeps one document's ODF and DOCX legs pointing at the same registry entry.
  const toc = /^toc\s?(10|[1-9])$/i.exec(wordName);
  if (toc) return `Contents ${toc[1]}`;
  const index = /^index\s?([1-9])$/i.exec(wordName);
  if (index) return `Index ${index[1]}`;
  return wordName || id;
}

// The paragraph styles a TOC field regenerates its rows from, by level. Naming them
// gives the index the file's own indent and spacing instead of the editor's fallback.
// Each kind of index has its own family of level styles, LibreOffice's names throughout
// (registryName maps Word's localized `toc n` onto them). Word regenerates its rows from
// the styles, so the family the index belongs to is what says which ones are its own.
const INDEX_LEVEL_STYLES: Record<IndexKind, RegExp | null> = {
  toc: /^Contents (10|[1-9])$/,
  figures: /^Illustration Index (10|[1-9])$/,
  tables: /^Table index (10|[1-9])$/i,
  alphabetical: /^Index (10|[1-9])$/,
  bibliography: null,
};

function tocLevelStyles(ctx: Ctx, maxLevel: number, kind: IndexKind = 'toc'): (string | null)[] | null {
  const pattern = INDEX_LEVEL_STYLES[kind];
  if (!pattern) return null;
  const out: (string | null)[] = [];
  for (const id of ctx.styles.namedParagraphStyles().keys()) {
    const name = ctx.styleNames.get(id) ?? '';
    const level = Number(pattern.exec(name)?.[1]);
    if (!level || level > maxLevel) continue;
    ctx.usedStyles.add(id);
    out[level - 1] = name;
  }
  return out.some(Boolean) ? Array.from(out, (s) => s ?? null) : null;
}

// w:spacing's line as the model spells it: a factor of the single line (240) under
// "auto", a fixed height in pt under "exact". "atLeast" has no model value yet.
function lineSpacing(line: number | null, rule: string | null): string | null {
  if (line == null) return null;
  if (!rule || rule === 'auto') return String(round2(line / 240));
  return rule === 'exact' && line > 0 ? `${snapPt(twipToPt(line))}pt` : null;
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
  const spacing = lineSpacing(sp.line ?? null, sp.lineRule ?? null);
  if (spacing) out.lineHeight = spacing;
  const jc = ctx.styles.paragraphAlign(id);
  if (jc === 'center') out.textAlign = 'center';
  else if (jc === 'both' || jc === 'distribute') out.textAlign = 'justify';
  else if (jc === 'right' || jc === 'end') out.textAlign = 'right';
  else if (jc === 'left' || jc === 'start') out.textAlign = 'left';
  const ind = ctx.styles.styleIndentTwip(id);
  if (ind != null) out.indent = round2(twipToCm(ind));
  const first = ctx.styles.styleFirstLineTwip(id);
  if (first != null) out.indentFirst = round2(twipToCm(first));
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
  if (run.font) out.fontFamily = screenFontName(run.font);
  if (run.fontEastAsia) out.fontFamilyAsian = screenFontName(run.fontEastAsia);
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
// Word keeps chapter numbering as one multilevel numbering the heading styles point at
// (w:numPr on the style, w:pStyle in the level). Level N is whatever "Heading N" uses.
function outlineFromDocx(ctx: Ctx): OutlineNumbering | null {
  const byName = new Map<string, string>();
  for (const [id, def] of ctx.styles.namedParagraphStyles()) byName.set(def.name.toLowerCase().replace(/\s+/g, ''), id);
  const out: OutlineNumbering = [];
  let numbered = false;
  for (let level = 1; level <= MAX_OUTLINE_LEVELS; level++) {
    const styleId = byName.get(`heading${level}`) ?? `Heading${level}`;
    const np = ctx.styles.styleNumPr(styleId) ?? ctx.headingNumPr.get(level);
    const def = np && np.numId !== 0 ? ctx.styles.level(np.numId, np.ilvl) : null;
    // wordFmtChar falls back to decimal, which only a decimal level is.
    const fmt = def?.numFmt ? knownNumFormat(wordFmtChar(def.numFmt)) : null;
    const format = fmt === '1' && def?.numFmt !== 'decimal' ? null : fmt;
    if (!def || !format) { out.push({ ...DEFAULT_OUTLINE_LEVEL }); continue; }
    numbered = true;
    const text = def.lvlText ?? '';
    const holders = [...text.matchAll(/%\d/g)];
    const last = holders[holders.length - 1];
    // The label's own run, and where Word hangs it: the level's indent is the stop its
    // tab runs to, the first line the place the label itself starts.
    const labelText = def.run ? runTextProps(def.run) : null;
    const indentCm = def.leftTwip != null ? round2(twipToCm(def.leftTwip)) : 0;
    const firstCm = def.hangingTwip != null ? round2(-twipToCm(def.hangingTwip)) : 0;
    out.push({
      format,
      prefix: holders.length ? text.slice(0, holders[0].index) : '',
      suffix: (last ? text.slice((last.index ?? 0) + 2) : '') + (def.suffix === 'space' ? ' ' : ''),
      displayLevels: Math.max(1, holders.length),
      start: def.start ?? 1,
      ...(labelText && Object.keys(labelText).length ? { labelText } : {}),
      ...(indentCm ? { indentCm } : {}),
      ...(firstCm ? { firstIndentCm: firstCm } : {}),
      ...(def.suffix === 'space' || def.suffix === 'nothing' ? {} : { tabCm: indentCm }),
    });
  }
  // Trailing unnumbered levels carry nothing — a definition ends at its last number.
  while (out.length && out[out.length - 1].format === 'none') out.pop();
  return numbered ? out : null;
}

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
      next: def.next ? ctx.styleNames.get(def.next) ?? def.next : builtin?.next ?? null,
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
  if (standard) {
    standard.text = { ...standard.text, ...runTextProps(ctx.styles.paragraphRun(null)) };
    dropDefaultAsianFont(standard.text, ctx.mainLang ?? null);
  }
  for (const id of ctx.usedCharStyles) {
    const name = ctx.charStyleNames.get(id) ?? id;
    const builtin = sheet.character[name];
    sheet.character[name] = {
      name, parent: null, next: null, builtin: builtin?.builtin,
      para: {}, text: styleText(ctx, id, true),
    };
  }
  for (const [numId, name] of ctx.usedListStyles) {
    sheet.list[name] = listStyleFromDocx(name, ctx, numId, sheet.list[name]?.builtin);
  }
  sheet.outline = outlineFromDocx(ctx);
  return sheet;
}

// A linked numbering's levels → the registry's shape, mirroring makeListNode's math
// (Word writes 9 levels; each indentCm is the margin step past the 1.27cm base).
function listStyleFromDocx(name: string, ctx: Ctx, numId: number, builtin?: boolean): ListStyle {
  const levels: ListLevelStyle[] = [];
  let multilevel = false;
  let prevLeftCm = 0;
  for (let l = 0; l < MAX_LIST_LEVELS; l++) {
    const def = ctx.styles.level(numId, l);
    if (!Object.keys(def).length) break;
    const bullet = !def.numFmt || def.numFmt === 'bullet' || def.numFmt === 'none';
    const level: ListLevelStyle = { kind: bullet ? 'bullet' : 'number' };
    const leftCm = def.leftTwip != null ? twipToCm(def.leftTwip) : prevLeftCm + LIST_LEFT_STEP_CM;
    const extra = round2(leftCm - prevLeftCm - LIST_LEFT_STEP_CM);
    if (extra) level.indentCm = extra;
    prevLeftCm = leftCm;
    if (def.rightAligned) level.markerAlign = 'right';
    if (bullet) {
      const ch = bulletCharFromDocx(def.lvlText, def.bulletFont);
      if (ch) level.bulletChar = ch;
    } else {
      if (((def.lvlText ?? '').match(/%\d/g) ?? []).length > 1) multilevel = true;
      const key = orderedTypeFromFormat(wordFmtChar(def.numFmt), lvlSuffix(def.lvlText));
      level.numType = key === 'multilevel' ? 'decimal' : key;
      if (def.start != null && def.start > 1) level.startAt = def.start;
    }
    levels.push(level);
  }
  const style: ListStyle = { name, levels };
  if (builtin) style.builtin = true;
  if (multilevel) style.multilevel = true;
  return style;
}

function convertParagraph(el: Element, ctx: Ctx, kind: BlockKind, boldByDefault: boolean): Node {
  const ppr = fc(el, 'pPr');
  const pStyle = fc(ppr, 'pStyle');
  const level = headingLevelOf(ppr, ctx);
  // Alignment: direct w:pPr/w:jc wins, else resolve it from the style chain (the default
  // paragraph style commonly carries justify), so style-level alignment isn't lost.
  const directJc = fc(ppr, 'jc');
  const styleJc = ctx.styles.paragraphAlign(pStyle ? wVal(pStyle) : null);
  const mathJc = mathParaAlign(el, ctx);
  const jcVal = mathJc ?? (directJc ? wVal(directJc) : styleJc);
  const styleId = styleIdOf(ppr, ctx);
  // w:bidi — the block's own base direction; resolved first, alignment suppression
  // depends on it (the base direction decides which edge is the unset default).
  const directBidi = fc(ppr, 'bidi');
  const bidi = directBidi ? onOff(directBidi) : ctx.styles.paragraphBidi(styleId);
  // Only DIRECT w:pPr counts as formatting on the block; the style's own lives in the
  // registry — except in a cell, which carries no style name, so its chain is baked in
  // over the table style's w:pPr (probed: that ranks *below* the paragraph style). A
  // header/footer paragraph carries none either, and bakes its Header/Footer style in.
  const baked = kind === 'cell' || kind === 'zone';
  const attrs = blockAttrs(ppr, kind, level, directJc || baked || kind === 'list' || mathJc ? jcVal : null,
    baked || kind === 'list' ? ctx.styles.paragraphSpacing(styleId, kind === 'cell' ? ctx.cellSpacing : undefined) : {},
    bidi ?? ctx.pageRtl, kind === 'zone' ? null : styleJc);
  // A list item carries no style name either and renders the default style's spacing,
  // so its own style's spacing rides the block wherever the two differ.
  if (kind === 'list') {
    const def = blockAttrs(null, kind, level, null, ctx.styles.paragraphSpacing(ctx.styles.defaultParagraphStyle()));
    for (const key of ['spaceBefore', 'spaceAfter', 'lineHeight']) if (attrs[key] === def[key]) delete attrs[key];
  }
  applyContextualSpacing(el, ppr, ctx, styleId, attrs);
  const revMark = paragraphMarkRevisions(ppr, ctx);
  if (revMark) attrs.revMark = revMark;
  const change = fc(ppr, 'pPrChange');
  if (change) {
    const before = el.ownerDocument.createElementNS(W, 'p'), old = fc(change, 'pPr');
    if (old) before.appendChild(old.cloneNode(true));
    const was = convertParagraph(before, ctx, kind, boldByDefault);
    // What the paragraph mark's run and the flag runs state is not in the old w:pPr.
    const unsaid = Object.fromEntries(['fontSize', 'fontFamily', 'fontFamilyAsian', 'lang', 'langAsian', 'noHyphenation', 'snapToGrid'].map((k) => [k, attrs[k]]));
    attrs.revFormat = { id: change.getAttributeNS(W, 'id') ?? '', author: change.getAttributeNS(W, 'author') ?? '', date: change.getAttributeNS(W, 'date') ?? '',
      old: { ...blockFormat(was.type, { ...was.attrs, ...unsaid }), ...(fc(ppr, 'numPr') && !fc(old, 'numPr') ? { list: [] } : {}) } };
  }
  // A direct left indent of 0 still overrides the style's own one.
  const ind = kind !== 'list' && !baked ? fc(ppr, 'ind') : null;
  const directLeft = ind && !intAttr(ind, W, 'leftChars') ? intAttr(ind, W, 'left') ?? intAttr(ind, W, 'start') : null;
  if (directLeft != null && attrs.indent == null && (ctx.styles.styleIndentTwip(styleId) ?? 0) > 0) {
    attrs.indent = round2(twipToCm(directLeft));
  }
  // The editor has no rule node, so Word's horizontal line becomes its paragraph's own
  // bottom rule — a real w:pBdr keeps precedence, only one line can be drawn.
  const hr = hrBorderAttr(el);
  if (hr) attrs.borderBottom ??= hr;
  // The baked-in chain must not accrete no-op direct formatting: in a cell, unset
  // spacing renders 0/0 (no word processor passes the default style's spacing into a
  // cell), and single line height is only kept over a non-single default.
  if (baked) {
    // A heading is the other way round: no style name reaches a cell, so the editor
    // draws its level's own 12pt/6pt margins (styles/headings.ts) there — the chain's
    // silence is a real 0 and has to be written, or that pair lands in every heading a
    // cell holds. Word's own spacing at this point is the chain's, baked in above.
    if (level) {
      const hm = HEADING_MARGINS[level - 1];
      if (hm?.topPt) attrs.spaceBefore ??= 0;
      if (hm?.bottomPt) attrs.spaceAfter ??= 0;
    }
    if (attrs.spaceBefore === 0 && !level) delete attrs.spaceBefore;
    if (attrs.spaceAfter === 0 && !level) delete attrs.spaceAfter;
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
  const kn = directKn ? onOff(directKn) : ctx.styles.paragraphKeepNext(styleId);
  if (!level && kn) attrs.keepNext = true;
  // A heading style the file defines without it (or a plain style given an outline level)
  // lets the heading end a page; one the file only names is Word's built-in, which keeps.
  if (level && !kn && (directKn || !styleId || ctx.styles.definesParagraphStyle(styleId))) attrs.keepNext = false;
  const directKl = fc(ppr, 'keepLines');
  if (directKl ? onOff(directKl) : !level && ctx.styles.paragraphKeepLines(styleId)) attrs.keepLines = true;
  // A direct w:pageBreakBefore is read in blockAttrs; the style's rides the block too.
  if ((kind === 'body' || kind === 'list') && !fc(ppr, 'pageBreakBefore') && ctx.styles.paragraphPageBreakBefore(styleId)) attrs.breakBefore = 'page';
  // Word 2013's layout (compatibilityMode 15) opens the page a paragraph breaks itself onto
  // without its space above; 14 keeps it, as a section start always does (all probed in
  // LibreOffice). The block always sits at that page top, so this is an explicit 0.
  let prev = el.previousElementSibling;
  while (prev && prev.localName !== 'p' && prev.localName !== 'tbl') prev = prev.previousElementSibling;
  // The document's first block keeps it, and so does one opening a section.
  const opensSection = !prev || (prev.localName === 'p' && !!fc(fc(prev, 'pPr'), 'sectPr'));
  if ((kind === 'body' || kind === 'list') && attrs.breakBefore === 'page' && ctx.compatMode >= 15 && !opensSection
    && ((attrs.spaceBefore as number | undefined) ?? ctx.styles.paragraphSpacing(styleId).before ?? 0) > 0) attrs.spaceBefore = 0;
  // "Don't hyphenate this paragraph" — only formatting where the document hyphenates
  // at all; below that switch it says what is already true.
  const directSah = fc(ppr, 'suppressAutoHyphens');
  if (ctx.hyphenate && directSah && onOff(directSah)) attrs.noHyphenation = true;
  // The section's own base direction is inheritance, not formatting, so only a block
  // that differs from it carries the attr.
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
  // A heading the file gives its own style is rendered by that style, and a style based
  // on another one inherits Standard — so its runs' bold is formatting, not the default.
  const headingBold = !ctx.styles.styleBasedOn(styleId);
  // A heading keeps its level in a cell or a box, where the editor re-applies the level's
  // own style (`hN:not([data-style])`) — so it is measured against that one, which is the
  // file's only where the paragraph names it; any other style renders as the built-in.
  const levelStyled = level != null && kind !== 'zone' && !!styleId && ctx.styleNames.get(styleId) === `Heading ${level}`;
  const defaults = blockDefaults(name || levelStyled ? baseRun : ctx.styles.paragraphRun(ctx.styles.defaultParagraphStyle()), level, boldByDefault, headingBold);
  if (!name && !levelStyled && level != null) defaults.fontSizePt = HEADING_SIZES[level - 1];
  // A run inherits the block's own size, not the default style's, so that is what it is
  // measured against — else a size the block overrides is suppressed and lost (odt.ts).
  const ownSizePt = blockDefaults(baseRun, level, boldByDefault).fontSizePt;
  // The block's own language, which its runs are measured against; the document's is
  // the default and no formatting.
  const markLangs = paragraphMarkLanguage(ppr, ctx, baseRun);
  const blockLang = markLangs.lang ?? defaults.lang;
  const blockLangAsian = markLangs.langEastAsia ?? defaults.langAsian;
  const runDefaults = {
    ...(Math.abs(ownSizePt - defaults.fontSizePt) > 0.05 ? { ...defaults, fontSizePt: ownSizePt } : defaults),
    lang: blockLang,
    langAsian: blockLangAsian,
  };
  const content = convertInline(el, ctx, baseRun, runDefaults);

  if (name) {
    ctx.usedStyles.add(styleId!);
    if (name !== (level ? `Heading ${level}` : DEFAULT_STYLE)) attrs.styleName = name;
  } else if (levelStyled) {
    // The level's style renders it, so the sheet needs the file's definition of it.
    ctx.usedStyles.add(styleId!);
  }

  // The block's size is the strut of every line. LibreOffice sets a line with text by its
  // runs alone (probed: a 28pt and a 10pt mark over 12pt text, 4.9mm pitch both), so runs
  // agreeing on a size set it; the mark's own (w:pPr/w:rPr) only where they do not.
  const runSize = uniformRunSize(content);
  const ownSize = Math.abs(ownSizePt - defaults.fontSizePt) > 0.05 ? `${Math.round(ownSizePt * 10) / 10}pt` : null;
  const fs = runSize !== undefined ? runSize ?? ownSize : paragraphMarkFontSize(ppr, ctx, baseRun, defaults.fontSizePt);
  if (fs) attrs.fontSize = fs;
  // A run without w:sz keeps its style's size, not the mark's the block now carries.
  if (fs && Math.abs(parseFloat(fs) - runDefaults.fontSizePt) > 0.05) keepRunDefault(content, 'fontSize', `${runDefaults.fontSizePt}pt`);
  const ff = paragraphMarkFont(ppr, ctx, baseRun, defaults);
  if (ff.west) attrs.fontFamily = ff.west;
  const styleFont = baseRun.font ?? ctx.styles.themeFont(baseRun.fontTheme ?? 'minor');
  if (ff.west && styleFont) keepRunDefault(content, 'fontFamily', styleFont);
  if (ff.asian) attrs.fontFamilyAsian = ff.asian;
  if (blockLang && blockLang !== defaults.lang) attrs.lang = blockLang;
  if (blockLangAsian && blockLangAsian !== defaults.langAsian) attrs.langAsian = blockLangAsian;
  applyUniformRunFont(attrs, content);
  sinkOffsetFrames(content, parseFloat(String(attrs.fontSize ?? '')) || defaults.fontSizePt);

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

// Text runs without their own `key` render the block's; give them the style's `value`.
function keepRunDefault(content: Node[], key: 'fontSize' | 'fontFamily', value: string): void {
  for (const n of content) {
    if (n.type !== 'text') continue;
    const ts = (n.marks ??= []).find((m) => m.type === 'textStyle');
    if (!ts) n.marks.push({ type: 'textStyle', attrs: { [key]: value } });
    else if (ts.attrs?.[key] == null) ts.attrs = { ...ts.attrs, [key]: value };
  }
}

// A recorded paragraph mark (w:pPr/w:rPr/w:ins|del, a move's two ends w:moveFrom|moveTo).
function paragraphMarkRevisions(ppr: Element | null, ctx: Ctx) {
  return revMarkIn(fc(ppr, 'rPr'), [['ins', 'insertion'], ['moveTo', 'insertion'], ['del', 'deletion'], ['moveFrom', 'deletion']], ctx.moveNames);
}

// A move's name sits on the range around its w:moveFrom or w:moveTo, which is what pairs the
// two. A paragraph's own mark stands before the range the paragraph opens; ours is a w:ins
// or w:del under the id of the move's text.
function moveNames(root: Element): Map<Element, string> {
  const out = new Map<Element, string>(), open = new Map<string, string>(), byId = new Map<string, string>();
  let waiting: Element[] = [];
  if (!root.getElementsByTagNameNS(W, 'moveFromRangeStart').length) return out;
  for (const el of Array.from(root.getElementsByTagNameNS(W, '*'))) {
    const id = el.getAttributeNS(W, 'id') ?? '';
    if (el.localName === 'moveFromRangeStart' || el.localName === 'moveToRangeStart') {
      const name = el.getAttributeNS(W, 'name') ?? '';
      open.set(id, name);
      for (const mark of waiting) if (el.parentElement?.contains(mark)) out.set(mark, name);
      waiting = [];
    } else if (el.localName === 'moveFromRangeEnd' || el.localName === 'moveToRangeEnd') open.delete(id);
    else if (el.localName === 'moveFrom' || el.localName === 'moveTo') {
      if (open.size) {
        out.set(el, [...open.values()].pop()!);
        byId.set(id, out.get(el)!);
      } else waiting.push(el);
    }
  }
  for (const name of ['ins', 'del']) {
    for (const el of Array.from(root.getElementsByTagNameNS(W, name))) {
      const move = byId.get(el.getAttributeNS(W, 'id') ?? '');
      if (move && el.parentElement?.localName === 'rPr') out.set(el, move);
    }
  }
  return out;
}

// The revisions a property element holds, as `revMark`: a paragraph mark's, a row's, a cell's.
function revMarkIn(pr: Element | null, names: string[][], moves?: Map<Element, string>): RevMark | undefined {
  const out: RevMark = {};
  for (const [name, kind] of names) {
    const el = fc(pr, name), moveId = el && moves?.get(el);
    if (el) out[kind as keyof RevMark] = { id: el.getAttributeNS(W, 'id') ?? '', author: el.getAttributeNS(W, 'author') ?? '', date: el.getAttributeNS(W, 'date') ?? '', ...(moveId ? { moveId } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

// The paragraph mark's resolved font size (w:pPr/w:rPr, incl. its rStyle), as a CSS
// pt string, or null when it matches what the block renders at anyway (suppressed
// like run sizes, against the same yardstick).
// The size every text run of a block shares: null where each keeps the one it was
// measured against (`runDefaults`), undefined where there is no text or they differ.
function uniformRunSize(content: Node[]): string | null | undefined {
  const sizes = new Set(content.filter((n) => n.type === 'text')
    .map((n) => (n.marks?.find((m) => m.type === 'textStyle')?.attrs?.fontSize as string | undefined) ?? null));
  return sizes.size === 1 ? [...sizes][0] : undefined;
}

function paragraphMarkFontSize(ppr: Element | null, ctx: Ctx, baseRun: RunProps, defaultPt: number): string | null {
  const rPr = fc(ppr, 'rPr');
  const rStyle = fc(rPr, 'rStyle');
  const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
  if (props.sizeHalfPt == null) return null;
  const sizePt = props.sizeHalfPt / 2;
  return Math.abs(sizePt - defaultPt) > 0.05 ? `${Math.round(sizePt * 10) / 10}pt` : null;
}

// The paragraph mark's resolved languages (w:pPr/w:rPr/w:lang, incl. its rStyle). Word
// writes the paragraph's language there as well as onto every run.
function paragraphMarkLanguage(ppr: Element | null, ctx: Ctx, baseRun: RunProps): { lang?: string; langEastAsia?: string } {
  const rPr = fc(ppr, 'rPr');
  const rStyle = fc(rPr, 'rStyle');
  const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
  return { lang: props.lang, langEastAsia: props.langEastAsia };
}

// The paragraph mark's resolved font pair (w:pPr/w:rPr/w:rFonts, incl. its rStyle), each
// null when it is what the block renders at anyway.
function paragraphMarkFont(ppr: Element | null, ctx: Ctx, baseRun: RunProps, defaults: BlockDefaults): { west: string | null; asian: string | null } {
  const rPr = fc(ppr, 'rPr');
  const rStyle = fc(rPr, 'rStyle');
  const props = mergeRunProps(mergeRunProps(baseRun, ctx.styles.styleOwn(rStyle ? wVal(rStyle) : null)), parseRunProps(rPr));
  const font = props.font ?? ctx.styles.themeFont(props.fontTheme ?? 'minor');
  const asian = props.fontEastAsia;
  return {
    west: !font || defaults.fonts.has(font.toLowerCase()) ? null : font,
    asian: !asian || defaults.asianFonts.has(asian.toLowerCase()) ? null : asian,
  };
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
function blockAttrs(ppr: Element | null, kind: BlockKind, headingLevel: number | null, jcVal: string | null, styleSpacing: ParaSpacing, rtl = false, styleJc: string | null = null): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};

  if (jcVal === 'center') attrs.textAlign = 'center';
  else if (jcVal === 'both' || jcVal === 'distribute') attrs.textAlign = 'justify';
  else {
    // start/end are physical like left/right: LibreOffice writes an rtl paragraph's
    // physical left as w:jc="start" (probed). The direction's own edge stays unset
    // unless it overrides a style that aligns otherwise.
    const edge = (v: string | null) => v === 'right' || v === 'end' ? 'right'
      : v === 'left' || v === 'start' ? 'left' : v;
    const align = edge(jcVal) === 'right' || edge(jcVal) === 'left' ? edge(jcVal) : null;
    if (align && (align !== (rtl ? 'right' : 'left') || (styleJc != null && edge(styleJc) !== align))) attrs.textAlign = align;
  }

  const sp = ppr ? fc(ppr, 'spacing') : null;
  const own: ParaSpacing = sp ? readSpacing(sp) : {};
  const before = own.before ?? styleSpacing.before ?? null;
  const after = own.after ?? styleSpacing.after ?? null;
  const line = (sp ? intAttr(sp, W, 'line') : null) ?? styleSpacing.line ?? null;
  const rule = (sp && sp.getAttributeNS(W, 'lineRule')) || styleSpacing.lineRule || null;
  // An attribute no layer sets is Word's implied 0, which is also the editor's paragraph
  // default (editor.css) — so it stays unset rather than accreting an explicit 0.
  if (before != null) attrs.spaceBefore = snapPt(twipToPt(before));
  if (after != null) attrs.spaceAfter = snapPt(twipToPt(after));
  // Single spacing is written out too: the block's own style may set another one, and
  // then an unset attr is not the same thing.
  const spacing = lineSpacing(line, rule);
  if (spacing) attrs.lineHeight = spacing;

  if (!ppr) return attrs;

  const snap = fc(ppr, 'snapToGrid');
  if (snap && !onOff(snap)) attrs.snapToGrid = false;

  const ind = fc(ppr, 'ind');
  const right = ind ? intAttr(ind, W, 'right') ?? intAttr(ind, W, 'end') : null;
  const rightChars = ind ? intAttr(ind, W, 'rightChars') ?? intAttr(ind, W, 'endChars') : null;
  if (rightChars) attrs.indentRightChars = rightChars / 100;
  else if (right != null) { const cm = round2(twipToCm(right)); if (cm > LIST_INDENT_EPS_CM || (kind !== 'cell' && cm < -LIST_INDENT_EPS_CM)) attrs.indentRight = cm; }
  if (kind !== 'list') {
    // The *Chars attributes (hundredths of a character) win over the twips when nonzero.
    // A hanging count adds to the left one, where LibreOffice puts the text (probed).
    const hangingChars = ind ? intAttr(ind, W, 'hangingChars') : null;
    const leftChars = ind ? intAttr(ind, W, 'leftChars') ?? intAttr(ind, W, 'startChars') : null;
    const left = ind ? intAttr(ind, W, 'left') ?? intAttr(ind, W, 'start') : null;
    // Out into the margin, as a page-wide picture's paragraph is set; a cell keeps its
    // text inside its padding (probed: LibreOffice wraps such a line at the cell's width).
    if (leftChars || hangingChars) attrs.indentChars = ((leftChars ?? 0) + (hangingChars ?? 0)) / 100;
    else if (left != null) { const cm = round2(twipToCm(left)); if (cm > LIST_INDENT_EPS_CM || (kind !== 'cell' && cm < -LIST_INDENT_EPS_CM)) attrs.indent = cm; }
    // w:hanging outdents the first line, w:firstLine indents it; they are exclusive.
    const hanging = ind ? intAttr(ind, W, 'hanging') : null;
    const firstLine = ind ? intAttr(ind, W, 'firstLine') : null;
    const first = hanging != null ? -twipToCm(hanging) : firstLine != null ? twipToCm(firstLine) : null;
    const firstChars = hangingChars ? -hangingChars : ind ? intAttr(ind, W, 'firstLineChars') : null;
    if (firstChars) attrs.indentFirstChars = firstChars / 100;
    else if (first != null && Math.abs(first) > LIST_INDENT_EPS_CM) attrs.indentFirst = round2(first);
  }

  if (kind !== 'cell') {
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

// Word's horizontal line (Insert ▸ Horizontal Line, or the `---` autoformat) is a VML
// rect flagged o:hr, alone in its paragraph — height and fill are the line it draws.
// Its own width and alignment are dropped: a paragraph rule spans the text width.
function hrBorderAttr(p: Element): string | null {
  const rect = Array.from(p.getElementsByTagNameNS(VML, 'rect')).find(isHrRect);
  if (!rect) return null;
  const h = /height:\s*([\d.]+\s*[a-z]*)/.exec(rect.getAttribute('style') ?? '')?.[1];
  const pt = lengthToPt(h?.replace(/\s+/g, '')) ?? 1.5;
  // Word's own default for a line with no fill colour.
  const color = normalizeColor(rect.getAttribute('fillcolor') ?? '') ?? '#A0A0A0';
  return `${Math.round(pt * 100) / 100}pt solid ${color}`;
}

const isHrRect = (el: Element): boolean => (el.getAttributeNS(O, 'hr') ?? 'f') !== 'f';

function snapPt(v: number): number {
  const r = Math.round(v * 100) / 100;
  const i = Math.round(r);
  return Math.abs(r - i) <= 0.03 ? i : r;
}

// ---- inline conversion (runs, marks, fields, images) -----------------------

// Word wraps a citation or any content control in a w:sdt holding ordinary inline
// content — walk through the wrapper, or those runs never reach the paragraph. Our
// own placeholder control is the exception: it survives whole and becomes a field.
function inlineChildren(el: Element): Element[] {
  return Array.from(el.children).flatMap((c) => {
    if (c.namespaceURI !== W || c.localName !== 'sdt') return [c];
    if (sdtIsPlaceholder(c)) return [c];
    const content = fc(c, 'sdtContent');
    return content ? inlineChildren(content) : [];
  });
}

function sdtIsPlaceholder(sdt: Element): boolean {
  const pr = fc(sdt, 'sdtPr');
  return !!pr && fc(pr, 'tag')?.getAttributeNS(W, 'val') === PLACEHOLDER_SDT_TAG;
}

// The export paints the control's run gray; that gray is presentation, not the
// author's formatting, so it must not come back as a color mark.
function stripPlaceholderGray(marks: Mark[]): Mark[] {
  return marks.flatMap((m) => {
    if (m.type !== 'textStyle' || String(m.attrs?.color ?? '').toLowerCase() !== '#808080') return [m];
    const { color: _color, ...rest } = m.attrs ?? {};
    return Object.keys(rest).length ? [{ type: m.type, attrs: rest }] : [];
  });
}

// A w:footnoteReference → the anchor node, with the note's own paragraphs collected
// into ctx for the section the document end gets. Word's numbering is implicit, so the
// citation is counted here; several paragraphs flatten to hard breaks.
function noteRefNode(wid: string | null, kind: NoteKind, ctx: Ctx, baseRun: RunProps, defaults: BlockDefaults, label: string | null = null): Node | null {
  const note = wid == null ? null : ctx.noteParts[kind].get(wid);
  if (!note) return null;
  // A picture or a link in a note is related from the note's own part, not the document's.
  const noteRels = ctx.files[`word/_rels/${kind}s.xml.rels`];
  const noteCtx: Ctx = noteRels ? { ...ctx, rels: parseRels(noteRels) } : ctx;
  const content: Node[] = [];
  for (const para of Array.from(note.children)) {
    if (para.namespaceURI !== W || para.localName !== 'p') continue;
    const runs = convertInline(para, noteCtx, baseRun, defaults);
    if (content.length && runs.length) content.push({ type: 'hardBreak' });
    content.push(...runs);
  }
  // Word opens the note with its own marker run and a tab; the editor draws both from
  // the note's own indent, so the leading tab would be a second one. Exactly one — both
  // products write one, and a second is the note's own text.
  const stripMarkerTab = () => {
    const first = content[0];
    if (first?.type === 'text' && typeof first.text === 'string' && first.text.startsWith('\t')) {
      first.text = first.text.slice(1);
      if (!first.text) content.shift();
    }
  };
  stripMarkerTab();
  const seen = ctx.notes.filter((n) => n.kind === kind).length;
  const text = label ?? formatOrdinal(seen + 1, kind === 'endnote' ? 'i' : '1');
  // A custom-marked note repeats the literal character where <w:footnoteRef/> would
  // sit; the editor draws the mark itself, so strip it off the body — and the tab
  // again, which may ride a run of its own behind the mark.
  const bodyFirst = content[0];
  if (label && bodyFirst?.type === 'text' && typeof bodyFirst.text === 'string' && bodyFirst.text.startsWith(label)) {
    bodyFirst.text = bodyFirst.text.slice(label.length);
    if (!bodyFirst.text) content.shift();
    stripMarkerTab();
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
  if (sp.before || sp.after) return false;
  // LibreOffice's stock hanging pair (0.6cm both ways, the marker tab's jump) nets to
  // zero: the editor draws that indent itself.
  const ind = ctx.styles.styleIndentTwip(styleId) ?? 0;
  return ind === 0 || ind === (ctx.styles.styleHangingTwip(styleId) ?? 0);
}

function convertInline(p: Element, ctx: Ctx, baseRun: RunProps, defaults: BlockDefaults): Node[] {
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
  // A page field in a header/footer zone (zoneField): its cached result is dropped and
  // the live atom emitted at the field's end.
  let fieldZone = false;
  // A GOTOBUTTON/MACROBUTTON field (buttonFieldFromInstr): its result, else its
  // instruction's text, is shown — under the jump's link for a GOTOBUTTON.
  let fieldButton: { href?: string; text: string } | null = null;

  const pushText = (text: string, marks: Mark[]) => {
    if (!text) return;
    const bookmarks = openBookmarkMarks(ctx);
    const all = [...marks, ...bookmarks, ...openCommentMarks(ctx)];
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
    const own = parseRunProps(rPr);
    // The block's language survives the character style's yardstick — only a style that
    // names one of its own replaces it.
    const runDefaults = charName
      ? { ...blockDefaults(mergeRunProps(baseRun, styleRun), null, defaults.boldByDefault), lang: styleRun.lang ?? defaults.lang, langAsian: styleRun.langEastAsia ?? defaults.langAsian }
      : defaults;
    const props = mergeRunProps(mergeRunProps(baseRun, styleRun), own);
    // A run's language is inherited unless its own properties name one: the document
    // default must not become a mark inside a paragraph in another language.
    props.lang = own.lang ?? styleRun.lang ?? runDefaults.lang ?? undefined;
    props.langEastAsia = own.langEastAsia ?? styleRun.langEastAsia ?? runDefaults.langAsian ?? undefined;
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
      marks.push({ type: 'link', attrs: { href: linkHref, ...(ours ? {} : { plain: true }) } });
    }
    const change = fc(rPr, 'rPrChange');
    if (change) {
      const before = r.ownerDocument.createElementNS(W, 'r'), old = fc(change, 'rPr');
      if (old) before.appendChild(old.cloneNode(true));
      marks.push({ type: 'formatChange', attrs: {
        id: change.getAttributeNS(W, 'id') ?? '',
        author: change.getAttributeNS(W, 'author') ?? '',
        date: change.getAttributeNS(W, 'date') ?? '',
        old: runMarks(before).filter((m) => !UNFORMATTED_MARKS.has(m.type)),
      } });
    }
    return marks;
  };

  // A wrapper (revision, smart tag, link, simple field) holds a paragraph's own content,
  // range markers included: a missed end would leave its range open to the document end.
  const handleRuns = (el: Element, linkHref?: string) => {
    for (const c of inlineChildren(el)) handleInline(c, linkHref);
  };

  // A recorded revision (w:ins/w:del, a move's two ends w:moveFrom/w:moveTo). Its runs and
  // atoms keep their formatting and take the mark; deleted text sits in w:delText, read as
  // ordinary text.
  const handleRevision = (el: Element, linkHref?: string) => {
    const kind = el.localName === 'del' || el.localName === 'moveFrom' ? 'deletion' : 'insertion';
    const attrs = {
      id: el.getAttributeNS(W, 'id') ?? '',
      author: el.getAttributeNS(W, 'author') ?? '',
      date: el.getAttributeNS(W, 'date') ?? '',
      ...(ctx.moveNames.has(el) ? { moveId: ctx.moveNames.get(el) } : {}),
    };
    const before = out.length;
    handleRuns(el, linkHref);
    for (let i = before; i < out.length; i++) {
      out[i].marks = [...(out[i].marks ?? []), { type: kind, attrs }];
    }
  };

  const handleRun = (r: Element, linkHref?: string) => {
    const marks = runMarks(r, linkHref);
    // Hide a field's cached result where a live node replaces it: a recognized date/time
    // field, a reference, a zone's page field.
    const skipResult = () => fieldMode === 'result' && (fieldZone || !!fieldDateTime || !!fieldShown);
    const buttonLink = () => (fieldMode === 'result' && !linkHref ? fieldButton?.href : undefined);

    // Route a drawing/pict result: both a picture and a text box are inline and stay
    // where the drawing sits.
    const drawn = (src: Element, convert: (el: Element, ctx: Ctx) => Node | Node[] | null) => {
      const n = convert(src, ctx);
      out.push(...(Array.isArray(n) ? n : n ? [n] : []));
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
        if (drawing) drawn(drawing, convertDrawing);
        else {
          const pict = Array.from(child.children)
            .find((c) => c.namespaceURI === MC && c.localName === 'Fallback')
            ?.getElementsByTagNameNS(W, 'pict')[0];
          if (pict) drawn(pict, convertPict);
          else ctx.warnings.add(WARN.drawingsRemoved);
        }
        continue;
      }
      if (child.namespaceURI !== W) continue;
      switch (child.localName) {
        case 'fldChar': {
          const t = child.getAttributeNS(W, 'fldCharType');
          if (t === 'begin') { fieldMode = 'instr'; fieldInstr = ''; fieldDateTime = null; fieldShown = null; fieldSeq = null; fieldResultText = ''; fieldZone = false; fieldButton = null; }
          else if (t === 'separate') {
            fieldMode = 'result';
            fieldZone = !!ctx.zone && !!zoneField(fieldInstr);
            if (!fieldZone) {
              fieldDateTime = dateTimeFieldFromInstr(fieldInstr);
              fieldSeq = fieldDateTime ? null : seqFieldFromInstr(fieldInstr);
              fieldShown = fieldDateTime || fieldSeq ? null : (crossRefFromInstr(fieldInstr, ctx) ?? citationFromInstr(fieldInstr, ctx));
              fieldResultText = '';
              fieldButton = buttonFieldFromInstr(fieldInstr);
              // Carry the field run's marks so the atom renders in the run's font.
              const field = fieldDateTime ?? fieldSeq ?? fieldShown;
              if (field && marks.length) field.marks = marks;
            }
          } else if (t === 'end') {
            const button = fieldMode === 'instr' ? buttonFieldFromInstr(fieldInstr) : null;
            if (button) pushText(button.text, linkHref || !button.href ? marks : runMarks(r, button.href));
            // A reference Word never resolved has no w:separate and so no cached result
            // (it shows nothing until the field is updated); the node view fills it in
            // when the bookmark is still there.
            if (!fieldZone && !fieldDateTime && !fieldShown && !fieldSeq) {
              fieldShown = crossRefFromInstr(fieldInstr, ctx) ?? citationFromInstr(fieldInstr, ctx);
              if (fieldShown && marks.length) fieldShown.marks = marks;
            }
            if (fieldDateTime) out.push(fieldDateTime);
            else if (fieldSeq) out.push({ ...fieldSeq, attrs: { ...fieldSeq.attrs, number: seqNumberOf(fieldResultText) } });
            else if (fieldShown) out.push({ ...fieldShown, attrs: { ...fieldShown.attrs, text: fieldResultText } });
            else {
              const field = ctx.zone ? zoneField(fieldInstr, marks, fieldResultText) : indexEntryFromInstr(fieldInstr);
              if (field) out.push(field);
            }
            fieldMode = 'none';
            fieldZone = false;
            fieldDateTime = null;
            fieldShown = null;
            fieldSeq = null;
            fieldButton = null;
          }
          break;
        }
        case 'instrText':
        case 'delInstrText': if (fieldMode === 'instr') fieldInstr += child.textContent ?? ''; break;
        // w:delText is a deleted run's text — the same content, kept because the
        // revision is only recorded, not applied.
        case 'delText':
        case 't':
          if (customMark !== null && (child.textContent ?? '') === customMark) { customMark = null; break; }
          if ((fieldShown || fieldSeq || fieldZone) && fieldMode === 'result') fieldResultText += child.textContent ?? '';
          else if (!skipResult()) pushText(child.textContent ?? '', buttonLink() ? runMarks(r, buttonLink()) : marks);
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
        // Word stores these two as elements, not characters: a non-breaking hyphen and
        // a soft one. Dropping them loses a character the line is measured with.
        case 'noBreakHyphen': if (!skipResult()) pushText('\u2011', marks); break;
        case 'softHyphen': if (!skipResult()) pushText('\u00ad', marks); break;
        case 'br': out.push(child.getAttributeNS(W, 'type') === 'page' ? { type: PB_MARKER } : hardBreakNode(marks)); break;
        case 'cr': out.push(hardBreakNode(marks)); break;
        case 'drawing': drawn(child, convertDrawing); break;
        case 'pict': drawn(child, convertPict); break;
        case 'footnoteReference':
        case 'endnoteReference': {
          // Word's own separator notes are referenced by nothing — only a real anchor
          // reaches here. A zone has no notes.
          const kind: NoteKind = child.localName === 'endnoteReference' ? 'endnote' : 'footnote';
          // w:customMarkFollows: the literal mark is the rest of this run's text, part
          // of the anchor rather than body text.
          let label: string | null = null;
          if (child.getAttributeNS(W, 'customMarkFollows') === '1' || child.getAttributeNS(W, 'customMarkFollows') === 'true') {
            label = (child.parentElement?.getElementsByTagNameNS(W, 't')[0]?.textContent ?? '') || null;
            if (label) customMark = label;
          }
          const ref = ctx.zone ? null : noteRefNode(child.getAttributeNS(W, 'id'), kind, ctx, baseRun, defaults, label);
          if (ref) out.push(ref);
          break;
        }
      }
    }
  };

  // A simple field the editor models as one node, else null: its shown value is body text.
  const fieldNode = (el: Element): Node | null => {
    const instr = el.getAttributeNS(W, 'instr') ?? '';
    const first = fcAll(el, 'r')[0];
    const zf = ctx.zone && zoneField(instr, first ? runMarks(first) : [], el.textContent ?? '');
    if (zf) return zf;
    const xref = crossRefFromInstr(instr, ctx);
    if (xref) {
      const first = fcAll(el, 'r')[0];
      const m = first ? runMarks(first) : [];
      if (m.length) xref.marks = m;
      return { ...xref, attrs: { ...xref.attrs, text: el.textContent ?? '' } };
    }
    const mark = indexEntryFromInstr(instr);
    if (mark) return mark;
    const cite = citationFromInstr(instr, ctx);
    if (cite) return { ...cite, attrs: { ...cite.attrs, text: el.textContent ?? '' } };
    const seq = seqFieldFromInstr(instr);
    if (seq) {
      const first = fcAll(el, 'r')[0];
      const m = first ? runMarks(first) : [];
      if (m.length) seq.marks = m;
      return { ...seq, attrs: { ...seq.attrs, number: seqNumberOf(el.textContent ?? '') } };
    }
    const field = dateTimeFieldFromInstr(instr);
    if (field) {
      const first = fcAll(el, 'r')[0];
      const m = first ? runMarks(first) : [];
      if (m.length) field.marks = m;
      return field;
    }
    return null;
  };

  const handleInline = (el: Element, linkHref?: string) => {
    // Math is its own namespace and sits beside the w:r runs, so it has to be picked
    // up before the w:-only guard below drops it.
    if (el.namespaceURI === OMML_NS && (el.localName === 'oMath' || el.localName === 'oMathPara')) {
      const formula = formulaNode(el, ctx);
      if (formula) out.push(formula);
      trackRanges(el, ctx);
      return;
    }
    if (el.namespaceURI !== W) return;
    if (trackBookmark(el, ctx) || trackComment(el, ctx)) return;
    switch (el.localName) {
      case 'r': handleRun(el, linkHref); break;
      case 'sdt': {
        // Only a placeholder-tagged control gets here (inlineChildren unwraps the rest).
        const content = fc(el, 'sdtContent');
        const pr = fc(el, 'sdtPr');
        const alias = pr ? fc(pr, 'alias')?.getAttributeNS(W, 'val') : null;
        const shown = (content?.textContent ?? '').trim().replace(/^[<‹]/, '').replace(/[>›]$/, '');
        const field: Node = { type: 'placeholderField', attrs: { text: (alias || shown).trim() } };
        const first = content ? fcAll(content, 'r')[0] : undefined;
        const m = first ? stripPlaceholderGray(runMarks(first)) : [];
        if (m.length) field.marks = m;
        out.push(field);
        if (content) trackRanges(content, ctx);
        break;
      }
      case 'hyperlink': {
        const rid = el.getAttributeNS(R, 'id');
        // No relationship id: an internal link to a bookmark in this document.
        const anchor = el.getAttributeNS(W, 'anchor');
        let href = rid ? ctx.rels.get(rid)?.target : anchor ? `#${anchor}` : undefined;
        // A scheme the editor would never open (javascript:) stops here, not at render time.
        if (!isAllowedUri(href)) href = undefined;
        handleRuns(el, href);
        break;
      }
      case 'fldSimple': {
        // A field collapsed to one node drops its runs, never the ranges opened or closed in them.
        const node = fieldNode(el);
        const button = node ? null : buttonFieldFromInstr(el.getAttributeNS(W, 'instr') ?? '');
        if (node) { out.push(node); trackRanges(el, ctx); }
        else if (button && !fcAll(el, 'r').length) {
          pushText(button.text, button.href && !linkHref ? runMarks(el, button.href) : runMarks(el, linkHref));
          trackRanges(el, ctx);
        } else handleRuns(el, linkHref ?? button?.href);
        break;
      }
      case 'ins':
      case 'del':
      case 'moveFrom':
      case 'moveTo':
        handleRevision(el, linkHref);
        break;
      case 'smartTag':
        handleRuns(el, linkHref);
        break;
    }
  };
  for (const el of inlineChildren(p)) handleInline(el);
  return mergeAdjacentText(out);
}

// A math paragraph stands at its m:jc, else the document's m:defJc, else centered — over
// the paragraph's own w:jc. The editor draws a display formula at its paragraph's alignment.
function mathParaAlign(p: Element, ctx: Ctx): string | null {
  const para = Array.from(p.children).find(c => c.namespaceURI === OMML_NS && c.localName === 'oMathPara');
  if (!para) return null;
  const jc = fcAll(para, 'oMathParaPr', OMML_NS)[0]?.getElementsByTagNameNS(OMML_NS, 'jc')[0]?.getAttributeNS(OMML_NS, 'val');
  const v = jc || ctx.mathJc || 'center';
  return v === 'centerGroup' ? 'center' : v;
}

// <m:oMath> / <m:oMathPara> → a formula node. Word stores no size for a formula, so
// the node view measures it once on screen and writes the ODF frame geometry back.
function formulaNode(el: Element, ctx: Ctx): Node | null {
  const { ast, display } = parseOmml(el);
  // Stored verbatim, not trimmed: a macro's own trailing space is what makes the
  // source re-serialize to itself, so trimming it would rewrite the formula on edit.
  const latex = astToLatex(ast);
  if (!latex.trim()) { ctx.warnings.add(WARN.formulasSkipped); return null; }
  return { type: 'formula', attrs: { latex, display } };
}

// A header/footer's page field: the page number, the page count or Word's running head
// (STYLEREF on a heading style, the level riding in the — possibly localized — name).
// The atom carries the field run's marks so its digits render in the run's font/size.
function zoneField(instr: string, marks: Mark[] = [], cached = ''): Node | null {
  const withMarks = (n: Node): Node => (marks.length ? { ...n, marks } : n);
  if (/\bNUMPAGES\b/.test(instr)) return withMarks({ type: 'pageCount' });
  if (/\bPAGE\b/.test(instr)) return withMarks({ type: 'pageNumber' });
  const m = /\bSTYLEREF\s+"?[^"\d]*(\d)/i.exec(instr);
  // The cached result is the chapter name a reader shows before it repaginates; the
  // editor's own layer overwrites it on the first pass.
  return m ? withMarks({ type: 'chapterField', attrs: { level: Number(m[1]), text: cached } }) : null;
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

// A field whose shown text is in its instruction, not a result: GOTOBUTTON's jump becomes
// an internal link, MACROBUTTON's text stays plain since no macro runs here.
function buttonFieldFromInstr(instr: string): { href?: string; text: string } | null {
  const m = /^\s*(GOTOBUTTON|MACROBUTTON)\s+(\S+)\s*(.*)$/is.exec(instr);
  if (!m) return null;
  const text = m[3].replace(/\s\\\*.*$/s, '').trim().replace(/^"(.*)"$/s, '$1');
  const href = m[1].toUpperCase() === 'GOTOBUTTON' && isAllowedUri(`#${m[2]}`) ? `#${m[2]}` : undefined;
  return { text, ...(href ? { href } : {}) };
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

// A REF/PAGEREF/NOTEREF field instruction → a cross-reference node; its cached result
// text is filled in by the caller when the field closes. Every other field (SEQ,
// CITATION, …) returns null and keeps showing the text the producer cached.
//
// Word carries the reference format in the field's switches where ODF has an attribute:
// \n no context, \r as configured, \w full context, \p above/below, \d its separator,
// \h the hyperlink. A NOTEREF names a bookmark inside the note, which the editor
// addresses by the note itself.
function crossRefFromInstr(instr: string, ctx: Ctx): Node | null {
  const m = /^\s*(PAGEREF|NOTEREF|REF)\s+("[^"]*"|\S+)/i.exec(instr);
  if (!m) return null;
  const verb = m[1].toUpperCase();
  const raw = m[2].replace(/"/g, '');
  const sw = instr.slice(m[0].length);
  const has = (c: string) => new RegExp(`\\\\${c}(?![A-Za-z])`).test(sw);
  const noteId = ctx.noteBookmarks.get(raw);
  if (verb === 'NOTEREF' && !noteId) return null;
  const format: CrossRefFormat = verb === 'PAGEREF' ? 'page'
    : has('p') ? 'direction'
    : has('w') ? 'number-all-superior'
    : has('n') ? 'number-no-superior'
    : has('r') ? 'number'
    : 'text';
  const sep = /\\d\s*"?([^"\s\\]+)"?/.exec(sw)?.[1] ?? null;
  return {
    type: 'crossRef',
    attrs: {
      name: noteId ?? raw,
      format,
      text: '',
      ...(noteId ? { kind: 'note' } : {}),
      ...(sep && format === 'number-all-superior' ? { sep } : {}),
      ...(has('h') ? {} : { link: false }),
    },
  };
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
  // The catalog's key where one renders this picture, else the picture itself:
  // `findFormat` reads it back, so a format only this file names stays live.
  const fmt = [...DATE_FORMATS, ...TIME_FORMATS].find((f) => docxPicture(f) === m[1]) ?? findFormat(m[1]);
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
  const line = lineSig(props);
  if (props.underline && !inLink && line.underline !== defaults.underline) { // link underline is the CSS default
    const attrs = underlineAttrs(props);
    marks.push(attrs ? { type: 'underline', attrs } : { type: 'underline' });
  }
  if (props.strike && line.strike !== defaults.strike) {
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
  // w:eastAsia is the asian half of the pair; the format has no asian size or weight.
  if (props.fontEastAsia && !defaults.asianFonts.has(props.fontEastAsia.toLowerCase())) textStyle.fontFamilyAsian = props.fontEastAsia;

  if (props.caps && props.caps !== defaults.caps) textStyle.caps = props.caps;
  if (props.positionPt) textStyle.textPosition = props.positionPt;
  if (props.emphasis) textStyle.emphasis = props.emphasis;
  if (props.lang && props.lang !== defaults.lang) textStyle.lang = props.lang;
  if (props.langEastAsia && props.langEastAsia !== defaults.langAsian) textStyle.langAsian = props.langEastAsia;

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

// The lines a style draws, in the shape marksFor gives a run: a run drawing exactly that
// adds nothing, a different shape or colour is direct formatting the style can't carry.
function lineSig(props: RunProps): { underline: string | null; strike: string | null } {
  return {
    underline: props.underline ? JSON.stringify(underlineAttrs(props) ?? {}) : null,
    strike: props.strike ? (props.doubleStrike ? 'double' : '') : null,
  };
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

// The picture behind an a:blip, as a data URL. Candidate media: the primary blip plus
// any SVG alternative (Word 2016+ stores an svgBlip beside a raster fallback) — prefer
// whichever the browser can display.
function blipSrc(blip: Element, ctx: Ctx): string | null {
  const candidates: string[] = [];
  const pushEmbed = (id: string | null) => {
    const rel = id ? ctx.rels.get(id) : undefined;
    if (rel && !rel.external) candidates.push(`word/${rel.target.replace(/^\/+/, '')}`);
  };
  pushEmbed(blip.getAttributeNS(R, 'embed'));
  for (const sb of Array.from(blip.getElementsByTagName('*')))
    if (sb.localName === 'svgBlip') pushEmbed(sb.getAttributeNS(R, 'embed'));
  if (!candidates.length) return null;
  return loadImageDataUrl(candidates.find((p) => loadImageDataUrl(p, ctx)) ?? candidates[0], ctx);
}

function convertDrawing(drawing: Element, ctx: Ctx): Node | Node[] | null {
  // The drawing's own root, as a direct child: a text box holding a picture nests a
  // second drawing, and a subtree search finds *its* wp:inline first — the box, and
  // the caption in it, are then read as the bare picture.
  const root = Array.from(drawing.children).find(
    (c) => c.namespaceURI === WP && (c.localName === 'inline' || c.localName === 'anchor'),
  );
  if (!root) return null;
  const anchor = root.localName === 'anchor' ? root : undefined;
  // A group holds shapes and pictures of its own, so it is read before either.
  const wgp = root.getElementsByTagNameNS(WPG, 'wgp')[0];
  if (wgp) return convertGroup(wgp, root, anchor, ctx);
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
      ctx.warnings.add(WARN.chartsReplaced);
      return frameNode(placeholderImage('Chart', boxPx.w, boxPx.h), boxPx, 'Chart', anchor, ctx);
    }
    ctx.warnings.add(WARN.drawingsRemoved);
    return null;
  }
  const src = blipSrc(blip, ctx);
  if (!src) {
    if (boxPx.w > 0 && boxPx.h > 0) {
      ctx.warnings.add(WARN.imagesPlaceholder);
      return frameNode(placeholderImage('Image', boxPx.w, boxPx.h), boxPx, 'Image', anchor, ctx);
    }
    ctx.warnings.add(WARN.imagesSkipped);
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
  // a:srcRect in thousandths of a percent; a negative side pads instead, which is not kept.
  const rect = drawing.getElementsByTagNameNS(A, 'srcRect')[0];
  const side = (k: string) => Math.max(0, intAttr(rect ?? null, '', k) ?? 0) / 100000;
  const crop = rect && cropOf({ l: side('l'), t: side('t'), r: side('r'), b: side('b') });
  if (crop) attrs.crop = crop;
  const mode = blipColorMode(blip);
  if (mode) attrs.colorMode = mode;

  if (anchor) {
    setAnchorAttrs(attrs, anchor, ctx);
  } else {
    fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  }
  return { type: 'image', attrs };
}

// A floating picture's wrap and place, from its wp:anchor.
function setAnchorAttrs(attrs: Record<string, unknown>, anchor: Element, ctx: Ctx): void {
  const { wrap, offsetCm, offsetYCm, fromPage, fromBody, alignH, distCm, alignXCm } = anchorWrap(anchor, ctx);
  attrs.wrap = wrap;
  if ((offsetCm ?? alignXCm) != null) attrs.wrapOffset = offsetCm ?? alignXCm;
  if (offsetYCm != null) attrs.wrapOffsetY = offsetYCm;
  if (fromPage) attrs.wrapFromPage = true;
  if (fromBody) attrs.wrapFromBody = true;
  if (distCm != null) attrs.wrapDist = distCm;
  if (alignH && wrap === 'topBottom') attrs.wrapAlign = alignH;
  if (wrap === 'through') attrs.inFront = anchor.getAttribute('behindDoc') !== '1';
  const rank = stackRank(anchor, null, 'relativeHeight');
  if (rank) attrs.zIndex = rank;
}

// The blip's colour effect as a colour mode: Word's grayscale and black-and-white, and
// its washout, which both word processors write as this a:lum pair (probed).
function blipColorMode(blip: Element): ColorMode | null {
  if (nsChild(blip, A, 'grayscl')) return 'greyscale';
  if (nsChild(blip, A, 'biLevel')) return 'mono';
  const lum = nsChild(blip, A, 'lum');
  return lum && lum.getAttribute('bright') === '70000' && lum.getAttribute('contrast') === '-70000' ? 'watermark' : null;
}

// The same three on a VML v:imagedata. A washout is gain 0.3 over black level 0.35 —
// fractions written as 65536ths with an `f` suffix.
function vmlColorMode(data: Element): ColorMode | null {
  const on = (name: string) => /^(t|true)$/.test(data.getAttribute(name) ?? '');
  if (on('grayscale')) return 'greyscale';
  if (on('bilevel')) return 'mono';
  const frac = (name: string) => {
    const v = data.getAttribute(name) ?? '';
    return v.endsWith('f') ? parseFloat(v) / 65536 : parseFloat(v);
  };
  return Math.abs(frac('gain') - 0.3) < 0.01 && Math.abs(frac('blacklevel') - 0.35) < 0.01 ? 'watermark' : null;
}

// A drawing group (wpg:wgp): the editor has no group node, so each child becomes a frame
// of its own, mapped out of the group's child coordinate space (a:chOff/a:chExt). The
// first keeps the group's own placement — that is what reserves an inline group's box —
// and the rest ride over it as run-through frames at their place in it.
function convertGroup(wgp: Element, root: Element, anchor: Element | undefined, ctx: Ctx): Node[] {
  const xfrm = nsChild(nsChild(wgp, WPG, 'grpSpPr'), A, 'xfrm');
  const chOff = nsChild(xfrm, A, 'chOff');
  const scale = (axis: 'cx' | 'cy') => {
    const child = intAttr(nsChild(xfrm, A, 'chExt'), '', axis) ?? 0;
    return child > 0 ? (intAttr(nsChild(xfrm, A, 'ext'), '', axis) ?? child) / child : 1;
  };
  const sx = scale('cx');
  const sy = scale('cy');
  const boxOf = (el: Element) => {
    const own = el.getElementsByTagNameNS(A, 'xfrm')[0];
    const off = nsChild(own, A, 'off');
    const ext = nsChild(own, A, 'ext');
    return {
      x: emuToPx(((intAttr(off, '', 'x') ?? 0) - (intAttr(chOff, '', 'x') ?? 0)) * sx),
      y: emuToPx(((intAttr(off, '', 'y') ?? 0) - (intAttr(chOff, '', 'y') ?? 0)) * sy),
      w: framePx(emuToPx((intAttr(ext, '', 'cx') ?? 0) * sx)),
      h: framePx(emuToPx((intAttr(ext, '', 'cy') ?? 0) * sy)),
    };
  };

  const carrier: Node[] = [];
  const over: Node[] = [];
  let first: { x: number; y: number; w: number; h: number } | null = null;
  for (const kid of Array.from(wgp.children)) {
    const isPic = kid.localName === 'pic';
    if (!isPic && !(kid.namespaceURI === WPS && kid.localName === 'wsp')) continue;
    const box = boxOf(kid);
    let node: Node | null;
    if (isPic) {
      const blip = kid.getElementsByTagNameNS(A, 'blip')[0];
      const src = blip ? blipSrc(blip, ctx) : null;
      node = src ? frameNode(src, box, '', anchor, ctx) : null;
      const mode = blip && blipColorMode(blip);
      if (node && mode) node.attrs = { ...node.attrs, colorMode: mode };
    } else {
      node = convertWpsShape(kid, root, !!anchor, ctx, box);
    }
    if (!node) continue;
    const attrs = { ...node.attrs, width: box.w, height: box.h } as Record<string, unknown>;
    if (!first) { first = box; carrier.push({ ...node, attrs }); continue; }
    // Every other child runs through the text over the first, offset by its place in
    // the group. An inline group's origin is its paragraph's corner, so a group that
    // shares its line (a centred one, text beside it) carries the rest there.
    attrs.wrap = 'through';
    attrs.inFront = true;
    const off = (k: string, d: number) =>
      round2((typeof node.attrs?.[k] === 'number' ? (node.attrs[k] as number) : 0) + d / PX_PER_CM);
    attrs.wrapOffset = off('wrapOffset', box.x - first.x);
    attrs.wrapOffsetY = off('wrapOffsetY', box.y - first.y);
    over.push({ ...node, attrs });
  }
  if (!carrier.length) ctx.warnings.add(WARN.drawingsRemoved);
  // An inline carrier is what the line reserves the group's box with, and the frames
  // over it take their static position from the paragraph — so they precede it.
  return anchor ? [...carrier, ...over] : [...over, ...carrier];
}


// theme1.xml's colour scheme by slot name, plus the text/background aliases Word's
// default mapping gives them (a shape names `tx2`, the scheme declares `dk2`). A slot
// defined as a system colour keeps the value the producer last resolved it to.
function themeColors(theme: Document | null): Map<string, string> {
  const scheme = theme?.getElementsByTagNameNS(A, 'clrScheme')[0];
  const out = new Map<string, string>();
  for (const el of Array.from(scheme?.children ?? [])) {
    const val = el.getElementsByTagNameNS(A, 'srgbClr')[0]?.getAttribute('val')
      ?? el.getElementsByTagNameNS(A, 'sysClr')[0]?.getAttribute('lastClr');
    const hex = hexColor(val);
    if (hex) out.set(el.localName, hex);
  }
  for (const [alias, slot] of [['tx1', 'dk1'], ['bg1', 'lt1'], ['tx2', 'dk2'], ['bg2', 'lt2'],
    ['text1', 'dk1'], ['background1', 'lt1'], ['text2', 'dk2'], ['background2', 'lt2']] as const) {
    const v = out.get(slot);
    if (v) out.set(alias, v);
  }
  return out;
}

// A DrawingML colour holder (<a:solidFill>, <a:ln>'s fill): its sRGB value, or the theme
// slot it names, shifted by the modifiers Word writes for "accent1, lighter 40%".
function drawingColor(holder: Element | null, ctx: Ctx): string | undefined {
  const srgb = nsChild(holder, A, 'srgbClr');
  const scheme = nsChild(holder, A, 'schemeClr');
  const el = srgb ?? scheme;
  if (!el) return undefined;
  const base = srgb ? hexColor(srgb.getAttribute('val'))
    : ctx.themeColors.get(scheme!.getAttribute('val') ?? '');
  return base ? shiftColor(base, el) : undefined;
}

// The <a:lumMod>/<a:lumOff>/<a:tint>/<a:shade> children, applied per channel (they are
// defined on luminance; the channel-wise reading is within a shade of it and needs no
// colour space). Values are thousandths of a percent.
function shiftColor(hex: string, el: Element): string {
  const pct = (name: string) => {
    const v = nsChild(el, A, name)?.getAttribute('val');
    const n = v != null ? Number(v) / 100000 : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const lumMod = pct('lumMod'), lumOff = pct('lumOff'), tint = pct('tint'), shade = pct('shade');
  if (lumMod == null && lumOff == null && tint == null && shade == null) return hex;
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((c) => {
    let v = c;
    if (lumMod != null) v *= lumMod;
    if (lumOff != null) v += 255 * lumOff;
    if (tint != null) v = v * tint + 255 * (1 - tint);
    if (shade != null) v *= shade;
    return Math.max(0, Math.min(255, Math.round(v)));
  });
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
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
    setAnchorAttrs(attrs, anchor, ctx);
  } else {
    fitInlineImage(attrs, Math.floor(cmToPx(ctx.contentWidthCm)));
  }
  return { type: 'image', attrs };
}

// How far below its anchor paragraph the frame sits, or below the top of its page (the
// top margin's strip starts there too) or of the page's body text (`margin`). The strip
// below the body is left at the anchor: LibreOffice starts it where the body ends, which
// a footer can move — nothing the editor places a frame against.
function anchorOffsetY(anchor: Element, ctx: Ctx): { cm: number | null; fromPage: boolean; fromBody: boolean } {
  const posV = anchor.getElementsByTagNameNS(WP, 'positionV')[0];
  const from = posV?.getAttribute('relativeFrom');
  const fromBody = from === 'margin';
  // A page-relative offset counts from the top of the page the anchor lands on, which
  // is where a cover page's own blocks are placed; the node view resolves the page.
  const fromPage = from === 'page' || from === 'topMargin';
  const none = { cm: null, fromPage: false, fromBody: false };
  if (!fromPage && !fromBody && from !== 'paragraph' && from !== 'line') return none;
  // Aligned to the page or its text area: the top that puts it there.
  const align = posV?.getElementsByTagNameNS(WP, 'align')[0]?.textContent?.trim();
  if (align && (from === 'page' || fromBody)) {
    const room = (from === 'page' ? ctx.pageHeightCm : ctx.textHeightCm)
      - (intAttr(anchor.getElementsByTagNameNS(WP, 'extent')[0], '', 'cy') ?? 0) / 360000;
    const cm = align === 'center' ? room / 2 : align === 'bottom' || align === 'outside' ? room : 0;
    return { cm: round2(cm), fromPage, fromBody };
  }
  const off = parseInt(posV?.getElementsByTagNameNS(WP, 'posOffset')[0]?.textContent ?? '', 10);
  if (!Number.isFinite(off)) return none;
  // The exporter floors this offset at one twip (LO derails on 0); sub-visible
  // remainders round back to none, not to a 0 that would accrete as an attribute.
  // A page-relative one keeps its sign — a cover block may start above the page top —
  // and so does one in front of or behind the text (anchorWrap drops it for the rest).
  const cm = round2(off / 360000);
  return { cm: fromPage || fromBody || cm !== 0 ? cm : null, fromPage, fromBody };
}

// The frame's own x in the text column, cm from its left edge. null where the file
// names an alignment instead of a coordinate. A page-relative offset counts from the
// sheet edge — shift it to the column so one number serves both.
function anchorOffsetX(anchor: Element, ctx: Ctx): number | null {
  const posH = anchor.getElementsByTagNameNS(WP, 'positionH')[0];
  if (posH?.getElementsByTagNameNS(WP, 'align')[0]) return null;
  const off = parseInt(posH?.getElementsByTagNameNS(WP, 'posOffset')[0]?.textContent ?? '', 10);
  if (!Number.isFinite(off)) return null;
  const from = posH?.getAttribute('relativeFrom');
  // At its anchor character is where a frame without an x of its own sits.
  if (from === 'character' && off === 0) return null;
  const base = from === 'page' || from === 'leftMargin' ? -cmToEmu(ctx.leftMarginCm)
    : from === 'rightMargin' ? cmToEmu(ctx.contentWidthCm) : 0;
  return round2((off + base) / 360000);
}

// The column x of a frame centred on its positionH band, or null for a band the
// editor has no width for (a character, a margin strip).
function centreOffsetCm(anchor: Element, cx: number, ctx: Ctx): number | null {
  const from = anchor.getElementsByTagNameNS(WP, 'positionH')[0]?.getAttribute('relativeFrom');
  const room = ctx.contentWidthCm - cx / 360000;
  if (from === 'margin' || from === 'column') return round2(room / 2);
  if (from === 'page') return round2((room + ctx.rightMarginCm - ctx.leftMarginCm) / 2);
  return null;
}

// Wrap mode and place are independent: the mode is what the file's wrap element says,
// the place its position offsets. Only where neither names a side does the frame's own
// x decide which half of the column it fills (text flows on one side of a CSS float).
// A frame's gap as the attr stores it: the plain number it always was where only the
// sides have one, all four where the file keeps one above or below.
function gapOf(top: number, bottom: number, left: number, right: number): number | WrapGap | null {
  const g = wrapGapAttr(wrapGap({ top, bottom, left, right }));
  return !g ? null : g.top || g.bottom ? g : g.left || g.right;
}

function anchorWrap(anchor: Element, ctx: Ctx): { wrap: 'left' | 'right' | 'topBottom' | 'through'; offsetCm: number | null; offsetYCm: number | null; fromPage: boolean; fromBody: boolean; alignH: 'left' | 'right' | null; distCm: number | WrapGap | null; alignXCm: number | null } {
  const { cm: offsetYCm, fromPage, fromBody } = anchorOffsetY(anchor, ctx);
  const offsetCm = anchorOffsetX(anchor, ctx);
  const align = anchor.getElementsByTagNameNS(WP, 'positionH')[0]
    ?.getElementsByTagNameNS(WP, 'align')[0]?.textContent?.trim();
  // A band frame with no side of its own is written flush left with overlap forbidden;
  // that pair is "no side", not a left-aligned frame (which shares its band).
  const bandLeft = (align === 'left' || align === 'inside') && anchor.getAttribute('allowOverlap') === '0';
  const alignH: 'left' | 'right' | null = align === 'right' || align === 'outside' ? 'right'
    : (align === 'left' || align === 'inside') && !bandLeft ? 'left' : null;
  // Beside a side float only the text's side: the gap on the other one is the frame's
  // offset. Above and below count for every mode that wraps.
  const distOf = (wrap: string) => {
    if (wrap === 'through') return null;
    const cm = (name: string) => { const emu = parseInt(anchor.getAttribute(name) ?? '', 10); return Number.isFinite(emu) && emu > 0 ? round2(emu / 360000) : 0; };
    return gapOf(cm('distT'), cm('distB'), wrap === 'right' ? cm('distL') : 0, wrap === 'left' ? cm('distR') : 0);
  };
  // A wrapped frame can't start above its paragraph; a run-through one simply overlaps.
  const y = (wrap: string) => (offsetYCm != null && offsetYCm < 0 && wrap !== 'through' && !fromPage && !fromBody ? null : offsetYCm);
  const at = (wrap: 'left' | 'right' | 'topBottom' | 'through') => ({ wrap, offsetCm, alignXCm: null as number | null, offsetYCm: y(wrap), fromPage, fromBody, alignH, distCm: distOf(wrap) });
  const cx = intAttr(anchor.getElementsByTagNameNS(WP, 'extent')[0], '', 'cx') ?? 0;
  // wrapNone is Word's in-front-of / behind-text: the text runs through the frame, so it
  // reserves neither width nor height. behindDoc picks the side of the text it lands on.
  // Nothing floats a picture to a side, so its alignment in the column becomes that x
  // (alignXCm); a text box keeps the alignment itself (wrapAlign).
  if (anchor.getElementsByTagNameNS(WP, 'wrapNone')[0]) {
    const from = anchor.getElementsByTagNameNS(WP, 'positionH')[0]?.getAttribute('relativeFrom');
    const room = cmToEmu(ctx.contentWidthCm) - cx;
    const x = offsetCm != null || (from !== 'margin' && from !== 'column') ? null
      : alignH === 'right' ? room : align === 'center' ? room / 2 : alignH === 'left' ? 0 : null;
    return { ...at('through'), alignXCm: x == null ? null : round2(x / 360000) };
  }
  if (anchor.getElementsByTagNameNS(WP, 'wrapTopAndBottom')[0]) return at('topBottom');
  const wt = anchor.getElementsByTagNameNS(WP, 'wrapSquare')[0]?.getAttribute('wrapText');
  if (wt === 'right') return at('left'); // text on right ⇒ image on left
  if (wt === 'left') return at('right');
  // A float has no middle: a frame centred on the page or the column keeps that x.
  const half = align === 'center' && offsetCm == null ? centreOffsetCm(anchor, cx, ctx) : null;
  if (half != null) return { ...at(half + cx / 720000 > ctx.contentWidthCm / 2 ? 'right' : 'left'), offsetCm: half };
  if (align === 'right' || align === 'outside') return at('right');
  if (align) return at('left');
  if (offsetCm == null) return at('left');
  return at(cmToEmu(offsetCm) + cx / 2 > cmToEmu(ctx.contentWidthCm) / 2 ? 'right' : 'left');
}

// ---- text boxes / shapes ------------------------------------------------------

// A floating text box's wrap and place, from its wp:anchor.
function setBoxAnchorAttrs(attrs: Record<string, unknown>, root: Element, ctx: Ctx): void {
  const { wrap, offsetCm, offsetYCm, fromPage, fromBody, distCm } = anchorWrap(root, ctx);
  attrs.wrap = wrap;
  if (offsetCm != null) attrs.wrapOffset = offsetCm;
  if (offsetYCm != null) attrs.wrapOffsetY = offsetYCm;
  if (fromPage) attrs.wrapFromPage = true;
  if (fromBody) attrs.wrapFromBody = true;
  if (distCm != null) attrs.wrapDist = distCm;
  // Where the box sits across its band. A box is a block, so it takes the middle and
  // the far end that an image reads as one half of a side-by-side pair.
  const align = root.getElementsByTagNameNS(WP, 'positionH')[0]
    ?.getElementsByTagNameNS(WP, 'align')[0]?.textContent?.trim();
  if ((wrap === 'topBottom' || wrap === 'through') && offsetCm == null
    && (align === 'center' || align === 'right')) attrs.wrapAlign = align;
  if (wrap === 'through') attrs.inFront = root.getAttribute('behindDoc') !== '1';
  const rank = stackRank(root, null, 'relativeHeight');
  if (rank) attrs.zIndex = rank;
}

// A VML shape placed out of the line (`position:absolute`) as the wp:anchor DrawingML
// writes for the same placement, so both read through one anchorWrap. null = in line.
const VML_FROM_H: Record<string, string> = { margin: 'margin', page: 'page', text: 'column', char: 'character', 'left-margin-area': 'leftMargin', 'right-margin-area': 'rightMargin' };
const VML_FROM_V: Record<string, string> = { margin: 'margin', page: 'page', text: 'paragraph', line: 'line', 'top-margin-area': 'topMargin', 'bottom-margin-area': 'bottomMargin' };
function vmlAnchor(shape: Element, style: string): Element | null {
  const prop = (key: string) => new RegExp(`(?:^|;)\\s*${key}\\s*:\\s*([^;]+)`).exec(style)?.[1].trim() ?? null;
  if (prop('position') !== 'absolute') return null;
  // A VML length (pt by default) in EMU.
  const emu = (key: string) => {
    const m = /^(-?[\d.]+)(pt|in|cm|mm|px)?$/.exec(prop(key) ?? '');
    if (!m) return 0;
    const v = parseFloat(m[1]);
    const pt = { pt: v, in: v * 72, cm: (v * 72) / 2.54, mm: (v * 7.2) / 2.54, px: v * 0.75 }[m[2] ?? 'pt']!;
    return Math.round(pt * 12700);
  };
  const doc = shape.ownerDocument;
  const el = (name: string, attrs: Record<string, string> = {}, text?: string) => {
    const e = doc.createElementNS(WP, `wp:${name}`);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const anchor = el('anchor', { behindDoc: Number(prop('z-index') ?? 0) < 0 ? '1' : '0' });
  const axis = (name: string, from: string, align: string | null, offKey: string) => {
    const pos = el(name, { relativeFrom: from });
    pos.appendChild(align && align !== 'absolute' ? el('align', {}, align) : el('posOffset', {}, String(emu(offKey))));
    anchor.appendChild(pos);
  };
  axis('positionH', VML_FROM_H[prop('mso-position-horizontal-relative') ?? ''] ?? 'column', prop('mso-position-horizontal'), 'margin-left');
  axis('positionV', VML_FROM_V[prop('mso-position-vertical-relative') ?? ''] ?? 'paragraph', prop('mso-position-vertical'), 'margin-top');
  anchor.appendChild(el('extent', { cx: String(emu('width')), cy: String(emu('height')) }));
  for (const [side, key] of [['T', 'top'], ['B', 'bottom'], ['L', 'left'], ['R', 'right']]) {
    const d = emu(`mso-wrap-distance-${key}`);
    if (d) anchor.setAttribute(`dist${side}`, String(d));
  }
  // w10:wrap names the wrap; without one the shape runs through the text.
  const wrap = Array.from(shape.children).find((c) => c.localName === 'wrap' && c.namespaceURI === W10);
  const type = wrap?.getAttribute('type');
  const side = wrap?.getAttribute('side');
  anchor.appendChild(type === 'topAndBottom' ? el('wrapTopAndBottom')
    : type === 'square' || type === 'tight' || type === 'through'
      ? el('wrapSquare', { wrapText: side === 'left' || side === 'right' ? side : side === 'largest' ? 'largest' : 'bothSides' })
      : el('wrapNone'));
  return anchor;
}
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

// <a:custGeom> read as the shape's own outline and text area: its guides resolved for
// the shape's `w`×`h` size, each path a part in the space it declares (else that size),
// arcs as curves. A segment or guide that won't resolve leaves the shape unsupported.
function custGeomOutline(spPr: Element | null, w: number, h: number, flipH = false, flipV = false): ResolvedGeometry {
  const none: ResolvedGeometry = { path: '', textArea: null };
  const geom = nsChild(spPr, A, 'custGeom');
  const pathLst = nsChild(geom, A, 'pathLst');
  if (!pathLst) return none;
  const guides = (list: string) => Array.from(nsChild(geom, A, list)?.children ?? [])
    .map((gd): [string, string] => [gd.getAttribute('name') ?? '', gd.getAttribute('fmla') ?? '']);
  try {
    const vals = drawingMlGuides([...guides('avLst'), ...guides('gdLst')], w, h);
    const v = (el: Element, name: string) => drawingMlValue(el.getAttribute(name) ?? '0', vals);
    const parts: OutlinePart[] = [];
    for (const path of Array.from(pathLst.children).filter((c) => c.localName === 'path')) {
      const pw = intAttr(path, '', 'w') || w;
      const ph = intAttr(path, '', 'h') || h;
      const cmds: PathCmd[] = [];
      let [x, y, sx, sy] = [0, 0, 0, 0];
      for (const seg of Array.from(path.children)) {
        const p = Array.from(seg.getElementsByTagNameNS(A, 'pt')).flatMap((pt) => [v(pt, 'x'), v(pt, 'y')]);
        const name = seg.localName;
        if (name === 'close') { cmds.push({ c: 'Z' }); [x, y] = [sx, sy]; continue; }
        if (name === 'arcTo') cmds.push(...drawingMlArc(x, y, v(seg, 'wR'), v(seg, 'hR'), v(seg, 'stAng'), v(seg, 'swAng')));
        else if (name === 'moveTo' || name === 'lnTo') cmds.push({ c: name === 'moveTo' ? 'M' : 'L', p: p.slice(0, 2) });
        else if (name === 'cubicBezTo') cmds.push({ c: 'C', p: p.slice(0, 6) });
        else if (name === 'quadBezTo') {
          cmds.push({ c: 'C', p: [x + (2 / 3) * (p[0] - x), y + (2 / 3) * (p[1] - y),
            p[2] + (2 / 3) * (p[0] - p[2]), p[3] + (2 / 3) * (p[1] - p[3]), p[2], p[3]] });
        } else return none;
        const last = cmds[cmds.length - 1];
        if (last.c !== 'Z') [x, y] = last.p.slice(-2);
        if (name === 'moveTo') [sx, sy] = [x, y];
      }
      // A flip mirrors the outline in the shape's own box, before any rotation.
      if (flipH || flipV) for (const cmd of cmds) if (cmd.c !== 'Z') cmd.p = cmd.p.map((n, i) => (i % 2 ? (flipV ? ph - n : n) : (flipH ? pw - n : n)));
      const d = fitPath(cmds, pw, ph);
      if (!d) return none;
      const shade = shadeFromDrawingMl(path.getAttribute('fill'));
      parts.push({ d, fill: path.getAttribute('fill') !== 'none', stroke: !['0', 'false'].includes(path.getAttribute('stroke') ?? ''),
        ...(shade ? { shade } : {}) });
    }
    if (!parts.length) return none;
    const rect = nsChild(geom, A, 'rect');
    let area = rect && w && h ? [v(rect, 'l') / w, v(rect, 't') / h, v(rect, 'r') / w, v(rect, 'b') / h] : null;
    if (area && flipH) area = [1 - area[2], area[1], 1 - area[0], area[3]];
    if (area && flipV) area = [area[0], 1 - area[3], area[2], 1 - area[1]];
    area = area?.map((n) => Math.round(n * 100000) / 1000) ?? null;
    return { path: joinOutlineParts(parts), textArea: asTextArea(area) };
  } catch {
    return none;
  }
}

// A DrawingML preset (`prst`) the editor has no kind for, as the node keeps it: the
// file writes only the name, its adjust values and the flips.
function presetOf(prstGeom: Element, prst: string, xfrm: Element | null): DrawingMlPreset {
  const adj: Record<string, number> = {};
  for (const gd of Array.from(nsChild(prstGeom, A, 'avLst')?.children ?? [])) {
    const v = Number(/^val\s+(-?\d+)$/.exec(gd.getAttribute('fmla') ?? '')?.[1]);
    if (Number.isFinite(v)) adj[gd.getAttribute('name') ?? ''] = v;
  }
  return { name: prst, adj, ...(xfrm?.getAttribute('flipH') === '1' ? { flipH: true } : {}),
    ...(xfrm?.getAttribute('flipV') === '1' ? { flipV: true } : {}) };
}

// A DrawingML <wps:wsp> (text box, preset shape or freeform) → a textBox node. A preset
// neither `utils/shapes.ts` nor the preset table draws is dropped with a warning. All property lookups are scoped to spPr so a nested image's fill/xfrm can't leak in.
// `box` overrides the drawing's own extent for a shape inside a group, whose size is
// its place in the group rather than the whole group's.
function convertWpsShape(wsp: Element, root: Element, isAnchor: boolean, ctx: Ctx, box?: { w: number; h: number }): Node | null {
  const spPr = nsChild(wsp, WPS, 'spPr');
  const prstGeom = nsChild(spPr, A, 'prstGeom');
  const prst = prstGeom?.getAttribute('prst') ?? 'rect';
  const xfrm = nsChild(spPr, A, 'xfrm');
  const extent = root.getElementsByTagNameNS(WP, 'extent')[0];
  const cx = intAttr(extent, '', 'cx');
  const cy = intAttr(extent, '', 'cy');
  // The shape's own size in its own space: a group member's lives on its xfrm.
  const ext = nsChild(xfrm, A, 'ext');
  const [ew, eh] = [intAttr(ext, '', 'cx') || cx || 0, intAttr(ext, '', 'cy') || cy || 0];
  const known = shapeFromPrst(prst);
  const own = custGeomOutline(spPr, ew, eh, xfrm?.getAttribute('flipH') === '1', xfrm?.getAttribute('flipV') === '1');
  const preset = !own.path && prstGeom && !known ? presetOf(prstGeom, prst, xfrm) : null;
  const geo = preset ? presetGeometry(preset, ew, eh) : own;
  const outline = geo.path;
  const kind = outline ? 'textbox' : known;
  if (!kind) { ctx.warnings.add(WARN.shapesRemoved); return null; }

  const attrs: Record<string, unknown> = {};
  if (kind !== 'textbox') attrs.shapeKind = kind;
  if (outline) attrs.shapePath = outline;
  if (geo.textArea) attrs.shapeTextArea = geo.textArea;
  if (preset && outline) attrs.shapePreset = preset;
  if (box) { attrs.width = box.w; attrs.height = box.h; }
  else {
    if (cx) attrs.width = framePx(emuToPx(cx));
    if (cy) attrs.height = framePx(emuToPx(cy));
  }
  const rot = intAttr(xfrm, '', 'rot');
  if (rot) attrs.rotation = ((Math.round(rot / 60000) % 360) + 360) % 360;
  if (isAnchor) setBoxAnchorAttrs(attrs, root, ctx);

  // What spPr leaves unsaid comes from the shape style's theme references (wps:style),
  // index 0 meaning none — so a preset shape drawn with the theme keeps its fill and line.
  const style = nsChild(wsp, WPS, 'style');
  const ref = (name: string) => {
    const el = nsChild(style, A, name);
    return el && Number(el.getAttribute('idx')) > 0 ? el : null;
  };
  const FILLS = ['solidFill', 'noFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'];
  const ownFill = Array.from(spPr?.children ?? []).some((c) => c.namespaceURI === A && FILLS.includes(c.localName));
  const fill = drawingColor(nsChild(spPr, A, 'solidFill'), ctx) ?? (ownFill ? null : drawingColor(ref('fillRef'), ctx) ?? null);
  const ln = nsChild(spPr, A, 'ln');
  const lnRef = ref('lnRef');
  const stroke = (ln || lnRef) && !nsChild(ln, A, 'noFill')
    ? drawingColor(nsChild(ln, A, 'solidFill'), ctx) ?? drawingColor(lnRef, ctx) ?? '#000000' : null;
  const lnW = intAttr(ln, '', 'w');
  const refW = lnRef ? ctx.themeLineWidths[Number(lnRef.getAttribute('idx')) - 1] ?? null : null;
  setShapeStyleAttrs(attrs, fill, stroke, lnW != null ? lnW / 12700 : refW);
  // A line's heads live on its <a:ln>, and they are what tells the three kinds apart;
  // Word reaches the frame's other diagonal by flipping it. An open outline keeps its own.
  const head = (name: string) => (nsChild(ln, A, name)?.getAttribute('type') ?? 'none') !== 'none';
  const heads = pathHeadsFor(head('headEnd'), head('tailEnd'));
  if (outline && heads && isOpenOutline(outline)) attrs.arrowHeads = heads;
  if (isLineKind(kind)) {
    const [start, end] = [head('headEnd'), head('tailEnd')];
    attrs.shapeKind = lineKindFor(start, end);
    // The editor's one head is the end's: a line with the start's alone runs back.
    const back = start && !end;
    if ((xfrm?.getAttribute('flipV') === '1') !== back) attrs.flipV = true;
    if ((xfrm?.getAttribute('flipH') === '1') !== back) attrs.flipH = true;
  }

  // Vertical text: every one of Word's top-to-bottom flows, the editor having the one
  // direction the browser lays out (`vert270` reads bottom-to-top and is not one).
  const bodyPr = nsChild(wsp, WPS, 'bodyPr');
  const vert = bodyPr?.getAttribute('vert') ?? 'horz';
  if (['vert', 'eaVert', 'mongolianVert', 'wordArtVert'].includes(vert)) attrs.textVertical = true;
  // Where the text sits in a box taller than it is: bodyPr/@anchor, top by default.
  const vAnchor = bodyPr?.getAttribute('anchor');
  if (vAnchor === 'ctr') attrs.textVAlign = 'middle';
  else if (vAnchor === 'b' || vAnchor === 'just' || vAnchor === 'dist') attrs.textVAlign = 'bottom';
  // The ring inside the box (w:lIns, EMU). Word's own default is 0.25cm on the sides;
  // only a value the editor's own ring does not already draw is worth the attr.
  const lIns = bodyPr?.getAttribute('lIns');
  if (lIns != null) {
    const padCm = Number(lIns) / 360000;
    if (Number.isFinite(padCm) && padCm >= 0 && Math.abs(padCm - TEXTBOX_PADDING_CM) > 0.01) {
      attrs.paddingCm = Math.round(padCm * 1000) / 1000;
    }
  }
  // Word's own top/bottom inset is half its side one; only one that differs is kept.
  const sideCm = (attrs.paddingCm as number | undefined) ?? TEXTBOX_PADDING_CM;
  for (const [ins, key] of [['tIns', 'paddingTopCm'], ['bIns', 'paddingBottomCm']]) {
    const cm = Number(bodyPr?.getAttribute(ins) ?? NaN) / 360000;
    if (Number.isFinite(cm) && cm >= 0 && Math.abs(cm - sideCm) > 0.01) attrs[key] = Math.round(cm * 1000) / 1000;
  }

  const txbxContent = nsChild(nsChild(wsp, WPS, 'txbx'), W, 'txbxContent');
  // Only a:spAutoFit grows the shape with its text; without it the box keeps its extent
  // and clips what overflows, in Word as in LibreOffice (probed).
  if (txbxContent && attrs.height && !nsChild(bodyPr, A, 'spAutoFit')) attrs.fixedHeight = true;
  const blocks = txbxContent ? boxBlocks(txbxContent, ctx, attrs) : [];
  return { type: 'textBox', attrs, content: blocks.length ? blocks : [{ type: 'paragraph' }] };
}

// Legacy VML (w:pict): v:rect/v:oval/v:roundrect/v:shape with a v:textbox. Geometry
// comes from the CSS-ish style string; shapes without text content are dropped.
function convertPict(pict: Element, ctx: Ctx): Node | null {
  const shape = Array.from(pict.children).find(
    (c) => c.namespaceURI === VML && ['shape', 'rect', 'oval', 'roundrect'].includes(c.localName),
  );
  // Fold-mark lines ride the flag (storage/foldMarks.ts), never the zone's content.
  const vmlLine = Array.from(pict.children).find((c) => c.namespaceURI === VML && c.localName === 'line');
  if (vmlLine?.getAttribute('id')?.startsWith(FOLD_MARK_NAME)) return null;
  if (!shape) { ctx.warnings.add(WARN.drawingsRemoved); return null; }
  // The watermark rides the page decoration (storage/pageDecor.ts), not the header's
  // content, so it must not also arrive here as a shape.
  if (shape.getAttribute('id') === WATERMARK_NAME) return null;
  // A horizontal line rides its paragraph as a bottom rule (convertParagraph), not a shape.
  if (isHrRect(shape)) return null;

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
  const anchor = vmlAnchor(shape, style);

  // A v:imagedata is a legacy picture (no text box) → an image node.
  const imagedata = shape.getElementsByTagNameNS(VML, 'imagedata')[0];
  const imgRel = imagedata ? ctx.rels.get(imagedata.getAttributeNS(R, 'id') ?? '') : undefined;
  if (imagedata && imgRel && !imgRel.external) {
    const path = `word/${imgRel.target.replace(/^\/+/, '')}`;
    const src = loadImageDataUrl(path, ctx);
    if (!src) {
      ctx.warnings.add(ctx.files[path]
        ? WARN.imagesRemoved
        : WARN.imagesSkipped);
      return null;
    }
    const imgAttrs: Record<string, unknown> = { src };
    if (w) imgAttrs.width = w;
    if (h) imgAttrs.height = h;
    const mode = vmlColorMode(imagedata);
    if (mode) imgAttrs.colorMode = mode;
    if (anchor) setAnchorAttrs(imgAttrs, anchor, ctx);
    return { type: 'image', attrs: imgAttrs };
  }

  const textbox = shape.getElementsByTagNameNS(VML, 'textbox')[0] ?? null;
  const txbxContent = nsChild(textbox, W, 'txbxContent');
  // A freeform is a v:shape drawn by its own path over a declared coordinate space,
  // and it holds no text box — LibreOffice's .docx filter writes one that way.
  const coord = (shape.getAttribute('coordsize') ?? '').split(',').map(Number);
  const outline = coord.length === 2 && coord[0] > 0 && coord[1] > 0 && shape.getAttribute('path')
    ? fitPath(parseVmlPath(shape.getAttribute('path') ?? ''), coord[0], coord[1]) : '';
  if (!txbxContent && !outline) { ctx.warnings.add(WARN.drawingsRemoved); return null; }

  const attrs: Record<string, unknown> = {};
  if (outline) attrs.shapePath = outline;
  // VML names an arrow head on the stroke, per end of the path.
  const vmlStroke = shape.getElementsByTagNameNS(VML, 'stroke')[0];
  const vmlHead = (end: string) => !!vmlStroke && (vmlStroke.getAttribute(end) ?? 'none') !== 'none';
  const vmlHeads = pathHeadsFor(vmlHead('startarrow'), vmlHead('endarrow'));
  if (outline && vmlHeads && isOpenOutline(outline)) attrs.arrowHeads = vmlHeads;
  // VML says vertical text in the box's own style, as `layout-flow:vertical`.
  if (/layout-flow\s*:\s*vertical/.test(textbox?.getAttribute('style') ?? '')) attrs.textVertical = true;
  const kind = shape.localName === 'oval' ? 'ellipse' : shape.localName === 'roundrect' ? 'roundRect' : 'textbox';
  if (kind !== 'textbox') attrs.shapeKind = kind;
  if (w) attrs.width = w;
  if (h) attrs.height = h;
  if (anchor) setBoxAnchorAttrs(attrs, anchor, ctx);
  // VML's counterpart of a:spAutoFit rides the text box's own style.
  if (txbxContent && h && !/mso-fit-shape-to-text\s*:\s*t/.test(textbox?.getAttribute('style') ?? '')) attrs.fixedHeight = true;

  const fillAttr = shape.getAttribute('fillcolor');
  const fill = fillAttr ? normalizeColor(fillAttr) ?? null : null;
  const stroked = shape.getAttribute('stroked');
  const stroke = stroked === 'f' || stroked === 'false'
    ? null
    : normalizeColor(shape.getAttribute('strokecolor') ?? '#000000') ?? '#000000';
  const swm = /^([\d.]+)\s*(pt)?$/.exec(shape.getAttribute('strokeweight') ?? '');
  setShapeStyleAttrs(attrs, fill, stroke, swm ? parseFloat(swm[1]) : null);

  const blocks = txbxContent ? boxBlocks(txbxContent, ctx, attrs) : [];
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

// A floating table (w:tblpPr) is out of Word's flow: what follows it starts where the
// table does. It becomes the frame holding a table both formats keep it in — the shape
// LibreOffice reads it as and writes it back from — so the blocks after it stay put.
function floatingTableBox(tbl: Element, ctx: Ctx): Node | null {
  const pos = fc(fc(tbl, 'tblPr'), 'tblpPr');
  if (!pos) return null;
  const widthCm = floatTableWidthCm(tbl, ctx.contentWidthCm);
  if (!widthCm) return null;
  const outerCm = ctx.contentWidthCm;
  // The table fills its frame, so what margins it declares are measured against that.
  ctx.contentWidthCm = widthCm;
  let table: Node | null;
  try { table = convertTable(tbl, ctx); } finally { ctx.contentWidthCm = outerCm; }
  if (!table) return null;
  const xCm = twipToCm(intAttr(pos, W, 'tblpX') ?? 0);
  const attrs: Record<string, unknown> = {
    width: framePx(cmToPx(widthCm)),
    // The wrap names the side the frame sits on; text flows on the open one.
    wrap: xCm + widthCm / 2 <= outerCm / 2 ? 'left' : 'right',
    // No ring of its own: the cells' own margins are the whole inset a table has. Nor
    // an outline or a fill — only the table's own borders and shading are drawn.
    paddingCm: 0,
    strokeColor: null,
    fillColor: null,
  };
  if (Math.abs(xCm) > 0.01) attrs.wrapOffset = round2(xCm);
  const yCm = twipToCm(intAttr(pos, W, 'tblpY') ?? 0);
  // w:vertAnchor names what the offset counts from: the page, or the text it rides.
  if (pos.getAttributeNS(W, 'vertAnchor') === 'page') {
    attrs.wrapFromPage = true;
    attrs.wrapOffsetY = round2(yCm);
  } else if (Math.abs(yCm) > 0.01) attrs.wrapOffsetY = round2(yCm);
  const from = (name: string) => round2(twipToCm(intAttr(pos, W, name) ?? 0));
  const side = from('leftFromText') || from('rightFromText');
  const dist = gapOf(from('topFromText'), from('bottomFromText'), side, side);
  if (dist != null) attrs.wrapDist = dist;
  return { type: 'textBox', attrs, content: [table] };
}

// w:tblW w:type="pct" is a share of the text width — fiftieths of a percent, or a
// literal "50%" — and the grid is then only the columns' weights, not a width. Returns
// the share as a fraction; null where the element declares no percentage.
function tblWidthFraction(tblW: Element | null): number | null {
  if (!tblW || (tblW.getAttributeNS(W, 'type') ?? 'dxa') !== 'pct') return null;
  const m = /^(\d+(?:\.\d+)?)(%?)$/.exec((tblW.getAttributeNS(W, 'w') ?? '').trim());
  if (!m) return null;
  const v = m[2] ? Number(m[1]) : Number(m[1]) / 50;
  return Number.isFinite(v) && v > 0 ? Math.min(1, v / 100) : null;
}

// A floating table's own width: what w:tblW declares, else the sum of its grid.
function floatTableWidthCm(tbl: Element, contentCm: number): number | null {
  const tblW = fc(fc(tbl, 'tblPr'), 'tblW');
  const pct = tblWidthFraction(tblW);
  if (pct != null) return contentCm * pct;
  const declared = tblW && (tblW.getAttributeNS(W, 'type') ?? 'dxa') === 'dxa' ? intAttr(tblW, W, 'w') : null;
  const grid = fc(tbl, 'tblGrid');
  const gridTwip = grid ? fcAll(grid, 'gridCol').reduce((a, g) => a + (intAttr(g, W, 'w') ?? 0), 0) : 0;
  const twip = declared && declared > 0 ? declared : gridTwip;
  return twip > 0 ? twipToCm(twip) : null;
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
  // A registry style instead is name-only (our own export): its regions are re-derived
  // per cell from name + look + grid position. A file carrying w:tblStylePr wins above.
  const named = ctx.styles.tableStyleName(styleId);
  const look = docxTableLook(fc(tbl, 'tblPr'));
  const regStyle = !conds.size && named ? builtinTableStyles()[named] : undefined;
  const regLook = parseTableLook(look);
  // w:gridBefore/w:gridAfter: grid columns a row leaves without a cell.
  const gridSkip = (tr: Element, side: 'gridBefore' | 'gridAfter') => intAttr(fc(fc(tr, 'trPr'), side), W, 'val') ?? 0;
  const gridCols = useWeights?.length
    ?? Math.max(1, ...trs.map((tr) => fcAll(tr, 'tc').reduce((n, tc) => n + (intAttr(fc(fc(tc, 'tcPr'), 'gridSpan'), W, 'val') ?? 1),
      gridSkip(tr, 'gridBefore') + gridSkip(tr, 'gridAfter'))));
  // Where a row has no cell nothing is drawn: an empty cell without borders stands in, so
  // the grid stays rectangular without a normalizer adding a bordered one.
  const gap = (col: number, span: number): Node => {
    const attrs: Record<string, unknown> = { colspan: span, rowspan: 1,
      borderTop: 'none', borderBottom: 'none', borderLeft: 'none', borderRight: 'none' };
    if (useWeights) attrs.colwidth = useWeights.slice(col, col + span);
    return { type: 'tableCell', attrs, content: [{ type: 'paragraph' }] };
  };
  for (let ri = 0; ri < trs.length; ri++) {
    const tr = trs[ri];
    // w:tblHeader says the same as ODF's <table:table-header-rows>: this row heads the
    // table. Its cells are header cells, which is what shades and bolds them.
    const trHdr = fc(fc(tr, 'trPr'), 'tblHeader');
    const isHeaderRow = !!trHdr && onOff(trHdr);
    const cells: Node[] = [];
    const lead = Math.min(gridSkip(tr, 'gridBefore'), gridCols - 1);
    let col = lead;
    for (const tc of fcAll(tr, 'tc')) {
      const tcPr = fc(tc, 'tcPr');
      const colspan = intAttr(fc(tcPr, 'gridSpan'), W, 'val') ?? 1;
      const vMergeEl = fc(tcPr, 'vMerge');
      const vMerge = vMergeEl ? wVal(vMergeEl) ?? 'continue' : null;
      if (vMerge && vMerge !== 'restart') {
        const origin = pending[col];
        if (origin) origin.attrs!.rowspan = ((origin.attrs!.rowspan as number) || 1) + 1;
        trackRanges(tc, ctx);
        col += colspan;
        continue; // covered cell — dropped, span folded into its origin
      }
      const rowEnd = ri + (vMerge === 'restart' ? vMergeRows(trs, ri, col) : 1);
      const box: GridBox = { row: ri, col, rowEnd, colEnd: col + colspan };
      const areas = conds.size ? condAreasFor(conds, flags, band, box, trs.length, gridCols) : [];
      const paint = condPaint(areas);
      const styled = regStyle ? resolveTableCell(regStyle, {
        row: ri, col, rowSpan: rowEnd - ri, colSpan: colspan, rows: trs.length, cols: gridCols,
      }, regLook) : null;
      const fill = fc(tcPr, 'shd')?.getAttributeNS(W, 'fill');
      const bg = fill ? hexColor(fill) : paint.fill;
      // Header-shaded cells and a bold region render bold by default (CSS); a baked-bold
      // run needs no mark, only an explicitly normal one gets fontWeight:normal.
      const ownSides = cellMarginsCm([fc(tcPr, 'tcMar')]);
      const spanTwip = useWeights?.slice(col, col + colspan).reduce((a, b) => a + b, 0);
      const outerCellCm = ctx.cellWidthCm;
      ctx.cellWidthCm = (spanTwip ? twipToCm(spanTwip) : ctx.contentWidthCm * colspan / gridCols)
        - (ownSides[1] ?? padBase[1]) - (ownSides[3] ?? padBase[3]);
      let blocks: Node[];
      try {
        blocks = convertBlocks(Array.from(tc.children), ctx, 'cell',
          bg === HEADER_SHADE || styled?.text.bold === true);
      } finally { ctx.cellWidthCm = outerCellCm; }
      bakeCellRuns(blocks, paint.run);
      if (styled?.text.color) unbakeRegionColor(blocks, styled.text.color);
      const attrs: Record<string, unknown> = { colspan, rowspan: 1 };
      if (styled?.regions.length) attrs.region = styled.regions.join(' ');
      if (bg) attrs.backgroundColor = bg;
      // w:vAlign — Word's "center" is the editor's "middle"; "top"/"both" stay the default.
      const vAlignEl = fc(tcPr, 'vAlign');
      const vAlign = vAlignEl ? wVal(vAlignEl) : null;
      if (vAlign === 'center') attrs.verticalAlign = 'middle';
      else if (vAlign === 'bottom') attrs.verticalAlign = 'bottom';
      // The cell's own margins (w:tcMar), kept only where they differ from the table's.
      const ownPad = cellPaddingAttr(ownSides, padBase);
      if (ownPad) attrs.cellPadding = ownPad;
      // Per side: the table's borders, then each conditional area over them, then the
      // cell's own w:tcBorders. An edge of the box a layer covers takes that layer's
      // outer side, anything inside it the layer's insideH/insideV.
      const tcBorders = fc(tcPr, 'tcBorders');
      const table: GridBox = { row: 0, col: 0, rowEnd: trs.length, colEnd: gridCols };
      // A band's own edges (top/bottom of a row band, left/right of a column band) close
      // each band row or column; inside the banded region it declares none for, its
      // insideH/insideV stands (probed in LibreOffice).
      const bandAxis = (el: Element): 'h' | 'v' | null => /^band\dHorz$/.test(el.getAttributeNS(W, 'type') ?? '') ? 'h'
        : /^band\dVert$/.test(el.getAttributeNS(W, 'type') ?? '') ? 'v' : null;
      const layers: { els: (Element | null)[]; box: GridBox; band?: 'h' | 'v' | null }[] = [
        { els: tblBorderEls, box: table },
        ...areas.map((a) => ({ els: [fc(fc(a.el, 'tcPr'), 'tcBorders')], box: a.box, band: bandAxis(a.el) })),
        { els: [tcBorders], box },
      ];
      const resolve = (side: 'top' | 'bottom' | 'left' | 'right') => {
        let v: string | null | undefined;
        for (const layer of layers) {
          const name = areaSide(layer.box, box, side);
          const own = layer.band === (side === 'top' || side === 'bottom' ? 'h' : 'v') && name !== side;
          for (const el of layer.els) {
            const got = (own ? docxBorderAttr(fc(el, side)) : undefined) ?? docxBorderAttr(fc(el, name));
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
      const revMark = revMarkIn(tcPr, [['cellIns', 'insertion'], ['cellDel', 'deletion']]);
      if (revMark) attrs.revMark = revMark;
      const cell: Node = { type: isHeaderRow ? 'tableHeader' : 'tableCell', attrs, content: blocks.length ? blocks : [{ type: 'paragraph' }] };
      cells.push(cell);
      for (let c = col; c < col + colspan; c++) pending[c] = vMerge === 'restart' ? cell : null;
      col += colspan;
    }
    if (cells.length && lead) cells.unshift(gap(0, lead));
    if (cells.length && col < gridCols) cells.push(gap(col, gridCols - col));
    if (cells.length === 0) continue;
    const row: Node = { type: 'tableRow', content: cells };
    const h = intAttr(fc(fc(tr, 'trPr'), 'trHeight'), W, 'val');
    if (h && h > 0) row.attrs = { rowHeight: Math.round(twipToPx(h)) };
    const cs = fc(fc(tr, 'trPr'), 'cantSplit');
    if (cs && onOff(cs)) row.attrs = { ...row.attrs, cantSplit: true };
    const revMark = revMarkIn(fc(tr, 'trPr'), [['ins', 'insertion'], ['del', 'deletion']]);
    if (revMark) row.attrs = { ...row.attrs, revMark };
    rows.push(row);
  }
  if (rows.length === 0) return null;
  const attrs: Record<string, unknown> = { ...(tableMargins(tbl, useWeights, ctx, padBase[3]) ?? {}) };
  if (pad) attrs.cellPadding = pad;
  // w:tblHeader on the first row: Word repeats it at the top of every page the table
  // continues on. Only a leading run of rows can carry it, so the first one decides.
  const firstTrPr = fc(fcAll(tbl, 'tr')[0] ?? null, 'trPr');
  const hdr = fc(firstTrPr, 'tblHeader');
  if (hdr && onOff(hdr)) attrs.repeatHeader = true;
  if (named) {
    attrs.tableStyle = named;
    // '' is a declared all-off look — dropping it would revert to the default look.
    if (look != null) attrs.tableLook = look;
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
// left cell margin into the page margin (compatMode below 15).
function tableMargins(tbl: Element, weights: number[] | null, ctx: Ctx, leftPadCm: number): { marginLeft?: number; marginRight?: number } | null {
  const tblPr = fc(tbl, 'tblPr');
  const content = ctx.contentWidthCm;
  const dxa = (el: Element | null) => (el?.getAttributeNS(W, 'type') ?? 'dxa') === 'dxa' ? intAttr(el, W, 'w') : null;
  const left = twipToCm(dxa(fc(tblPr, 'tblInd')) ?? 0) - (ctx.compatMode < 15 ? leftPadCm : 0);
  const declared = dxa(fc(tblPr, 'tblW'));
  const pct = tblWidthFraction(fc(tblPr, 'tblW'));
  const width = pct != null
    ? content * pct
    : declared && declared > 0
      ? twipToCm(declared)
      : weights ? twipToCm(weights.reduce((a, b) => a + b, 0)) : null;
  const right = width != null ? content - left - width : 0;

  if (Math.abs(left) < 0.05 && Math.abs(right) < 0.05) return null;
  if (left + right > content - 1) return null;
  // The width is a sum of whole-twip columns, each rounded on export: within that much of
  // a hundredth the right margin is the hundredth it was written from.
  const slack = ((weights?.length ?? 1) + 1) * 2.54 / 1440;
  const snap = (cm: number) => (Math.abs(cm - round2(cm)) <= slack ? round2(cm) : cm);
  const l = twipCm(Math.round((left / 2.54) * 1440)), r = snap(twipCm(Math.round((right / 2.54) * 1440)));
  // A zero side is the attr's default (null); rounding may also leave a -0 behind.
  return { ...(Math.abs(l) >= 0.005 ? { marginLeft: l } : {}), ...(Math.abs(r) >= 0.005 ? { marginRight: r } : {}) };
}

// A text box's blocks: no cell around them any more, whatever the box sits in. A table
// in the box is measured against the box's text width, as one in a cell is.
function boxBlocks(content: Element, ctx: Ctx, attrs: Record<string, unknown>): Node[] {
  const outerCell = ctx.cellWidthCm;
  ctx.cellWidthCm = boxTextWidthCm(attrs);
  try { return unnestBoxes(convertBlocks(Array.from(content.children), ctx, 'cell'), ctx); } finally { ctx.cellWidthCm = outerCell; }
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

function sectionHeightsCm(sect: Element | null): { pageHeightCm: number; textHeightCm: number } {
  const h = intAttr(fc(sect, 'pgSz'), W, 'h') ?? 16838;
  const pgMar = fc(sect, 'pgMar');
  const top = Math.abs(intAttr(pgMar, W, 'top') ?? 1440);
  const bottom = Math.abs(intAttr(pgMar, W, 'bottom') ?? 1440);
  return { pageHeightCm: twipToCm(h), textHeightCm: Math.max(1, twipToCm(h - top - bottom)) };
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
    const sectPr = closingSectPr(el);
    if (sectPr) {
      if (el.localName !== 'p' || fc(el, 'r') || fc(el, 'hyperlink')) els.push(el);
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

// The sectPr that ends a body child. A block-level w:sdt can hold the end of a section
// — Word wraps a contents block in one and puts the sectPr on its last paragraph, where
// a scan of the body's own children never sees it.
function closingSectPr(el: Element): Element | null {
  if (el.namespaceURI !== W) return null;
  if (el.localName === 'p') return fc(fc(el, 'pPr'), 'sectPr');
  if (el.localName !== 'sdt') return null;
  const ps = fcAll(fc(el, 'sdtContent') ?? el, 'p');
  return fc(fc(ps[ps.length - 1] ?? null, 'pPr'), 'sectPr');
}

// The page's own decoration: Word keeps the background on w:document, the border in the
// section, and the watermark as a VML fontwork shape in a header part — the same three
// places LibreOffice writes them (probed).
function docxPageDecor(
  docDoc: Document, sectPr: Element | null, files: Record<string, Uint8Array>, headers: Set<string>,
): PageDecor {
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
    watermark: docxWatermark(files, headers),
  });
}

// The export's named fold-mark lines, in whichever header part carries them.
function docxFoldMarks(files: Record<string, Uint8Array>): boolean {
  return Object.keys(files).some((path) =>
    /^word\/header\d*\.xml$/.test(path) && strFromU8(files[path]).includes(FOLD_MARK_NAME));
}

// The header parts a page shows: a section's default, its first only under w:titlePg,
// its even only with odd/even on. Both word processors draw nothing from the rest.
function shownHeaderParts(sectPrs: (Element | null)[], ctx: Ctx, oddEven: boolean): Set<string> {
  const out = new Set<string>();
  for (const sect of sectPrs) {
    const titlePgEl = fc(sect, 'titlePg');
    const titlePg = !!titlePgEl && onOff(titlePgEl);
    for (const ref of sect ? fcAll(sect, 'headerReference') : []) {
      const type = ref.getAttributeNS(W, 'type') || 'default';
      if ((type === 'first' && !titlePg) || (type === 'even' && !oddEven)) continue;
      const target = ctx.rels.get(ref.getAttributeNS(R, 'id') ?? '')?.target;
      if (target) out.add(`word/${target.replace(/^\/+/, '')}`);
    }
  }
  return out;
}

// The VML shape Word and LibreOffice both name PowerPlusWaterMarkObject, in whichever
// shown header part carries it. Its text rides v:textpath, its angle the style's rotation.
function docxWatermark(files: Record<string, Uint8Array>, headers: Set<string>): unknown {
  for (const path of headers) {
    if (!files[path]) continue;
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

// <w:docGrid> in the section: every type but "default" lays lines on the grid, at
// w:linePitch twips. The character half of linesAndChars is not modelled.
function docxLineGrid(sectPr: Element | null): LineGrid {
  const grid = fc(sectPr, 'docGrid');
  const type = grid?.getAttributeNS(W, 'type');
  const pitch = grid ? intAttr(grid, W, 'linePitch') : null;
  if (!type || type === 'default' || !pitch) return DEFAULT_LINE_GRID;
  return normalizeLineGrid({ on: true, pitchPt: twipToPt(pitch) });
}

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

// w:type oddPage/evenPage: the section opens on that side, taking a blank page where
// the flow would open it on the other one.
function sectionStartSide(sectPr: Element | null): 'odd' | 'even' | null {
  const t = fc(sectPr, 'type');
  const val = t ? wVal(t) : null;
  return val === 'oddPage' ? 'odd' : val === 'evenPage' ? 'even' : null;
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
    ctx.warnings.add(WARN.columnsReduced);
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
const COLUMNS_ALLOWED = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'table']);

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
    } else if (block.type === 'tableOfContents') {
      // An index flows through the section's columns on its own.
      flush();
      const a = block.attrs ?? {};
      block.attrs = { ...a, columns: a.columns ?? cols.count, columnGapCm: a.columnGapCm ?? cols.gapCm };
      out.push(block);
    } else {
      ctx.warnings.add(WARN.movedOutOfColumns);
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
// margin under 15 and 2.1mm left of it under 14. No setting at all is an old file (0).
function wordCompatMode(files: Record<string, Uint8Array>): number {
  const bytes = files['word/settings.xml'];
  if (!bytes) return 0;
  try {
    for (const el of Array.from(parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'compatSetting'))) {
      if (el.getAttributeNS(W, 'name') !== 'compatibilityMode') continue;
      const n = parseInt(el.getAttributeNS(W, 'val') ?? '', 10);
      return Number.isFinite(n) ? n : 0;
    }
  } catch { /* an unreadable settings.xml is no setting */ }
  return 0;
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

// Only the protection that keeps recording on is ours; its attributes go back out as read.
function docRecordLock(files: Record<string, Uint8Array>): RecordLock | null {
  const bytes = files['word/settings.xml'];
  if (!bytes) return null;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, 'documentProtection')[0];
    if (el?.getAttributeNS(W, 'edit') !== 'trackedChanges' || !/^(1|true|on)$/.test(el.getAttributeNS(W, 'enforcement') ?? '')) return null;
    const hashed = el.hasAttributeNS(W, 'hash') || el.hasAttributeNS(W, 'hashValue');
    return hashed ? { word: Array.from(el.attributes, (a) => ` w:${a.localName}="${a.value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('') } : {};
  } catch {
    return null;
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

function docMathJc(files: Record<string, Uint8Array>): string | null {
  const bytes = files['word/settings.xml'];
  if (!bytes) return null;
  try {
    return parseXml(strFromU8(bytes)).getElementsByTagNameNS(OMML_NS, 'defJc')[0]?.getAttributeNS(OMML_NS, 'val') || null;
  } catch {
    return null;
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

// An on/off switch in settings.xml (absent = off, as in Word), wherever it nests — the
// document-wide flags, and the compatibility options under w:compat.
function docSetting(files: Record<string, Uint8Array>, name: string): boolean {
  const bytes = files['word/settings.xml'];
  if (!bytes) return false;
  try {
    const el = parseXml(strFromU8(bytes)).getElementsByTagNameNS(W, name)[0];
    return !!el && onOff(el);
  } catch {
    return false;
  }
}

const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

// word/commentsExtended.xml → per w14:paraId whether the comment is handled (w15:done)
// and which comment it answers (w15:paraIdParent), the two things w:comment cannot say.
function docxCommentsEx(files: Record<string, Uint8Array>): Map<string, { done: boolean; parent: string | null }> {
  const out = new Map<string, { done: boolean; parent: string | null }>();
  const bytes = files['word/commentsExtended.xml'];
  if (!bytes) return out;
  let doc: Document;
  try { doc = parseXml(strFromU8(bytes)); } catch { return out; }
  for (const ex of Array.from(doc.getElementsByTagNameNS(W15, 'commentEx'))) {
    const pid = ex.getAttributeNS(W15, 'paraId');
    if (!pid) continue;
    const done = ex.getAttributeNS(W15, 'done');
    out.set(pid, { done: done === '1' || done === 'true', parent: ex.getAttributeNS(W15, 'paraIdParent') || null });
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
  const ex = docxCommentsEx(files);
  // paraId → the comment it belongs to, so an answer finds the one it hangs under.
  const byParaId = new Map<string, Record<string, unknown>>();
  const replies: { parent: string; attrs: Record<string, unknown> }[] = [];
  for (const c of Array.from(doc.getElementsByTagNameNS(W, 'comment'))) {
    const id = c.getAttributeNS(W, 'id');
    if (!id) continue;
    const paras = fcAll(c, 'p');
    const lastPid = paras.length ? paras[paras.length - 1].getAttributeNS(W14, 'paraId') : null;
    const meta = lastPid ? ex.get(lastPid) : undefined;
    const attrs: Record<string, unknown> = {
      id: `w${id}`,
      author: c.getAttributeNS(W, 'author') ?? '',
      date: c.getAttributeNS(W, 'date') ?? '',
      text: paras.map((p) => p.textContent ?? '').join('\n').trim(),
      resolved: meta?.done === true,
    };
    if (lastPid) byParaId.set(lastPid, attrs);
    // An answer is a comment of its own in the part; the thread is what the editor
    // shows, so it is folded into its parent and gets no mark of its own.
    if (meta?.parent) replies.push({ parent: meta.parent, attrs });
    else out.set(id, attrs);
  }
  // The attr is written only where the file has a thread: an empty one is the mark's
  // default, and an editor document carries none.
  for (const r of replies) {
    const parent = byParaId.get(r.parent);
    if (!parent) continue;
    const list = (parent.replies as { author: string; date: string; text: string }[]) ?? [];
    list.push({ author: String(r.attrs.author), date: String(r.attrs.date), text: String(r.attrs.text) });
    parent.replies = list;
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
    format: w && h ? pageFormatOf(twipToCm(w), twipToCm(h)) : null,
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
  const pageHighCm = (intAttr(fc(sect, 'pgSz'), W, 'h') ?? 16838) / 1440 * 2.54 - 1;
  const clampCm = (tw: number | null) => (tw == null ? null : Math.min(pageHighCm, Math.max(0, round2(twipToCm(tw)))));
  const margins = sectMargins(sect);

  // Different first page: w:titlePg turns on the "first"-type refs for page 1.
  const titlePgEl = fc(sect, 'titlePg');
  const titlePg = !!titlePgEl && onOff(titlePgEl);
  const refId = (type: string, variant: 'default' | 'first' | 'even' = 'default') => {
    const ref = fcAll(sect, `${type}Reference`).find((r) => (r.getAttributeNS(W, 'type') ?? 'default') === variant);
    return ref?.getAttributeNS(R, 'id') ?? null;
  };

  const header = convertHfPart(refId('header'), ctx, sect);
  const footer = convertHfPart(refId('footer'), ctx, sect);
  const headerFirst = titlePg ? convertHfPart(refId('header', 'first'), ctx, sect) : null;
  const footerFirst = titlePg ? convertHfPart(refId('footer', 'first'), ctx, sect) : null;
  // Odd/even pages: settings.xml w:evenAndOddHeaders turns on the "even"-type refs.
  const headerEven = oddEven ? convertHfPart(refId('header', 'even'), ctx, sect) : null;
  const footerEven = oddEven ? convertHfPart(refId('footer', 'even'), ctx, sect) : null;
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
    return tw == null ? fallback : Math.max(0, twipCm(tw));
  };
  const pgSz = sect ? fc(sect, 'pgSz') : null;
  const dim = (a: string, fallback: number) => {
    const tw = intAttr(pgSz, W, a);
    return tw == null ? fallback : twipToCm(tw);
  };
  return fitMargins(
    { top: cm('top', 2.54), bottom: cm('bottom', 2.54), left: cm('left', 2.12), right: cm('right', 2.12) },
    dim('w', 21), dim('h', 29.7));
}

// One HfSet per section, in body order, resolving Word's "Link to Previous": a section
// that declares no reference of a type keeps the previous section's. w:titlePg is per
// section, odd/even is document-wide (settings.xml).
function sectionHfSets(
  sectPrs: (Element | null)[], ctx: Ctx, oddEven: boolean,
  doc: { format: PageFormat | null; orientation: Orientation | null; numFormat: NoteNumFormat; mirrored: boolean },
): HfSet[] {
  const out: HfSet[] = [];
  // Word's edge→zone distances are per section too; the first section's are the
  // document's, so only a section that disagrees carries its own.
  const distOf = (sect: Element | null): HfDistances | null => {
    const pgMar = sect ? fc(sect, 'pgMar') : null;
    if (!pgMar) return null;
    const cm = (a: string, fallback: number) => {
      const tw = intAttr(pgMar, W, a);
      return tw == null ? fallback : Math.max(0, round2(twipToCm(tw)));
    };
    return { header: cm('header', HF_DISTANCE_CM), footer: cm('footer', HF_DISTANCE_CM) };
  };
  const docDist = distOf(sectPrs[0] ?? null);
  const sameDist = (a: HfDistances | null, b: HfDistances | null) =>
    !!a && !!b && Math.abs(a.header - b.header) < 0.01 && Math.abs(a.footer - b.footer) < 0.01;
  for (const sect of sectPrs) {
    const prev = out[out.length - 1] ?? EMPTY_HF_SET;
    const dist = distOf(sect);
    const titlePgEl = sect ? fc(sect, 'titlePg') : null;
    const titlePg = !!titlePgEl && onOff(titlePgEl);
    const zone = (type: 'header' | 'footer', variant: string, inherited: HfDoc): HfDoc => {
      const ref = sect
        ? fcAll(sect, `${type}Reference`).find((r) => (r.getAttributeNS(W, 'type') ?? 'default') === variant)
        : null;
      return ref ? convertHfPart(ref.getAttributeNS(R, 'id'), ctx, sect) : inherited;
    };
    // Only a section disagreeing with the document carries its own paper: matching it is
    // inheritance, not formatting, exactly as for the margins.
    const paper = sectPaper(sect);
    // w:pgNumType w:start restarts the numbering at this section; without it it counts
    // on. The first section's is the document's own start (read separately).
    const pgStart = sect ? intAttr(fc(sect, 'pgNumType'), W, 'start') : null;
    // w:fmt is per section too — a roman front matter before a decimal body.
    const pgFmt = DOCX_PAGE_NUM_FORMAT[fc(sect, 'pgNumType')?.getAttributeNS(W, 'fmt') ?? ''] ?? '1';
    out.push({
      startsOn: sectionStartSide(sect),
      // w:mirrorMargins is document-wide, so every section's pair is inner/outer.
      margins: withMirror(sectMargins(sect), doc.mirrored),
      distances: sameDist(dist, docDist) ? null : dist,
      pageNumberStart: out.length && pgStart != null ? clampPageStart(pgStart) : null,
      pageNumberFormat: out.length && pgFmt !== doc.numFormat ? pgFmt : null,
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

// A header/footer part → a zone doc, through the body's block converter with the part's
// own relationships and the section's text width. null = no part, or nothing in it.
function convertHfPart(relId: string | null, ctx: Ctx, sect: Element | null): HfDoc {
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
  const zoneCtx: Ctx = {
    ...ctx, zone: true, rels: parseRels(ctx.files[path.replace(/^word\/(.*)$/, 'word/_rels/$1.rels')]),
    openBookmarks: new Map(), pointBookmarks: new Set(), openComments: new Map(), commentDefs: new Map(), moveNames: moveNames(root),
    listCounters: new Map(), cellSpacing: {},
    contentWidthCm: sectionContentWidthCm(sect), leftMarginCm: twipToCm(intAttr(fc(sect, 'pgMar'), W, 'left') ?? 1440), rightMarginCm: twipToCm(intAttr(fc(sect, 'pgMar'), W, 'right') ?? 1440),
    ...sectionHeightsCm(sect),
  };
  const zone: HfDoc = { type: 'doc', content: convertBlocks(Array.from(root.children), zoneCtx, 'zone') };
  if (hfIsEmpty(zone)) return null;
  zone.content?.forEach((block) => scopeRevisions(block as Node, target));
  return zone;
}

// Revision ids need only be unique within a part, and the pane lists every part's changes.
function scopeRevisions(node: Node, part: string): void {
  const scoped = (a: Record<string, unknown>) => { a.id = `${part}:${a.id}`; };
  for (const m of node.marks ?? []) if (m.type === 'insertion' || m.type === 'deletion' || m.type === 'formatChange') scoped(m.attrs as Record<string, unknown>);
  const { revMark, revFormat } = (node.attrs ?? {}) as { revMark?: RevMark; revFormat?: Record<string, unknown> };
  for (const attrs of [revMark?.insertion, revMark?.deletion, revFormat]) if (attrs) scoped(attrs);
  node.content?.forEach((child) => scopeRevisions(child, part));
}
