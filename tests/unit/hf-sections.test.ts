// A section past the first carries its own header/footer: Word puts it on the section's
// sectPr, ODF on a master page the section's first block switches to.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import type { HfSet } from '../../src/lib/storage/headerFooter';

type N = any;

const zone = (text: string): N => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const set = (h: string, f: string): HfSet => ({
  header: zone(h), footer: zone(f),
  headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false,
});

const doc: N = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Section one body' }] },
    { type: 'paragraph', attrs: { sectionBreak: true }, content: [{ type: 'text', text: 'Section two body' }] },
  ],
};

const sections = [set('First header', 'First footer'), set('Second header', 'Second footer')];
const hf = {
  header: sections[0].header, footer: sections[0].footer,
  headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false,
  sections, pageCount: 2,
};

const zoneText = (d: any) => d?.content?.[0]?.content?.map((n: any) => n.text ?? '').join('') ?? null;

describe('per-section header/footer', () => {
  it('rides an ODF master page and comes back', async () => {
    const bytes = await buildOdt(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait', hf);
    const files = unzipSync(bytes);
    const styles = strFromU8(files['styles.xml']);
    expect(styles).toContain('<style:master-page style:name="Section2"');
    expect(styles).toContain('Second header');
    // The section's first block points at it.
    expect(strFromU8(files['content.xml'])).toMatch(/style:master-page-name="Section2"/);

    const back = await importOdt(bytes);
    expect(back.hfSections.length).toBe(2);
    expect(zoneText(back.hfSections[0].header)).toBe('First header');
    expect(zoneText(back.hfSections[1].header)).toBe('Second header');
    expect(zoneText(back.hfSections[1].footer)).toBe('Second footer');
    const marked = (back.content.content ?? []).filter((b: any) => b.attrs?.sectionBreak);
    expect(marked.length).toBe(1);
  });

  it('rides a DOCX sectPr and comes back', async () => {
    const bytes = await buildDocx(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait', hf);
    const back = importDocx(bytes);
    expect(back.hfSections.length).toBe(2);
    expect(zoneText(back.hfSections[0].header)).toBe('First header');
    expect(zoneText(back.hfSections[1].header)).toBe('Second header');
    expect((back.content.content ?? []).filter((b: any) => b.attrs?.sectionBreak).length).toBe(1);
  });

  it('carries a section-only edge distance through both formats', async () => {
    // An index whose header starts 4cm down, in a body whose own starts at 1.25.
    const deep = [sections[0], { ...sections[1], distances: { header: 4, footer: 3 } }];
    const own = { ...hf, sections: deep };
    const odt = await importOdt(await buildOdt(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait', own));
    expect(odt.hfSections[0].distances ?? null).toBe(null);
    expect(odt.hfSections[1].distances?.header).toBeCloseTo(4, 2);
    expect(odt.hfSections[1].distances?.footer).toBeCloseTo(3, 2);

    const docx = importDocx(await buildDocx(doc, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait', own));
    expect(docx.hfSections[0].distances ?? null).toBe(null);
    // Word clamps the distance below the section's own margin, as both products do.
    expect(docx.hfSections[1].distances?.header).toBeCloseTo(2, 2);
    expect(docx.hfSections[1].distances?.footer).toBeCloseTo(2, 2);
  });
});
