<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { cmToPx, type PageMargins } from '../storage/pageMargins';
  import type { LineNumbering } from '../storage/lineNumbering';

  // Numbers in the left margin, one per rendered line. CSS exposes no line boxes, so
  // every line has to be measured: a Range over each block yields one client rect per
  // run per line, and rects merged by vertical overlap are the lines.
  //
  // ponytail: measures every block in the document on each settle. Fine while numbering
  // is on and the document is ordinary; a 400-page one would want a windowed pass keyed
  // to a running count per page.
  let { editor, tick, lineNumbering, pageBoxes, pageMargins }: {
    editor: Editor | null;
    tick: number;
    lineNumbering: LineNumbering;
    /** One box per page (Editor.svelte): a section on its own paper differs in size. */
    pageBoxes: { top: number; left: number; height: number; width: number }[];
    pageMargins: PageMargins;
  } = $props();

  // The page a document-px top falls on, against boxes that may differ in height.
  const pageAt = (top: number) => {
    for (let i = pageBoxes.length - 1; i >= 0; i--) if (top >= pageBoxes[i].top) return i + 1;
    return 1;
  };
  // Measured from the page's own left edge: a narrower section's page is centred.
  const leftOf = (top: number) => (pageBoxes[pageAt(top) - 1]?.left ?? 0)
    + cmToPx(pageMargins.left) - cmToPx(lineNumbering.distanceCm);

  let marks = $state<{ top: number; label: string }[]>([]);
  let host = $state<HTMLElement | null>(null);
  let paper: HTMLElement | null = null;
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; measure(); });
  };

  $effect(() => {
    // Re-measure on every edit and on each pagination settle.
    void tick;
    void lineNumbering;
    void pageBoxes;
    if (!lineNumbering.on) { marks = []; return; }
    schedule();
  });

  $effect(() => {
    const el = host;
    if (!el) return;
    paper = el.closest('.paper') as HTMLElement | null;
    paper?.addEventListener('pm-pagecount', schedule);
    return () => paper?.removeEventListener('pm-pagecount', schedule);
  });

  // The tops of the lines a block renders, in document px relative to .tiptap. Client
  // rects are in zoom-scaled screen space; `scale` converts back to document px.
  function lineTops(block: Element, origin: number, scale: number): { top: number; height: number }[] {
    const range = document.createRange();
    range.selectNodeContents(block);
    let rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    // A frame is no text line of its paragraph: a floated one's band would count as an
    // extra line, an in-line one's box as a second line beside the text it shares.
    // A paragraph left with no rect at all falls back to its own box — one line.
    const frames = block.querySelectorAll('.image-node[data-wrap], .textbox-node');
    if (frames.length) {
      const fr = Array.from(frames, (f) => f.getBoundingClientRect());
      rects = rects.filter((r) => !fr.some((f) =>
        r.top >= f.top - 1 && r.bottom <= f.bottom + 1 && r.left >= f.left - 1 && r.right <= f.right + 1));
    }
    if (!rects.length) {
      const r = block.getBoundingClientRect();
      return r.height > 0 ? [{ top: (r.top - origin) / scale, height: r.height / scale }] : [];
    }
    // One rect per run per line. A run shifted off the baseline (super/subscript, a
    // formula, a rotated char) still overlaps its line's span, so rects merge into one
    // line while a rect mostly below the span (even at squeezed spacing) opens the next.
    const lines: { top: number; bottom: number }[] = [];
    for (const r of rects.slice().sort((a, b) => a.top - b.top)) {
      const cur = lines[lines.length - 1];
      const overlap = cur ? Math.min(cur.bottom, r.bottom) - Math.max(cur.top, r.top) : 0;
      if (cur && overlap > Math.min(cur.bottom - cur.top, r.height) / 2) {
        cur.top = Math.min(cur.top, r.top);
        cur.bottom = Math.max(cur.bottom, r.bottom);
      } else {
        lines.push({ top: r.top, bottom: r.bottom });
      }
    }
    return lines.map((l) => ({ top: (l.top - origin) / scale, height: (l.bottom - l.top) / scale }));
  }

  function measure(): void {
    const view = editor?.view;
    if (!view || !lineNumbering.on || !host?.isConnected) { marks = []; return; }
    const dom = view.dom as HTMLElement;
    const rect = dom.getBoundingClientRect();
    // The zoom transform scales every measured rect; page boxes and the layer's own
    // coordinates are unscaled document px, so divide the scale back out.
    const scale = dom.offsetWidth ? rect.width / dom.offsetWidth : 1;
    const origin = rect.top;
    const out: { top: number; label: string }[] = [];
    let count = 0;
    let page = 1;
    // Text blocks count — list items and column lines too, as in both word processors;
    // a table, a frame or an index is not a numbered line in either. A text box rides a
    // paragraph, and that paragraph's own line is what counts.
    const blocks = view.dom.querySelectorAll(
      ':scope > :is(p, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10, blockquote),'
      + ' :scope > :is(ul, ol) li > p,'
      + ' :scope > .columns-node :is(p, h1, h2, h3, h4, h5, h6, h7, h8, h9, h10)');
    for (const block of Array.from(blocks)) {
      if (block.closest('table')) continue;
      const empty = !block.textContent?.trim();
      const lines = lineTops(block, origin, scale);
      for (const line of lines) {
        const linePage = pageAt(line.top);
        if (lineNumbering.restart === 'page' && linePage !== page) { page = linePage; count = 0; }
        // A trailing block pushed past the page surface (into the gap) is no line of
        // either page; numbering it would print into the gap.
        const box = pageBoxes[linePage - 1];
        if (box && line.top > box.top + box.height) continue;
        if (empty && !lineNumbering.countEmpty) continue;
        count += 1;
        if (count % lineNumbering.interval === 0) {
          out.push({ top: line.top + line.height / 2, label: String(count) });
        }
      }
    }
    marks = out;
  }
</script>

<div class="line-number-layer" bind:this={host} aria-hidden="true">
  {#each marks as m}
    <span class="line-number" style="top: {m.top}px; right: calc(100% - {leftOf(m.top)}px);">{m.label}</span>
  {/each}
</div>

<style>
  /* A sibling of .band-layer inside the scaled .paper, so a top measured against
     .tiptap is the top it draws at; the numbers hang into the left margin. */
  .line-number-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .line-number {
    position: absolute;
    transform: translateY(-50%);
    font-family: var(--font-serif);
    font-size: 10pt;
    line-height: 1;
    color: var(--color-page-text);
    white-space: nowrap;
  }
</style>
