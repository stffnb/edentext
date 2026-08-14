<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { SEQ_CATEGORIES, type SeqCategory } from '../editor/extensions/caption';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Insert ▸ Caption: a category label, the running number, a separator
  // and the text. Position follows its defaults — a table is captioned above, a
  // picture below — and stays the user's choice.
  let { open = $bindable(false), editor }: { open?: boolean; editor: Editor | null } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let category = $state<SeqCategory>('figure');
  let text = $state('');
  let separator = $state(': ');
  let above = $state(false);
  // The label is the category's name in the UI language until the user overrides it —
  // LibreOffice's own categories are localized and travel as plain caption text.
  let label = $state<string | null>(null);
  const shownLabel = $derived(label ?? t().caption.categories[category]);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  // Opening on a table proposes the table category, captioned above, as both word
  // processors do.
  $effect(() => {
    if (!open || !editor) return;
    const inTable = editor.isActive('table');
    category = inTable ? 'table' : 'figure';
    above = inTable;
    label = null;
    text = '';
  });

  function insert() {
    editor?.chain().focus().insertCaption({ category, label: shownLabel, separator, text, above }).run();
    open = false;
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().caption.title}
>
  <div class="body">
    <h2>{t().caption.title}</h2>

    <label class="row">
      <span>{t().caption.category}</span>
      <select value={category} onchange={(e) => { category = e.currentTarget.value as SeqCategory; label = null; }}>
        {#each SEQ_CATEGORIES as c}<option value={c}>{t().caption.categories[c]}</option>{/each}
      </select>
    </label>

    <label class="row">
      <span>{t().caption.label}</span>
      <input value={shownLabel} oninput={(e) => (label = e.currentTarget.value)} />
    </label>

    <label class="row">
      <span>{t().caption.separator}</span>
      <input class="short" value={separator} oninput={(e) => (separator = e.currentTarget.value)} />
    </label>

    <label class="row">
      <span>{t().caption.text}</span>
      <input
        bind:value={text}
        onkeydown={(e) => { if (e.key === 'Enter') insert(); }}
      />
    </label>

    <label class="row">
      <span>{t().caption.position}</span>
      <select value={above ? 'above' : 'below'} onchange={(e) => (above = e.currentTarget.value === 'above')}>
        <option value="below">{t().caption.below}</option>
        <option value="above">{t().caption.above}</option>
      </select>
    </label>

    <p class="preview">{shownLabel} 1{separator}{text}</p>

    <div class="actions">
      <span class="spacer"></span>
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
      <button class="primary" onclick={insert}>{t().common.ok}</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    /* The global reset zeroes every margin, which also takes the auto centring a
       modal <dialog> gets by default. */
    margin: auto;
    border: none;
    border-radius: 8px;
    padding: 0;
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  dialog::backdrop { background: rgba(0, 0, 0, 0.35); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 400px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; margin-bottom: 4px; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row > span { flex: 1; color: var(--color-text-muted); }

  input, select {
    height: 26px;
    width: 200px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }
  input.short { width: 70px; }

  .preview {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 6px 8px;
    color: var(--color-text-muted);
    font-style: italic;
  }

  .actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .spacer { flex: 1; }

  .actions button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 5px 14px;
    font: inherit;
    cursor: pointer;
  }
  .actions button:hover { background: var(--color-btn-hover); }
  .actions .primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
</style>
