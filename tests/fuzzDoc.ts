// Seeded random-document generator for the fuzz round-trip leg (fuzz-roundtrip.test.ts).
import {
  DEFAULT_TABLE_LOOK, TABLE_REGIONS, builtinTableStyles, resolveTableCell, tableLookAttr,
} from '../src/lib/styles/tableStyles';

type N = any;
type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const maybe = (r: Rng, p: number) => r() < p;

// XML-hostile characters, umlauts, an astral-plane glyph and a tab on purpose.
const WORDS = ['Lorem', 'ipsum', 'Größe', 'fünf', 'a&b', '<tag>', '"quote"', "it's",
  '€42', '🙂ok', 'x\ty', 'dolor', 'sit'] as const;

// A heading run must not carry marks equal to the heading defaults (bold, italic on
// levels 4/6, Arial, the level's size) — both importers suppress default-equal values,
// so those are lossy by design. Headings get the marks with no heading default.
function marks(r: Rng, heading = false): N[] | undefined {
  const out: N[] = [];
  if (!heading && maybe(r, 0.25)) out.push({ type: 'bold' });
  if (!heading && maybe(r, 0.2)) out.push({ type: 'italic' });
  // A link excludes color/underline effects: the DOCX importer tells an editor link from
  // a styled foreign one by exactly that styling (link.ts `plain`), so it can't survive.
  if (maybe(r, 0.08)) {
    out.push({ type: 'link', attrs: { href: 'https://example.com/x?a=1&b=2' } });
    return out;
  }
  if (maybe(r, 0.1)) {
    const attrs: N = {};
    if (maybe(r, 0.3)) attrs.lineStyle = pick(r, ['dotted', 'double', 'dashed']);
    if (maybe(r, 0.2)) attrs.lineColor = '#FF0000';
    out.push({ type: 'underline', ...(Object.keys(attrs).length ? { attrs } : {}) });
  }
  if (maybe(r, 0.1)) {
    out.push(maybe(r, 0.25) ? { type: 'strike', attrs: { lineStyle: 'double' } } : { type: 'strike' });
  }
  const shifted = maybe(r, 0.08);
  if (shifted) out.push({ type: pick(r, ['superscript', 'subscript']) });
  if (maybe(r, 0.1)) out.push({ type: 'highlight', attrs: { color: pick(r, ['#FFFF00', '#00FF00']) } });
  if (maybe(r, 0.25)) {
    const attrs: N = {};
    if (maybe(r, 0.5)) attrs.color = pick(r, ['#C00000', '#0070C0']);
    if (!heading && maybe(r, 0.4)) attrs.fontFamily = 'Arial';
    if (!heading && maybe(r, 0.4)) attrs.fontSize = pick(r, ['10pt', '14pt', '18pt']);
    if (maybe(r, 0.2)) attrs.caps = pick(r, ['uppercase', 'smallCaps']);
    // sub/superscript and a free raise share ODF's one text-position attribute
    if (!shifted && maybe(r, 0.15)) attrs.textPosition = pick(r, [3, -2]);
    if (Object.keys(attrs).length) out.push({ type: 'textStyle', attrs });
  }
  if (!heading && maybe(r, 0.06)) {
    const name = pick(r, ['Emphasis', 'Strong Emphasis', 'Source Text']);
    // a direct mark equal to what the style supplies is suppressed on import (same
    // rule as the heading defaults), so it can't ride beside the style
    const redundant = name === 'Emphasis' ? 'italic' : name === 'Strong Emphasis' ? 'bold' : '';
    const i = out.findIndex((m) => m.type === redundant);
    if (i >= 0) out.splice(i, 1);
    out.push({ type: 'charStyle', attrs: { name } });
  }
  return out.length ? out : undefined;
}

function runs(r: Rng, heading = false): N[] {
  const n = int(r, 1, 4);
  return Array.from({ length: n }, (_, i) => {
    const text = Array.from({ length: int(r, 1, 5) }, () => pick(r, WORDS)).join(' ')
      + (i < n - 1 ? ' ' : '');
    const m = marks(r, heading);
    return { type: 'text', text, ...(m ? { marks: m } : {}) };
  });
}

