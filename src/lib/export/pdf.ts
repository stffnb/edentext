// PDF export that matches the editor exactly AND keeps selectable text. The browser's
// print-time re-render drifts text (vector ≠ hinted metrics) and broke the band masks,
// so we raster the on-screen render and overlay an invisible, positioned text layer.

import { tick } from 'svelte';
import { generateHTML } from '@tiptap/core';
import { allPagesDrawn } from '../components/pageWindow.svelte';
import { type Orientation } from '../storage/pageOrientation';
import { DEFAULT_MARGINS, PX_PER_CM, type PageMargins } from '../storage/pageMargins';
import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
import { hfIsEmpty, type HfDoc } from '../storage/headerFooter';
import { extensions } from '../editor/extensions';
import { columnPercents } from '../editor/extensions/tableView';
import { effectiveOrderedDef, formatOrdinal } from '../utils/orderedListTypes';
import { defaultBulletChar } from '../utils/bulletListTypes';
import { styleSheet } from '../styles/sheet.svelte';
import { outlineLabel } from '../styles/outlineNumbering';
import { deriveFilename } from '../storage/documentName';
import { desktopPrintToPdf } from '../storage/desktopFiles';
import { saveDocument } from './saveFile';
import { alignStrip, stripOf } from '../utils/pageStrip';
import { BAR_STRIP_CM, commentListHtml, markReviewBlocks, printedComments, reviewPrintCss, type CommentLabels, type PrintedComment } from './reviewPrint';

const DEFAULT_COMMENT_LABELS: CommentLabels = { heading: 'Comments', onPage: (n) => `Page ${n}` };
import globalCss from '../../styles/global.css?inline';
import editorCss from '../../styles/editor.css?inline';

const PAGE_GAP = 20; // must match pageBreaks.ts / editor.css --page-gap
const PT = 72 / 96;  // CSS px @96dpi → PDF points

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface PdfOptions {
  source: HTMLElement; // the live `.tiptap` element (editor.view.dom)
  json: Json;          // fallback for the suggested filename
  fileName?: string;   // document name (any extension); overrides the heading-derived name
  orientation?: Orientation;
  pageFormat?: PageFormat;
  numPages?: number;
  /** Labels of the printed comment list; this module has no i18n of its own. */
  commentLabels?: CommentLabels;
  /** Whether the review markup prints at all (`storage/printMarkup`); default on. */
  printMarkup?: boolean;
  /** The share of the pages rastered so far (0…1). */
  onProgress?: (done: number) => void;
  /** Hand the bytes back instead of downloading them (an embedding host saves them). */
  toBytes?: boolean;
}

type Run = { str: string; x: number; y: number; h: number }; // doc px, relative to .paper top-left

function pageDims(format: PageFormat, orientation: Orientation): { pageW: number; pageH: number } {
  const { w, h } = pageDimsCm(format, orientation);
  return { pageW: w * PX_PER_CM, pageH: h * PX_PER_CM };
}

// Off-screen, scale-1, theme-neutral copy of the live .paper. Rendered identically to
// the editor (no print re-layout), so the raster + measured text positions agree.
function buildClone(paper: HTMLElement, pageW: number, markup: boolean): { holder: HTMLElement; clone: HTMLElement; style: HTMLStyleElement } {
  const clone = paper.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  clone.style.width = `${pageW}px`; // pin width so capture geometry can't drift on var inheritance
  clone.classList.remove('show-formatting-marks', 'field-shading', 'hf-editing');
  // The margin bar prints at one weight: which one the caret is on is an editing state.
  if (markup) clone.querySelectorAll('.change-bar.active').forEach((el) => el.classList.remove('active'));
  else clone.querySelectorAll('.change-bar-layer').forEach((el) => el.remove());

  // html2canvas paints an inline background from one bounding rect, so a wrapped
  // highlight covers the bold term preceding it on the first line. Lift bold-and-
  // highlighted runs into a later paint pass so the highlight can't cover them.
  clone.querySelectorAll('strong').forEach((el) => {
    if (el.closest('mark') || el.querySelector('mark')) {
      el.style.position = 'relative';
      el.style.zIndex = '1';
    }
  });

  const holder = document.createElement('div');
  holder.setAttribute('data-pdf-export', '');
  holder.style.cssText = 'position:fixed; left:-100000px; top:0; background:#fff;';
  // Theme-neutral: white page, black text, real explicit colors (ignore dark/allBlack).
  holder.style.setProperty('--color-page-bg', '#fff');
  holder.style.setProperty('--color-page-text', '#000');
  holder.style.setProperty('--color-page-border', '#000');
  holder.appendChild(clone);

  const style = document.createElement('style');
  style.textContent = `
[data-pdf-export] .paper, [data-pdf-export] .paper .tiptap { box-shadow:none !important; }
[data-pdf-export] .paper { background:#fff !important; }
[data-pdf-export] .paper .tiptap { background:none !important; }
[data-pdf-export] .column-resize-handle, [data-pdf-export] .row-resize-handle { display:none !important; }
[data-pdf-export] .selectedCell::after { display:none !important; }
/* No selection highlight in the output — and its color-mix background computes to a
   color() value html2canvas cannot parse, which aborted the whole capture. */
[data-pdf-export] .ProseMirror-selectednode { background:none !important; outline:none !important; box-shadow:none !important; }
[data-pdf-export] .tiptap .is-editor-empty::before { content:none !important; }
[data-pdf-export] .tiptap [style*="--pdf-outline"]::before { content:var(--pdf-outline) !important; }
/* The ¶ prints transparent and out of flow (in flow only in a columns section), but
   html2canvas copies every style of a pseudo-element, thousands of times over. */
[data-pdf-export] .tiptap :is(p, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10):not(.columns-node *)::after { content:none !important; }
[data-pdf-export] .hf-bar { display:none !important; }
[data-pdf-export] .tiptap [data-color] { color:var(--font-color, currentColor) !important; }
`;
  return { holder, clone, style };
}

