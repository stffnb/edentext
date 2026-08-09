<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  // Popover to insert a reference to one of the document's bookmarks, showing either its
  // text or the page it sits on.
  let {
    open,
    names = [],
    onInsert,
    onClose,
  }: {
    open: boolean;
    names?: string[];
    onInsert: (name: string, format: 'text' | 'page') => void;
    onClose: () => void;
  } = $props();

  let name = $state('');
  let format = $state<'text' | 'page'>('text');
  let select = $state<HTMLSelectElement | null>(null);

  $effect(() => {
    if (open) {
      name = names[0] ?? '';
      queueMicrotask(() => select?.focus());
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); if (name) onInsert(name, format); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

{#if open}
  <!-- tabindex so the whole popover can own Enter/Escape, wherever focus sits inside it -->
  <div class="xr-dialog" role="dialog" tabindex="-1" aria-label={t().bookmark.crossRefLabel} onkeydown={onKeydown}>
    <select bind:this={select} bind:value={name} size={Math.min(6, Math.max(2, names.length))}>
      {#each names as n (n)}
        <option value={n}>{n}</option>
      {/each}
    </select>
    <label><input type="radio" bind:group={format} value="text" />{t().bookmark.formatText}</label>
    <label><input type="radio" bind:group={format} value="page" />{t().bookmark.formatPage}</label>
    <div class="xr-actions">
      <span class="xr-spacer"></span>
      <button class="xr-cancel" onclick={onClose}>{t().common.cancel}</button>
      <button class="xr-apply" onclick={() => onInsert(name, format)} disabled={!name}>{t().common.insert}</button>
    </div>
  </div>
{/if}

<style>
  .xr-dialog {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 300;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    width: 18rem;
    padding: 0.6rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  select {
    width: 100%;
    box-sizing: border-box;
    padding: 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
  }

  label { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; }

  .xr-actions { display: flex; align-items: center; gap: 0.4rem; }
  .xr-spacer { flex: 1; }

  .xr-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .xr-actions button:hover:not(:disabled) { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .xr-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
  .xr-actions button:disabled { opacity: 0.5; cursor: default; }
</style>
