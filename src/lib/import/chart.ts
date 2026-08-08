// A DrawingML chart part (word/charts/chartN.xml) drawn as an SVG picture, so a chart
// occupies its frame with its own data instead of a placeholder. Read-only: the editor
// has no chart object, so what a re-export carries is this picture.

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

// Office's default accent cycle, the fallback when the file names no theme colours.
const DEFAULT_ACCENTS = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];

const AXIS_COLOR = '#a6a6a6';
const TEXT_COLOR = '#595959';
const GRID_COLOR = '#d9d9d9';

type Series = { name: string; color: string; values: (number | null)[] };
type Chart = {
  kind: 'bar' | 'hbar' | 'line' | 'pie' | 'area' | 'scatter';
  stacked: boolean;
  title: string;
  cats: string[];
  series: Series[];
  legend: boolean;
  grid: boolean;
  catTitle: string;
  valTitle: string;
  // The value axis' own bounds where the file fixes them, else the data decides.
  axMin: number | null;
  axMax: number | null;
};

const kids = (el: Element | null, ns: string, name: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === name) : [];
const kid = (el: Element | null, ns: string, name: string): Element | null => kids(el, ns, name)[0] ?? null;
const val = (el: Element | null, ns: string, name: string): string | null =>
  kid(el, ns, name)?.getAttribute('val') ?? null;

// Every <a:t> under the element, which is how a chart stores any piece of rich text.
function richText(el: Element | null): string {
  if (!el) return '';
  return Array.from(el.getElementsByTagNameNS(A, 't')).map((t) => t.textContent ?? '').join('').trim();
}

// A <c:cat>/<c:val>/<c:xVal> cache: the values the producer last computed, indexed by
// <c:pt idx>. Gaps stay null so a line breaks where the data does.
function cachePoints(holder: Element | null): { text: string[]; nums: (number | null)[] } {
  const text: string[] = [];
  const nums: (number | null)[] = [];
  if (!holder) return { text, nums };
  for (const cache of Array.from(holder.getElementsByTagName('*'))) {
    if (cache.namespaceURI !== C || !/Cache$/.test(cache.localName)) continue;
    const count = parseInt(val(cache, C, 'ptCount') ?? '0', 10);
    for (let i = 0; i < count; i++) { text[i] = ''; nums[i] = null; }
    for (const pt of kids(cache, C, 'pt')) {
      const idx = parseInt(pt.getAttribute('idx') ?? '', 10);
      const raw = kid(pt, C, 'v')?.textContent ?? '';
      if (!Number.isFinite(idx)) continue;
      text[idx] = raw;
      const n = parseFloat(raw);
      nums[idx] = Number.isFinite(n) ? n : null;
    }
    break;
  }
  return { text, nums };
}

// A series' fill: an explicit sRGB, else the theme accent the file names, else the
// cycle position — which is what Word itself falls back to.
function seriesColor(ser: Element, index: number, accents: string[]): string {
  const fill = kid(kid(ser, C, 'spPr'), A, 'solidFill');
  const srgb = kid(fill, A, 'srgbClr')?.getAttribute('val');
  if (srgb) return `#${srgb}`;
  const scheme = kid(fill, A, 'schemeClr')?.getAttribute('val') ?? '';
  const m = /^accent([1-6])$/.exec(scheme);
  if (m) return accents[+m[1] - 1] ?? DEFAULT_ACCENTS[+m[1] - 1];
  return accents[index % accents.length] ?? DEFAULT_ACCENTS[index % DEFAULT_ACCENTS.length];
}

const PLOTS: Record<string, Chart['kind']> = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line',
  pieChart: 'pie', pie3DChart: 'pie', doughnutChart: 'pie',
  areaChart: 'area', area3DChart: 'area', scatterChart: 'scatter',
};

function parseChart(doc: Document, accents: string[]): Chart | null {
  const space = doc.documentElement;
  if (!space || space.localName !== 'chartSpace') return null;
  const chart = kid(space, C, 'chart');
  const plotArea = kid(chart, C, 'plotArea');
  const plot = Array.from(plotArea?.children ?? []).find((c) => c.namespaceURI === C && PLOTS[c.localName]);
  if (!plot) return null;

  const series: Series[] = [];
  let cats: string[] = [];
  kids(plot, C, 'ser').forEach((ser, i) => {
    const { nums } = cachePoints(kid(ser, C, 'val') ?? kid(ser, C, 'yVal'));
    const cat = cachePoints(kid(ser, C, 'cat') ?? kid(ser, C, 'xVal'));
    if (cat.text.length > cats.length) cats = cat.text;
    series.push({ name: richText(kid(ser, C, 'tx')) || `Series ${i + 1}`, color: seriesColor(ser, i, accents), values: nums });
  });
  if (!series.length) return null;

  const axes = ['catAx', 'valAx', 'dateAx'].flatMap((n) => kids(plotArea, C, n));
  const axisTitle = (i: number) => richText(kid(axes[i] ?? null, C, 'title'));
  const bound = (name: string) => {
    for (const ax of kids(plotArea, C, 'valAx')) {
      const v = parseFloat(val(kid(ax, C, 'scaling'), C, name) ?? '');
      if (Number.isFinite(v)) return v;
    }
    return null;
  };
  return {
    kind: PLOTS[plot.localName] === 'bar' && val(plot, C, 'barDir') === 'bar' ? 'hbar' : PLOTS[plot.localName],
    stacked: (val(plot, C, 'grouping') ?? '').startsWith('stacked'),
    title: val(chart, C, 'autoTitleDeleted') === '1' ? '' : richText(kid(chart, C, 'title')),
    cats,
    series,
    legend: !!kid(chart, C, 'legend'),
    grid: axes.some((ax) => !!kid(ax, C, 'majorGridlines')),
    catTitle: axisTitle(0),
    valTitle: axisTitle(1),
    axMin: bound('min'),
    axMax: bound('max'),
  };
}

