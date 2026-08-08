// LibreOffice round-trip leg: editor JSON -> buildOdt -> `soffice --convert-to odt`
// re-save -> importOdt -> compare. Requires soffice on PATH; the whole suite self-skips
// when it is absent (so plain `npm test` / CI stay green).
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';

type N = any;

function hasSoffice(): boolean {
  try { execSync('command -v soffice', { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const SOFFICE = hasSoffice();

function check(label: string, cond: boolean, detail?: unknown) {
  expect.soft(cond, detail !== undefined ? `${label} — ${JSON.stringify(detail)}` : label).toBe(true);
}

const T = (text: string, ...marks: N[]): N => ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const P = (attrs: N | null, ...content: N[]): N => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(content.length ? { content } : {}) });
const LI = (...content: N[]): N => ({ type: 'listItem', content });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMGN = (width: number, height: number, alt?: string, rotation?: number, wrap?: string): N =>
  ({ type: 'image', attrs: {
    src: PNG, width, height,
    ...(alt ? { alt } : {}), ...(rotation ? { rotation } : {}), ...(wrap ? { wrap } : {}),
  } });
const TBX = (attrs: N, ...content: N[]): N => ({ type: 'textBox', attrs, content });

const margins = { top: 3, bottom: 2, left: 2.5, right: 1.5 };

const fixture: N = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [T('LO Round Trip')] },
    P(null,
      T('Plain '),
      T('bold', { type: 'bold' }),
      T(' italic', { type: 'italic' }),
      T(' colored', { type: 'textStyle', attrs: { color: '#C00000' } }),
      T(' marked', { type: 'highlight', attrs: { color: '#FFFF00' } }),
      T(' arial14', { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '14pt' } }),
    ),
    // Character effects: LibreOffice must read back what we write for each of them.
    P(null,
      T('caps ', { type: 'textStyle', attrs: { caps: 'uppercase' } }),
      T('petite ', { type: 'textStyle', attrs: { caps: 'smallCaps' } }),
      T('dotted ', { type: 'underline', attrs: { lineStyle: 'dotted', lineColor: '#FF0000' } }),
      T('twice ', { type: 'underline', attrs: { lineStyle: 'double' } }),
      T('crossed ', { type: 'strike', attrs: { lineStyle: 'double' } }),
      // 4pt at 16pt is a whole 25%, the unit ODF stores it in — LibreOffice rounds
      // the percentage when it re-saves, so a fractional one comes back a notch off.
      T('raised', { type: 'textStyle', attrs: { fontSize: '16pt', textPosition: 4 } }),
    ),
    P({ textAlign: 'justify', lineHeight: '1.5', spaceBefore: 12, spaceAfter: 18 }, T('spaced')),
    P({ indent: 2.5 }, T('indented')),
    P(null, T('line one'), { type: 'hardBreak' }, T('line two')),
    P(null, T('logo: '), IMGN(100, 50, 'Logo')),
    P(null, T('rotated: '), IMGN(120, 80, 'Rotated', 30)),
    P(null, T('wrapped '), IMGN(90, 60, 'Float', 0, 'left'), T(' text beside it')),
    { type: 'orderedList', attrs: { listStyleType: 'upper-roman-paren' }, content: [
      LI(P(null, T('first'))),
      LI(P({ textAlign: 'center' }, T('centered'))),
    ] },
    { type: 'bulletList', attrs: { indent: 2.5 }, content: [
      LI(P(null, T('shifted a'))),
      LI(P(null, T('shifted b'))),
    ] },
    { type: 'bulletList', content: [
      LI(P(null, T('bullet')), { type: 'orderedList', attrs: { listStyleType: 'lower-alpha-paren' }, content: [
        LI(P(null, T('nested alpha'))),
      ] }),
    ] },
    { type: 'table', content: [
      { type: 'tableRow', attrs: { rowHeight: 60 }, content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [
          { type: 'heading', attrs: { level: 3 }, content: [T('Cell head')] },
          P(null, T('cell para')),
          { type: 'bulletList', content: [LI(P(null, T('cell bullet')))] },
        ] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [240] }, content: [P(null, T('B1'), IMGN(80, 40))] },
      ] },
      { type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [P(null, T('A2'))] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [240], borderTop: 'none', borderRight: '2.25pt solid #FF0000' }, content: [P(null, T('B2'))] },
      ] },
    ] },
    TBX({ width: 288, height: 96, fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1 },
      P(null, T('box text')), P(null, T('second para'))),
    TBX({ width: 192, height: 96, wrap: 'right', shapeKind: 'ellipse', fillColor: '#FFEE00', strokeColor: '#FF0000', strokeWidthPt: 2.25, rotation: 30 },
      P(null, T('in ellipse'))),
    P(null, T('The end.')),
  ],
};

