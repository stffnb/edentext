// Round-trip verification: editor JSON -> buildOdt() -> importOdt() -> compare,
// plus a hand-crafted LibreOffice/Word-style .odt exercising the style resolver.
// jsdom (vitest `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { hfExtensions } from '../src/lib/editor/extensions/headerFooter';
import { HEADER_SHADE } from '../src/lib/editor/extensions/tableHeaderRow';

type N = any;

// `expect.soft` so every assertion in a leg reports rather than bailing on the first.
function check(label: string, cond: boolean, detail?: unknown) {
  expect.soft(cond, detail !== undefined ? `${label} — ${JSON.stringify(detail)}` : label).toBe(true);
}

// ---------- helpers to build editor-shaped JSON ----------
const T = (text: string, ...marks: N[]): N => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const P = (attrs: N | null, ...content: N[]): N => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
const H = (attrs: N, ...content: N[]): N => ({ type: 'heading', attrs, ...(content.length ? { content } : {}) });
const LI = (...content: N[]): N => ({ type: 'listItem', content });
const CELL = (colwidth: number[] | null, ...content: N[]): N =>
  ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth }, content });
const CELLM = (colspan: number, rowspan: number, colwidth: number[] | null, text: string, bg?: string): N =>
  ({ type: 'tableCell', attrs: { colspan, rowspan, colwidth, ...(bg ? { backgroundColor: bg } : {}) }, content: [P(null, T(text))] });
const ROW = (...cells: N[]): N => ({ type: 'tableRow', content: cells });

// A tiny valid PNG; only its bytes matter for the round-trip (no image decoding).
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMGN = (width: number, height: number, alt?: string, rotation?: number, wrap?: string): N =>
  ({ type: 'image', attrs: {
    src: PNG, width, height,
    ...(alt ? { alt } : {}), ...(rotation ? { rotation } : {}), ...(wrap ? { wrap } : {}),
  } });

const margins = { top: 3, bottom: 2, left: 2.5, right: 1.5 };

const fixture: N = {
  type: 'doc',
  content: [
    H({ level: 1, textAlign: 'center' }, T('Invoice Report 2026')),
    P(null,
      T('Plain '),
      T('bold', { type: 'bold' }),
      T(' italic', { type: 'italic' }),
      T(' under', { type: 'underline' }),
      T(' struck', { type: 'strike' }),
      T(' sup', { type: 'superscript' }),
      T(' sub', { type: 'subscript' }),
    ),
    P(null,
      T('arial 14 ', { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '14pt' } }),
      T('red', { type: 'textStyle', attrs: { color: '#C00000' } }),
      T(' marked', { type: 'highlight', attrs: { color: '#FFFF00' } }),
    ),
    // Links: native run path, plus a bold link inside a styled (CUST_P) paragraph.
    P(null, T('Visit '), T('our site', { type: 'link', attrs: { href: 'https://example.com/' } }), T(' today.')),
    P({ lineHeight: '1.5' },
      T('A '),
      T('bold link', { type: 'bold' }, { type: 'link', attrs: { href: 'https://styled.example/' } }),
      T(' here.'),
    ),
    P({ textAlign: 'justify', lineHeight: '1.5', spaceBefore: 12, spaceAfter: 18 }, T('spaced and justified paragraph')),
    P({ indent: 2.5 }, T('indented paragraph')),
    P(null, T('first line'), { type: 'hardBreak' }, T('second line')),
    P(null, T('before\ttab\tafter')),
    P(null, T('logo: '), IMGN(100, 50, 'Logo')),
    P(null, T('rotated: '), IMGN(120, 80, 'Rotated', 30)),
    P(null, T('wrapped left '), IMGN(90, 60, 'Float', 0, 'left'), T(' text flows beside it')),
    P(null, T('top/bottom '), IMGN(70, 50, 'Banner', 0, 'topBottom')),
    { type: 'bulletList', content: [
      LI(P(null, T('bullet one'))),
      LI(P(null, T('bullet two')), { type: 'orderedList', attrs: { listStyleType: 'upper-roman-paren' }, content: [
        LI(P(null, T('nested i'))),
        LI(P(null, T('nested ii'))),
      ] }),
    ] },
    { type: 'orderedList', attrs: { listStyleType: 'lower-alpha' }, content: [
      LI(P({ textAlign: 'center' }, T('centered item'))),
      LI(P(null, T('plain item'))),
    ] },
    { type: 'bulletList', attrs: { indent: 2.5 }, content: [
      LI(P(null, T('shifted bullet a'))),
      LI(P(null, T('shifted bullet b'))),
    ] },
    H({ level: 2 }, T('Un', { type: 'textStyle', attrs: { fontWeight: 'normal' } }), T('bolded')),
    { type: 'table', content: [
      { type: 'tableRow', attrs: { rowHeight: 60 }, content: [
        CELL([120],
          H({ level: 3 }, T('Cell head')),
          P(null, T('cell para')),
          { type: 'bulletList', content: [
            LI(P(null, T('cell bullet'))),
            LI(P(null, T('with nested')), { type: 'orderedList', attrs: { listStyleType: 'decimal-paren' }, content: [
              LI(P(null, T('cell nested 1'))),
            ] }),
          ] },
        ),
        CELL([240], P(null, IMGN(80, 40))),
      ] },
      { type: 'tableRow', content: [
        CELL([120], P(null, T('A2'))),
        CELL([240], P(null, T('B2 '), T('cell link', { type: 'link', attrs: { href: 'https://cell.example/' } }))),
      ] },
    ] },
    P({ breakBefore: 'page', textAlign: 'center', lineHeight: '1.5' }, T('Forced page (styled)')),
    P({ breakBefore: 'page' }, T('Forced page (plain)')),
    P(null, T('The end.')),
  ],
};

