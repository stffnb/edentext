// A Windows metafile drawn as SVG (import/emf.ts): the records a plot consists of —
// a pen, a polyline, a label — and the signature check that rejects anything else.
import { describe, it, expect } from 'vitest';
import { emfToSvg } from '../../src/lib/import/emf';

function record(type: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, type, true);
  v.setUint32(4, out.length, true);
  out.set(body, 8);
  return out;
}

const body = (bytes: number, fill: (v: DataView) => void) => {
  const b = new Uint8Array(bytes);
  fill(new DataView(b.buffer));
  return b;
};

function header(): Uint8Array {
  return body(88, (v) => {
    v.setUint32(0, 1, true);
    v.setUint32(4, 88, true);
    [0, 0, 199, 99].forEach((n, i) => v.setInt32(8 + i * 4, n, true));   // rclBounds
    v.setUint32(40, 0x464d4520, true);
  });
}

function metafile(...records: Uint8Array[]): Uint8Array {
  const parts = [header(), ...records];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const createPen = (handle: number, color: number) => record(0x26, body(20, (v) => {
  v.setUint32(0, handle, true);
  v.setUint32(4, 0, true);          // PS_SOLID
  v.setInt32(8, 2, true);           // width
  v.setUint32(16, color, true);     // 0x00bbggrr
}));

const selectObject = (handle: number) => record(0x25, body(4, (v) => v.setUint32(0, handle, true)));

const polyline16 = (points: [number, number][]) => record(0x57, body(20 + points.length * 4, (v) => {
  v.setUint32(16, points.length, true);
  points.forEach(([x, y], i) => { v.setInt16(20 + i * 4, x, true); v.setInt16(22 + i * 4, y, true); });
}));

const extTextOutW = (x: number, y: number, text: string) => record(0x54, body(68 + text.length * 2, (v) => {
  v.setInt32(28, x, true);          // EmrText.Reference
  v.setInt32(32, y, true);
  v.setUint32(36, text.length, true);
  v.setUint32(40, 76, true);        // offString, from the record's own start
  [...text].forEach((c, i) => v.setUint16(68 + i * 2, c.charCodeAt(0), true));
}));

const svgOf = (bytes: Uint8Array) => {
  const svg = emfToSvg(bytes);
  expect(svg).toBeTruthy();
  expect(new DOMParser().parseFromString(svg!, 'image/svg+xml').getElementsByTagName('parsererror').length).toBe(0);
  return svg!;
};

describe('a metafile', () => {
  it('draws a polyline in its pen’s colour, sized by the header bounds', () => {
    const svg = svgOf(metafile(createPen(1, 0x0000ff), selectObject(1), polyline16([[0, 0], [50, 60]])));
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain('stroke="#ff0000"');   // COLORREF is 0x00bbggrr
    expect(svg).toContain('M 0 0 L 50 60');
  });

  it('writes out a label at its reference point', () => {
    const svg = svgOf(metafile(extTextOutW(10, 40, 'Coherence')));
    expect(svg).toContain('>Coherence<');
    expect(svg).toContain('x="10"');
  });

  it('declines bytes that are not a metafile', () => {
    expect(emfToSvg(new Uint8Array(200))).toBeNull();
    expect(emfToSvg(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
