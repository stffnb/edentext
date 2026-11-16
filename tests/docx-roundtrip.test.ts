import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { builtinStyleSheet, resolveStyle } from '../src/lib/styles/styleSheet';
import { HEADER_SHADE } from '../src/lib/editor/extensions/tableHeaderRow';
import { effectUpdate } from '../src/lib/editor/extensions/textEffects';
import { Editor } from '@tiptap/core';
import { extensions } from '../src/lib/editor/extensions';

type N = { type: string; attrs?: any; content?: N[]; marks?: any[]; text?: string };

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';

const text = (t: string, marks?: any[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const para = (content: any, attrs: any = {}) => ({ type: 'paragraph', attrs, content: Array.isArray(content) ? content : [text(content)] });
const heading = (level: number, t: string, attrs: any = {}) => ({ type: 'heading', attrs: { level, ...attrs }, content: [text(t)] });
const li = (...content: any[]) => ({ type: 'listItem', content });
const cell = (t: string, attrs: any = {}) => ({ type: 'tableCell', attrs, content: [para(t)] });
const headerCell = (t: string, attrs: any = {}) => ({ type: 'tableHeader', attrs: { backgroundColor: HEADER_SHADE, ...attrs }, content: [para(t)] });

function walk(node: N, type: string, out: N[] = []): N[] {
  if (node.type === type) out.push(node);
  for (const c of node.content ?? []) walk(c, type, out);
  return out;
}
const hasMark = (n: N, type: string) => (n.marks ?? []).some((m: any) => m.type === type);
const markAttrs = (n: N, type: string) => (n.marks ?? []).find((m: any) => m.type === type)?.attrs;

describe('DOCX export → import round trip', () => {
  const fixture = {
    type: 'doc',
    content: [
      heading(1, 'Title', { textAlign: 'center' }),
      para([
        text('plain '),
        text('bold', [{ type: 'bold' }]),
        text(' '),
        text('red', [{ type: 'textStyle', attrs: { color: '#FF0000' } }]),
        text(' '),
        text('hi', [{ type: 'highlight', attrs: { color: '#00FF00' } }]),
        text(' '),
        text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      ], { spaceBefore: 6, spaceAfter: 6, lineHeight: '1.5', indent: 1 }),
      // Character effects: letter case, line shapes, a freely raised run.
      para([
        text('caps ', [{ type: 'textStyle', attrs: { caps: 'uppercase' } }]),
        text('petite ', [{ type: 'textStyle', attrs: { caps: 'smallCaps' } }]),
        text('dotted ', [{ type: 'underline', attrs: { lineStyle: 'dotted', lineColor: '#FF0000' } }]),
        text('crossed ', [{ type: 'strike', attrs: { lineStyle: 'double' } }]),
        text('stressed ', [{ type: 'textStyle', attrs: { emphasis: 'dot below' } }]),
        text('ringed ', [{ type: 'textStyle', attrs: { emphasis: 'circle above' } }]),
        text('outlined ', [{ type: 'textStyle', attrs: { outline: true } }]),
        text('shadowed ', [{ type: 'textStyle', attrs: { shadow: true } }]),
        text('both ', [{ type: 'textStyle', attrs: { outline: true, shadow: true } }]),
        text('embossed ', [{ type: 'textStyle', attrs: { relief: 'embossed' } }]),
        text('engraved ', [{ type: 'textStyle', attrs: { relief: 'engraved' } }]),
        text('rimmed ', [{ type: 'textStyle', attrs: { textOutline: { color: '#C00000', widthPt: 1.5 } } }]),
        text('cast ', [{ type: 'textStyle', attrs: { textShadow: { color: '#000000', alpha: 0.4, dxPt: 2.12, dyPt: 2.12, blurPt: 4 } } }]),
        text('glowing ', [{ type: 'textStyle', attrs: { color: '#FFFFFF', textGlow: { color: '#4472C4', alpha: 0.6, radiusPt: 5 }, textOutline: { color: '#2F5597', widthPt: 0.5 } } }]),
        text('haloed ', [{ type: 'textStyle', attrs: { textGlow: { color: '#ED7D31', alpha: 0.25, radiusPt: 40 } } }]),
        text('lit ', [{ type: 'textStyle', attrs: { textGlow: { color: '#70AD47', alpha: 1, radiusPt: 1.5 } } }]),
        text('spaced ', [{ type: 'textStyle', attrs: { letterSpacing: 1.5 } }]),
        text('boxed ', [{ type: 'textStyle', attrs: { textBorder: '1.5pt solid #FF0000', textBorderPadding: 4 } }]),
        text('raised', [{ type: 'textStyle', attrs: { fontSize: '14pt', textPosition: 3 } }]),
      ]),
      { type: 'paragraph', attrs: { fontSize: '22pt', textAlign: 'center' } }, // empty sized line
      para([text('a\tb')]),
      para([text('line1'), { type: 'hardBreak' }, text('line2')]),
      { type: 'bulletList', attrs: { bulletChar: '❖' }, content: [li(para('one')), li(para('two'), { type: 'bulletList', attrs: { bulletChar: '➢' }, content: [li(para('nested'))] })] },
      { type: 'orderedList', attrs: { listStyleType: 'lower-alpha' }, content: [li(para('alpha'))] },
      { type: 'orderedList', content: [li(para('cycle top'), { type: 'orderedList', content: [li(para('cycle sub'))] })] },
      { type: 'orderedList', attrs: { listStyleType: 'multilevel' }, content: [
        li(para('ml one'), { type: 'orderedList', content: [li(para('ml one-one'))] }),
        li(para('ml two')),
      ] },
      para([{ type: 'image', attrs: { src: PNG, width: 100, height: 80, wrap: 'left', wrapOffsetY: 2.5, alt: 'pic' } }]),
      para([{ type: 'textBox', attrs: { width: 288, height: 96, fillColor: '#FFFFFF', strokeColor: '#000000', strokeWidthPt: 1 }, content: [
        para('box text'),
        para([text('bold in box', [{ type: 'bold' }])]),
      ] }]),
      para([{ type: 'textBox', attrs: { width: 192, height: 96, wrap: 'right', wrapOffset: 6, wrapOffsetY: 1.5, shapeKind: 'ellipse', fillColor: '#FFEE00', strokeColor: '#FF0000', strokeWidthPt: 2.25, rotation: 30 }, content: [para('ellipse text')] }]),
      // Each closes a section: a blank line, and one holding only a recorded insertion.
      { type: 'paragraph' },
      { type: 'columns', attrs: { count: 2, gapCm: 0.8 }, content: [para('newspaper one'), para('newspaper two'),
        para([text('inserted', [{ type: 'insertion', attrs: { id: 'rv1', author: 'A', date: '2026-05-06T07:08:09' } }])])] },
      { type: 'table', content: [
        { type: 'tableRow', content: [headerCell('Name', { colwidth: [6] }), headerCell('Qty', { colwidth: [3] })] },
        { type: 'tableRow', attrs: { rowHeight: 40 }, content: [cell('Widget', { backgroundColor: '#FFFF00', rowspan: 2 }), cell('1', { borderTop: 'none', borderRight: '2.25pt solid #FF0000' })] },
        { type: 'tableRow', content: [cell('2')] },
      ] },
      heading(4, 'Fourth'),
      heading(5, 'Fifth'),
    ],
  } as any;

  const hf = {
    header: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'right' }, content: [text('My header')] }] },
    footer: { type: 'doc', content: [{ type: 'paragraph', content: [text('Page '), { type: 'pageNumber' }, text(' of '), { type: 'pageCount' }] }] },
    pageCount: 1,
  } as any;

  let doc: N;
  let result: any;
  let documentXml = '';
  it('imports without throwing', async () => {
    const bytes = await buildDocx(fixture, { top: 2.54, bottom: 2.54, left: 2.12, right: 2.12 }, 'portrait', hf, { language: 'en', country: 'US' });
    documentXml = strFromU8(unzipSync(bytes)['word/document.xml']);
    result = importDocx(bytes);
    doc = result.content;
    expect(doc.type).toBe('doc');
  });

  it('emits the columns region as its own continuous section with w:cols', () => {
    // Three sections: before / columns / after (each earlier sectPr rides an empty
    // paragraph's pPr; the last is the body-final one).
    expect(documentXml.match(/<w:sectPr/g)!.length).toBe(3);
    expect(documentXml).toMatch(/<w:cols[^>]*w:num="2"/);
    expect(documentXml).toMatch(/<w:cols[^>]*w:space="454"/); // 0.8cm in twips
    expect(documentXml.match(/<w:type w:val="continuous"\/>/g)!.length).toBe(2);
    // Word wants the page geometry repeated per sectPr.
    expect(documentXml.match(/<w:pgSz/g)!.length).toBe(3);
    expect(documentXml.match(/<w:pgMar/g)!.length).toBe(3);
    // The section's first sectPr references the header; the later column groups of the
    // same section name none and link to it (a reference of their own would make
    // LibreOffice switch page styles there, with a page break).
    const firstSect = documentXml.slice(documentXml.indexOf('<w:sectPr'), documentXml.indexOf('</w:sectPr>'));
    expect(firstSect).toContain('<w:headerReference');
    const finalSect = documentXml.slice(documentXml.lastIndexOf('<w:sectPr'));
    expect(finalSect).not.toContain('<w:headerReference');
  });

  it('coalesces adjacent equal-attr fragments (columnsFlow page splits) into one section', async () => {
    const fragmented = {
      type: 'doc',
      content: [
        para('lead'),
        { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [para('frag one a'), para('frag one b')] },
        { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [para('frag two')] },
        { type: 'columns', attrs: { count: 3, gapCm: 0.5 }, content: [para('other section')] },
        para('tail'),
      ],
    } as any;
    const bytes = await buildDocx(fragmented);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml.match(/<w:sectPr/g)!.length).toBe(4); // lead / merged 2-col / 3-col / tail
    const res = importDocx(bytes).content as N;
    const cols = walk(res, 'columns');
    expect(cols.map((c) => c.content!.length)).toEqual([3, 1]);
    expect(cols[0].attrs.count).toBe(2);
    expect(cols[1].attrs.count).toBe(3);
  });

  it('round-trips a named table style (w:tblStyle + a name-only definition)', async () => {
    const cell = (t: string, bg?: string, region?: string): N => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null, ...(bg ? { backgroundColor: bg } : {}), ...(region ? { region } : {}) },
      content: [para(t)],
    });
    const doc = {
      type: 'doc',
      content: [{
        type: 'table',
        attrs: { tableStyle: 'Box List Blue' },
        content: [
          { type: 'tableRow', content: [cell('Kopf', '#4A7EBB', 'headerRow')] },
          { type: 'tableRow', content: [cell('Zeile')] },
        ],
      }],
    } as any;
    const bytes = await buildDocx(doc);
    const files = unzipSync(bytes);
    const xml = strFromU8(files['word/document.xml']);
    const stylesXml = strFromU8(files['word/styles.xml']);
    expect(xml).toContain('<w:tblStyle w:val="BoxListBlue"');
    expect(stylesXml).toContain('w:type="table"');
    expect(stylesXml, 'the imported style is a direct w:styles child').not.toContain('<undefined');
    // The header region's white bold is presentational in the editor, baked here.
    expect(xml).toContain('<w:color w:val="FFFFFF"');
    // The style paints every border via the cells; a black table-level default would
    // show in Word, whose table borders beat a cell's "none" (only "nil" loses).
    const tblPr = /<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(xml)![0];
    expect(tblPr).not.toContain('w:val="single"');

    const res = importDocx(bytes).content as N;
    const table = walk(res, 'table')[0];
    expect(table.attrs.tableStyle).toBe('Box List Blue');
    expect(table.content![0].content![0].attrs.backgroundColor).toBe('#4A7EBB');
  });

  it('defines Title and Heading1-6 exactly once, chain intact, defaults kept', async () => {
    // The table forces a spliced table style — which used to replace the library's
    // whole factory set, w:docDefaults (default font/size/language) included.
    const doc = { type: 'doc', content: [heading(1, 'Kapitel'), para('Text'), {
      type: 'table', attrs: { tableStyle: 'Box List Blue' },
      content: [{ type: 'tableRow', content: [cell('Zelle')] }],
    }] } as any;
    const files = unzipSync(await buildDocx(doc));
    const stylesXml = strFromU8(files['word/styles.xml']);
    const ids = [...stylesXml.matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]);
    // A second definition under the same id makes Word and LO drop the basedOn chain.
    expect(ids.length).toBe(new Set(ids).size);
    expect(stylesXml).toMatch(/w:styleId="Heading1"><w:name w:val="Heading 1"\/><w:basedOn w:val="Heading"\/>/);
    expect(stylesXml).toContain('<w:docDefaults>');
    expect(stylesXml).toContain('w:styleId="BoxListBlue"');
  });

  it('round-trips the table style options as w:tblLook', async () => {
    const cell = (t: string): N => ({
      type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para(t)],
    });
    const doc = {
      type: 'doc',
      content: [{
        type: 'table',
        attrs: { tableStyle: 'Box List Blue', tableLook: 'lastRow headerRow' },
        content: [
          { type: 'tableRow', content: [cell('Kopf')] },
          { type: 'tableRow', content: [cell('Summe')] },
        ],
      }],
    } as any;
    const bytes = await buildDocx(doc);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    // Word inverts the band flags, so both are switched off here.
    expect(xml).toMatch(/<w:tblLook[^>]*w:firstRow="true"/);
    expect(xml).toMatch(/<w:tblLook[^>]*w:lastRow="true"/);
    expect(xml).toMatch(/<w:tblLook[^>]*w:noHBand="true"/);

    const table = walk(importDocx(bytes).content as N, 'table')[0];
    expect(table.attrs.tableLook).toBe('lastRow headerRow');
  });

  it('re-merges a page-boundary split paragraph and table (joinPrev) on export', async () => {
    const split = {
      type: 'doc',
      content: [
        { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [para('first half ')] },
        { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [
          { type: 'paragraph', attrs: { joinPrev: true }, content: [text('second half.')] },
          para('tail'),
          { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para('row one')] }] }] },
        ] },
        { type: 'columns', attrs: { count: 2, gapCm: 0.5 }, content: [
          { type: 'table', attrs: { joinPrev: true }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [para('row two')] }] }] },
        ] },
      ],
    } as any;
    const bytes = await buildDocx(split);
    const res = importDocx(bytes).content as N;
    const cols = walk(res, 'columns');
    expect(cols.length).toBe(1);
    expect(cols[0].content!.map((n) => n.type)).toEqual(['paragraph', 'paragraph', 'table']);
    expect(walk(cols[0], 'tableRow').length).toBe(2);
    expect(walk(cols[0].content![0], 'text').map((t) => t.text).join('')).toBe('first half second half.');
  });

  it('round-trips the columns section (count + gap + content, marker dropped)', () => {
    const cols = walk(doc, 'columns');
    expect(cols.length).toBe(1);
    expect(cols[0].attrs.count).toBe(2);
    expect(cols[0].attrs.gapCm).toBe(0.8);
    const texts = walk(cols[0], 'text').map((t) => t.text);
    expect(texts).toEqual(['newspaper one', 'newspaper two', 'inserted']);
    // The section-break markers are dropped; a block of the document's own that closes a
    // section is kept, also an empty one, and stays on its side of the boundary.
    const at = doc.content!.indexOf(cols[0]);
    expect(doc.content![at - 1]).toMatchObject({ type: 'paragraph' });
    expect(doc.content![at - 1].content).toBeUndefined();
    const paras = walk(doc, 'paragraph');
    expect(paras.filter((p) => !p.content && !p.attrs?.fontSize).length).toBe(1);
  });

  it('round-trips headings + paragraph block attrs', () => {
    const h = doc.content![0];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(1);
    expect(h.attrs.textAlign).toBe('center');
    const p = doc.content![1];
    expect(p.attrs.spaceBefore).toBe(6);
    expect(p.attrs.spaceAfter).toBe(6);
    expect(p.attrs.lineHeight).toBe('1.5');
    expect(p.attrs.indent).toBe(1);
  });

  it('round-trips heading levels 4 and 5', () => {
    const heads = walk(doc, 'heading').filter((h) => h.attrs.level >= 4);
    expect(heads.map((h) => h.attrs.level)).toEqual([4, 5]);
    // Their style sizes are the level defaults, so no explicit size mark survives.
    expect(heads.every((h) => !(h.content![0].marks ?? []).length)).toBe(true);
  });

  it('round-trips an empty line\'s font size (paragraph-mark size)', () => {
    const empty = doc.content!.find((n) => n.type === 'paragraph' && !n.content && n.attrs?.fontSize);
    expect(empty).toBeTruthy();
    expect(empty!.attrs.fontSize).toBe('22pt');
  });

  it('round-trips run marks (bold, color, highlight, link)', () => {
    const texts = walk(doc, 'text');
    expect(hasMark(texts.find((t) => t.text === 'bold')!, 'bold')).toBe(true);
    expect(markAttrs(texts.find((t) => t.text === 'red')!, 'textStyle').color).toBe('#FF0000');
    expect(markAttrs(texts.find((t) => t.text === 'hi')!, 'highlight').color).toBe('#00FF00');
    expect(markAttrs(texts.find((t) => t.text === 'site')!, 'link').href).toBe('https://example.com');
  });

  it('round-trips tabs and hard breaks', () => {
    expect(walk(doc, 'text').some((t) => t.text!.includes('\t'))).toBe(true);
    expect(walk(doc, 'hardBreak').length).toBeGreaterThan(0);
  });

  it('reconstructs nested bullet lists and an ordered list type', () => {
    const bullets = walk(doc, 'bulletList');
    const top = bullets.find((b) => b.content!.length === 2)!;
    expect(top).toBeTruthy();
    // second item carries a nested bulletList with the "nested" paragraph
    const nested = top.content![1].content!.find((c) => c.type === 'bulletList')!;
    expect(nested).toBeTruthy();
    expect(walk(nested, 'text')[0].text).toBe('nested');
    // Custom bullet chars survive via w:lvlText
    expect(top.attrs?.bulletChar).toBe('❖');
    expect(nested.attrs?.bulletChar).toBe('➢');
    const ol = walk(doc, 'orderedList')[0];
    expect(ol.attrs.listStyleType).toBe('lower-alpha');
  });

  it('round-trips depth-default and multilevel numbering', () => {
    const ols = walk(doc, 'orderedList');
    // Attr-less nesting: exports 1. / a. and re-imports as null (cycle suppression).
    const cycleTop = ols.find((o) => walk(o, 'text').some((t) => t.text === 'cycle top'))!;
    expect(cycleTop.attrs?.listStyleType ?? null).toBe(null);
    const cycleSub = walk(cycleTop, 'orderedList').find((o) => o !== cycleTop)!;
    expect(cycleSub.attrs?.listStyleType ?? null).toBe(null);
    // Multilevel: "%1.%2." chain lvlText → attr on the top list only.
    const mlTop = ols.find((o) => walk(o, 'text').some((t) => t.text === 'ml one'))!;
    expect(mlTop.attrs?.listStyleType).toBe('multilevel');
    const mlSub = walk(mlTop, 'orderedList').find((o) => o !== mlTop)!;
    expect(mlSub.attrs?.listStyleType ?? null).toBe(null);
  });

  it('round-trips the character effects (case, line shapes, emphasis, outline, shadow, relief, raised run)', () => {
    const runs = walk(doc, 'text');
    const of = (t: string) => runs.find((r: N) => r.text === t)!.marks!;
    const attrs = (t: string, type: string) => of(t).find((m: N) => m.type === type)!.attrs!;
    expect(attrs('caps ', 'textStyle').caps).toBe('uppercase');
    expect(attrs('petite ', 'textStyle').caps).toBe('smallCaps');
    expect(attrs('dotted ', 'underline')).toMatchObject({ lineStyle: 'dotted', lineColor: '#FF0000' });
    expect(attrs('crossed ', 'strike').lineStyle).toBe('double');
    expect(attrs('raised', 'textStyle').textPosition).toBe(3);
    expect(attrs('spaced ', 'textStyle').letterSpacing).toBe(1.5);
    expect(attrs('boxed ', 'textStyle')).toMatchObject({ textBorder: '1.5pt solid #FF0000', textBorderPadding: 4 });
    expect(documentXml).toMatch(/<w:em w:val="underDot"\/>/);
    expect(attrs('stressed ', 'textStyle').emphasis).toBe('dot below');
    expect(attrs('ringed ', 'textStyle').emphasis).toBe('circle above');
    expect(attrs('outlined ', 'textStyle')).toMatchObject({ outline: true });
    expect(attrs('shadowed ', 'textStyle')).toMatchObject({ shadow: true });
    expect(attrs('both ', 'textStyle')).toMatchObject({ outline: true, shadow: true });
    expect(attrs('embossed ', 'textStyle').relief).toBe('embossed');
    expect(attrs('engraved ', 'textStyle').relief).toBe('engraved');
    expect(attrs('rimmed ', 'textStyle').textOutline).toEqual({ color: '#C00000', widthPt: 1.5 });
    expect(attrs('cast ', 'textStyle').textShadow).toEqual({ color: '#000000', alpha: 0.4, dxPt: 2.12, dyPt: 2.12, blurPt: 4 });
    expect(attrs('glowing ', 'textStyle')).toMatchObject({ textGlow: { color: '#4472C4', alpha: 0.6, radiusPt: 5 }, textOutline: { color: '#2F5597', widthPt: 0.5 } });
    // Glow transparency is w14:alpha, written only below full opacity.
    expect(attrs('haloed ', 'textStyle').textGlow).toEqual({ color: '#ED7D31', alpha: 0.25, radiusPt: 40 });
    expect(attrs('lit ', 'textStyle').textGlow).toEqual({ color: '#70AD47', alpha: 1, radiusPt: 1.5 });
    expect(documentXml).toMatch(/<w14:glow w14:rad="508000">(?:(?!<\/w14:glow>)[^])*<w14:alpha w14:val="75000"\/>/);
    expect(documentXml).toMatch(/<w14:glow w14:rad="19050">(?:(?!w14:alpha)[^])*?<\/w14:glow>/);
    // Drawn exactly, so nothing is kept aside; w14 is declared ignorable and closes w:rPr.
    expect(runs.some((r: N) => markAttrs(r, 'textStyle')?.textFxRaw)).toBe(false);
    expect(documentXml).toMatch(/mc:Ignorable="[^"]*\bw14\b/);
    expect(documentXml).toMatch(/<w14:glow [^]*?<\/w14:glow><w14:textOutline [^]*?<\/w14:textOutline><\/w:rPr>/);
  });

  // Word's own markup, as [MS-DOCX] defines it, put into one run each.
  const W14_RUNS: [string, string, (a: any) => void][] = [
    ['a theme colour becomes a fixed one',
      '<w14:glow w14:rad="63500"><w14:schemeClr w14:val="accent1"><w14:lumMod w14:val="50000"/><w14:alpha w14:val="60000"/></w14:schemeClr></w14:glow>',
      (a) => { expect(a.textGlow).toEqual({ color: '#223962', alpha: 0.4, radiusPt: 5 }); expect(a.textFxRaw ?? null).toBe(null); }],
    ['reflection and 3D are kept as they came',
      '<w14:reflection w14:blurRad="6350" w14:stA="55000" w14:stPos="0" w14:endA="300" w14:endPos="45500" w14:dist="0" w14:dir="5400000" w14:fadeDir="5400000" w14:sx="100000" w14:sy="-100000" w14:kx="0" w14:ky="0" w14:algn="bl"/><w14:props3d w14:extrusionH="57150" w14:contourW="0" w14:prstMaterial="warmMatte"/>',
      (a) => expect(a.textFxRaw.map((e: any) => e.n)).toEqual(['reflection', 'props3d'])],
    ['a skewed shadow is drawn plain and kept as it came',
      '<w14:shadow w14:blurRad="50800" w14:dist="38100" w14:dir="5400000" w14:sx="100000" w14:sy="30000" w14:kx="-800400" w14:ky="0" w14:algn="bl"><w14:srgbClr w14:val="000000"/></w14:shadow>',
      (a) => { expect(a.textShadow).toMatchObject({ dxPt: 0, dyPt: 3, blurPt: 4 }); expect(a.textFxRaw[0]).toMatchObject({ n: 'shadow', a: { sy: '30000' } }); }],
  ];
  it.each(W14_RUNS)("reads Word's text effects: %s", async (_label, w14, check) => {
    const files = unzipSync(await buildDocx({ type: 'doc', content: [para('a')] }));
    files['word/theme/theme1.xml'] ??= strToU8('<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="x"><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
    let xml = strFromU8(files['word/document.xml']).replace(/<w:r>/, `<w:r><w:rPr>${w14}</w:rPr>`);
    if (!xml.includes('xmlns:w14=')) xml = xml.replace('<w:document ', '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ');
    files['word/document.xml'] = strToU8(xml);
    const imported = importDocx(zipSync(files)).content as N;
    const a = markAttrs(walk(imported, 'text')[0], 'textStyle');
    check(a);
    // Whatever was kept goes back unchanged; an effect changed in the editor drops its rest.
    const again = strFromU8(unzipSync(await buildDocx(imported as never))['word/document.xml']);
    for (const e of a.textFxRaw ?? []) expect(again).toContain(`<w14:${e.n} `);
    const changed = effectUpdate(a, { textShadow: null, textGlow: null });
    expect((changed.textFxRaw ?? []).some((e: any) => e.n === 'shadow' || e.n === 'glow')).toBe(false);
  });

  // A paste can nest tables deeper than a cell is wide; both files keep every level.
  it('saves tables nested deeper than their cells are wide', async () => {
    let t: N = { type: 'table', content: [{ type: 'tableRow', content: [cell('a'), cell('b'), cell('c')] }] };
    for (let i = 0; i < 6; i++) t = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: {}, content: [para('x'), t, para('y')] }, cell('b'), cell('c')] }] };
    const doc = { type: 'doc', content: [t] };
    const depth = (n: N): number => (n.content ?? []).reduce((d, c) => Math.max(d, depth(c)), 0) + (n.type === 'table' ? 1 : 0);
    expect(depth(importDocx(await buildDocx(doc as never)).content as N)).toBe(7);
    expect(depth(importOdt(await buildOdt(doc as never)).content as N)).toBe(7);
  });

  // What the commands or a paste put on a run is what a saved file reads back, whatever came in.
  it('holds the colour and effects a command or a paste sets as a saved file reads them back', async () => {
    const el = document.createElement('div');
    const editor = new Editor({ element: el, extensions, content: { type: 'doc', content: [para('abcdef')] } });
    try {
      const at = (from: number, to: number) => editor.chain().setTextSelection({ from, to });
      at(1, 3).setTextOutline({ color: '#c00000', widthPt: 33.333 }).run();
      at(2, 5).setTextShadow({ color: '#abc', alpha: 0.6666, dxPt: -1.005, dyPt: 2.12345, blurPt: 3.3333 }).run();
      at(4, 7).setTextGlow({ color: '#2f5597', alpha: 0.333, radiusPt: 151 }).run();
      // A browser serializes a copied span's colour as rgb().
      editor.chain().setTextSelection(7).insertContent('<span style="color: rgb(192, 0, 0)" data-text-glow=\'{"color":"#ffc000","alpha":0.5,"radiusPt":8}\'>pasted</span>').run();
      const fx = (doc: N) => walk(doc, 'text').map((r: N) => {
        const a = markAttrs(r, 'textStyle') ?? {};
        return [r.text, a.color ?? null, a.textOutline ?? null, a.textShadow ?? null, a.textGlow ?? null];
      });
      const held = editor.getJSON() as N;
      expect(fx(held).filter(([, ...e]) => e.some(Boolean))).toHaveLength(6);
      expect(fx(importDocx(await buildDocx(held as never)).content as N)).toEqual(fx(held));
      const colors = (doc: N) => fx(doc).flatMap(([t, c]) => [...(t as string)].map(() => c));
      expect(colors(importOdt(await buildOdt(held as never)).content as N)).toEqual(colors(held));
    } finally { editor.destroy(); }
  });

  it("reads Word's emphasis marks as LibreOffice does", async () => {
    const files = unzipSync(await buildDocx({ type: 'doc', content: [para('a'), para('b')] }));
    const vals = ['dot', 'none'];
    let i = 0;
    files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace(/<w:r>/g, () => `<w:r><w:rPr><w:em w:val="${vals[i++]}"/></w:rPr>`));
    const runs = walk(importDocx(zipSync(files)).content, 'text');
    expect(runs.map((r: N) => markAttrs(r, 'textStyle')?.emphasis ?? null)).toEqual(['dot above', null]);
  });

  it('round-trips the image (size + floating wrap)', () => {
    const img = walk(doc, 'image')[0];
    expect(img.attrs.width).toBe(100);
    expect(img.attrs.height).toBe(80);
    expect(img.attrs.wrap).toBe('left');
    expect(img.attrs.wrapOffsetY).toBe(2.5); // positionV posOffset, paragraph-relative
    expect(img.attrs.src.startsWith('data:image/png')).toBe(true);
  });

  it('round-trips text boxes: geometry, shape kind, fill/stroke, wrap, rotation', () => {
    const boxes = walk(doc, 'textBox');
    expect(boxes.length).toBe(2);
    const [plain, ellipse] = boxes;
    expect(plain.attrs.width).toBe(288);
    expect(plain.attrs.height).toBe(96);
    // Editor defaults (white fill, 1pt black stroke, no wrap/kind) are suppressed.
    expect(plain.attrs.fillColor).toBeUndefined();
    expect(plain.attrs.strokeColor).toBeUndefined();
    expect(plain.attrs.shapeKind).toBeUndefined();
    expect(plain.content!.length).toBe(2);
    expect(hasMark(walk(plain, 'text')[1], 'bold')).toBe(true);
    expect(ellipse.attrs.shapeKind).toBe('ellipse');
    expect(ellipse.attrs.wrap).toBe('right');
    expect(ellipse.attrs.wrapOffset).toBeCloseTo(6, 1);
    expect(ellipse.attrs.wrapOffsetY).toBeCloseTo(1.5, 1);
    expect(ellipse.attrs.rotation).toBe(30);
    expect(ellipse.attrs.fillColor).toBe('#FFEE00');
    expect(ellipse.attrs.strokeColor).toBe('#FF0000');
    expect(ellipse.attrs.strokeWidthPt).toBe(2.25);
  });

  it('round-trips the table: header shade, merged cell, covered-cell drop, row height', () => {
    const table = walk(doc, 'table')[0];
    const rows = table.content!;
    expect(rows.length).toBe(3);
    // header cells keep the shade and are NOT over-marked bold (CSS renders them)
    const headerCells = rows[0].content!;
    expect(headerCells[0].attrs.backgroundColor).toBe(HEADER_SHADE);
    expect(hasMark(walk(headerCells[0], 'text')[0], 'bold')).toBe(false);
    // rowspan reconstructed from vMerge; the covered cell in row 3 is dropped
    const widget = rows[1].content![0];
    expect(widget.attrs.rowspan).toBe(2);
    expect(widget.attrs.backgroundColor).toBe('#FFFF00');
    expect(rows[2].content!.length).toBe(1);
    expect(rows[1].attrs.rowHeight).toBe(40);
    // per-side borders (w:tcBorders): hidden top + custom red right; defaults stay null
    const qty = rows[1].content![1];
    expect(qty.attrs.borderTop).toBe('none');
    expect(qty.attrs.borderRight).toBe('2.25pt solid #FF0000');
    expect(qty.attrs.borderBottom ?? null).toBe(null);
    expect(widget.attrs.borderTop ?? null).toBe(null);
  });

  it('round-trips page geometry + header/footer with page fields', () => {
    expect(result.orientation).toBe('portrait');
    expect(result.margins.top).toBeCloseTo(2.54, 1);
    expect(result.margins.left).toBeCloseTo(2.12, 1);
    expect(walk(result.header, 'text')[0].text).toBe('My header');
    expect(result.header.content[0].attrs.textAlign).toBe('right');
    expect(walk(result.footer, 'pageNumber').length).toBe(1);
    expect(walk(result.footer, 'pageCount').length).toBe(1);
  });
});

