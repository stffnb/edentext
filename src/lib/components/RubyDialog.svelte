<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Format ▸ Asian Phonetic Guide / Word's Phonetic Guide: the base text
  // and the reading printed over it. Alignment and position follow both defaults
  // (centred, above), which is what the exports write.
  let { open = $bindable(false), editor }: { open?: boolean; editor: Editor | null } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let base = $state('');
  let reading = $state('');

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  // The selected text is the base, as it is in both dialogs.
  $effect(() => {
    if (!open || !editor) return;
    const { from, to } = editor.state.selection;
    base = to > from ? editor.state.doc.textBetween(from, to, ' ') : '';
    reading = '';
  });

  function insert() {
    if (!base.trim()) return;
    editor?.chain().focus().insertRuby({ base, text: reading }).run();
    open = false;
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().ruby.title}
>
  <div class="body">
    <h2>{t().ruby.title}</h2>

    <label class="row">
      <span>{t().ruby.base}</span>
      <input bind:value={base} />
    </label>
    <label class="row">
      <span>{t().ruby.reading}</span>
      <input bind:value={reading} onkeydown={(e) => e.key === 'Enter' && insert()} />
    </label>

    {#if base.trim()}
      <p class="preview"><ruby>{base}<rt>{reading}</rt></ruby></p>
    {/if}

    <div class="actions">
      <span class="spacer"></span>
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
      <button class="primary" disabled={!base.trim()} onclick={insert}>{t().common.insert}</button>
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
    gap: 10px;
    width: 320px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row span { flex: 0 0 5.5rem; }

  input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
  }

  .preview {
    padding: 6px 0;
    font-family: var(--font-serif, serif);
    font-size: 1.2rem;
    text-align: center;
  }
  .preview rt { font-size: 0.5em; }

  .actions { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
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
  .actions button:hover:not(:disabled) { background: var(--color-btn-hover); }
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .actions .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
</style>
