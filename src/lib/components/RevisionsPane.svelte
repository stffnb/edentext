<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { TextSelection } from '@tiptap/pm/state';
  import { revisions, authorColorIndex, REVISION_AUTHOR_COLORS, type Revision } from '../editor/extensions/trackChanges';
  import { t } from '../i18n/i18n.svelte';

  // The reviewing pane both word processors list revisions in, beside the comments one:
  // every recorded change in document order, click to jump, accept or reject in place.
  let { editor, tick, author, onClose }: {
    editor: Editor | null;
    tick: number;
    author: string;
    onClose: () => void;
  } = $props();

  // One row per change, not per range: a paragraph boundary splits one change in two.
  let list = $derived.by<Revision[]>(() => {
    if (tick < 0 || !editor) return [];
    const seen = new Set<string>();
    return revisions(editor.state.doc).filter((r) => !seen.has(r.id) && seen.add(r.id));
  });

  let colors = $derived(authorColorIndex(list));

  function colorOf(r: Revision): string {
    return REVISION_AUTHOR_COLORS[colors.get(r.author) ?? 0];
  }

  function jumpTo(r: Revision) {
    if (!editor) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, r.from, r.to)).scrollIntoView());
    view.focus();
  }

  // The stored ISO date, in the reader's locale — an imported file may carry any format.
  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
</script>

<aside class="revisions-pane" aria-label={t().revisions.pane}>
  <header>
    <span class="title">{t().revisions.pane}</span>
    <span class="count">{list.length}</span>
    <button class="close" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  {#if !list.length}
    <p class="empty">{t().revisions.empty}</p>
  {/if}

  <ul>
    {#each list as r (r.id)}
      <li>
        <button class="card" onclick={() => jumpTo(r)}>
          <div class="meta">
            <b style:color={colorOf(r)}>{r.author || author || t().revisions.unknownAuthor}</b>
            <span>{when(r.date)}</span>
          </div>
          <div class="kind">{r.kind === 'insertion' ? t().revisions.inserted : t().revisions.deleted}</div>
          <div class="quote" class:struck={r.kind === 'deletion'} style:color={colorOf(r)}>{r.text}</div>
        </button>
        <div class="actions">
          <button onclick={() => editor?.chain().focus().acceptRevision(r.id).run()}>{t().revisions.accept}</button>
          <button onclick={() => editor?.chain().focus().rejectRevision(r.id).run()}>{t().revisions.reject}</button>
        </div>
      </li>
    {/each}
  </ul>
</aside>

<style>
  .revisions-pane {
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

  .empty { padding: 12px 10px; color: var(--color-text-muted); }

  ul { list-style: none; margin: 0; padding: 0; }

  li {
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
  }

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
  .kind { color: var(--color-text-muted); }

  .quote {
    margin: 3px 0;
    padding-left: 6px;
    border-left: 2px solid currentColor;
    /* Two lines of the changed text is enough to recognise it. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .quote.struck { text-decoration: line-through; }

  .actions { display: flex; gap: 4px; justify-content: flex-end; }
</style>
