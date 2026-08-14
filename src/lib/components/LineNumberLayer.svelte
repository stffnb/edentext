<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { cmToPx, PX_PER_CM, type PageMargins } from '../storage/pageMargins';
  import { pageDimsCm, type PageFormat } from '../storage/pageFormat';
  import type { Orientation } from '../storage/pageOrientation';
  import type { LineNumbering } from '../storage/lineNumbering';

  // Numbers in the left margin, one per rendered line. CSS exposes no line boxes, so
  // every line has to be measured: a Range over each block yields one client rect per
  // run per line, and the distinct tops are the lines.
  //
  // ponytail: measures every block in the document on each settle. Fine while numbering
  // is on and the document is ordinary; a 400-page one would want a windowed pass keyed
  // to a running count per page.
  let { editor, tick, lineNumbering, numPages, pageMargins, pageFormat, orientation }: {
    editor: Editor | null;
    tick: number;
    lineNumbering: LineNumbering;
    numPages: number;
    pageMargins: PageMargins;
    pageFormat: PageFormat;
    orientation: Orientation;
  } = $props();

  const PAGE_GAP = 20;

  let cycle = $derived(pageDimsCm(pageFormat, orientation).h * PX_PER_CM + PAGE_GAP);
  let left = $derived(cmToPx(pageMargins.left) - cmToPx(lineNumbering.distanceCm));

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
    void numPages;
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

  // The tops of the lines a block renders, in document px relative to .tiptap.
  function lineTops(block: Element, origin: number): { top: number; height: number }[] {
    const range = document.createRange();
    range.selectNodeContents(block);
    const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
    if (!rects.length) {
      const r = block.getBoundingClientRect();
      return r.height > 0 ? [{ top: r.top - origin, height: r.height }] : [];
    }
    // One rect per run per line; the distinct tops are the lines.
    const byTop = new Map<number, { top: number; height: number }>();
    for (const r of rects) {
      const key = Math.round(r.top);
      const seen = byTop.get(key);
      if (!seen || r.height > seen.height) byTop.set(key, { top: r.top - origin, height: r.height });
    }
    return [...byTop.values()].sort((a, b) => a.top - b.top);
  }

  function measure(): void {
    const view = editor?.view;
    if (!view || !lineNumbering.on || !host?.isConnected) { marks = []; return; }
    const origin = view.dom.getBoundingClientRect().top;
    const out: { top: number; label: string }[] = [];
    let count = 0;
    let page = 1;
    for (const block of Array.from(view.dom.children)) {
      // A table, an image frame or an index is not a numbered line in either word
      // processor; only text blocks count.
      if (!/^(P|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE)$/.test(block.tagName)) continue;
      const empty = !block.textContent?.trim();
      for (const line of lineTops(block, origin)) {
        const linePage = Math.max(1, Math.floor(line.top / cycle) + 1);
        if (lineNumbering.restart === 'page' && linePage !== page) { page = linePage; count = 0; }
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
    <span class="line-number" style="top: {m.top}px; right: calc(100% - {left}px);">{m.label}</span>
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
