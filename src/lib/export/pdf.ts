// PDF export that matches the editor exactly AND keeps selectable/searchable text.
//
// Why this shape: letting the browser re-render at print time drifts the text (true
// vector metrics ≠ on-screen hinted metrics), which broke the page-break band masks.
// Instead we RASTER the editor's own on-screen render (where content, big text, tables,
// page-break bands and headers/footers are already correct) and overlay an INVISIBLE
// text layer positioned from the same on-screen measurements — so the PDF looks like a
// screenshot of the editor but its text can still be selected and searched.

import { PAGE_W_PORTRAIT, PAGE_H_PORTRAIT, type Orientation } from '../storage/pageOrientation';
import { deriveFilename } from './odt';

const PAGE_GAP = 20; // must match pageBreaks.ts / editor.css --page-gap
const PT = 72 / 96;  // CSS px @96dpi → PDF points

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

export interface PdfOptions {
  source: HTMLElement; // the live `.tiptap` element (editor.view.dom)
  json: Json;          // for the suggested filename
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
    const doc = new jsPDF({ unit: 'pt', format: fmt, orientation: orientation === 'landscape' ? 'l' : 'p' });

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
      doc.addImage(tmp.toDataURL('image/png'), 'PNG', 0, 0, pageW * PT, pageH * PT);

      // Invisible selectable text for this page.
      const top = i * cycle, bottom = i * cycle + pageH;
      for (const r of runs) {
        if (r.y < top || r.y >= bottom - 1) continue;
        const fs = Math.max(1, r.h * PT);
        doc.setFontSize(fs);
        doc.text(r.str, r.x * PT, (r.y - top) * PT + fs * 0.8, { renderingMode: 'invisible', baseline: 'alphabetic' });
      }
    }

    doc.save(deriveFilename(opts.json).replace(/\.odt$/i, '') + '.pdf');
  } finally {
    holder.remove();
    style.remove();
  }
}