// Invisible-text runs: one per wrapped line of every text node, positioned in doc px
// relative to the .paper top-left (the same frame the raster is cropped in).
function collectRuns(root: HTMLElement): Run[] {
  const base = root.getBoundingClientRect();
  const runs: Run[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const tn = node as Text;
    const text = tn.data;
    if (!text.trim()) continue;
    range.selectNodeContents(tn);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;

    let offset = 0;
    for (let li = 0; li < rects.length; li++) {
      let end: number;
      if (li === rects.length - 1) {
        end = text.length;
      } else {
        // Largest offset whose [offset..mid] still ends on this line (top < next line's top).
        const nextTop = rects[li + 1].top;
        let lo = offset + 1, hi = text.length, best = offset + 1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          range.setStart(tn, offset);
          range.setEnd(tn, mid);
          const rs = range.getClientRects();
          const t = rs.length ? rs[rs.length - 1].top : rects[li].top;
          if (t < nextTop - 0.5) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        end = best;
      }
      const str = text.slice(offset, end);
      const r = rects[li];
      if (str.trim()) runs.push({ str, x: r.left - base.left, y: r.top - base.top, h: r.height });
      offset = end;
    }
  }
  return runs;
}

// An item opening with a sub-list has no label and counts nothing (listStyle.ts).
const labelless = (li: Element) => /^(UL|OL)$/.test(li.firstElementChild?.tagName ?? '');

// 1-based ordinal of a li within its list (start attr respected); an item without a
// label stands in a chain at the count before it, as the counter it leaves alone does.
function liOrdinal(li: HTMLElement): number {
  const parent = li.parentElement!;
  const items = Array.from(parent.children);
  const before = items.slice(0, items.indexOf(li)).filter((c) => c.tagName === 'LI' && !labelless(c)).length;
  return parseInt(parent.getAttribute('start') ?? '1', 10) + before - (labelless(li) ? 1 : 0);
}

// The outermost <ol> of the unbroken 'multilevel' run this list sits in — where the
// chain `counters(list-item, '.')` prints starts, so the walk cannot stop at the nearest
// one. Keyed on the *effective* numbering, the attr editor.css draws from: a list
// numbered by a named style carries no `data-list-style` of its own.
function multilevelRoot(ol: HTMLElement, root: HTMLElement): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (let e: HTMLElement | null = ol; e && e !== root; e = e.parentElement) {
    if (e.tagName !== 'OL') continue;
    if (e.getAttribute('data-eff-list-style') !== 'multilevel') break;
    found = e;
  }
  return found;
}

// The marker text the browser renders for a list item: the depth bullet/bulletChar
// for a <ul>, the effective ordinal (depth cycle 1. → a. → i., explicit type, or
// the multilevel chain "1.2.1.") for an <ol>.
function listMarkerGlyph(li: HTMLElement, root: HTMLElement): string {
  const parent = li.parentElement;
  if (!parent) return '';
  if (parent.tagName === 'OL') {
    const mlRoot = multilevelRoot(parent, root);
    if (mlRoot) {
      // Chain: ordinals of every ordered level from the multilevel root down.
      const chain: number[] = [];
      for (let e: HTMLElement | null = li; e && e !== root; e = e.parentElement) {
        if (e.tagName === 'LI' && e.parentElement?.tagName === 'OL') {
          chain.unshift(liOrdinal(e));
          if (e.parentElement === mlRoot) break;
        }
      }
      return chain.join('.') + '.';
    }
    let olDepth = 0;
    for (let e: HTMLElement | null = parent; e && e !== root; e = e.parentElement) {
      if (e.tagName === 'OL') olDepth++;
    }
    // orderedList.ts's plugin resolves the effective numbering onto data-eff-list-style
    // (re-anchoring nested defaults); olDepth is only a fallback if it is absent.
    const def = effectiveOrderedDef(parent.getAttribute('data-eff-list-style'), olDepth - 1);
    return formatOrdinal(liOrdinal(li), def.numFormat) + def.numSuffix;
  }
  // Explicit bulletChar attr wins; otherwise the default cycle keyed by the number
  // of <ul> ancestors (matching editor.css's `ul ul …` depth rules).
  const explicit = parent.getAttribute('data-bullet');
  if (explicit) return explicit;
  let depth = 0;
  for (let e: HTMLElement | null = li.parentElement; e && e !== root; e = e.parentElement) {
    if (e.tagName === 'UL') depth++;
  }
  return defaultBulletChar(depth - 1);
}

