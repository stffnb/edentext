import { describe, it, expect } from 'vitest';
import { stripCmykIccProfile } from '../../src/lib/import/imageFormats';

// SOF0 with `components` colour channels, an ICC APP2 of `iccBytes`, then a scan.
function jpeg(components: number, iccBytes: number): Uint8Array {
  const seg = (marker: number, payload: number[]) =>
    [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
  const icc = [...[...'ICC_PROFILE'].map(c => c.charCodeAt(0)), 0, 1, 1, ...new Array(iccBytes).fill(0x42)];
  const sof = [8, 0, 16, 0, 16, components, ...new Array(components * 3).fill(1)];
  return new Uint8Array([
    0xff, 0xd8,
    ...seg(0xe2, icc),
    ...seg(0xc0, sof),
    ...seg(0xda, [components, 0, 0]),
    0xff, 0xd9,
  ]);
}

describe('stripCmykIccProfile', () => {
  it('drops the profile of a CMYK JPEG', () => {
    const src = jpeg(4, 1000);
    const out = stripCmykIccProfile(src);
    expect(out.length).toBe(src.length - (1000 + 14 + 4)); // payload + ICC header + marker
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
    expect(out[3]).toBe(0xc0); // the SOF now follows the start marker directly
    expect(Array.from(out).includes(0x42)).toBe(false);
  });

  it('leaves an RGB JPEG, a profile-less CMYK one and a PNG alone', () => {
    const rgb = jpeg(3, 1000);
    expect(stripCmykIccProfile(rgb)).toBe(rgb);
    const bare = jpeg(4, 0).slice(0, 2);
    expect(stripCmykIccProfile(bare)).toBe(bare);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect(stripCmykIccProfile(png)).toBe(png);
  });
});
