<script lang="ts" module>
  // Page edge → balloon, and the balloon itself: the strip Editor.svelte reserves beside
  // the page for this layer.
  export const BALLOON_GAP_CM = 0.5;
  // Wide enough that author, date and time share one line, as they do in the balloon
  // both word processors draw — roughly a third of the page, which is Word's own strip.
  export const BALLOON_W_CM = 6.5;
  export const REVIEW_MARGIN_CM = BALLOON_GAP_CM + BALLOON_W_CM;
</script>

<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { EditorView } from '@tiptap/pm/view';
  import { untrack } from 'svelte';
  import { cmToPx } from '../storage/pageMargins';
  import { commentDraft, commentIdAt, type CommentDraft, type CommentRange } from '../editor/extensions/comment';
  import { revisionIdAt, type Revision } from '../editor/extensions/trackChanges';
  import { authorColor, authorColors } from '../editor/authorColors';
  import { selectRange, visibleComments, visibleRevisions } from './reviewItems';
  import { changesInMargin, commentsInMargin, showResolved } from '../storage/markup.svelte';
  import { deckAround, deckHeights, stackTops } from '../utils/balloonStack';
  import CommentCard from './CommentCard.svelte';
  import CommentComposer from './CommentComposer.svelte';
  import RevisionCard from './RevisionCard.svelte';

  // The margin balloons both word processors draw beside the page: one card per comment
  // and per recorded change, at the height of the line it belongs to, with a dashed
  // leader to it. It sits OUTSIDE .paper — that box clips horizontally and its width is
  // the one pagination measures — but carries the same scale, so it zooms with the page.
  let { editor, tick, pageBoxes, paperWidth, zoom, author, activePane = true }: {
    editor: Editor | null;
    tick: number;
    /** One box per page (Editor.svelte): a section on its own paper differs in size. */
    pageBoxes: { top: number; left: number; height: number; width: number }[];
    paperWidth: number;
    zoom: number;
    author: string;
    /** Whether this is the split pane in use. */
    activePane?: boolean;
  } = $props();

  const STACK_GAP_PX = 8;
  // What a covered card in a deck still shows: its head, colour bar, author and time.
  const PEEK_PX = 24;

  type Balloon = {
    key: string;
    color: string;
    active: boolean;
    /** The page its line is on: its card stacks in that page's band, beside it. */
    page: number;
    /** Where its line is, and where the leader leaves the text. */
    want: number;
    anchorX: number;
    anchorY: number;
    left: number;
    comment?: CommentRange;
    draft?: CommentDraft;
    revision?: Revision;
  };

  let balloons = $state<Balloon[]>([]);
  let colors = $state(new Map<string, string>());
  let heights = $state<number[]>([]);
  let placed = $state(new Set<string>());
  // A clicked card and where every card was: the view scrolls by as much as it moves.
  let hold: { key: string; top: number; from: Map<string, number> } | null = null;
  // While that scroll runs, each card glides from where it was on the same curve.
  let glide = $state<{ from: Map<string, number>; p: number } | null>(null);
  let glideFrame = 0;
  const GLIDE_MS = 300;
  let host = $state<HTMLElement | null>(null);
  let els: (HTMLElement | null)[] = [];
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; measure(); });
  };

  $effect(() => {
    // Re-measure on every edit, every selection move, each pagination settle — and when
    // a kind moves out of the margin or back into it.
    void tick;
    void pageBoxes;
    void zoom;
    void commentsInMargin();
    void changesInMargin();
    void showResolved();
    schedule();
  });

  $effect(() => {
    const el = host;
    if (!el) return;
    const scaler = el.parentElement;
    scaler?.addEventListener('pm-pagecount', schedule);
    return () => scaler?.removeEventListener('pm-pagecount', schedule);
  });

  // A card's height is its content's, and editing one changes it — so it is measured,
  // not computed, and the stack follows.
  $effect(() => {
    const list = balloons;
    const read = () => els.slice(0, list.length).map((e) => e?.offsetHeight ?? 0);
    const ro = new ResizeObserver(() => { heights = read(); });
    for (const e of els.slice(0, list.length)) if (e) ro.observe(e);
    untrack(() => { heights = read(); });
    // A new card appears where its measured height puts it; only later moves glide, since
    // one from the unmeasured stack would cross the cards around it.
    const keys = list.map((b) => b.key);
    requestAnimationFrame(() => { placed = new Set(keys); });
    return () => ro.disconnect();
  });

  // One entry per page, in page order: the cards beside a page stack among themselves.
  let groups = $derived.by(() => {
    const by = new Map<number, number[]>();
    balloons.forEach((b, i) => {
      const g = by.get(b.page);
      if (g) g.push(i);
      else by.set(b.page, [i]);
    });
    return [...by.entries()].map(([page, idx]) => ({ box: pageBoxes[page], idx }));
  });

  // Stacked inside the page band: a card pushed down by the ones above it stops at the
  // sheet's bottom edge. A column too long for its page becomes a deck, each card covering
  // the one before it down to its head; the active card lies whole at its line among them.
  let stack = $derived.by(() => {
    const out = new Array<number>(balloons.length).fill(0);
    const reach = balloons.map((_, i) => heights[i] ?? 0);
    let floor = -Infinity;
    for (const { box, idx } of groups) {
      const h = idx.map((i) => heights[i] ?? 0);
      const k = idx.findIndex((i) => balloons[i].active);
      const pin = k < 0 ? undefined : k;
      const bandTop = Math.max(box ? box.top : -Infinity, floor);
      const bandBottom = box ? box.top + box.height : Infinity;
      const want = idx.map((i) => balloons[i].want);
      const least = PEEK_PX - STACK_GAP_PX;
      const deck = pin === undefined
        ? deckHeights(h, STACK_GAP_PX, bandBottom - bandTop, least)
        : deckAround(want, h, STACK_GAP_PX, bandTop, bandBottom, least, pin);
      const got = stackTops(want, deck, STACK_GAP_PX, bandTop, bandBottom, pin);
      const last = got.length - 1;
      if (last >= 0) floor = got[last] + h[last] + STACK_GAP_PX;
      idx.forEach((i, j) => { out[i] = got[j]; });
      idx.forEach((i, j) => { if (j < last) reach[i] = Math.min(h[j], got[j + 1] - got[j]); });
    }
    return { tops: out, reach };
  });
  let tops = $derived(stack.tops);
  // The card the pointer reads: by the strips the deck shows, so a lifted card never hides
  // the heads below it from the pointer moving down the deck.
  let hovered = $state<string | null>(null);

  // Where each card's `top` stands while a click's scroll glides the stack.
  let shown = $derived(glide
    ? tops.map((t, i) => { const was = glide!.from.get(balloons[i]?.key) ?? t; return t + (was - t) * (1 - glide!.p); })
    : tops);

  // A clicked card stays under the pointer: once the stack has moved it to its line, the
  // view scrolls smoothly by the same amount and the cards glide on the same curve, so
  // its text slides up beside it.
  $effect(() => {
    const t = tops;
    if (!hold) return;
    const i = balloons.findIndex((b) => b.key === hold?.key);
    if (i < 0 || !balloons[i].active) return;
    const delta = ((t[i] - hold.top) * zoom) / 100;
    const from = hold.from;
    hold = null;
    const scroller = host?.closest('.editor');
    if (!scroller || Math.abs(delta) < 0.5) return;
    const start = scroller.scrollTop;
    const begin = performance.now();
    const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : GLIDE_MS;
    cancelAnimationFrame(glideFrame);
    const step = (now: number) => {
      const x = ms ? Math.min(1, (now - begin) / ms) : 1;
      const p = 1 - (1 - x) ** 3;
      scroller.scrollTop = start + delta * p;
      glide = x < 1 ? { from, p } : null;
      if (x < 1) glideFrame = requestAnimationFrame(step);
    };
    glide = { from, p: 0 };
    glideFrame = requestAnimationFrame(step);
  });

  // Where a card's line is. An empty block or a table has no line at its position, but a
  // box of its own, unless the view hides it.
  function anchorBox(view: EditorView, pos: number, side = 1): { top: number; bottom: number; left: number } | null {
    const line = view.coordsAtPos(pos, side);
    if (line.bottom - line.top >= 1) return line;
    const { node, offset } = view.domAtPos(pos), child = node.childNodes[offset];
    const el = child instanceof HTMLElement && !child.matches('br, img.ProseMirror-separator') ? child : node instanceof HTMLElement ? node : node.parentElement;
    const box = el?.getBoundingClientRect();
    return box && box.height >= 1 ? box : null;
  }

  // The nearest box around a position, for a block with nothing shown in it.
  function shownAround(view: EditorView, pos: number): DOMRect | null {
    const { node } = view.domAtPos(pos);
    let el = node instanceof HTMLElement ? node : node.parentElement;
    while (el && el.getBoundingClientRect().height < 1) el = el.parentElement;
    return el?.getBoundingClientRect() ?? null;
  }

  function measure(): void {
    const view = editor?.view;
    if (!view || !host?.isConnected) { balloons = []; return; }
    const state = view.state;
    // The one card being written is the active one, wherever the caret has gone since.
    const draft = commentsInMargin() ? commentDraft(state) : null;
    const activeComment = draft ? null : commentIdAt(state);
    const open = commentsInMargin() ? visibleComments(state.doc, activeComment) : [];
    const seen = new Set<string>();
    const revs = changesInMargin()
      ? visibleRevisions(state.doc).filter((r) => !seen.has(r.id) && seen.add(r.id)) : [];
    if (!open.length && !revs.length && !draft) { balloons = []; return; }
    colors = authorColors(state.doc);
    const activeRevision = draft ? null : revisionIdAt(state);
    const dom = view.dom as HTMLElement;
    const rect = dom.getBoundingClientRect();
    // Client rects are in zoom-scaled screen space; page boxes and this layer's own
    // coordinates are unscaled document px, so divide the scale back out.
    const scale = dom.offsetWidth ? rect.width / dom.offsetWidth : 1;

    const out: Balloon[] = [];
    const add = (from: number, to: number, part: Omit<Balloon, 'page' | 'want' | 'anchorX' | 'anchorY' | 'left'>) => {
      let want: number;
      let anchorX: number;
      let anchorY: number;
      try {
        // A change the view hides shows beside where it stands, as its bar does. A comment
        // on hidden text has no box; its card would stack at the top of the page.
        const a = anchorBox(view, from) ?? (part.revision ? anchorBox(view, from, -1) ?? anchorBox(view, to) ?? shownAround(view, from) : null);
        if (!a) return;
        const end = view.coordsAtPos(to, -1), b = end.bottom - end.top >= 1 ? end : a;
        want = (a.top - rect.top) / scale;
        anchorX = (b.left - rect.left) / scale;
        // The bottom of the line box, not its middle: both word processors run the leader
        // through the gap between two lines, where it crosses no letters.
        anchorY = (b.bottom - rect.top) / scale;
      } catch { return; }
      // The page the line sits on: a narrower section's page is centred in the sheet,
      // so the balloon follows that page's own right edge.
      const found = pageBoxes.findIndex((p) => want >= p.top && want < p.top + p.height);
      const page = found < 0 ? pageBoxes.length - 1 : found;
      const box = pageBoxes[page];
      const left = (box ? box.left + box.width : paperWidth) + cmToPx(BALLOON_GAP_CM);
      out.push({ ...part, page, want, anchorX, anchorY, left });
    };

    for (const c of open) {
      add(c.from, c.to, { key: `c${c.id}`, color: authorColor(colors, c.author), active: c.id === activeComment, comment: c });
    }
    if (draft) add(draft.from, draft.to, { key: 'draft', color: 'var(--color-primary)', active: true, draft });
    for (const r of revs) {
      add(r.from, r.to, {
        key: `r${r.id}`,
        color: authorColor(colors, r.author),
        active: r.id === activeRevision,
        revision: r,
      });
    }
    out.sort((a, b) => a.want - b.want);
    balloons = out;
  }

  // Clicking a balloon selects the range it belongs to, as clicking a pane card does; the
  // view follows the card (above) rather than jumping to the text.
  function select(b: Balloon): void {
    const from = b.comment?.from ?? b.revision?.from;
    const to = b.comment?.to ?? b.revision?.to;
    if (!editor || from === undefined || to === undefined) return;
    const i = balloons.indexOf(b);
    if (!b.active && i >= 0) hold = { key: b.key, top: tops[i], from: new Map(balloons.map((x, k) => [x.key, shown[k]])) };
    selectRange(editor, from, to, false, b.comment?.id);
  }

  // The leader: along the gap under the anchor's line, then eased into the balloon's own
  // left edge. It meets the card at the anchor's own height wherever the card reaches
  // that far, so a balloon sitting at its line is joined by one straight line.
  let leaders = $derived(balloons.map((b, i) => {
    const top = shown[i] ?? b.want;
    const h = hovered === b.key ? heights[i] ?? 0 : stack.reach[i] ?? 0;
    const y = b.anchorY;
    const to = h ? Math.min(Math.max(y, top + 10), top + h - 10) : top + 10;
    const turn = Math.max(b.anchorX + 6, b.left - 30);
    const c = Math.max(0, (b.left - turn) / 2);
    return {
      d: `M ${b.anchorX} ${y} H ${turn} C ${turn + c} ${y} ${b.left - c} ${to} ${b.left} ${to}`,
      color: b.color,
      active: b.active || hovered === b.key,
      resolved: !!b.comment?.resolved,
      fresh: !placed.has(b.key),
    };
  }));

  function point(e: PointerEvent): void {
    const box = host?.getBoundingClientRect();
    if (!box) return;
    const y = (e.clientY - box.top) / (zoom / 100);
    let found: string | null = null;
    balloons.forEach((b, i) => {
      const top = shown[i] ?? b.want;
      if (top <= y && y < top + (heights[i] ?? 0)) found = b.key;
    });
    hovered = found;
  }

  // The pointer over the cards picks the one to lift.
  function hover(node: HTMLElement) {
    const off = () => { hovered = null; };
    node.addEventListener('pointermove', point);
    node.addEventListener('pointerleave', off);
    return {
      destroy: () => {
        node.removeEventListener('pointermove', point);
        node.removeEventListener('pointerleave', off);
      },
    };
  }

  let width = $derived(paperWidth + cmToPx(REVIEW_MARGIN_CM));
  let height = $derived(pageBoxes.length ? pageBoxes[pageBoxes.length - 1].top + pageBoxes[pageBoxes.length - 1].height : 0);
