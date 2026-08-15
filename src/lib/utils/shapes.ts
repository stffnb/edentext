// The basic shapes a text box can take. Each non-rectangular one is a polygon given
// once in a 0…100 box: the editor draws it as an SVG path, the ODF export scales the
// same points into the 21600 viewBox <draw:enhanced-path> wants, and Word gets the
// preset's name and draws its own geometry.

export type ShapeKind =
  | 'textbox' | 'roundRect' | 'ellipse'
  | 'triangle' | 'rightTriangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star5'
  | 'trapezoid' | 'parallelogram'
  | 'rightArrow' | 'leftArrow' | 'upArrow' | 'downArrow'
  | 'line' | 'lineArrow' | 'lineDoubleArrow';

/** Which ends of a line carry an arrow head. */
export type LineHeads = 'none' | 'end' | 'both';

type Point = readonly [number, number];

export type ShapePreset = {
  /** ODF <draw:enhanced-geometry draw:type>. */
  odf: string;
  /** DrawingML <a:prstGeom prst>. */
  prst: string;
  /** The outline, 0…100 both ways; absent for the three CSS-drawn kinds. */
  points?: readonly Point[];
  /** Where text goes inside the outline: x0 y0 x1 y1, same 0…100 box. */
  textArea?: readonly [number, number, number, number];
  /**
   * Two endpoints rather than a box, so it holds no text and is stroked, not filled.
   * The value is which ends carry an arrow head.
   */
  line?: LineHeads;
};

// A regular n-gon's corners on the circle around the box, first one straight up.
function ring(n: number, r: number, turn = 0): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (-90 + turn + (360 / n) * i) * (Math.PI / 180);
    return [50 + r * Math.cos(a), 50 + r * Math.sin(a)] as Point;
  });
}

// Stretch a ring onto the whole box, per axis: an odd-cornered shape leaves gaps at
// its bounds, and the presets both word processors draw fill their frame.
function fit(pts: Point[]): Point[] {
  const span = (i: 0 | 1) => {
    const vs = pts.map((p) => p[i]);
    const lo = Math.min(...vs);
    return { lo, k: 100 / (Math.max(...vs) - lo) };
  };
  const x = span(0);
  const y = span(1);
  return pts.map(([px, py]) => [(px - x.lo) * x.k, (py - y.lo) * y.k] as Point);
}

// A star's corners alternate between the two circles; 0.382 is the ratio a regular
// pentagram gives, which is the one both word processors draw.
function star(n: number, outer: number, inner: number): Point[] {
  const o = ring(n, outer);
  const i = ring(n, inner, 360 / (2 * n));
  return fit(o.flatMap((p, k) => [p, i[k]]));
}

export const SHAPES: Record<ShapeKind, ShapePreset> = {
  textbox: { odf: 'rectangle', prst: 'rect' },
  roundRect: { odf: 'round-rectangle', prst: 'roundRect' },
  ellipse: { odf: 'ellipse', prst: 'ellipse' },
  triangle: {
    odf: 'isosceles-triangle', prst: 'triangle',
    points: [[50, 0], [100, 100], [0, 100]], textArea: [25, 50, 75, 100],
  },
  rightTriangle: {
    odf: 'right-triangle', prst: 'rtTriangle',
    points: [[0, 0], [100, 100], [0, 100]], textArea: [5, 50, 50, 95],
  },
  diamond: {
    odf: 'diamond', prst: 'diamond',
    points: [[50, 0], [100, 50], [50, 100], [0, 50]], textArea: [25, 25, 75, 75],
  },
  pentagon: {
    odf: 'pentagon', prst: 'pentagon',
    points: fit(ring(5, 50)), textArea: [20, 35, 80, 85],
  },
  hexagon: {
    odf: 'hexagon', prst: 'hexagon',
    points: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]], textArea: [15, 5, 85, 95],
  },
  star5: {
    odf: 'star5', prst: 'star5',
    points: star(5, 50, 19.1), textArea: [30, 35, 70, 70],
  },
  trapezoid: {
    odf: 'trapezoid', prst: 'trapezoid',
    points: [[25, 0], [75, 0], [100, 100], [0, 100]], textArea: [25, 5, 75, 95],
  },
  parallelogram: {
    odf: 'parallelogram', prst: 'parallelogram',
    points: [[25, 0], [100, 0], [75, 100], [0, 100]], textArea: [25, 5, 75, 95],
  },
  rightArrow: {
    odf: 'right-arrow', prst: 'rightArrow',
    points: [[0, 25], [50, 25], [50, 0], [100, 50], [50, 100], [50, 75], [0, 75]],
    textArea: [5, 30, 50, 70],
  },
  leftArrow: {
    odf: 'left-arrow', prst: 'leftArrow',
    points: [[100, 25], [50, 25], [50, 0], [0, 50], [50, 100], [50, 75], [100, 75]],
    textArea: [50, 30, 95, 70],
  },
  upArrow: {
    odf: 'up-arrow', prst: 'upArrow',
    points: [[25, 100], [25, 50], [0, 50], [50, 0], [100, 50], [75, 50], [75, 100]],
    textArea: [30, 50, 70, 95],
  },
  downArrow: {
    odf: 'down-arrow', prst: 'downArrow',
    points: [[25, 0], [25, 50], [0, 50], [50, 100], [100, 50], [75, 50], [75, 0]],
    textArea: [30, 5, 70, 50],
  },
  // ODF gives a line its own element (draw:line, two endpoints), where Word draws
  // the `line` preset across the frame and flips it to reach the other diagonal.
  line: { odf: 'line', prst: 'line', line: 'none' },
  lineArrow: { odf: 'line', prst: 'straightConnector1', line: 'end' },
  lineDoubleArrow: { odf: 'line', prst: 'straightConnector1', line: 'both' },
};

