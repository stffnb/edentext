// A Windows Enhanced Metafile drawn as SVG. Covers the record subset the plotting tools
// that feed Word actually emit — paths, text, embedded bitmaps; anything else is skipped.
// Loaded lazily (imageFormats.ts), so a document without a metafile never pays for it.

const EMF_SIGNATURE = 0x464d4520; // ' EMF'

type Xform = { m11: number; m12: number; m21: number; m22: number; dx: number; dy: number };
type Pen = { color: string; width: number; dash: string | null; none: boolean };
type Brush = { color: string; none: boolean };
type Font = { family: string; size: number; weight: number; italic: boolean; escapement: number };
type GdiObject = Pen | Brush | Font;

type State = {
  xf: Xform;
  winOrg: [number, number]; winExt: [number, number] | null;
  vpOrg: [number, number]; vpExt: [number, number] | null;
  pen: Pen; brush: Brush; font: Font;
  textColor: string; textAlign: number; fillRule: 'evenodd' | 'nonzero';
};

const IDENTITY: Xform = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 };
const NO_PEN: Pen = { color: '#000000', width: 1, dash: null, none: true };
const BLACK_PEN: Pen = { color: '#000000', width: 1, dash: null, none: false };
const NO_BRUSH: Brush = { color: '#000000', none: true };
const DEFAULT_FONT: Font = { family: 'sans-serif', size: 12, weight: 400, italic: false, escapement: 0 };

const colorRef = (v: number) =>
  '#' + [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff].map((c) => c.toString(16).padStart(2, '0')).join('');

// A metafile stores text as raw code units, so a symbol font leaves lone surrogates
// behind — they are dropped here, or the SVG cannot be encoded at all.
const esc = (s: string) => s
  .replace(/[\0-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]/g, '')
  .replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const n = (v: number) => (Math.round(v * 100) / 100).toString();

// PS_DASH..PS_DASHDOTDOT as a stroke-dasharray, scaled by the pen's own width.
function penDash(style: number, w: number): string | null {
  const unit = Math.max(1, w);
  switch (style & 0xf) {
    case 1: return `${unit * 6} ${unit * 3}`;
    case 2: return `${unit} ${unit * 2}`;
    case 3: return `${unit * 6} ${unit * 2} ${unit} ${unit * 2}`;
    case 4: return `${unit * 6} ${unit * 2} ${unit} ${unit * 2} ${unit} ${unit * 2}`;
    default: return null;
  }
}

// The stock objects a record may select instead of one it created (handle bit 31 set).
function stockObject(id: number): GdiObject | null {
  const grey = (v: number) => ({ color: colorRef(v * 0x010101), none: false });
  switch (id & 0x7fffffff) {
    case 0: return grey(0xff);
    case 1: return grey(0xc0);
    case 2: return grey(0x80);
    case 3: return grey(0x40);
    case 4: return grey(0x00);
    case 5: return NO_BRUSH;
    case 6: return { ...BLACK_PEN, color: '#ffffff' };
    case 7: return BLACK_PEN;
    case 8: return NO_PEN;
    default: return null;
  }
}

