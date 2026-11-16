// The HTML a model writes anyway — semantic tags and plain CSS — turned into the data-*
// form the schema parses, so one reply can carry a whole document: paragraph spacing,
// table widths, text boxes, picture placeholders, fields. A pure DOM pass on the inert
// document; what it does not know it leaves to the schema, which drops it as before.

import { normalizeColor } from '../utils/color';
import { BOX_WRAP_GAP, PICTURE_WRAP_GAP, wrapGap, wrapGapText, type WrapGap } from '../editor/extensions/image';
import { isShapeKind } from '../utils/shapes';
import { CELL_PAD_VARS } from '../editor/extensions/tableCellPadding';
import { formatTabStops, type TabAlign } from '../editor/extensions/tabStops';

export type DialectOptions = {
  /** A paragraph style by internal or display name, case-insensitive. */
  style?: (name: string) => string | null;
  tableStyle?: (name: string) => string | null;
  /** A fresh note id, for `<sup class="footnote">`. */
  noteId?: () => string;
};

/** A note's text, written into the note its anchor gets once the slice is in. */
export type NoteText = { id: string; html: string };

const PT_PER: Record<string, number> = { pt: 1, px: 0.75, cm: 72 / 2.54, mm: 72 / 25.4, in: 72, em: 12, rem: 12, pc: 12 };
const PX_PER_CM = 96 / 2.54;
// The text width of A4 at 2cm margins, which a percentage of a frame refers to.
const TEXT_WIDTH_CM = 17;

/** A CSS length in points; a bare number counts as `bare` units. */
export function toPt(v: string | null | undefined, bare = 'px'): number | null {
  const m = /^\s*(-?[\d.]+)\s*([a-z%]*)\s*$/i.exec(v ?? '');
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || bare).toLowerCase();
  if (unit === '%') return null;
  return Number.isFinite(n) && PT_PER[unit] ? n * PT_PER[unit] : null;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const toCm = (v: string | null | undefined, bare = 'px') => { const pt = toPt(v, bare); return pt == null ? null : round(pt / PT_PER.cm); };
const toPx = (v: string | null | undefined, bare = 'px') => { const pt = toPt(v, bare); return pt == null ? null : Math.round(pt / PT_PER.px); };

