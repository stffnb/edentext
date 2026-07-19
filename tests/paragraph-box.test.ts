import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { DEFAULT_MARGINS } from '../src/lib/storage/pageMargins';
import { hfIsEmpty } from '../src/lib/storage/headerFooter';

type N = { type: string; attrs?: any; content?: N[] };

const bandedBody: N = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { backgroundColor: '#CCFFFF', borderTop: '2pt solid #FF0000', borderRight: '1pt solid #00B050', borderBottom: '4pt solid #0066CC', borderLeft: '1pt solid #00B050' }, content: [{ type: 'text', text: 'banded body' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
  ],
};
const bandedHeader: N = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { backgroundColor: '#CCFFFF', borderBottom: '3pt solid #0066CC', textAlign: 'right' }, content: [{ type: 'text', text: 'Letterhead' }] },
  ],
};

function firstBanded(doc: N): N | undefined {
  return doc.content?.find((n) => n.type === 'paragraph' && !!n.content?.length);
}

describe('paragraph background + borders round trip', () => {
  it('ODF round-trips body shading + all four borders and a header rule', async () => {
    const odt = await buildOdt(bandedBody as any, DEFAULT_MARGINS, 'portrait', {
      header: bandedHeader as any, footer: null, pageCount: 1,
    } as any);
    const back: any = importOdt(odt);

    const bp = firstBanded(back.content)!;
    expect(bp.attrs.backgroundColor?.toUpperCase()).toBe('#CCFFFF');
    expect(bp.attrs.borderTop).toMatch(/2pt solid #FF0000/i);
    expect(bp.attrs.borderRight).toMatch(/1pt solid #00B050/i);
    expect(bp.attrs.borderBottom).toMatch(/4pt solid #0066CC/i);
    expect(bp.attrs.borderLeft).toMatch(/1pt solid #00B050/i);

    const hp = back.header.content[0];
    expect(hp.attrs.backgroundColor?.toUpperCase()).toBe('#CCFFFF');
    expect(hp.attrs.borderBottom).toMatch(/3pt solid #0066CC/i);
    expect(hp.attrs.textAlign).toBe('right');
  });

  it('DOCX round-trips body shading + borders (w:shd/w:pBdr) and a header rule', async () => {
    const bytes = await buildDocx(bandedBody as any, DEFAULT_MARGINS, 'portrait', {
      header: bandedHeader as any, footer: null, pageCount: 1,
    } as any);
    const back: any = importDocx(bytes);

    const bp = firstBanded(back.content)!;
    expect(bp.attrs.backgroundColor?.toUpperCase()).toBe('#CCFFFF');
    expect(bp.attrs.borderTop).toMatch(/2pt solid #FF0000/i);
    expect(bp.attrs.borderBottom).toMatch(/4pt solid #0066CC/i);
    expect(bp.attrs.borderLeft).toMatch(/1pt solid #00B050/i);

    const hp = back.header.content[0];
    expect(hp.attrs.backgroundColor?.toUpperCase()).toBe('#CCFFFF');
    expect(hp.attrs.borderBottom).toMatch(/3pt solid #0066CC/i);
  });

  it('treats a rule-only header/footer paragraph as non-empty (so it renders/exports)', () => {
    const ruleOnly: N = { type: 'doc', content: [{ type: 'paragraph', attrs: { borderTop: '4pt solid #0066CC' } }] };
    expect(hfIsEmpty(ruleOnly as any)).toBe(false);
    expect(hfIsEmpty({ type: 'doc', content: [{ type: 'paragraph' }] } as any)).toBe(true);
  });

  it('drops background/borders that are absent (no accretion)', async () => {
    const plain: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
    const odt = await buildOdt(plain as any, DEFAULT_MARGINS, 'portrait');
    const back: any = importOdt(odt);
    const p = firstBanded(back.content)!;
    expect(p.attrs?.backgroundColor ?? null).toBeNull();
    expect(p.attrs?.borderBottom ?? null).toBeNull();
  });
});

// Real LibreOffice letterhead: two header paragraphs (name = shading, address = shading +
// bottom rule) collapse to one paragraph with shading + the bottom rule; the footer is a
// single empty paragraph carrying only a top rule. Local-only fixture — skips in CI.
const FIXTURE = 'debug/bewerbung.net_anschreibenvorlage-openoffice.odt';
describe.skipIf(!existsSync(FIXTURE))('colored header/footer from a real ODT', () => {
  it('merges the header band + rule and keeps the footer rule line', () => {
    const res: any = importOdt(new Uint8Array(readFileSync(FIXTURE)));
    const hp = res.header.content[0];
    expect(hp.attrs.backgroundColor?.toUpperCase()).toBe('#CCFFFF');
    expect(hp.attrs.borderBottom).toMatch(/pt solid #0066CC/i);
    const fp = res.footer.content[0];
    expect(fp.attrs.borderTop).toMatch(/pt solid #0066CC/i);
  });

  // dynamic-spacing="true" ⇒ the header→body gap is not reserved as body margin: top =
  // page margin 0.801 + header min-height 2.2 ≈ 3.0cm (not 0.801 + 2.2 + 2.099 spacing).
  it('does not reserve the dynamic header/footer spacing in the body margin', () => {
    const res: any = importOdt(new Uint8Array(readFileSync(FIXTURE)));
    expect(res.margins.top).toBeCloseTo(3.0, 1);
    expect(res.margins.bottom).toBeCloseTo(2.22, 1); // 1.199 page + 1.021 footer height
  });
});
