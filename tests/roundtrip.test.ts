// Round-trip verification: editor JSON -> buildOdt() -> importOdt() -> compare,
// plus a hand-crafted LibreOffice/Word-style .odt exercising the style resolver.
// jsdom (vitest `environment`) supplies the global DOMParser.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { buildOdt, MAX_HEADING_LEVEL } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { hfExtensions } from '../src/lib/editor/extensions/headerFooter';
import { HEADER_SHADE } from '../src/lib/editor/extensions/tableHeaderRow';
import { builtinStyleSheet } from '../src/lib/styles/styleSheet';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { EMPTY_HF_SET } from '../src/lib/storage/headerFooter';
import { DEFAULT_NOTE_SETTINGS } from '../src/lib/storage/noteSettings';

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
const IMGN = (width: number, height: number, alt?: string, rotation?: number, wrap?: string, wrapOffsetY?: number): N =>
  ({ type: 'image', attrs: {
    src: PNG, width, height,
    ...(alt ? { alt } : {}), ...(rotation ? { rotation } : {}), ...(wrap ? { wrap } : {}),
    ...(wrapOffsetY ? { wrapOffsetY } : {}),
  } });
const TBX = (attrs: N, ...content: N[]): N => ({ type: 'textBox', attrs, content });
const COLS = (attrs: N, ...content: N[]): N => ({ type: 'columns', attrs, content });

const margins = { top: 3, bottom: 2, left: 2.5, right: 1.5 };

