// A top-and-bottom frame's own place: Word's positionH/positionV posOffset, ODF's
// svg:x/svg:y. Both offsets round-trip, and one set below its paragraph's top sinks
// behind that paragraph's text (a full-width float pushes following lines under it).
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt, sinkOffsetFrames } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMG = (attrs: N): N => ({ type: 'image', attrs: { src: PNG, width: 200, height: 120, ...attrs } });

const doc: N = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'text', text: 'anchor text' }, IMG({ wrap: 'topBottom', wrapOffset: 3.5, wrapOffsetY: 5.75 })],
  }],
};

const frame = (d: N) => d.content[0].content.find((n: N) => n.type === 'image');
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

describe('a top-and-bottom frame’s offsets', () => {
  it('round-trips both offsets through ODF', async () => {
    const img = frame((await importOdt(await buildOdt(doc, margins, 'portrait'))).content);
    expect(img.attrs.wrapOffset).toBeCloseTo(3.5, 2);
    expect(img.attrs.wrapOffsetY).toBeCloseTo(5.75, 2);
  });

  it('round-trips both offsets through DOCX', async () => {
    const img = frame(importDocx(await buildDocx(doc, margins, 'portrait')).content);
    expect(img.attrs.wrapOffset).toBeCloseTo(3.5, 2);
    expect(img.attrs.wrapOffsetY).toBeCloseTo(5.75, 2);
  });

  it('sinks a frame set below the paragraph top behind its text', () => {
    const content = [IMG({ wrap: 'topBottom', wrapOffsetY: 5.75 }), { type: 'text', text: 'hi' }];
    sinkOffsetFrames(content);
    expect(content.map((n: N) => n.type)).toEqual(['text', 'image']);
  });

  it('leaves a frame at the paragraph top, and one with no text to stand behind', () => {
    const flush = [IMG({ wrap: 'topBottom' }), { type: 'text', text: 'hi' }];
    sinkOffsetFrames(flush);
    expect(flush.map((n: N) => n.type)).toEqual(['image', 'text']);
    const alone = [IMG({ wrap: 'topBottom', wrapOffsetY: 5.75 })];
    sinkOffsetFrames(alone);
    expect(alone.map((n: N) => n.type)).toEqual(['image']);
  });
});
