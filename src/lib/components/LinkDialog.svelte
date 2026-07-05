<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  // Small popover to enter/edit a hyperlink URL. The parent owns `open` and decides how
  // to apply the URL to the selection (insert vs. set vs. extend); this just collects it.
  let {
    open,
    initialUrl = '',
    canRemove = false,
    onApply,
    onRemove,
    onClose,
  }: {
    open: boolean;
    initialUrl?: string;
    canRemove?: boolean;
    onApply: (url: string) => void;
    onRemove: () => void;
    onClose: () => void;
  } = $props();

  let url = $state('');
  let input = $state<HTMLInputElement | null>(null);

  // Reset the field to the current link each time the popover opens, then focus it.
  $effect(() => {
    if (open) {
      url = initialUrl;
      queueMicrotask(() => input?.focus());
      queueMicrotask(() => input?.select());
    }
  });

  function apply() {
    onApply(url);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

{#if open}
  <div class="link-dialog" role="dialog" aria-label={t().link.dialogLabel}>
    <input
      bind:this={input}
      bind:value={url}
      type="text"
      placeholder="https://example.com"
      onkeydown={onKeydown}
      spellcheck="false"
      autocomplete="off"
    />
    <div class="link-actions">
      {#if canRemove}
        <button class="link-remove" onclick={onRemove}>{t().common.remove}</button>
      {/if}
      <span class="link-spacer"></span>
      <button class="link-cancel" onclick={onClose}>{t().common.cancel}</button>
      <button class="link-apply" onclick={apply} disabled={!url.trim()}>{t().common.apply}</button>
    </div>
  </div>
{/if}

<style>
  .link-dialog {
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
    /* --color-surface (not page-bg): page-bg stays white in dark mode, surface follows the theme. */
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }

  .link-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .link-spacer { flex: 1; }

  .link-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .link-actions button:hover:not(:disabled) { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .link-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
  .link-remove { color: #c0392b; }
  .link-actions button:disabled { opacity: 0.5; cursor: default; }
</style>
