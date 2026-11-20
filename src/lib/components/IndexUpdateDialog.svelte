<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import type { IndexUpdate } from '../editor/extensions/tableOfContents';

  // Word's "Update Table of Contents": renew the whole index, or keep its rows (a file's
  // own selection of them) and renew only their page numbers.
  let { open = $bindable(false), onPick }: {
    open?: boolean;
    onPick: (mode: IndexUpdate) => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let mode = $state<IndexUpdate>('all');

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) { mode = 'all'; el.showModal(); }
    else if (!open && el.open) el.close();
  });

  function apply() {
    open = false;
    onPick(mode);
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => !dialogEl?.open && (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().ribbon.tocUpdateTitle}
>
  <form class="body" method="dialog" onsubmit={(e) => { e.preventDefault(); apply(); }}>
    <h2>{t().ribbon.tocUpdateTitle}</h2>
    <p>{t().ribbon.tocUpdateChoose}</p>
    <label><input type="radio" bind:group={mode} value="pages" /> {t().ribbon.tocUpdatePages}</label>
    <label><input type="radio" bind:group={mode} value="all" /> {t().ribbon.tocUpdateAll}</label>
    <div class="actions">
      <button type="button" onclick={() => (open = false)}>{t().common.cancel}</button>
      <button type="submit" class="primary">{t().common.ok}</button>
    </div>
  </form>
</dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 320px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; margin-bottom: 4px; }
  label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

  button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 7px 14px;
    font: inherit;
    cursor: pointer;
  }
  button:hover { background: var(--color-btn-hover); }
  .primary { border-color: var(--color-accent, #1a56db); color: var(--color-accent, #1a56db); }
</style>