// ---------- normalization for comparison ----------
const ORDERED_DEFAULTS: Record<string, unknown> = {
  textAlign: 'left', lineHeight: null, spaceBefore: null, spaceAfter: null,
  listStyleType: 'decimal', start: 1, rowHeight: null, colspan: 1, rowspan: 1,
  type: null, level: undefined, rotation: 0, wrap: 'inline',
};

function normalize(node: N): N {
  const out: N = { type: node.type };
  if (node.text != null) out.text = node.text;
  if (node.marks?.length) {
    out.marks = node.marks
      .map((m: N) => {
        const mm: N = { type: m.type };
        const attrs = Object.fromEntries(Object.entries(m.attrs ?? {}).filter(([, v]) => v != null));
        if (Object.keys(attrs).length) mm.attrs = attrs;
        return mm;
      })
      .sort((a: N, b: N) => a.type.localeCompare(b.type));
  }
  const attrs: N = {};
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v == null) continue;
    if (k in ORDERED_DEFAULTS && ORDERED_DEFAULTS[k] === v) continue;
    if (k === 'colwidth') { attrs.colwidth = 'CW'; continue; } // ratios compared separately
    attrs[k] = v;
  }
  if (node.attrs?.level != null) attrs.level = node.attrs.level;
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (node.content?.length) {
    // merge adjacent identical text nodes so run-splitting differences don't matter
    const kids: N[] = [];
    for (const c of node.content.map(normalize)) {
      const prev = kids[kids.length - 1];
      if (prev && prev.type === 'text' && c.type === 'text' &&
          JSON.stringify(prev.marks ?? null) === JSON.stringify(c.marks ?? null)) {
        prev.text += c.text;
      } else kids.push(c);
    }
    out.content = kids;
  }
  return out;
}

