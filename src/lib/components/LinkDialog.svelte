<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import { dragWindow } from '../utils/dragWindow';
  // The link window: enter or edit a hyperlink URL. A top-layer popover dragged by its
  // title bar, like the bookmark and cross-reference windows — anchored under the button
  // it landed in a corner and covered the text it works on. The parent owns `open` and
  // decides how to apply the URL (insert vs. set vs. extend); this just collects it.
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
  let win = $state<HTMLElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  // A popover, not a fixed child: `position: fixed` resolves against a transformed
  // ancestor, and the ribbon's toolbar stack is one. "manual": only our own buttons close it.
  $effect(() => {
    if (!win) return;
    if (open && !win.matches(':popover-open')) win.showPopover();
    else if (!open && win.matches(':popover-open')) win.hidePopover();
  });

  // Reset the field to the current link each time the window opens, then focus it.
  $effect(() => {
    if (open) {
      url = initialUrl;
      queueMicrotask(() => { input?.focus(); input?.select(); });
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); onApply(url); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

<div
  bind:this={win}
  class="lk"
  popover="manual"
  role="dialog"
  aria-label={t().link.dialogLabel}
  tabindex="-1"
  onkeydown={onKeydown}
  style={pos ? `left:${pos.left}px; top:${pos.top}px; right:auto;` : undefined}
>
  <div class="lk-bar" use:dragWindow={(p) => (pos = p)}>
    <span>{t().link.dialogLabel}</span>
    <button class="lk-x" onclick={onClose} aria-label={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </div>

  <div class="lk-body">
    <input
      bind:this={input}
      bind:value={url}
      type="text"
      placeholder="https://example.com"
      spellcheck="false"
      autocomplete="off"
    />
  </div>

  <div class="lk-actions">
    {#if canRemove}
      <button class="lk-remove" onclick={onRemove}>{t().common.remove}</button>
    {/if}
    <span class="lk-spacer"></span>
    <button onclick={onClose}>{t().common.close}</button>
    <button class="lk-apply" onclick={() => onApply(url)} disabled={!url.trim()}>{t().common.apply}</button>
  </div>
</div>

<style>
  .lk {
    position: fixed;
    /* The popover's own inset: 0 would stretch it across the viewport. */
    inset: 9rem 2rem auto auto;
    margin: 0;
    z-index: 300;
    width: 18rem;
    padding: 0;
  }

  .lk-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.4rem 0.35rem 0.7rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: move;
    touch-action: none;
  }

  .lk-bar span { flex: 1; }

  .lk-x {
    display: flex;
    padding: 0.25rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .lk-x:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .lk-body { padding: 0.7rem; }

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

  .lk-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.7rem 0.7rem;
  }

  .lk-spacer { flex: 1; }

  .lk-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .lk-actions button:hover:not(:disabled) { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .lk-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
  .lk-remove { color: #c0392b; }
  .lk-actions button:disabled { opacity: 0.5; cursor: default; }
</style>
