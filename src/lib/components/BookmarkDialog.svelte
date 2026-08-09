<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  // Popover to name a bookmark for the current selection, and to jump to or delete the
  // ones the document already has. The parent owns `open` and applies the name.
  let {
    open,
    names = [],
    initialName = '',
    onApply,
    onRemove,
    onGoTo,
    onClose,
  }: {
    open: boolean;
    names?: string[];
    initialName?: string;
    onApply: (name: string) => void;
    onRemove: (name: string) => void;
    onGoTo: (name: string) => void;
    onClose: () => void;
  } = $props();

  let name = $state('');
  let input = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open) {
      name = initialName;
      queueMicrotask(() => input?.focus());
      queueMicrotask(() => input?.select());
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); onApply(name); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

{#if open}
  <div class="bm-dialog" role="dialog" aria-label={t().bookmark.dialogLabel}>
    <input
      bind:this={input}
      bind:value={name}
      type="text"
      placeholder={t().bookmark.namePlaceholder}
      onkeydown={onKeydown}
      spellcheck="false"
      autocomplete="off"
    />
    <div class="bm-list-label">{t().bookmark.existing}</div>
    <div class="bm-list">
      {#each names as n (n)}
        <div class="bm-row">
          <button class="bm-name" onclick={() => onGoTo(n)} title={n}>{n}</button>
          <button class="bm-drop" onclick={() => onRemove(n)} aria-label={`${t().common.remove} ${n}`}>×</button>
        </div>
      {:else}
        <div class="bm-empty">{t().bookmark.none}</div>
      {/each}
    </div>
    <div class="bm-actions">
      <span class="bm-spacer"></span>
      <button class="bm-cancel" onclick={onClose}>{t().common.cancel}</button>
      <button class="bm-apply" onclick={() => onApply(name)} disabled={!name.trim()}>{t().common.apply}</button>
    </div>
  </div>
{/if}

<style>
  .bm-dialog {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 300;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 18rem;
    padding: 0.6rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }

  .bm-list-label { font-size: 0.72rem; opacity: 0.7; }

  .bm-list {
    max-height: 9rem;
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }

  .bm-row { display: flex; align-items: center; }
  .bm-empty { padding: 0.35rem 0.5rem; font-size: 0.8rem; opacity: 0.6; }

  .bm-name {
    flex: 1;
    padding: 0.3rem 0.5rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .bm-drop {
    border: none;
    background: transparent;
    color: #c0392b;
    font-size: 0.95rem;
    line-height: 1;
    padding: 0 0.45rem;
    cursor: pointer;
  }

  .bm-row:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .bm-actions { display: flex; align-items: center; gap: 0.4rem; }
  .bm-spacer { flex: 1; }

  .bm-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .bm-actions button:hover:not(:disabled) { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .bm-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
  .bm-actions button:disabled { opacity: 0.5; cursor: default; }
</style>
