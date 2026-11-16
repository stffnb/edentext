// Header/footer zones through ODT and DOCX: blocks, fields, tab stops, margins and the
// per-section sets. ODF keeps every zone in styles.xml, Word in its own part per zone.
import { describe, it, expect } from 'vitest';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { EMPTY_HF_SET, type HfSet } from '../../src/lib/storage/headerFooter';
import { zoneDefaultStops } from '../../src/lib/editor/extensions/tabStops';
import { docxOf, W_NS } from '../docxFixture';

type N = any;

const t = (text: string): N => ({ type: 'text', text });
const p = (...content: N[]): N => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const zone = (...blocks: N[]): N => ({ type: 'doc', content: blocks });
const body: N = zone(p(t('Body')));
const MARGINS = { top: 2, bottom: 2, left: 2, right: 2 };
const hfOf = (zones: Partial<HfSet> & { sections?: HfSet[]; pageCount?: number }) => ({ ...EMPTY_HF_SET, pageCount: 1, ...zones });
// Both formats, as [name, export → import].
const FORMATS = [
  ['ODT', async (d: N, hf: N) => importOdt(await buildOdt(d, MARGINS, 'portrait', hf))],
  ['DOCX', async (d: N, hf: N) => importDocx(await buildDocx(d, MARGINS, 'portrait', hf))],
] as const;
const stylesXml = async (d: N, hf: N) => strFromU8(unzipSync(await buildOdt(d, undefined, 'portrait', hf))['styles.xml']);

// Paragraphs, a list, a table and a text box holding a page number come back from both
// formats as the blocks they went out as.
describe.each(FORMATS)('zones hold blocks through %s', (_name, roundTrip) => {
  it('round-trips them', async () => {
    const header = zone(p(t('Line one')), p(t('Line two')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('Point'))] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p(t('A'))] }, { type: 'tableCell', content: [p(t('B'))] }] }] },
      p());
    const footer = zone(p({ type: 'textBox', attrs: { width: 80, height: 30 }, content: [p({ type: 'pageNumber' })] }, t('Report')));
    // A block's type and text, down through lists, tables and boxes.
    const shape = (n: N): N => n.type === 'text' ? n.text : [n.type, ...(n.content ?? []).map(shape)];
    const zoneShape = (d: N) => (d?.content ?? []).map(shape);
    const back = await roundTrip(body, { header, footer, pageCount: 1 });
    expect(zoneShape(back.header)).toEqual(zoneShape(header));
    expect(zoneShape(back.footer)).toEqual(zoneShape(footer));
  });
});

describe('a date field in a header', () => {
  const date = (fixed = true): N => ({ type: 'dateTimeField', attrs: { kind: 'date', format: 'DD.MM.YYYY', fixed, value: '2026-03-04T00:00:00' } });
  const hf = hfOf({ header: zone(p(t('Stand: '), date())) });
  const kindsOf = (d: N) => (d?.content?.[0]?.content ?? []).map((n: N) => n.type);

  it('rides styles.xml as a live ODF field and comes back', async () => {
    const files = unzipSync(await buildOdt(body, undefined, 'portrait', hf));
    const styles = strFromU8(files['styles.xml']);
    for (const s of ['<text:date text:date-value="2026-03-04', 'text:fixed="true"', 'xmlns:number=', '<number:date-style']) expect(styles).toContain(s);
    // The sentinel is gone, and nothing leaked into the body.
    expect(styles).not.toMatch(/[\uE000-\uF8FF]/);
    expect(strFromU8(files['content.xml'])).not.toContain('<text:date');
    const back = importOdt(await buildOdt(body, undefined, 'portrait', hf));
    expect(kindsOf(back.header)).toEqual(['text', 'dateTimeField']);
    expect(back.header?.content?.[0]?.content?.[1]?.attrs?.kind).toBe('date');
  });
  it('resolves in a first-page zone too, which is written as raw XML', async () => {
    expect(await stylesXml(body, { ...hf, differentFirstPage: true, headerFirst: zone(p(date())) })).toMatch(/<style:header-first>[\s\S]*<text:date /);
  });
  it('resolves in the zone of a section past the first', async () => {
    const two: N = zone(p(t('One')), { type: 'paragraph', attrs: { sectionBreak: true }, content: [t('Two')] });
    const sectioned = { ...hf, header: null, sections: [{ ...EMPTY_HF_SET }, { ...EMPTY_HF_SET, header: zone(p(date())) }], pageCount: 2 };
    const bytes = await buildOdt(two, undefined, 'portrait', sectioned);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('<text:date text:date-value="2026-03-04');
    expect(styles).not.toMatch(/\u0001DTF|DTF\d+DTF/);
    expect(kindsOf(importOdt(bytes).hfSections?.[1]?.header)).toEqual(['dateTimeField']);
  });
  // Word has no fixed date field, so only an auto one survives as a field there.
  it('rides the DOCX header field and comes back', async () => {
    const back = importDocx(await buildDocx(body, undefined, 'portrait', { ...hf, header: zone(p(t('Stand: '), date(false))) }));
    expect(kindsOf(back.header)).toEqual(['text', 'dateTimeField']);
  });
});

