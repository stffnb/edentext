<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { commentIdAt, type CommentRange } from '../editor/extensions/comment';
  import { selectRange, visibleComments } from './reviewItems';
  import CommentCard from './CommentCard.svelte';
  import { t } from '../i18n/i18n.svelte';

  // Word's Reviewing Pane: every comment in document order, click to jump to the text it
  // annotates. The balloons beside the page are the other view (ReviewMarginLayer); both
  // are open at once in Word too, and both build their card from CommentCard.
  let { editor, tick, author, onClose }: {
    editor: Editor | null;
    tick: number;
    author: string;
    onClose: () => void;
  } = $props();

  let list = $derived.by<CommentRange[]>(() => {
    if (tick < 0 || !editor) return [];
    return visibleComments(editor.state.doc);
  });

  // The comment the caret sits in: its card is marked and pulled into view, the other
  // half of the heavier tint the document draws on the annotated text.
  let activeId = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    return commentIdAt(editor.state);
  });

  let cards: Record<string, HTMLElement | null> = {};
  $effect(() => {
    if (activeId) cards[activeId]?.scrollIntoView({ block: 'nearest' });
  });

  function jumpTo(c: CommentRange) {
    if (editor) selectRange(editor, c.from, c.to);
  }
</script>

<aside class="comments-pane" aria-label={t().comments.title}>
  <header>
    <span class="title">{t().comments.title}</span>
    <span class="count">{list.length}</span>
    <button class="close" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  {#if !list.length}
    <p class="empty">{t().comments.empty}</p>
  {/if}

  <ul>
    {#each list as c (c.id)}
      <li bind:this={cards[c.id]} class:resolved={c.resolved} class:active={c.id === activeId}>
        <CommentCard {editor} {c} {author} onSelect={() => jumpTo(c)} />
      </li>
    {/each}
  </ul>
</aside>

<style>
  .comments-pane {
    display: flex;
    flex-direction: column;
    flex: 0 0 260px;
    min-width: 0;
    overflow-y: auto;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: var(--font-sans);
    font-size: 0.8rem;
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    position: sticky;
    top: 0;
    padding: 8px 10px;
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
  li.active { background: var(--color-btn-hover); box-shadow: inset 3px 0 0 rgba(200, 140, 0, 0.9); }
</style>