/** `1px solid red` as the border attr (`0.75pt solid #FF0000`), or 'none'. */
export function borderAttr(css: string): string | null {
  const parts = css.trim().split(/\s+(?![^(]*\))/);
  if (!parts[0] || parts.some((p) => /^(none|hidden)$/i.test(p)) || parts.some((p) => toPt(p) === 0)) return 'none';
  let pt = 0.5;
  let color = '#000000';
  let line = 'solid';
  for (const p of parts) {
    const w = toPt(p, 'none');
    if (w != null) pt = Math.max(0.25, round(w));
    else if (/^(solid|double|dotted|dashed)$/i.test(p)) line = p.toLowerCase();
    else { const c = normalizeColor(p); if (c?.startsWith('#')) color = c; }
  }
  return `${pt}pt ${line} ${color}`;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Writes `prefix-top` … from `border` and `border-<side>`. */
function borders(el: HTMLElement, prefix: string): void {
  const all = el.style.getPropertyValue('border');
  for (const side of SIDES) {
    const v = el.style.getPropertyValue(`border-${side}`) || all;
    const attr = v && borderAttr(v);
    if (attr) el.setAttribute(`${prefix}-${side}`, attr);
  }
}

/** A tab stop's fill as CSS names it, both ways. */
export const TAB_LEADERS: Record<string, string> = { dotted: '.', dashed: '-', solid: '_', '.': 'dotted', '·': 'dotted', '-': 'dashed', '_': 'solid' };

/** `tab-stops: 8cm center, 16cm right dotted` as the tabStops attr. */
function tabStopsAttr(v: string): string | null {
  return formatTabStops(v.split(',').flatMap((part) => {
    const words = part.trim().toLowerCase().split(/\s+/);
    const pos = toCm(words[0], 'cm');
    const align = words.find((w) => /^(left|center|right|decimal)$/.test(w)) as TabAlign | undefined;
    return pos == null ? [] : [{ pos, align: align ?? 'left', leader: words.map((w) => TAB_LEADERS[w]).find((l) => l?.length === 1) ?? null }];
  }));
}

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function paragraph(el: HTMLElement, o: DialectOptions, dropped: string[]): void {
  const s = el.style;
  const cls = el.getAttribute('class');
  if (cls && o.style) {
    const name = o.style(cls.trim());
    if (name) el.setAttribute('data-style', name);
    else dropped.push(`unknown paragraph style "${cls}"`);
  }
  const set = (attr: string, v: number | string | null | undefined) => { if (v != null && v !== '') el.setAttribute(attr, String(v)); };
  const pt = (v: string) => { const n = toPt(v); return n == null ? null : round(n, 1); };
  set('data-space-before', s.marginTop ? pt(s.marginTop) : null);
  set('data-space-after', s.marginBottom ? pt(s.marginBottom) : null);
  set('data-indent', s.marginLeft ? toCm(s.marginLeft) : null);
  set('data-indent-right', s.marginRight ? toCm(s.marginRight) : null);
  set('data-indent-first', s.textIndent ? toCm(s.textIndent) : null);
  const lh = s.lineHeight;
  if (lh) {
    const factor = /^[\d.]+$/.test(lh) ? parseFloat(lh) : /%$/.test(lh) ? parseFloat(lh) / 100 : null;
    const fixed = factor == null ? toPt(lh) : null;
    set('data-line-height', factor != null ? round(factor) : fixed != null ? `${round(fixed, 1)}pt` : null);
  }
  const bg = normalizeColor(s.backgroundColor || s.background);
  if (bg?.startsWith('#')) el.setAttribute('data-bg', bg);
  borders(el, 'data-pborder');
  if (s.fontSize) { const n = toPt(s.fontSize); if (n) el.setAttribute('data-block-font-size', `${round(n, 1)}pt`); }
  if (s.fontFamily) el.setAttribute('data-block-font-family', s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
  if (s.color) {
    // A block has no colour of its own; its runs take it.
    const span = el.ownerDocument.createElement('span');
    span.style.color = s.color;
    span.append(...el.childNodes);
    el.append(span);
  }
  if (/always|page/.test(s.pageBreakBefore + s.breakBefore)) el.setAttribute('data-page-break-before', 'page');
  // A property the browser does not know (tab-stops; widows in Firefox) is not in
  // el.style, so it is read from the attribute as written.
  const css = (p: string) => s.getPropertyValue(p).trim()
    || new RegExp(`(?:^|;)\\s*${p}\\s*:([^;]*)`, 'i').exec(el.getAttribute('style') ?? '')?.[1].trim() || '';
  if (/avoid/.test(css('break-after') + css('page-break-after'))) el.setAttribute('data-keep-next', 'true');
  if (/avoid/.test(css('break-inside') + css('page-break-inside'))) el.setAttribute('data-keep-lines', 'true');
  if (/^[01]$/.test(css('widows') || css('orphans'))) el.setAttribute('data-widow-control', 'false');
  if (/none|manual/.test(css('hyphens'))) el.setAttribute('data-no-hyphenation', 'true');
  if (/^(rtl|ltr)$/.test(s.direction)) el.setAttribute('dir', s.direction);
  // A named page (CSS Paged Media) opens a section, with its own header and footer.
  if (!/^(auto)?$/.test(css('page'))) el.setAttribute('data-section-break', 'true');
  const stops = tabStopsAttr(css('tab-stops'));
  if (stops) el.setAttribute('data-tab-stops', stops);
}

/** A run's background as a highlight, the only run shading the editor has. */
// Outline, shadow and relief in the CSS a model writes for them; relief has none, so it
// is read from the ODF property name as written.
function runEffects(el: HTMLElement): void {
  const raw = el.getAttribute('style') ?? '';
  const stroke = el.style.getPropertyValue('-webkit-text-stroke') || el.style.getPropertyValue('-webkit-text-stroke-width');
  if (parseFloat(stroke) > 0 || /(?:^|;)\s*text-stroke\s*:/i.test(raw)) el.setAttribute('data-outline', 'true');
  const shadow = el.style.textShadow;
  if (shadow && shadow !== 'none') el.setAttribute('data-shadow', 'true');
  const relief = /(?:^|;)\s*font-relief\s*:\s*(embossed|engraved)/i.exec(raw)?.[1].toLowerCase();
  if (relief) el.setAttribute('data-relief', relief);
}

function runShading(el: HTMLElement): void {
  const bg = normalizeColor(el.style.backgroundColor || el.style.background);
  if (!bg?.startsWith('#')) return;
  const mark = el.ownerDocument.createElement('mark');
  mark.setAttribute('data-color', bg);
  mark.style.backgroundColor = bg;
  mark.append(...el.childNodes);
  el.append(mark);
}

/** Column weights from `<col width>` and the cells' own `width`, as percentages. */
function columnWeights(table: HTMLTableElement): (number | null)[] {
  const fromLength = (v: string | null) => {
    if (!v) return null;
    if (/%\s*$/.test(v)) return parseFloat(v) || null;
    const cm = toCm(v);
    return cm ? (100 * cm) / TEXT_WIDTH_CM : null;
  };
  const weights: (number | null)[] = [];
  const cols = [...table.querySelectorAll(':scope > colgroup > col, :scope > col')] as HTMLElement[];
  cols.forEach((c, i) => { weights[i] = fromLength(c.getAttribute('width') || c.style.width); });
  for (const row of table.rows) {
    let col = 0;
    for (const cell of row.cells) {
      const w = fromLength(cell.getAttribute('width') || cell.style.width);
      if (w != null && cell.colSpan === 1) weights[col] ??= w;
      col += cell.colSpan;
      weights.length = Math.max(weights.length, col);
    }
  }
  return weights;
}

function table(t: HTMLTableElement, o: DialectOptions, dropped: string[]): void {
  // A row without cells (a reply still streaming, or a careless one) would parse into a
  // node the schema does not allow.
  for (const row of [...t.rows]) if (!row.cells.length) row.remove();
  if (!t.rows.length) return void t.remove();
  const cls = t.getAttribute('class');
  if (cls && o.tableStyle) {
    const name = o.tableStyle(cls.trim());
    if (name) t.setAttribute('data-table-style', name);
    else dropped.push(`unknown table style "${cls}"`);
  }
  const weights = columnWeights(t);
  const known = weights.filter((w): w is number => w != null);
  // Columns without a width share what the others leave.
  const rest = known.length && known.length < weights.length ? Math.max(5, (100 - known.reduce((a, b) => a + b, 0)) / (weights.length - known.length)) : null;
  const filled = known.length ? Array.from(weights, (w) => Math.round(w ?? rest ?? 0)) : null;
  const noBorder = t.getAttribute('border') === '0';
  for (const row of t.rows) {
    let col = 0;
    for (const cell of row.cells) {
      if (filled) cell.setAttribute('colwidth', filled.slice(col, col + cell.colSpan).join(','));
      col += cell.colSpan;
      if (noBorder) for (const side of SIDES) cell.setAttribute(`data-border-${side}`, 'none');
      borders(cell, 'data-border');
      cellPadding(cell);
      cell.removeAttribute('width');
    }
  }
  for (const row of t.rows) { const h = toPx(row.style.height); if (h) row.style.height = `${h}px`; }
  // TipTap would read <col> widths by cell index, skipping the first column.
  t.querySelectorAll('colgroup, col').forEach((c) => c.remove());
}

/** A cell's CSS padding in the custom properties the cell reads it from. */
export function cellPadding(cell: HTMLElement): void {
  const s = cell.style;
  const sides = [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft];
  if (!sides.some(Boolean)) return;
  sides.forEach((v, i) => { const cm = toCm(v); if (cm != null) s.setProperty(CELL_PAD_VARS[i], `${cm}cm`); });
}

const WRAPS: Record<string, string> = { left: 'left', right: 'right' };

/** A floating frame's CSS margin as its gap to the text, else a new frame's. */
function setGap(el: HTMLElement, frame: HTMLElement, fallback: WrapGap): void {
  const s = frame.style;
  const cm = (v: string) => toCm(v, 'cm') ?? 0;
  const sides = [s.marginTop, s.marginRight, s.marginBottom, s.marginLeft];
  const gap = sides.some(Boolean) ? wrapGap({ top: cm(sides[0]), right: cm(sides[1]), bottom: cm(sides[2]), left: cm(sides[3]) }) : fallback;
  el.setAttribute('data-wrap-dist', wrapGapText(gap)!);
}

/**
 * A text box's CSS beyond size, float and fill: padding, vertical text, the text's vertical
 * alignment, and its shape from border-radius (50% an ellipse) or `shape: <kind>`.
 */
export function frameCss(box: HTMLElement, el: HTMLElement): void {
  const s = el.style;
  const css = (p: string) => s.getPropertyValue(p).trim();
  const pad = toCm(s.paddingTop || s.padding, 'cm');
  if (pad != null) box.setAttribute('data-padding', String(pad));
  const mode = css('writing-mode');
  if (/vertical|sideways/.test(mode)) box.setAttribute('data-text-vertical', /sideways-lr/.test(mode) ? 'up' : 'true');
  const v = css('vertical-align') || css('align-content');
  if (/middle|center/.test(v)) box.setAttribute('data-text-valign', 'middle');
  else if (/bottom|end/.test(v)) box.setAttribute('data-text-valign', 'bottom');
  const shape = (/shape\s*:\s*([\w-]+)/i.exec(el.getAttribute('style') ?? '') ?? [])[1] ?? el.getAttribute('class')?.trim();
  if (isShapeKind(shape)) box.setAttribute('data-shape', shape);
  else if (s.borderRadius) box.setAttribute('data-shape', /50%/.test(s.borderRadius) ? 'ellipse' : 'roundRect');
}

/** `<aside>` as a text box, anchored at the start of the paragraph after it. */
function textBox(el: HTMLElement): void {
  const doc = el.ownerDocument;
  const box = doc.createElement('div');
  box.setAttribute('data-textbox', '');
  const s = el.style;
  const width = s.width && /%$/.test(s.width) ? Math.round((parseFloat(s.width) / 100) * TEXT_WIDTH_CM * PX_PER_CM) : toPx(s.width || el.getAttribute('width'));
  box.style.width = `${width ?? 280}px`;
  box.style.height = `${toPx(s.height || el.getAttribute('height')) ?? 96}px`;
  const wrap = WRAPS[s.cssFloat || s.getPropertyValue('float')];
  if (wrap) { box.setAttribute('data-wrap', wrap); setGap(box, el, BOX_WRAP_GAP); }
  const fill = normalizeColor(s.backgroundColor || s.background);
  box.setAttribute('data-fill', fill ?? '#FFFFFF');
  frameCss(box, el);
  const border = s.getPropertyValue('border');
  const stroke = border ? borderAttr(border) : '1pt solid #000000';
  if (stroke && stroke !== 'none') {
    const [w, , c] = stroke.split(' ');
    box.setAttribute('data-stroke', c);
    box.setAttribute('data-stroke-width', String(parseFloat(w)));
  }
  // A box holds blocks; loose text in it becomes a paragraph.
  let loose: HTMLElement | null = null;
  for (const n of [...el.childNodes]) {
    const block = n.nodeType === 1 && !/^(SPAN|STRONG|B|EM|I|U|S|A|BR|SUB|SUP|MARK|IMG|INPUT|TIME)$/.test((n as Element).tagName);
    if (block) { loose = null; box.append(n); continue; }
    if (n.nodeType === 3 && !n.textContent!.trim()) continue;
    if (!loose) { loose = doc.createElement('p'); box.append(loose); }
    loose.append(n);
  }
  if (!box.firstChild) box.append(doc.createElement('p'));
  const next = el.nextElementSibling as HTMLElement | null;
  if (el.closest('p, h1, h2, h3, h4, h5, h6, li, td, th')) el.replaceWith(box);
  else if (next && BLOCKS.has(next.tagName)) { next.prepend(box); el.remove(); }
  else { const p = doc.createElement('p'); p.append(box); el.replaceWith(p); }
}

/** A grey picture labelled with `label`: a PNG where a canvas draws, else an SVG. */
export function placeholderImage(label: string, w: number, h: number, doc: Document): string {
  // The page's own document: a canvas of the inert one draws shapes but no text.
  const canvas = (globalThis.document ?? doc).createElement('canvas');
  let g: CanvasRenderingContext2D | null = null;
  try { g = canvas.getContext('2d'); } catch { /* jsdom has no canvas */ }
  if (g) {
    canvas.width = w;
    canvas.height = h;
    g.fillStyle = '#E5E7EB';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9CA3AF';
    g.strokeRect(0.5, 0.5, w - 1, h - 1);
    g.fillStyle = '#4B5563';
    g.font = `600 ${Math.max(11, Math.min(22, Math.round(w / 7)))}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2, w - 8);
    return canvas.toDataURL('image/png');
  }
  const esc = label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#E5E7EB"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="14" fill="#6B7280">${esc}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function image(img: HTMLImageElement, dropped: string[]): void {
  const src = img.getAttribute('src');
  if (src && /^(data:|idb:)/i.test(src)) return;
  if (src) {
    dropped.push(`image ${src.slice(0, 60)} ignored: only a placeholder (<img alt> without src) can be inserted`);
    img.remove();
    return;
  }
  const s = img.style;
  const w = toPx(img.getAttribute('width') || s.width) ?? 150;
  const h = toPx(img.getAttribute('height') || s.height) ?? Math.round(w * 1.3);
  img.setAttribute('src', placeholderImage(img.getAttribute('alt') || 'Image', w, h, img.ownerDocument));
  img.setAttribute('width', String(w));
  img.setAttribute('height', String(h));
  const wrap = WRAPS[s.cssFloat || s.getPropertyValue('float')];
  if (wrap) { img.setAttribute('data-wrap', wrap); setGap(img, img, PICTURE_WRAP_GAP); }
}

const FIELD_TOKEN = /\{(date|time)\}/g;
const SEQ_TOKEN = /\{(figure|table)\}/gi;
// LaTeX between \( \) inline, \[ \] on a line of its own; split keeps the delimiters.
const FORMULA_TOKEN = /(\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/g;

function formula(doc: Document, tex: string): HTMLElement {
  const span = doc.createElement('span');
  span.setAttribute('data-formula', tex.slice(2, -2).trim());
  if (tex.startsWith('\\[')) span.setAttribute('data-display', 'true');
  return span;
}

/**
 * `<a id>` without href marks a bookmark; `<a href="#name">` is a cross-reference to
 * one, showing its text, or with class page, number or direction that.
 */
function anchor(a: HTMLAnchorElement): void {
  const doc = a.ownerDocument;
  const href = a.getAttribute('href');
  const name = a.getAttribute('id') || a.getAttribute('name');
  if (!href && name) {
    const span = doc.createElement('span');
    span.setAttribute('data-bookmark', name);
    span.append(...a.childNodes);
    a.replaceWith(span);
  } else if (href?.startsWith('#') && href.length > 1) {
    const ref = doc.createElement('span');
    ref.setAttribute('data-cross-ref', decodeURIComponent(href.slice(1)));
    const format = a.getAttribute('class')?.trim();
    ref.setAttribute('data-format', format && /^(page|number|direction)$/.test(format) ? format : 'text');
    ref.setAttribute('data-text', a.textContent || '');
    a.replaceWith(ref);
  }
}

/** `<cite title author year …>Key</cite>` as a citation of that source; Key is its short name. */
function citation(el: HTMLElement): HTMLElement {
  const span = el.ownerDocument.createElement('span');
  const id = (el.textContent || el.getAttribute('title') || 'Source').trim();
  const fields: Record<string, string> = {};
  for (const at of [...el.attributes]) if (!/^(type|class|style)$/.test(at.name)) fields[at.name] = at.value;
  span.setAttribute('data-bib-id', id);
  span.setAttribute('data-bib-type', el.getAttribute('type') || 'book');
  span.setAttribute('data-bib-fields', JSON.stringify(fields));
  span.setAttribute('data-bib-text', `[${id}]`);
  return span;
}
const PAGE_TOKEN = /\{(page|pages|chapter)\}/g;
const PAGE_FIELD: Record<string, string> = { page: 'number', pages: 'count', chapter: 'chapter' };

/** Every `re` match in the text under `root` replaced by the element `make` builds. */
function replaceTokens(root: HTMLElement, re: RegExp, make: (token: string) => Node): void {
  const walker = root.ownerDocument.createTreeWalker(root, 4);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    if (!t.data.match(re)) continue;
    const parts = t.data.split(re);
    t.replaceWith(...parts.map((p, i) => (i % 2 ? make(p) : root.ownerDocument.createTextNode(p))));
  }
}

function field(doc: Document, kind: string): HTMLElement {
  const span = doc.createElement('span');
  span.setAttribute('data-datetime-field', kind);
  return span;
}

/**
 * Rewrites `body` in place. Returns what it had to leave out, for a tool to report, and
 * whether the text holds tabs, which the parser keeps only with whitespace preserved.
 */
export function normalizeAiHtml(body: HTMLElement, o: DialectOptions = {}): { dropped: string[]; tabs: boolean; notes: NoteText[] } {
  const doc = body.ownerDocument;
  const dropped: string[] = [];
  const notes: NoteText[] = [];
  // A note's text cannot ride the slice (it lives at the document end), so it goes aside.
  for (const sup of [...body.querySelectorAll('sup.footnote, sup.endnote')] as HTMLElement[]) {
    if (!o.noteId) continue;
    const id = o.noteId();
    notes.push({ id, html: sup.innerHTML });
    const ref = doc.createElement('sup');
    ref.setAttribute('data-note-ref', id);
    ref.setAttribute('data-note-kind', sup.classList.contains('endnote') ? 'endnote' : 'footnote');
    ref.setAttribute('data-text', '');
    sup.replaceWith(ref);
  }
  for (const el of [...body.querySelectorAll('*')] as HTMLElement[]) {
    const tag = el.tagName;
    if (BLOCKS.has(tag)) paragraph(el, o, dropped);
    else if (tag === 'TABLE') table(el as HTMLTableElement, o, dropped);
    else if (tag === 'IMG') image(el as HTMLImageElement, dropped);
    else if (tag === 'SPAN') { runEffects(el); runShading(el); }
    else if (tag === 'HR') {
      const next = el.nextElementSibling;
      if (next) next.setAttribute('data-page-break-before', 'page');
      el.remove();
    } else if (tag === 'INPUT') {
      const span = doc.createElement('span');
      span.setAttribute('data-placeholder-field', el.getAttribute('placeholder') || el.getAttribute('value') || '…');
      el.replaceWith(span);
    } else if (tag === 'TIME') {
      const when = el.getAttribute('datetime') ?? '';
      const f = field(doc, /^\d\d:\d\d/.test(when) ? 'time' : 'date');
      // A given moment is a fixed field; without one it shows the current date.
      if (when && !Number.isNaN(Date.parse(when))) { f.setAttribute('data-fixed', 'true'); f.setAttribute('data-value', when); }
      const format = el.getAttribute('format');
      if (format) f.setAttribute('data-format', format);
      el.replaceWith(f);
    } else if (tag === 'A') {
      anchor(el as HTMLAnchorElement);
    } else if (tag === 'DFN') {
      const entry = doc.createElement('span');
      entry.setAttribute('data-index-term', el.getAttribute('title') || el.textContent || '');
      el.replaceWith(entry, ...el.childNodes);
    } else if (tag === 'CITE') {
      el.replaceWith(citation(el));
    } else if (tag === 'SECTION') {
      const n = parseInt(el.getAttribute('columns') || el.style.columnCount, 10);
      if (n >= 2) {
        const div = doc.createElement('div');
        div.setAttribute('data-columns', String(Math.min(3, n)));
        div.append(...el.childNodes);
        el.replaceWith(div);
      }
    } else if ((tag === 'OL' || tag === 'UL') && el.style.listStyleType) {
      const type = el.style.listStyleType.trim();
      if (tag === 'UL') { const ch = /^["'](.+)["']$/.exec(type)?.[1]; if (ch) el.setAttribute('data-bullet', ch); }
      else el.setAttribute('data-list-style', type);
    } else if (tag === 'NAV') {
      const toc = doc.createElement('div');
      toc.setAttribute('data-toc', '');
      const kind = el.getAttribute('class')?.trim();
      if (kind && /^(figures|tables|alphabetical|bibliography)$/.test(kind)) toc.setAttribute('data-toc-index', kind);
      if (el.title) toc.setAttribute('data-toc-title', el.title);
      if (el.getAttribute('levels')) toc.setAttribute('data-toc-levels', el.getAttribute('levels')!);
      toc.setAttribute('data-entries', 'null');
      el.replaceWith(toc);
    }
  }
  // After the tables, so a paragraph inside a box keeps what it was given.
  for (const el of [...body.querySelectorAll('aside')] as HTMLElement[]) textBox(el);
  replaceTokens(body, FIELD_TOKEN, (kind) => field(doc, kind));
  replaceTokens(body, SEQ_TOKEN, (cat) => { const seq = doc.createElement('span'); seq.setAttribute('data-seq', cat.toLowerCase()); return seq; });
  replaceTokens(body, FORMULA_TOKEN, (tex) => formula(doc, tex));
  const tabs = (body.textContent ?? '').includes('\t');
  if (tabs) collapseSpaces(body);
  return { dropped, tabs, notes };
}

// What the parser does to whitespace, minus the tabs, for a parse that preserves it.
function collapseSpaces(body: HTMLElement): void {
  const walker = body.ownerDocument.createTreeWalker(body, 4);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    const parent = t.parentElement!;
    const inline = /^(SPAN|STRONG|B|EM|I|U|S|A|SUB|SUP|MARK|P|H[1-6]|LI|TD|TH)$/.test(parent.tagName);
    if (!t.data.replace(/[ \r\n\f]/g, '')) {
      if (!inline || !t.previousSibling || !t.nextSibling) { t.remove(); continue; }
    }
    t.data = t.data.replace(/[ \r\n\f]+/g, ' ');
    if (!t.previousSibling && /^(P|H[1-6]|LI|TD|TH)$/.test(parent.tagName)) t.data = t.data.replace(/^ +/, '');
    if (!t.nextSibling && /^(P|H[1-6]|LI|TD|TH)$/.test(parent.tagName)) t.data = t.data.replace(/ +$/, '');
  }
}

/** Looks a name up among `names` by itself or its display label, case-insensitively. */
export function nameLookup(names: string[], label: (name: string) => string): (name: string) => string | null {
  const by = new Map<string, string>();
  for (const n of names) {
    by.set(n.toLowerCase(), n);
    by.set(label(n).toLowerCase(), n);
  }
  return (name) => by.get(name.trim().toLowerCase()) ?? null;
}

/** `{page}`, `{pages}` and `{chapter}` in a header or footer as their fields. */
export function pageFields(root: HTMLElement): void {
  replaceTokens(root, PAGE_TOKEN, (name) => {
    const span = root.ownerDocument.createElement('span');
    span.setAttribute('data-page-field', PAGE_FIELD[name]);
    return span;
  });
}

export type ZonePart = { zone: 'header' | 'footer'; variant: 'default' | 'first' | 'even'; html: string };
export type PageSpec = { size?: string; orientation?: string; margins?: { top: number; right: number; bottom: number; left: number }; start?: number };

/** CSS shorthand margins (`2cm`, `2cm 2.5cm`, … four values), bare numbers in cm. */
export function parseMargins(v: string): PageSpec['margins'] | undefined {
  const cm = v.trim().split(/[\s,/]+/).map((x) => toCm(x, 'cm'));
  if (!cm.length || cm.length > 4 || cm.some((x) => x == null || x < 0)) return undefined;
  const [top, right = top, bottom = top, left = right] = cm as number[];
  return { top, right, bottom, left };
}

/**
 * A reply as the document's parts: the body, any `<header>`/`<footer>` (`data-page` first
 * or even) and a `<page>` with its setup.
 */
export function splitDocumentHtml(html: string): { body: string; zones: ZonePart[]; page: PageSpec | null } {
  if (!/<(header|footer|page)\b/i.test(html)) return { body: html, zones: [], page: null };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  let page: PageSpec | null = null;
  for (const el of [...body.querySelectorAll('page')]) {
    const spec: PageSpec = {};
    const size = el.getAttribute('size') ?? el.getAttribute('format');
    if (size) spec.size = size;
    const o = el.getAttribute('orientation');
    if (o) spec.orientation = o;
    const m = el.getAttribute('margin') ?? el.getAttribute('margins');
    if (m) spec.margins = parseMargins(m);
    const start = parseInt(el.getAttribute('start') ?? '', 10);
    if (start >= 0) spec.start = start;
    page = { ...(page ?? {}), ...spec };
    // `<page …/>` is no void element: what follows it parsed as its children.
    el.replaceWith(...el.childNodes);
  }
  const zones: ZonePart[] = [];
  for (const el of [...body.querySelectorAll('header, footer')] as HTMLElement[]) {
    const v = el.getAttribute('data-page') ?? el.getAttribute('page');
    zones.push({ zone: el.tagName === 'HEADER' ? 'header' : 'footer', variant: v === 'first' || v === 'even' ? v : 'default', html: el.innerHTML.trim() });
    el.remove();
  }
  return { body: body.innerHTML.trim(), zones, page };
}