function firstDiff(a: N, b: N, path = '$'): string | null {
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (typeof a !== 'object' || a === null || b === null) {
    return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

function collectColwidths(node: N, acc: number[][] = []): number[][] {
  if (Array.isArray(node.attrs?.colwidth)) acc.push(node.attrs.colwidth);
  for (const c of node.content ?? []) collectColwidths(c, acc);
  return acc;
}

function collectImages(node: N, acc: N[] = []): N[] {
  if (node.type === 'image') acc.push(node);
  for (const c of node.content ?? []) collectImages(c, acc);
  return acc;
}

describe('Leg 1: editor → buildOdt → importOdt', () => {
  it('round-trips the full fixture (margins, orientation, marks, images, lists, table)', async () => {
    const bytes = await buildOdt(fixture, margins, 'landscape');
    const res = importOdt(bytes);

    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    check('orientation round-trips', res.orientation === 'landscape', res.orientation);
    const m = res.margins!;
    check('margins round-trip', !!m && Math.abs(m.top - 3) < 0.02 && Math.abs(m.bottom - 2) < 0.02 &&
      Math.abs(m.left - 2.5) < 0.02 && Math.abs(m.right - 1.5) < 0.02, m);

    const diff = firstDiff(normalize(fixture), normalize(res.content));
    check('document JSON round-trips', diff === null, diff);

    // Images: src bytes (data-URI) and px size must round-trip exactly (body + cell).
    const logoPara = (res.content.content ?? []).find((n: N) => n.content?.some((c: N) => c.type === 'image'));
    const bodyImg = logoPara?.content?.find((c: N) => c.type === 'image');
    check('image src round-trips (data-URI bytes)', bodyImg?.attrs?.src === PNG, bodyImg?.attrs?.src?.slice(0, 40));
    check('image size round-trips (100×50 px)', bodyImg?.attrs?.width === 100 && bodyImg?.attrs?.height === 50, bodyImg?.attrs);
    check('image alt round-trips', bodyImg?.attrs?.alt === 'Logo', bodyImg?.attrs);
    const cellImg = collectImages(res.content).find((i: N) => i.attrs?.width === 80);
    check('image in table cell round-trips (80×40 px)', cellImg?.attrs?.height === 40 && cellImg?.attrs?.src === PNG, cellImg?.attrs);
    const rotImg = collectImages(res.content).find((i: N) => i.attrs?.rotation);
    check('image rotation round-trips (30°, 120×80)', rotImg?.attrs?.rotation === 30 && rotImg?.attrs?.width === 120 && rotImg?.attrs?.height === 80, rotImg?.attrs);
    const wrapImg = collectImages(res.content).find((i: N) => i.attrs?.wrap === 'left');
    check('image wrap=left round-trips', wrapImg?.attrs?.width === 90 && wrapImg?.attrs?.height === 60, wrapImg?.attrs);
    const tbImg = collectImages(res.content).find((i: N) => i.attrs?.wrap === 'topBottom');
    check('image wrap=topBottom round-trips', !!tbImg, tbImg?.attrs);

    // Hyperlinks: collect every link mark's href from the imported doc (body + cell).
    const links: string[] = [];
    (function walkLinks(n: N) {
      for (const m of n.marks ?? []) if (m.type === 'link' && m.attrs?.href) links.push(m.attrs.href);
      for (const c of n.content ?? []) walkLinks(c);
    })(res.content);
    check('native-path link round-trips', links.includes('https://example.com/'), links);
    check('styled-path (CUST_P) bold link round-trips', links.includes('https://styled.example/'), links);
    check('table-cell link round-trips', links.includes('https://cell.example/'), links);

    const indented = (res.content.content ?? []).find((n: N) => n.content?.[0]?.text === 'indented paragraph');
    check('indent → fo:margin-left round-trips (2.5cm)',
      indented?.attrs?.indent != null && Math.abs(indented.attrs.indent - 2.5) < 0.02, indented?.attrs);

    const shiftedList = (res.content.content ?? []).find(
      (n: N) => n.type === 'bulletList' && n.content?.[0]?.content?.[0]?.content?.[0]?.text === 'shifted bullet a');
    check('whole-list indent round-trips (2.5cm)',
      shiftedList?.attrs?.indent != null && Math.abs(shiftedList.attrs.indent - 2.5) < 0.02, shiftedList?.attrs);

    const cwIn = collectColwidths(fixture);
    const cwOut = collectColwidths(res.content);
    check('colwidth count matches', cwIn.length === cwOut.length, { in: cwIn.length, out: cwOut.length });
    // per-cell weights are slices of one column set: compare cell-width fractions
    const fracIn = cwIn.flat().map((w, _, all) => w / all.reduce((a, b) => a + b, 0));
    const fracOut = cwOut.flat().map((w, _, all) => w / all.reduce((a, b) => a + b, 0));
    check('column ratios round-trip', fracIn.length === fracOut.length &&
      fracIn.every((f, i) => Math.abs(f - fracOut[i]) < 0.02), { fracIn, fracOut });
  });
});

describe('Leg 1b: merged table cells (colspan/rowspan)', () => {
  // 3×3 grid: A spans 2 cols (row 0); C spans 2 rows (col 0, rows 1–2).
  //   row0: [A A][B]    row1: [C][D][E]    row2: [C][F][G]
  const mergedDoc: N = {
    type: 'doc',
    content: [
      P(null, T('Merged cells:')),
      { type: 'table', content: [
        ROW(CELLM(2, 1, [100, 100], 'A', '#FFFF00'), CELLM(1, 1, [100], 'B')),
        ROW(CELLM(1, 2, [100], 'C'), CELLM(1, 1, [100], 'D'), CELLM(1, 1, [100], 'E')),
        ROW(CELLM(1, 1, [100], 'F'), CELLM(1, 1, [100], 'G')),
      ] },
    ],
  };

  it('exports spans + covered cells and re-imports them', async () => {
    const bytes = await buildOdt(mergedDoc, margins, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    check('content.xml emits number-columns-spanned=2', content.includes('table:number-columns-spanned="2"'));
    check('content.xml emits number-rows-spanned=2', content.includes('table:number-rows-spanned="2"'));
    check('content.xml emits a covered-table-cell', content.includes('<table:covered-table-cell'));
    check('content.xml emits cell shading (fo:background-color)', content.includes('fo:background-color="#FFFF00"'), content.match(/fo:background-color="[^"]*"/g));

    const res = importOdt(bytes);
    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    const table = (res.content.content ?? []).find((n: N) => n.type === 'table');
    const rows = table?.content ?? [];
    check('row 0 has 2 cells', rows[0]?.content?.length === 2, rows[0]?.content?.length);
    check('row 1 has 3 cells', rows[1]?.content?.length === 3, rows[1]?.content?.length);
    check('row 2 has 2 cells (covered slot skipped)', rows[2]?.content?.length === 2, rows[2]?.content?.length);
    check('A has colspan 2', rows[0]?.content?.[0]?.attrs?.colspan === 2, rows[0]?.content?.[0]?.attrs);
    check('C has rowspan 2', rows[1]?.content?.[0]?.attrs?.rowspan === 2, rows[1]?.content?.[0]?.attrs);
    check('A shading round-trips (#FFFF00)', rows[0]?.content?.[0]?.attrs?.backgroundColor === '#FFFF00', rows[0]?.content?.[0]?.attrs?.backgroundColor);
    check('B has no shading', rows[0]?.content?.[1]?.attrs?.backgroundColor == null, rows[0]?.content?.[1]?.attrs?.backgroundColor);

    const textOf = (cell: N) => cell?.content?.[0]?.content?.[0]?.text;
    check('A text preserved', textOf(rows[0]?.content?.[0]) === 'A', textOf(rows[0]?.content?.[0]));
    check('F at col 1 of row 2', textOf(rows[2]?.content?.[0]) === 'F', textOf(rows[2]?.content?.[0]));
    check('G at col 2 of row 2', textOf(rows[2]?.content?.[1]) === 'G', textOf(rows[2]?.content?.[1]));
  });
});

describe('Leg 1c: header-row cells (bold-by-default, editable)', () => {
  // Header-shaded cells render bold via CSS; bold is editable via fontWeight:normal.
  // Round-trip: a default-bold run carries no mark (CSS bolds), an un-bolded run keeps
  // fontWeight:normal, and export bakes bold so Word/LibreOffice match.
  const hcell = (...content: N[]): N =>
    ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [100], backgroundColor: HEADER_SHADE }, content: [P(null, ...content)] });
  const FW_NORMAL = { type: 'textStyle', attrs: { fontWeight: 'normal' } };

  const doc: N = { type: 'doc', content: [
    { type: 'table', content: [
      ROW(hcell(T('Bold')), hcell(T('Plain', FW_NORMAL))),
      ROW(CELLM(1, 1, [100], 'x'), CELLM(1, 1, [100], 'y')),
    ] },
  ] };

  it('bakes header bold on export and round-trips an un-bolded run', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('export bakes bold on the default-bold header run', /fo:font-weight="bold"/.test(xml), xml.match(/fo:font-weight="[^"]*"/g));
    check('export emits the un-bold override', /fo:font-weight="normal"/.test(xml));

    const res = importOdt(bytes);
    const table = (res.content.content ?? []).find((n: N) => n.type === 'table');
    const row0 = table?.content?.[0]?.content ?? [];
    const marksOf = (cell: N) => cell?.content?.[0]?.content?.[0]?.marks ?? [];
    // Both cells keep the header fill.
    check('header cells keep the fill', row0[0]?.attrs?.backgroundColor === HEADER_SHADE && row0[1]?.attrs?.backgroundColor === HEADER_SHADE, row0.map((c: N) => c?.attrs?.backgroundColor));
    // Default-bold run carries no mark (CSS provides bold).
    check('default-bold run has no bold mark', !marksOf(row0[0]).some((m: N) => m.type === 'bold'), marksOf(row0[0]));
    // Un-bolded run keeps fontWeight:normal.
    const fw = marksOf(row0[1]).find((m: N) => m.type === 'textStyle')?.attrs?.fontWeight;
    check('un-bolded run keeps fontWeight:normal', fw === 'normal', marksOf(row0[1]));
  });
});

describe('Leg 2: foreign (LibreOffice/Word-style) .odt → importOdt', () => {
  it('resolves named/automatic styles, repeated cells, lists, and reports degradations', () => {
    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
 <office:font-face-decls>
  <style:font-face style:name="F1" svg:font-family="'Courier New', monospace"/>
 </office:font-face-decls>
 <office:styles>
  <style:default-style style:family="paragraph">
   <style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"/>
  </style:default-style>
  <style:style style:name="Standard" style:family="paragraph"/>
  <style:style style:name="Mono" style:family="paragraph" style:parent-style-name="Standard">
   <style:text-properties style:font-name="F1" fo:font-size="10pt"/>
  </style:style>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="pm1">
   <style:page-layout-properties fo:page-width="21.59cm" fo:page-height="27.94cm" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1in" fo:margin-right="1in"/>
  </style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
 </office:master-styles>
</office:document-styles>`;

    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
 <office:automatic-styles>
  <style:style style:name="P1" style:family="paragraph" style:parent-style-name="Standard">
   <style:paragraph-properties fo:text-align="end" fo:margin-top="0.25in" fo:line-height="200%"/>
  </style:style>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="700"/></style:style>
  <style:style style:name="T2" style:family="text"><style:text-properties fo:color="#ff0000" fo:background-color="#ffff00"/></style:style>
  <text:list-style style:name="L1">
   <text:list-level-style-number text:level="1" style:num-format="i" style:num-suffix=")"/>
   <text:list-level-style-bullet text:level="2" text:bullet-char="•"/>
  </text:list-style>
  <style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="5cm"/></style:style>
  <style:style style:name="co2" style:family="table-column"><style:table-column-properties style:column-width="10cm"/></style:style>
  <style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:min-row-height="2cm"/></style:style>
 </office:automatic-styles>
 <office:body><office:text>
  <text:p>plain default text</text:p>
  <text:p text:style-name="P1"><text:span text:style-name="T1">bold700</text:span> gap<text:s text:c="3"/>tab<text:tab/>end</text:p>
  <text:p><text:span text:style-name="T2">colored</text:span><text:line-break/><text:a xlink:href="https://x.example">a link</text:a></text:p>
  <text:p text:style-name="Mono">mono text</text:p>
  <text:p>img:<draw:frame><draw:image xlink:href="Pictures/x.png"/></draw:frame><text:note text:note-class="footnote" text:id="ftn1"><text:note-citation>1</text:note-citation><text:note-body><text:p>note body</text:p></text:note-body></text:note></text:p>
  <text:list text:style-name="L1">
   <text:list-item text:start-value="3"><text:p>roman three</text:p>
    <text:list><text:list-item><text:p>sub bullet</text:p></text:list-item></text:list>
   </text:list-item>
  </text:list>
  <table:table>
   <table:table-column table:style-name="co1"/>
   <table:table-column table:style-name="co2" table:number-columns-repeated="2"/>
   <table:table-header-rows>
    <table:table-row><table:table-cell><text:p>h1</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"><text:p>hx</text:p></table:table-cell></table:table-row>
   </table:table-header-rows>
   <table:table-row table:style-name="ro1">
    <table:table-cell table:number-columns-spanned="2"><text:p>spanned</text:p></table:table-cell>
    <table:covered-table-cell/>
    <table:table-cell><text:p>c3</text:p></table:table-cell>
   </table:table-row>
  </table:table>
 </office:text></office:body>
</office:document-content>`;

    // Real picture bytes so the embedded <draw:image> resolves on import.
    const pngBytes = Uint8Array.from(atob(PNG.split(',')[1]), c => c.charCodeAt(0));
    const foreign = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': [strToU8(contentXml), { level: 6 }],
      'styles.xml': [strToU8(stylesXml), { level: 6 }],
      'Pictures/x.png': [pngBytes, { level: 6 }],
    } as any);

    const f = importOdt(foreign);
    const c = f.content.content!;

    check('foreign: margins 1in → 2.54cm', Math.abs(f.margins!.top - 2.54) < 0.01, f.margins);
    check('foreign: Letter stays portrait', f.orientation === 'portrait');

    check('foreign: plain run has no marks', c[0].content![0].marks === undefined, c[0]);
    // Omitted fo:margin-bottom → ODF default 0, not the editor's 6pt body default.
    check('foreign: omitted margin → spaceAfter 0', c[0].attrs?.spaceAfter === 0, c[0].attrs);

    const p1 = c[1];
    check('foreign: P1 align end → right', p1.attrs?.textAlign === 'right', p1.attrs);
    check('foreign: P1 0.25in → spaceBefore 18', p1.attrs?.spaceBefore === 18, p1.attrs);
    check('foreign: P1 200% → lineHeight 2', p1.attrs?.lineHeight === '2', p1.attrs);
    check('foreign: weight 700 → bold mark', p1.content![0].marks?.some((m: N) => m.type === 'bold'), p1.content![0]);
    check('foreign: text:s ×3 + tab expanded', p1.content!.map((n: N) => n.text).join('') === 'bold700 gap   tab\tend', p1.content);

    const p2 = c[2];
    check('foreign: lowercase color → #FF0000', p2.content![0].marks?.some((m: N) => m.type === 'textStyle' && m.attrs?.color === '#FF0000'), p2.content![0]);
    check('foreign: highlight #FFFF00', p2.content![0].marks?.some((m: N) => m.type === 'highlight' && m.attrs?.color === '#FFFF00'), p2.content![0]);
    check('foreign: line-break → hardBreak', p2.content!.some((n: N) => n.type === 'hardBreak'));
    check('foreign: text:a → link mark (href preserved)',
      p2.content!.some((n: N) => n.text === 'a link' && n.marks?.some((m: N) => m.type === 'link' && m.attrs?.href === 'https://x.example')), p2.content);

    const mono = c[3];
    check('foreign: font-face resolves Courier New', mono.content![0].marks?.some((m: N) => m.type === 'textStyle' && m.attrs?.fontFamily === 'Courier New' && m.attrs?.fontSize === '10pt'), mono.content![0]);

    check('foreign: image imported, footnote dropped, text kept',
      c[4].content!.length === 2 && c[4].content![0].text === 'img:' &&
      c[4].content![1].type === 'image' && c[4].content![1].attrs?.src?.startsWith('data:image/png;base64,'), c[4]);

    const list = c[5];
    check('foreign: list → lower-roman-paren, start 3', list.type === 'orderedList' && list.attrs?.listStyleType === 'lower-roman-paren' && list.attrs?.start === 3, list.attrs);
    check('foreign: level-2 def → nested bulletList', list.content![0].content![1]?.type === 'bulletList', list.content![0]);

    const table = c[6];
    check('foreign: table present', table.type === 'table');
    const [hdr, row] = table.content!;
    check('foreign: header row → tableHeader ×3', hdr.content!.length === 3 && hdr.content!.every((cell: N) => cell.type === 'tableHeader'), hdr.content!.map((x: N) => x.type));
    check('foreign: repeated cell expanded', hdr.content![1].content![0].content![0].text === 'hx' && hdr.content![2].content![0].content![0].text === 'hx');
    check('foreign: colspan 2 + covered skipped', row.content!.length === 2 && row.content![0].attrs?.colspan === 2, row.content!.map((x: N) => x.attrs));
    check('foreign: col weights 5/10/10cm', JSON.stringify(hdr.content!.map((x: N) => x.attrs.colwidth)) === JSON.stringify([[500], [1000], [1000]]), hdr.content!.map((x: N) => x.attrs.colwidth));
    check('foreign: spanned cell colwidth [500,1000]', JSON.stringify(row.content![0].attrs?.colwidth) === JSON.stringify([500, 1000]), row.content![0].attrs);
    check('foreign: min-row-height 2cm → 76px', row.attrs?.rowHeight === 76, row.attrs);

    const expectWarn = ['Footnotes and endnotes were removed'];
    check('foreign: warnings reported', expectWarn.every(w => f.warnings.includes(w)), f.warnings);
    check('foreign: no hyperlink warning (now round-tripped)', !f.warnings.includes('Hyperlinks were converted to plain text'), f.warnings);
  });
});