// A margin in twips comes back as the same twip, and one typed in cm as typed.
it('keeps a page margin to the twip', async () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph' }] };
  const out = await buildDocx(doc as never, { top: 2.5, bottom: 2.5, left: 3.175, right: 3.175 });
  const again = importDocx(out);
  expect([again.margins.top, again.margins.left]).toEqual([2.5, 3.175]);
  const xml = strFromU8(unzipSync(await buildDocx(doc as never, again.margins))['word/document.xml']);
  expect(xml).toMatch(/<w:pgMar [^>]*w:left="1800"/);
});

describe('DOCX different first page (w:titlePg)', () => {
  const fixture: N = { type: 'doc', content: [para('Body')] };
  // Arial 10pt on the runs and the page-field atoms, so the field digits keep the font.
  const arial = [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '10pt' } }];
  const hf = {
    header: { type: 'doc', content: [para('Default header')] },
    footer: { type: 'doc', content: [para([text('Seite ', arial), { type: 'pageNumber', marks: arial }, text(' von ', arial), { type: 'pageCount', marks: arial }])] },
    headerFirst: { type: 'doc', content: [para('Cover header')] },
    footerFirst: { type: 'doc', content: [para('Stand 2025')] },
    differentFirstPage: true,
    pageCount: 3,
  } as any;

  it('emits w:titlePg + first-type header/footer refs and round-trips the variants', async () => {
    const bytes = await buildDocx(fixture, undefined, 'portrait', hf, { language: 'de', country: 'DE' });
    const documentXml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(documentXml).toContain('<w:titlePg');
    expect(documentXml).toMatch(/<w:headerReference[^>]*w:type="first"/);
    expect(documentXml).toMatch(/<w:footerReference[^>]*w:type="first"/);

    const res = importDocx(bytes);
    expect(res.differentFirstPage).toBe(true);
    expect(walk(res.header, 'text')[0].text).toBe('Default header');
    expect(walk(res.footer, 'pageNumber').length).toBe(1);
    expect(walk(res.headerFirst, 'text')[0].text).toBe('Cover header');
    expect(walk(res.footerFirst, 'text')[0].text).toBe('Stand 2025');
    // The page-field atom keeps the run's font (Arial 10pt) so its digits match the text.
    const pn = walk(res.footer, 'pageNumber')[0];
    expect(markAttrs(pn, 'textStyle')).toMatchObject({ fontFamily: 'Arial', fontSize: '10pt' });
  });

  it('keeps trailing blank lines (empty footer paragraphs) as hardBreaks', async () => {
    const br = (): N => ({ type: 'hardBreak' });
    const withBlanks = {
      ...hf,
      footerFirst: { type: 'doc', content: [para([text('Stand 2025'), br(), br()])] },
    } as any;
    const bytes = await buildDocx(fixture, undefined, 'portrait', withBlanks, { language: 'de', country: 'DE' });
    const res = importDocx(bytes);
    const inline = res.footerFirst.content[0].content as N[];
    expect(inline.filter((n) => n.type === 'hardBreak').length).toBe(2);
    expect(inline[inline.length - 1].type).toBe('hardBreak');
  });

  it('round-trips an inline image in the default footer and the first-page header', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';
    const image = (w: number, h: number): N => ({ type: 'image', attrs: { src: PNG, alt: 'Logo', width: w, height: h, wrap: 'inline' } });
    const withImgs = {
      ...hf,
      footer: { type: 'doc', content: [para([text('Logo '), image(120, 48)])] },
      headerFirst: { type: 'doc', content: [para([image(200, 60)])] },
    } as any;
    const res = importDocx(await buildDocx(fixture, undefined, 'portrait', withImgs, { language: 'de', country: 'DE' }));
    const fi = walk(res.footer, 'image');
    const hi = walk(res.headerFirst, 'image');
    expect(fi.length).toBe(1);
    expect(hi.length).toBe(1);
    expect(String(fi[0].attrs.src)).toMatch(/^data:image\//);
    expect(Math.abs(fi[0].attrs.width - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(fi[0].attrs.height - 48)).toBeLessThanOrEqual(2);
  });

  it('round-trips odd/even page variants (w:evenAndOddHeaders + even refs)', async () => {
    const withEven = {
      ...hf,
      headerEven: { type: 'doc', content: [para('Even header')] },
      footerEven: { type: 'doc', content: [para('Even footer')] },
      differentOddEven: true,
    } as any;
    const bytes = await buildDocx(fixture, undefined, 'portrait', withEven, { language: 'de', country: 'DE' });
    const files = unzipSync(bytes);
    expect(strFromU8(files['word/settings.xml'])).toContain('evenAndOddHeaders');
    expect(strFromU8(files['word/document.xml'])).toMatch(/<w:headerReference[^>]*w:type="even"/);
    const res = importDocx(bytes);
    expect(res.differentOddEven).toBe(true);
    expect(walk(res.headerEven, 'text')[0].text).toBe('Even header');
    expect(walk(res.footerEven, 'text')[0].text).toBe('Even footer');
    // default + first still intact.
    expect(walk(res.header, 'text')[0].text).toBe('Default header');
    expect(walk(res.headerFirst, 'text')[0].text).toBe('Cover header');
  });

  it('omits titlePg and first-page zones when the flag is off', async () => {
    const bytes = await buildDocx(fixture, undefined, 'portrait', { ...hf, differentFirstPage: false }, { language: 'de', country: 'DE' });
    const documentXml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(documentXml).not.toContain('<w:titlePg');
    const res = importDocx(bytes);
    expect(res.differentFirstPage).toBe(false);
    expect(res.headerFirst).toBeNull();
    expect(res.footerFirst).toBeNull();
  });
});