// html2canvas can't paint our markers (counter() numbering, counters() chains), so each
// marker becomes a real span boxed exactly as editor.css boxes the ::before — floated, or
// inline where a sized label grows the line — which the class then switches off.
const MARKER_BOX = ['float', 'display', 'position', 'top', 'right', 'min-width', 'margin-left',
  'white-space', 'line-height', 'text-indent', 'vertical-align',
  'font-family', 'font-weight', 'font-style', 'font-size', 'color'];
function materializeListMarkers(root: HTMLElement): void {
  // Every box is read before the first span goes in: a write between reads would
  // restyle the whole copy once per item.
  const labels = Array.from(root.querySelectorAll<HTMLLIElement>('li')).flatMap((li) => {
    if (labelless(li)) return [];
    const glyph = listMarkerGlyph(li, root);
    if (!glyph) return [];
    const target = li.querySelector<HTMLElement>(':scope > :is(p, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10)') ?? li;
    const before = getComputedStyle(target, '::before');
    return [{ target, glyph, css: MARKER_BOX.map((p) => `${p}:${before.getPropertyValue(p)}`).join(';') }];
  });
  root.classList.add('pdf-list-markers');
  for (const { target, glyph, css } of labels) {
    const label = document.createElement('span');
    label.style.cssText = css;
    label.textContent = `${glyph} `; // the trailing space editor.css puts in every marker
    label.dataset.pdfMarker = '';
    target.insertBefore(label, target.firstChild);
  }
}

// html2canvas knows no counter-set, which outline numbering rewinds the deeper levels
// with, so each numbered heading's ::before gets its label as a string, counted the
// way outlineCss counts: own level up, every deeper one back to its start.
function materializeOutlineLabels(root: HTMLElement): void {
  const levels = styleSheet().outline;
  if (!levels?.length) return;
  const counts: number[] = [];
  const heads = root.querySelectorAll<HTMLElement>(`.tiptap :is(${Array.from({ length: 10 }, (_, i) => `h${i + 1}`).join(', ')})`);
  for (const h of Array.from(heads)) {
    if (h.closest('td, th, li, .frame-node')) continue;
    const level = Number(h.tagName.slice(1));
    if (!levels[level - 1] || levels[level - 1].format === 'none') continue;
    counts[level - 1] = (counts[level - 1] ?? (levels[level - 1].start ?? 1) - 1) + 1;
    for (let d = level; d < levels.length; d++) counts[d] = (levels[d]?.start ?? 1) - 1;
    const label = outlineLabel(levels, level, counts, formatOrdinal).replace(/ /g, '\u00a0');
    if (label) h.style.setProperty('--pdf-outline', JSON.stringify(label));
  }
}

// Device px a strip of pages may be tall: one canvas for a whole long document exceeds
// every engine's limit and comes out blank (Firefox caps a side at 32767).
const STRIP_PX = 32000;