describe('Leg 3: header/footer → buildOdt → importOdt', () => {
  it('round-trips header/footer content, fields, and the Word-style geometry mapping', async () => {
    const header: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [
      { type: 'text', text: 'Bericht ', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#C00000' } }] },
      { type: 'text', text: '2026' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Zweite Zeile' },
    ] }] };
    const footer: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
      { type: 'text', text: 'Seite ' },
      { type: 'pageNumber' },
      { type: 'text', text: ' von ' },
      { type: 'pageCount' },
    ] }] };
    // Non-default edge distances (header 0.8cm from top, footer 1.6cm from bottom).
    const hfDist = { headerDistanceCm: 0.8, footerDistanceCm: 1.6 };
    const hfBytes = await buildOdt(fixture, margins, 'landscape', { header, footer, pageCount: 9, ...hfDist });
    const hfRes = importOdt(hfBytes);

    check('hf: no warnings', hfRes.warnings.length === 0, hfRes.warnings);
    check('hf: header round-trips', firstDiff(normalize(header), normalize(hfRes.header)) === null,
      firstDiff(normalize(header), normalize(hfRes.header)));
    check('hf: footer round-trips', firstDiff(normalize(footer), normalize(hfRes.footer)) === null,
      firstDiff(normalize(footer), normalize(hfRes.footer)));
    // The body margins survive the Word-style header/footer geometry mapping.
    const hm = hfRes.margins!;
    check('hf: body margins preserved through geometry mapping',
      !!hm && Math.abs(hm.top - 3) < 0.05 && Math.abs(hm.bottom - 2) < 0.05 &&
      Math.abs(hm.left - 2.5) < 0.02 && Math.abs(hm.right - 1.5) < 0.02, hm);
    // The configured edge distances round-trip (they become the ODF page margin).
    check('hf: header distance round-trips (0.8cm)', Math.abs((hfRes.headerDistanceCm ?? 0) - 0.8) < 0.02, hfRes.headerDistanceCm);
    check('hf: footer distance round-trips (1.6cm)', Math.abs((hfRes.footerDistanceCm ?? 0) - 1.6) < 0.02, hfRes.footerDistanceCm);
    check('hf: body still round-trips alongside header/footer',
      firstDiff(normalize(fixture), normalize(hfRes.content)) === null);

    // Imported header/footer must be valid in the header/footer editor schema.
    const hfSchema = getSchema(hfExtensions());
    let hfSchemaOk = true;
    for (const z of [hfRes.header, hfRes.footer]) {
      if (!z) continue;
      try { PMNode.fromJSON(hfSchema, z).check(); } catch { hfSchemaOk = false; }
    }
    check('hf: header/footer valid in hf schema', hfSchemaOk);

    // Empty zones must not be exported (no master-page header/footer).
    const emptyHf = await buildOdt(fixture, margins, 'portrait', { header: null, footer: null, pageCount: 1 });
    const emptyRes = importOdt(emptyHf);
    check('hf: empty zones not exported', emptyRes.header === null && emptyRes.footer === null);
  });
});

