<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { onDestroy, tick as settle } from 'svelte';
  import { isPaginating } from '../editor/extensions/pageBreaks';
  import { headingNumbers } from '../editor/extensions/outline';
  import { styleSheet } from '../styles/sheet.svelte';
  import { alignStrip, flowRange, stripOf, type PageBox } from '../utils/pageStrip';
  import { t } from '../i18n/i18n.svelte';
  import { HIGHLIGHTS } from '../editor/extensions/highlights';

  // The navigator's pages: each sheet as a small live copy of the page, a click shows it.
  // Only the tiles in view exist, and each copies only its own page's blocks, so a tile
  // costs one page however long the document; copies are made after the layout settles.
  let { editor, tick, pages, hits = [], currentPage, size = 'medium', onShowPage }: {
    editor: Editor | null;
    tick: number;
    pages: PageBox[];
    /** A search's matches: while there are any, only the pages holding one are listed. */
    hits?: readonly { from: number; to: number }[];
    currentPage: number;
    /** The pane's text size, which the tiles grow with. */
    size?: 'small' | 'medium' | 'large';
    onShowPage: (page: number) => void;
  } = $props();

  const PAD = 12;       // around the tiles
  const LABEL = 18;     // the page number under a tile
  const GAP = 10;       // between tiles
  const OVERSCAN = 2;   // tiles drawn beyond the view each way
  const CACHE = 24;     // copies kept for tiles scrolled away
  const PER_FRAME_MS = 8;

  let scroller: HTMLElement | undefined = $state();
  let viewW = $state(0);
  let viewH = $state(0);
  let scrollTop = $state(0);

  const paperW = $derived(Math.max(1, ...pages.map((p) => p.width)));
  const TILE_W = { small: 96, medium: 128, large: 172 };
  const tileW = $derived(Math.max(48, Math.min(TILE_W[size], viewW - 2 * PAD)));
  const scale = $derived(tileW / paperW);

  // The pages listed, by number: all of them, or those a search found something on.
  let found = $state<number[] | null>(null);
  const order = $derived(found ?? Array.from({ length: pages.length }, (_, i) => i + 1));
  const indexOf = (page: number) => order.indexOf(page);

  // Each tile's top in the list, from the sheet heights; the last entry is the list's end.
  const tops = $derived.by(() => {
    const out = new Array<number>(order.length + 1);
    let y = PAD;
    for (let i = 0; i < order.length; i++) {
      out[i] = y;
      y += (pages[order[i] - 1]?.height ?? 0) * scale + LABEL + GAP;
    }
    out[order.length] = y - GAP + PAD;
    return out;
  });

  const firstAt = (y: number) => {
    let lo = 0, hi = order.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid + 1] <= y) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const shown = $derived.by(() => {
    if (!order.length) return [];
    const from = Math.max(0, firstAt(scrollTop) - OVERSCAN);
    const to = Math.min(order.length, firstAt(scrollTop + viewH) + 1 + OVERSCAN);
    return Array.from({ length: to - from }, (_, k) => from + k);
  });

  let frame = 0;
  function onScroll() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (scroller) scrollTop = scroller.scrollTop;
    });
  }

  // ---- The copies ------------------------------------------------------------------
  // `version` counts settled layouts; a copy of an older one still shows until its tile
  // is redone, so an edit never blanks the list.
  let version = 0;
  type Copy = { version: number; el: HTMLElement; marks: StaticRange[] };
  const cache = new Map<number, Copy>();
  const hosts = new Map<number, HTMLElement>();
  let pump = 0;

  // The chapter numbers count across the whole document, which a page's copy does not
  // hold, so each copied heading takes its label as text (counted once per layout).
  let numbered: { version: number; labels: Map<number, string> } | null = null;
  function chapterLabels(): Map<number, string> {
    if (numbered?.version !== version) {
      const labels = new Map<number, string>();
      if (editor) {
        for (const [pos, n] of headingNumbers(editor.state.doc, styleSheet().outline)) {
          if (n.label) labels.set(pos, JSON.stringify(n.label.replace(/ /g, '\u00a0')));
        }
      }
      numbered = { version, labels };
    }
    return numbered.labels;
  }

  // The live page paints its search matches as CSS highlights, which a copy of its DOM
  // does not carry: each copy gets its own ranges over the copied text.
  const marked = HIGHLIGHTS ? CSS.highlights.get('search-match-thumb') ?? new Highlight() : null;
  if (marked) CSS.highlights.set('search-match-thumb', marked);
  const unmark = (entry: Copy | undefined) => { for (const r of entry?.marks ?? []) marked?.delete(r); };

  function markHits(blocks: HTMLElement[], copy: HTMLElement): StaticRange[] {
    if (!marked || !editor || !hits.length || !blocks.length) return [];
    const view = editor.view;
    const copies = [...copy.querySelector('.tiptap')!.children].filter((el) => !el.hasAttribute('data-strip-top'));
    if (copies.length !== blocks.length) return [];
    const index = new Map<Node, number>(blocks.map((b, i) => [b, i]));
    const inCopy = (node: Node, offset: number) => {
      const path: number[] = [];
      for (; !index.has(node); node = node.parentNode!) {
        if (!node.parentNode) return null;
        path.push(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
      }
      let at: Node | undefined = copies[index.get(node)!];
      for (let k = path.length - 1; k >= 0 && at; k--) at = at.childNodes[path[k]];
      return at ? { node: at, offset } : null;
    };
    const copyAt = (pos: number) => { const { node, offset } = view.domAtPos(pos); return inCopy(node, offset); };
    let from: number, to: number;
    try {
      from = view.posAtDOM(blocks[0], 0) - 1;
      to = view.posAtDOM(blocks[blocks.length - 1], blocks[blocks.length - 1].childNodes.length) + 1;
    } catch { return []; }
    const out: StaticRange[] = [];
    for (const m of hits) {
      if (m.to < from || m.from > to) continue;
      const a = copyAt(m.from), b = a && copyAt(m.to);
      if (!a || !b) continue;
      const r = new StaticRange({ startContainer: a.node, startOffset: a.offset, endContainer: b.node, endOffset: b.offset });
      marked.add(r);
      out.push(r);
    }
    return out;
  }

  function copyPage(page: number): Copy | null {
    const paper = editor?.view.dom.closest<HTMLElement>('.paper');
    const box = pages[page - 1];
    if (!paper || !box) return null;
    const top = box.top, bottom = box.top + box.height;
    const { blocks, firstTop } = flowRange(paper, top, bottom);
    const keep = new Set<Node>(blocks);
    const holders = new Set<Node | null>([editor!.view.dom]);
    const sheets = paper.querySelector(':scope > .page-sheet-layer');
    if (sheets?.children[page - 1]) { holders.add(sheets); keep.add(sheets.children[page - 1]); }
    for (const layer of paper.querySelectorAll<HTMLElement>(':scope > .hf-layer, :scope > .hf-bg-layer, :scope > .page-decor-layer')) {
      holders.add(layer);
      for (const el of layer.children as HTMLCollectionOf<HTMLElement>) {
        if (el.offsetTop < bottom && el.offsetTop + el.offsetHeight > top) keep.add(el);
      }
    }
    const copy = stripOf(paper, holders, keep, blocks[0] ?? null, firstTop, false);
    const labels = chapterLabels();
    const heads = copy.querySelector('.tiptap')!.querySelectorAll<HTMLElement>(':scope > :is(h1, h2, h3, h4, h5, h6, h7, h8, h9, h10)');
    if (heads.length && labels.size) {
      const live = blocks.filter((b) => /^H\d+$/.test(b.tagName));
      live.forEach((h, i) => {
        const label = labels.get(editor!.view.posAtDOM(h, 0) - 1);
        if (label && heads[i]) heads[i].style.setProperty('--thumb-outline', label);
      });
    }
    copy.classList.remove('settling', 'hf-editing');
    copy.style.position = 'absolute';
    copy.style.transform = `translate(${-box.left}px, ${-top}px)`;
    copy.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
    copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
    return { version, el: copy, marks: markHits(blocks, copy) };
  }

  function place(page: number, el: HTMLElement) {
    const host = hosts.get(page);
    if (!host) return;
    if (host.firstElementChild !== el) host.replaceChildren(el);
    alignStrip(el);
  }

  function remember(page: number, entry: Copy) {
    unmark(cache.get(page));
    cache.delete(page);
    cache.set(page, entry);
    for (const key of cache.keys()) {
      if (cache.size <= CACHE) break;
      if (!hosts.has(key)) { unmark(cache.get(key)); cache.delete(key); }
    }
  }

  // Redoes stale tiles, the one being read first, within a slice of each frame. A layout
  // pass is waited for, but only so long: a document that keeps re-laying out (fields,
  // fonts) would otherwise leave every tile blank.
  const MAX_WAIT_MS = 1000;
  let waitingSince = 0;
  function schedule() {
    if (pump || !editor) return;
    pump = requestAnimationFrame(() => {
      pump = 0;
      if (!editor) return;
      if (isPaginating(editor.view)) {
        waitingSince ||= performance.now();
        if (performance.now() - waitingSince < MAX_WAIT_MS) { schedule(); return; }
      }
      waitingSince = 0;
      const stale = [...hosts.keys()].filter((p) => cache.get(p)?.version !== version)
        .sort((a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage));
      const until = performance.now() + PER_FRAME_MS;
      for (const page of stale) {
        if (performance.now() > until) break;
        const entry = copyPage(page);
        if (!entry) continue;
        remember(page, entry);
        place(page, entry.el);
      }
      if (stale.some((p) => cache.get(p)?.version !== version)) schedule();
    });
  }

  function thumb(host: HTMLElement, page: number) {
    let at = page;
    const attach = () => {
      hosts.set(at, host);
      const hit = cache.get(at);
      if (hit) place(at, hit.el);
      schedule();
    };
    attach();
    return {
      update(next: number) {
        if (next === at) return;
        if (hosts.get(at) === host) hosts.delete(at);
        host.replaceChildren();
        at = next;
        attach();
      },
      destroy() { if (hosts.get(at) === host) hosts.delete(at); },
    };
  }

  // A document change waits for typing to pause; the pass it starts is waited for above.
  let idle: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  $effect(() => {
    void tick;
    void pages;
    if (first) { first = false; return; }
    clearTimeout(idle);
    idle = setTimeout(() => { version++; schedule(); }, 300);
  });

  // The page each match is drawn on, read off the laid-out view: a block wholly on one
  // page answers for all its matches, only one running across a break is asked per match.
  function pageAt(x: number, y: number): number {
    let lo = 0, hi = pages.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pages[mid].top <= y) lo = mid + 1; else hi = mid; }
    // Side by side, a row's pages share a top: the one under x of those.
    for (let i = lo - 1; i >= Math.max(0, lo - 12); i--) {
      const b = pages[i];
      if (y < b.top + b.height && x >= b.left && x < b.left + b.width) return i + 1;
    }
    return Math.max(1, lo);
  }

  function findPages(): number[] | null {
    if (!editor || !hits.length || !pages.length) return null;
    const view = editor.view;
    const paper = view.dom.closest<HTMLElement>('.paper');
    if (!paper) return null;
    const origin = paper.getBoundingClientRect();
    const k = paper.offsetWidth ? origin.width / paper.offsetWidth : 1;
    const at = (r: { left: number; top: number }) => pageAt((r.left - origin.left) / k, (r.top - origin.top) / k);
    const out = new Set<number>();
    const blocks = new Map<number, number>();
    for (const m of hits) {
      const start = view.state.doc.resolve(m.from).before(1);
      let page = blocks.get(start);
      if (page === undefined) {
        const el = view.nodeDOM(start);
        const box = el instanceof HTMLElement ? el.getBoundingClientRect() : null;
        const first = box ? at(box) : 0;
        page = box && first === at({ left: box.left, top: box.bottom - 1 }) ? first : 0;
        blocks.set(start, page);
      }
      out.add(page || at(view.coordsAtPos(m.from)));
    }
    return [...out].sort((a, b) => a - b);
  }

  // Found again once the layout has settled, as the copies are.
  let finding: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void hits;
    void pages;
    clearTimeout(finding);
    if (!hits.length) { found = null; return; }
    const run = () => {
      if (editor && isPaginating(editor.view)) { finding = setTimeout(run, 100); return; }
      found = findPages();
    };
    finding = setTimeout(run, 150);
  });

  onDestroy(() => {
    clearTimeout(finding);
    clearTimeout(idle);
    cancelAnimationFrame(pump);
    cancelAnimationFrame(frame);
    for (const entry of cache.values()) unmark(entry);
    cache.clear();
  });

  // ---- Reading position and keys ------------------------------------------------------
  function reveal(page: number) {
    const i = indexOf(page);
    if (!scroller || i < 0) return;
    const y = tops[i], end = tops[i + 1] - GAP;
    if (y < scroller.scrollTop) scroller.scrollTop = y - PAD;
    else if (end > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = end - scroller.clientHeight + PAD;
    scrollTop = scroller.scrollTop;
  }

  $effect(() => { if (viewH) reveal(currentPage); });

  let focusPage = $state(0);
  const tabPage = $derived(order.includes(focusPage) ? focusPage : order.includes(currentPage) ? currentPage : (order[0] ?? 0));

  function keys(e: KeyboardEvent, page: number) {
    const step = ({ ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 } as Record<string, number>)[e.key];
    const i = indexOf(page);
    const next = step ? i + step : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const to = order[Math.max(0, Math.min(order.length - 1, next))];
    focusPage = to;
    reveal(to);
    void settle().then(() => scroller?.querySelector<HTMLElement>(`[data-page="${to}"]`)?.focus());
  }
</script>

<div class="thumbs" bind:this={scroller} bind:clientWidth={viewW} bind:clientHeight={viewH} onscroll={onScroll}
  role="listbox" aria-label={t().navigator.pages}>
  <div class="track" style:height="{tops[order.length] ?? 0}px">
    {#each shown as i (order[i])}
      {@const page = order[i]}
      {@const box = pages[page - 1]}
      <button
        class="tile" class:current={page === currentPage}
        role="option" aria-selected={page === currentPage} aria-label={t().navigator.pageN(page)}
        data-page={page} tabindex={page === tabPage ? 0 : -1}
        style:top="{tops[i]}px" style:width="{box.width * scale + 4}px"
        onclick={() => { focusPage = page; onShowPage(page); }} onkeydown={(e) => keys(e, page)} onfocus={() => (focusPage = page)}
      >
        <span class="sheet" style:width="{box.width * scale}px" style:height="{box.height * scale}px">
          <span class="zoom" style:transform="scale({scale})" inert aria-hidden="true" use:thumb={page}></span>
        </span>
        <span class="num">{page}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .thumbs { position: relative; height: 100%; overflow-y: auto; overflow-x: hidden; }
  .track { position: relative; }

  .tile {
    position: absolute;
    left: 50%;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 2px 2px 0;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    font: inherit;
    cursor: pointer;
    outline: none;
  }
  .tile:hover .sheet { box-shadow: 0 0 0 2px var(--color-btn-hover); }
  .tile:focus-visible .sheet { box-shadow: 0 0 0 2px var(--color-primary); }
  .tile.current { color: var(--color-text); font-weight: 600; }
  .tile.current .sheet { box-shadow: 0 0 0 2px var(--color-primary); }

  /* A sheet's own layout box: what its copy lays out stays inside it. */
  .sheet {
    position: relative;
    display: block;
    overflow: clip;
    contain: strict;
    background: var(--color-page-bg);
    outline: 1px solid var(--color-page-border);
  }
  /* The page's text inherits nothing from the tile button, as it inherits nothing on the page. */
  .zoom { all: initial; position: absolute; top: 0; left: 0; transform-origin: top left; pointer-events: none; }
  .zoom :global(.tiptap [style*='--thumb-outline']::before) { content: var(--thumb-outline) !important; }
  .num { line-height: 18px; font-size: 0.9em; font-variant-numeric: tabular-nums; }
</style>
