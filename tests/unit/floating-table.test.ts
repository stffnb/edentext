// Word's floating table (w:tblpPr) is a frame holding a table — LibreOffice's own model
// for it — so what follows the table keeps its place instead of starting below it.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { unzipSync, strFromU8 } from 'fflate';

type N = any;

const cell = (text: string): N => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [180] },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

const table: N = { type: 'table', content: [
  { type: 'tableRow', content: [cell('Report'), cell('2018')] },
  { type: 'tableRow', content: [cell('Company'), cell('Name')] },
] };

const doc: N = { type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'textBox', attrs: { width: 372, wrap: 'left', wrapDist: 0.32 }, content: [table] },
    { type: 'text', text: 'beside the frame' },
  ] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
] };

const find = (n: N, type: string): N => {
  if (n.type === type) return n;
  for (const c of n.content ?? []) { const hit = find(c, type); if (hit) return hit; }
  return null;
};
const paraText = (p: N): string => (p.content ?? []).filter((n: N) => n.type === 'text').map((n: N) => n.text).join('');
const cellTexts = (t: N): string[] => (t.content ?? []).flatMap((r: N) =>
  (r.content ?? []).map((c: N) => find(c, 'text')?.text ?? ''));

describe('a floating table', () => {
  it('round-trips through ODF as a frame holding the table', async () => {
    const bytes = await buildOdt(doc);
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toMatch(/<draw:text-box[^>]*>\s*<table:table/);
    const back = importOdt(bytes).content as N;
    const box = find(back, 'textBox');
    expect(box.attrs).toMatchObject({ wrap: 'left' });
    expect(cellTexts(box.content[0])).toEqual(['Report', '2018', 'Company', 'Name']);
    expect(paraText(back.content[0])).toBe('beside the frame');
  });

  it('round-trips through DOCX as w:tblpPr', async () => {
    const bytes = await buildDocx(doc);
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toMatch(/<w:tblpPr[^>]*w:horzAnchor="margin"/);
    const back = importDocx(bytes).content as N;
    const box = find(back, 'textBox');
    expect(box.attrs).toMatchObject({ wrap: 'left' });
    expect(cellTexts(box.content[0])).toEqual(['Report', '2018', 'Company', 'Name']);
    // The table is out of the flow: the text it was anchored beside stays with it.
    expect(paraText(back.content[0])).toBe('beside the frame');
  });
});
