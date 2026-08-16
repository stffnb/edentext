<script lang="ts">
  import { getHTMLFromFragment, type Editor } from '@tiptap/core';
  import { autoTextEntries, putAutoText, removeAutoText } from '../storage/autoText.svelte';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Tools ▸ AutoText / Word's Quick Parts: the library, plus "new from
  // selection". Inserting one puts it where the caret is.
  let { open = $bindable(false), editor }: { open?: boolean; editor: Editor | null } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let name = $state('');
  let shortcut = $state('');

  // Re-read on each open: the dialog stays mounted, and a modal freezes the selection
  // it was opened on.
  const hasSelection = $derived(open && !!editor && !editor.state.selection.empty);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  function add() {
    const slice = editor?.state.selection.content();
    if (!editor || !slice || !name.trim()) return;
    const html = getHTMLFromFragment(slice.content, editor.schema);
    putAutoText({ name: name.trim(), shortcut: shortcut.trim(), html });
    name = '';
    shortcut = '';
  }

  function insert(html: string) {
    editor?.chain().focus().insertContent(html).run();
    open = false;
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().autoText.title}
>
  <div class="body">
    <h2>{t().autoText.title}</h2>

    {#if autoTextEntries().length}
      <ul>
        {#each autoTextEntries() as entry (entry.name)}
          <li>
            <button class="entry" onclick={() => insert(entry.html)} title={t().autoText.insertEntry}>
              <span class="entry-name">{entry.name}</span>
              {#if entry.shortcut}<span class="entry-key">{entry.shortcut}</span>{/if}
            </button>
            <button class="small" onclick={() => removeAutoText(entry.name)} title={t().common.remove}>×</button>
          </li>
        {/each}
      </ul>
      <p class="hint">{t().autoText.f3Hint}</p>
    {:else}
      <p class="hint">{t().autoText.empty}</p>
    {/if}

    <h3>{t().autoText.newEntry}</h3>
    <div class="new-row">
      <input bind:value={name} placeholder={t().autoText.name} disabled={!hasSelection} />
      <input class="key" bind:value={shortcut} placeholder={t().autoText.shortcut} disabled={!hasSelection} />
      <!-- Adds to the library; the entries above are what inserts into the document. -->
      <button class="small" onclick={add} disabled={!hasSelection || !name.trim()}>{t().common.add}</button>
    </div>
    {#if !hasSelection}<p class="hint">{t().autoText.needsSelection}</p>{/if}

    <div class="actions">
      <span class="spacer"></span>
      <button class="primary" onclick={() => (open = false)}>{t().common.close}</button>
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
    width: 420px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }
  h3 { font-size: 0.85rem; padding-top: 8px; border-top: 1px solid var(--color-border); }
  .hint { color: var(--color-text-muted); }

  ul { display: flex; flex-direction: column; gap: 4px; list-style: none; }
  li { display: flex; align-items: center; gap: 6px; }

  .entry {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    padding: 4px 8px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .entry:hover { background: var(--color-btn-hover); }
  .entry-name { flex: 1; }
  .entry-key { color: var(--color-text-muted); font-family: var(--font-mono, monospace); }

  .new-row { display: flex; gap: 6px; }
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
  .key { flex: 0 0 6rem; }

  .actions { display: flex; align-items: center; gap: 8px; padding-top: 6px; }
  .spacer { flex: 1; }

  button.small, .actions button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--color-btn-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  .actions .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
</style>