export function emfToSvg(bytes: Uint8Array): string | null {
  if (bytes.length < 88) return null;
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (d.getUint32(0, true) !== 1 || d.getUint32(40, true) !== EMF_SIGNATURE) return null;
  const [bl, bt, br, bb] = [0, 1, 2, 3].map((i) => d.getInt32(8 + i * 4, true));
  const vw = Math.max(1, br - bl + 1);
  const vh = Math.max(1, bb - bt + 1);
  if (vw > 20000 || vh > 20000) return null;

  const out: string[] = [];
  const objects = new Map<number, GdiObject>();
  const stack: State[] = [];
  let st: State = {
    xf: { ...IDENTITY }, winOrg: [0, 0], winExt: null, vpOrg: [0, 0], vpExt: null,
    pen: BLACK_PEN, brush: { color: '#ffffff', none: false }, font: DEFAULT_FONT,
    textColor: '#000000', textAlign: 0, fillRule: 'evenodd',
  };
  let cur: [number, number] = [0, 0];
  let pathD = '';
  let inPath = false;

  const scaleX = () => (st.winExt && st.vpExt && st.winExt[0] ? st.vpExt[0] / st.winExt[0] : 1);
  const scaleY = () => (st.winExt && st.vpExt && st.winExt[1] ? st.vpExt[1] / st.winExt[1] : 1);
  const map = (x: number, y: number): [number, number] => {
    const t = st.xf;
    const wx = t.m11 * x + t.m21 * y + t.dx;
    const wy = t.m12 * x + t.m22 * y + t.dy;
    return [(wx - st.winOrg[0]) * scaleX() + st.vpOrg[0], (wy - st.winOrg[1]) * scaleY() + st.vpOrg[1]];
  };
  // One number for pen widths and font sizes: the area scale of the whole mapping.
  const unitScale = () => {
    const t = st.xf;
    return Math.sqrt(Math.abs((t.m11 * t.m22 - t.m12 * t.m21) * scaleX() * scaleY())) || 1;
  };

  const strokeAttrs = () => {
    const w = Math.max(0.4, st.pen.width * unitScale());
    return ` fill="none" stroke="${st.pen.color}" stroke-width="${n(w)}"`
      + (st.pen.dash ? ` stroke-dasharray="${st.pen.dash}"` : '');
  };
  const emitPath = (dStr: string, stroke: boolean, fill: boolean) => {
    if (!dStr) return;
    const parts: string[] = [];
    parts.push(fill && !st.brush.none ? ` fill="${st.brush.color}" fill-rule="${st.fillRule}"` : ' fill="none"');
    if (stroke && !st.pen.none) {
      parts.push(` stroke="${st.pen.color}" stroke-width="${n(Math.max(0.4, st.pen.width * unitScale()))}"`);
      if (st.pen.dash) parts.push(` stroke-dasharray="${st.pen.dash}"`);
    }
    out.push(`<path d="${dStr}"${parts.join('')}/>`);
  };
  const draw = (dStr: string, stroke: boolean, fill: boolean) => {
    if (inPath) pathD += (pathD ? ' ' : '') + dStr;
    else emitPath(dStr, stroke, fill);
  };

  const pts = (off: number, count: number, short: boolean): [number, number][] => {
    const list: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const p = off + i * (short ? 4 : 8);
      list.push(map(
        short ? d.getInt16(p, true) : d.getInt32(p, true),
        short ? d.getInt16(p + 2, true) : d.getInt32(p + 4, true),
      ));
    }
    return list;
  };
  const poly = (list: [number, number][], close: boolean, from: boolean) => {
    if (!list.length) return;
    const head = from ? `M ${n(cur[0])} ${n(cur[1])} L` : `M ${n(list[0][0])} ${n(list[0][1])} L`;
    const rest = (from ? list : list.slice(1)).map(([x, y]) => `${n(x)} ${n(y)}`).join(' ');
    cur = list[list.length - 1];
    draw(`${head} ${rest}${close ? ' Z' : ''}`, true, close);
  };
  const bezier = (list: [number, number][], from: boolean) => {
    const start = from ? cur : list[0];
    const tail = from ? list : list.slice(1);
    if (tail.length < 3) return;
    let s = `M ${n(start[0])} ${n(start[1])}`;
    for (let i = 0; i + 2 < tail.length; i += 3)
      s += ` C ${tail.slice(i, i + 3).map(([x, y]) => `${n(x)} ${n(y)}`).join(' ')}`;
    cur = tail[tail.length - 1];
    draw(s, true, false);
  };

  let off = 0;
  for (let guard = 0; off + 8 <= bytes.length && guard < 200000; guard++) {
    const type = d.getUint32(off, true);
    const size = d.getUint32(off + 4, true);
    if (size < 8 || off + size > bytes.length) break;
    const b = off + 8;
    switch (type) {
      case 0x0e: off = bytes.length; continue;                                  // EOF
      case 0x09: st.winExt = [d.getInt32(b, true), d.getInt32(b + 4, true)]; break;
      case 0x0a: st.winOrg = [d.getInt32(b, true), d.getInt32(b + 4, true)]; break;
      case 0x0b: st.vpExt = [d.getInt32(b, true), d.getInt32(b + 4, true)]; break;
      case 0x0c: st.vpOrg = [d.getInt32(b, true), d.getInt32(b + 4, true)]; break;
      case 0x13: st.fillRule = d.getUint32(b, true) === 2 ? 'nonzero' : 'evenodd'; break;
      case 0x16: st.textAlign = d.getUint32(b, true); break;
      case 0x18: st.textColor = colorRef(d.getUint32(b, true)); break;
      case 0x21: stack.push({ ...st, xf: { ...st.xf } }); break;                 // SAVEDC
      case 0x22: { const s = stack.pop(); if (s) st = s; break; }                // RESTOREDC
      case 0x23: case 0x24: {                                                    // SET/MODIFYWORLDTRANSFORM
        const m: Xform = {
          m11: d.getFloat32(b, true), m12: d.getFloat32(b + 4, true),
          m21: d.getFloat32(b + 8, true), m22: d.getFloat32(b + 12, true),
          dx: d.getFloat32(b + 16, true), dy: d.getFloat32(b + 20, true),
        };
        const mode = type === 0x23 ? 4 : d.getUint32(b + 24, true);
        if (mode === 1) st.xf = { ...IDENTITY };
        else if (mode === 4) st.xf = m;
        else st.xf = mode === 2 ? compose(m, st.xf) : compose(st.xf, m);
        break;
      }
      case 0x25: {                                                               // SELECTOBJECT
        const h = d.getUint32(b, true);
        const o = h & 0x80000000 ? stockObject(h) : objects.get(h) ?? null;
        if (o) applyObject(o);
        break;
      }
      case 0x26: {                                                               // CREATEPEN
        const style = d.getUint32(b + 4, true);
        const w = d.getInt32(b + 8, true);
        objects.set(d.getUint32(b, true), {
          color: colorRef(d.getUint32(b + 16, true)), width: w || 1,
          dash: penDash(style, w || 1), none: (style & 0xf) === 5,
        });
        break;
      }
      case 0x5f: {                                                               // EXTCREATEPEN
        const style = d.getUint32(b + 20, true);
        const w = d.getInt32(b + 24, true);
        objects.set(d.getUint32(b, true), {
          color: colorRef(d.getUint32(b + 32, true)), width: w || 1,
          dash: penDash(style, w || 1), none: (style & 0xf) === 5 || d.getUint32(b + 28, true) === 1,
        });
        break;
      }
      case 0x27: {                                                               // CREATEBRUSHINDIRECT
        const style = d.getUint32(b + 4, true);
        objects.set(d.getUint32(b, true), { color: colorRef(d.getUint32(b + 8, true)), none: style === 1 });
        break;
      }
      case 0x52: objects.set(d.getUint32(b, true), readFont(d, bytes, b + 4, unitScale())); break;
      case 0x28: objects.delete(d.getUint32(b, true)); break;                     // DELETEOBJECT
      case 0x1b: cur = map(d.getInt32(b, true), d.getInt32(b + 4, true)); break;  // MOVETOEX
      case 0x36: {                                                               // LINETO
        const p = map(d.getInt32(b, true), d.getInt32(b + 4, true));
        draw(`M ${n(cur[0])} ${n(cur[1])} L ${n(p[0])} ${n(p[1])}`, true, false);
        cur = p;
        break;
      }
      case 0x3b: inPath = true; pathD = ''; break;                               // BEGINPATH
      case 0x3c: inPath = false; break;                                          // ENDPATH
      case 0x3d: pathD += ' Z'; break;                                           // CLOSEFIGURE
      case 0x3e: emitPath(pathD, false, true); pathD = ''; break;                // FILLPATH
      case 0x3f: emitPath(pathD, true, true); pathD = ''; break;                 // STROKEANDFILLPATH
      case 0x40: emitPath(pathD, true, false); pathD = ''; break;                // STROKEPATH
      case 0x2a: case 0x2b: {                                                    // ELLIPSE / RECTANGLE
        const [x0, y0] = map(d.getInt32(b, true), d.getInt32(b + 4, true));
        const [x1, y1] = map(d.getInt32(b + 8, true), d.getInt32(b + 12, true));
        const box = ` x="${n(Math.min(x0, x1))}" y="${n(Math.min(y0, y1))}"`
          + ` width="${n(Math.abs(x1 - x0))}" height="${n(Math.abs(y1 - y0))}"`;
        const paint = (st.brush.none ? ' fill="none"' : ` fill="${st.brush.color}"`)
          + (st.pen.none ? '' : ` stroke="${st.pen.color}" stroke-width="${n(Math.max(0.4, st.pen.width * unitScale()))}"`);
        if (type === 0x2b) out.push(`<rect${box}${paint}/>`);
        else out.push(`<ellipse cx="${n((x0 + x1) / 2)}" cy="${n((y0 + y1) / 2)}"`
          + ` rx="${n(Math.abs(x1 - x0) / 2)}" ry="${n(Math.abs(y1 - y0) / 2)}"${paint}/>`);
        break;
      }
      case 0x02: case 0x55: bezier(pts(b + 20, d.getUint32(b + 16, true), type === 0x55), false); break;
      case 0x05: case 0x58: bezier(pts(b + 20, d.getUint32(b + 16, true), type === 0x58), true); break;
      case 0x03: case 0x56: poly(pts(b + 20, d.getUint32(b + 16, true), type === 0x56), true, false); break;
      case 0x04: case 0x57: poly(pts(b + 20, d.getUint32(b + 16, true), type === 0x57), false, false); break;
      case 0x06: case 0x59: poly(pts(b + 20, d.getUint32(b + 16, true), type === 0x59), false, true); break;
      case 0x07: case 0x08: case 0x5a: case 0x5b: {                              // POLYPOLYLINE/POLYGON
        const short = type >= 0x5a;
        const closed = type === 0x08 || type === 0x5b;
        const nPoly = d.getUint32(b + 16, true);
        let p = b + 24 + nPoly * 4;
        let dStr = '';
        for (let i = 0; i < nPoly; i++) {
          const count = d.getUint32(b + 24 + i * 4, true);
          const list = pts(p, count, short);
          p += count * (short ? 4 : 8);
          if (!list.length) continue;
          dStr += `${dStr ? ' ' : ''}M ${n(list[0][0])} ${n(list[0][1])} L `
            + list.slice(1).map(([x, y]) => `${n(x)} ${n(y)}`).join(' ') + (closed ? ' Z' : '');
        }
        draw(dStr, true, closed);
        break;
      }
      case 0x53: case 0x54: emitText(type === 0x54); break;                      // EXTTEXTOUT A/W
      case 0x51: {                                                               // STRETCHDIBITS
        const img = dibImage(bytes, off, {
          bmi: d.getUint32(b + 40, true), cbBmi: d.getUint32(b + 44, true),
          bits: d.getUint32(b + 48, true), cbBits: d.getUint32(b + 52, true),
        });
        if (img) {
          const [x0, y0] = map(d.getInt32(b + 16, true), d.getInt32(b + 20, true));
          const [x1, y1] = map(
            d.getInt32(b + 16, true) + d.getInt32(b + 64, true),
            d.getInt32(b + 20, true) + d.getInt32(b + 68, true));
          out.push(`<image x="${n(Math.min(x0, x1))}" y="${n(Math.min(y0, y1))}"`
            + ` width="${n(Math.abs(x1 - x0))}" height="${n(Math.abs(y1 - y0))}"`
            + ` preserveAspectRatio="none" href="${img}"/>`);
        }
        break;
      }
      default: break;
    }
    off += size;

    function applyObject(o: GdiObject) {
      if ('family' in o) st.font = o;
      else if ('width' in o) st.pen = o;
      else st.brush = o;
    }

    // EMR_EXTTEXTOUT: the reference point, the string, and (when present) the per-character
    // advances — their sum is the run's own width, which keeps labels from drifting.
    function emitText(wide: boolean) {
      const t = b + 28;                       // past Bounds, iGraphicsMode and the two scales
      const [rx, ry] = map(d.getInt32(t, true), d.getInt32(t + 4, true));
      const chars = d.getUint32(t + 8, true);
      const offString = d.getUint32(t + 12, true);
      const offDx = d.getUint32(t + 36, true);
      if (!chars || chars > 8192) return;
      let text = '';
      for (let i = 0; i < chars; i++) {
        const c = wide ? d.getUint16(off + offString + i * 2, true) : bytes[off + offString + i];
        if (c) text += String.fromCharCode(c);
      }
      if (!text.trim()) return;
      const f = st.font;
      const anchor = (st.textAlign & 6) === 2 ? 'end' : (st.textAlign & 6) === 6 ? 'middle' : 'start';
      const dy = (st.textAlign & 24) === 24 ? 0 : (st.textAlign & 8) === 8 ? -f.size * 0.2 : f.size * 0.8;
      const stride = d.getUint32(t + 16, true) & 0x2000 ? 8 : 4;   // ETO_PDY pairs the advances
      let width = 0;
      if (offDx && off + offDx + chars * stride <= bytes.length)
        for (let i = 0; i < chars; i++) width += d.getInt32(off + offDx + i * stride, true);
      const len = width > 0 ? ` textLength="${n(width * unitScale())}" lengthAdjust="spacingAndGlyphs"` : '';
      const rot = f.escapement ? ` transform="rotate(${n(-f.escapement / 10)} ${n(rx)} ${n(ry + dy)})"` : '';
      out.push(`<text x="${n(rx)}" y="${n(ry + dy)}" font-family="${esc(f.family)}" font-size="${n(f.size)}"`
        + (f.weight >= 600 ? ' font-weight="bold"' : '') + (f.italic ? ' font-style="italic"' : '')
        + ` fill="${st.textColor}" text-anchor="${anchor}"${len}${rot}>${esc(text)}</text>`);
    }
  }

  if (!out.length) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${vh}" viewBox="${bl} ${bt} ${vw} ${vh}">`
    + out.join('') + '</svg>';
}

