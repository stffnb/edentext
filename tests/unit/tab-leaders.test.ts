// A tab stop's leader: the character it repeats across its gap (Word w:tab w:leader,
// ODF style:leader-text).
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { parseTabStops, formatTabStops } from '../../src/lib/editor/extensions/tabStops';

const doc: any = {
  type: 'doc',
  content: [
    { type: 'paragraph', attrs: { tabStops: '6l.;12r_' }, content: [{ type: 'text', text: 'a\tb\tc' }] },
    { type: 'paragraph', attrs: { tabStops: '4c' }, content: [{ type: 'text', text: 'x\ty' }] },
  ],
};

const stopsOfFirst = (d: any) => d.content?.[0]?.attrs?.tabStops ?? null;

describe('tab leaders', () => {
  it('round-trips through the attr form', () => {
    expect(parseTabStops('6l.;12r_')).toEqual([
      { pos: 6, align: 'left', leader: '.' },
      { pos: 12, align: 'right', leader: '_' },
    ]);
    expect(formatTabStops(parseTabStops('6l.;12r_'))).toBe('6l.;12r_');
    // A character we can't render is dropped rather than approximated.
    expect(parseTabStops('6l~')[0].leader).toBe(null);
  });

  it('rides ODF style:leader-text and comes back', async () => {
    const bytes = await buildOdt(doc);
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    expect(content).toContain('style:leader-style="dotted" style:leader-text="."');
    expect(content).toContain('style:leader-style="solid" style:leader-text="_"');
    // The stop without one stays bare.
    expect(content).toContain('<style:tab-stop style:position="4cm" style:type="center"/>');
    expect(stopsOfFirst(importOdt(bytes).content)).toBe('6l.;12r_');
  });

  it('keeps two stops at one position apart', async () => {
    // odf-kit mints one automatic style per option set, so without the leader riding
    // style:type both paragraphs would share a style — and with it one leader.
    const mixed: any = { type: 'doc', content: [
      { type: 'paragraph', attrs: { tabStops: '6l.' }, content: [{ type: 'text', text: 'a\tb' }] },
      { type: 'paragraph', attrs: { tabStops: '6l' }, content: [{ type: 'text', text: 'c\td' }] },
    ] };
    const content = strFromU8(unzipSync(await buildOdt(mixed))['content.xml']);
    expect(content).toContain('<style:tab-stop style:position="6cm" style:type="left" style:leader-style="dotted" style:leader-text="."/>');
    expect(content).toContain('<style:tab-stop style:position="6cm" style:type="left"/>');
  });

  it('rides a DOCX w:leader and comes back', async () => {
    const bytes = await buildDocx(doc);
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('w:leader="dot"');
    expect(stopsOfFirst(importDocx(bytes).content)).toBe('6l.;12r_');
  });
});