// indents=false inside list items: a list paragraph's indent lives in the list style
// and does not round-trip as direct formatting (import/odt.ts skips it there).
// top=false in cells/lists: the page-break sentinel rides top-level blocks only.
function paraAttrs(r: Rng, indents: boolean, top: boolean): N | null {
  const attrs: N = {};
  if (maybe(r, 0.3)) attrs.textAlign = pick(r, ['left', 'center', 'right', 'justify']);
  if (maybe(r, 0.2)) attrs.lineHeight = pick(r, ['1.5', '2']);
  if (maybe(r, 0.15)) attrs.spaceBefore = pick(r, [6, 12]);
  if (maybe(r, 0.15)) attrs.spaceAfter = pick(r, [12, 18]);
  if (indents && maybe(r, 0.15)) attrs.indent = pick(r, [1.25, 2.5]);
  if (indents && maybe(r, 0.1)) attrs.indentFirst = pick(r, [0.75, -0.75]);
  if (indents && maybe(r, 0.1)) attrs.indentRight = 1.5;
  if (top && maybe(r, 0.05)) attrs.breakBefore = 'page';
  if (maybe(r, 0.05)) attrs.dir = 'rtl';
  // Paragraph box: shading and/or rule lines (ParaStyle carries them into cells/lists).
  if (maybe(r, 0.08)) {
    if (maybe(r, 0.6)) attrs.backgroundColor = pick(r, ['#CCFFFF', '#FFE0E0']);
    if (maybe(r, 0.5)) attrs.borderBottom = '2pt solid #FF0000';
    if (maybe(r, 0.3)) attrs.borderTop = '1pt solid #00B050';
    if (maybe(r, 0.25)) { attrs.borderLeft = '1pt solid #00B050'; attrs.borderRight = '1pt solid #00B050'; }
  }
  // The flow/pagination flags and tab stops ride the top-level PBX spec only.
  if (top && maybe(r, 0.05)) attrs.keepNext = true;
  if (top && maybe(r, 0.05)) attrs.keepLines = true;
  if (top && maybe(r, 0.04)) attrs.widowControl = false;
  // no noHyphenation: without the document-wide hyphenate flag (a buildOdt parameter
  // the round trip doesn't pass) the importers suppress it as meaningless.
  if (top && maybe(r, 0.06)) attrs.tabStops = pick(r, ['6l;12r', '3c.;9r_', '5d']);
  return Object.keys(attrs).length ? attrs : null;
}

// Doc-level state for cross-linked features (bookmark names, comment ids); genDoc resets it.
let bmNames: string[] = [];
let commentSeq = 0;
let revSeq = 0;
let seqCounters: Record<string, number> = {};
let bibIndex = false;

const LATEX = ['x^{2}+1', '\\frac{a}{b}', '\\sqrt{x+1}', '\\alpha \\cdot \\beta'] as const;