describe('Leg 4: foreign header/footer → importOdt', () => {
  it('parses page-number/count fields, reconstructs body margins, warns on per-page variants', () => {
    const fStyles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
 <office:styles>
  <style:default-style style:family="paragraph"><style:text-properties fo:font-size="12pt"/></style:default-style>
  <style:style style:name="Standard" style:family="paragraph"/>
  <style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style>
  <style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Standard"/>
 </office:styles>
 <office:automatic-styles>
  <style:page-layout style:name="pm1">
   <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="1.5cm" fo:margin-bottom="1.5cm" fo:margin-left="2cm" fo:margin-right="2cm"/>
   <style:header-style><style:header-footer-properties svg:height="0.8cm" fo:margin-bottom="0.3cm"/></style:header-style>
   <style:footer-style><style:header-footer-properties svg:height="0.6cm" fo:margin-top="0.3cm"/></style:footer-style>
  </style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Standard" style:page-layout-name="pm1">
   <style:header><text:p text:style-name="Header"><text:span text:style-name="X">Doc</text:span> — Page <text:page-number text:select-page="current">1</text:page-number> of <text:page-count>5</text:page-count></text:p></style:header>
   <style:header-first><text:p text:style-name="Header">Cover</text:p></style:header-first>
   <style:footer><text:p text:style-name="Footer">Confidential</text:p></style:footer>
  </style:master-page>
 </office:master-styles>
</office:document-styles>`;
    const fContent = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:text><text:p>Body</text:p></office:text></office:body></office:document-content>`;
    const foreignHf = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': [strToU8(fContent), { level: 6 }],
      'styles.xml': [strToU8(fStyles), { level: 6 }],
    } as any);
    const fhf = importOdt(foreignHf);

    check('foreign hf: header parsed with center align', fhf.header?.content?.[0]?.attrs?.textAlign === 'center', fhf.header);
    const hPara = fhf.header?.content?.[0];
    check('foreign hf: page-number field', hPara?.content?.some((n: N) => n.type === 'pageNumber'), hPara);
    check('foreign hf: page-count field', hPara?.content?.some((n: N) => n.type === 'pageCount'), hPara);
    check('foreign hf: footer text', fhf.footer?.content?.[0]?.content?.[0]?.text === 'Confidential', fhf.footer);
    // Body top margin = page margin (1.5) + header height (0.8) + spacing (0.3) = 2.6.
    check('foreign hf: body top margin reconstructed', Math.abs((fhf.margins?.top ?? 0) - 2.6) < 0.02, fhf.margins);
    check('foreign hf: body bottom margin reconstructed', Math.abs((fhf.margins?.bottom ?? 0) - 2.4) < 0.02, fhf.margins);
    check('foreign hf: first-page variant warning',
      fhf.warnings.some(w => /per-page/i.test(w)), fhf.warnings);
  });
});

