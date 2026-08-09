// Two top-and-bottom frames set against opposite ends of nearby paragraphs share one
// band (import/odt.ts pairAlignedFrames), and that alignment round-trips both ways.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt, pairAlignedFrames } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMG = (attrs: N): N => ({ type: 'image', attrs: { src: PNG, width: 300, height: 200, ...attrs } });
const para = (img: N): N => ({ type: 'paragraph', content: [img] });
const frames = (d: N) => d.content.flatMap((b: N) => (b.content ?? []).filter((n: N) => n.type === 'image'));
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

const pair: N = {
  type: 'doc',
  content: [
    para(IMG({ wrap: 'topBottom', wrapAlign: 'left' })),
    para(IMG({ wrap: 'topBottom', wrapAlign: 'right' })),
  ],
};

describe('a shared frame band', () => {
  it('keeps the alignment of two frames set against opposite ends', () => {
    const blocks = [para(IMG({ wrap: 'topBottom', wrapAlign: 'left' })), { type: 'paragraph' },
      para(IMG({ wrap: 'topBottom', wrapAlign: 'right' }))];
    pairAlignedFrames(blocks, 640);
    expect(frames({ content: blocks }).map((f: N) => f.attrs.wrapAlign)).toEqual(['left', 'right']);
  });

  it('drops it from a lone frame, from a same-end pair, and from one too far away', () => {
    const cases: N[][] = [
      [para(IMG({ wrap: 'topBottom', wrapAlign: 'left' }))],
      [para(IMG({ wrap: 'topBottom', wrapAlign: 'left' })), para(IMG({ wrap: 'topBottom', wrapAlign: 'left' }))],
      [para(IMG({ wrap: 'topBottom', wrapAlign: 'left' })), ...Array.from({ length: 4 }, () => ({ type: 'paragraph' })),
        para(IMG({ wrap: 'topBottom', wrapAlign: 'right' }))],
    ];
    for (const blocks of cases) {
      pairAlignedFrames(blocks, 640);
      for (const f of frames({ content: blocks })) expect(f.attrs.wrapAlign).toBeNull();
    }
  });

  it('scales a pair a little wider than the column down to it, and breaks a much wider one', () => {
    const snug = [para(IMG({ wrap: 'topBottom', wrapAlign: 'left', width: 330 })),
      para(IMG({ wrap: 'topBottom', wrapAlign: 'right', width: 330 }))];
    pairAlignedFrames(snug, 640);
    expect(frames({ content: snug }).map((f: N) => f.attrs.width)).toEqual([320, 320]);
    const wide = [para(IMG({ wrap: 'topBottom', wrapAlign: 'left', width: 500 })),
      para(IMG({ wrap: 'topBottom', wrapAlign: 'right', width: 500 }))];
    pairAlignedFrames(wide, 640);
    for (const f of frames({ content: wide })) expect(f.attrs.wrapAlign).toBeNull();
  });

  it('round-trips the two ends through ODF and DOCX', async () => {
    for (const back of [frames((await importOdt(await buildOdt(pair, margins, 'portrait'))).content),
      frames(importDocx(await buildDocx(pair, margins, 'portrait')).content)]) {
      expect(back.map((f: N) => f.attrs.wrap)).toEqual(['topBottom', 'topBottom']);
      expect(back.map((f: N) => f.attrs.wrapAlign)).toEqual(['left', 'right']);
    }
  });
});
