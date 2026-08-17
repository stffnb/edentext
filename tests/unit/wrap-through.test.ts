// Word's in-front-of / behind-text (wp:wrapNone + behindDoc) and ODF's run-through:
// the text runs over or under the frame, so it reserves neither width nor height.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMG = (attrs: N): N => ({ type: 'image', attrs: { src: PNG, width: 200, height: 120, ...attrs } });

const docWith = (attrs: N): N => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [IMG(attrs), { type: 'text', text: 'anchor text' }] }],
});

const frame = (d: N) => d.content[0].content.find((n: N) => n.type === 'image');
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

describe('a run-through frame', () => {
  it('round-trips the mode and its z-order through ODF', async () => {
    const front = frame((await importOdt(await buildOdt(docWith({ wrap: 'through', inFront: true }), margins, 'portrait'))).content);
    expect(front.attrs.wrap).toBe('through');
    expect(front.attrs.inFront).toBe(true);
    const behind = frame((await importOdt(await buildOdt(docWith({ wrap: 'through' }), margins, 'portrait'))).content);
    expect(behind.attrs.wrap).toBe('through');
    expect(behind.attrs.inFront).not.toBe(true);
  });

  it('round-trips the mode and its z-order through DOCX', async () => {
    const front = frame(importDocx(await buildDocx(docWith({ wrap: 'through', inFront: true }), margins, 'portrait')).content);
    expect(front.attrs.wrap).toBe('through');
    expect(front.attrs.inFront).toBe(true);
    const behind = frame(importDocx(await buildDocx(docWith({ wrap: 'through' }), margins, 'portrait')).content);
    expect(behind.attrs.wrap).toBe('through');
    expect(behind.attrs.inFront).toBe(false);
  });

  it('keeps its offsets, which place it against the anchor rather than reserve space', async () => {
    const img = frame((await importOdt(await buildOdt(docWith({ wrap: 'through', wrapOffset: 1.5, wrapOffsetY: 4.25 }), margins, 'portrait'))).content);
    expect(img.attrs.wrapOffset).toBeCloseTo(1.5, 2);
    expect(img.attrs.wrapOffsetY).toBeCloseTo(4.25, 2);
  });

  // ODF's `none` is the one that means above-and-below; only run-through reserves nothing.
  it('is not what ODF style:wrap="none" means', async () => {
    const img = frame((await importOdt(await buildOdt(docWith({ wrap: 'topBottom' }), margins, 'portrait'))).content);
    expect(img.attrs.wrap).toBe('topBottom');
  });
});