describe('Leg 5: table of contents (text:table-of-content)', () => {
  const tocDoc: N = {
    type: 'doc',
    content: [
      { type: 'tableOfContents', attrs: { entries: [
        { text: 'Introduction', level: 1, page: 1 },
        { text: 'Background & Aims', level: 2, page: 2 },
        { text: 'Deep Dive', level: 3, page: 3 },
      ] } },
      H({ level: 1 }, T('Introduction')),
      P(null, T('intro text')),
      H({ level: 2 }, T('Background & Aims')),
      H({ level: 3 }, T('Deep Dive')),
    ],
  };

  it('exports a real <text:table-of-content> and re-imports it as a tableOfContents node', async () => {
    const bytes = await buildOdt(tocDoc, margins, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    check('emits <text:table-of-content>', content.includes('<text:table-of-content '), content.slice(0, 200));
    check('source spans outline-level 3', content.includes('text:outline-level="3"'));
    check('mints Contents_20_1 style', content.includes('style:name="Contents_20_1"'));
    check('cached entry carries a tab + page', /Contents_20_1">Introduction<text:tab\/>1<\/text:p>/.test(content));
    check('ampersand in entry text is escaped', content.includes('Background &amp; Aims'));
    check('no leftover sentinel', !content.includes(''));

    const res = importOdt(bytes);
    const blocks = res.content.content ?? [];
    const toc = blocks.find((n: N) => n.type === 'tableOfContents');
    check('imports a tableOfContents node', !!toc, blocks.map((n: N) => n.type));
    const entries = toc?.attrs?.entries ?? [];
    check('3 entries parsed', entries.length === 3, entries);
    check('entry 1 text/level', entries[0]?.text === 'Introduction' && entries[0]?.level === 1, entries[0]);
    check('entry 2 text/level (ampersand)', entries[1]?.text === 'Background & Aims' && entries[1]?.level === 2, entries[1]);
    check('entry 3 level 3', entries[2]?.level === 3, entries[2]);
    check('headings after the TOC survive',
      blocks.some((n: N) => n.type === 'heading' && n.content?.[0]?.text === 'Introduction'));
  });
});
