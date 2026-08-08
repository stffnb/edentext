// A list level's indent: Word's w:lvl/w:pPr/w:ind w:left, ODF's label-alignment
// fo:margin-left. Both are absolute, the editor nests one step per level, so the attr
// is the step past the level above.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const item = (text: string, sub?: N): N =>
  ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...(sub ? [sub] : [])] });

// Level 1 sits 0.5cm right of the base, level 2 0.6cm left of its own base.
const doc: N = {
  type: 'doc',
  content: [
    { type: 'bulletList', attrs: { indent: 0.5 }, content: [
      item('one', { type: 'bulletList', attrs: { indent: -0.6 }, content: [item('nested')] }),
      item('two'),
    ] },
  ],
};

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const lists = (d: N) => {
  const top = d.content!.find((n: N) => n.type === 'bulletList') as N;
  return [top, top.content[0].content[1]];
};

describe('list level indents', () => {
  it('round-trips a per-level indent through ODF', async () => {
    const [top, nested] = lists((await importOdt(await buildOdt(doc, margins, 'portrait'))).content);
    expect(top.attrs?.indent).toBeCloseTo(0.5, 2);
    expect(nested.attrs?.indent).toBeCloseTo(-0.6, 2);
  });

  it('round-trips a per-level indent through DOCX', async () => {
    const [top, nested] = lists(importDocx(await buildDocx(doc, margins, 'portrait')).content);
    expect(top.attrs?.indent).toBeCloseTo(0.5, 2);
    expect(nested.attrs?.indent).toBeCloseTo(-0.6, 2);
  });

  it('leaves an ordinary list unindented in both formats', async () => {
    const plain: N = { type: 'doc', content: [
      { type: 'bulletList', content: [item('one', { type: 'bulletList', content: [item('nested')] })] },
    ] };
    for (const back of [
      (await importOdt(await buildOdt(plain, margins, 'portrait'))).content,
      importDocx(await buildDocx(plain, margins, 'portrait')).content,
    ]) {
      for (const list of lists(back)) expect(list.attrs?.indent ?? null).toBeNull();
    }
  });
});
