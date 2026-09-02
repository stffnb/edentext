<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { Revision } from '../editor/extensions/trackChanges';
  import { t } from '../i18n/i18n.svelte';

  // One recorded change as both reviewing views show it: what it did, to which text, and
  // accept / reject. Shared by the pane's row and the margin balloon.
  let { editor, r, color, author, onSelect }: {
    editor: Editor | null;
    r: Revision;
    color: string;
    author: string;
    onSelect: () => void;
  } = $props();

  // The stored ISO date, in the reader's locale — an imported file may carry any format.
  function when(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
</script>

<button class="card" onclick={onSelect}>
  <div class="meta">
    <b style:color={color}>{r.author || author || t().revisions.unknownAuthor}</b>
    <span>{when(r.date)}</span>
  </div>
  <div class="kind">{r.kind === 'insertion' ? t().revisions.inserted : t().revisions.deleted}</div>
  <div class="quote" class:struck={r.kind === 'deletion'} style:color={color}>{r.text}</div>
</button>
<div class="actions">
  <button onclick={() => editor?.chain().focus().acceptRevision(r.id).run()}>{t().revisions.accept}</button>
  <button onclick={() => editor?.chain().focus().rejectRevision(r.id).run()}>{t().revisions.reject}</button>
</div>

<style>
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

  .meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--color-text-muted); }
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

  /* Wraps: the balloon is 4.5cm wide and a locale's labels are as long as they are —
     an unwrapped row would push its first button out of the card. */
  .actions { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
  .actions button {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    padding: 2px 6px;
    font: inherit;
    cursor: pointer;
  }
  .actions button:hover { background: var(--color-btn-hover); color: var(--color-text); }
</style>
