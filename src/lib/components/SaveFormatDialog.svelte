<script lang="ts">
  import { t } from '../i18n/i18n.svelte';

  type Kind = 'odt' | 'docx';

  // Asked for a document that has no file behind it yet: the format has to be settled
  // before the bytes are built, and the download route cannot read one back. Without a
  // save picker the browser never reports the name either, so `askName` asks for it here.
  let { open = $bindable(false), kind = null, askName = false, name = '', placeholder = '', onPick }: {
    open?: boolean;
    kind?: Kind | null;
    askName?: boolean;
    name?: string;
    placeholder?: string;
    onPick: (kind: Kind, name?: string) => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let value = $state('');
  let title = $derived(kind ? `${t().ribbon.saveAs} (.${kind})` : askName ? t().dialogs.saveDocument : t().dialogs.chooseFormat);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) {
      value = name;
      el.showModal();
      queueMicrotask(() => inputEl?.select());
    } else if (!open && el.open) el.close();
  });

  function pick(k: Kind) {
    open = false;
    onPick(k, askName ? value.trim() : undefined);
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => !dialogEl?.open && (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={title}
>
  <div class="body">
    <h2>{title}</h2>
    {#if askName}
      <label>
        {t().app.documentName}
        <input bind:this={inputEl} bind:value {placeholder} onkeydown={(e) => e.key === 'Enter' && kind && pick(kind)} />
      </label>
    {/if}
    {#if !kind}
      <button class="format" onclick={() => pick('odt')}>OpenDocument Text (.odt)</button>
      <button class="format" onclick={() => pick('docx')}>Word Document (.docx)</button>
    {/if}
    <div class="actions">
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
      {#if kind}
        <button class="primary" onclick={() => pick(kind)}>{t().app.save}</button>
      {/if}
    </div>
  </div>
</dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 300px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; margin-bottom: 4px; }

  label { display: flex; flex-direction: column; gap: 6px; margin-bottom: 4px; }

  input {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 4px 6px;
    font: inherit;
  }

  button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 7px 14px;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover { background: var(--color-btn-hover); }

  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .actions button { text-align: center; }
  .actions .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
</style>
