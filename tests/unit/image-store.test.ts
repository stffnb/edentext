import { describe, it, expect } from 'vitest';
import { stashImages, IDB_SRC } from '../../src/lib/storage/imageStore';

const big = (fill: string) => `data:image/png;base64,${fill.repeat(5000)}`;

const doc = (...content: any[]) => ({ type: 'doc', content });
const img = (src: string) => ({ type: 'image', attrs: { src, width: 100 } });
const para = (...content: any[]) => ({ type: 'paragraph', content });

describe('stashImages', () => {
  it('replaces a large picture and keeps its other attrs', () => {
    const src = big('A');
    const json: any = doc(para(img(src)));
    const { json: slim, blobs } = stashImages(json);
    const out = (slim as any).content[0].content[0];
    expect(out.attrs.src.startsWith(IDB_SRC)).toBe(true);
    expect(out.attrs.width).toBe(100);
    expect([...blobs.values()]).toEqual([src]);
    // The caller's JSON is what the editor is still holding.
    expect(json.content[0].content[0].attrs.src).toBe(src);
  });

  it('leaves an icon and a non-data src inline', () => {
    const { json: slim, blobs } = stashImages(doc(para(img('data:image/png;base64,AAAA'), img('https://x/y.png'))));
    expect(blobs.size).toBe(0);
    expect((slim as any).content[0].content[0].attrs.src).toBe('data:image/png;base64,AAAA');
    expect((slim as any).content[0].content[1].attrs.src).toBe('https://x/y.png');
  });

  it('reaches a picture at any depth and dedupes by content', () => {
    const src = big('B');
    const cell = (...c: any[]) => ({ type: 'tableCell', content: c });
    const { json: slim, blobs } = stashImages(doc(
      { type: 'table', content: [{ type: 'tableRow', content: [cell(para(img(src)))] }] },
      { type: 'textBox', content: [para(img(src))] },
    ));
    expect(blobs.size).toBe(1);
    const keys = JSON.stringify(slim).match(new RegExp(`${IDB_SRC}[a-z0-9]+`, 'g'));
    expect(keys?.length).toBe(2);
    expect(new Set(keys).size).toBe(1);
  });

  it('gives two different pictures two keys', () => {
    const { blobs } = stashImages(doc(para(img(big('C')), img(big('D')))));
    expect(blobs.size).toBe(2);
  });
});
