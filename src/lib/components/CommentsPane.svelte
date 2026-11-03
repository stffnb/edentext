<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { commentDraft, commentIdAt, type CommentRange } from '../editor/extensions/comment';
  import { selectRange, visibleComments } from './reviewItems';
  import CommentCard from './CommentCard.svelte';
  import CommentComposer from './CommentComposer.svelte';
  import { authorColor, authorColors } from '../editor/authorColors';
  import PaneResize from './PaneResize.svelte';
  import PaneOptions, { layoutItems } from './PaneOptions.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { clampPaneWidth, paneLayout, setPaneLayout, REVIEW_PANE_WIDTH, type PaneLayout } from '../storage/panes.svelte';

  // Word's Reviewing Pane: every comment in document order, click to jump to the text it
  // annotates. The balloons beside the page are the other view (ReviewMarginLayer); both
  // are open at once in Word too, and both build their card from CommentCard.
  let { editor, tick, author, onClose }: {
    editor: Editor | null;
    tick: number;
    author: string;
    onClose: () => void;
  } = $props();

  // Docked either side at the width and text size the reader set, as the navigator is.
  const MIN_WIDTH = 200;
  const layout = $derived(paneLayout('comments'));
  const left = $derived(layout.side === 'left');
  const width = $derived(clampPaneWidth(layout.width, MIN_WIDTH));
  const setLayout = (patch: Partial<PaneLayout>) => setPaneLayout('comments', patch);
  const setWidth = (w: number) => setLayout({ width: clampPaneWidth(w, MIN_WIDTH) });

  // The comment the caret sits in: its card is marked and pulled into view, the other
  // half of the heavier tint the document draws on the annotated text.
  let activeId = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    return commentIdAt(editor.state);
  });

  let list = $derived.by<CommentRange[]>(() => {
    if (tick < 0 || !editor) return [];
    return visibleComments(editor.state.doc, activeId);
  });

  let draft = $derived(tick < 0 || !editor ? null : commentDraft(editor.state));

  let colors = $derived.by(() => (tick < 0 || !editor ? new Map<string, string>() : authorColors(editor.state.doc)));

  let cards: Record<string, HTMLElement | null> = {};
  $effect(() => {
    if (activeId) cards[activeId]?.scrollIntoView({ block: 'nearest' });
  });

  function jumpTo(c: CommentRange) {
    if (editor) selectRange(editor, c.from, c.to, true, c.id);
  }
</script>

<aside class="comments-pane size-{layout.size}" class:left aria-label={t().comments.title} style:flex-basis="{width}px">
  <PaneResize {width} min={MIN_WIDTH} {left} label={t().comments.paneWidth} onWidth={setWidth} onReset={() => setWidth(REVIEW_PANE_WIDTH)} />
  <header>
    <span class="title">{t().comments.title}</span>
    <span class="count">{list.length}</span>
    <PaneOptions label={t().comments.options} {left} items={() => layoutItems(layout, setLayout)} />
    <button class="close" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  <div class="body">
  {#if !list.length && !draft}
    <p class="empty">{t().comments.empty}</p>
  {/if}

  <ul>
    {#if draft}
      <li><CommentComposer {editor} {draft} {author} /></li>
    {/if}
    {#each list as c (c.id)}
      <li bind:this={cards[c.id]} class:resolved={c.resolved} class:active={c.id === activeId}
        style:box-shadow={c.id === activeId ? `inset 3px 0 0 ${authorColor(colors, c.author)}` : null}>
        <CommentCard {editor} {c} {author} {colors} onSelect={() => jumpTo(c)} />
      </li>
    {/each}
  </ul>
  </div>
</aside>

<style>
  .comments-pane {
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
  .comments-pane.left { order: -1; border-left: none; border-right: 1px solid var(--color-border); }
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

  .empty { padding: 12px 10px; color: var(--color-text-muted); }

  ul { list-style: none; margin: 0; padding: 0; }

  li {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  li.resolved { opacity: 0.55; }
  li.active { background: var(--color-btn-hover); }
</style>