function paragraph(r: Rng, indents = true, top = false): N {
  if (maybe(r, 0.08)) return { type: 'paragraph' }; // empty line
  if (maybe(r, 0.03)) { // a display formula owns its line — that is what makes it display
    return { type: 'paragraph',
      content: [{ type: 'formula', attrs: { latex: pick(r, LATEX), display: true } }] };
  }
  const attrs = paraAttrs(r, indents, top);
  const content = runs(r);
  const body: N[] = [];
  for (const run of content) {
    body.push(run);
    if (maybe(r, 0.1)) body.push({ type: 'hardBreak' });
  }
  if (maybe(r, 0.05)) {
    const name = `bm${bmNames.length + 1}`;
    bmNames.push(name);
    content[0].marks = [...(content[0].marks ?? []), { type: 'bookmark', attrs: { name } }];
  }
  if (bmNames.length && maybe(r, 0.05)) {
    const format = pick(r, ['text', 'page'] as const);
    body.push({ type: 'crossRef', attrs: {
      name: pick(r, bmNames), format, text: format === 'page' ? '1' : 'Lorem ipsum' } });
  }
  if (maybe(r, 0.05)) {
    content[content.length - 1].marks = [...(content[content.length - 1].marks ?? []),
      { type: 'comment', attrs: { id: `c${++commentSeq}`, author: 'Fuzz Author',
        date: '2026-03-04T05:06:07', text: 'Check & <this> "here"', resolved: maybe(r, 0.3) } }];
  }
  if (maybe(r, 0.06)) {
    const run = content[int(r, 0, content.length - 1)];
    run.marks = [...(run.marks ?? []), { type: pick(r, ['insertion', 'deletion']),
      attrs: { id: `rv${++revSeq}`, author: 'Rev Author', date: '2026-05-06T07:08:09' } }];
  }
  if (maybe(r, 0.04)) {
    const category = pick(r, ['figure', 'table'] as const);
    seqCounters[category] = (seqCounters[category] ?? 0) + 1;
    body.push({ type: 'sequenceField',
      attrs: { category, format: pick(r, ['1', 'a', 'A', 'i', 'I']), number: seqCounters[category] } });
  }
  if (maybe(r, 0.04)) {
    body.push({ type: 'indexEntry',
      attrs: { term: 'Größe & <term>', key1: maybe(r, 0.4) ? 'Key "1"' : '' } });
  }
  // fields limited to the ones Word has a b:Source slot for (DOCX_BIB_FIELD); the rest
  // survive only the ODF leg. text is derived on load — normalize drops it. The type is
  // keyed to the identifier: one identifier is one source record (Word stores it once).
  if (maybe(r, 0.04)) {
    const src = int(r, 1, 3);
    body.push({ type: 'bibliographyEntry', attrs: {
      identifier: `src${src}`, type: ['book', 'article', 'www'][src - 1],
      fields: { author: 'Knuth, Donald', title: 'Art & <of> "CS"', year: '1986' }, text: '' } });
  }
  // fixed=false only: Word has no fixed-date field, the DOCX exporter writes plain text.
  if (maybe(r, 0.04)) {
    const kind = pick(r, ['date', 'time'] as const);
    body.push({ type: 'dateTimeField', attrs: { kind,
      format: kind === 'date' ? pick(r, ['iso', 'dmy_dots', 'mdy_long', 'weekday_dmy'])
        : pick(r, ['hm24', 'hms12']),
      fixed: false, value: '2026-08-16T10:30:00' } });
  }
  if (maybe(r, 0.04)) body.push({ type: 'ruby', attrs: { base: '漢字', text: 'かんじ' } });
  // display=false only: ODF has no display flag, the importer derives it from the formula
  // owning its line (aloneInParagraph) — a display formula is its own paragraph (genDoc).
  if (maybe(r, 0.05)) {
    body.push({ type: 'formula', attrs: { latex: pick(r, LATEX), display: false } });
  }
  if (maybe(r, 0.06)) {
    const img: N = { src: PNG, width: int(r, 40, 200), height: int(r, 30, 120) };
    if (maybe(r, 0.3)) img.alt = 'a & "b" <c>';
    if (maybe(r, 0.2)) img.rotation = pick(r, [90, 180]);
    // floating at top level only; offsets in whole hundredth-cm (import rounds to 2)
    if (top && maybe(r, 0.25)) {
      img.wrap = pick(r, ['left', 'right', 'topBottom']);
      if (maybe(r, 0.5)) img.wrapOffset = pick(r, [1.5, 2.25]);
      // dist only beside a side wrap: with text only above/below there is no side
      // gap to keep, and the ODT graphic style carries none
      if (img.wrap !== 'topBottom' && maybe(r, 0.3)) img.wrapDist = 0.5;
      if (img.wrap === 'topBottom' && maybe(r, 0.3)) img.wrapOffsetY = 1.5;
    }
    body.push({ type: 'image', attrs: img });
  }
  return { type: 'paragraph', ...(attrs ? { attrs } : {}), content: body };
}