export function isLineKind(kind: ShapeKind): boolean {
  return !!SHAPES[kind].line;
}

/**
 * How long an arrow head is, in px, for a pen of `strokeWidthPt`. Word scales the head
 * with the line; the floor keeps a hairline's head visible, near the fixed 0.3 cm
 * LibreOffice's own dialog offers.
 */
export function arrowHeadPx(strokeWidthPt: number): number {
  return Math.max(8, strokeWidthPt * (96 / 72) * 5);
}

/** The same head as an ODF `draw:marker-*-width`, which is measured across it. */
export function arrowHeadCm(strokeWidthPt: number): number {
  return Math.round((arrowHeadPx(strokeWidthPt) * 0.7 * 2.54) / 96 * 1000) / 1000;
}

/** The line kinds, in the order the shape picker offers them. */
export const LINE_KINDS = (Object.keys(SHAPES) as ShapeKind[]).filter(isLineKind);

// A line's heads decide which kind it is, so a file's own arrow settings land on the
// right one whatever preset it used.
export function lineKindFor(start: boolean, end: boolean): ShapeKind {
  if (start && end) return 'lineDoubleArrow';
  return start || end ? 'lineArrow' : 'line';
}

/** The kinds drawn as a polygon — everything past the three CSS ones. */
export const POLYGON_KINDS = (Object.keys(SHAPES) as ShapeKind[]).filter((k) => SHAPES[k].points);

