// PDF export that matches the editor exactly AND keeps selectable/searchable text.
//
// Why this shape: letting the browser re-render at print time drifts the text (true
// vector metrics ≠ on-screen hinted metrics), which broke the page-break band masks.
// Instead we RASTER the editor's own on-screen render (where content, big text, tables,
// page-break bands and headers/footers are already correct) and overlay an INVISIBLE
// text layer positioned from the same on-screen measurements — so the PDF looks like a
// screenshot of the editor but its text can still be selected and searched.

import { generateHTML } from '@tiptap/core';
import { PAGE_W_PORTRAIT, PAGE_H_PORTRAIT, type Orientation } from '../storage/pageOrientation';
import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
import { hfIsEmpty, type HfDoc } from '../storage/headerFooter';
import { extensions } from '../editor/extensions';
import { columnPercents } from '../editor/tableView';
import { deriveFilename } from './odt';
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
  numPages?: number;
}

type Run = { str: string; x: number; y: number; h: number }; // doc px, relative to .paper top-left

function pageDims(orientation: Orientation): { pageW: number; pageH: number } {
  const landscape = orientation === 'landscape';
  return {
    pageW: landscape ? PAGE_H_PORTRAIT : PAGE_W_PORTRAIT,
    pageH: landscape ? PAGE_W_PORTRAIT : PAGE_H_PORTRAIT,
  };
}

