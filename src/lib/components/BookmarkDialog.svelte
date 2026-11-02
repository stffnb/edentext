<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import { dragWindow } from '../utils/dragWindow';
  import BookmarkRow from './BookmarkRow.svelte';
  // The bookmark window: name the selected range, and jump to, rename or drop a name the
  // document already carries. Modeless and draggable like the cross-reference window —
  // a jump has to stay visible, and naming another range must not mean reopening.
  let {
    open,
    names = [],
    initialName = '',
    canApply = true,
    onApply,
    onRemove,
    onRename,
    onGoTo,
    onClose,
  }: {
    open: boolean;
    names?: string[];
    initialName?: string;
    /** A bookmark covers a range, so the host says whether one is selected. */
    canApply?: boolean;
    onApply: (name: string) => void;
    onRemove: (name: string) => void;
    onRename: (from: string, to: string) => boolean;
    onGoTo: (name: string) => void;
    onClose: () => void;
  } = $props();

  let name = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let win = $state<HTMLElement | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);

  // A top-layer popover, not a <dialog>: `position: fixed` resolves against a transformed
  // ancestor, and the island chrome's toolbar stack is one, so a plain window landed
  // beside the viewport there. "manual": a click in the document must not dismiss it.
  $effect(() => {
    if (!win) return;
    if (open && !win.matches(':popover-open')) win.showPopover();
    else if (!open && win.matches(':popover-open')) win.hidePopover();
  });

  $effect(() => {
    if (open) {
      name = initialName;
      queueMicrotask(() => { input?.focus(); input?.select(); });
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && name.trim() && canApply) { e.preventDefault(); onApply(name); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

<div
  bind:this={win}
  class="bm"
  popover="manual"
  role="dialog"
  aria-label={t().bookmark.dialogLabel}
  tabindex="-1"
  onkeydown={onKeydown}
  style={pos ? `left:${pos.left}px; top:${pos.top}px; right:auto;` : undefined}
>
  <div class="bm-bar" use:dragWindow={(p) => (pos = p)}>
    <span>{t().bookmark.dialogLabel}</span>
    <button class="bm-x" onclick={onClose} aria-label={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </div>

  <div class="bm-body">
    <label class="bm-field">
      {t().bookmark.namePlaceholder}
      <input
        bind:this={input}
        bind:value={name}
        type="text"
        spellcheck="false"
        autocomplete="off"
      />
    </label>

    <span class="bm-label">{t().bookmark.existing}</span>
    <div class="bm-list">
      {#each names as n (n)}
        <BookmarkRow name={n} onGoTo={() => { name = n; onGoTo(n); }} onRemove={() => onRemove(n)} onRename={(to) => onRename(n, to)} />
      {:else}
        <p class="bm-none">{t().bookmark.none}</p>
      {/each}
    </div>
  </div>

  <div class="bm-actions">
    <button onclick={onClose}>{t().common.close}</button>
    <button
      class="bm-apply"
      onclick={() => onApply(name)}
      disabled={!name.trim() || !canApply}
      title={canApply ? undefined : t().toolbarExpanded.bookmarkNeedsSelection}
    >{t().common.add}</button>
  </div>
</div>

<style>
  .bm {
    position: fixed;
    /* The popover's own inset: 0 would stretch it between top and bottom. */
    inset: 9rem 2rem auto auto;
    margin: 0;
    z-index: 300;
    width: 18rem;
    max-height: calc(100vh - 11rem);
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-toolbar-bg, #fff);
    color: var(--color-text);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
  }

  .bm-bar {
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

  .bm-bar span { flex: 1; }

  .bm-x {
    display: flex;
    padding: 0.25rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .bm-x:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .bm-body {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.7rem;
  }

  .bm-field { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; }
  .bm-label { font-size: 0.8rem; }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.25rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
  }

  .bm-list {
    min-height: 9rem;
    max-height: 13rem;
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
  }

  .bm-none { margin: 0; padding: 0.35rem 0.5rem; font-size: 0.8rem; opacity: 0.7; }

  .bm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    padding: 0 0.7rem 0.7rem;
  }

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