// The live .paper's pages as page-sized JPEGs, rastered off screen at scale 1 in
// strips of pages (page i occupies [i*cycle, i*cycle+pageH]); the caller invokes cleanup()
// once done reading `clone`. `scale` = oversampling @ A4 (2 ≈ 192 dpi, 3 ≈ 288 dpi).
export async function renderPages(opts: PdfOptions, scale = 2): Promise<{
  images: Blob[]; clone: HTMLElement; pages: number;
  pageW: number; pageH: number; cycle: number; scale: number; cleanup: () => void;
}> {
  const paper = opts.source.closest('.paper') as HTMLElement | null;
  if (!paper) throw new Error('paper element not found');
  const orientation: Orientation = opts.orientation ?? 'portrait';
  const { pageW, pageH } = pageDims(opts.pageFormat ?? 'A4', orientation);
  const cycle = pageH + PAGE_GAP;

  // The header/footer layer draws a window of pages; the capture takes them all.
  allPagesDrawn.on = true;
  await tick();
  const { holder, clone, style } = buildClone(paper, pageW, opts.printMarkup !== false);
  allPagesDrawn.on = false;
  document.head.appendChild(style);
  document.body.appendChild(holder);
  const strip = holder.cloneNode(false) as HTMLElement;
  const cleanup = () => { holder.remove(); strip.remove(); style.remove(); };
  let encoder: ReturnType<typeof pageEncoder> | undefined;

  try {
    await document.fonts.ready;
    materializeListMarkers(clone);
    materializeOutlineLabels(clone);
    // Nothing hidden paints, yet html2canvas clones and parses it: the editing handles
    // alone can be a third of a picture-heavy document's elements.
    Array.from(clone.querySelectorAll('*'))
      .filter((el) => el instanceof HTMLElement && el.tagName !== 'STYLE' && getComputedStyle(el).display === 'none')
      .forEach((el) => el.remove());
    const pages = Math.max(1, opts.numPages ?? Math.round((clone.offsetHeight + PAGE_GAP) / cycle));
    const parts = measureParts(clone);
    const perStrip = Math.max(1, Math.floor(STRIP_PX / (cycle * scale)));
    const html2canvas = (await import('html2canvas')).default;
    opts.onProgress?.(0);
    // Encoded off the main thread where the engine can, while the next strip renders.
    encoder = pageEncoder();
    const images: Promise<Blob>[] = [];
    let encoded = 0;
    document.body.appendChild(strip);
    for (let first = 0; first < pages; first += perStrip) {
      const n = Math.min(perStrip, pages - first);
      strip.replaceChildren(pdfStrip(clone, parts, first * cycle - pageH / 2, (first + n) * cycle + pageH / 2));
      alignStrip(strip.firstElementChild as HTMLElement);
      const canvas = await html2canvas(strip.firstElementChild as HTMLElement, {
        scale,
        backgroundColor: '#ffffff',
        y: first * cycle,
        width: pageW,
        height: n * cycle,
        windowWidth: pageW,
        logging: false,
        // Only the strip: the live editor and the full copy would be cloned for nothing.
        ignoreElements: (el) => !(strip.contains(el) || el.contains(strip) || document.head.contains(el)),
      });
      for (let i = 0; i < n; i++) {
        images.push(encoder.crop(canvas, i, pageW, pageH, cycle, scale).then((b) => {
          opts.onProgress?.(++encoded / pages);
          return b;
        }));
      }
    }
    strip.remove();
    return { images: await Promise.all(images), clone, pages, pageW, pageH, cycle, scale, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    encoder?.close();
  }
}

interface Part { top: number; bottom: number; absolute: boolean }

// What a strip may drop: the text flow's blocks and the page layers' children, by their
// extent in paper px. Counters no longer reach across blocks: every label is text by now.
function measureParts(paper: HTMLElement): Part[] {
  const base = paper.getBoundingClientRect().top;
  return partsOf(paper).map((el) => {
    const r = el.getBoundingClientRect();
    const position = getComputedStyle(el).position;
    return { top: r.top - base, bottom: r.bottom - base, absolute: position === 'absolute' || position === 'fixed' };
  });
}

function partsOf(paper: HTMLElement): HTMLElement[] {
  const flow = paper.querySelector('.tiptap') as HTMLElement;
  const layers = Array.from(paper.children).filter((c) => !c.contains(flow));
  return [...Array.from(flow.children), ...layers.flatMap((l) => Array.from(l.children))] as HTMLElement[];
}

// A copy of the paper holding only what reaches into [top, bottom]: html2canvas copies the
// style of every element it clones, so a strip must not carry the whole document.
function pdfStrip(paper: HTMLElement, parts: Part[], top: number, bottom: number): HTMLElement {
  const flow = paper.querySelector('.tiptap') as HTMLElement;
  const els = partsOf(paper);
  const keep = new Set<Node>();
  let first = -1;
  parts.forEach((p, i) => {
    const el = els[i];
    if (p.bottom >= top && p.top <= bottom) {
      keep.add(el);
      if (first < 0 && el.parentElement === flow) first = i;
    } else if (!(el.parentElement === flow || p.absolute)) {
      keep.add(el);
    }
  });
  const holders = new Set<Node | null>(els.map((el) => el.parentElement));
  return stripOf(paper, holders, keep, first < 0 ? null : els[first], first < 0 ? 0 : parts[first].top);
}

// Page JPEGs in a few workers, so encoding runs beside the next strip's render; an engine
// without OffscreenCanvas crops and encodes on the main thread.
function pageEncoder() {
  const n = typeof OffscreenCanvas === 'undefined' ? 0 : Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = Array.from({ length: n }, () => new Worker(new URL('./pageWorker.ts', import.meta.url), { type: 'module' }));
  const pending = new Map<number, { resolve: (b: Blob) => void; reject: (e: unknown) => void }>();
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<{ id: number; blob: Blob }>) => {
      pending.get(e.data.id)?.resolve(e.data.blob);
      pending.delete(e.data.id);
    };
    w.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error(`page encoder failed: ${e.message}`)));
      pending.clear();
    };
  }
  let next = 0;
  return {
    crop(canvas: HTMLCanvasElement, i: number, pageW: number, pageH: number, cycle: number, scale: number): Promise<Blob> {
      if (!n) return cropPage(canvas, i, pageW, pageH, cycle, scale);
      const id = next++;
      return createImageBitmap(canvas, 0, Math.round(i * cycle * scale), Math.round(pageW * scale), Math.round(pageH * scale))
        .then((bitmap) => new Promise<Blob>((resolve, reject) => {
          pending.set(id, { resolve, reject });
          workers[id % n].postMessage({ id, bitmap }, [bitmap]);
        }));
    },
    close: () => workers.forEach((w) => w.terminate()),
  };
}

// Crop page i's surface [i*cycle, i*cycle+pageH] out of a strip starting at page 0 of it.
function cropPage(
  canvas: HTMLCanvasElement, i: number,
  pageW: number, pageH: number, cycle: number, scale: number,
): Promise<Blob> {
  const tmp = document.createElement('canvas');
  tmp.width = Math.round(pageW * scale);
  tmp.height = Math.round(pageH * scale);
  const ctx = tmp.getContext('2d')!;
  // JPEG (DCTDecode) keeps the file small; q0.92 @2× scale stays visually crisp.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(canvas, 0, i * cycle * scale, pageW * scale, pageH * scale, 0, 0, pageW * scale, pageH * scale);
  return new Promise((resolve, reject) => tmp.toBlob(
    (b) => (b ? resolve(b) : reject(new Error('page image could not be encoded'))), 'image/jpeg', 0.92));
}