// px multiples of 48 map to whole-hundredth cm and back without rounding drift.
function textBox(r: Rng): N {
  const attrs: N = { width: 48 * int(r, 3, 7), height: 48 * int(r, 2, 4) };
  if (maybe(r, 0.3)) attrs.shapeKind = pick(r, ['roundRect', 'ellipse', 'diamond']);
  if (maybe(r, 0.3)) attrs.fillColor = pick(r, ['#FFE0A0', '#DDEEFF']);
  // width only beside a stroke color: with no stroke drawn the width is meaningless
  if (maybe(r, 0.25)) {
    attrs.strokeColor = '#0070C0';
    if (maybe(r, 0.5)) attrs.strokeWidthPt = 2;
  }
  if (maybe(r, 0.12)) attrs.textVertical = true;
  // floats like an image; dist beside a side wrap only (as there)
  if (maybe(r, 0.3)) {
    attrs.wrap = pick(r, ['left', 'right', 'topBottom']);
    if (maybe(r, 0.5)) attrs.wrapOffset = pick(r, [1.5, 2.25]);
    if (attrs.wrap !== 'topBottom' && maybe(r, 0.3)) attrs.wrapDist = 0.5;
    if (attrs.wrap === 'topBottom' && maybe(r, 0.3)) attrs.wrapOffsetY = 1.5;
  }
  const kids = Array.from({ length: int(r, 1, 2) }, () => paragraph(r));
  return { type: 'textBox', attrs, content: kids };
}

// A generated index. Both importers return an empty entry cache (the node view refills
// it live), no own title and the default leader — so that is what an authored one holds.
function tocBlock(r: Rng): N {
  let kind = pick(r, ['toc', 'toc', 'figures', 'tables', 'alphabetical', 'bibliography'] as const);
  if (kind === 'bibliography' && bibIndex) kind = 'toc';
  // maxLevel rides only the TOC family (ODF text:outline-level, Word's \o range).
  const attrs: N = { entries: [], title: '', index: kind,
    leader: '.', tabPosCm: null, maxLevel: kind === 'toc' ? pick(r, [3, 5, 10]) : 10 };
  // One bibliography per doc with a Word-nameable style: DOCX keeps a single document
  // citation style (b:Sources StyleName), and it has no name for LibreOffice's
  // cite-by-key (the export writes APA for it), so 'key' survives only the ODT leg.
  if (kind === 'bibliography') {
    bibIndex = true;
    attrs.citationStyle = pick(r, ['numbered', 'apa', 'mla', 'chicago']);
  }
  return { type: 'tableOfContents', attrs };
}

// Two topBottom images set against opposite band ends share the band side by side; only
// such a pair keeps its wrapAlign on import (pairAlignedFrames — a lone aligned frame
// reserves the whole band). No wrapOffset: the export writes the alignment as the x.
function framePair(r: Rng): N {
  const img = (side: string): N => {
    const a: N = { src: PNG, width: int(r, 40, 200), height: int(r, 30, 120),
      wrap: 'topBottom', wrapAlign: side };
    if (maybe(r, 0.3)) a.wrapOffsetY = 1.5;
    return { type: 'image', attrs: a };
  };
  const flip = maybe(r, 0.5);
  return { type: 'paragraph', content: [img(flip ? 'right' : 'left'), img(flip ? 'left' : 'right')] };
}

// Adjacent equal-attr sections merge on export (a columnsFlow page split looks the
// same), so genDoc keeps columns blocks apart like same-type lists.
function columnsBlock(r: Rng): N {
  const attrs: N = { count: int(r, 2, 3), gapCm: pick(r, [0.5, 1]) };
  const kids = Array.from({ length: int(r, 1, 3) }, () => {
    const roll = r();
    if (roll < 0.15) return { type: 'heading', attrs: { level: int(r, 1, 8) }, content: runs(r, true) };
    if (roll < 0.3) return list(r, pick(r, ['bulletList', 'orderedList']), 0);
    return paragraph(r); // top=false: breaks, flow flags and tab stops are top-level-only
  });
  return { type: 'columns', attrs, content: kids };
}

function list(r: Rng, kind: 'bulletList' | 'orderedList', depth: number): N {
  const items = Array.from({ length: int(r, 1, 3) }, () => {
    const kids: N[] = [paragraph(r, false)];
    if (depth < 2 && maybe(r, 0.25)) kids.push(list(r, pick(r, ['bulletList', 'orderedList']), depth + 1));
    return { type: 'listItem', content: kids };
  });
  // start only at the top level: applyListStartValues writes text:start-value for
  // top-level lists only, a nested list's start does not round-trip.
  const attrs: N = {};
  if (kind === 'orderedList' && depth === 0 && maybe(r, 0.2)) attrs.start = 3;
  // Nested lists get only upper-* types: those are never the depth default, which the
  // importers suppress to null (defaultOrderedTypeAt yields lower/decimal forms only).
  if (kind === 'orderedList' && maybe(r, 0.25)) {
    attrs.listStyleType = depth === 0
      ? pick(r, ['lower-alpha', 'upper-roman', 'lower-alpha-paren'])
      : pick(r, ['upper-roman', 'upper-alpha-paren']);
  }
  // Never a depth-default bullet (•/◦/▪), which the importers suppress to null.
  if (kind === 'bulletList' && maybe(r, 0.2)) attrs.bulletChar = pick(r, ['❖', '✓', '➢']);
  return { type: kind, ...(Object.keys(attrs).length ? { attrs } : {}), content: items };
}