describe('DOCX date/time fields', () => {
  const dtf = (kind: string, format: string, fixed: boolean, value: string): N =>
    ({ type: 'dateTimeField', attrs: { kind, format, fixed, value } });
  const doc: N = { type: 'doc', content: [
    para([text('Auto '), dtf('date', 'dmy_dots', false, '2026-07-08T00:00:00')]),
    para([text('Fixed '), dtf('date', 'mdy_long', true, '2026-07-08T14:30:00')]),
    para([text('Time '), dtf('time', 'hm24', false, '2026-07-08T14:30:00')]),
  ] };

  it('exports an auto field as a DATE fldSimple and a fixed field as text', async () => {
    const bytes = await buildDocx(doc, undefined, 'portrait', undefined, { language: 'de', country: 'DE' });
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toMatch(/<w:fldSimple[^>]*w:instr="[^"]*DATE[^"]*dd\.MM\.yyyy/);
    expect(xml).toMatch(/<w:fldSimple[^>]*w:instr="[^"]*TIME[^"]*HH:mm/);
    // The fixed field has no fldSimple wrapper — just a plain run rendered in the
    // document language (German month name here).
    expect(xml).toContain('Juli 8, 2026');
    expect(xml).not.toMatch(/<w:fldSimple[^>]*>[^<]*<w:r><w:t[^>]*>Juli/);
  });

  it('re-imports the auto DATE/TIME fields as live dateTimeField nodes', async () => {
    const bytes = await buildDocx(doc, undefined, 'portrait', undefined, { language: 'de', country: 'DE' });
    const res = importDocx(bytes).content as N;
    const fields = walk(res, 'dateTimeField');
    expect(fields.map((f: N) => f.attrs.format).sort()).toEqual(['dmy_dots', 'hm24']);
    expect(fields.every((f: N) => f.attrs.fixed === false)).toBe(true);
  });
});

describe('DOCX import of a foreign Word document', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Foreign Title</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Wingdings diamond</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>Courier hollow</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Legal one</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr></w:pPr><w:r><w:t>Legal one-one</w:t></w:r></w:p>
    <w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid>
      <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="480" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:rFonts w:ascii="Arial"/></w:rPr></w:style>
  </w:styles>`;
  const numberingXml = `<?xml version="1.0"?><w:numbering ${W}>
    <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="1">
      <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF076;"/><w:rPr><w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/></w:rPr></w:lvl>
      <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:lvl>
    </w:abstractNum>
    <w:abstractNum w:abstractNumId="2">
      <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
      <w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl>
    </w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
    <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
    <w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
  </w:numbering>`;

  const bytes = zipSync({
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/numbering.xml': strToU8(numberingXml),
  });
  const result = importDocx(bytes);
  const doc = result.content as N;

  it('resolves a heading via its style chain (style-only run props)', () => {
    const h = doc.content![0];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(1);
    const t = walk(h, 'text')[0];
    expect(hasMark(t, 'bold')).toBe(false); // heading bold is presentational
    // The style's own formatting stays in the style registry, not on the block.
    expect(t.marks ?? []).toEqual([]);
    expect(h.attrs.spaceBefore).toBeUndefined();
    const style = result.styles.paragraph['Heading 1'];
    expect(style.text.fontSizePt).toBe(20);   // w:sz 40
    expect(style.para.spaceBefore).toBe(24);  // 480 twips
    expect(style.para.spaceAfter).toBe(6);    // 120 twips
  });

  it('maps Word symbol-font bullets and suppresses the default cycle', () => {
    const bullets = walk(doc, 'bulletList');
    const top = bullets.find((b) => walk(b, 'text').some((t) => t.text === 'Wingdings diamond'))!;
    expect(top).toBeTruthy();
    expect(top.attrs?.bulletChar).toBe('❖'); // Wingdings U+F076
    const nested = walk(top, 'bulletList').find((b) => b !== top)!;
    expect(walk(nested, 'text')[0].text).toBe('Courier hollow');
    expect(nested.attrs?.bulletChar).toBe('o'); // Word's hollow bullet is the letter, as LO draws it
  });

  it("imports Word's legal numbering (%1.%2.) as a multilevel list", () => {
    const ols = walk(doc, 'orderedList');
    const top = ols.find((o) => walk(o, 'text').some((t) => t.text === 'Legal one'))!;
    expect(top.attrs?.listStyleType).toBe('multilevel');
    const sub = walk(top, 'orderedList').find((o) => o !== top)!;
    expect(sub.attrs?.listStyleType ?? null).toBe(null);
  });

  it('reconstructs a numbered list and a vertically-merged table', () => {
    expect(walk(doc, 'orderedList').filter((o) => walk(o, 'text').some((t) => t.text === 'First')).length).toBe(1);
    const rows = walk(doc, 'table')[0].content!;
    expect(rows[0].content![0].attrs.rowspan).toBe(2); // vMerge restart → rowspan
    expect(rows[1].content!.length).toBe(1); // covered cell dropped
    expect(result.margins.top).toBeCloseTo(2.54, 1);
  });
});

describe('DOCX import: empty line keeps its paragraph-mark font size', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // An empty paragraph whose only formatting is the paragraph mark (w:pPr/w:rPr) — 44
  // half-points = 22pt, like a title's blank spacer lines. And a plain empty paragraph.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:sz w:val="44"/></w:rPr></w:pPr></w:p>
    <w:p><w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:pPr></w:p>
    <w:p/>
    <w:p><w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:pPr><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>big </w:t></w:r><w:r><w:t>plain</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) });
  const doc = importDocx(bytes).content as N;

  it('carries the 22pt paragraph-mark size onto the empty line', () => {
    const p = doc.content![0];
    expect(p.type).toBe('paragraph');
    expect(p.content).toBeUndefined(); // still empty
    expect(p.attrs.fontSize).toBe('22pt');
    expect(p.attrs.textAlign).toBe('center');
  });

  it('suppresses a paragraph-mark size equal to the body default (10pt without w:sz)', () => {
    expect(doc.content![1].attrs?.fontSize ?? null).toBeNull();
    expect(doc.content![2].attrs?.fontSize ?? null).toBeNull();
  });

  it('keeps a run without w:sz at the style size, not the mark size', () => {
    const plain = doc.content![3].content!.find((t) => t.text === 'plain')!;
    expect(plain.marks?.find((m) => m.type === 'textStyle')?.attrs?.fontSize).toBe('10pt');
  });
});

describe('run letter spacing against its style', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // A style spaces its letters 2pt; one run resets that to 0, another widens it.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Wide"/></w:pPr><w:r><w:t xml:space="preserve">style </w:t></w:r><w:r><w:rPr><w:spacing w:val="0"/></w:rPr><w:t xml:space="preserve">reset </w:t></w:r><w:r><w:rPr><w:spacing w:val="60"/></w:rPr><w:t>wider</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Narrow"/></w:pPr><w:r><w:t>narrow</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Wide"><w:name w:val="Wide"/><w:rPr><w:spacing w:val="40"/></w:rPr></w:style>
    <w:style w:type="paragraph" w:styleId="Narrow"><w:name w:val="Narrow"/><w:basedOn w:val="Wide"/><w:rPr><w:spacing w:val="0"/></w:rPr></w:style>
  </w:styles>`;
  const res = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml), 'word/styles.xml': strToU8(stylesXml) }));
  const spacing = (doc: N, text: string) => walk(doc, 'text').find((t) => t.text === text)?.marks?.find((m) => m.type === 'textStyle')?.attrs?.letterSpacing;
  const expectRuns = (doc: N, styles = res.styles) => {
    expect(resolveStyle(styles, 'Narrow').text.letterSpacingPt).toBe(0);
    expect(spacing(doc, 'style ')).toBeUndefined();
    expect(spacing(doc, 'reset ')).toBe(0);
    expect(spacing(doc, 'wider')).toBe(3);
  };

  it('keeps a run\'s own spacing, a reset to 0 included, through both formats', async () => {
    expect(res.styles.paragraph['Wide'].text.letterSpacingPt).toBe(2);
    expectRuns(res.content as N);
    const sheet = res.styles;
    for (const back of [importDocx(await buildDocx(res.content as N, undefined, undefined, undefined, undefined, 'A4', sheet)),
      importOdt(await buildOdt(res.content as N, undefined, undefined, undefined, undefined, 'A4', sheet))]) expectRuns(back.content as N, back.styles);
  });
});