export function isShapeKind(v: unknown): v is ShapeKind {
  return typeof v === 'string' && v in SHAPES;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// An arrow head as a filled triangle: the tip at (x,y), pointing along the unit
// vector (dx,dy). 0.35 of the length to each side is the proportion both word
// processors draw a plain arrow at.
function headPath(x: number, y: number, dx: number, dy: number, len: number): string {
  const bx = x - dx * len;
  const by = y - dy * len;
  const px = -dy * len * 0.35;
  const py = dx * len * 0.35;
  return `M ${r2(x)},${r2(y)} L ${r2(bx + px)},${r2(by + py)} L ${r2(bx - px)},${r2(by - py)} Z`;
}

/**
 * A line kind drawn across a `w`×`h` box: the stroked segment and its filled heads,
 * in real pixels rather than the distorted 0…100 box a polygon uses — an arrow head
 * has to stay proportional to the pen however flat the frame is.
 */
export function linePaths(kind: ShapeKind, w: number, h: number, flip: boolean, headLen: number): { line: string; heads: string[] } | null {
  const heads = SHAPES[kind].line;
  if (!heads) return null;
  const [x1, y1, x2, y2] = flip ? [0, h, w, 0] : [0, 0, w, h];
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const dx = (x2 - x1) / len;
  const dy = (y2 - y1) / len;
  const cap = Math.min(headLen, len / 2);
  return {
    line: `M ${r2(x1)},${r2(y1)} L ${r2(x2)},${r2(y2)}`,
    heads: heads === 'none' ? []
      : heads === 'end' ? [headPath(x2, y2, dx, dy, cap)]
      : [headPath(x2, y2, dx, dy, cap), headPath(x1, y1, -dx, -dy, cap)],
  };
}

/** The outline as an SVG `d`, in the 0…100 box the node view's viewBox uses. */
export function shapePath(kind: ShapeKind, own?: string | null): string | null {
  if (own) return own;
  const pts = SHAPES[kind].points;
  if (!pts) return null;
  return `M ${pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' L ')} Z`;
}

// ODF's viewBox for a custom shape. The two rectangular kinds keep the geometry
// LibreOffice itself writes (round-rectangle pre-evaluated for modifier 3600); the
// polygons derive theirs from the same points the editor draws.
const VB = 21600;
const s = (n: number) => Math.round((n * VB) / 100);

const STATIC_GEOMETRY: Partial<Record<ShapeKind, string>> = {
  ellipse:
    ' draw:type="ellipse" draw:text-areas="3163 3163 18437 18437"' +
    ' draw:enhanced-path="U 10800 10800 10800 10800 0 360 Z N"',
  roundRect:
    ' draw:type="round-rectangle" draw:modifiers="3600"' +
    ' draw:enhanced-path="M 3600 0 X 0 3600 L 0 18000 Y 3600 21600 L 18000 21600' +
    ' X 21600 18000 L 21600 3600 Y 18000 0 Z N"',
};

/** The whole `<draw:enhanced-geometry/>` element for a shape, or null for a plain box. */
export function odfEnhancedGeometry(kind: ShapeKind): string | null {
  const preset = SHAPES[kind];
  const body = STATIC_GEOMETRY[kind] ?? (preset.points
    ? ` draw:type="${preset.odf}"` +
      (preset.textArea ? ` draw:text-areas="${preset.textArea.map(s).join(' ')}"` : '') +
      // One M, one L, then bare pairs — the form LibreOffice writes itself.
      ` draw:enhanced-path="M ${s(preset.points[0][0])} ${s(preset.points[0][1])} L ` +
      `${preset.points.slice(1).map(([x, y]) => `${s(x)} ${s(y)}`).join(' ')} Z N"`
    : null);
  return body === null ? null : `<draw:enhanced-geometry svg:viewBox="0 0 ${VB} ${VB}"${body}/>`;
}

// ---- freeform outlines -----------------------------------------------------
// A drawing this editor cannot author but must not drop: a polygon, a polyline, a
// bezier curve or a connector's elbow, kept as its own outline in the same 0…100 box
// a preset's points live in. An open path is stroked only, as both products draw one.

export type PathCmd =
  | { c: 'M' | 'L'; p: number[] }
  | { c: 'C'; p: number[] }
  | { c: 'Z' };

/** The `<letter> <numbers…>` groups of a path, whatever dialect wrote it. */
function pathTokens(d: string): { cmd: string; n: number[] }[] {
  const out: { cmd: string; n: number[] }[] = [];
  for (const m of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
    const n = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    out.push({ cmd: m[1], n });
  }
  return out;
}

const PATH_ARITY: Record<string, number> = { M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0 };

/**
 * SVG path data as absolute M/L/C/Z. A quadratic is raised to a cubic and a smooth
 * curve takes its own start as the first control point; an arc is joined by a line —
 * none of the three is what either product writes for a freeform.
 */
export function parseSvgPath(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const { cmd, n } of pathTokens(d)) {
    const rel = cmd === cmd.toLowerCase();
    const k = cmd.toUpperCase();
    const step = PATH_ARITY[k];
    if (step === undefined) continue;
    if (k === 'Z') { out.push({ c: 'Z' }); [x, y] = [sx, sy]; continue; }
    // A repeated group continues the command, and the one after an M is an L.
    for (let i = 0; i + step <= n.length; i += step) {
      const a = n.slice(i, i + step);
      const at = (dx: number, dy: number): [number, number] => rel ? [x + dx, y + dy] : [dx, dy];
      if (k === 'M' || k === 'L' || k === 'T') {
        const [px, py] = at(a[0], a[1]);
        out.push({ c: k === 'M' && i === 0 ? 'M' : 'L', p: [px, py] });
        if (k === 'M' && i === 0) [sx, sy] = [px, py];
        [x, y] = [px, py];
      } else if (k === 'H' || k === 'V') {
        const [px, py] = k === 'H' ? [rel ? x + a[0] : a[0], y] : [x, rel ? y + a[0] : a[0]];
        out.push({ c: 'L', p: [px, py] });
        [x, y] = [px, py];
      } else if (k === 'A') {
        const [px, py] = at(a[5], a[6]);
        out.push({ c: 'L', p: [px, py] });
        [x, y] = [px, py];
      } else {
        const pts: number[] = [];
        for (let j = 0; j + 1 < step; j += 2) pts.push(...at(a[j], a[j + 1]));
        const [ex, ey] = [pts[pts.length - 2], pts[pts.length - 1]];
        const p = k === 'C' ? pts
          : k === 'S' ? [x, y, ...pts]
          : [x + (2 / 3) * (pts[0] - x), y + (2 / 3) * (pts[1] - y),
             ex + (2 / 3) * (pts[0] - ex), ey + (2 / 3) * (pts[1] - ey), ex, ey];
        out.push({ c: 'C', p });
        [x, y] = [ex, ey];
      }
    }
  }
  return out;
}

