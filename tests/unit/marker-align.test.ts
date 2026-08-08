// Which end of the hanging indent a list label is set against: Word's w:lvlJc,
// ODF's fo:text-align on the level properties. `right` is what keeps a Roman
// numeral out of the text it labels.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const item = (text: string): N => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const doc = (markerAlign?: string): N => ({
  type: 'doc',
  content: [{
    type: 'orderedList',
    attrs: { listStyleType: 'upper-roman', ...(markerAlign ? { markerAlign } : {}) },
    content: [item('one'), item('two')],
  }],
});

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const list = (d: N) => d.content.find((n: N) => n.type === 'orderedList');

describe('a list label’s alignment', () => {
  it('round-trips through ODF', async () => {
    expect(list((await importOdt(await buildOdt(doc('right'), margins, 'portrait'))).content).attrs?.markerAlign).toBe('right');
    expect(list((await importOdt(await buildOdt(doc(), margins, 'portrait'))).content).attrs?.markerAlign).toBeUndefined();
  });

  it('round-trips through DOCX', async () => {
    expect(list(importDocx(await buildDocx(doc('right'), margins, 'portrait')).content).attrs?.markerAlign).toBe('right');
    expect(list(importDocx(await buildDocx(doc(), margins, 'portrait')).content).attrs?.markerAlign).toBeUndefined();
  });
});
