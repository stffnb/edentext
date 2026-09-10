// A frame whose vertical offset counts from the page the anchor lands on (Word's
// positionV relativeFrom="page", ODF's style:vertical-rel="page") keeps that relation
// through both formats — read as paragraph-relative it would move on every re-open.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC';

const doc: N = { type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'image', attrs: { src: PNG, width: 200, height: 100, wrap: 'through', wrapOffset: 1, wrapOffsetY: 17.6, wrapFromPage: true } },
    { type: 'textBox', attrs: { width: 300, height: 120, wrap: 'through', wrapOffset: 0, wrapOffsetY: 5.5, wrapFromPage: true, fillColor: '#34ABA2' },
      content: [{ type: 'paragraph' }] },
  ] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
] };

const find = (n: N, type: string): N => {
  if (n.type === type) return n;
  for (const c of n.content ?? []) { const hit = find(c, type); if (hit) return hit; }
  return null;
};

describe('a frame placed against the page', () => {
  it('round-trips through ODF', async () => {
    const back = importOdt(await buildOdt(doc)).content as N;
    expect(find(back, 'image').attrs).toMatchObject({ wrapFromPage: true, wrapOffsetY: 17.6 });
    expect(find(back, 'textBox').attrs).toMatchObject({ wrapFromPage: true, wrapOffsetY: 5.5 });
  });

  it('round-trips through DOCX', async () => {
    const back = importDocx(await buildDocx(doc)).content as N;
    expect(find(back, 'image').attrs).toMatchObject({ wrapFromPage: true, wrapOffsetY: 17.6 });
    expect(find(back, 'textBox').attrs).toMatchObject({ wrapFromPage: true, wrapOffsetY: 5.5 });
  });
});