/**
 * VML's path language, which is SVG's with the cases swapped: `m l c x` are the
 * absolute commands and `t r v` their relative twins, `e` ends the path.
 */
export function parseVmlPath(d: string): PathCmd[] {
  const svg = d.replace(/[a-z]/g, (c) => ({ m: 'M', l: 'L', c: 'C', x: 'Z', t: 'm', r: 'l', v: 'c', e: '', n: '', f: '', s: '' }[c] ?? ''));
  return parseSvgPath(svg);
}

/** `draw:points="0,0 4001,1000"` — ODF's polygon and polyline outline. */
export function parseOdfPoints(points: string, closed: boolean): PathCmd[] {
  const nums = (points.match(/-?[\d.]+/g) ?? []).map(Number);
  const out: PathCmd[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push({ c: i ? 'L' : 'M', p: [nums[i], nums[i + 1]] });
  if (closed && out.length) out.push({ c: 'Z' });
  return out;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The outline mapped from its own viewBox into the 0…100 box the editor draws in. */
export function fitPath(cmds: PathCmd[], vbW: number, vbH: number, vbX = 0, vbY = 0): string {
  if (!cmds.length || vbW <= 0 || vbH <= 0) return '';
  const parts = cmds.map((c) => {
    if (c.c === 'Z') return 'Z';
    const nums = c.p.map((v, i) => r3(((v - (i % 2 ? vbY : vbX)) * 100) / (i % 2 ? vbH : vbW)));
    return `${c.c} ${nums.join(' ')}`;
  });
  return parts.join(' ');
}

/** ODF's `draw:enhanced-path` for an outline the editor holds in its 0…100 box. */
export function odfEnhancedPath(path: string): string {
  const body = parseSvgPath(path).map((c) => (c.c === 'Z' ? 'Z'
    : `${c.c} ${c.p.map((v) => Math.round((v * VB) / 100)).join(' ')}`)).join(' ');
  return `${body} N`;
}

/** DrawingML's `<a:path>` for the same outline, in a `w`×`h` coordinate space. */
export function drawingMlPath(path: string, w: number, h: number): string {
  const pt = (x: number, y: number) => `<a:pt x="${Math.round((x * w) / 100)}" y="${Math.round((y * h) / 100)}"/>`;
  const body = parseSvgPath(path).map((c) => {
    if (c.c === 'Z') return '<a:close/>';
    const pts = [];
    for (let i = 0; i + 1 < c.p.length; i += 2) pts.push(pt(c.p[i], c.p[i + 1]));
    return c.c === 'M' ? `<a:moveTo>${pts[0]}</a:moveTo>`
      : c.c === 'L' ? `<a:lnTo>${pts[0]}</a:lnTo>`
      : `<a:cubicBezTo>${pts.join('')}</a:cubicBezTo>`;
  }).join('');
  return `<a:path w="${w}" h="${h}">${body}</a:path>`;
}

// The three line kinds share their names, and the heads a file declares are what
// tells them apart (lineKindFor), so only the bare one is reachable by name.
const NAMED = (Object.keys(SHAPES) as ShapeKind[]).filter((k) => SHAPES[k].line !== 'end' && SHAPES[k].line !== 'both');
const BY_ODF = new Map(NAMED.map((k) => [SHAPES[k].odf, k]));
const BY_PRST = new Map([...NAMED.map((k) => [SHAPES[k].prst, k] as const), ['straightConnector1', 'line' as ShapeKind]]);

// null = a preset we don't draw, which the importers report rather than flatten to a
// rectangle. LibreOffice writes `circle` for an ellipse constrained to one.
export function shapeFromOdfType(type: string | null | undefined): ShapeKind | null {
  if (!type) return 'textbox';
  if (type === 'circle') return 'ellipse';
  return BY_ODF.get(type) ?? null;
}

export function shapeFromPrst(prst: string | null | undefined): ShapeKind | null {
  if (!prst) return 'textbox';
  return BY_PRST.get(prst) ?? null;
}
