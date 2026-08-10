// Where an as-char frame sits against the line: ODF style:vertical-pos/-rel in, a CSS
// vertical-align out, and back to the same pair on export.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { inlineVerticalAlign } from '../../src/lib/editor/extensions/image';

type N = any;

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const IMG = (attrs: N): N => ({ type: 'image', attrs: { src: PNG, width: 80, height: 40, ...attrs } });
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

const doc = (attrs: N): N => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }, IMG(attrs)] }],
});
const frame = (d: N) => d.content[0].content.find((n: N) => n.type === 'image');

describe('an as-char frame’s vertical alignment', () => {
  it('lowers the box by what the alignment puts below the baseline', () => {
    expect(inlineVerticalAlign(null, 40, null)).toBe('');
    expect(inlineVerticalAlign('middle', 40, null)).toBe('-20px');
    expect(inlineVerticalAlign('below', 40, null)).toBe('-40px');
    expect(inlineVerticalAlign('text-top', 40, null)).toBe('text-top');
    expect(inlineVerticalAlign('text-bottom', 40, null)).toBe('text-bottom');
    expect(inlineVerticalAlign('text-middle', 40, null)).toBe('calc(0.36em - 20px)');
    // The frame's top an offset below the baseline, so its bottom is that plus its height.
    expect(parseFloat(inlineVerticalAlign('offset', 40, -0.529))).toBeCloseTo(-20, 0);
  });

  it('round-trips through ODF', async () => {
    for (const v of ['middle', 'below', 'text-top', 'text-middle', 'text-bottom']) {
      const img = frame((await importOdt(await buildOdt(doc({ vAlign: v }), margins, 'portrait'))).content);
      expect(img.attrs.vAlign, v).toBe(v);
    }
    const off = frame((await importOdt(
      await buildOdt(doc({ vAlign: 'offset', wrapOffsetY: -0.377 }), margins, 'portrait'),
    )).content);
    expect(off.attrs.vAlign).toBe('offset');
    expect(off.attrs.wrapOffsetY).toBeCloseTo(-0.377, 3);
  });

  it('leaves a baseline-aligned frame without a graphic style', async () => {
    const odt = await buildOdt(doc({}), margins, 'portrait');
    const img = frame((await importOdt(odt)).content);
    expect(img.attrs.vAlign ?? null).toBe(null);
  });
});
