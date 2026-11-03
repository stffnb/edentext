<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { commentIdAt } from '../editor/extensions/comment';
  import { revisionIdAt } from '../editor/extensions/trackChanges';
  import { authorColor, authorColors } from '../editor/authorColors';
  import { visibleCommentRanges, visibleRevisions } from './reviewItems';
  import { markupView } from '../storage/markup.svelte';
  import { paneLayout } from '../storage/panes.svelte';

  // The dashed leader both word processors draw from an annotated range to its balloon,
  // here from the text to the reviewing pane's card. Only for the one the caret sits in:
  // a line per comment would cross the whole page, and one is what pairs card and text.
  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  let lines = $state<{ points: string; color: string }[]>([]);
  let host = $state<HTMLElement | null>(null);
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; measure(); });
  };

  // Deferred to the frame, so the pane's own card class and scroll are in the DOM.
  $effect(() => {
    void tick;
    void markupView();
    // A pane moved to the other side leaves the row's size as it was.
    void paneLayout('comments').side;
    void paneLayout('revisions').side;
    schedule();
  });

  $effect(() => {
    const el = host;
    if (!el) return;
    // Every scroller moves an endpoint: the page's, the pane's own, the window's. A pane
    // opening or closing only resizes the row, which is what the observer catches.
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
    };
  });

  function measure(): void {
    const view = editor?.view;
    const el = host;
    if (!view || !el?.isConnected) { lines = []; return; }
    const box = el.getBoundingClientRect();
    const clip = (view.dom as HTMLElement).closest('.editor')?.getBoundingClientRect();
    const out: { points: string; color: string }[] = [];

    // A stub from the anchor out to the pane, then a diagonal onto the card's head —
    // the shape Word gives a balloon leader.
    const add = (pos: number, card: Element | null, color: string) => {
      if (!card) return;
      let c: { top: number; bottom: number; left: number };
      try { c = view.coordsAtPos(pos, -1); } catch { return; }
      // An anchor scrolled out of the page view has nothing left to point at.
      if (clip && (c.bottom < clip.top || c.top > clip.bottom || c.left < clip.left || c.left > clip.right)) return;
      const r = card.getBoundingClientRect();
      const ax = c.left - box.left;
      // The bottom of the line box: the leader runs through the gap between two lines,
      // where it crosses no letters, as both word processors draw it.
      const ay = c.bottom - box.top;
      // A pane docked left takes the leader at its card's right edge, mirrored.
      const toLeft = r.right - box.left <= ax;
      const cx = (toLeft ? r.right : r.left) - box.left;
      const cy = r.top - box.top + Math.min(14, r.height / 2);
      if (!toLeft && cx <= ax) return;
      // A leader may not run across another pane's cards. With a second pane docked in
      // between, the card is still marked and the margin bar still names the line.
      const own = card.closest('aside');
      for (const pane of el.parentElement?.querySelectorAll('aside') ?? []) {
        const p = pane.getBoundingClientRect();
        const edge = (toLeft ? p.right : p.left) - box.left;
        if (pane !== own && edge > Math.min(ax, cx) && edge < Math.max(ax, cx)) return;
      }
      const knee = toLeft ? Math.min(ax - 8, cx + 24) : Math.max(ax + 8, cx - 24);
      out.push({ points: `${ax},${ay} ${knee},${ay} ${cx},${cy}`, color });
    };

    const state = view.state;
    const colors = authorColors(state.doc);
    const ranges = visibleCommentRanges(state.doc);
    const cid = commentIdAt(state, ranges);
    if (cid) {
      // The last range of the comment: its end is the anchor both products point from.
      const range = ranges.filter((c) => c.id === cid).pop();
      if (range) add(range.to, document.querySelector('.comments-pane li.active'), authorColor(colors, range.author));
    }
    const list = visibleRevisions(state.doc);
    const rid = revisionIdAt(state, list);
    if (rid) {
      const range = list.filter((r) => r.id === rid).pop();
      if (range) {
        add(range.to, document.querySelector('.revisions-pane li.active'),
          authorColor(colors, range.author));
      }
    }
    lines = out;
  }
</script>

<div class="connector-layer" bind:this={host} aria-hidden="true">
  {#if lines.length}
    <svg>
      {#each lines as l}
        <polyline points={l.points} fill="none" stroke={l.color} stroke-width="1" stroke-dasharray="3 3" />
      {/each}
    </svg>
  {/if}
</div>

<style>
  /* Spans the scroller and the panes both, so one line reaches across; clipped at the
     row, or it would draw over the toolbar. */
  .connector-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 5;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