// The page each comment sits on. Only the raster paths can say: they print the editor's
// own pagination, while the vector path re-paginates in the browser.
function withAnchorPages(list: PrintedComment[], source: HTMLElement, cycle: number): PrintedComment[] {
  const base = source.getBoundingClientRect();
  const scale = source.offsetWidth ? base.width / source.offsetWidth : 1;
  return list.map((c) => {
    const el = source.querySelector(`[data-comment="${CSS.escape(c.id)}"]`);
    if (!el) return c;
    const top = (el.getBoundingClientRect().top - base.top) / scale;
    return { ...c, page: Math.max(1, Math.floor(top / cycle) + 1) };
  });
}

// The comment list as whole extra pages. The live .paper is an already paginated
// layout the list cannot flow into, so it is laid out and rastered on its own; a page
// starts at an entry boundary, because a raster sliced mid-line cuts the text in half.
async function renderCommentPages(
  opts: PdfOptions, list: PrintedComment[], pageW: number, pageH: number, scale: number,
): Promise<{ images: string[]; runs: Run[][] }> {
  const cs = getComputedStyle(opts.source);
  // .tiptap's padding is the page margins; PdfOptions carries the live DOM, not them.
  const [mT, mR, mB, mL] = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat);
  const contentW = Math.max(50, pageW - mL - mR);
  const usableH = Math.max(50, pageH - mT - mB);

  const holder = document.createElement('div');
  holder.setAttribute('data-pdf-export', '');
  holder.style.cssText = `position:fixed; left:-100000px; top:0; width:${contentW}px; background:#fff; color:#000;`;
  holder.innerHTML = `<style>${reviewPrintCss()}\n.comment-list { break-before: auto; }</style>`
    + commentListHtml(list, opts.commentLabels ?? DEFAULT_COMMENT_LABELS);
  document.body.appendChild(holder);
  try {
    await document.fonts.ready;
    const starts = [0];
    for (const li of Array.from(holder.querySelectorAll('li')) as HTMLElement[]) {
      if (li.offsetTop + li.offsetHeight - starts[starts.length - 1] > usableH) starts.push(li.offsetTop);
    }
    const total = holder.scrollHeight;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(holder, {
      scale, backgroundColor: '#ffffff', width: contentW, height: total, windowWidth: contentW, logging: false,
    });
    const all = collectRuns(holder);
    const images: string[] = [];
    const runs: Run[][] = [];
    for (const start of starts) {
      const tmp = document.createElement('canvas');
      tmp.width = Math.round(pageW * scale);
      tmp.height = Math.round(pageH * scale);
      const ctx = tmp.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      const h = Math.min(usableH, total - start);
      ctx.drawImage(canvas, 0, start * scale, contentW * scale, h * scale,
        mL * scale, mT * scale, contentW * scale, h * scale);
      images.push(tmp.toDataURL('image/jpeg', 0.92));
      runs.push(all.filter((r) => r.y >= start && r.y < start + usableH)
        .map((r) => ({ ...r, x: r.x + mL, y: r.y - start + mT })));
    }
    return { images, runs };
  } finally {
    holder.remove();
  }
}

// Render the document to A4 pages (raster + invisible text) and download the PDF, or
// return its bytes with `toBytes`.
export async function exportPdf(opts: PdfOptions): Promise<ArrayBuffer | undefined> {
  const { images, clone, pages, pageW, pageH, cycle, scale, cleanup } = await renderPages(opts);
  const landscape = (opts.orientation ?? 'portrait') === 'landscape';
  try {
    const runs = collectRuns(clone);
    const comments = opts.printMarkup === false
      ? [] : withAnchorPages(printedComments(opts.source), opts.source, cycle);
    const extra = comments.length
      ? await renderCommentPages(opts, comments, pageW, pageH, scale)
      : { images: [], runs: [] };
    const { jsPDF } = await import('jspdf');
    const fmt: [number, number] = [pageW * PT, pageH * PT];
    // compress: Flate the streams (e.g. the text layer); page images are JPEG.
    const doc = new jsPDF({ unit: 'pt', format: fmt, orientation: landscape ? 'l' : 'p', compress: true });

    for (let i = 0; i < pages; i++) {
      if (i > 0) doc.addPage(fmt, landscape ? 'l' : 'p');
      doc.addImage(new Uint8Array(await images[i].arrayBuffer()), 'JPEG', 0, 0, pageW * PT, pageH * PT);

      // Invisible selectable text for this page.
      const top = i * cycle, bottom = i * cycle + pageH;
      for (const r of runs) {
        if (r.y < top || r.y >= bottom - 1) continue;
        const fs = Math.max(1, r.h * PT);
        doc.setFontSize(fs);
        doc.text(r.str, r.x * PT, (r.y - top) * PT + fs * 0.8, { renderingMode: 'invisible', baseline: 'alphabetic' });
      }
    }

    for (let i = 0; i < extra.images.length; i++) {
      doc.addPage(fmt, landscape ? 'l' : 'p');
      doc.addImage(extra.images[i], 'JPEG', 0, 0, pageW * PT, pageH * PT);
      for (const r of extra.runs[i]) {
        const fs = Math.max(1, r.h * PT);
        doc.setFontSize(fs);
        doc.text(r.str, r.x * PT, r.y * PT + fs * 0.8, { renderingMode: 'invisible', baseline: 'alphabetic' });
      }
    }

    if (opts.toBytes) return doc.output('arraybuffer');
    // Test seam: the smoke test takes the bytes here — capturing the real doc.save()
    // download hangs in headless Chromium (docs/headless-testing.md).
    const sink =(window as { __edentextPdfSink?: (bytes: ArrayBuffer) => void }).__edentextPdfSink;
    if (sink) sink(doc.output('arraybuffer'));
    else doc.save((opts.fileName ?? deriveFilename(opts.json)).replace(/\.(odt|pdf)$/i, '') + '.pdf');
  } finally {
    cleanup();
  }
}