// --- same normalization as roundtrip.test.ts, with LibreOffice unit-noise tolerances ---
const DEFAULTS: Record<string, unknown> = {
  textAlign: 'left', lineHeight: null, spaceBefore: null, spaceAfter: null,
  listStyleType: 'decimal', start: 1, rowHeight: null, colspan: 1, rowspan: 1, type: null,
  shapeKind: 'textbox', fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1,
};
function normalize(node: N): N {
  const out: N = { type: node.type };
  if (node.text != null) out.text = node.text;
  if (node.marks?.length) {
    out.marks = node.marks.map((m: N) => {
      const mm: N = { type: m.type };
      const attrs = Object.fromEntries(Object.entries(m.attrs ?? {}).filter(([, v]) => v != null));
      if (Object.keys(attrs).length) mm.attrs = attrs;
      return mm;
    }).sort((a: N, b: N) => a.type.localeCompare(b.type));
  }
  const attrs: N = {};
  for (const [k, v] of Object.entries(node.attrs ?? {})) {
    if (v == null || (k in DEFAULTS && DEFAULTS[k] === v)) continue;
    if (k === 'colwidth') { attrs.colwidth = 'CW'; continue; }
    if (k === 'rowHeight') { attrs.rowHeight = Math.round((v as number) / 3) * 3; continue; } // ±3px unit noise
    if (k === 'src') { attrs.src = 'IMG'; continue; } // LibreOffice may re-encode / rename the picture
    if (k === 'width' || k === 'height') { attrs[k] = Math.round((v as number) / 3) * 3; continue; } // ±unit noise
    if (k === 'rotation') { attrs.rotation = 'R'; continue; } // exact angle checked leniently below
    if (k === 'wrap') { attrs.wrap = 'W'; continue; } // float survives; exact mode checked leniently
    if (k === 'strokeWidthPt') { attrs.strokeWidthPt = Math.round((v as number) * 4) / 4; continue; } // pt↔in noise
    // Cell borders: LO re-saves widths with pt↔cm noise; quantize to 0.25pt steps.
    if (k.startsWith('border') && typeof v === 'string' && v !== 'none') {
      const bm = /^([\d.]+)pt solid (#[0-9A-F]{6})$/i.exec(v);
      if (bm) { attrs[k] = `${Math.round(parseFloat(bm[1]) * 4) / 4}pt solid ${bm[2].toUpperCase()}`; continue; }
    }
    if (k === 'fillColor' || k === 'strokeColor') { attrs[k] = typeof v === 'string' ? v.toUpperCase() : v; continue; }
    // LO re-parents text-box paragraphs onto its Frame-contents style (margin 0), so
    // an explicit spaceAfter 0 comes back where Standard's default was suppressed.
    if (k === 'spaceAfter' && v === 0) continue;
    attrs[k] = v;
  }
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (node.content?.length) {
    const mapped = node.content.map(normalize);
    // LibreOffice re-anchors paragraph-anchored (floating) frames to the paragraph
    // start; a float's inline position is visually meaningless, so canonicalize it.
    const isFloat = (c: N) => c.type === 'image' && c.attrs?.wrap;
    const ordered = [...mapped.filter(isFloat), ...mapped.filter((c: N) => !isFloat(c))];
    const kids: N[] = [];
    for (const c of ordered) {
      const prev = kids[kids.length - 1];
      if (prev && prev.type === 'text' && c.type === 'text' &&
          JSON.stringify(prev.marks ?? null) === JSON.stringify(c.marks ?? null)) prev.text += c.text;
      else kids.push(c);
    }
    out.content = kids;
  }
  return out;
}
function firstDiff(a: N, b: N, path = '$'): string | null {
  if (typeof a !== typeof b) return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (typeof a !== 'object' || a === null || b === null) {
    return Object.is(a, b) ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDiff(a[k], b[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}

// Generous per-test timeouts: a cold soffice start under a parallel `npm test`
// run easily exceeds vitest's 5s default.
describe.skipIf(!SOFFICE)('LibreOffice round-trip (needs soffice on PATH)', () => {
  it('survives a `soffice --convert-to odt` re-save of the body document', { timeout: 180000 }, async () => {
    const bytes = await buildOdt(fixture, margins, 'landscape');
    mkdirSync('/tmp/lo-rt', { recursive: true });
    writeFileSync('/tmp/lo-rt/doc.odt', bytes);

    execSync('soffice --headless --convert-to odt --outdir /tmp/lo-rt/out /tmp/lo-rt/doc.odt', { stdio: 'pipe', timeout: 120000 });
    const resaved = new Uint8Array(readFileSync('/tmp/lo-rt/out/doc.odt'));

    const res = importOdt(resaved);
    check('LO: no warnings', res.warnings.length === 0, res.warnings);
    check('LO: orientation', res.orientation === 'landscape', res.orientation);
    const m = res.margins!;
    check('LO: margins', !!m && Math.abs(m.top - 3) < 0.03 && Math.abs(m.bottom - 2) < 0.03 &&
      Math.abs(m.left - 2.5) < 0.03 && Math.abs(m.right - 1.5) < 0.03, m);

    const diff = firstDiff(normalize(fixture), normalize(res.content));
    check('LO: document JSON round-trips', diff === null, diff);

    // Rotation survives LibreOffice. Allow its 360-complement in case LO flips the sign.
    const imgs: N[] = [];
    (function walk(n: N) { if (n.type === 'image') imgs.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    const rot = imgs.find((i: N) => i.attrs?.rotation)?.attrs?.rotation ?? 0;
    check('LO: image rotation survives (~30°)', Math.abs(rot - 30) <= 2 || Math.abs(rot - 330) <= 2, rot);
    const floated = imgs.find((i: N) => i.attrs?.wrap && i.attrs.wrap !== 'inline');
    check('LO: image text-wrap survives', !!floated, imgs.map((i: N) => i.attrs?.wrap));

    // Text boxes: geometry, colors and shape kind must survive the LO re-save.
    const boxes = (res.content.content ?? []).filter((n: N) => n.type === 'textBox');
    check('LO: both text boxes survive', boxes.length === 2, (res.content.content ?? []).map((n: N) => n.type));
    const [plain, ellipse] = boxes;
    check('LO: box geometry survives (288×96)', Math.abs((plain?.attrs?.width ?? 0) - 288) <= 3 && Math.abs((plain?.attrs?.height ?? 0) - 96) <= 3, plain?.attrs);
    check('LO: box paragraphs survive', plain?.content?.length === 2, plain?.content);
    check('LO: ellipse kind + fill survive', ellipse?.attrs?.shapeKind === 'ellipse' && String(ellipse?.attrs?.fillColor).toUpperCase() === '#FFEE00', ellipse?.attrs);
    const brot = ellipse?.attrs?.rotation ?? 0;
    check('LO: ellipse rotation survives (~30°)', Math.abs(brot - 30) <= 2 || Math.abs(brot - 330) <= 2, brot);
    check('LO: ellipse wrap survives', !!ellipse?.attrs?.wrap && ellipse.attrs.wrap !== 'inline', ellipse?.attrs);
  });

  it('survives a `soffice` re-save of the header/footer geometry', { timeout: 180000 }, async () => {
    const header: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [
      T('Bericht ', { type: 'bold' }, { type: 'textStyle', attrs: { color: '#C00000' } }),
      T('2026'),
    ] }] };
    const footer: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
      T('Seite '), { type: 'pageNumber' }, T(' von '), { type: 'pageCount' },
    ] }] };
    const hfMargins = { top: 2.54, bottom: 2.54, left: 2, right: 2 };
    // Non-default edge distances must survive LibreOffice (they become the ODF page
    // margin; min-height fills the rest so the body stays at 2.54cm).
    const hfBytes = await buildOdt(fixture, hfMargins, 'portrait', { header, footer, pageCount: 4, headerDistanceCm: 0.8, footerDistanceCm: 1.6 });
    mkdirSync('/tmp/lo-rt', { recursive: true });
    writeFileSync('/tmp/lo-rt/hf.odt', hfBytes);
    execSync('soffice --headless --convert-to odt --outdir /tmp/lo-rt/hfout /tmp/lo-rt/hf.odt', { stdio: 'pipe', timeout: 120000 });
    const hfResaved = new Uint8Array(readFileSync('/tmp/lo-rt/hfout/hf.odt'));

    // Diagnostic: how LibreOffice rewrote the header/footer geometry.
    const loStyles = strFromU8(unzipSync(hfResaved)['styles.xml']);
    const geo = loStyles.match(/<style:(header|footer)-style>[\s\S]*?<\/style:\1-style>/g);
    console.log('  [LO header/footer geometry]', geo?.join(' ') ?? '(none)');

    const hfRes = importOdt(hfResaved);
    check('LO hf: header text + bold/color', !!hfRes.header && JSON.stringify(hfRes.header).includes('Bericht'), hfRes.header);
    check('LO hf: header right-aligned', hfRes.header?.content?.[0]?.attrs?.textAlign === 'right', hfRes.header?.content?.[0]?.attrs);
    const fPara = hfRes.footer?.content?.[0];
    check('LO hf: footer page-number field survives', fPara?.content?.some((n: N) => n.type === 'pageNumber'), fPara);
    check('LO hf: footer page-count field survives', fPara?.content?.some((n: N) => n.type === 'pageCount'), fPara);
    check('LO hf: footer centered', fPara?.attrs?.textAlign === 'center', fPara?.attrs);
    // The geometry trap: body margins must come back ≈ the originals (2.54cm).
    const hm = hfRes.margins!;
    check('LO hf: body top margin reconstructed ≈2.54', Math.abs((hm?.top ?? 0) - 2.54) < 0.1, hm);
    check('LO hf: body bottom margin reconstructed ≈2.54', Math.abs((hm?.bottom ?? 0) - 2.54) < 0.1, hm);
    // The configured edge distances survive LibreOffice.
    check('LO hf: header distance ≈0.8cm', Math.abs((hfRes.headerDistanceCm ?? 0) - 0.8) < 0.1, hfRes.headerDistanceCm);
    check('LO hf: footer distance ≈1.6cm', Math.abs((hfRes.footerDistanceCm ?? 0) - 1.6) < 0.1, hfRes.footerDistanceCm);
  });
});
