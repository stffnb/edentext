<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { revisionIdAt, type Revision } from '../editor/extensions/trackChanges';
  import { authorColor, authorColors } from '../editor/authorColors';
  import { filterRevisions, jumpToRevision, listedRevisions, settleRevisions, type RevisionFilter } from './reviewItems';
  import RevisionCard from './RevisionCard.svelte';
  import PaneResize from './PaneResize.svelte';
  import PaneOptions, { layoutItems } from './PaneOptions.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { clampPaneWidth, paneLayout, setPaneLayout, REVIEW_PANE_WIDTH, type PaneLayout } from '../storage/panes.svelte';

  // The reviewing pane both word processors list revisions in, beside the comments one:
  // every recorded change in document order, click to jump, accept or reject in place.
  // The balloons beside the page are the other view; both build their card from RevisionCard.
  let { editor, tick, onClose }: {
    editor: Editor | null;
    tick: number;
    onClose: () => void;
  } = $props();

  // Docked either side at the width and text size the reader set, as the navigator is.
  const MIN_WIDTH = 200;
  const layout = $derived(paneLayout('revisions'));
  const left = $derived(layout.side === 'left');
  const width = $derived(clampPaneWidth(layout.width, MIN_WIDTH));
  const setLayout = (patch: Partial<PaneLayout>) => setPaneLayout('revisions', patch);
  const setWidth = (w: number) => setLayout({ width: clampPaneWidth(w, MIN_WIDTH) });

  let filter = $state<RevisionFilter>({ author: null, kind: null, since: '' });
  let filtered = $derived(filter.author != null || filter.kind != null || !!filter.since);

  let all = $derived.by<Revision[]>(() => (tick < 0 || !editor ? [] : listedRevisions(editor.state.doc)));
  // The author asked for stays an option after their last change went.
  let authors = $derived([...new Set([...all.map((r) => r.author), ...(filter.author == null ? [] : [filter.author])])]);

  // One row per change, not per range: a paragraph boundary splits one change in two.
  let list = $derived.by<Revision[]>(() => {
    const seen = new Set<string>();
    return filterRevisions(all, filter).filter((r) => {
      const key = r.moved ? r.moveId! : r.id;
      return !seen.has(key) && seen.add(key);
    });
  });

  let colors = $derived.by(() => (tick < 0 || !editor ? new Map<string, string>() : authorColors(editor.state.doc)));

  // The change the caret sits in: its card is marked and pulled into view, so the
  // margin bar beside the text and the row here name each other.
  let activeId = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    return revisionIdAt(editor.state);
  });

  let cards: Record<string, HTMLElement | null> = {};
  $effect(() => {
    if (activeId) cards[activeId]?.scrollIntoView({ block: 'nearest' });
  });

  function colorOf(r: Revision): string {
    return authorColor(colors, r.author);
  }

  function jumpTo(r: Revision) {
    if (editor) jumpToRevision(editor, r);
  }
</script>

<aside class="revisions-pane size-{layout.size}" class:left aria-label={t().revisions.pane} style:flex-basis="{width}px">
  <PaneResize {width} min={MIN_WIDTH} {left} label={t().revisions.paneWidth} onWidth={setWidth} onReset={() => setWidth(REVIEW_PANE_WIDTH)} />
  <header>
    <span class="title">{t().revisions.pane}</span>
    <span class="count">{list.length}</span>
    <PaneOptions label={t().revisions.options} {left} items={() => layoutItems(layout, setLayout)} />
    <button class="close" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  {#if all.length || filtered}
    <div class="filter">
      <label>{t().revisions.filterAuthor}
        <select bind:value={filter.author}>
          <option value={null}>{t().revisions.filterAny}</option>
          {#each authors as a}<option value={a}>{a || t().revisions.unknownAuthor}</option>{/each}
        </select>
      </label>
      <label>{t().revisions.filterKind}
        <select bind:value={filter.kind}>
          <option value={null}>{t().revisions.filterAny}</option>
          <option value="insertion">{t().revisions.inserted}</option>
          <option value="deletion">{t().revisions.deleted}</option>
          <option value="formatChange">{t().revisions.formatted}</option>
          <option value="moved">{t().revisions.moved}</option>
        </select>
      </label>
      <label>{t().revisions.filterSince}
        <input type="date" bind:value={filter.since} />
      </label>
      {#if filtered && list.length}
        <div class="settle">
          <button onclick={() => editor && settleRevisions(editor, list, true)}>{t().revisions.acceptShown}</button>
          <button onclick={() => editor && settleRevisions(editor, list, false)}>{t().revisions.rejectShown}</button>
        </div>
      {/if}
    </div>
  {/if}

  <div class="body">
  {#if !list.length}
    <p class="empty">{t().revisions.empty}</p>
  {/if}

  <ul>
    {#each list as r (r.id)}
      <li bind:this={cards[r.id]} class:active={r.id === activeId} style:box-shadow={r.id === activeId ? `inset 3px 0 0 ${colorOf(r)}` : null}>
        <RevisionCard {editor} {r} color={colorOf(r)} onSelect={() => jumpTo(r)} />
      </li>
    {/each}
  </ul>
  </div>
</aside>

<style>
  .revisions-pane {
    display: flex;
    flex-direction: column;
    position: relative;
    flex: 0 0 260px;
    min-width: 0;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    --pane-text: 0.8rem;
    /* As the Navigator: the modern chrome's island overlays the top of the row. */
    margin-top: var(--toolbar-overlay-h, 0px);
  }
  /* Docked left, the reviewing panes sit nearest the page, as they do on the right. */
  .revisions-pane.left { order: -2; border-left: none; border-right: 1px solid var(--color-border); }
  .size-small { --pane-text: 0.72rem; }
  .size-large { --pane-text: 1rem; }

  .body { flex: 1; min-height: 0; overflow-y: auto; font-size: var(--pane-text); }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 6px 10px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .title { flex: 1; font-weight: 600; }
  .count { color: var(--color-text-muted); }
  .close {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    padding: 2px 6px;
    font: inherit;
    cursor: pointer;
  }
  .close:hover { background: var(--color-btn-hover); color: var(--color-text); }

  .filter { display: grid; gap: 4px; font-size: var(--pane-text); padding: 8px 10px; border-bottom: 1px solid var(--color-border); }
  .filter label { display: grid; grid-template-columns: 4.5rem minmax(0, 1fr); align-items: center; color: var(--color-text-muted); }
  .filter select, .filter input { min-width: 0; font: inherit; }
  .settle { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
  .settle button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: none;
    color: inherit;
    padding: 2px 6px;
    font: inherit;
    cursor: pointer;
  }
  .settle button:hover { background: var(--color-btn-hover); }

  .empty { padding: 12px 10px; color: var(--color-text-muted); }

  ul { list-style: none; margin: 0; padding: 0; }

  li {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  /* The accent is the author's colour, set inline — the same one the margin bar takes. */
  li.active { background: var(--color-btn-hover); }
</style>