// What a left⇥centre⇥right header rides on: Word puts the stops on the Header style,
// ODF on the zone paragraph's.
describe('zone tab stops', () => {
  const stopped = (stops: string, text: string) => zone({ type: 'paragraph', attrs: { tabStops: stops }, content: [t(text)] });
  const hf = hfOf({ header: stopped('8.5c;17r', 'Links\tMitte\tRechts'), footer: stopped('17r.', 'Kapitel\tSeite') });
  const stopsOf = (d: N) => d?.content?.[0]?.attrs?.tabStops ?? null;
  it('ride the ODF zone styles', async () => {
    const styles = await stylesXml(body, hf);
    expect(styles).toContain('<style:tab-stop style:position="8.5cm" style:type="center"/>');
    expect(styles).toContain('style:leader-style="dotted" style:leader-text="."');
  });
  it.each(FORMATS)('come back from %s', async (_name, roundTrip) => {
    const back = await roundTrip(body, hf);
    expect([stopsOf(back.header), stopsOf(back.footer)]).toEqual(['8.5c;17r', '17r.']);
  });
  // LibreOffice's Header and Footer styles carry exactly this pair.
  it("start a new zone on LibreOffice's centre/right pair for the text width", () => {
    expect(zoneDefaultStops(17)).toBe('8.5c;17r');
    expect(zoneDefaultStops(25.7)).toBe('12.85c;25.7r');
    expect(zoneDefaultStops(0)).toBeNull();
  });
});

// LibreOffice keeps a zone's vertical margins on the Header/Footer paragraph style. A
// footer's space above grows the band; the space below a zone's last paragraph is
// dropped, so neither zone carries it back.
it('carries a zone’s space above through ODF and drops its trailing space below', async () => {
  const hf = hfOf({ header: zone({ type: 'paragraph', attrs: { spaceAfter: 34 }, content: [t('Kopf')] }), footer: zone({ type: 'paragraph', attrs: { spaceBefore: 24 }, content: [t('Fuss')] }) });
  const bytes = await buildOdt(body, undefined, 'portrait', hf);
  const styles = strFromU8(unzipSync(bytes)['styles.xml']);
  expect(styles).toContain('fo:margin-bottom="34pt"');
  expect(styles).toContain('fo:margin-top="24pt"');
  const back = importOdt(bytes);
  expect(back.footer?.content?.[0]?.attrs?.spaceBefore).toBeCloseTo(24, 1);
  expect(back.header?.content?.[0]?.attrs?.spaceAfter ?? 0).toBe(0);
});

