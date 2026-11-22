// A floating frame's gap to the text on all four sides, through both formats.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { wrapGap, parseWrapGap, wrapGapText } from '../../src/lib/editor/extensions/image';
import { zipSync, strToU8 } from 'fflate';

type N = any;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GAP = { top: 0.25, right: 0.5, bottom: 0.4, left: 0.5 };

const doc = (frame: N): N => ({ type: 'doc', content: [
  { type: 'paragraph', content: [frame, { type: 'text', text: 'beside the frame' }] },
] });
const image = (attrs: N): N => ({ type: 'image', attrs: { src: PNG, width: 96, height: 96, ...attrs } });
const box = (attrs: N): N => ({ type: 'textBox', attrs: { width: 200, height: 96, ...attrs }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'box' }] }] });
const find = (n: N, type: string): N => {
  if (n.type === type) return n;
  for (const c of n.content ?? []) { const hit = find(c, type); if (hit) return hit; }
  return null;
};
const odt = async (d: N) => importOdt(await buildOdt(d)).content as N;
const docx = async (d: N) => importDocx(await buildDocx(d)).content as N;

describe('wrap gap', () => {
  it('reads a plain number as the sides and four numbers as all of them', () => {
    expect(wrapGap(0.32)).toEqual({ top: 0, right: 0.32, bottom: 0, left: 0.32 });
    expect(wrapGap(null)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parseWrapGap('0.5')).toBe(0.5);
    expect(parseWrapGap(wrapGapText(GAP))).toEqual(GAP);
  });

  for (const [name, read] of [['ODT', odt], ['DOCX', docx]] as const) {
    it(`keeps the text's side, above and below of a side-wrapped picture (${name})`, async () => {
      const back = find(await read(doc(image({ wrap: 'left', wrapDist: GAP }))), 'image');
      expect(wrapGap(back.attrs.wrapDist)).toMatchObject({ top: 0.25, bottom: 0.4, right: 0.5 });
    });

    it(`keeps above and below of a top-and-bottom text box (${name})`, async () => {
      const back = find(await read(doc(box({ wrap: 'topBottom', wrapDist: GAP }))), 'textBox');
      expect(wrapGap(back.attrs.wrapDist)).toMatchObject({ top: 0.25, bottom: 0.4 });
    });

    it(`reads a side gap alone back as the plain number (${name})`, async () => {
      const back = find(await read(doc(image({ wrap: 'right', wrapDist: 0.32 }))), 'image');
      expect(back.attrs.wrapDist).toBe(0.32);
    });
  }

  it('gives an ODT text box in the line without a style LibreOffice\'s Frame margins and padding', () => {
    const content = `<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
      xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"><office:body><office:text><text:p>a<draw:frame
      text:anchor-type="as-char" svg:width="3cm" svg:height="1cm"><draw:text-box><text:p>box</text:p></draw:text-box></draw:frame></text:p></office:text></office:body></office:document-content>`;
    const back = find(importOdt(zipSync({ 'content.xml': strToU8(content) })).content as N, 'textBox');
    const gap = wrapGap(back.attrs.wrapDist);
    for (const side of ['top', 'right', 'bottom', 'left'] as const) expect(gap[side]).toBeCloseTo(0.2, 2);
    expect(back.attrs.paddingCm ?? 0.15).toBe(0.15);
  });
});