// ---- drawing ---------------------------------------------------------------

const esc = (s: string) => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));

const text = (x: number, y: number, s: string, size: number, anchor = 'middle', rotate = 0) =>
  `<text x="${r(x)}" y="${r(y)}" font-family="sans-serif" font-size="${r(size)}" fill="${TEXT_COLOR}"` +
  ` text-anchor="${anchor}"${rotate ? ` transform="rotate(${rotate} ${r(x)} ${r(y)})"` : ''}>${esc(s)}</text>`;

const r = (n: number) => Math.round(n * 100) / 100;

// A tick step of 1, 2 or 5 × a power of ten — the series a spreadsheet picks — and the
// axis bounds it rounds the data to. A zero baseline is kept whenever the data allows.
function scale(lo: number, hi: number, want: number, fixLo = false, fixHi = false):
  { min: number; max: number; step: number } {
  if (!fixLo && lo > 0) lo = 0;
  if (!fixHi && hi < 0) hi = 0;
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / Math.max(1, want);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  return {
    min: fixLo ? lo : Math.floor(lo / step) * step,
    max: fixHi ? hi : Math.ceil(hi / step) * step,
    step,
  };
}

// Ticks come out of repeated addition, so 0.1 steps would print 0.30000000000000004.
const tickLabel = (v: number, step: number) => {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
  return v.toFixed(decimals).replace(/\.?0+$/, (m) => (m.includes('.') ? '' : m));
};

function drawPie(c: Chart, w: number, h: number, top: number): string {
  const values = c.series[0].values.map((v) => Math.abs(v ?? 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = w / 2;
  const cy = top + (h - top) / 2;
  const rad = Math.max(8, Math.min(w, h - top) / 2 - 8);
  let angle = -Math.PI / 2;
  const at = (t: number) => `${r(cx + rad * Math.cos(t))} ${r(cy + rad * Math.sin(t))}`;
  return values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const end = angle + sweep;
    const path = sweep >= Math.PI * 2 - 1e-9
      ? `M ${r(cx)} ${r(cy - rad)} A ${r(rad)} ${r(rad)} 0 1 1 ${r(cx - 0.01)} ${r(cy - rad)} Z`
      : `M ${r(cx)} ${r(cy)} L ${at(angle)} A ${r(rad)} ${r(rad)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${at(end)} Z`;
    angle = end;
    const fill = DEFAULT_ACCENTS[i % DEFAULT_ACCENTS.length];
    return `<path d="${path}" fill="${c.series.length > 1 ? c.series[i % c.series.length].color : fill}"/>`;
  }).join('');
}

