<script lang="ts">
  import { t } from '../i18n/i18n.svelte';

  // Asked for a document that has no file behind it yet: the format has to be settled
  // before the bytes are built, and the download route cannot read one back.
  let { open = $bindable(false), onPick }: {
    open?: boolean;
    onPick: (kind: 'odt' | 'docx') => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  function pick(kind: 'odt' | 'docx') {
    open = false;
    onPick(kind);
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().dialogs.chooseFormat}
>
  <div class="body">
    <h2>{t().dialogs.chooseFormat}</h2>
    <button class="format" onclick={() => pick('odt')}>OpenDocument Text (.odt)</button>
    <button class="format" onclick={() => pick('docx')}>Word Document (.docx)</button>
    <div class="actions">
      <button onclick={() => (open = false)}>{t().common.cancel}</button>
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
    width: 300px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; margin-bottom: 4px; }

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

  .actions { display: flex; justify-content: flex-end; margin-top: 4px; }
  .actions button { text-align: center; }
</style>