// A tiny valid PNG; only its bytes matter for the round-trip (no image decoding).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// A styled table as the editor authors it: name + look on the table, the style's fill
// and borders materialized onto the cells (paintTable). `region` stays off — the app
// re-derives it from the registry on load, and its baked region text is not clean yet.
const TABLE_STYLE_PICK = ['Simple Grid', 'Simple List Shaded', 'Plain Table',
  'Box List Blue', 'Grid Table Accent', 'Academic'] as const;

function styledTable(r: Rng, name: string, cols: number, nRows: number): N {
  const style = builtinTableStyles()[name];
  const look = { ...DEFAULT_TABLE_LOOK, ...(style.look ?? {}) };
  if (maybe(r, 0.3)) look[pick(r, TABLE_REGIONS)] = maybe(r, 0.5);
  const rows = Array.from({ length: nRows }, (_, ri) => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, (_, ci) => {
      const paint = resolveTableCell(style, { row: ri, col: ci, rows: nRows, cols }, look);
      const attrs: N = { colspan: 1, rowspan: 1, colwidth: null };
      if (paint.fill) attrs.backgroundColor = paint.fill;
      for (const [k, v] of Object.entries(paint.borders)) if (v !== null) attrs[k] = v;
      // heading-safe runs: a #F2F2F2 header cell reads bold as presentational
      return { type: 'tableCell', attrs, content: [{ type: 'paragraph', content: runs(r, true) }] };
    }),
  }));
  return { type: 'table', attrs: { tableStyle: name, tableLook: tableLookAttr(look) }, content: rows };
}

function table(r: Rng): N {
  const cols = int(r, 1, 3);
  const nRows = int(r, 1, 3);
  if (maybe(r, 0.18)) return styledTable(r, pick(r, TABLE_STYLE_PICK), cols, nRows);
  // vertical merge: cell (0,0) spans rows 0-1, so row 1 starts one cell short.
  // cols >= 2 keeps row 1 non-empty — a row of only covered cells is not a document
  // the editor can author (the importer clamps such a file's spans instead).
  const vMerge = cols >= 2 && nRows >= 2 && maybe(r, 0.15);
  const rows = Array.from({ length: nRows }, (_, ri) => {
    // one two-column merge per row at most (never beside the vertical merge),
    // so the grid stays consistent
    const merge = cols >= 2 && maybe(r, 0.15) && !(vMerge && ri <= 1);
    const skip = vMerge && ri === 1 ? 1 : 0;
    const cells = Array.from({ length: (merge ? cols - 1 : cols) - skip }, (_, i) => {
      const attrs: N = { colspan: merge && i === 0 ? 2 : 1,
        rowspan: vMerge && ri === 0 && i === 0 ? 2 : 1, colwidth: null };
      // not #F2F2F2: that exact shade is HEADER_SHADE, whose bold is presentational
      if (maybe(r, 0.15)) attrs.backgroundColor = pick(r, ['#FFFF00', '#DDEEFF']);
      if (maybe(r, 0.1)) attrs.verticalAlign = pick(r, ['middle', 'bottom']);
      if (maybe(r, 0.1)) attrs.borderBottom = pick(r, ['2pt solid #FF0000', 'none']);
      if (maybe(r, 0.06)) attrs.borderTop = '0.5pt solid #000080';
      // never the table's first cell: ODF has no table-level cell margin, so the
      // importer reads the first cell's padding as the table's
      if ((ri > 0 || i > 0) && maybe(r, 0.06)) attrs.cellPadding = [0, 0.5, 0, 0.5];
      // the DOCX leg swaps the first paragraph for the field and caches its flat
      // text, so a formula cell holds one plain run that reads as a number
      if (maybe(r, 0.06)) {
        attrs.formula = pick(r, ['SUM(A1:A2)', 'A1*2', '2+3']);
        if (maybe(r, 0.4)) attrs.cellFormat = pick(r, ['int', 'dec2', 'percent']);
        return { type: 'tableCell', attrs,
          content: [{ type: 'paragraph', content: [{ type: 'text', text: String(int(r, 1, 99)) }] }] };
      }
      return { type: 'tableCell', attrs, content: [paragraph(r)] };
    });
    const rowAttrs: N | null = maybe(r, 0.1) ? { rowHeight: pick(r, [40, 64]) } : null;
    return { type: 'tableRow', ...(rowAttrs ? { attrs: rowAttrs } : {}), content: cells };
  });
  const attrs: N = {};
  if (maybe(r, 0.12)) attrs.marginLeft = pick(r, [1.5, 2.25]);
  if (maybe(r, 0.12)) attrs.marginRight = 1.5;
  if (maybe(r, 0.1)) attrs.cellPadding = [0.1, 0.3, 0.1, 0.3];
  return { type: 'table', ...(Object.keys(attrs).length ? { attrs } : {}), content: rows };
}