function compose(a: Xform, b: Xform): Xform {
  return {
    m11: a.m11 * b.m11 + a.m12 * b.m21, m12: a.m11 * b.m12 + a.m12 * b.m22,
    m21: a.m21 * b.m11 + a.m22 * b.m21, m22: a.m21 * b.m12 + a.m22 * b.m22,
    dx: a.dx * b.m11 + a.dy * b.m21 + b.dx, dy: a.dx * b.m12 + a.dy * b.m22 + b.dy,
  };
}

// EMR_EXTCREATEFONTINDIRECTW's LogFont: a negative height is the character height, a
// positive one the cell height; the face name is 32 UTF-16 code units.
function readFont(d: DataView, bytes: Uint8Array, at: number, scale: number): Font {
  let family = '';
  for (let i = 0; i < 32; i++) {
    const c = d.getUint16(at + 28 + i * 2, true);
    if (!c) break;
    family += String.fromCharCode(c);
  }
  const height = Math.abs(d.getInt32(at, true)) || 12;
  return {
    family: family || 'sans-serif',
    size: Math.max(1, height * scale),
    weight: d.getInt32(at + 16, true) || 400,
    italic: bytes[at + 20] !== 0,
    escapement: d.getInt32(at + 8, true),
  };
}

// A device-independent bitmap inside a record, re-wrapped as a .bmp data-URI.
function dibImage(bytes: Uint8Array, recAt: number, o: { bmi: number; cbBmi: number; bits: number; cbBits: number }): string | null {
  if (!o.cbBmi || !o.cbBits) return null;
  const end = recAt + o.bits + o.cbBits;
  if (end > bytes.length) return null;
  const file = new Uint8Array(14 + o.cbBmi + o.cbBits);
  const v = new DataView(file.buffer);
  file[0] = 0x42; file[1] = 0x4d;
  v.setUint32(2, file.length, true);
  v.setUint32(10, 14 + o.cbBmi, true);
  file.set(bytes.subarray(recAt + o.bmi, recAt + o.bmi + o.cbBmi), 14);
  file.set(bytes.subarray(recAt + o.bits, end), 14 + o.cbBmi);
  let bin = '';
  for (let i = 0; i < file.length; i += 0x8000) bin += String.fromCharCode(...file.subarray(i, i + 0x8000));
  return `data:image/bmp;base64,${btoa(bin)}`;
}