</script>

<div
  class="review-margin-layer"
  class:layer-instant={!!glide}
  bind:this={host}
  use:hover
  style="width: {width}px; height: {height}px; transform: scale({zoom / 100});"
>
  {#if balloons.length}
    <svg width={width} height={height} aria-hidden="true">
      {#each leaders as l}
        <path
          d={l.d}
          class:fresh={l.fresh}
          style:d={`path("${l.d}")`}
          fill="none"
          stroke={l.color}
          stroke-width={l.active ? 1.4 : 1}
          stroke-dasharray="3 3"
          stroke-linecap="round"
          opacity={l.active ? 1 : l.resolved ? 0.35 : 0.7}
        />
      {/each}
    </svg>
  {/if}
  {#each balloons as b, i (b.key)}
    <div
      bind:this={els[i]}
      class="balloon"
      class:active={b.active}
      class:lifted={hovered === b.key && !b.active}
      class:resolved={!!b.comment?.resolved}
      class:fresh={!placed.has(b.key)}
      class:on-deck={i > 0 && stack.reach[i - 1] < (heights[i - 1] ?? 0) && balloons[i - 1]?.page === b.page}
      style="top: {shown[i] ?? b.want}px; left: {b.left}px; width: {cmToPx(BALLOON_W_CM)}px; border-color: {b.color};"
    >
      {#if b.comment}
        <CommentCard {editor} c={b.comment} {author} {colors} compact={!b.active} onSelect={() => select(b)} />
      {:else if b.draft}
        <CommentComposer {editor} draft={b.draft} {author} takeFocus={activePane} />
      {:else if b.revision}
        <RevisionCard {editor} r={b.revision} color={b.color} onSelect={() => select(b)} />
      {/if}
    </div>
  {/each}
</div>

<style>
  /* A sibling of .paper inside .paper-scaler, sharing its scale and its origin — the
     page boxes are measured in the same unscaled document px. */
  .review-margin-layer {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: top left;
    pointer-events: none;
  }

  /* Visible past its box: a card stacked beyond the document still gets its leader. */
  svg {
    position: absolute;
    top: 0;
    left: 0;
    overflow: visible;
  }

  /* The stack slides into place around the active card; its leaders follow where the
     browser animates a path's geometry. */
  path,
  .balloon {
    transition: d 180ms ease, top 180ms ease;
  }

  .layer-instant path,
  .layer-instant .balloon,
  path.fresh,
  .balloon.fresh {
    transition: none;
  }

  @media (prefers-reduced-motion: reduce) {
    path,
    .balloon {
      transition: none;
    }
  }

  .balloon {
    position: absolute;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid;
    border-left-width: 3px;
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 11px;
    line-height: 1.35;
    pointer-events: auto;
    /* Nothing may leave the card sideways: a long word in a comment, a wide button row,
       an author name without spaces. Down it grows with its text and never scrolls. */
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .balloon.active {
    z-index: 1;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
  }

  /* A card lying on the one before it casts a faint shadow up, so the deck reads as one. */
  .balloon.on-deck {
    box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.12);
  }

  /* Under the pointer a covered card rises out of the deck whole; nothing else moves. */
  .balloon.lifted {
    z-index: 2;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  }

  /* A resolved comment's card, greyed as handled until it is the one in use. */
  .balloon.resolved:not(.active) {
    border-style: dashed;
    color: var(--color-text-muted);
  }

  /* The date beside the author is the balloon's second line of information, not its
     first: smaller than the name it follows. */
  .balloon :global(.meta span) {
    font-size: 10px;
  }
</style>
