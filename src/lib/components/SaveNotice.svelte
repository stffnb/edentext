<script lang="ts">
  import { t } from '../i18n/i18n.svelte';

  // A short word after a save that did not block it: what the chosen format leaves out.
  let { message, onClose }: { message: string; onClose: () => void } = $props();

  $effect(() => {
    void message;
    const timer = setTimeout(onClose, 8000);
    return () => clearTimeout(timer);
  });
</script>

<div class="save-notice" role="status">
  <span>{message}</span>
  <button type="button" title={t().common.close} aria-label={t().common.close} onclick={onClose}>×</button>
</div>

<style>
  .save-notice {
    position: fixed;
    left: 50%;
    bottom: 40px;
    transform: translateX(-50%);
    z-index: 400;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: calc(100vw - 32px);
    padding-block: 8px;
    padding-inline: 14px 8px;
    background: var(--w-surface);
    color: var(--w-text);
    border: 1px solid var(--w-border-strong);
    border-radius: 6px;
    box-shadow: var(--w-menu-shadow);
    font-family: var(--w-font);
    font-size: 13px;
  }

  button {
    border: none;
    background: none;
    color: var(--w-text-dim);
    font-size: 16px;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }

  button:hover { background: var(--w-hover); }
</style>
