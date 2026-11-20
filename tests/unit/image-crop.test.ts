import { describe, it, expect } from 'vitest';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { imageSizeCm } from '../../src/lib/import/imageFormats';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

// A PNG header only (676×422 px, pHYs 4330 px/m = 110dpi): the size is all a crop reads.
function png(w: number, h: number, ppm?: number): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => [...u32(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk('IHDR', [...u32(w), ...u32(h), 8, 6, 0, 0, 0]),
    ...(ppm ? chunk('pHYs', [...u32(ppm), ...u32(ppm), 1]) : []),
    ...chunk('IEND', []),
  ]);
}
// An EMF header record: type 1, the frame in 0.01mm at byte 24, ' EMF' at byte 40.
function emf(w: number, h: number): Uint8Array {
  const b = new Uint8Array(88), d = new DataView(b.buffer);
  d.setUint32(0, 1, true); d.setUint32(4, 88, true);
  d.setInt32(32, w, true); d.setInt32(36, h, true);
  d.setUint32(40, 0x464d4520, true);
  return b;
}
const dataUrl = (b: Uint8Array) => `data:image/png;base64,${btoa(String.fromCharCode(...b))}`;

const crop = { l: 0.1, t: 0.01932, r: 0.05, b: 0.2 };
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'image', attrs: { src: dataUrl(png(676, 422, 4330)), width: 300, height: 200, crop } },
] }] } as never;

const imageOf = (json: { content?: unknown[] }): { attrs: Record<string, unknown> } =>
  JSON.parse(JSON.stringify(json)).content.flatMap((b: { content?: unknown[] }) => b.content ?? [])
    .find((n: { type: string }) => n.type === 'image');

describe('picture crop and colour mode', () => {
  it('measures a picture at its own size: a bitmap at its resolution, a metafile by its frame, an SVG by its lengths', () => {
    expect(imageSizeCm(png(676, 422, 4330))!.h).toBeCloseTo(9.746, 3);
    expect(imageSizeCm(png(96, 48))).toEqual({ w: 2.54, h: 1.27 });
    expect(imageSizeCm(emf(6770, 3400))).toEqual({ w: 6.77, h: 3.4 });
    expect(imageSizeCm(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="5cm" height="96">'))).toEqual({ w: 5, h: 2.54 });
  });

  // A metafile's clip, also where the frame's bitmap fallback is what gets drawn.
  it('reads an ODF clip against a metafile frame', async () => {
    const odt = await buildOdt(doc);
    const files = unzipSync(odt);
    const pic = Object.keys(files).find((k) => k.startsWith('Pictures/'))!;
    const xml = strFromU8(files['content.xml']);
    const frame = /<draw:frame[\s\S]*?<\/draw:frame>/.exec(xml)![0];
    files['Pictures/meta.emf'] = emf(6770, 3400);
    files['content.xml'] = strToU8(xml.replace(frame, frame.replace(/<draw:image /, `<draw:image xlink:href="Pictures/meta.emf"/><draw:image `))
      .replace(/fo:clip="[^"]*"/, 'fo:clip="rect(0.34cm, 1.354cm, 0cm, 0.677cm)"'));
    expect(pic).toBeTruthy();
    const got = imageOf(importOdt(zipSync(files)).content as never).attrs.crop as typeof crop;
    expect(got.l).toBeCloseTo(0.1, 3);
    expect(got.r).toBeCloseTo(0.2, 3);
    expect(got.t).toBeCloseTo(0.1, 3);
  });

  it('round-trips through DOCX as a:srcRect', async () => {
    const got = imageOf(importDocx(await buildDocx(doc)).content as never).attrs.crop as typeof crop;
    for (const k of ['l', 't', 'r', 'b'] as const) expect(got[k]).toBeCloseTo(crop[k], 5);
  });

  it('round-trips through ODT as fo:clip', async () => {
    const got = imageOf(importOdt(await buildOdt(doc)).content as never).attrs.crop as typeof crop;
    for (const k of ['l', 't', 'r', 'b'] as const) expect(got[k]).toBeCloseTo(crop[k], 3);
  });

  // A colour mode rides the same picture properties: ODF's draw:color-mode, Word's blip effect.
  it.each(['greyscale', 'mono', 'watermark'])('round-trips the %s colour mode through both formats', async (mode) => {
    const moded = JSON.parse(JSON.stringify(doc));
    moded.content[0].content[0].attrs.colorMode = mode;
    expect(imageOf(importDocx(await buildDocx(moded)).content as never).attrs).toMatchObject({ colorMode: mode, crop: expect.anything() });
    expect(imageOf(importOdt(await buildOdt(moded)).content as never).attrs).toMatchObject({ colorMode: mode, crop: expect.anything() });
  });
});