function chartSvg(c: Chart, width: number, height: number): string {
  const fs = Math.max(7, Math.min(11, height / 26));
  const titleFs = fs * 1.3;
  const top = c.title ? titleFs * 2 : 8;
  const legendH = c.legend && c.series.length > 1 ? fs * 2 : 0;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
    + ` viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>`
    + (c.title ? text(width / 2, titleFs * 1.2, c.title, titleFs) : '');
  const legend = () => {
    if (!legendH) return '';
    const y = height - fs * 0.6;
    const w = c.series.map((s) => s.name.length * fs * 0.55 + fs * 2.2);
    let x = (width - w.reduce((a, b) => a + b, 0)) / 2;
    return c.series.map((s, i) => {
      const box = `<rect x="${r(x)}" y="${r(y - fs * 0.9)}" width="${r(fs)}" height="${r(fs * 0.8)}" fill="${s.color}"/>`
        + text(x + fs * 1.3, y, s.name, fs, 'start');
      x += w[i];
      return box;
    }).join('');
  };

  if (c.kind === 'pie') return `${head}${drawPie(c, width, height - legendH, top)}${legend()}</svg>`;

  const nums = c.series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const sums = c.stacked
    ? c.cats.map((_, i) => c.series.reduce((a, s) => a + (s.values[i] ?? 0), 0))
    : nums;
  const want = Math.max(2, Math.round(height / 45));
  const { min, max, step } = scale(c.axMin ?? Math.min(...sums, 0), c.axMax ?? Math.max(...sums, 0), want, c.axMin != null, c.axMax != null);
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  const labelW = Math.max(...ticks.map((t) => tickLabel(t, step).length)) * fs * 0.6;

  const left = labelW + (c.valTitle ? fs * 1.6 : 0) + fs * 0.8;
  const right = fs * 0.8;
  const bottom = fs * 2 + (c.catTitle ? fs * 1.4 : 0) + legendH;
  const plot = { x: left, y: top, w: Math.max(10, width - left - right), h: Math.max(10, height - top - bottom) };
  const yOf = (v: number) => plot.y + plot.h - ((v - min) / (max - min)) * plot.h;

  const axes = ticks.map((t) =>
    (c.grid ? `<line x1="${r(plot.x)}" y1="${r(yOf(t))}" x2="${r(plot.x + plot.w)}" y2="${r(yOf(t))}" stroke="${GRID_COLOR}"/>` : '')
    + text(plot.x - fs * 0.4, yOf(t) + fs * 0.35, tickLabel(t, step), fs, 'end')).join('')
    + `<line x1="${r(plot.x)}" y1="${r(plot.y)}" x2="${r(plot.x)}" y2="${r(plot.y + plot.h)}" stroke="${AXIS_COLOR}"/>`
    + `<line x1="${r(plot.x)}" y1="${r(yOf(0))}" x2="${r(plot.x + plot.w)}" y2="${r(yOf(0))}" stroke="${AXIS_COLOR}"/>`;

  const n = Math.max(1, c.cats.length || Math.max(...c.series.map((s) => s.values.length)));
  const slot = plot.w / n;
  // No categories in the file means the spreadsheet's own 1..n, which is what it draws.
  const labels = c.cats.length ? c.cats : Array.from({ length: n }, (_, i) => String(i + 1));
  const every = Math.ceil((Math.max(...labels.map((l) => l.length)) * fs * 0.62) / Math.max(1, slot));
  const catLabels = labels.map((label, i) => (label && i % every === 0
    ? text(plot.x + slot * (i + 0.5), plot.y + plot.h + fs * 1.3, label, fs) : '')).join('');
  const titles = (c.catTitle ? text(plot.x + plot.w / 2, height - legendH - fs * 0.4, c.catTitle, fs) : '')
    + (c.valTitle ? text(fs * 1.1, plot.y + plot.h / 2, c.valTitle, fs, 'middle', -90) : '');

  let body = '';
  if (c.kind === 'bar' || c.kind === 'hbar') {
    const gap = slot * 0.2;
    const bw = (slot - gap) / (c.stacked ? 1 : c.series.length);
    const tops = new Array(n).fill(0);
    c.series.forEach((s, si) => {
      for (let i = 0; i < n; i++) {
        const v = s.values[i];
        if (v == null) continue;
        const base = c.stacked ? tops[i] : 0;
        const y0 = yOf(base + v), y1 = yOf(base);
        const x = plot.x + slot * i + gap / 2 + (c.stacked ? 0 : bw * si);
        body += `<rect x="${r(x)}" y="${r(Math.min(y0, y1))}" width="${r(bw)}" height="${r(Math.abs(y1 - y0))}" fill="${s.color}"/>`;
        tops[i] = base + v;
      }
    });
  } else {
    c.series.forEach((s) => {
      const pts = s.values.slice(0, n).map((v, i) => (v == null ? null : `${r(plot.x + slot * (i + 0.5))},${r(yOf(v))}`));
      const line = pts.filter(Boolean).join(' ');
      if (!line) return;
      if (c.kind === 'area') {
        body += `<polygon points="${r(plot.x + slot * 0.5)},${r(yOf(0))} ${line} ${r(plot.x + slot * (n - 0.5))},${r(yOf(0))}"`
          + ` fill="${s.color}" fill-opacity="0.7"/>`;
      }
      body += `<polyline points="${line}" fill="none" stroke="${s.color}" stroke-width="1.6"/>`;
      if (c.kind === 'scatter') {
        body += s.values.slice(0, n).map((v, i) => (v == null ? '' :
          `<circle cx="${r(plot.x + slot * (i + 0.5))}" cy="${r(yOf(v))}" r="2" fill="${s.color}"/>`)).join('');
      }
    });
  }
  return `${head}${axes}${body}${catLabels}${titles}${legend()}</svg>`;
}

// The chart part as an SVG data-URI of the frame's own size, or null when it holds no
// plot this can draw — the caller then keeps its placeholder.
export function chartDataUrl(xml: string, widthPx: number, heightPx: number, accents: string[]): string | null {
  const w = Math.max(80, Math.round(widthPx));
  const h = Math.max(60, Math.round(heightPx));
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch { return null; }
  if (doc.getElementsByTagName('parsererror').length) return null;
  const chart = parseChart(doc, accents.length ? accents : DEFAULT_ACCENTS);
  if (!chart) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(chartSvg(chart, w, h))}`;
}
