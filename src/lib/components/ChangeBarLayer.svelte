<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { cmToPx, type PageMargins } from '../storage/pageMargins';
  import { commentIdAt } from '../editor/extensions/comment';
  import { revisionIdAt, authorColorIndex, REVISION_AUTHOR_COLORS } from '../editor/extensions/trackChanges';
  import { visibleCommentRanges, visibleRevisions } from './reviewItems';
  import { markupView } from '../storage/markup.svelte';

  // The changed-lines bar both word processors draw in the margin: a stroke beside every
  // line a recorded change or a comment covers, so a pane entry can be found in the text.
  // The one the caret sits in is drawn heavier.
  let { editor, tick, pageBoxes, pageMargins }: {
    editor: Editor | null;
    tick: number;
    /** One box per page (Editor.svelte): a section on its own paper differs in size. */
    pageBoxes: { top: number; left: number; height: number; width: number }[];
    pageMargins: PageMargins;
  } = $props();

  // Between the text edge and the bar — inside the line numbers, which sit further out.
  const GAP_CM = 0.2;
  const COMMENT_COLOR = 'rgba(200, 140, 0, 0.7)';

  type Bar = { top: number; height: number; left: number; color: string; active: boolean };

  let bars = $state<Bar[]>([]);
  let host = $state<HTMLElement | null>(null);
  let paper: HTMLElement | null = null;
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; measure(); });
  };

  $effect(() => {
    // Re-measure on every edit, every selection move, each pagination settle — and when
    // the display mode takes a kind off the page or brings it back.
    void tick;
    void pageBoxes;
    void pageMargins;
    void markupView();
    schedule();
  });

  $effect(() => {
    const el = host;
    if (!el) return;
    paper = el.closest('.paper') as HTMLElement | null;
    paper?.addEventListener('pm-pagecount', schedule);
    return () => paper?.removeEventListener('pm-pagecount', schedule);
  });

  // Every marked range with the colour its bar takes: a revision in its author's colour,
  // a comment in the comment amber. A resolved comment is handled and gets none.
  function marked(state: Editor['state']): { from: number; to: number; color: string; active: boolean }[] {
    const revs = visibleRevisions(state.doc);
    const order = authorColorIndex(revs);
    const activeRev = revisionIdAt(state, revs);
    const comments = visibleCommentRanges(state.doc);
    const activeComment = commentIdAt(state, comments);
    return [
      ...revs.map((r) => ({
        from: r.from, to: r.to,
        color: REVISION_AUTHOR_COLORS[order.get(r.author) ?? 0],
        active: r.id === activeRev,
      })),
      ...comments.filter((c) => !c.resolved).map((c) => ({
        from: c.from, to: c.to, color: COMMENT_COLOR, active: c.id === activeComment,
      })),
    ];
  }

  function measure(): void {
    const view = editor?.view;
    if (!view || !host?.isConnected) { bars = []; return; }
    const ranges = marked(view.state);
    if (!ranges.length) { bars = []; return; }
    const dom = view.dom as HTMLElement;
    const rect = dom.getBoundingClientRect();
    // Client rects are in zoom-scaled screen space; page boxes and this layer's own
    // coordinates are unscaled document px, so divide the scale back out.
    const scale = dom.offsetWidth ? rect.width / dom.offsetWidth : 1;
    const origin = rect.top;
    const out: Bar[] = [];
    for (const r of ranges) {
      let top: number;
      let bottom: number;
      try {
        const a = view.coordsAtPos(r.from);
        const b = view.coordsAtPos(r.to, -1);
        top = (Math.min(a.top, b.top) - origin) / scale;
        bottom = (Math.max(a.bottom, b.bottom) - origin) / scale;
      } catch { continue; }
      // A range crossing a page break must not stroke through the gap or the margins:
      // clipped to each page's text area, it draws one segment per page it covers.
      for (const box of pageBoxes) {
        const t = Math.max(top, box.top + cmToPx(pageMargins.top));
        const b = Math.min(bottom, box.top + box.height - cmToPx(pageMargins.bottom));
        if (b - t < 1) continue;
        out.push({
          top: t, height: b - t,
          left: box.left + cmToPx(pageMargins.left) - cmToPx(GAP_CM),
          color: r.color, active: r.active,
        });
      }
    }
    // Two changes on one line stack at the same spot; the active one draws last, or its
    // heavier stroke would sit under a neighbour's.
    out.sort((a, b) => Number(a.active) - Number(b.active));
    bars = out;
  }
</script>

<div class="change-bar-layer" bind:this={host} aria-hidden="true">
  {#each bars as b}
    <div
      class="change-bar"
      class:active={b.active}
      style="top: {b.top}px; height: {b.height}px; left: {b.left}px; background: {b.color};"
    ></div>
  {/each}
</div>

<style>
  /* A sibling of .band-layer inside the scaled .paper, so a top measured against
     .tiptap is the top it draws at. */
  .change-bar-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .change-bar {
    position: absolute;
    width: 2px;
    border-radius: 1px;
    opacity: 0.7;
  }

  .change-bar.active {
    width: 3px;
    opacity: 1;
  }
</style>
