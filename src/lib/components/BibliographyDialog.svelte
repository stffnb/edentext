<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { BIB_COMMON_TYPES, BIB_FIELDS, bibRowText } from '../editor/extensions/bibliographyEntry';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Insert ▸ Bibliography Entry: a short name identifying the source, its
  // type and its fields. The record rides the citation itself, so there is no database.
  let { open = $bindable(false), editor }: { open?: boolean; editor: Editor | null } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let identifier = $state('');
  let type = $state<string>('book');
  let fields = $state<Record<string, string>>({});

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  $effect(() => {
    if (!open) return;
    identifier = '';
    type = 'book';
    fields = {};
  });

  const preview = $derived(bibRowText({ identifier: identifier || '…', type, fields }));

  function insert() {
    if (!identifier.trim()) return;
    editor?.chain().focus().insertBibliographyEntry({ identifier, type, fields: { ...fields } }).run();
    open = false;
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().bibliography.title}
>
  <div class="body">
    <h2>{t().bibliography.title}</h2>

    <label class="row">
      <span>{t().bibliography.identifier}</span>
      <input bind:value={identifier} onkeydown={(e) => { if (e.key === 'Enter') insert(); }} />
    </label>

    <label class="row">
      <span>{t().bibliography.type}</span>
      <select bind:value={type}>
        {#each BIB_COMMON_TYPES as k}<option value={k}>{t().bibliography.types[k]}</option>{/each}
      </select>
    </label>

    {#each BIB_FIELDS as f}
      <label class="row">
        <span>{t().bibliography.fields[f]}</span>
        <input
          value={fields[f] ?? ''}
          oninput={(e) => (fields = { ...fields, [f]: e.currentTarget.value })}
          onkeydown={(e) => { if (e.key === 'Enter') insert(); }}
        />
      </label>
    {/each}

    <p class="preview">{preview}</p>

    <div class="actions">
      <span class="spacer"></span>
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
      <button class="primary" disabled={!identifier.trim()} onclick={insert}>{t().common.ok}</button>
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
    width: 220px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }

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
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .actions .primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
</style>