// A section past the first carries its own header/footer: Word puts it on the section's
// sectPr, ODF on a master page the section's first block switches to.
describe('per-section header/footer', () => {
  const set = (h: string, f: string): HfSet => ({ ...EMPTY_HF_SET, header: zone(p(t(h))), footer: zone(p(t(f))) });
  const doc: N = zone(p(t('Section one body')), { type: 'paragraph', attrs: { sectionBreak: true }, content: [t('Section two body')] });
  const sections = [set('First header', 'First footer'), set('Second header', 'Second footer')];
  const hf = hfOf({ header: sections[0].header, footer: sections[0].footer, sections, pageCount: 2 });
  const zoneText = (d: N) => d?.content?.[0]?.content?.map((n: N) => n.text ?? '').join('') ?? null;

  it('rides an ODF master page the section’s first block names', async () => {
    const files = unzipSync(await buildOdt(doc, MARGINS, 'portrait', hf));
    const styles = strFromU8(files['styles.xml']);
    expect(styles).toContain('<style:master-page style:name="Section2"');
    expect(styles).toContain('Second header');
    expect(strFromU8(files['content.xml'])).toMatch(/style:master-page-name="Section2"/);
  });
  it.each(FORMATS)('comes back from %s', async (_name, roundTrip) => {
    const back = await roundTrip(doc, hf);
    expect(back.hfSections.length).toBe(2);
    expect(zoneText(back.hfSections[0].header)).toBe('First header');
    expect(zoneText(back.hfSections[1].header)).toBe('Second header');
    expect(zoneText(back.hfSections[1].footer)).toBe('Second footer');
    expect(((back.content as N).content ?? []).filter((b: N) => b.attrs?.sectionBreak).length).toBe(1);
  });
  it('carries a section-only edge distance through both formats', async () => {
    // A header that starts 4cm down, in a body whose own starts at 1.25.
    const own = { ...hf, sections: [sections[0], { ...sections[1], distances: { header: 4, footer: 3 } }] };
    const [odt, docx] = await Promise.all(FORMATS.map(([, roundTrip]) => roundTrip(doc, own)));
    expect(odt.hfSections[0].distances ?? null).toBe(null);
    expect(odt.hfSections[1].distances?.header).toBeCloseTo(4, 2);
    expect(odt.hfSections[1].distances?.footer).toBeCloseTo(3, 2);
    expect(docx.hfSections[0].distances ?? null).toBe(null);
    // Word clamps the distance below the section's own margin, as both products do.
    expect(docx.hfSections[1].distances?.header).toBeCloseTo(2, 2);
    expect(docx.hfSections[1].distances?.footer).toBeCloseTo(2, 2);
  });
  // A zone's area border and padding are ODF's alone (LibreOffice drops them on DOCX
  // export), and keep the zone's paragraphs free of their space.
  it('carries a zone’s area frame through ODF, per section', async () => {
    const frame = { border: { top: '0.5pt solid #FF0000', right: null, bottom: null, left: null }, padding: { top: 0.1, right: 0, bottom: 0, left: 0.2 }, gap: 0.5 };
    const dynamic = { ...frame, dynamic: true, background: '#FFCC00' };
    const own = { ...hf, sections: [{ ...sections[0], frames: { footer: dynamic } }, { ...sections[1], frames: { header: frame } }] };
    const back = importOdt(await buildOdt(doc, MARGINS, 'portrait', own));
    expect(back.hfSections[0].frames?.footer).toEqual(dynamic);
    expect(back.hfSections[0].frames?.header ?? null).toBe(null);
    expect(back.hfSections[1].frames?.header).toEqual(frame);
    expect(back.hfSections[1].header?.content?.[0]?.attrs?.spaceAfter ?? 0).toBe(0);
    expect(back.hfSections[0].footer?.content?.[0]?.attrs?.spaceBefore ?? 0).toBe(0);
  });
  // A first page with its own setup is a master of its own handing over to the section's
  // (LibreOffice's title page); DOCX has no first-page margins or distances to carry.
  it('carries a section’s first-page layout through ODF', async () => {
    const frame = { border: { top: '0.5pt solid #FF0000', right: null, bottom: null, left: null }, padding: { top: 0.1, right: 0, bottom: 0, left: 0 }, gap: 0.3 };
    const second = { ...sections[1], margins: { ...MARGINS, top: 3 }, marginsFirst: { ...MARGINS, top: 5, left: 4 },
      distances: { header: 1, footer: 1 }, distancesFirst: { header: 2, footer: 1.5 }, framesFirst: { header: frame } };
    const back = importOdt(await buildOdt(doc, MARGINS, 'portrait', { ...hf, sections: [sections[0], second] }));
    const s = back.hfSections[1];
    expect(s.margins).toMatchObject(second.margins);
    expect(s.marginsFirst).toMatchObject(second.marginsFirst);
    expect(s.distancesFirst?.header).toBeCloseTo(2, 2);
    expect(s.distancesFirst?.footer).toBeCloseTo(1.5, 2);
    expect(s.framesFirst?.header).toEqual(frame);
    expect(s.frames ?? null).toBe(null);
    expect(zoneText(s.header)).toBe('Second header');
    expect(s.differentFirstPage).toBe(false);
    const titled = { ...second, headerFirst: zone(p(t('Title header'))), differentFirstPage: true };
    const again = importOdt(await buildOdt(doc, MARGINS, 'portrait', { ...hf, sections: [sections[0], titled] })).hfSections[1];
    expect([zoneText(again.headerFirst), zoneText(again.header), again.marginsFirst?.top]).toEqual(['Title header', 'Second header', 5]);
    // The document's own first section: only its frames can differ on page one.
    const lead = { ...sections[0], headerFirst: zone(p(t('Lead title'))), differentFirstPage: true, framesFirst: { header: frame } };
    const led = importOdt(await buildOdt(doc, MARGINS, 'portrait', { ...hf, headerFirst: lead.headerFirst, differentFirstPage: true, sections: [lead, sections[1]] }));
    expect([led.hfSections[0].framesFirst?.header, led.hfSections[0].frames ?? null, zoneText(led.headerFirst), zoneText(led.header)])
      .toEqual([frame, null, 'Lead title', 'First header']);
    expect(led.hfSections.length).toBe(2);
  });
  // A section with zones after one without: the distance it shares with the first page
  // layout is the document's, not the default the first section's missing zones leave.
  it.each(FORMATS)('keeps a later section’s distance its first section has no zones for, through %s', async (_name, roundTrip) => {
    const later = { ...hfOf({ sections: [EMPTY_HF_SET, { ...sections[1], distances: { header: 2, footer: 2 } }], pageCount: 2 }) };
    const back = await roundTrip(doc, later);
    expect(back.hfSections[1].distances?.footer ?? back.footerDistanceCm).toBeCloseTo(2, 2);
    expect(back.hfSections[1].distances?.header ?? back.headerDistanceCm).toBeCloseTo(2, 2);
  });
});

