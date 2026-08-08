// The document's default tab interval: Word's w:defaultTabStop, ODF's
// style:tab-stop-distance on the paragraph default-style.
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { DEFAULT_TAB_INTERVAL_CM, ODF_IMPLIED_TAB_CM, clampTabInterval } from '../../src/lib/storage/tabInterval';

const doc: any = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a\tb' }] }] };
const opts = [undefined, 'portrait', undefined, undefined, 'A4', undefined] as const;
const odt = (cm?: number) => buildOdt(doc, ...(opts as any), cm);
const docx = (cm?: number) => buildDocx(doc, ...(opts as any), cm);

describe('default tab interval', () => {
  it('rides an ODF default-style and comes back', async () => {
    const back = await importOdt(await odt(1.27));
    expect(back.tabIntervalCm).toBeCloseTo(1.27, 3);
  });

  it('declares the editor default too', async () => {
    // Left implied, a file falls back to ODF's own 2cm — measured against LibreOffice,
    // which puts a bare A⇥X there and not at its UI default of 1.25.
    const styles = strFromU8(unzipSync(await odt(DEFAULT_TAB_INTERVAL_CM))['styles.xml']);
    expect(styles).toContain('style:tab-stop-distance="1.25cm"');
    expect((await importOdt(await odt(DEFAULT_TAB_INTERVAL_CM))).tabIntervalCm).toBeCloseTo(1.25, 3);
  });

  it('falls back to ODF’s own implied default', async () => {
    const stripped = await odt(1.25).then((b) => {
      const files = unzipSync(b);
      files['styles.xml'] = new TextEncoder().encode(
        strFromU8(files['styles.xml']).replace(/<style:default-style style:family="paragraph">[\s\S]*?<\/style:default-style>/, ''));
      return zipSync(files);
    });
    expect((await importOdt(stripped)).tabIntervalCm).toBeCloseTo(ODF_IMPLIED_TAB_CM, 3);
  });

  it('rides a DOCX setting and comes back', async () => {
    // Word stores twips, so 1.27cm = 720tw is exact and 1.25cm rounds to 709tw.
    expect(importDocx(await docx(1.27)).tabIntervalCm).toBeCloseTo(1.27, 2);
    expect(importDocx(await docx(DEFAULT_TAB_INTERVAL_CM)).tabIntervalCm).toBeCloseTo(1.25, 2);
  });

  it('clamps a nonsense value to something renderable', () => {
    expect(clampTabInterval(0)).toBe(0.05);
    expect(clampTabInterval(999)).toBe(10);
    expect(clampTabInterval(NaN)).toBe(DEFAULT_TAB_INTERVAL_CM);
  });
});