// Roman labels for endnotes match the importer's default numbering.
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v'] as const;

export function genDoc(r: Rng): N {
  bmNames = [];
  commentSeq = 0;
  revSeq = 0;
  seqCounters = {};
  bibIndex = false;
  const blocks: N[] = [];
  const notes: N[] = [];
  let prev = '';
  const noteRef = (kind: 'footnote' | 'endnote'): N => {
    const n = notes.filter(x => x.attrs.kind === kind).length + 1;
    const label = maybe(r, 0.15) ? '*' : null;
    const text = label ?? (kind === 'footnote' ? String(n) : ROMAN[n - 1]);
    const id = `${kind[0]}${n}`;
    notes.push({ type: 'note', attrs: { id, kind, label, text },
      content: [{ type: 'text', text: `Note body ${id}` }] });
    return { type: 'noteRef', attrs: { id, kind, text } };
  };
  for (let i = int(r, 1, 6); i > 0; i--) {
    const roll = r();
    let block: N;
    if (roll < 0.45) {
      // Title/Subtitle centre + size and Quotations' indent live in the style, and a
      // direct value equal to the style's own is suppressed on import — a styled
      // block carries heading-safe runs and no paragraph attrs of its own.
      block = maybe(r, 0.07)
        ? { type: 'paragraph', attrs: { styleName: pick(r, ['Title', 'Subtitle', 'Quotations', 'Caption']) },
            content: runs(r, true) }
        : paragraph(r, true, true);
      // not beside a lone display formula: company would cost it its own line (= display)
      if (block.content && block.content[0]?.type !== 'formula' && maybe(r, 0.15)) {
        // ahead of a trailing sunk frame: a topBottom image set below the paragraph
        // top sinks behind the text on import (sinkOffsetFrames)
        const c = block.content;
        const last = c[c.length - 1];
        const at = last?.type === 'image' && last.attrs?.wrap === 'topBottom'
          && last.attrs?.wrapOffsetY > 0 ? c.length - 1 : c.length;
        c.splice(at, 0, noteRef(pick(r, ['footnote', 'endnote'])));
      }
    }
    else if (roll < 0.55) block = { type: 'heading', attrs: { level: int(r, 1, 8) }, content: runs(r, true) };
    else if (roll < 0.72) block = list(r, pick(r, ['bulletList', 'orderedList']), 0);
    else if (roll < 0.77) block = textBox(r);
    else if (roll < 0.84) block = columnsBlock(r);
    else if (roll < 0.87) block = tocBlock(r);
    else if (roll < 0.9) block = framePair(r);
    else block = table(r);
    // adjacent same-type lists merge on import (and columns fragments on export);
    // keep them apart so identity holds
    if ((block.type.endsWith('List') || block.type === 'columns') && block.type === prev) {
      blocks.push({ type: 'paragraph' });
    }
    blocks.push(block);
    prev = block.type;
  }
  if (notes.length) blocks.push({ type: 'noteSection', content: notes });
  return { type: 'doc', content: blocks };
}