// A header logo placed against the page keeps its place through both formats: the
// importers keep x against the text column and y against the page top (or the body top
// where it is measured from there), and both exporters write that pair back.
describe('a header frame', () => {
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = (id: string, type: string, target: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/></Relationships>`;
  // 2cm from the page's left edge, 1cm below its top (or the body's), behind the text.
  const source = (vFrom: string, wrap: string, posV = '<wp:posOffset>360000</wp:posOffset>') => importDocx(docxOf('<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr><w:headerReference w:type="default" r:id="rId1"/>'
    + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="567" w:footer="567"/></w:sectPr>', { files: {
    'word/_rels/document.xml.rels': rels('rId1', 'header', 'header1.xml'),
    'word/header1.xml': `<?xml version="1.0"?><w:hdr xmlns:w="${W_NS}" xmlns:r="${REL}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
      xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <w:p><w:r><w:drawing><wp:anchor behindDoc="1" allowOverlap="1">
        <wp:positionH relativeFrom="page"><wp:posOffset>720000</wp:posOffset></wp:positionH>
        <wp:positionV relativeFrom="${vFrom}">${posV}</wp:positionV>
        <wp:extent cx="1080000" cy="360000"/>${wrap}
        <a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdLogo"/></pic:blipFill></pic:pic></a:graphicData></a:graphic>
      </wp:anchor></w:drawing></w:r><w:r><w:t>Letterhead</w:t></w:r></w:p></w:hdr>`,
    'word/_rels/header1.xml.rels': rels('rIdLogo', 'image', 'media/logo.png'),
    'word/media/logo.png': PNG,
  } }));
  const logo = (zone: N) => zone?.content?.[0]?.content?.find((n: N) => n.type === 'image')?.attrs;
  const margins = { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 };
  const odtOf = (r: N) => buildOdt(r.content, margins, 'portrait', { header: r.header, footer: null, pageCount: 1 });
  // Through ODT and back through DOCX, the frame's attrs at each stop.
  const journey = async (r: N) => {
    const viaOdt = importOdt(await odtOf(r));
    const viaDocx = importDocx(await buildDocx(viaOdt.content as N, margins, 'portrait', { header: viaOdt.header, footer: null, pageCount: 1 }));
    return [logo(viaOdt.header), logo(viaDocx.header)];
  };

  describe('placed against the page', () => {
    const first = source('page', '<wp:wrapNone/>');
    const place = (a: N) => ({ wrap: a?.wrap, x: a?.wrapOffset, y: a?.wrapOffsetY, fromPage: a?.wrapFromPage, inFront: !!a?.inFront });
    const want = { wrap: 'through', x: -0.54, y: 1, fromPage: true, inFront: false };
    it('is read against the text column and the page top', () => {
      expect(place(logo(first.header))).toEqual(want);
    });
    it('keeps its place through ODT and back through DOCX', async () => {
      expect((await journey(first)).map(place)).toEqual([want, want]);
    });
    it('reads an ODT x measured from the page edge against the column', async () => {
      const files = unzipSync(await odtOf(first));
      // The same frame as LibreOffice may write it: x from the page edge.
      const styles = strFromU8(files['styles.xml'])
        .replace(/style:horizontal-rel="paragraph(?:-content)?"/, 'style:horizontal-rel="page"')
        .replace(/svg:x="-0\.54cm"/, 'svg:x="2cm"');
      expect(styles).toMatch(/horizontal-rel="page"[\s\S]*svg:x="2cm"|svg:x="2cm"[\s\S]*horizontal-rel="page"/);
      files['styles.xml'] = strToU8(styles);
      expect(place(logo(importOdt(zipSync(files)).header))).toEqual(want);
    });
  });

  // Measured from the text area's top (DOCX "margin", ODF "page-content"): a frame that
  // reaches into the body and pushes it down there.
  describe('placed against the body', () => {
    const body = source('margin', '<wp:wrapTopAndBottom/>');
    const fromBody = (a: N) => ({ y: a?.wrapOffsetY, fromBody: !!a?.wrapFromBody, fromPage: !!a?.wrapFromPage });
    const want = { y: 1, fromBody: true, fromPage: false };
    it('is read against the body top', () => {
      expect(fromBody(logo(body.header))).toEqual(want);
    });
    it('keeps it through ODT and back through DOCX', async () => {
      expect(strFromU8(unzipSync(await odtOf(body))['styles.xml'])).toMatch(/vertical-rel="page-content"/);
      expect((await journey(body)).map(fromBody)).toEqual([want, want]);
    });
    // Centred on the text area (Word's picture watermark): (24.62cm − 1cm) / 2 below its top.
    const centred = { y: 11.81, fromBody: true, fromPage: false };
    it('reads a frame centred on the body as the y that centres it (DOCX)', () => {
      expect(fromBody(logo(source('margin', '<wp:wrapNone/>', '<wp:align>center</wp:align>').header))).toEqual(centred);
    });
    it('reads a frame centred on the body as the y that centres it (ODT)', async () => {
      const files = unzipSync(await odtOf(body));
      const styles = new DOMParser().parseFromString(strFromU8(files['styles.xml']), 'application/xml');
      for (const gp of Array.from(styles.getElementsByTagName('style:graphic-properties')))
        if (gp.getAttribute('style:vertical-rel') === 'page-content') gp.setAttribute('style:vertical-pos', 'middle');
      files['styles.xml'] = strToU8(new XMLSerializer().serializeToString(styles));
      expect(fromBody(logo(importOdt(zipSync(files)).header))).toEqual(centred);
    });
  });
});