describe('paragraph rules: w:between groups', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const side = (n: string, c: string) => `<w:${n} w:val="single" w:sz="8" w:space="1" w:color="${c}"/>`;
  const grouped = (t: string) => `<w:p><w:pPr><w:pBdr>${side('top', '000000')}${side('bottom', '000000')}${side('between', 'FF0000')}</w:pBdr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>${['a', 'b', 'c', 'd'].map(grouped).join('')}<w:p><w:r><w:t>after</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`;
  const res = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
  // LibreOffice draws the group with the top rule first, the between rule above each
  // later paragraph and the bottom rule last, none of them merged (probed).
  const expectGroup = (doc: N) => {
    const rules = doc.content!.slice(0, 5).map((p) => [p.attrs?.borderTop ?? null, p.attrs?.borderBottom ?? null, p.attrs?.borderJoin ?? null]);
    expect(rules).toEqual([
      ['1pt solid #000000', null, false], ['1pt solid #FF0000', null, false], ['1pt solid #FF0000', null, false],
      ['1pt solid #FF0000', '1pt solid #000000', false], [null, null, null],
    ]);
  };

  it('draws the between rule inside the group and survives both formats', async () => {
    expectGroup(res.content as N);
    expectGroup(importDocx(await buildDocx(res.content as N)).content as N);
    expectGroup(importOdt(await buildOdt(res.content as N)).content as N);
  });
});

describe('list levels LibreOffice reads literally', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // No w:start (LibreOffice numbers from 0, probed) and a hang 14 twips off the default.
  const numberingXml = `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="374"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const item = (t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>${item('zero')}${item('one')}<w:sectPr/></w:body></w:document>`;
  const res = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml), 'word/numbering.xml': strToU8(numberingXml),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>') }));
  const expectList = (doc: N) => {
    const list = walk(doc, 'orderedList')[0];
    expect(list.attrs?.start).toBe(0);
    expect(list.attrs?.hanging).toBeCloseTo(0.66, 2);
  };

  it('starts a level without w:start at 0 and keeps a hang near the default, in both formats', async () => {
    expectList(res.content as N);
    expectList(importDocx(await buildDocx(res.content as N)).content as N);
    expectList(importOdt(await buildOdt(res.content as N)).content as N);
  });
});

describe('DOCX import: alignment inherited from a paragraph style', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // The default paragraph style (Standard) sets justify; body paragraphs and a heading
  // based on it inherit it. A direct w:jc still wins over the style.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:r><w:t>Inherits justify from Standard</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Direct center wins</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading based on Standard</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Direct left wins</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:style w:type="paragraph" w:default="1" w:styleId="Standard"><w:name w:val="Normal"/><w:pPr><w:jc w:val="both"/></w:pPr></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  </w:styles>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/styles.xml': strToU8(stylesXml) });
  const res = importDocx(bytes);
  const doc = res.content as N;

  it('keeps the default style\'s justify in the style, not on the block', () => {
    expect(doc.content![0].attrs?.textAlign).toBeUndefined();
    expect(res.styles.paragraph['Standard'].para.textAlign).toBe('justify');
  });
  it('lets a direct w:jc override the style, the page\'s own edge too', async () => {
    expect(doc.content![1].attrs.textAlign).toBe('center');
    expect(doc.content![3].attrs.textAlign).toBe('left');
    const odt = importOdt(await buildOdt(doc, undefined, 'portrait', undefined, null, 'A4', res.styles));
    expect((odt.content as N).content[3].attrs.textAlign).toBe('left');
  });
  it('leaves a heading based on the default style free of direct alignment', () => {
    expect(doc.content![2].type).toBe('heading');
    expect(doc.content![2].attrs.textAlign).toBeUndefined();
    // It inherits justify through Heading 1 → Standard in the registry instead.
    expect(res.styles.paragraph['Heading 1'].parent).toBe('Standard');
  });
});

