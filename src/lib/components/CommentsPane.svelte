<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { TextSelection } from '@tiptap/pm/state';
  import { comments, type CommentRange } from '../editor/extensions/comment';
  import { t } from '../i18n/i18n.svelte';

  // Word's Reviewing Pane: every comment in document order, click to jump to the text it
  // annotates. Margin bubbles are what Word draws beside the page, but the page here fills
  // its own scroller — a pane keeps the sheet at its true width.
  let { editor, tick, author, onClose }: {
    editor: Editor | null;
    tick: number;
    author: string;
    onClose: () => void;
  } = $props();

  let list = $derived.by<CommentRange[]>(() => {
    if (tick < 0 || !editor) return [];
    return comments(editor.state.doc);
  });

  let editingId = $state<string | null>(null);
  let draft = $state('');

  function jumpTo(c: CommentRange) {
    if (!editor) return;
    const { state, view } = editor;
    const tr = state.tr.setSelection(TextSelection.create(state.doc, c.from, c.to)).scrollIntoView();
    view.dispatch(tr);
    view.focus();
  }

  function startEdit(c: CommentRange) {
    editingId = c.id;
    draft = c.text;
  }

  function commit(id: string) {
    editor?.chain().focus().updateComment(id, { text: draft.trim() }).run();
    editingId = null;
  }

  // The stored ISO date, in the reader's locale — an imported file may carry any format.
  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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
      <li class:resolved={c.resolved}>
        <button class="card" onclick={() => jumpTo(c)}>
          <div class="meta">
            <b>{c.author || author}</b>
            <span>{when(c.date)}</span>
          </div>
          <div class="quote">{c.quote}</div>
        </button>
        {#if editingId === c.id}
          <textarea
            rows="3"
            bind:value={draft}
            onkeydown={(e) => { if (e.key === 'Escape') editingId = null; }}
          ></textarea>
          <div class="actions">
            <button onclick={() => (editingId = null)}>{t().common.cancel}</button>
            <button class="primary" onclick={() => commit(c.id)}>{t().common.ok}</button>
          </div>
        {:else}
          <p class="body">{c.text}</p>
          <div class="actions">
            <button onclick={() => startEdit(c)}>{t().comments.edit}</button>
            <button onclick={() => editor?.chain().focus().updateComment(c.id, { resolved: !c.resolved }).run()}>
              {c.resolved ? t().comments.reopen : t().comments.resolve}
            </button>
            <button onclick={() => editor?.chain().focus().removeComment(c.id).run()}>{t().common.remove}</button>
          </div>
        {/if}
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
  .close, .actions button {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    padding: 2px 6px;
    font: inherit;
    cursor: pointer;
  }
  .close:hover, .actions button:hover { background: var(--color-btn-hover); color: var(--color-text); }
  .actions .primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }

  .empty { padding: 12px 10px; color: var(--color-text-muted); }

  ul { list-style: none; margin: 0; padding: 0; }

  li {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  li.resolved { opacity: 0.55; }

  .card {
    display: block;
    width: 100%;
    border: none;
    background: none;
    color: inherit;
    padding: 0;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .meta { display: flex; justify-content: space-between; gap: 8px; color: var(--color-text-muted); }
  .meta b { color: var(--color-text); }

  .quote {
    margin: 3px 0;
    padding-left: 6px;
    border-left: 2px solid rgba(200, 140, 0, 0.7);
    color: var(--color-text-muted);
    /* Two lines of the annotated text is enough to recognise it. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .body { margin: 4px 0; white-space: pre-wrap; }

  textarea {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
    resize: vertical;
  }

  .actions { display: flex; gap: 4px; justify-content: flex-end; }
</style>