// Off-screen, scale-1, theme-neutral copy of the live .paper. Rendered identically to
// the editor (no print re-layout), so the raster + measured text positions agree.
function buildClone(paper: HTMLElement, pageW: number): { holder: HTMLElement; clone: HTMLElement; style: HTMLStyleElement } {
  const clone = paper.cloneNode(true) as HTMLElement;
  clone.style.transform = 'none';
  clone.style.width = `${pageW}px`; // pin width so capture geometry can't drift on var inheritance
  clone.classList.remove('show-formatting-marks', 'hf-editing');

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
[data-pdf-export] .paper .tiptap { background:#fff !important; }
[data-pdf-export] .column-resize-handle, [data-pdf-export] .row-resize-handle { display:none !important; }
[data-pdf-export] .selectedCell::after { display:none !important; }
[data-pdf-export] .tiptap .is-editor-empty::before { content:none !important; }
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

// Render the document to A4 pages (raster + invisible text) and download the PDF.
export async function exportPdf(opts: PdfOptions): Promise<void> {
  const paper = opts.source.closest('.paper') as HTMLElement | null;
  if (!paper) throw new Error('paper element not found');
  const orientation: Orientation = opts.orientation ?? 'portrait';
  const { pageW, pageH } = pageDims(orientation);
  const cycle = pageH + PAGE_GAP;

  const { holder, clone, style } = buildClone(paper, pageW);
  document.head.appendChild(style);
  document.body.appendChild(holder);

  try {
    await document.fonts.ready;
    const pages = Math.max(1, opts.numPages ?? Math.round((clone.offsetHeight + PAGE_GAP) / cycle));
    const runs = collectRuns(clone);

    const SCALE = 2;
    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(clone, {
      scale: SCALE,
      backgroundColor: '#ffffff',
      width: pageW,
      height: pages * cycle,
      windowWidth: pageW,
      logging: false,
    });

    const { jsPDF } = await import('jspdf');
    const fmt: [number, number] = [pageW * PT, pageH * PT];
    // compress: Flate the streams (e.g. the text layer); page images are JPEG below.
    const doc = new jsPDF({ unit: 'pt', format: fmt, orientation: orientation === 'landscape' ? 'l' : 'p', compress: true });

    const tmp = document.createElement('canvas');
    tmp.width = Math.round(pageW * SCALE);
    tmp.height = Math.round(pageH * SCALE);
    const ctx = tmp.getContext('2d')!;

    for (let i = 0; i < pages; i++) {
      if (i > 0) doc.addPage(fmt, orientation === 'landscape' ? 'l' : 'p');

      // Crop this page's surface [i*cycle, i*cycle+pageH] out of the full capture.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tmp.width, tmp.height);
      ctx.drawImage(canvas, 0, i * cycle * SCALE, pageW * SCALE, pageH * SCALE, 0, 0, pageW * SCALE, pageH * SCALE);
      // JPEG (DCTDecode) keeps the file small; q0.92 @2× scale stays visually crisp.
      doc.addImage(tmp.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW * PT, pageH * PT);

      // Invisible selectable text for this page.
      const top = i * cycle, bottom = i * cycle + pageH;
      for (const r of runs) {
        if (r.y < top || r.y >= bottom - 1) continue;
        const fs = Math.max(1, r.h * PT);
        doc.setFontSize(fs);
        doc.text(r.str, r.x * PT, (r.y - top) * PT + fs * 0.8, { renderingMode: 'invisible', baseline: 'alphabetic' });
      }
    }

    doc.save((opts.fileName ?? deriveFilename(opts.json)).replace(/\.(odt|pdf)$/i, '') + '.pdf');
  } finally {
    holder.remove();
    style.remove();
  }
}

// ---------------------------------------------------------------------------
// Vector path: native browser print. Crisp, tiny, fonts embedded by the browser
// (incl. system fonts). The browser paginates natively (breaks tables cleanly),
// and headers/footers are emitted as CSS @page margin boxes (basic text + page
// numbers; rich inline formatting isn't expressible there).
// ---------------------------------------------------------------------------

export interface PrintPdfOptions {
  json: Json;
  fileName?: string; // document name (any extension); overrides the heading-derived name
  margins: PageMargins;
  orientation: Orientation;
  headerDoc: HfDoc;
  footerDoc: HfDoc;
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

// JSON → clean HTML, re-inserting the percentage <colgroup>s the table node view
// builds at runtime but generateHTML omits (matches the editor's column widths).
function buildBodyHtml(json: Json): string {
  const host = document.createElement('div');
  host.innerHTML = generateHTML(json, extensions);
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
  return host.innerHTML;
}

function cssStr(t: string): string {
  return '"' + t.replace(/\\/g, '\\5c ').replace(/"/g, '\\22 ') + '"';
}

// HfDoc (single paragraph) → a CSS `content` value + alignment, mapping page-field
// atoms to counter(page)/counter(pages). Returns null for an empty zone.
function hfContent(doc: HfDoc): { content: string; align: 'left' | 'center' | 'right' } | null {
  if (hfIsEmpty(doc)) return null;
  const para = (doc as Json).content?.[0] as Json;
  const ta = para?.attrs?.textAlign;
  const align: 'left' | 'center' | 'right' = ta === 'center' || ta === 'right' ? ta : 'left';
  const parts: string[] = [];
  for (const n of para?.content ?? []) {
    if (n.type === 'text' && n.text) parts.push(cssStr(n.text));
    else if (n.type === 'pageNumber') parts.push('counter(page)');
    else if (n.type === 'pageCount') parts.push('counter(pages)');
    else if (n.type === 'hardBreak') parts.push('"\\A0 "');
  }
  if (!parts.length) return null;
  return { content: parts.join(' '), align };
}

function marginBoxes(headerDoc: HfDoc, footerDoc: HfDoc): string {
  const box = (edge: 'top' | 'bottom', doc: HfDoc): string => {
    const hf = hfContent(doc);
    if (!hf) return '';
    const name = `@${edge}-${hf.align === 'left' ? 'left' : hf.align === 'right' ? 'right' : 'center'}`;
    return `${name} { content: ${hf.content}; font-family: var(--font-serif); font-size: 11pt; color: #000; }`;
  };
  return box('top', headerDoc) + '\n' + box('bottom', footerDoc);
}

function printCss(o: PrintPdfOptions): string {
  const m = o.margins;
  const size = o.orientation === 'landscape' ? 'A4 landscape' : 'A4 portrait';
  return `
@page {
  size: ${size};
  margin: ${m.top}cm ${m.right}cm ${m.bottom}cm ${m.left}cm;
  ${marginBoxes(o.headerDoc, o.footerDoc)}
}
html, body { margin: 0; padding: 0; background: #fff; }
.paper { width: auto !important; transform: none !important; box-shadow: none !important; background: none !important; }
.paper .tiptap { padding: 0 !important; min-height: 0 !important; background: #fff !important; box-shadow: none !important; color: #000 !important; }
/* generateHTML drops TipTap's .tableWrapper, whose margin gives a table its bottom gap. */
.paper .tiptap table { margin: 0 0 0.212cm; }
.paper .tiptap tr { break-inside: avoid; }
.paper .tiptap [data-color] { color: var(--font-color, currentColor) !important; }
.column-resize-handle, .row-resize-handle, .is-editor-empty::before { display: none !important; }
`;
}

// Build the document in a hidden iframe and invoke the browser's print → "Save as
// PDF", which produces crisp vector text with the fonts embedded.
export function printPdf(opts: PrintPdfOptions): void {
  const o: PrintPdfOptions = {
    json: opts.json,
    fileName: opts.fileName,
    margins: opts.margins ?? DEFAULT_MARGINS,
    orientation: opts.orientation ?? 'portrait',
    headerDoc: opts.headerDoc ?? null,
    footerDoc: opts.footerDoc ?? null,
  };
  const title = (o.fileName ?? deriveFilename(o.json)).replace(/\.(odt|pdf)$/i, '');
  const body = buildBodyHtml(o.json);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;';
  document.body.appendChild(iframe);

  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(
    `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${globalCss}\n${editorCss}\n${printCss(o)}</style></head>` +
    `<body><div class="paper"><div class="tiptap">${body}</div></div></body></html>`,
  );
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