describe('DOCX import resolves theme fonts (Word default = Calibri)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  // No explicit w:ascii anywhere — the font lives only in the theme, like a real Word doc.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults>
  </w:styles>`;
  const themeXml = `<?xml version="1.0"?><a:theme ${A}><a:themeElements><a:fontScheme>
    <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
    <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
  </a:fontScheme></a:themeElements></a:theme>`;

  const bytes = zipSync({
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/theme/theme1.xml': strToU8(themeXml),
  });
  const doc = importDocx(bytes).content as N;

  it('tags body text with the theme body font instead of the editor default', () => {
    const t = walk(doc, 'text')[0];
    expect(t.text).toBe('Body text');
    expect(markAttrs(t, 'textStyle')?.fontFamily).toBe('Calibri');
  });
});

describe('DOCX import falls back to the theme font when nothing references it', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  // No w:rFonts anywhere (not even a theme ref): Word uses the theme minor font as the
  // implicit body default and the major one for headings — the file's fonts, not ours.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:r><w:t>Body text</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading text</w:t></w:r></w:p>
  </w:body></w:document>`;
  const themeXml = `<?xml version="1.0"?><a:theme ${A}><a:themeElements><a:fontScheme>
    <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
    <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
  </a:fontScheme></a:themeElements></a:theme>`;

  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/theme/theme1.xml': strToU8(themeXml) });
  const doc = importDocx(bytes).content as N;

  it('applies the theme minor font to body text with no font of its own', () => {
    const t = walk(doc.content![0], 'text')[0];
    expect(t.text).toBe('Body text');
    expect(markAttrs(t, 'textStyle')?.fontFamily).toBe('Calibri');
  });
  it('applies the theme major font to a heading with no font of its own', () => {
    const h = doc.content![1];
    expect(h.type).toBe('heading');
    expect(markAttrs(walk(h, 'text')[0], 'textStyle')?.fontFamily).toBe('Calibri Light');
  });
});

describe('DOCX import detects headings by outline level (non-"HeadingN" style ids)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // A heading style whose id is NOT "Heading1" — only its w:outlineLvl marks it a heading.
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Titel1"/></w:pPr><w:r><w:t>Localised heading</w:t></w:r></w:p>
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
  </w:body></w:document>`;
  const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
    <w:style w:type="paragraph" w:styleId="Standard"><w:name w:val="Standard"/></w:style>
    <w:style w:type="paragraph" w:styleId="Titel1"><w:basedOn w:val="Standard"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  </w:styles>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/styles.xml': strToU8(stylesXml) });
  const doc = importDocx(bytes).content as N;

  it('maps an outline-level-0 paragraph to heading 1', () => {
    const h = doc.content![0];
    expect(h.type).toBe('heading');
    expect(h.attrs.level).toBe(1);
    expect(walk(h, 'text')[0].text).toBe('Localised heading');
  });
});

describe('DOCX import of foreign text boxes / shapes', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const MC = 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
  const WPNS = 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const ANS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const WPSNS = 'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const VNS = 'xmlns:v="urn:schemas-microsoft-com:vml"';

  it('imports a Word-style mc:AlternateContent-wrapped wps text box (Choice only, no VML double-import)', () => {
    // Real Word structure: mc:Choice carries the DrawingML shape, mc:Fallback a VML copy.
    const documentXml = `<?xml version="1.0"?><w:document ${W} ${MC} ${WPNS} ${ANS} ${WPSNS} ${VNS}><w:body>
      <w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>
        <wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="2" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">
          <wp:simplePos x="0" y="0"/>
          <wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH>
          <wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>
          <wp:extent cx="1828800" cy="914400"/>
          <wp:wrapSquare wrapText="left"/>
          <wp:docPr id="7" name="Textfeld 7"/>
          <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
            <wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr>
              <a:xfrm rot="1800000"><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>
              <a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>
              <a:solidFill><a:srgbClr val="CCFFCC"/></a:solidFill>
              <a:ln w="28575"><a:solidFill><a:srgbClr val="003300"/></a:solidFill></a:ln>
            </wps:spPr>
            <wps:txbx><w:txbxContent>
              <w:p><w:r><w:t>choice text</w:t></w:r></w:p>
              <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>bold line</w:t></w:r></w:p>
            </w:txbxContent></wps:txbx>
            <wps:bodyPr/></wps:wsp>
          </a:graphicData></a:graphic>
        </wp:anchor>
      </w:drawing></mc:Choice><mc:Fallback><w:pict>
        <v:rect style="width:144pt;height:72pt" fillcolor="#ccffcc"><v:textbox><w:txbxContent><w:p><w:r><w:t>choice text</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect>
      </w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>anchor text</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const boxes = walk(result.content as N, 'textBox');
    expect(boxes.length).toBe(1); // the VML fallback must not double-import
    const b = boxes[0];
    expect(b.attrs.shapeKind).toBe('roundRect');
    expect(b.attrs.width).toBe(192); // 1828800 EMU
    expect(b.attrs.height).toBe(96);
    expect(b.attrs.wrap).toBe('right'); // text left ⇒ box right
    expect(b.attrs.rotation).toBe(30);
    expect(b.attrs.fillColor).toBe('#CCFFCC');
    expect(b.attrs.strokeColor).toBe('#003300');
    expect(b.attrs.strokeWidthPt).toBe(2.25); // 28575 EMU
    expect(walk(b, 'text').map((t) => t.text)).toEqual(['choice text', 'bold line']);
    expect(hasMark(walk(b, 'text')[1], 'bold')).toBe(true);
    // The anchor paragraph's own text survives, the box follows it at top level.
    expect(walk(result.content as N, 'text').some((t) => t.text === 'anchor text')).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('imports a legacy VML-only text box (w:pict)', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W} ${VNS}><w:body>
      <w:p><w:r><w:pict>
        <v:oval style="width:144pt;height:72pt" fillcolor="#ffee00" strokecolor="#ff0000" strokeweight="2.25pt">
          <v:textbox><w:txbxContent><w:p><w:r><w:t>vml text</w:t></w:r></w:p></w:txbxContent></v:textbox>
        </v:oval>
      </w:pict></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const boxes = walk(result.content as N, 'textBox');
    expect(boxes.length).toBe(1);
    const b = boxes[0];
    expect(b.attrs.shapeKind).toBe('ellipse');
    expect(b.attrs.width).toBe(192); // 144pt
    expect(b.attrs.height).toBe(96);
    expect(b.attrs.fillColor).toBe('#FFEE00');
    expect(b.attrs.strokeColor).toBe('#FF0000');
    expect(b.attrs.strokeWidthPt).toBe(2.25);
    expect(walk(b, 'text')[0].text).toBe('vml text');
  });

  // Word writes the same placement two ways: VML (older files, watermarks) and DrawingML.
  // Both forms of one placement and effect must read as the same frame.
  describe('a VML picture reads as its DrawingML counterpart', () => {
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const PIC = 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const picture = (run: string, type = 'image') => {
      const res = importDocx(zipSync({
        'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${W} ${VNS} ${WPNS} ${ANS} ${PIC} ${WPSNS} ${R} xmlns:w10="urn:schemas-microsoft-com:office:word"><w:body>
          <w:p><w:r>${run}</w:r></w:p>
          <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`),
        'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + '<Relationship Id="rImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/a.png"/></Relationships>'),
        'word/media/a.png': Uint8Array.from(atob(PNG.split(',')[1]), (c) => c.charCodeAt(0)),
      }));
      return walk(res.content as N, type)[0]?.attrs;
    };
    const vml = (style: string, inner = '', data = '') => picture(`<w:pict><v:shape style="position:absolute;width:144pt;height:72pt;${style}">${inner}<v:imagedata r:id="rImg"${data}/></v:shape></w:pict>`);
    const dml = (attrs: string, h: string, v: string, wrap: string, effect = '') => picture(`<w:drawing><wp:anchor ${attrs}>
      <wp:positionH relativeFrom="${h.split(':')[0]}">${posOf(h)}</wp:positionH><wp:positionV relativeFrom="${v.split(':')[0]}">${posOf(v)}</wp:positionV>
      <wp:extent cx="1828800" cy="914400"/>${wrap}<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rImg">${effect}</a:blip></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`);
    const posOf = (p: string) => { const v = p.split(':')[1]; return /^-?\d+$/.test(v) ? `<wp:posOffset>${v}</wp:posOffset>` : `<wp:align>${v}</wp:align>`; };
    it.each([
      ['centred on the text area, behind the text, washed out',
        () => vml('z-index:-1;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin', '', ' gain="19661f" blacklevel="22938f"'),
        () => dml('behindDoc="1"', 'margin:center', 'margin:center', '<wp:wrapNone/>', '<a:lum bright="70000" contrast="-70000"/>')],
      ['set off the page corner, in front of the text',
        () => vml('margin-left:36pt;margin-top:72pt;mso-position-horizontal-relative:page;mso-position-vertical-relative:page'),
        () => dml('behindDoc="0"', 'page:457200', 'page:914400', '<wp:wrapNone/>')],
      ['aligned right with text wrapping beside it',
        () => vml('mso-position-horizontal:right;mso-position-horizontal-relative:margin', '<w10:wrap type="square"/>'),
        () => dml('behindDoc="0"', 'margin:right', 'paragraph:0', '<wp:wrapSquare wrapText="bothSides"/>')],
    ])('%s', (_label, fromVml, fromDml) => {
      const a = fromVml(), b = fromDml();
      expect(a?.wrap).toBeTruthy();
      expect({ ...a, src: undefined }).toEqual({ ...b, src: undefined });
    });
    // A text box takes the same placement; its fill and line have defaults of their own.
    it('places a text box the same way', () => {
      const text = '<w:txbxContent><w:p><w:r><w:t>box</w:t></w:r></w:p></w:txbxContent>';
      const place = (a: N) => Object.fromEntries(Object.entries(a ?? {}).filter(([k]) => /^(wrap|inFront)/.test(k)));
      const a = place(picture(`<w:pict><v:rect style="position:absolute;width:144pt;height:72pt;z-index:-1;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:bottom;mso-position-vertical-relative:page"><v:textbox>${text}</v:textbox></v:rect></w:pict>`, 'textBox'));
      const b = place(picture(`<w:drawing><wp:anchor behindDoc="1"><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH>
        <wp:positionV relativeFrom="page"><wp:align>bottom</wp:align></wp:positionV><wp:extent cx="1828800" cy="914400"/><wp:wrapNone/>
        <a:graphic><a:graphicData><wps:wsp><wps:spPr><a:prstGeom prst="rect"/></wps:spPr><wps:txbx>${text}</wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing>`, 'textBox'));
      expect(a.wrap).toBe('through');
      expect(a).toEqual(b);
    });
  });

  it('drops unsupported shapes, and keeps a chart as a placeholder of its size', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W} ${WPNS} ${ANS} ${WPSNS}><w:body>
      <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Star"/>
        <a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
          <wps:wsp><wps:spPr><a:prstGeom prst="noSuchPreset"><a:avLst/></a:prstGeom></wps:spPr><wps:bodyPr/></wps:wsp>
        </a:graphicData></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="914400" cy="914400"/><wp:docPr id="2" name="Chart"/>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic>
      </wp:inline></w:drawing></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    expect(walk(result.content as N, 'textBox').length).toBe(0);
    expect(result.warnings).toContain('Unsupported shapes were removed');
    expect(result.warnings).toContain('Charts and other drawings were replaced by a placeholder');
    // The chart keeps the box it reserves (914400 EMU = 96px), so pagination holds.
    const ph = walk(result.content as N, 'image');
    expect(ph.length).toBe(1);
    expect(ph[0].attrs.width).toBe(96);
    expect(ph[0].attrs.height).toBe(96);
    // The wrong "images could not be read" warning must NOT appear for shapes.
    expect(result.warnings).not.toContain('Some images could not be read and were skipped');
  });
});

describe('DOCX table of contents (TOC field) round trip', () => {
  const tocDoc = {
    type: 'doc',
    content: [
      { type: 'tableOfContents', attrs: { entries: [
        { text: 'Alpha', level: 1, page: 1 },
        { text: 'Beta', level: 2, page: 2 },
      ] } },
      heading(1, 'Alpha'),
      para('body of alpha'),
      heading(2, 'Beta'),
    ],
  };

  it('exports a TOC field (updateFields) and re-imports it as a tableOfContents node', async () => {
    const bytes = await buildDocx(tocDoc as any);
    const files = unzipSync(bytes);
    const docXml = strFromU8(files['word/document.xml']);
    expect(/\bTOC\b/.test(docXml)).toBe(true);
    const settings = files['word/settings.xml'];
    expect(settings ? strFromU8(settings).includes('updateFields') : false).toBe(true);

    const res = importDocx(bytes).content as N;
    const tocs = walk(res, 'tableOfContents');
    expect(tocs.length).toBe(1);
    // Headings survive alongside the TOC.
    const headings = walk(res, 'heading');
    expect(headings.map(h => walk(h, 'text')[0]?.text)).toEqual(['Alpha', 'Beta']);
  });
});