const fixture: N = {
  type: 'doc',
  content: [
    H({ level: 1, textAlign: 'center' }, T('Invoice Report 2026')),
    P({ fontSize: '22pt' }),                       // empty sized line (bare)
    P({ fontSize: '18pt', textAlign: 'center' }),  // empty sized line + centered
    P(null,
      T('Plain '),
      T('bold', { type: 'bold' }),
      T(' italic', { type: 'italic' }),
      T(' under', { type: 'underline' }),
      T(' struck', { type: 'strike' }),
      T(' sup', { type: 'superscript' }),
      T(' sub', { type: 'subscript' }),
    ),
    // Character effects: letter case, line shapes, a freely raised run.
    P(null,
      T('caps ', { type: 'textStyle', attrs: { caps: 'uppercase' } }),
      T('petite ', { type: 'textStyle', attrs: { caps: 'smallCaps' } }),
      T('dotted ', { type: 'underline', attrs: { lineStyle: 'dotted', lineColor: '#FF0000' } }),
      T('twice ', { type: 'underline', attrs: { lineStyle: 'double' } }),
      T('crossed ', { type: 'strike', attrs: { lineStyle: 'double' } }),
      T('raised', { type: 'textStyle', attrs: { fontSize: '14pt', textPosition: 3 } }),
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
    P(null, T('wrapped left '), IMGN(90, 60, 'Float', 0, 'left', 2.5), T(' text flows beside it')),
    P(null, T('top/bottom '), IMGN(70, 50, 'Banner', 0, 'topBottom')),
    TBX({ width: 288, height: 96 }, P(null, T('box para one')), P(null, T('box '), T('bold', { type: 'bold' }))),
    TBX({ width: 192, height: 80, wrap: 'right', wrapOffset: 6, wrapOffsetY: 1.5, shapeKind: 'ellipse', fillColor: '#FFEE00', strokeColor: '#FF0000', strokeWidthPt: 2.25, rotation: 30 }, P(null, T('in ellipse'))),
    COLS({ count: 2, gapCm: 0.5 }, P(null, T('newspaper column text one')), P(null, T('newspaper column text two'))),
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
    // Depth-default numbering: attr-less nested levels export as a./i. and re-import
    // as null (cycle suppression).
    { type: 'orderedList', content: [
      LI(P(null, T('cycle one')), { type: 'orderedList', content: [
        LI(P(null, T('cycle sub')), { type: 'orderedList', content: [
          LI(P(null, T('cycle subsub'))),
        ] }),
      ] }),
    ] },
    // Re-anchoring: an explicit "a., b." parent makes its attr-less child default to
    // i. (not another a., b.), and the child re-imports as null (no accreted attr).
    { type: 'orderedList', attrs: { listStyleType: 'lower-alpha' }, content: [
      LI(P(null, T('reanchor a')), { type: 'orderedList', content: [
        LI(P(null, T('reanchor i'))),
      ] }),
    ] },
    // Suffix inheritance: an explicit "a)" parent makes attr-less children default to
    // i) then 1) (paren, not dot), all re-importing as null.
    { type: 'orderedList', attrs: { listStyleType: 'lower-alpha-paren' }, content: [
      LI(P(null, T('paren a')), { type: 'orderedList', content: [
        LI(P(null, T('paren i')), { type: 'orderedList', content: [
          LI(P(null, T('paren 1'))),
        ] }),
      ] }),
    ] },
    // Multilevel (1. / 1.1. / 1.1.1.): attr on the top list only; an explicit style
    // inside the chain breaks out (NL mint) and must survive as an explicit attr.
    { type: 'orderedList', attrs: { listStyleType: 'multilevel' }, content: [
      LI(P(null, T('ml one')), { type: 'orderedList', content: [
        LI(P(null, T('ml one-one')), { type: 'orderedList', content: [
          LI(P(null, T('ml deep'))),
        ] }),
        LI(P(null, T('ml one-two')), { type: 'orderedList', attrs: { listStyleType: 'upper-alpha' }, content: [
          LI(P(null, T('ml override'))),
        ] }),
      ] }),
      LI(P(null, T('ml two'))),
    ] },
    { type: 'bulletList', attrs: { indent: 2.5 }, content: [
      LI(P(null, T('shifted bullet a'))),
      LI(P(null, T('shifted bullet b'))),
    ] },
    // Custom bullet chars: ❖ at level 1; ✓ on the DFS-first nested list (drives the
    // L# level-2 char); a default nested sibling (must NL-mint back to ◦).
    { type: 'bulletList', attrs: { bulletChar: '❖' }, content: [
      LI(P(null, T('diamond one')), { type: 'bulletList', attrs: { bulletChar: '✓' }, content: [
        LI(P(null, T('check nested'))),
      ] }),
      LI(P(null, T('diamond two')), { type: 'bulletList', content: [
        LI(P(null, T('default nested'))),
      ] }),
    ] },
    H({ level: 2 }, T('Un', { type: 'textStyle', attrs: { fontWeight: 'normal' } }), T('bolded')),
    { type: 'table', content: [
      { type: 'tableRow', attrs: { rowHeight: 60 }, content: [
        CELL([120],
          H({ level: 3 }, T('Cell head')),
          P(null, T('cell para')),
          { type: 'bulletList', attrs: { bulletChar: '➢' }, content: [
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
  shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1,
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

    // Empty lines keep their paragraph font size (drives the empty line's height).
    const sized = (res.content.content ?? []).filter((n: N) => n.type === 'paragraph' && !n.content?.length && n.attrs?.fontSize);
    check('empty sized lines round-trip', sized.length === 2, sized.map((n: N) => n.attrs.fontSize));
    check('bare empty line keeps 22pt', sized.some((n: N) => n.attrs.fontSize === '22pt'), sized);

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
    check('image vertical anchor offset round-trips (svg:y)', wrapImg?.attrs?.wrapOffsetY === 2.5, wrapImg?.attrs);
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

describe('Leg 1a: page format', () => {
  it('round-trips a non-A4 format (legal)', async () => {
    const doc: N = { type: 'doc', content: [P(null, T('Legal page.'))] };
    const bytes = await buildOdt(doc, margins, 'portrait', undefined, null, 'legal');
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    check('styles.xml emits legal page height (35.56cm)', styles.includes('35.56cm'), styles.match(/fo:page-(width|height)="[^"]*"/g));

    const res = importOdt(bytes);
    check('format round-trips as legal', res.format === 'legal', res.format);
  });

  it('detects letter format', async () => {
    const doc: N = { type: 'doc', content: [P(null, T('US letter.'))] };
    const res = importOdt(await buildOdt(doc, margins, 'portrait', undefined, null, 'letter'));
    check('format round-trips as letter', res.format === 'letter', res.format);
  });

  it('round-trips a non-preset format via the styles.xml override (tabloid)', async () => {
    const doc: N = { type: 'doc', content: [P(null, T('Tabloid page.'))] };
    const bytes = await buildOdt(doc, margins, 'portrait', undefined, null, 'tabloid');
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    check('styles.xml emits tabloid width (27.94cm)', styles.includes('fo:page-width="27.94cm"'), styles.match(/fo:page-(width|height)="[^"]*"/g));
    check('styles.xml emits tabloid height (43.18cm)', styles.includes('fo:page-height="43.18cm"'));
    check('format round-trips as tabloid', importOdt(bytes).format === 'tabloid', importOdt(bytes).format);
  });

  it('round-trips executive (fractional cm) and landscape swap', async () => {
    const doc: N = { type: 'doc', content: [P(null, T('Executive landscape.'))] };
    const bytes = await buildOdt(doc, margins, 'landscape', undefined, null, 'executive');
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    check('landscape swaps executive width (26.67cm)', styles.includes('fo:page-width="26.67cm"'), styles.match(/fo:page-(width|height)="[^"]*"/g));
    const res = importOdt(bytes);
    check('format round-trips as executive', res.format === 'executive', res.format);
    check('orientation round-trips as landscape', res.orientation === 'landscape', res.orientation);
  });
});

describe('Leg 1a2: hardBreak font size (empty-line height)', () => {
  it('round-trips a break run font so a blank line between two breaks keeps its size', async () => {
    const fs36: N = { type: 'textStyle', attrs: { fontSize: '36pt' } };
    const br = (): N => ({ type: 'hardBreak', marks: [fs36] });
    const doc: N = { type: 'doc', content: [P(null, T('Muster', fs36), br(), br(), T('Arbeitsvertrag', fs36))] };
    const res = importOdt(await buildOdt(doc, margins, 'portrait'));
    const brs: N[] = [];
    (function walk(n: N) { if (n.type === 'hardBreak') brs.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    check('both hardBreaks survive', brs.length === 2, brs.length);
    const sized = brs.every((b) => b.marks?.some((m) => m.type === 'textStyle' && m.attrs?.fontSize === '36pt'));
    check('both hardBreaks carry the 36pt run font', sized, JSON.stringify(brs));
  });
});

describe('Leg 1a2b: formulas (embedded ODF formula objects)', () => {
  it('exports an inline and a display formula and re-imports both LaTeX sources', async () => {
    const F = (latex: string, display: boolean): N => ({ type: 'formula', attrs: { latex, display } });
    const inline = '\\phi _{ref}=\\frac{a+1}{2\\pi }';
    const block = '\\sum_{i=1}^{n} \\sqrt{x_{i}}';
    const doc: N = { type: 'doc', content: [
      P(null, T('Die Formel '), F(inline, false), T(' im Text.')),
      P(null, F(block, true)),
    ] };
    const bytes = await buildOdt(doc, margins, 'portrait');
    const files = unzipSync(bytes);
    const content = strFromU8(files['content.xml']);
    check('content.xml anchors both frames as-char', (content.match(/<draw:object xlink:href="\.\/Formula\d"/g) ?? []).length === 2, content.match(/<draw:frame[^>]*Formula[^>]*>/g));
    // A sized frame makes LibreOffice scale the object to fit instead of typesetting
    // it at its natural size.
    check('the frames carry no svg geometry', !/<draw:frame[^>]*Formula[^>]*svg:width/.test(content), content.match(/<draw:frame[^>]*Formula[^>]*>/g));
    // The formula object is its own ODF sub-document; without the manifest entries
    // LibreOffice ignores it.
    const manifest = strFromU8(files['META-INF/manifest.xml']);
    check('manifest declares both formula objects', /Formula1\/" manifest:media-type="application\/vnd\.oasis\.opendocument\.formula"/.test(manifest) && /Formula2\/content\.xml/.test(manifest), manifest.match(/Formula\d\/[^"]*/g));
    const obj = strFromU8(files['Formula1/content.xml']);
    check('the object holds MathML, not just the source', /<mfrac>/.test(obj) && /<msub>/.test(obj), obj.slice(0, 200));

    const res = importOdt(bytes);
    const found: N[] = [];
    (function walk(n: N) { if (n.type === 'formula') found.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    check('both formulas come back', found.length === 2, found.length);
    check('inline source is unchanged', found[0]?.attrs?.latex === inline, found[0]?.attrs?.latex);
    check('display source is unchanged', found[1]?.attrs?.latex === block, found[1]?.attrs?.latex);
    check('the display flag survives', found[0]?.attrs?.display === false && found[1]?.attrs?.display === true, found.map((f) => f.attrs?.display));
    check('surrounding text is untouched', JSON.stringify(res.content).includes('Die Formel '), null);
  });
});

describe('Leg 1a2c: footnotes and endnotes', () => {
  const REF = (id: string, kind: string, text: string): N =>
    ({ type: 'noteRef', attrs: { id, kind, text } });
  const notesDoc = (): N => ({ type: 'doc', content: [
    P(null, T('Body one'), REF('a', 'footnote', '1'), T(' and on.')),
    P(null, T('Body two'), REF('b', 'endnote', 'i'), T(' ends.')),
    { type: 'noteSection', content: [
      { type: 'note', attrs: { id: 'a', kind: 'footnote', label: null, text: '1' },
        content: [T('The footnote, with '), T('bold', { type: 'bold' }), T(' inside.')] },
      { type: 'note', attrs: { id: 'b', kind: 'endnote', label: null, text: 'i' },
        content: [T('The endnote.')] },
    ] },
  ] });

  it('writes text:note at the anchor and reads it back', async () => {
    const bytes = await buildOdt(notesDoc(), margins, 'portrait');
    const files = unzipSync(bytes);
    const content = strFromU8(files['content.xml']);
    check('the footnote sits inside the body paragraph', /Body one<text:note text:id="ftn1" text:note-class="footnote">/.test(content), content.match(/<text:note[^>]*>/g));
    check('the endnote carries its own class', /text:note-class="endnote"/.test(content), content.match(/<text:note[^>]*>/g));
    check('each note keeps its citation', /<text:note-citation>1<\/text:note-citation>/.test(content) && /<text:note-citation>i<\/text:note-citation>/.test(content), content.match(/<text:note-citation[^>]*>[^<]*</g));
    check('the note body is a Footnote-styled paragraph', /<text:note-body><text:p text:style-name="Footnote">/.test(content), content.match(/<text:note-body>[\s\S]{0,80}/g));
    check('run formatting inside the note survives', /The footnote, with <text:span[^>]*>bold<\/text:span>/.test(content), content.match(/The footnote[^<]*(<[^>]*>[^<]*){0,4}/g));
    check('no hoisted note paragraph is left behind', !content.includes('\uE017'), content.match(/.\uE017./g));

    const styles = strFromU8(files['styles.xml']);
    check('both note classes are configured', /<text:notes-configuration text:note-class="footnote"/.test(styles) && /<text:notes-configuration text:note-class="endnote"/.test(styles), styles.match(/<text:notes-configuration[^>]*>/g));
    check('footnotes are numbered document-wide, as LibreOffice does', /text:footnotes-position="page" text:start-numbering-at="document"/.test(styles), styles.match(/<text:notes-configuration text:note-class="footnote"[^>]*>/g));
    check('endnotes keep their roman format', /text:note-class="endnote"[^>]*style:num-format="i"/.test(styles), styles.match(/<text:notes-configuration text:note-class="endnote"[^>]*>/g));
    check('the Footnote paragraph style is written out', /<style:style style:name="Footnote" style:family="paragraph"/.test(styles), null);
    check('the separator rides the page layout', /<style:footnote-sep [^>]*style:rel-width="25%"/.test(styles), styles.match(/<style:footnote-sep[^>]*>/g));

    const res = importOdt(bytes);
    const refs: N[] = [];
    (function walk(n: N) { if (n.type === 'noteRef') refs.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    const section = (res.content.content ?? []).find((n: N) => n.type === 'noteSection');
    check('both anchors come back', refs.length === 2, refs.map((r) => r.attrs));
    check('their classes survive', refs[0]?.attrs?.kind === 'footnote' && refs[1]?.attrs?.kind === 'endnote', refs.map((r) => r.attrs?.kind));
    check('a note section is rebuilt', (section?.content ?? []).length === 2, section?.content?.length);
    check('each anchor points at its own note', refs[0]?.attrs?.id === section?.content?.[0]?.attrs?.id && refs[1]?.attrs?.id === section?.content?.[1]?.attrs?.id, [refs.map((r) => r.attrs?.id), section?.content?.map((n: N) => n.attrs?.id)]);
    check('the note text comes back', JSON.stringify(section).includes('The footnote, with'), JSON.stringify(section)?.slice(0, 200));
    check('bold inside the note survives', JSON.stringify(section).includes('"bold"'), JSON.stringify(section)?.slice(0, 300));
    check('the body text is untouched', JSON.stringify(res.content).includes('Body one') && JSON.stringify(res.content).includes('and on.'), null);
    check('no note-removed warning is raised', !res.warnings.some((w: string) => /[Ff]ootnote/.test(w)), res.warnings);
  });

  it('DOCX: writes word/footnotes.xml + endnotes.xml and reads them back', async () => {
    const bytes = await buildDocx(notesDoc(), margins, 'portrait');
    const files = unzipSync(bytes);
    check('a footnote part is written', !!files['word/footnotes.xml'], Object.keys(files).filter((f) => /note/.test(f)));
    check('an endnote part is written', !!files['word/endnotes.xml'], Object.keys(files).filter((f) => /note/.test(f)));
    const doc = strFromU8(files['word/document.xml']);
    check('the body references both', /<w:footnoteReference w:id="1"/.test(doc) && /<w:endnoteReference w:id="1"/.test(doc), doc.match(/<w:(foot|end)noteReference[^>]*>/g));
    const fn = strFromU8(files['word/footnotes.xml']);
    check('the note text lives in its own part', fn.includes('The footnote, with'), fn.slice(0, 400));

    const res = importDocx(bytes);
    const refs: N[] = [];
    (function walk(n: N) { if (n.type === 'noteRef') refs.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    const section = (res.content.content ?? []).find((n: N) => n.type === 'noteSection');
    check('DOCX: both anchors come back', refs.length === 2, refs.map((r) => r.attrs));
    check('DOCX: their classes survive', refs.map((r) => r.attrs.kind).join(',') === 'footnote,endnote', refs.map((r) => r.attrs.kind));
    // Word's own separator entries carry a w:type and are referenced by nothing.
    check('DOCX: the separator notes are not imported', (section?.content ?? []).length === 2, section?.content?.map((n: N) => n.attrs));
    check('DOCX: each anchor points at its own note', refs[0]?.attrs?.id === section?.content?.[0]?.attrs?.id, [refs.map((r) => r.attrs.id), section?.content?.map((n: N) => n.attrs.id)]);
    check('DOCX: the note text comes back', JSON.stringify(section).includes('The footnote, with'), JSON.stringify(section)?.slice(0, 200));
    check('DOCX: bold inside the note survives', JSON.stringify(section).includes('"bold"'), JSON.stringify(section)?.slice(0, 300));
    check('DOCX: the body text is untouched', JSON.stringify(res.content).includes('Body one'), null);
  });

  it('round-trips changed numbering settings through both formats', async () => {
    const custom = {
      ...DEFAULT_NOTE_SETTINGS,
      footnote: { ...DEFAULT_NOTE_SETTINGS.footnote, numFormat: 'A' as const, startAt: 4, restart: 'page' as const },
      separator: { ...DEFAULT_NOTE_SETTINGS.separator, relWidthPercent: 60, weightPt: 1.5, align: 'center' as const },
    };
    const odt = await buildOdt(notesDoc(), margins, 'portrait', undefined, null, 'A4', builtinStyleSheet(), 1.25, 'add', false, custom);
    const back = importOdt(odt).notes;
    check('ODF: format, start and restart survive',
      back.footnote.numFormat === 'A' && back.footnote.startAt === 4 && back.footnote.restart === 'page', back.footnote);
    check('ODF: the separator survives',
      back.separator.relWidthPercent === 60 && Math.abs(back.separator.weightPt - 1.5) < 0.05 && back.separator.align === 'center', back.separator);

    const docx = await buildDocx(notesDoc(), margins, 'portrait', undefined, null, 'A4', builtinStyleSheet(), 1.25, 'add', false, custom);
    const dback = importDocx(docx).notes;
    check('DOCX: format, start and restart survive',
      dback.footnote.numFormat === 'A' && dback.footnote.startAt === 4 && dback.footnote.restart === 'page', dback.footnote);
  });
});

describe('Leg 1a3: continued ordered-list start value', () => {
  it('round-trips a start > 1 (odf-kit drops it) via text:start-value', async () => {
    const olist = (start: number | null, t: string): N => ({
      type: 'orderedList',
      attrs: { listStyleType: 'upper-roman', ...(start ? { start } : {}) },
      content: [{ type: 'listItem', content: [P(null, T(t))] }],
    });
    const doc: N = { type: 'doc', content: [
      olist(null, 'First'), P(null, T('gap 1')), olist(2, 'Second'), P(null, T('gap 2')), olist(3, 'Third'),
    ] };
    const bytes = await buildOdt(doc, margins, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    check('content.xml carries text:start-value 2 and 3', /start-value="2"/.test(content) && /start-value="3"/.test(content), content.match(/text:start-value="\d+"/g));
    const round = importOdt(bytes).content;
    const starts = (round.content ?? []).filter((n: N) => n.type === 'orderedList').map((n: N) => n.attrs?.start ?? null);
    check('re-imported starts continue (1, 2, 3)', JSON.stringify(starts) === JSON.stringify([null, 2, 3]), starts);
  });
});

describe('Leg 1a4: named table style', () => {
  // The style itself lives in the app registry (ODF has no banding), so only its name
  // travels — the look rides on the cell attrs the style painted.
  const styled: N = {
    type: 'doc',
    content: [{
      type: 'table',
      attrs: { tableStyle: 'Simple List Shaded' },
      content: [
        ROW(CELLM(1, 1, null, 'Name', '#F2F2F2'), CELLM(1, 1, null, 'Menge', '#F2F2F2')),
        ROW(CELL(null, P(null, T('Apfel'))), CELL(null, P(null, T('3')))),
        ROW(CELLM(1, 1, null, 'Birne', '#F7F7F7'), CELLM(1, 1, null, '5', '#F7F7F7')),
      ],
    }],
  };

  it('round-trips the style name and the painted cells', async () => {
    const bytes = await buildOdt(styled, margins, 'portrait', undefined, null, 'A4', builtinStyleSheet());
    const files = unzipSync(bytes);
    const stylesXml = strFromU8(files['styles.xml']);
    const contentXml = strFromU8(files['content.xml']);
    check('styles.xml defines the table style', stylesXml.includes('style:family="table"')
      && stylesXml.includes('style:name="Simple_20_List_20_Shaded"'),
      stylesXml.match(/<style:style[^>]*family="table"[^>]*>/g));
    check('the table points at it', /style:name="Table1"[^>]*style:parent-style-name="Simple_20_List_20_Shaded"/.test(contentXml),
      contentXml.match(/<style:style[^>]*style:name="Table1"[^>]*>/g));

    const res = importOdt(bytes);
    const table = res.content.content!.find((n: N) => n.type === 'table') as N;
    check('the name comes back on the table', table?.attrs?.tableStyle === 'Simple List Shaded', table?.attrs);
    const fills = table.content.map((r: N) => r.content[0].attrs.backgroundColor ?? null);
    check('the painted fills survive', JSON.stringify(fills) === JSON.stringify(['#F2F2F2', null, '#F7F7F7']), fills);
  });

  it('round-trips the table style options (Word\'s tblLook)', async () => {
    // Header row + banded rows on, everything else off.
    const opts: N = { ...styled, content: [{ ...styled.content![0],
      attrs: { tableStyle: 'Simple List Shaded', tableLook: 'bandedRow headerRow' } }] };
    const bytes = await buildOdt(opts, margins, 'portrait', undefined, null, 'A4', builtinStyleSheet());
    const contentXml = strFromU8(unzipSync(bytes)['content.xml']);
    check('the options ride on table:use-*-styles',
      contentXml.includes('table:use-first-row-styles="true"')
      && contentXml.includes('table:use-banding-rows-styles="true"')
      && contentXml.includes('table:use-first-column-styles="false"'),
      contentXml.match(/table:use-[a-z-]*="[a-z]*"/g));

    const table = importOdt(bytes).content.content!.find((n: N) => n.type === 'table') as N;
    check('they come back on the table', table?.attrs?.tableLook === 'bandedRow headerRow', table?.attrs);
  });

  it('keeps two styled tables apart (the pass walks table elements, not cells)', async () => {
    const one = { ...styled.content![0], attrs: { tableStyle: 'Simple Grid', tableLook: 'headerRow' } };
    const two = { ...styled.content![0], attrs: { tableStyle: 'Academic', tableLook: 'headerRow lastRow' } };
    const bytes = await buildOdt({ type: 'doc', content: [one, P(null, T('between')), two] } as N,
      margins, 'portrait', undefined, null, 'A4', builtinStyleSheet());
    const tables = importOdt(bytes).content.content!.filter((n: N) => n.type === 'table');
    check('both names survive',
      tables.map((t: N) => t.attrs?.tableStyle).join('|') === 'Simple Grid|Academic',
      tables.map((t: N) => t.attrs));
    check('each keeps its own options',
      tables.map((t: N) => t.attrs?.tableLook).join('|') === 'headerRow|lastRow headerRow',
      tables.map((t: N) => t.attrs?.tableLook));
  });

  it('bakes a region font onto the runs so Word/LibreOffice match', async () => {
    // Box List Blue writes white bold on the header row; the editor renders that from CSS.
    const blue: N = { ...styled, content: [{ ...styled.content![0], attrs: { tableStyle: 'Box List Blue' },
      content: [ROW(CELLM(1, 1, null, 'Kopf', '#4A7EBB'))] }] };
    blue.content[0].content[0].content[0].attrs.region = 'headerRow';
    const bytes = await buildOdt(blue, margins, 'portrait', undefined, null, 'A4', builtinStyleSheet());
    const contentXml = strFromU8(unzipSync(bytes)['content.xml']);
    check('a bold white run style is minted', /fo:font-weight="bold"/.test(contentXml) && /fo:color="#FFFFFF"/i.test(contentXml),
      contentXml.match(/<style:text-properties[^>]*>/g));
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
  mergedDoc.content![1].content![0].content![1].attrs!.verticalAlign = 'middle';

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
    check('B keeps vertical-align middle', rows[0]?.content?.[1]?.attrs?.verticalAlign === 'middle', rows[0]?.content?.[1]?.attrs?.verticalAlign);
    check('A stays top-aligned', rows[0]?.content?.[0]?.attrs?.verticalAlign == null, rows[0]?.content?.[0]?.attrs?.verticalAlign);

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

describe('Leg 1d: table cell borders (per-side, fo:border-*)', () => {
  const bcell = (text: string, borders: Record<string, string> = {}): N =>
    ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [100], ...borders }, content: [P(null, T(text))] });

  // A: default borders (null attrs) · B: top hidden + custom red right ·
  // C/D: fully borderless.
  const doc: N = { type: 'doc', content: [
    { type: 'table', content: [
      ROW(bcell('A'), bcell('B', { borderTop: 'none', borderRight: '2.25pt solid #FF0000' })),
      ROW(bcell('C', { borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' }),
          bcell('D', { borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' })),
    ] },
  ] };

  it('exports fo:border-* per side and re-imports the attrs', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('export emits fo:border-top="none"', xml.includes('fo:border-top="none"'), xml.match(/fo:border-top="[^"]*"/g));
    check('export emits the custom red right border', xml.includes('fo:border-right="2.25pt solid #FF0000"'), xml.match(/fo:border-right="[^"]*"/g));

    const res = importOdt(bytes);
    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    const table = (res.content.content ?? []).find((n: N) => n.type === 'table');
    const [row0, row1] = table?.content ?? [];
    const a = row0?.content?.[0]?.attrs ?? {};
    const b = row0?.content?.[1]?.attrs ?? {};
    const c = row1?.content?.[0]?.attrs ?? {};
    check('A keeps default borders (attrs null)', a.borderTop == null && a.borderRight == null && a.borderBottom == null && a.borderLeft == null, a);
    check('B top border stays hidden', b.borderTop === 'none', b);
    check('B custom right border round-trips', b.borderRight === '2.25pt solid #FF0000', b);
    check('B bottom/left stay default', b.borderBottom == null && b.borderLeft == null, b);
    check('C is fully borderless', c.borderTop === 'none' && c.borderRight === 'none' && c.borderBottom === 'none' && c.borderLeft === 'none', c);
  });
});

describe('Leg 1e: table margins (dragged outer edges)', () => {
  // Text width here is 21 - 2.5 - 1.5 = 17cm, so the table is 17 - 2 - 3 = 12cm wide.
  const doc: N = { type: 'doc', content: [
    { type: 'table', attrs: { marginLeft: 2, marginRight: 3 }, content: [
      ROW(CELL([200], P(null, T('A'))), CELL([100], P(null, T('B')))),
    ] },
  ] };

  it('exports fo:margin-* + style:width and re-imports the attrs', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    const tableStyle = xml.match(/<style:style[^>]*style:family="table"[^>]*>\s*<style:table-properties[^>]*>/)?.[0] ?? '';
    check('export emits the left margin', tableStyle.includes('fo:margin-left="2cm"'), tableStyle);
    check('export emits the right margin', tableStyle.includes('fo:margin-right="3cm"'), tableStyle);
    check('export emits the remaining width', tableStyle.includes('style:width="12cm"'), tableStyle);
    // Columns keep their 2:1 ratio inside the narrowed table.
    check('columns fill the narrowed table', xml.includes('style:column-width="8cm"') && xml.includes('style:column-width="4cm"'), xml.match(/style:column-width="[^"]*"/g));

    const res = importOdt(bytes);
    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    const table = (res.content.content ?? []).find((n: N) => n.type === 'table');
    check('left margin round-trips', table?.attrs?.marginLeft === 2, table?.attrs);
    check('right margin round-trips', table?.attrs?.marginRight === 3, table?.attrs);
    const weights = (table?.content?.[0]?.content ?? []).map((c: N) => c.attrs?.colwidth?.[0]);
    check('column ratio survives', weights[0] === 2 * weights[1], weights);
  });

  it('leaves a full-width table without margin attrs', async () => {
    const plain: N = { type: 'doc', content: [
      { type: 'table', content: [ROW(CELL([100], P(null, T('A'))), CELL([100], P(null, T('B'))))] },
    ] };
    const res = importOdt(await buildOdt(plain, margins, 'portrait'));
    const table = (res.content.content ?? []).find((n: N) => n.type === 'table');
    check('no margins on a full-width table', !table?.attrs?.marginLeft && !table?.attrs?.marginRight, table?.attrs);
  });
});

describe('Leg 1f: page-anchored frame (cover graphic) stacking', () => {
  // A cover page's own graphic sits in front of text (ODF style:run-through="foreground");
  // the default — no attr — is the usual behind-text watermark case.
  const doc: N = { type: 'doc', content: [
    P(null, { type: 'image', attrs: { src: PNG, width: 60, height: 40, anchorPage: 1, inFront: true } }),
  ] };

  it('exports style:run-through="foreground" and re-imports inFront', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('export writes foreground run-through', xml.includes('style:run-through="foreground"'), xml.match(/style:run-through="[^"]*"/g));

    const res = importOdt(bytes);
    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    const img = collectImages(res.content).find((i: N) => i.attrs?.anchorPage);
    check('page and foreground stacking round-trip', img?.attrs?.anchorPage === 1 && img?.attrs?.inFront === true, img?.attrs);
  });

  it('defaults to background (no inFront) when the file has none', async () => {
    const behind: N = { type: 'doc', content: [
      P(null, { type: 'image', attrs: { src: PNG, width: 60, height: 40, anchorPage: 1 } }),
    ] };
    const bytes = await buildOdt(behind, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('export writes background run-through', xml.includes('style:run-through="background"'), xml.match(/style:run-through="[^"]*"/g));
    const img = collectImages(importOdt(bytes).content).find((i: N) => i.attrs?.anchorPage);
    check('inFront stays unset', !img?.attrs?.inFront, img?.attrs);
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
  <text:list-style style:name="L2">
   <text:list-level-style-bullet text:level="1" text:bullet-char="&#xF0D8;">
    <style:text-properties style:font-name="Wingdings"/>
   </text:list-level-style-bullet>
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
  <text:list text:style-name="L2">
   <text:list-item><text:p>wingdings arrow</text:p></text:list-item>
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
    // Omitted fo:margin-bottom → ODF's default 0, which is the editor's default too, so no attr.
    check('foreign: omitted margin → no spaceAfter', c[0].attrs?.spaceAfter == null, c[0].attrs);

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

    // A named style's formatting lands in the style registry, not on the block: the
    // paragraph just references "Mono" (font-face resolved to the real family).
    const mono = c[3];
    check('foreign: paragraph references its named style', mono.attrs?.styleName === 'Mono', mono.attrs);
    const monoStyle = f.styles.paragraph['Mono'];
    check('foreign: Mono style resolves the font face', monoStyle?.text.fontFamily === 'Courier New', monoStyle);
    check('foreign: Mono style keeps its size', monoStyle?.text.fontSizePt === 10, monoStyle);
    check('foreign: no direct formatting on the block', !mono.content![0].marks, mono.content![0]);

    check('foreign: image and footnote anchor imported, text kept',
      c[4].content!.length === 3 && c[4].content![0].text === 'img:' &&
      c[4].content![1].type === 'image' && c[4].content![1].attrs?.src?.startsWith('data:image/png;base64,') &&
      c[4].content![2].type === 'noteRef', c[4]);

    const list = c[5];
    check('foreign: list → lower-roman-paren, start 3', list.type === 'orderedList' && list.attrs?.listStyleType === 'lower-roman-paren' && list.attrs?.start === 3, list.attrs);
    check('foreign: level-2 def → nested bulletList', list.content![0].content![1]?.type === 'bulletList', list.content![0]);

    const wdList = c.find((n: N) => n.type === 'bulletList' && n.content?.[0]?.content?.[0]?.content?.[0]?.text === 'wingdings arrow');
    check('foreign: Wingdings PUA bullet-char → ➢', wdList?.attrs?.bulletChar === '➢', wdList?.attrs);

    const table = c[7];
    check('foreign: table present', table.type === 'table');
    const [hdr, row] = table.content!;
    check('foreign: header row → tableHeader ×3', hdr.content!.length === 3 && hdr.content!.every((cell: N) => cell.type === 'tableHeader'), hdr.content!.map((x: N) => x.type));
    check('foreign: repeated cell expanded', hdr.content![1].content![0].content![0].text === 'hx' && hdr.content![2].content![0].content![0].text === 'hx');
    check('foreign: colspan 2 + covered skipped', row.content!.length === 2 && row.content![0].attrs?.colspan === 2, row.content!.map((x: N) => x.attrs));
    check('foreign: col weights 5/10/10cm', JSON.stringify(hdr.content!.map((x: N) => x.attrs.colwidth)) === JSON.stringify([[500], [1000], [1000]]), hdr.content!.map((x: N) => x.attrs.colwidth));
    check('foreign: spanned cell colwidth [500,1000]', JSON.stringify(row.content![0].attrs?.colwidth) === JSON.stringify([500, 1000]), row.content![0].attrs);
    check('foreign: min-row-height 2cm → 76px', row.attrs?.rowHeight === 76, row.attrs);

    const notes = c.find((n: N) => n.type === 'noteSection');
    check('foreign: the note body follows at the document end', notes?.content?.[0]?.content?.[0]?.text === 'note body', notes);
    check('foreign: no hyperlink warning (now round-tripped)', !f.warnings.includes('Hyperlinks were converted to plain text'), f.warnings);
    check('foreign: no note warning (now round-tripped)', !f.warnings.some((w: string) => /[Ff]ootnote/.test(w)), f.warnings);
  });

  it('resolves a drawn shape\'s fill/stroke inherited from the default graphic style', () => {
    // LibreOffice omits draw:fill/draw:stroke on a shape that keeps the app default
    // (solid), taking the color from the default graphic style; only "none" turns it off.
    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
 <office:styles>
  <style:default-style style:family="graphic">
   <style:graphic-properties svg:stroke-color="#3465a4" draw:fill-color="#729fcf"/>
  </style:default-style>
 </office:styles>
</office:document-styles>`;
    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
 <office:automatic-styles>
  <style:style style:name="grInherit" style:family="graphic"><style:graphic-properties draw:auto-grow-height="false"/></style:style>
  <style:style style:name="grNone" style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none"/></style:style>
 </office:automatic-styles>
 <office:body><office:text>
  <text:p><draw:custom-shape draw:style-name="grInherit" svg:width="4cm" svg:height="3cm"><text:p>inherit</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ellipse"/></draw:custom-shape></text:p>
  <text:p><draw:custom-shape draw:style-name="grNone" svg:width="4cm" svg:height="3cm"><text:p>none</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="ellipse"/></draw:custom-shape></text:p>
 </office:text></office:body>
</office:document-content>`;
    const foreign = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': [strToU8(contentXml), { level: 6 }],
      'styles.xml': [strToU8(stylesXml), { level: 6 }],
    } as any);

    const boxes: N[] = [];
    const walk = (n: N): void => { if (n?.type === 'textBox') boxes.push(n); (n?.content || []).forEach(walk); };
    walk(importOdt(foreign).content);
    check('shape fill/stroke: two ellipses imported', boxes.length === 2, boxes.map((b: N) => b.attrs));
    const [inherit, none] = boxes;
    check('shape fill/stroke: inherited fill #729FCF', inherit.attrs.fillColor === '#729FCF', inherit.attrs);
    check('shape fill/stroke: inherited stroke #3465A4', inherit.attrs.strokeColor === '#3465A4', inherit.attrs);
    check('shape fill/stroke: explicit none → null fill', none.attrs.fillColor === null, none.attrs);
    check('shape fill/stroke: explicit none → null stroke', none.attrs.strokeColor === null, none.attrs);
  });

  it('wraps the body in columns when the page layout declares them', () => {
    const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">
 <office:automatic-styles>
  <style:page-layout style:name="pm1">
   <style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="1in" fo:margin-bottom="1in" fo:margin-left="1in" fo:margin-right="1in">
    <style:columns fo:column-count="3" fo:column-gap="0.1965in"/>
   </style:page-layout-properties>
  </style:page-layout>
 </office:automatic-styles>
 <office:master-styles>
  <style:master-page style:name="Standard" style:page-layout-name="pm1"/>
 </office:master-styles>
</office:document-styles>`;

    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
 <office:automatic-styles>
  <style:style style:name="S1" style:family="section">
   <style:section-properties><style:columns fo:column-count="1" fo:column-gap="0.5in"/></style:section-properties>
  </style:style>
 </office:automatic-styles>
 <office:body><office:text>
  <text:p>first</text:p>
  <table:table><table:table-column/><table:table-row><table:table-cell><text:p>cell</text:p></table:table-cell></table:table-row></table:table>
  <text:p>second</text:p>
  <text:section text:name="Sect1" text:style-name="S1"><text:p>in section</text:p></text:section>
 </office:text></office:body>
</office:document-content>`;

    const foreign = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': [strToU8(contentXml), { level: 6 }],
      'styles.xml': [strToU8(stylesXml), { level: 6 }],
    } as any);

    const f = importOdt(foreign);
    const c = f.content.content!;

    check('page-cols: shape columns/table/columns', c.map((n: N) => n.type).join(',') === 'columns,table,columns', c.map((n: N) => n.type));
    check('page-cols: count 3, gap 0.1965in → 0.5cm', c[0].attrs?.count === 3 && c[0].attrs?.gapCm === 0.5, c[0].attrs);
    check('page-cols: 1-col section content joins the run',
      c[2].content!.map((n: N) => n.content?.[0]?.text).join(',') === 'second,in section', c[2].content);
    check('page-cols: table move-out warned', f.warnings.some(w => w.includes('moved out of the columns')), f.warnings);
  });
});

describe('Leg 3: header/footer → buildOdt → importOdt', () => {
  it('round-trips header/footer content, fields, and the geometry mapping', async () => {
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
    // The body margins survive the header/footer geometry mapping.
    const hm = hfRes.margins!;
    check('hf: body margins preserved through geometry mapping',
      !!hm && Math.abs(hm.top - 3) < 0.05 && Math.abs(hm.bottom - 2) < 0.05 &&
      Math.abs(hm.left - 2.5) < 0.02 && Math.abs(hm.right - 1.5) < 0.02, hm);
    // The configured edge distances round-trip (they become the ODF page margin).
    check('hf: header distance round-trips (0.8cm)', Math.abs((hfRes.headerDistanceCm ?? 0) - 0.8) < 0.02, hfRes.headerDistanceCm);
    check('hf: footer distance round-trips (1.6cm)', Math.abs((hfRes.footerDistanceCm ?? 0) - 1.6) < 0.02, hfRes.footerDistanceCm);
    check('hf: body still round-trips alongside header/footer',
      firstDiff(normalize(fixture), normalize(hfRes.content)) === null,
      firstDiff(normalize(fixture), normalize(hfRes.content)));

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

describe('Leg 3a: different first page header/footer → buildOdt → importOdt', () => {
  it('round-trips the first-page variants and the flag alongside the defaults', async () => {
    // Arial 10pt on the runs AND the page-field atoms, so the field digits keep the font.
    const arial = [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '10pt' } }];
    const header: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Default header' }] }] };
    // The strut follows runs that agree on a font (applyUniformRunFont), so the zone
    // paragraph carries it either way — stating it keeps the round trip an identity.
    const footer: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center', fontFamily: 'Arial', fontSize: '10pt' }, content: [
      { type: 'text', text: 'Seite ', marks: arial }, { type: 'pageNumber', marks: arial }, { type: 'text', text: ' von ', marks: arial }, { type: 'pageCount', marks: arial },
    ] }] };
    const headerFirst: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { fontFamily: 'Arial', fontSize: '10pt' }, content: [
      { type: 'text', text: 'Cover', marks: [{ type: 'bold' }, ...arial] },
    ] }] };
    const footerFirst: N = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Stand:   x', marks: arial }, { type: 'text', text: ' ' }, { type: 'pageNumber', marks: arial },
      { type: 'hardBreak' }, { type: 'hardBreak' },
    ] }] };

    const bytes = await buildOdt(fixture, margins, 'portrait',
      { header, footer, headerFirst, footerFirst, differentFirstPage: true, pageCount: 3 });
    const res = importOdt(bytes);

    check('dfp: no warnings', res.warnings.length === 0, res.warnings);
    check('dfp: flag round-trips', res.differentFirstPage === true, res.differentFirstPage);
    check('dfp: default header round-trips', firstDiff(normalize(header), normalize(res.header)) === null, firstDiff(normalize(header), normalize(res.header)));
    check('dfp: default footer round-trips', firstDiff(normalize(footer), normalize(res.footer)) === null, firstDiff(normalize(footer), normalize(res.footer)));
    check('dfp: first-page header round-trips (incl. marks)', firstDiff(normalize(headerFirst), normalize(res.headerFirst)) === null, firstDiff(normalize(headerFirst), normalize(res.headerFirst)));
    check('dfp: first-page footer preserves spacing', res.footerFirst?.content?.[0]?.content?.[0]?.text === 'Stand:   x', res.footerFirst);
    const ffInline = res.footerFirst?.content?.[0]?.content ?? [];
    const ffBreaks = ffInline.filter((n: N) => n.type === 'hardBreak').length;
    check('dfp: first-page footer keeps trailing blank lines', ffBreaks === 2 && ffInline[ffInline.length - 1]?.type === 'hardBreak', ffInline);

    // Every variant must be valid in the header/footer editor schema.
    const hfSchema = getSchema(hfExtensions());
    let ok = true;
    for (const z of [res.header, res.footer, res.headerFirst, res.footerFirst]) {
      if (!z) continue;
      try { PMNode.fromJSON(hfSchema, z).check(); } catch { ok = false; }
    }
    check('dfp: all variants valid in hf schema', ok);

    // Flag off ⇒ first-page zones aren't exported.
    const offBytes = await buildOdt(fixture, margins, 'portrait',
      { header, footer, headerFirst, footerFirst, differentFirstPage: false, pageCount: 3 });
    const offRes = importOdt(offBytes);
    check('dfp: first-page zones skipped when flag off', offRes.differentFirstPage === false && offRes.headerFirst === null && offRes.footerFirst === null, offRes);

    // Flag on with an empty first-page footer (default footer present): page 1's footer
    // is deliberately blank, and the flag still round-trips (element presence = flag).
    const blankFirst = await buildOdt(fixture, margins, 'portrait',
      { header: null, footer, headerFirst: null, footerFirst: null, differentFirstPage: true, pageCount: 3 });
    const blankRes = importOdt(blankFirst);
    check('dfp: flag survives an empty first-page zone', blankRes.differentFirstPage === true, blankRes.differentFirstPage);
    check('dfp: empty first-page footer stays blank', blankRes.footerFirst === null, blankRes.footerFirst);
    check('dfp: default footer still present', firstDiff(normalize(footer), normalize(blankRes.footer)) === null, blankRes.footer);
  });
});

describe('Leg 3b: inline images in header/footer → buildOdt → importOdt', () => {
  it('round-trips an as-char image in a default zone and a first-page zone', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const img = (w: number, h: number): N => ({ type: 'image', attrs: { src: PNG, alt: 'Logo', width: w, height: h, wrap: 'inline' } });
    const footer: N = { type: 'doc', content: [P({ textAlign: 'center' }, T('Logo '), img(120, 48))] };
    const headerFirst: N = { type: 'doc', content: [P(null, img(200, 60))] };
    const header: N = { type: 'doc', content: [P(null, T('Default header'))] };
    const res = importOdt(await buildOdt(fixture, margins, 'portrait',
      { header, footer, headerFirst, footerFirst: null, differentFirstPage: true, pageCount: 3 }));
    const imgs = (doc: N): N[] => { const o: N[] = []; const w = (n: N) => { if (!n) return; if (n.type === 'image') o.push(n); (n.content ?? []).forEach(w); }; w(doc); return o; };

    check('hf image: no warnings', res.warnings.length === 0, res.warnings);
    const fi = imgs(res.footer);
    check('hf image: default footer keeps one image', fi.length === 1, res.footer);
    check('hf image: src is a data-URI', /^data:image\//.test(fi[0]?.attrs?.src ?? ''), fi[0]?.attrs?.src?.slice(0, 24));
    check('hf image: size preserved (px→cm→px)', Math.abs(fi[0]?.attrs?.width - 120) <= 2 && Math.abs(fi[0]?.attrs?.height - 48) <= 2, fi[0]?.attrs);
    check('hf image: stays inline (as-char)', (fi[0]?.attrs?.wrap ?? 'inline') === 'inline', fi[0]?.attrs?.wrap);
    check('hf image: first-page header keeps its image', imgs(res.headerFirst).length === 1, res.headerFirst);

    // Both zones must remain valid in the header/footer editor schema.
    const hfSchema = getSchema(hfExtensions());
    let ok = true;
    for (const z of [res.footer, res.headerFirst]) { if (!z) continue; try { PMNode.fromJSON(hfSchema, z).check(); } catch { ok = false; } }
    check('hf image: zones valid in hf schema', ok);
  });
});

describe('Leg 3c: odd/even page header/footer → buildOdt → importOdt', () => {
  it('round-trips the even-page variants and the flag alongside default + first', async () => {
    const header: N = { type: 'doc', content: [P(null, T('Default header'))] };
    const footer: N = { type: 'doc', content: [P(null, T('Default footer'))] };
    const headerEven: N = { type: 'doc', content: [P({ textAlign: 'right' }, T('Even header'))] };
    const footerEven: N = { type: 'doc', content: [P({ textAlign: 'center' }, T('Even footer'))] };
    const headerFirst: N = { type: 'doc', content: [P(null, T('First header'))] };
    const bytes = await buildOdt(fixture, margins, 'portrait',
      { header, footer, headerEven, footerEven, differentOddEven: true, headerFirst, footerFirst: null, differentFirstPage: true, pageCount: 4 });
    check('odd/even: styles.xml has <style:header-left>', strFromU8(unzipSync(bytes)['styles.xml']).includes('<style:header-left>'));

    const res = importOdt(bytes);
    check('odd/even: no warnings', res.warnings.length === 0, res.warnings);
    check('odd/even: flag round-trips', res.differentOddEven === true, res.differentOddEven);
    check('odd/even: even header round-trips', firstDiff(normalize(headerEven), normalize(res.headerEven)) === null, res.headerEven);
    check('odd/even: even footer round-trips', firstDiff(normalize(footerEven), normalize(res.footerEven)) === null, res.footerEven);
    check('odd/even: default + first still round-trip',
      firstDiff(normalize(header), normalize(res.header)) === null && firstDiff(normalize(headerFirst), normalize(res.headerFirst)) === null, res.header);

    const hfSchema = getSchema(hfExtensions());
    let ok = true;
    for (const z of [res.headerEven, res.footerEven]) { if (!z) continue; try { PMNode.fromJSON(hfSchema, z).check(); } catch { ok = false; } }
    check('odd/even: even zones valid in hf schema', ok);
  });
});

describe('Leg 4: foreign header/footer → importOdt', () => {
  it('parses page-number/count fields, reconstructs body margins, imports the first-page variant', () => {
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
    // Body top margin = page margin (1.5) + the header band (0.8): its 0.3 spacing to
    // the body is laid out inside that height, not added to it (styleResolver.ts).
    check('foreign hf: body top margin reconstructed', Math.abs((fhf.margins?.top ?? 0) - 2.3) < 0.02, fhf.margins);
    check('foreign hf: body bottom margin reconstructed', Math.abs((fhf.margins?.bottom ?? 0) - 2.1) < 0.02, fhf.margins);
    // header-first is a supported variant (Word "Different First Page" / ODF header-first).
    check('foreign hf: first-page header parsed', fhf.headerFirst?.content?.[0]?.content?.[0]?.text === 'Cover', fhf.headerFirst);
    check('foreign hf: different-first-page flag set', fhf.differentFirstPage === true, fhf.differentFirstPage);
    check('foreign hf: no unsupported-variant warning', !fhf.warnings.some(w => /per-page/i.test(w)), fhf.warnings);
  });
});

describe('Leg 6: text boxes / shapes (ODT)', () => {
  const boxDoc: N = {
    type: 'doc',
    content: [
      P(null, T('before')),
      TBX({ width: 288, height: 96, fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1 },
        P(null, T('plain box')),
        P(null, T('with '), T('marks', { type: 'italic' })),
      ),
      TBX({ width: 192, height: 96, wrap: 'right', shapeKind: 'ellipse', fillColor: '#FFEE00', strokeColor: '#FF0000', strokeWidthPt: 2.25, rotation: 30 },
        P(null, T('in ellipse')),
      ),
      TBX({ width: 192, height: 80, wrap: 'left', shapeKind: 'roundRect', fillColor: null, strokeColor: null },
        P(null, T('transparent round')),
      ),
      TBX({ width: 192, height: 96, spaceBefore: 6, spaceAfter: 8 },
        P(null, T('spaced box')),
      ),
      P(null, T('after')),
    ],
  };

  it('emits frames/shapes with graphic styles and round-trips every attr', async () => {
    const bytes = await buildOdt(boxDoc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('emits <draw:frame><draw:text-box>', /<draw:frame [^>]*><draw:text-box/.test(xml));
    check('emits <draw:custom-shape> with ellipse geometry', /<draw:custom-shape[\s\S]*?draw:type="ellipse"/.test(xml));
    check('emits round-rectangle geometry', xml.includes('draw:type="round-rectangle"'));
    check('mints TbxFr graphic styles', xml.includes('style:name="TbxFr1"') && xml.includes('style:name="TbxFr3"'));
    check('graphic style carries fill + stroke', xml.includes('draw:fill-color="#FFEE00"') && xml.includes('svg:stroke-color="#FF0000"'));
    check('transparent box has fill/stroke none', /draw:fill="none" draw:stroke="none"/.test(xml));
    check('no leftover TBX sentinel', !xml.includes(''));

    const res = importOdt(bytes);
    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    const boxes = (res.content.content ?? []).filter((n: N) => n.type === 'textBox');
    check('all 4 boxes round-trip', boxes.length === 4, (res.content.content ?? []).map((n: N) => n.type));

    const [plain, ellipse, round, spaced] = boxes;
    check('anchor paragraph carries the box spacing',
      xml.includes('style:name="TbxP4"') && xml.includes('fo:margin-top="6pt" fo:margin-bottom="8pt"'), xml.slice(0, 0));
    check('box spacing round-trips', spaced?.attrs?.spaceBefore === 6 && spaced?.attrs?.spaceAfter === 8, spaced?.attrs);
    check('plain box: size 288×96, defaults suppressed', plain?.attrs?.width === 288 && plain?.attrs?.height === 96 &&
      plain?.attrs?.fillColor === undefined && plain?.attrs?.strokeColor === undefined && plain?.attrs?.shapeKind === undefined, plain?.attrs);
    check('plain box: both paragraphs + marks survive',
      plain?.content?.length === 2 && plain?.content?.[1]?.content?.some((n: N) => n.marks?.some((m: N) => m.type === 'italic')), plain?.content);
    check('ellipse: shapeKind + wrap + rotation', ellipse?.attrs?.shapeKind === 'ellipse' && ellipse?.attrs?.wrap === 'right' && ellipse?.attrs?.rotation === 30, ellipse?.attrs);
    check('ellipse: fill/stroke/width exact', ellipse?.attrs?.fillColor === '#FFEE00' && ellipse?.attrs?.strokeColor === '#FF0000' && ellipse?.attrs?.strokeWidthPt === 2.25, ellipse?.attrs);
    check('roundRect: explicit null fill/stroke survive (transparent, no border)',
      round?.attrs?.shapeKind === 'roundRect' && round?.attrs?.fillColor === null && round?.attrs?.strokeColor === null, round?.attrs);
    check('document JSON round-trips', firstDiff(normalize(boxDoc), normalize(res.content)) === null,
      firstDiff(normalize(boxDoc), normalize(res.content)));
  });
});

describe('Leg 7: foreign shapes/text boxes → importOdt', () => {
  it('imports text-box frames + preset shapes, flattens boxes in cells, warns on the rest', () => {
    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
 <office:automatic-styles>
  <style:style style:name="gr1" style:family="graphic">
   <style:graphic-properties draw:fill="solid" draw:fill-color="#ccffcc" draw:stroke="solid" svg:stroke-color="#003300" svg:stroke-width="0.0292in" style:wrap="left" style:horizontal-pos="right"/>
  </style:style>
  <style:style style:name="gr2" style:family="graphic">
   <style:graphic-properties draw:fill="none" draw:stroke="none"/>
  </style:style>
 </office:automatic-styles>
 <office:body><office:text>
  <text:p>anchor <draw:frame draw:style-name="gr1" text:anchor-type="paragraph" svg:width="2in" svg:x="1cm" svg:y="2cm"><draw:text-box fo:min-height="1in"><text:p>floating box</text:p><text:p>second</text:p></draw:text-box></draw:frame>text continues</text:p>
  <text:p><draw:rect draw:style-name="gr2" text:anchor-type="as-char" svg:width="5.08cm" svg:height="2.54cm"><text:p>rect text</text:p></draw:rect></text:p>
  <text:p><draw:custom-shape draw:style-name="gr1" text:anchor-type="as-char" svg:width="5.08cm" svg:height="2.54cm"><text:p>lo ellipse</text:p><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:glue-points="10800 0 3163 3163 0 10800" draw:text-areas="3163 3163 18437 18437" draw:type="ellipse" draw:enhanced-path="U 10800 10800 10800 10800 0 360 Z N"/></draw:custom-shape></text:p>
  <text:p><draw:custom-shape text:anchor-type="as-char" svg:width="2cm" svg:height="2cm"><text:p>star</text:p><draw:enhanced-geometry draw:type="star5"/></draw:custom-shape></text:p>
  <text:p><draw:line svg:x1="0cm" svg:y1="0cm" svg:x2="5cm" svg:y2="0cm"/></text:p>
  <table:table>
   <table:table-column/>
   <table:table-row><table:table-cell><text:p>cell <draw:frame text:anchor-type="as-char" svg:width="2cm"><draw:text-box><text:p>box in cell</text:p></draw:text-box></draw:frame></text:p></table:table-cell></table:table-row>
  </table:table>
 </office:text></office:body>
</office:document-content>`;
    const foreign = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': [strToU8(contentXml), { level: 6 }],
    } as any);

    const f = importOdt(foreign);
    const c = f.content.content!;
    const boxes = c.filter((n: N) => n.type === 'textBox');
    check('3 supported shapes imported', boxes.length === 3, c.map((n: N) => n.type));

    const [floatBox, rect, ellipse] = boxes;
    check('frame: free x/y collapses to wrap side (right)', floatBox?.attrs?.wrap === 'right', floatBox?.attrs);
    check('frame: 2in → 192px, min-height 1in → 96px', floatBox?.attrs?.width === 192 && floatBox?.attrs?.height === 96, floatBox?.attrs);
    check('frame: fill + stroke from graphic style', floatBox?.attrs?.fillColor === '#CCFFCC' && floatBox?.attrs?.strokeColor === '#003300', floatBox?.attrs);
    check('frame: stroke width 0.0292in → ≈2.1pt', Math.abs((floatBox?.attrs?.strokeWidthPt ?? 0) - 2.1) < 0.05, floatBox?.attrs);
    check('frame: both paragraphs kept', floatBox?.content?.length === 2, floatBox?.content);
    check('frame: anchor paragraph text kept', c[0]?.content?.map((n: N) => n.text).join('') === 'anchor text continues', c[0]);
    check('rect: imports as plain textbox, transparent', rect?.attrs?.shapeKind === undefined && rect?.attrs?.fillColor === null && rect?.attrs?.strokeColor === null, rect?.attrs);
    check('rect: text preserved', rect?.content?.[0]?.content?.[0]?.text === 'rect text', rect?.content);
    check('custom-shape ellipse: shapeKind + geometry', ellipse?.attrs?.shapeKind === 'ellipse' && ellipse?.attrs?.width === 192 && ellipse?.attrs?.height === 96, ellipse?.attrs);
    check('star5 dropped with warning', f.warnings.includes('Unsupported shapes were removed'), f.warnings);
    check('draw:line dropped with warning', f.warnings.includes('Drawings were removed'), f.warnings);

    const table = c.find((n: N) => n.type === 'table');
    const cellBlocks = table?.content?.[0]?.content?.[0]?.content ?? [];
    check('box in cell flattened into the cell', cellBlocks.some((b: N) => b.content?.some((t: N) => t.text === 'box in cell')), cellBlocks);
    check('cell flatten warning reported', f.warnings.includes('Text boxes nested in table cells or other text boxes were flattened'), f.warnings);
  });
});

describe('Leg 8: multi-column sections (ODT)', () => {
  const colsDoc: N = {
    type: 'doc',
    content: [
      P(null, T('before')),
      COLS({ count: 2, gapCm: 0.8 },
        P(null, T('col text with '), T('bold', { type: 'bold' })),
        { type: 'bulletList', content: [
          LI(P(null, T('col bullet one'))),
          LI(P(null, T('col bullet two'))),
        ] },
        H({ level: 3 }, T('Col heading')),
      ),
      P(null, T('between')),
      COLS({ count: 3, gapCm: 0.5 }, P(null, T('three column text'))),
      P(null, T('after')),
    ],
  };

  it('emits <text:section> with a section style and round-trips attrs + content', async () => {
    const bytes = await buildOdt(colsDoc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('emits <text:section> with the minted style', /<text:section text:style-name="ColSec1"/.test(xml));
    check('mints a section-family style', xml.includes('style:family="section"'));
    check('2-col style carries count + gap', xml.includes('fo:column-count="2"') && xml.includes('fo:column-gap="0.8cm"'));
    check('3-col style carries count + default gap', xml.includes('fo:column-count="3"') && xml.includes('fo:column-gap="0.5cm"'));
    check('columns balance (dont-balance false)', xml.includes('text:dont-balance-text-columns="false"'));
    check('section content is real block markup', /<text:section[^>]*>[\s\S]*?<text:list/.test(xml));
    check('no leftover COL sentinel', !xml.includes(''));

    const res = importOdt(bytes);
    check('no warnings on own export', res.warnings.length === 0, res.warnings);
    const cols = (res.content.content ?? []).filter((n: N) => n.type === 'columns');
    check('both sections round-trip', cols.length === 2, (res.content.content ?? []).map((n: N) => n.type));
    const [two, three] = cols;
    check('2-col attrs exact', two?.attrs?.count === 2 && two?.attrs?.gapCm === 0.8, two?.attrs);
    check('3-col attrs exact', three?.attrs?.count === 3 && three?.attrs?.gapCm === 0.5, three?.attrs);
    check('marks + list + heading survive inside the section',
      two?.content?.[0]?.content?.some((n: N) => n.marks?.some((m: N) => m.type === 'bold')) &&
      two?.content?.[1]?.type === 'bulletList' && two?.content?.[2]?.type === 'heading', two?.content);
    check('document JSON round-trips', firstDiff(normalize(colsDoc), normalize(res.content)) === null,
      firstDiff(normalize(colsDoc), normalize(res.content)));
  });

  it('coalesces adjacent equal-attr fragments (columnsFlow page splits) into one section', async () => {
    const fragmented: N = {
      type: 'doc',
      content: [
        COLS({ count: 2, gapCm: 0.5 }, P(null, T('frag one a')), P(null, T('frag one b'))),
        COLS({ count: 2, gapCm: 0.5 }, P(null, T('frag two'))),
        COLS({ count: 3, gapCm: 0.5 }, P(null, T('other section'))),
        P(null, T('tail')),
      ],
    };
    const bytes = await buildOdt(fragmented, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('two sections emitted (chain merged, 3-col separate)',
      (xml.match(/<text:section /g) ?? []).length === 2, (xml.match(/<text:section /g) ?? []).length);

    const res = importOdt(bytes);
    const cols = (res.content.content ?? []).filter((n: N) => n.type === 'columns');
    check('chain reimports as one node with all three blocks',
      cols.length === 2 && cols[0]?.content?.length === 3 && cols[1]?.content?.length === 1,
      cols.map((n: N) => n.content?.length));
  });

  it('re-merges a page-boundary line-split paragraph (joinPrev) on export', async () => {
    const split: N = {
      type: 'doc',
      content: [
        COLS({ count: 2, gapCm: 0.5 },
          P(null, T('intact lead. ')),
          P(null, T('first half of the long paragraph ')),
        ),
        COLS({ count: 2, gapCm: 0.5 },
          P({ joinPrev: true }, T('second half of it.')),
          P(null, T('intact tail.')),
        ),
        P(null, T('after')),
      ],
    };
    const bytes = await buildOdt(split, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    check('split paragraph exported as ONE text:p',
      /first half of the long paragraph second half of it\./.test(xml.replace(/<[^>]+>/g, '')), null);
    check('one section, three paragraphs inside',
      (xml.match(/<text:section /g) ?? []).length === 1, null);

    const res = importOdt(bytes);
    const col = (res.content.content ?? []).find((n: N) => n.type === 'columns');
    check('reimports as one section with three paragraphs', col?.content?.length === 3, col?.content?.length);
    const texts = (col?.content ?? []).map((p: N) => (p.content ?? []).map((t: N) => t.text).join(''));
    check('merged paragraph text intact',
      texts[1] === 'first half of the long paragraph second half of it.', texts);
  });
});

describe('Leg 9: foreign multi-column sections → importOdt', () => {
  it('derives the gap from column indents, moves tables out, clamps counts, splices style-less sections', () => {
    const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
 <office:automatic-styles>
  <style:style style:name="Sect1" style:family="section">
   <style:section-properties style:editable="false">
    <style:columns fo:column-count="2">
     <style:column style:rel-width="4818*" fo:start-indent="0cm" fo:end-indent="0.25cm"/>
     <style:column style:rel-width="4818*" fo:start-indent="0.25cm" fo:end-indent="0cm"/>
    </style:columns>
   </style:section-properties>
  </style:style>
  <style:style style:name="Sect2" style:family="section">
   <style:section-properties>
    <style:columns fo:column-count="2" fo:column-gap="1cm"/>
   </style:section-properties>
  </style:style>
  <style:style style:name="Sect3" style:family="section">
   <style:section-properties>
    <style:columns fo:column-count="4" fo:column-gap="0.3cm"/>
   </style:section-properties>
  </style:style>
 </office:automatic-styles>
 <office:body><office:text>
  <text:section text:style-name="Sect1" text:name="S1">
   <text:p>lo col one</text:p>
   <text:p>lo col two</text:p>
  </text:section>
  <text:section text:style-name="Sect2" text:name="S2">
   <text:p>before table</text:p>
   <table:table>
    <table:table-column/>
    <table:table-row><table:table-cell><text:p>in table</text:p></table:table-cell></table:table-row>
   </table:table>
   <text:p>after table</text:p>
  </text:section>
  <text:section text:style-name="Sect3" text:name="S3">
   <text:p>four cols</text:p>
  </text:section>
  <text:section text:name="S4">
   <text:p>plain section text</text:p>
  </text:section>
 </office:text></office:body>
</office:document-content>`;
    const foreign = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'content.xml': [strToU8(contentXml), { level: 6 }],
    } as any);

    const f = importOdt(foreign);
    const c = f.content.content!;
    const cols = c.filter((n: N) => n.type === 'columns');
    check('4 columns nodes (S1, S2 split around the table, S3)', cols.length === 4, c.map((n: N) => n.type));

    const s1 = cols[0];
    check('S1: gap derived from column indents (0.25+0.25)', s1?.attrs?.count === 2 && s1?.attrs?.gapCm === 0.5, s1?.attrs);
    check('S1: both paragraphs inside', s1?.content?.length === 2 && s1?.content?.[0]?.content?.[0]?.text === 'lo col one', s1?.content);

    const s2idx = c.findIndex((n: N) => n.type === 'columns' && n.content?.[0]?.content?.[0]?.text === 'before table');
    check('S2: table moved out between two columns nodes',
      c[s2idx]?.attrs?.gapCm === 1 && c[s2idx + 1]?.type === 'table' &&
      c[s2idx + 2]?.type === 'columns' && c[s2idx + 2]?.content?.[0]?.content?.[0]?.text === 'after table',
      c.slice(s2idx, s2idx + 3).map((n: N) => n.type));
    check('S2: move-out warning reported',
      f.warnings.includes('Tables and text boxes inside a multi-column layout were moved out of the columns'), f.warnings);

    const s3 = cols[cols.length - 1];
    check('S3: count clamped to 3', s3?.attrs?.count === 3 && s3?.attrs?.gapCm === 0.3, s3?.attrs);
    check('S3: clamp warning reported', f.warnings.includes('Sections with more than 3 columns were reduced to 3 columns'), f.warnings);

    check('style-less section spliced to plain paragraphs',
      c.some((n: N) => n.type === 'paragraph' && n.content?.[0]?.text === 'plain section text'), c.map((n: N) => n.type));
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
    check('source spans all heading levels', content.includes(`<text:table-of-content-source text:outline-level="${MAX_HEADING_LEVEL}"`));
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

  // Listing deeper than the index asks for inflates it by whole pages; a title the file
  // doesn't have doubles the heading standing above it.
  it('round-trips the index depth and a title-less index', async () => {
    const shallow: N = { ...tocDoc, content: [
      { type: 'tableOfContents', attrs: { entries: [], title: '', maxLevel: 1 } },
      ...(tocDoc.content ?? []).slice(1),
    ] };
    const bytes = await buildOdt(shallow, margins, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    check('source stops at the index depth', content.includes('<text:table-of-content-source text:outline-level="1"'));
    check('one entry template only', (content.match(/<text:table-of-content-entry-template/g) ?? []).length === 1);
    check('no index title emitted', !content.includes('<text:index-title'));

    const toc = (importOdt(bytes).content.content ?? []).find((n: N) => n.type === 'tableOfContents');
    check('maxLevel survives', toc?.attrs?.maxLevel === 1, toc?.attrs);
    check('title stays empty', toc?.attrs?.title === '', toc?.attrs);
  });
});

describe('Leg 10: date/time fields (text:date / text:time)', () => {
  const DTF = (kind: string, format: string, fixed: boolean, value: string, marks?: N[]): N =>
    ({ type: 'dateTimeField', attrs: { kind, format, fixed, value }, ...(marks ? { marks } : {}) });
  const FONT = { type: 'textStyle', attrs: { fontFamily: 'Calibri' } };
  const dtDoc: N = {
    type: 'doc',
    content: [
      P(null, T('Signed on '), DTF('date', 'dmy_dots', true, '2026-07-08T14:30:45', [FONT]), T(' at '),
              DTF('time', 'hms24', true, '2026-07-08T14:30:45')),
      P(null, T('Printed: '), DTF('date', 'weekday_mdy', false, '2026-07-08T09:00:00')),
    ],
  };

  it('exports <text:date>/<text:time> with a minted number style and re-imports the fields', async () => {
    const bytes = await buildOdt(dtDoc, margins, 'portrait', undefined, { language: 'de', country: 'DE' });
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    check('emits <text:date>', content.includes('<text:date '), content.slice(0, 120));
    check('emits <text:time>', content.includes('<text:time '));
    check('fixed date carries text:fixed=true', /<text:date[^>]*text:fixed="true"/.test(content));
    check('auto date carries text:fixed=false', /<text:date[^>]*text:fixed="false"/.test(content));
    check('date-value present', content.includes('text:date-value="2026-07-08T14:30:45"'));
    check('time-value present', content.includes('text:time-value="PT14H30M45S"'));
    check('mints a number:date-style', content.includes('<number:date-style '));
    check('mints a number:time-style', content.includes('<number:time-style '));
    check('declares number namespace', content.includes('xmlns:number='));
    check('no leftover sentinel', !content.includes(''));

    const res = importOdt(bytes);
    const fields: N[] = [];
    (function walk(n: N) { if (n.type === 'dateTimeField') fields.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    check('3 date/time fields imported', fields.length === 3, fields.map((f) => f.attrs));
    const fixedDate = fields.find((f) => f.attrs.kind === 'date' && f.attrs.fixed);
    check('fixed date format round-trips', fixedDate?.attrs.format === 'dmy_dots', fixedDate?.attrs);
    check('fixed date value round-trips', fixedDate?.attrs.value === '2026-07-08T14:30:45', fixedDate?.attrs);
    // The field carries the surrounding font so the atom doesn't fall back to the
    // editor default (regression: DOCX date field imported without its font).
    const font = (fixedDate?.marks ?? []).find((m: N) => m.type === 'textStyle')?.attrs?.fontFamily;
    check('fixed date carries its font mark', font === 'Calibri', fixedDate?.marks);
    const fixedTime = fields.find((f) => f.attrs.kind === 'time');
    check('fixed time format round-trips', fixedTime?.attrs.format === 'hms24', fixedTime?.attrs);
    const autoDate = fields.find((f) => f.attrs.kind === 'date' && !f.attrs.fixed);
    check('auto date format round-trips', autoDate?.attrs.format === 'weekday_mdy', autoDate?.attrs);
    check('surrounding text preserved',
      (res.content.content ?? [])[0]?.content?.[0]?.text === 'Signed on ');
  });
});

describe('Leg 11: heading levels 4 and 5', () => {
  const doc: N = {
    type: 'doc',
    content: [H({ level: 4 }, T('Fourth')), H({ level: 5 }, T('Fifth'))],
  };

  it('exports Heading_20_4/5 at the editor sizes and re-imports the levels', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const files = unzipSync(bytes);
    const content = strFromU8(files['content.xml']);
    const styles = strFromU8(files['styles.xml']);
    check('h4 outline level', content.includes('text:outline-level="4"'), content.slice(0, 400));
    check('h5 outline level', content.includes('text:outline-level="5"'));
    check('Heading_20_4 sized 13pt',
      /style:name="Heading_20_4"[\s\S]*?fo:font-size="13pt"/.test(styles));
    check('Heading_20_5 sized 12pt',
      /style:name="Heading_20_5"[\s\S]*?fo:font-size="12pt"/.test(styles));

    const blocks = importOdt(bytes).content.content ?? [];
    check('h4 round-trips', blocks[0]?.type === 'heading' && blocks[0]?.attrs?.level === 4, blocks[0]);
    check('h5 round-trips', blocks[1]?.type === 'heading' && blocks[1]?.attrs?.level === 5, blocks[1]);
    // Sizes equal to the level defaults must not land as explicit fontSize marks.
    check('no explicit size mark on h4', !(blocks[0]?.content?.[0]?.marks ?? []).length, blocks[0]?.content);
    check('no explicit size mark on h5', !(blocks[1]?.content?.[0]?.marks ?? []).length, blocks[1]?.content);
  });
});

describe('Leg 12: named paragraph styles (ODF)', () => {
  const sheet = builtinStyleSheet();
  sheet.paragraph['Merksatz'] = {
    name: 'Merksatz', parent: 'Standard', next: 'Standard',
    para: { indent: 2, spaceBefore: 6 }, text: { bold: true, color: '#0000AA' },
  };

  const doc: N = {
    type: 'doc',
    content: [
      H({ level: 1 }, T('Kapitel')),
      P({ styleName: 'Merksatz' }, T('gemerkt')),
      // Hard formatting on top of the style must stay direct formatting.
      P({ styleName: 'Merksatz', spaceAfter: 20 }, T('mit Abstand')),
      P({ styleName: 'Quotations' }, T('zitiert')),
    ],
  };

  it('writes real named styles and round-trips the assignment', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', undefined, null, 'A4', sheet);
    const files = unzipSync(bytes);
    const styles = strFromU8(files['styles.xml']);
    const content = strFromU8(files['content.xml']);

    const merk = styles.match(/<style:style style:name="Merksatz"[\s\S]*?<\/style:style>/)?.[0] ?? '';
    check('mints the user style with its parent', merk.includes('style:parent-style-name="Standard"'), merk);
    check('user style carries its own props', merk.includes('fo:margin-left="2cm"') && merk.includes('fo:color="#0000AA"'), merk);
    check('heading styles inherit from Heading', /style:name="Heading_20_1"[\s\S]*?style:parent-style-name="Heading"/.test(styles));
    check('the Heading parent holds the sans font', /style:name="Heading"[\s\S]*?style:font-name="Arial"/.test(styles));
    check('no leftover sentinel', !content.includes('\uE00D'));

    const res = importOdt(bytes);
    const blocks = res.content.content ?? [];
    check('block references its style', blocks[1]?.attrs?.styleName === 'Merksatz', blocks[1]?.attrs);
    check('built-in style assignment round-trips', blocks[3]?.attrs?.styleName === 'Quotations', blocks[3]?.attrs);
    check('hard formatting stays direct', blocks[2]?.attrs?.spaceAfter === 20, blocks[2]?.attrs);
    check('style formatting is NOT copied onto the block', !blocks[1]?.content?.[0]?.marks, blocks[1]?.content?.[0]);

    const imported = res.styles.paragraph['Merksatz'];
    check('the style itself round-trips', imported?.parent === 'Standard', imported);
    check('with its own properties', imported?.text.bold === true && imported?.text.color === '#0000AA'
      && imported?.para.indent === 2 && imported?.para.spaceBefore === 6, imported);
    // A heading keeps rendering from the registry, not from copied attrs.
    check('heading needs no direct formatting', !blocks[0]?.content?.[0]?.marks, blocks[0]);
  });
});

describe('Leg 13: named character styles (ODF)', () => {
  const sheet = builtinStyleSheet();
  sheet.character['Signal'] = {
    name: 'Signal', parent: null, next: null, para: {}, text: { bold: true, color: '#CC0000' },
  };
  const CS = (text: string, name: string, ...extra: N[]): N =>
    ({ type: 'text', text, marks: [{ type: 'charStyle', attrs: { name } }, ...extra] });

  const doc: N = {
    type: 'doc',
    content: [P(null, T('plain '), CS('emphasised', 'Emphasis'), T(' and '), CS('signal', 'Signal', { type: 'italic' }))],
  };

  it('writes style:family="text" styles and round-trips the run assignment', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', undefined, null, 'A4', sheet);
    const files = unzipSync(bytes);
    const styles = strFromU8(files['styles.xml']);
    const content = strFromU8(files['content.xml']);

    check('mints the built-in Emphasis as a text style',
      /<style:style style:name="Emphasis" style:family="text"[\s\S]*?fo:font-style="italic"/.test(styles), styles.slice(0, 200));
    check('mints the user character style', /style:name="Signal" style:family="text"/.test(styles));
    // The run's span points at the style; its own formatting is baked alongside.
    check('run references the style via its automatic style',
      /<style:style style:name="TS\d+"[^>]*style:parent-style-name="Signal"/.test(content), content.slice(0, 400));
    check('no leftover sentinel', !content.includes('\uE00E'));

    const runs = (importOdt(bytes).content.content?.[0] as N).content as N[];
    const charOf = (r: N) => (r.marks ?? []).find((m: N) => m.type === 'charStyle')?.attrs?.name;
    check('plain run stays plain', !runs[0].marks, runs[0]);
    check('built-in style round-trips', charOf(runs[1]) === 'Emphasis', runs[1]);
    check('style formatting is not copied onto the run',
      (runs[1].marks ?? []).every((m: N) => m.type === 'charStyle'), runs[1]);
    const signal = runs.find((r: N) => charOf(r) === 'Signal');
    check('user style round-trips', !!signal, runs);
    check('direct formatting on top survives',
      (signal?.marks ?? []).some((m: N) => m.type === 'italic'), signal);
    const imported = importOdt(bytes).styles.character['Signal'];
    check('the character style itself round-trips',
      imported?.text.bold === true && imported?.text.color === '#CC0000', imported);
  });
});

describe('Leg 12: per-section page margins (ODT + DOCX)', () => {
  const secDoc: N = {
    type: 'doc',
    content: [
      P(null, T('first section')),
      P({ sectionBreak: true, breakBefore: 'page' }, T('second section')),
    ],
  };
  const wide = { top: 1, bottom: 1.91, left: 3.18, right: 2.41 };
  const sections = [
    { ...EMPTY_HF_SET },
    { ...EMPTY_HF_SET, margins: wide },
  ];

  it('ODT: the section gets a page layout of its own, shifted off the document one', async () => {
    const bytes = await buildOdt(secDoc, margins, 'portrait', { sections, pageCount: 2 });
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    check('section master points at its own layout', /<style:master-page style:name="Section2" style:page-layout-name="([^"]*)Sec2"/.test(styles), styles.slice(0, 200));
    const res = importOdt(bytes);
    check('document margins unchanged', JSON.stringify(res.margins) === JSON.stringify(margins), res.margins);
    const back = res.hfSections?.[1]?.margins ?? null;
    check('section margins round-trip', JSON.stringify(back) === JSON.stringify(wide), back);
  });

  it('DOCX: each sectPr carries its own w:pgMar', async () => {
    const bytes = await buildDocx(secDoc, margins, 'portrait', { sections, pageCount: 2 });
    const res = importDocx(bytes);
    check('document margins unchanged', JSON.stringify(res.margins) === JSON.stringify(margins), res.margins);
    const back = res.hfSections?.[1]?.margins ?? null;
    check('section margins round-trip', JSON.stringify(back) === JSON.stringify(wide), back);
  });
});

describe('Leg 13: document properties (meta.xml / docProps/core.xml)', () => {
  const propsDoc: N = { type: 'doc', content: [P(null, T('body'))] };
  const props = {
    title: 'Jahresbericht', subject: 'Finanzen', author: 'A. Muster',
    keywords: 'Bilanz, Prüfung', description: 'Entwurf & Vorlage',
  };

  it('ODT: meta.xml carries the fields and they come back', async () => {
    const bytes = await buildOdt(propsDoc, margins, 'portrait', undefined, null, 'A4',
      builtinStyleSheet(), 1.25, 'add', false, DEFAULT_NOTE_SETTINGS, props);
    const meta = strFromU8(unzipSync(bytes)['meta.xml']);
    check('dc:title', meta.includes('<dc:title>Jahresbericht</dc:title>'), meta);
    check('one meta:keyword per keyword', /<meta:keyword>Bilanz<\/meta:keyword><meta:keyword>Prüfung<\/meta:keyword>/.test(meta));
    check('ampersand escaped', meta.includes('Entwurf &amp; Vorlage'));
    check('generator is ours', meta.includes('<meta:generator>EdenText</meta:generator>'));
    const back = importOdt(bytes).props;
    check('round-trips whole', JSON.stringify(back) === JSON.stringify(props), back);
  });

  it('DOCX: docProps/core.xml carries the fields and they come back', async () => {
    const bytes = await buildDocx(propsDoc, margins, 'portrait', undefined, null, 'A4',
      builtinStyleSheet(), 1.25, 'add', false, DEFAULT_NOTE_SETTINGS, props);
    const back = importDocx(bytes).props;
    check('round-trips whole', JSON.stringify(back) === JSON.stringify(props), back);
  });

  it('an empty set leaves no fields behind', async () => {
    const bytes = await buildOdt(propsDoc, margins, 'portrait');
    const meta = strFromU8(unzipSync(bytes)['meta.xml']);
    check('no dc:title', !meta.includes('<dc:title>'), meta);
    const back = importOdt(bytes).props;
    check('all empty', Object.values(back).every((v) => v === ''), back);
  });
});

describe('Leg 14: automatic hyphenation', () => {
  const hDoc: N = { type: 'doc', content: [P(null, T('Silbentrennung'))] };
  const args = [margins, 'portrait', undefined, null, 'A4', builtinStyleSheet(), 1.25, 'add', false, DEFAULT_NOTE_SETTINGS, undefined] as const;

  it('ODT: fo:hyphenate rides the base style and comes back', async () => {
    const on = await buildOdt(hDoc, ...args, true);
    const styles = strFromU8(unzipSync(on)['styles.xml']);
    check('written into Standard\'s text properties', /style:name="Standard"[\s\S]*?<style:text-properties[^>]*fo:hyphenate="true"/.test(styles), styles.slice(0, 600));
    check('on round-trips', importOdt(on).hyphenate === true);
    const off = await buildOdt(hDoc, ...args, false);
    check('off writes nothing', !strFromU8(unzipSync(off)['styles.xml']).includes('fo:hyphenate'));
    check('off round-trips', importOdt(off).hyphenate === false);
  });

  it('DOCX: w:autoHyphenation rides settings.xml and comes back', async () => {
    const on = await buildDocx(hDoc, ...args, true);
    check('in settings.xml', strFromU8(unzipSync(on)['word/settings.xml']).includes('autoHyphenation'));
    check('on round-trips', importDocx(on).hyphenate === true);
    const off = await buildDocx(hDoc, ...args, false);
    check('off round-trips', importDocx(off).hyphenate === false);
  });
});

describe('Leg 15: page numbering (format + start value)', () => {
  const pnDoc: N = { type: 'doc', content: [P(null, T('erste Seite'))] };
  const args = [margins, 'portrait', undefined, null, 'A4', builtinStyleSheet(), 1.25, 'add', false, DEFAULT_NOTE_SETTINGS, undefined, false] as const;
  const roman = { format: 'i' as const, start: 7 };

  it('ODT: num-format rides the page layout, the start the first paragraph', async () => {
    const bytes = await buildOdt(pnDoc, ...args, roman);
    const files = unzipSync(bytes);
    check('num-format on the layout', strFromU8(files['styles.xml']).includes('style:num-format="i"'));
    check('start on the first paragraph', strFromU8(files['content.xml']).includes('style:page-number="7"'));
    const back = importOdt(bytes).pageNumbering;
    check('round-trips whole', JSON.stringify(back) === JSON.stringify(roman), back);
  });

  it('DOCX: w:pgNumType carries both', async () => {
    const bytes = await buildDocx(pnDoc, ...args, roman);
    check('in the sectPr', strFromU8(unzipSync(bytes)['word/document.xml']).includes('lowerRoman'));
    const back = importDocx(bytes).pageNumbering;
    check('round-trips whole', JSON.stringify(back) === JSON.stringify(roman), back);
  });

  it('the defaults write nothing', async () => {
    const bytes = await buildOdt(pnDoc, ...args, { format: '1', start: 1 });
    const files = unzipSync(bytes);
    check('no num-format on the layout', !/<style:page-layout-properties[^>]*style:num-format=/.test(strFromU8(files['styles.xml'])));
    check('no page-number', !strFromU8(files['content.xml']).includes('style:page-number='));
  });
});

describe('Leg 16: comments (office:annotation / w:comment)', () => {
  const CM = (text: string, attrs: N): N => T(text, { type: 'comment', attrs });
  const attrs = { id: 'c1', author: 'A. Muster', date: '2026-08-14T10:00:00.000Z', text: 'Bitte prüfen', resolved: false };
  const cDoc: N = { type: 'doc', content: [P(null, T('vor '), CM('markiert', attrs), T(' nach'))] };

  it('ODT: a named annotation brackets the text and comes back', async () => {
    const bytes = await buildOdt(cDoc, margins, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    check('annotation opens the range', content.includes('<office:annotation office:name="c1"'), content.slice(0, 300));
    check('carries the author', content.includes('<dc:creator>A. Muster</dc:creator>'));
    check('carries the body', content.includes('Bitte prüfen'));
    check('closes the range', content.includes('<office:annotation-end office:name="c1"/>'));
    check('no leftover sentinel', !/[]/.test(content));

    const back = importOdt(bytes).content as N;
    const runs = back.content[0].content as N[];
    const marked = runs.find((r: N) => r.marks?.some((m: N) => m.type === 'comment'));
    check('the marked run is the annotated text', marked?.text === 'markiert', runs.map((r: N) => r.text));
    const m = marked?.marks.find((x: N) => x.type === 'comment');
    check('attrs round-trip', m?.attrs.author === 'A. Muster' && m?.attrs.text === 'Bitte prüfen', m?.attrs);
    check('neighbours stay uncommented', runs.filter((r: N) => r.marks?.some((x: N) => x.type === 'comment')).length === 1);
  });

  it('DOCX: the range brackets the runs and word/comments.xml holds the body', async () => {
    const bytes = await buildDocx(cDoc, margins, 'portrait');
    const files = unzipSync(bytes);
    const doc = strFromU8(files['word/document.xml']);
    check('range start', doc.includes('<w:commentRangeStart'), doc.slice(0, 200));
    check('range end', doc.includes('<w:commentRangeEnd'));
    check('reference run', doc.includes('<w:commentReference'));
    check('comments part exists', !!files['word/comments.xml']);
    check('body in the part', strFromU8(files['word/comments.xml'] ?? new Uint8Array()).includes('Bitte prüfen'));

    const back = importDocx(bytes).content as N;
    const runs = back.content[0].content as N[];
    const marked = runs.find((r: N) => r.marks?.some((m: N) => m.type === 'comment'));
    check('the marked run is the annotated text', marked?.text === 'markiert', runs.map((r: N) => r.text));
    const m = marked?.marks.find((x: N) => x.type === 'comment');
    check('author and body round-trip', m?.attrs.author === 'A. Muster' && m?.attrs.text === 'Bitte prüfen', m?.attrs);
  });
});