// Raster the document to A4 pages exactly as the editor renders them (tables, header/
// footer, band masks included) and open the browser's print dialog — print or "Save as
// PDF". Unlike the vector path it never re-paginates, so tables print intact.
export async function printRaster(opts: PdfOptions): Promise<void> {
  // scale 3 (~288 dpi) for print: near typical printer resolution, sharper on paper
  // than the download's scale-2 raster — at no cost for printing (no file is kept).
  const { images, pageW, pageH, cycle, scale, cleanup } = await renderPages(opts, 3);
  cleanup();
  const urls = images.map((b) => URL.createObjectURL(b));
  let imgs = urls;
  const comments = opts.printMarkup === false
    ? [] : withAnchorPages(printedComments(opts.source), opts.source, cycle);
  if (comments.length) imgs = imgs.concat((await renderCommentPages(opts, comments, pageW, pageH, scale)).images);

  const title = (opts.fileName ?? deriveFilename(opts.json)).replace(/\.(odt|pdf)$/i, '');
  // Explicit cm size (orientation baked into w/h) works for any format, unlike a CSS
  // size keyword. Explicit pt image dims pin each image to exactly one page.
  const dims = pageDimsCm(opts.pageFormat ?? 'A4', opts.orientation ?? 'portrait');
  const css = `
@page { size: ${dims.w}cm ${dims.h}cm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
img.pg { display: block; width: ${pageW * PT}pt; height: ${pageH * PT}pt; break-after: page; page-break-after: always; }
img.pg:last-child { break-after: auto; page-break-after: auto; }
`;
  const body = imgs.map((src) => `<img class="pg" src="${src}">`).join('');

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${css}</style></head><body>${body}</body></html>`,
  );
  idoc.close();

  const cleanupFrame = () => { iframe.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); };
  const run = async () => {
    // Decode the page images before printing, or the print output comes out blank.
    await Promise.all(Array.from(idoc.images).map((im) =>
      im.complete ? Promise.resolve() : new Promise((res) => { im.onload = im.onerror = () => res(null); })));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    iframe.contentWindow!.addEventListener('afterprint', cleanupFrame, { once: true });
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(cleanupFrame, 120000); // fallback if afterprint never fires
  };
  void run();
}

// Vector path: native browser print. Crisp, tiny, fonts embedded by the browser. It
// paginates natively (clean table breaks); headers/footers become CSS @page margin
// boxes (basic text + page numbers; rich inline formatting isn't expressible there).

export interface PrintPdfOptions {
  json: Json;
  fileName?: string; // document name (any extension); overrides the heading-derived name
  margins: PageMargins;
  orientation: Orientation;
  pageFormat?: PageFormat;
  headerDoc: HfDoc;
  footerDoc: HfDoc;
  // First-page overrides, rendered via @page :first.
  headerFirstDoc?: HfDoc;
  footerFirstDoc?: HfDoc;
  differentFirstPage?: boolean;
  // Even-page overrides, rendered via @page :left
  // (in an LTR document left pages are the even ones), which :first still overrides.
  headerEvenDoc?: HfDoc;
  footerEvenDoc?: HfDoc;
  differentOddEven?: boolean;
  /** Labels of the printed comment list; this module has no i18n of its own. */
  commentLabels?: CommentLabels;
  /** Whether the review markup prints at all (`storage/printMarkup`); default on. */
  printMarkup?: boolean;
  /** The display mode as `.paper` attributes (`storage/markup`): printed as seen. */
  markupAttrs?: string;
}

// First-row column weights from table JSON (honours colspan); mirrors tableView.
function weightsFromRow(row: Json): (number | null)[] {
  const w: (number | null)[] = [];
  for (const cell of row?.content ?? []) {
    const colspan: number = cell.attrs?.colspan ?? 1;
    const cw: number[] | null = cell.attrs?.colwidth ?? null;
    for (let j = 0; j < colspan; j++) w.push(cw && cw[j] ? cw[j] : null);
  }
  return w;
}

// A text box is an inline node carrying blocks, and no <p> can hold those: the parser
// breaks the paragraph open around it, so the text after the box would print as a
// paragraph of its own. Give each box a paragraph of its own first — the split then
// leaves the box a block between two whole paragraphs, which is how it prints.
export function hoistTextBoxes(json: Json): Json {
  const walk = (node: Json): Json => {
    if (!node?.content?.length) return node;
    const out: Json[] = [];
    for (const child of node.content) {
      const boxes = (child.content ?? []).filter((n: Json) => n.type === 'textBox');
      if (!boxes.length) { out.push(walk(child)); continue; }
      out.push({ ...child, content: child.content!.filter((n: Json) => n.type !== 'textBox') });
      for (const b of boxes) out.push({ type: 'paragraph', content: [b] });
    }
    return { ...node, content: out };
  };
  return walk(json);
}

// JSON → clean HTML, re-inserting the percentage <colgroup>s the table node view
// builds at runtime but generateHTML omits (matches the editor's column widths).
export function buildBodyHtml(json: Json): string {
  const host = document.createElement('div');
  host.innerHTML = generateHTML(hoistTextBoxes(json), extensions);
  // The two empty paragraphs the split above leaves around each box. A blank line the
  // reader wrote sits one further out, so immediate adjacency picks only the artifacts.
  for (const box of Array.from(host.querySelectorAll('div[data-textbox]'))) {
    for (const p of [box.previousElementSibling, box.nextElementSibling]) {
      if (p?.tagName === 'P' && !p.firstChild && !p.attributes.length) p.remove();
    }
  }
  const percents: number[][] = [];
  (function walk(n: Json) {
    if (!n) return;
    if (n.type === 'table') percents.push(columnPercents(weightsFromRow(n.content?.[0])));
    for (const c of n.content ?? []) walk(c);
  })(json);
  host.querySelectorAll('table').forEach((table, i) => {
    const cols = percents[i];
    if (!cols?.length) return;
    table.querySelector(':scope > colgroup')?.remove();
    const cg = document.createElement('colgroup');
    for (const p of cols) {
      const col = document.createElement('col');
      col.style.width = `${p}%`;
      cg.appendChild(col);
    }
    table.insertBefore(cg, table.firstChild);
  });
  // generateHTML omits ProseMirror's trailing <br>, so empty textblocks collapse to zero
  // height and blank lines vanish in print. Re-add a break so each keeps a line.
  host.querySelectorAll('p, h1, h2, h3, h4, h5').forEach((el) => {
    if (!el.firstChild) el.appendChild(document.createElement('br'));
  });
  return host.innerHTML;
}

function cssStr(t: string): string {
  return '"' + t.replace(/\\/g, '\\5c ').replace(/"/g, '\\22 ') + '"';
}

// HfDoc → a CSS `content` value + alignment, mapping page-field atoms to
// counter(page)/counter(pages); its text blocks, lists and cells included, follow one
// another as its line breaks do. Returns null for an empty zone.
// ponytail: text only — pictures, tables and frames reach print through the raster path;
// build them here once someone needs a letterhead in the vector PDF.
function hfContent(doc: HfDoc): { content: string; align: 'left' | 'center' | 'right' } | null {
  if (hfIsEmpty(doc)) return null;
  const blocks = ((doc as Json).content ?? []) as Json[];
  const ta = blocks.find((b) => b.type === 'paragraph' || b.type === 'heading')?.attrs?.textAlign;
  const align: 'left' | 'center' | 'right' = ta === 'center' || ta === 'right' ? ta : 'left';
  const parts: string[] = [];
  const walk = (n: Json): void => {
    if (n.type === 'paragraph' || n.type === 'heading') {
      if (parts.length) parts.push('"\\A0 "');
    } else if (n.type === 'text' && n.text) parts.push(cssStr(n.text));
    else if (n.type === 'pageNumber') parts.push('counter(page)');
    else if (n.type === 'pageCount') parts.push('counter(pages)');
    // Chrome's print engine has no named strings, so the chapter stays its cached name.
    else if (n.type === 'chapterField') parts.push(cssStr(String(n.attrs?.text ?? '')));
    else if (n.type === 'hardBreak') parts.push('"\\A0 "');
    for (const c of (n.content ?? []) as Json[]) walk(c);
  };
  blocks.forEach(walk);
  if (!parts.some((p) => p !== '"\\A0 "')) return null;
  return { content: parts.join(' '), align };
}

function boxName(edge: 'top' | 'bottom', align: 'left' | 'center' | 'right'): string {
  return `@${edge}-${align}`;
}
function filledBox(edge: 'top' | 'bottom', hf: { content: string; align: 'left' | 'center' | 'right' }): string {
  return `${boxName(edge, hf.align)} { content: ${hf.content}; font-family: var(--font-serif); font-size: 11pt; color: #000; }`;
}

function marginBoxes(headerDoc: HfDoc, footerDoc: HfDoc): string {
  const box = (edge: 'top' | 'bottom', doc: HfDoc): string => {
    const hf = hfContent(doc);
    return hf ? filledBox(edge, hf) : '';
  };
  return box('top', headerDoc) + '\n' + box('bottom', footerDoc);
}

// First-page @page :first boxes: set the first-page zone's box and clear the other
// alignment boxes on that edge, so page 1 fully overrides the default @page boxes
// (an empty first-page zone leaves the first page blank there).
function marginBoxesFirst(headerDoc: HfDoc, footerDoc: HfDoc): string {
  const edge = (e: 'top' | 'bottom', doc: HfDoc): string => {
    const hf = hfContent(doc);
    return (['left', 'center', 'right'] as const)
      .map((al) => (hf && hf.align === al ? filledBox(e, hf) : `${boxName(e, al)} { content: normal; }`))
      .join('\n');
  };
  return edge('top', headerDoc) + '\n' + edge('bottom', footerDoc);
}

function printCss(o: PrintPdfOptions, review: boolean): string {
  const m = o.margins;
  // Explicit cm size (orientation baked into w/h) works for any format, unlike a CSS
  // size keyword such as A4/letter.
  const d = pageDimsCm(o.pageFormat ?? 'A4', o.orientation);
  const size = `${d.w}cm ${d.h}cm`;
  // The margin bar has to be paid for: the print engine clips to the page area, so a
  // strip comes out of the left page margin and the text gets it back as padding —
  // which leaves the text column exactly where it was. Measured, not assumed.
  const strip = review ? Math.min(BAR_STRIP_CM, m.left) : 0;
  return `
@page {
  size: ${size};
  margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left - strip}cm;
  ${marginBoxes(o.headerDoc, o.footerDoc)}
}
${o.differentOddEven ? `@page :left {\n  ${marginBoxesFirst(o.headerEvenDoc ?? null, o.footerEvenDoc ?? null)}\n}` : ''}
${o.differentFirstPage ? `@page :first {\n  ${marginBoxesFirst(o.headerFirstDoc ?? null, o.footerFirstDoc ?? null)}\n}` : ''}
html, body { margin: 0; padding: 0; background: #fff; }
.paper { width: auto !important; padding-left: ${strip}cm !important; transform: none !important; box-shadow: none !important; background: #fff !important; }
.paper .tiptap { padding: 0 !important; min-height: 0 !important; background: none !important; box-shadow: none !important; color: #000 !important; }
${review ? reviewPrintCss() : ''}
/* generateHTML drops TipTap's .tableWrapper; mirror its (zero) margin. */
.paper .tiptap table { margin: 0; }
.paper .tiptap tr { break-inside: avoid; }
.paper .tiptap [data-color] { color: var(--font-color, currentColor) !important; }
/* Manual page break (breakBefore) → native page break; never on the first block (no blank leading page). */
.paper .tiptap > [data-page-break-before="page"] { break-before: page; }
.paper .tiptap > [data-page-break-before="page"]:first-child { break-before: auto; }
.column-resize-handle, .row-resize-handle, .is-editor-empty::before { display: none !important; }
`;
}

// The print page as one HTML string, for the browser's print dialog or Electron's printToPDF.
function printHtml(opts: PrintPdfOptions): { html: string; title: string } {
  const o: PrintPdfOptions = {
    json: opts.json,
    fileName: opts.fileName,
    margins: opts.margins ?? DEFAULT_MARGINS,
    orientation: opts.orientation ?? 'portrait',
    pageFormat: opts.pageFormat ?? 'A4',
    headerDoc: opts.headerDoc ?? null,
    footerDoc: opts.footerDoc ?? null,
    headerFirstDoc: opts.headerFirstDoc ?? null,
    footerFirstDoc: opts.footerFirstDoc ?? null,
    differentFirstPage: opts.differentFirstPage ?? false,
    headerEvenDoc: opts.headerEvenDoc ?? null,
    footerEvenDoc: opts.footerEvenDoc ?? null,
    differentOddEven: opts.differentOddEven ?? false,
    commentLabels: opts.commentLabels,
    printMarkup: opts.printMarkup,
    markupAttrs: opts.markupAttrs,
  };
  const title = (o.fileName ?? deriveFilename(o.json)).replace(/\.(odt|pdf)$/i, '');
  // The layers are Svelte DOM and generateHTML knows nothing of them, so this path
  // rebuilds the review markup from the marks the document itself carries.
  const host = document.createElement('div');
  host.innerHTML = buildBodyHtml(o.json);
  const markup = o.printMarkup !== false;
  const comments = markup ? printedComments(host) : [];
  const review = markup && markReviewBlocks(host);
  const list = comments.length ? commentListHtml(comments, o.commentLabels ?? DEFAULT_COMMENT_LABELS) : '';

  const html =
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${globalCss}\n${editorCss}\n${printCss(o, review)}</style></head>` +
    `<body><div class="paper"${o.markupAttrs ?? ''}><div class="tiptap">${host.innerHTML}</div>${list}</div></body></html>`;
  return { html, title };
}

// The desktop app renders the print page to a PDF file directly; a browser can only
// open its print dialog, where "Save as PDF" gives crisp vector text with fonts embedded.
export async function printPdf(opts: PrintPdfOptions): Promise<void> {
  const { html, title } = printHtml(opts);
  if (desktopPrintToPdf) {
    const bytes = await desktopPrintToPdf(html);
    const sink = (window as { __edentextPdfSink?: (bytes: ArrayBuffer) => void }).__edentextPdfSink;
    if (sink) sink(bytes.slice().buffer);
    else await saveDocument(bytes, title + '.pdf', 'pdf');
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(html);
  idoc.close();

  const cleanup = () => iframe.remove();
  const run = async () => {
    try { await idoc.fonts.ready; } catch { /* ignore */ }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    iframe.contentWindow!.addEventListener('afterprint', cleanup, { once: true });
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(cleanup, 120000); // fallback if afterprint never fires
  };
  void run();
}