describe('DOCX import of foreign multi-column sections', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  it('wraps a mid-body continuous section with w:cols and drops the empty marker paragraph', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:r><w:t>intro text</w:t></w:r></w:p>
      <w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:pPr></w:p>
      <w:p><w:r><w:t>col one</w:t></w:r></w:p>
      <w:p><w:r><w:t>col two</w:t></w:r></w:p>
      <w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/><w:cols w:num="2" w:space="708"/></w:sectPr></w:pPr></w:p>
      <w:p><w:r><w:t>outro text</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const doc = result.content as N;

    const cols = walk(doc, 'columns');
    expect(cols.length).toBe(1);
    expect(cols[0].attrs.count).toBe(2);
    expect(cols[0].attrs.gapCm).toBe(1.25); // 708 twips
    expect(walk(cols[0], 'text').map((t) => t.text)).toEqual(['col one', 'col two']);
    // A sectPr paragraph closes the group before it: intro (single-col) / columns /
    // trailing outro on the body-final sectPr. Empty markers are dropped.
    const top = doc.content!.map((n) => n.type);
    expect(top).toEqual(['paragraph', 'columns', 'paragraph']);
    expect(walk(doc.content![0], 'text')[0].text).toBe('intro text');
    expect(walk(doc.content![2], 'text')[0].text).toBe('outro text');
  });

  it('keeps a text-bearing sectPr paragraph and clamps >3 columns', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:r><w:t>kept marker text</w:t></w:r><w:pPr><w:sectPr><w:type w:val="continuous"/><w:cols w:num="4" w:space="200"/></w:sectPr></w:pPr></w:p>
      <w:p><w:r><w:t>tail</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const doc = result.content as N;
    const cols = walk(doc, 'columns');
    expect(cols.length).toBe(1);
    expect(cols[0].attrs.count).toBe(3);
    expect(walk(cols[0], 'text')[0].text).toBe('kept marker text');
    expect(result.warnings).toContain('Sections with more than 3 columns were reduced to 3 columns');
  });

  it('wraps a whole-document multi-column file (cols on the body-final sectPr only)', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:r><w:t>all of it</w:t></w:r></w:p>
      <w:p><w:r><w:t>flows in columns</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:cols w:num="3" w:space="425"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const doc = result.content as N;
    const cols = walk(doc, 'columns');
    expect(cols.length).toBe(1);
    expect(cols[0].attrs.count).toBe(3);
    expect(cols[0].attrs.gapCm).toBe(0.75); // 425 twips
    expect(walk(cols[0], 'text').map((t) => t.text)).toEqual(['all of it', 'flows in columns']);
  });

  it('keeps a table inside its columned section', () => {
    const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:r><w:t>before table</w:t></w:r></w:p>
      <w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
        <w:tr><w:tc><w:p><w:r><w:t>in table</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      <w:p><w:r><w:t>after table</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:cols w:num="2" w:space="283"/></w:sectPr>
    </w:body></w:document>`;
    const result = importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) }));
    const doc = result.content as N;
    expect(doc.content!.map((n) => n.type)).toEqual(['columns']);
    expect(doc.content![0].content!.map((n) => n.type)).toEqual(['paragraph', 'table', 'paragraph']);
    expect(result.warnings.some((w) => /moved out of the columns/.test(w))).toBe(false);
  });
});

describe('DOCX import: hardBreak carries its run font (empty-line height)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // "Muster" <br/> <br/> "Arbeitsvertrag", every run at 36pt (sz=72): the blank line
  // between the two breaks must keep the 36pt height, like Word/LibreOffice.
  const run = (inner: string) => `<w:r><w:rPr><w:sz w:val="72"/></w:rPr>${inner}</w:r>`;
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:rPr><w:sz w:val="72"/></w:rPr></w:pPr>
      ${run('<w:t>Muster</w:t>')}${run('<w:br/>')}${run('<w:br/>')}${run('<w:t>Arbeitsvertrag</w:t>')}
    </w:p>
  </w:body></w:document>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml) });

  it('tags both hardBreaks with the run font size', () => {
    const doc = importDocx(bytes).content as N;
    const brs = walk(doc.content![0], 'hardBreak');
    expect(brs.length).toBe(2);
    for (const br of brs) expect(markAttrs(br, 'textStyle')?.fontSize).toBe('36pt');
  });

  it('keeps the break font size through a DOCX export round trip', async () => {
    const doc = importDocx(bytes).content as N;
    const round = importDocx(await buildDocx(doc as never)).content as N;
    const brs = walk(round.content![0], 'hardBreak');
    expect(brs.length).toBe(2);
    for (const br of brs) expect(markAttrs(br, 'textStyle')?.fontSize).toBe('36pt');
  });
});

describe('DOCX import: a list continued across paragraphs keeps counting (shared count)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const item = (numId: number, t: string) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
  const gap = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
  // numId 5 (upperRoman) split by body paragraphs; numId 6 shares its abstract and so its
  // count; numId 7 restarts it through w:startOverride (both probed in LibreOffice).
  const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
    ${item(5, 'One')}${gap('body a')}${item(5, 'Two')}${gap('body b')}${item(5, 'Three')}${item(6, 'Other')}${gap('body c')}${item(7, 'Again')}
  </w:body></w:document>`;
  const numberingXml = `<?xml version="1.0"?><w:numbering ${W}>
    <w:abstractNum w:abstractNumId="5"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
    <w:num w:numId="5"><w:abstractNumId w:val="5"/></w:num>
    <w:num w:numId="6"><w:abstractNumId w:val="5"/></w:num>
    <w:num w:numId="7"><w:abstractNumId w:val="5"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
  </w:numbering>`;
  const bytes = zipSync({ 'word/document.xml': strToU8(documentXml), 'word/numbering.xml': strToU8(numberingXml) });
  const doc = importDocx(bytes).content as N;

  it('emits separate ordered lists whose start values continue the shared count', () => {
    const ols = doc.content!.filter((n) => n.type === 'orderedList');
    expect(ols.length).toBe(5);
    expect(ols.map((o) => o.attrs?.start)).toEqual([undefined, 2, 3, 4, undefined]);
    expect(ols.every((o) => o.attrs?.listStyleType === 'upper-roman')).toBe(true);
    expect(walk(ols[3], 'text')[0].text).toBe('Other');
  });
});

describe('DOCX import: a mid-body section break starts a new page', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const geom = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/>';
  const build = (type: string | null) => {
    const t = type ? `<w:type w:val="${type}"/>` : '';
    const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:r><w:t>section one</w:t></w:r></w:p>
      <w:p><w:pPr><w:sectPr>${geom}</w:sectPr></w:pPr></w:p>
      <w:p><w:r><w:t>section two</w:t></w:r></w:p>
      <w:sectPr>${t}${geom}</w:sectPr>
    </w:body></w:document>`;
    return importDocx(zipSync({ 'word/document.xml': strToU8(documentXml) })).content as N;
  };

  it("marks the next section's first block with breakBefore for a default (nextPage) break", () => {
    const top = build(null).content!;
    expect(top.map((n) => n.type)).toEqual(['paragraph', 'paragraph']);
    expect(walk(top[1], 'text')[0].text).toBe('section two');
    expect(top[0].attrs?.breakBefore).toBeFalsy();
    expect(top[1].attrs?.breakBefore).toBe('page');
  });

  it('does not break for a continuous section', () => {
    const top = build('continuous').content!;
    expect(top[1].attrs?.breakBefore).toBeFalsy();
  });

  it('keeps the section-break page break through a DOCX export round trip', async () => {
    const round = importDocx(await buildDocx(build(null) as never)).content as N;
    const two = round.content!.find((n) => walk(n, 'text').some((t) => t.text === 'section two'))!;
    expect(two.attrs?.breakBefore).toBe('page');
  });
});

describe('DOCX import: a page break before a table', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const tbl = (pPr = '') => `<w:tbl><w:tr><w:tc><w:p>${pPr}<w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const build = (body: string) => importDocx(zipSync({ 'word/document.xml': strToU8(
    `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>cover</w:t></w:r></w:p>${body}<w:sectPr/></w:body></w:document>`) })).content as N;
  const table = (doc: N) => doc.content!.find((n) => n.type === 'table')!;

  it('moves the table when the paragraph above ends in a break', () => {
    expect(table(build(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>${tbl()}`)).attrs?.breakBefore).toBe('page');
  });

  it("reads the first cell's pageBreakBefore as the table's, and writes it back there", async () => {
    const doc = build(tbl('<w:pPr><w:pageBreakBefore/></w:pPr>'));
    expect(table(doc).attrs?.breakBefore).toBe('page');
    const round = importDocx(await buildDocx(doc as never)).content as N;
    expect(table(round).attrs?.breakBefore).toBe('page');
    expect(walk(table(round), 'paragraph')[0].attrs?.breakBefore).toBeFalsy();
  });
});

describe('DOCX import: a watermark only from a header a page shows', () => {
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml"';
  const build = (type: string, titlePg: boolean) => importDocx(zipSync({
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document ${NS}><w:body><w:p/><w:sectPr>`
      + `<w:headerReference w:type="${type}" r:id="rIdH"/>${titlePg ? '<w:titlePg/>' : ''}</w:sectPr></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'),
    'word/header1.xml': strToU8(`<?xml version="1.0"?><w:hdr ${NS}><w:p><w:r><w:pict><v:shape id="PowerPlusWaterMarkObject1">`
      + '<v:textpath string="DRAFT"/></v:shape></w:pict></w:r></w:p></w:hdr>'),
  })).decor as { watermark: { text: string } | null };

  it('takes it from the default header', () => expect(build('default', false).watermark?.text).toBe('DRAFT'));
  it('takes it from a first-page header under titlePg', () => expect(build('first', true).watermark?.text).toBe('DRAFT'));
  it('leaves it off when the first-page header is not in use', () => expect(build('first', false).watermark).toBeNull());
});

describe('DOCX named paragraph styles', () => {
  const sheet = builtinStyleSheet();
  sheet.paragraph['Merksatz'] = {
    name: 'Merksatz', parent: 'Quotations', next: 'Standard',
    para: { spaceBefore: 8 }, text: { bold: true, color: '#0000AA', shadow: true, textGlow: { color: '#FFC000', alpha: 0.6, radiusPt: 8 } },
  };

  const fixture = {
    type: 'doc',
    content: [
      heading(1, 'Kapitel'),
      { type: 'paragraph', attrs: { styleName: 'Merksatz' }, content: [text('gemerkt')] },
      { type: 'paragraph', attrs: { styleName: 'Merksatz', spaceAfter: 20 }, content: [text('mit Abstand')] },
      { type: 'paragraph', content: [text('normal')] },
      // A run switching off an effect its style draws.
      { type: 'paragraph', attrs: { styleName: 'Merksatz' }, content: [text('flach', [{ type: 'textStyle', attrs: { shadow: false } }])] },
      // A run with a glow of its own over its style's.
      { type: 'paragraph', attrs: { styleName: 'Merksatz' }, content: [text('grün', [{ type: 'textStyle', attrs: { textGlow: { color: '#70AD47', alpha: 1, radiusPt: 5 } } }])] },
    ],
  } as any;

  it('writes real Word styles and round-trips the assignment', async () => {
    const bytes = await buildDocx(fixture, undefined, undefined, undefined, undefined, undefined, sheet);
    const files = unzipSync(bytes);
    const stylesXml = strFromU8(files['word/styles.xml']);
    const documentXml = strFromU8(files['word/document.xml']);

    const merk = stylesXml.match(/<w:style [^>]*w:styleId="Merksatz"[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(merk).toContain('<w:basedOn w:val="Quotations"/>');
    expect(merk).toContain('<w:color w:val="0000AA"/>');
    expect(documentXml).toContain('<w:pStyle w:val="Merksatz"/>');
    expect(documentXml).toContain('<w:pStyle w:val="Heading1"/>');

    const res = importDocx(bytes);
    const blocks = (res.content as N).content!;
    expect(blocks[1].attrs.styleName).toBe('Merksatz');
    expect(blocks[1].content![0].marks ?? []).toEqual([]); // style formatting stays in the style
    expect(blocks[2].attrs.spaceAfter).toBe(20);          // hard formatting stays direct
    expect(blocks[0].type).toBe('heading');

    const style = res.styles.paragraph['Merksatz'];
    expect(style.parent).toBe('Quotations');
    expect(style.text.bold).toBe(true);
    expect(style.text.color).toBe('#0000AA');
    expect(style.para.spaceBefore).toBe(8);
    expect(style.text.shadow).toBe(true);
    expect(blocks[4].content![0].marks).toEqual([{ type: 'textStyle', attrs: expect.objectContaining({ shadow: false }) }]);
    expect(style.text.textGlow).toEqual({ color: '#FFC000', alpha: 0.6, radiusPt: 8 });
    expect(blocks[5].content![0].marks).toEqual([{ type: 'textStyle', attrs: expect.objectContaining({ textGlow: { color: '#70AD47', alpha: 1, radiusPt: 5 } }) }]);
  });
});

describe('DOCX named character styles', () => {
  const sheet = builtinStyleSheet();
  sheet.character['Signal'] = {
    name: 'Signal', parent: null, next: null, para: {}, text: { bold: true, color: '#CC0000', caps: 'smallCaps', outline: true },
  };
  const CS = (t: string, name: string, ...extra: any[]) =>
    ({ type: 'text', text: t, marks: [{ type: 'charStyle', attrs: { name } }, ...extra] });

  it('writes w:rStyle runs and round-trips them', async () => {
    const fixture = { type: 'doc', content: [{ type: 'paragraph', content: [
      text('plain '), CS('emphasised', 'Emphasis'), text(' and '), CS('signal', 'Signal', { type: 'italic' }),
    ] }] } as any;
    const bytes = await buildDocx(fixture, undefined, undefined, undefined, undefined, undefined, sheet);
    const files = unzipSync(bytes);
    const stylesXml = strFromU8(files['word/styles.xml']);
    const documentXml = strFromU8(files['word/document.xml']);

    expect(stylesXml).toMatch(/<w:style w:type="character" [^>]*w:styleId="Signal"/);
    expect(stylesXml).toMatch(/w:styleId="Signal"[\s\S]*?<w:color w:val="CC0000"\/>/);
    expect(documentXml).toContain('<w:rStyle w:val="Emphasis"/>');
    expect(documentXml).toContain('<w:rStyle w:val="Signal"/>');

    const res = importDocx(bytes);
    const runs = (res.content as N).content![0].content!;
    const charOf = (r: N) => (r.marks ?? []).find((m: N) => m.type === 'charStyle')?.attrs?.name;
    expect(runs[0].marks).toBeUndefined();
    expect(charOf(runs[1])).toBe('Emphasis');
    expect((runs[1].marks ?? []).every((m: N) => m.type === 'charStyle')).toBe(true);
    const signal = runs.find((r: N) => charOf(r) === 'Signal')!;
    expect((signal.marks ?? []).some((m: N) => m.type === 'italic')).toBe(true);
    expect(res.styles.character['Signal'].text).toEqual({ bold: true, color: '#CC0000', caps: 'smallCaps', outline: true });
  });
});

// A style switching its parent's all-caps off keeps it off through either format.
describe('a derived style turns its parent\'s caps off', () => {
  const sheet = builtinStyleSheet();
  sheet.paragraph['Loud'] = { name: 'Loud', parent: 'Standard', next: null, para: {}, text: { caps: 'uppercase' } };
  sheet.paragraph['Calm'] = { name: 'Calm', parent: 'Loud', next: null, para: {}, text: { caps: false } };
  const doc = { type: 'doc', content: ['Loud', 'Calm'].map((name) => ({ type: 'paragraph', attrs: { styleName: name }, content: [text(name)] })) } as any;
  it.each([
    ['docx', async () => importDocx(await buildDocx(doc, undefined, undefined, undefined, undefined, undefined, sheet))],
    ['odt', async () => importOdt(await buildOdt(doc, undefined as any, 'portrait', undefined, undefined, undefined, sheet))],
  ])('%s', async (_, read) => {
    const back: any = await read();
    expect(resolveStyle(back.styles, 'Loud').text.caps).toBe('uppercase');
    expect(resolveStyle(back.styles, 'Calm').text.caps || null).toBeNull();
  });
});

describe('DOCX table margins (dragged outer edges)', () => {
  // Default Word geometry here: 21 - 2.12 - 2.12 = 16.76cm of text width, so the
  // table is 16.76 - 2 - 3 = 11.76cm wide and indented 2cm.
  const fixture = {
    type: 'doc',
    content: [
      { type: 'table', attrs: { marginLeft: 2, marginRight: 3 }, content: [
        { type: 'tableRow', content: [cell('A', { colwidth: [200] }), cell('B', { colwidth: [100] })] },
      ] },
    ],
  } as any;

  it('writes w:tblInd + the narrower grid and round-trips the margins', async () => {
    const bytes = await buildDocx(fixture, { top: 2.54, bottom: 2.54, left: 2.12, right: 2.12 }, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain(`<w:tblInd w:type="dxa" w:w="${Math.round((2 / 2.54) * 1440)}"/>`);

    const res = await importDocx(bytes);
    const table = walk(res.content as N, 'table')[0];
    expect(table.attrs.marginLeft).toBeCloseTo(2, 1);
    expect(table.attrs.marginRight).toBeCloseTo(3, 1);
    const weights = (table.content?.[0].content ?? []).map((c: N) => c.attrs.colwidth[0]);
    expect(weights[0] / weights[1]).toBeCloseTo(2, 2);
  });

  // Word 2010 and earlier measure w:tblInd to the cell's text, so LibreOffice draws such
  // a table a left cell margin outside the body text; Word 2013 (mode 15) does not.
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const indentedTable = (mode: number | null) => {
    const full = Math.round((16.76 / 2.54) * 1440);
    return zipSync({
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:tbl>` +
        `<w:tblPr><w:tblInd w:type="dxa" w:w="0"/></w:tblPr>` +
        `<w:tblGrid><w:gridCol w:w="${full}"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1202" w:right="1202"/></w:sectPr>` +
        `</w:body></w:document>`,
      ),
      ...(mode == null ? {} : {
        'word/settings.xml': strToU8(
          `<?xml version="1.0"?><w:settings xmlns:w="${W}"><w:compat>` +
          `<w:compatSetting w:name="compatibilityMode" w:uri="x" w:val="${mode}"/></w:compat></w:settings>`,
        ),
      }),
    });
  };

  it('hangs an older file’s table its left cell margin into the page margin', () => {
    for (const mode of [null, 14]) {
      const table = walk(importDocx(indentedTable(mode)).content as N, 'table')[0];
      expect(table.attrs.marginLeft).toBeCloseTo(-0.19, 2);
      expect(table.attrs.marginRight).toBeCloseTo(0.19, 2);
    }
  });

  it('leaves a Word 2013 file’s table flush with the text area', () => {
    const table = walk(importDocx(indentedTable(15)).content as N, 'table')[0];
    expect(table.attrs?.marginLeft ?? 0).toBe(0);
  });
});

describe('DOCX text box: a list inside it is a real list, a picture a real picture', () => {
  const doc: N = { type: 'doc', content: [
    // A body list first, so the box's numbering has to find free ids beside it.
    { type: 'bulletList', content: [li(para('body item'))] },
    para([{ type: 'textBox', attrs: { width: 300, height: 200 }, content: [
      para('box text'),
      { type: 'bulletList', content: [
        li(para('one')),
        li(para('two'), { type: 'orderedList', attrs: { start: 3 }, content: [li(para('a')), li(para('b'))] }),
      ] },
      para([{ type: 'image', attrs: { src: PNG, width: 64, height: 64, alt: 'dot' } }]),
    ] }]),
  ] };

  it('mints numbering, media and relationships of its own', async () => {
    const files = unzipSync(await buildDocx(doc, { top: 2, bottom: 2, left: 2, right: 2 } as any, 'portrait'));
    const xml = strFromU8(files['word/document.xml']);
    const numbering = strFromU8(files['word/numbering.xml']);
    const rels = strFromU8(files['word/_rels/document.xml.rels']);

    const inBox = xml.slice(xml.indexOf('<w:txbxContent>'));
    const numIds = [...inBox.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(numIds.length).toBe(4);
    expect(new Set(numIds).size).toBe(1);
    // The body's own list keeps its definition; the box's is a second one.
    const bodyNumId = /<w:numId w:val="(\d+)"\/>/.exec(xml)![1];
    expect(numIds[0]).not.toBe(bodyNumId);
    for (const id of new Set([...numIds, bodyNumId])) {
      expect(numbering).toContain(`<w:num w:numId="${id}">`);
    }
    // Two levels: the bullet and the ordered list nested under it, starting at 3.
    const added = numbering.slice(numbering.lastIndexOf(`<w:abstractNum w:abstractNumId="${numIds[0]}"`));
    expect(added).toContain('<w:numFmt w:val="bullet"/>');
    expect(added).toContain('<w:numFmt w:val="lowerLetter"/>');
    expect(added).toContain('<w:start w:val="3"/>');
    // No literal markers left in the runs.
    expect(inBox).not.toContain('<w:t xml:space="preserve">• ');

    expect(Object.keys(files)).toContain('word/media/tbx1.png');
    const rid = /<a:blip r:embed="(rId\d+)"/.exec(inBox)![1];
    expect(rels).toContain(`<Relationship Id="${rid}" `);
    expect(rels).toContain('Target="media/tbx1.png"');
  });

  it('round-trips the whole box', async () => {
    const back = importDocx(await buildDocx(doc, { top: 2, bottom: 2, left: 2, right: 2 } as any, 'portrait'));
    expect(back.warnings).toEqual([]);
    const box = walk(back.content as N, 'textBox')[0];
    const list = box.content!.find((n: N) => n.type === 'bulletList')!;
    expect(list.content![1].content![1].type).toBe('orderedList');
    expect(list.content![1].content![1].attrs.start).toBe(3);
    const img = walk(box, 'image')[0];
    expect(img.attrs.width).toBe(64);
    expect(img.attrs.alt).toBe('dot');
    expect(String(img.attrs.src).startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('DOCX named list styles', () => {
  const sheet = builtinStyleSheet();
  sheet.list['Prüfliste'] = {
    name: 'Prüfliste',
    levels: [
      { kind: 'number', numType: 'upper-roman-paren', markerAlign: 'right', indentCm: 0.5 },
      { kind: 'bullet', bulletChar: '✓' },
      { kind: 'number', numType: 'lower-alpha', hanging: 0.3, markerSuffix: 'space' },
    ],
  };
  const fixture = {
    type: 'doc',
    content: [
      { type: 'orderedList', attrs: { listStyleName: 'Prüfliste' }, content: [
        li(para('one'), { type: 'bulletList', content: [li(para('sub'))] }),
        li(para('two')),
      ] },
      para('between'),
      // A second list in the same style: its own instance, so it restarts at 1.
      { type: 'orderedList', attrs: { listStyleName: 'Prüfliste' }, content: [li(para('restart'))] },
      { type: 'bulletList', attrs: { listStyleName: 'Diamond Bullets' }, content: [li(para('dash'))] },
    ],
  };

  it('links the shared abstract via w:styleLink and the numbering style', async () => {
    const bytes = await buildDocx(fixture as any, undefined, undefined, undefined, undefined, undefined, sheet);
    const files = unzipSync(bytes);
    const numbering = strFromU8(files['word/numbering.xml']);
    const styles = strFromU8(files['word/styles.xml']);

    const abstract = numbering.match(/<w:abstractNum [^>]*>(?:(?!<\/w:abstractNum>)[\s\S])*w:styleLink w:val="Prfliste"[\s\S]*?<\/w:abstractNum>/)?.[0] ?? '';
    expect(abstract, 'the style abstract carries w:styleLink').toBeTruthy();
    expect(abstract).toContain('<w:numFmt w:val="upperRoman"/>');
    expect(abstract).toContain('<w:lvlText w:val="%1)"/>');
    expect(abstract).toContain('<w:lvlJc w:val="right"/>');
    expect(abstract).toContain('<w:lvlText w:val="✓"/>');
    const absId = /w:abstractNumId="(\d+)"/.exec(abstract)![1];
    // Two lists in one style → two concrete nums over the one abstract (each restarts).
    const nums = numbering.match(new RegExp(`<w:num w:numId="\\d+"[^>]*>\\s*<w:abstractNumId w:val="${absId}"/>`, 'g')) ?? [];
    expect(nums.length, 'one instance per list').toBe(2);
    const style = styles.match(/<w:style w:type="numbering" w:styleId="Prfliste">[\s\S]*?<\/w:style>/)?.[0] ?? '';
    expect(style).toContain('<w:name w:val="Prüfliste"/>');
    expect(/<w:numId w:val="[1-9]\d*"\/>/.test(style), 'placeholder numId resolved').toBe(true);
    expect(styles).toContain('w:styleId="DiamondBullets"');
    // fromXmlString's nameless wrapper would serialize as <undefined> — Word refuses that.
    expect(styles).not.toContain('<undefined');
  });

  it('round-trips the assignment and the definition', async () => {
    const bytes = await buildDocx(fixture as any, undefined, undefined, undefined, undefined, undefined, sheet);
    const result = importDocx(bytes);
    const doc = result.content as N;
    const lists = (doc.content ?? []).filter((n) => n.type === 'orderedList' || n.type === 'bulletList');
    expect(lists[0]?.attrs?.listStyleName).toBe('Prüfliste');
    expect(lists[0]?.attrs?.listStyleType).toBeUndefined();
    expect(lists[0]?.attrs?.indent).toBeUndefined();
    const nested = walk(lists[0], 'bulletList')[0];
    expect(nested?.attrs ?? null, 'nested list stays attr-free').toBeNull();
    expect(lists[1]?.attrs?.listStyleName).toBe('Prüfliste');
    expect(lists[2]?.attrs?.listStyleName).toBe('Diamond Bullets');
    const imported = result.styles.list['Prüfliste'];
    expect(imported?.levels[0]).toMatchObject({ kind: 'number', numType: 'upper-roman-paren', markerAlign: 'right', indentCm: 0.5 });
    expect(imported?.levels[1]).toMatchObject({ kind: 'bullet', bulletChar: '✓' });
    expect(imported?.levels[2]).toMatchObject({ kind: 'number', numType: 'lower-alpha', hanging: 0.3, markerSuffix: 'space' });
  });

  it('the style level decides a depth\'s kind — a species-mismatched nest keeps the shared abstract', async () => {
    sheet.list['Tab Test'] = { name: 'Tab Test', levels: [
      { kind: 'bullet', bulletChar: '–' },
      ...Array.from({ length: 8 }, () => ({ kind: 'number' as const, numType: 'decimal' as const })),
    ] };
    // A Tab-nested tree is bullet lists all the way down; the style numbers depth 2+.
    const doc = { type: 'doc', content: [
      { type: 'bulletList', attrs: { listStyleName: 'Tab Test' }, content: [
        li(para('one'), { type: 'bulletList', content: [li(para('two'))] }),
      ] },
    ] };
    const bytes = await buildDocx(doc as any, undefined, undefined, undefined, undefined, undefined, sheet);
    const numbering = strFromU8(unzipSync(bytes)['word/numbering.xml']);
    const abstract = numbering.match(/<w:abstractNum [^>]*>(?:(?!<\/w:abstractNum>)[\s\S])*w:styleLink w:val="TabTest"[\s\S]*?<\/w:abstractNum>/)?.[0] ?? '';
    expect(abstract, 'the style abstract carries w:styleLink').toBeTruthy();
    // The nested <ul> did not fork away from the style reference: exactly one num over
    // the style abstract, and no third abstract beyond the library's default bullet.
    const absId = /w:abstractNumId="(\d+)"/.exec(abstract)![1];
    const nums = numbering.match(new RegExp(`<w:num w:numId="\\d+"[^>]*>\\s*<w:abstractNumId w:val="${absId}"/>`, 'g')) ?? [];
    expect(nums.length, 'one instance for the one list').toBe(1);
    expect((numbering.match(/<w:abstractNum /g) ?? []).length, 'no forked abstract').toBe(2);
    const result = importDocx(bytes);
    const top = (result.content as N).content!.find((n) => n.type === 'bulletList');
    expect(top?.attrs?.listStyleName).toBe('Tab Test');
    const nested = top?.content?.[0]?.content?.[1];
    expect(nested?.type, 'the nested list comes back numbered').toBe('orderedList');
    expect(nested?.attrs ?? null).toBeNull();
    delete sheet.list['Tab Test'];
  });

  it('an overridden list keeps a private, fully resolved numbering and drops the name', async () => {
    const doc = { type: 'doc', content: [
      { type: 'orderedList', attrs: { listStyleName: 'Outline A.I.1', listStyleType: 'lower-roman' }, content: [li(para('broken out'))] },
    ] };
    const bytes = await buildDocx(doc as any, undefined, undefined, undefined, undefined, undefined, sheet);
    const numbering = strFromU8(unzipSync(bytes)['word/numbering.xml']);
    expect(numbering).not.toContain('w:styleLink');
    expect(numbering).toContain('<w:numFmt w:val="lowerRoman"/>');
    const list = (importDocx(bytes).content as N).content!.find((n) => n.type === 'orderedList');
    expect(list?.attrs?.listStyleType).toBe('lower-roman');
    expect(list?.attrs?.listStyleName).toBeUndefined();
  });

  it('follows w:numStyleLink in a foreign file (a linked list is numbers, not bullets)', () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const documentXml = `<?xml version="1.0"?><w:document ${W}><w:body>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>linked one</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>linked two</w:t></w:r></w:p>
    </w:body></w:document>`;
    const stylesXml = `<?xml version="1.0"?><w:styles ${W}>
      <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
      <w:style w:type="numbering" w:styleId="MyNum"><w:name w:val="My Numbering"/>
        <w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
    </w:styles>`;
    // Word's indirection: the document's abstract 1 carries only w:numStyleLink; the
    // style's own numbering (num 2 → abstract 0, carrying w:styleLink) has the levels.
    const numberingXml = `<?xml version="1.0"?><w:numbering ${W}>
      <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/><w:styleLink w:val="MyNum"/>
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/><w:pPr><w:ind w:left="1134" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:abstractNum w:abstractNumId="1"><w:numStyleLink w:val="MyNum"/></w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>
    </w:numbering>`;
    const result = importDocx(zipSync({
      'word/document.xml': strToU8(documentXml),
      'word/styles.xml': strToU8(stylesXml),
      'word/numbering.xml': strToU8(numberingXml),
    }));
    const doc = result.content as N;
    const list = doc.content!.find((n) => n.type === 'orderedList');
    expect(list, 'the linked list resolves to numbers, not the bullet fallback').toBeTruthy();
    expect(list!.attrs?.listStyleName).toBe('My Numbering');
    const imported = result.styles.list['My Numbering'];
    expect(imported?.levels[0]).toMatchObject({ kind: 'number', numType: 'upper-alpha-paren' });
    expect(imported?.levels[0]?.indentCm).toBeCloseTo(0.73, 2); // 1134 twips = 2cm → +0.73
  });
});

// Chapter numbering rides the heading styles (w:numPr in styles.xml), and a heading may
// wear a style of its own — both only reach the export through the document's own
// stylesheet, so a fixture built on builtinStyleSheet() never sees either.
describe('numbered headings under a document stylesheet', () => {
  const outline = Array.from({ length: 10 }, (_, i) => ({
    format: '1' as const, prefix: '', suffix: '', displayLevels: i + 1, start: 1,
  }));
  const sheet = () => {
    const s = builtinStyleSheet();
    s.outline = outline;
    // A heading style the name test can't recognise: only its outline level says so.
    s.paragraph['Appendix 1'] = { name: 'Appendix 1', parent: 'Heading 1', next: 'Standard', outlineLevel: 1, para: {}, text: {} };
    return s;
  };
  const doc = {
    type: 'doc',
    content: [
      heading(1, 'Plain chapter', { breakBefore: 'page' }),
      para('body'),
      heading(1, 'Appendix', { styleName: 'Appendix 1', breakBefore: 'page' }),
      para('more'),
    ],
  } as any;

  const roundTrip = async () => importDocx(await buildDocx(doc, undefined, undefined, undefined, undefined, undefined, sheet())).content as N;

  it('keeps a numbered heading a heading instead of a list item', async () => {
    const back = await roundTrip();
    expect(walk(back, 'orderedList')).toHaveLength(0);
    expect(walk(back, 'listItem')).toHaveLength(0);
    expect(walk(back, 'heading').map((h) => h.attrs.level)).toEqual([1, 1]);
  });

  it('keeps the page break in front of a numbered heading', async () => {
    const back = await roundTrip();
    expect(walk(back, 'heading').map((h) => h.attrs.breakBefore)).toEqual(['page', 'page']);
  });

  it('keeps a heading whose style is not named "Heading n"', async () => {
    const back = await roundTrip();
    const named = walk(back, 'heading').find((h) => h.attrs.styleName === 'Appendix 1');
    expect(named, 'the custom heading style survives as a heading').toBeTruthy();
    expect(named!.attrs.level).toBe(1);
  });
});

// What a document keeps across the formats besides its words: the look of an index, the
// header a section blanks, a box's own ring, a header row.
describe('the look a document carries', () => {
  const SVG = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');

  it('keeps a header row a header row', async () => {
    const doc = { type: 'doc', content: [{ type: 'table', attrs: { repeatHeader: true }, content: [
      { type: 'tableRow', content: [headerCell('Name'), headerCell('Qty')] },
      { type: 'tableRow', content: [cell('Widget'), cell('1')] },
    ] }] } as any;
    const back = importDocx(await buildDocx(doc)).content as N;
    expect(walk(back, 'tableHeader')).toHaveLength(2);
    expect(back.content![0].attrs.repeatHeader).toBe(true);
  });

  it('marks a header row even where the table asks for no repeat', async () => {
    const doc = { type: 'doc', content: [{ type: 'table', content: [
      { type: 'tableRow', content: [headerCell('H')] },
      { type: 'tableRow', content: [cell('b')] },
    ] }] } as any;
    expect(walk(importDocx(await buildDocx(doc)).content as N, 'tableHeader')).toHaveLength(1);
  });

  it("keeps a text box's own padding and where it sits behind the text", async () => {
    const doc = { type: 'doc', content: [para([
      { type: 'textBox', attrs: { width: 300, height: 100, wrap: 'through', wrapAlign: 'center', paddingCm: 0 }, content: [para('in the box')] },
    ])] } as any;
    const box = walk(importDocx(await buildDocx(doc)).content as N, 'textBox')[0];
    expect(box.attrs.paddingCm).toBe(0);
    expect(box.attrs.wrapAlign).toBe('center');
  });

  it("keeps an index's leader, tab position and per-level styles", async () => {
    const sheet = builtinStyleSheet();
    for (const n of [1, 2]) sheet.paragraph[`Illustration Index ${n}`] = { name: `Illustration Index ${n}`, parent: 'Standard', next: 'Standard', para: {}, text: {} };
    const doc = { type: 'doc', content: [{ type: 'tableOfContents', attrs: {
      index: 'figures', title: '', leader: '.', tabPosCm: 12, maxLevel: 10,
      levelStyles: ['Illustration Index 1', 'Illustration Index 2'],
      entries: [{ text: 'Illustration 1: One', level: 1, page: 2 }],
    } }] } as any;
    const toc = walk(importDocx(await buildDocx(doc, undefined, undefined, undefined, undefined, undefined, sheet)).content as N, 'tableOfContents')[0];
    expect(toc.attrs.leader).toBe('.');
    expect(toc.attrs.tabPosCm).toBe(12);
    expect(toc.attrs.levelStyles?.[0]).toBe('Illustration Index 1');
  });

  it('keeps an index of text alone free of page numbers', async () => {
    const doc = { type: 'doc', content: [{ type: 'tableOfContents', attrs: {
      index: 'alphabetical', title: '', pageNumbers: false, leader: '.',
      entries: [{ text: 'Car to X', level: 1, page: 1 }],
    } }] } as any;
    const toc = walk(importDocx(await buildDocx(doc)).content as N, 'tableOfContents')[0];
    expect(toc.attrs.pageNumbers).toBe(false);
    expect(toc.attrs.leader).toBe('.');
  });

  it('blanks a later section instead of repeating the header above it', async () => {
    const doc = { type: 'doc', content: [
      para('first section'),
      para('second section', { sectionBreak: true }),
    ] } as any;
    const hfTwo = {
      header: { type: 'doc', content: [{ type: 'paragraph', content: [text('Running head')] }] },
      footer: null, pageCount: 1,
      sections: [
        { header: { type: 'doc', content: [{ type: 'paragraph', content: [text('Running head')] }] }, footer: null },
        { header: null, footer: null }, // the blank one
      ],
    } as any;
    const xml = strFromU8(unzipSync(await buildDocx(doc, undefined, undefined, hfTwo))['word/document.xml']);
    // Every section names its own header part; one that named none would inherit.
    const sects = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? [];
    expect(sects).toHaveLength(2);
    for (const s of sects) expect(s).toMatch(/<w:headerReference/);
  });

  it('exports a document holding an SVG without hanging where no canvas can draw', async () => {
    const doc = { type: 'doc', content: [para([{ type: 'image', attrs: { src: SVG, width: 8, height: 8 } }])] } as any;
    // jsdom has an Image whose onload never fires; the rasterizer must not await it.
    const bytes = await buildDocx(doc);
    expect(bytes.length).toBeGreaterThan(0);
  });
});
