<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { historyLog, undoSteps, redoSteps } from '../utils/historyLog.svelte';

  let { editor, tick, direction }: { editor: Editor | null; tick: number; direction: 'undo' | 'redo' } = $props();

  // The matching stack, most-recent first (so the top row is the next thing reverted).
  let entries = $derived(direction === 'undo' ? historyLog.undo : historyLog.redo);
  let displayed = $derived([...entries].reverse());

  // Re-evaluates on every transaction via `tick` (editor.state isn't reactive).
  let canRun = $derived(
    tick >= 0 && (direction === 'undo' ? !!editor?.can().undo() : !!editor?.can().redo()),
  );

  let verb = $derived(direction === 'undo' ? 'Undo' : 'Redo');

  let open = $state(false);
  let hoverIndex = $state(-1);

  function toggle() {
    open = !open;
    hoverIndex = -1;
  }

  function close() {
    open = false;
    hoverIndex = -1;
  }

  function runSingle() {
    if (!editor) return;
    if (direction === 'undo') editor.chain().focus().undo().run();
    else editor.chain().focus().redo().run();
  }

  // Display index i (0 = most recent) ⇒ jump i+1 real steps.
  function jump(i: number) {
    if (!editor) return;
    if (direction === 'undo') undoSteps(editor, i + 1);
    else redoSteps(editor, i + 1);
    close();
  }

  // Close if the stack drains out from under an open menu.
  $effect(() => {
    if (open && displayed.length === 0) close();
  });

  // Close on outside-click or Escape (mirrors TablePicker's clickOutside action).
  function popover(node: HTMLElement) {
    function onDown(e: MouseEvent) {
      if (!node.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return {
      destroy() {
        window.removeEventListener('mousedown', onDown);
        window.removeEventListener('keydown', onKey);
      },
    };
  }
</script>

<div class="history-split" use:popover>
  <div class="history-control">
    <button
      class="history-main"
      onclick={runSingle}
      disabled={!canRun}
      title={direction === 'undo' ? 'Undo (Ctrl+Z)' : 'Redo (Ctrl+Shift+Z)'}
    >
      {direction === 'undo' ? '↩' : '↪'}
    </button>
    <button
      class="history-caret"
      onclick={toggle}
      disabled={displayed.length === 0}
      aria-haspopup="menu"
      aria-expanded={open}
      title={`${verb} history`}
    >
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5 L4 5.5 L7 2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>

  {#if open && displayed.length > 0}
    <!-- svelte-ignore a11y_mouse_events_have_key_events -->
    <div class="history-dropdown">
      <div class="history-heading">{verb} history</div>
      <div class="history-list" role="menu" tabindex="-1" onmouseleave={() => (hoverIndex = -1)}>
        {#each displayed as entry, i}
          <button
            class="history-item"
            class:hot={i <= hoverIndex}
            role="menuitem"
            onmouseover={() => (hoverIndex = i)}
            onfocus={() => (hoverIndex = i)}
            onclick={() => jump(i)}
          >
            <span class="history-arrow">{direction === 'undo' ? '↩' : '↪'}</span>
            <span class="history-label">{entry.label}</span>
          </button>
        {/each}
      </div>
      <div class="history-footer">
        {#if hoverIndex >= 0}
          {verb} {hoverIndex + 1} action{hoverIndex > 0 ? 's' : ''}
        {:else}
          {displayed.length} action{displayed.length !== 1 ? 's' : ''}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .history-split {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .history-control {
    display: inline-flex;
    align-items: stretch;
    height: var(--toolbar-btn-size);
    border: 1px solid transparent;
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .history-control:hover:not(:has(:disabled)) {
    border-color: var(--color-primary);
  }

  .history-control:hover:not(:has(:disabled)) .history-caret {
    border-left-color: var(--color-border);
  }

  .history-main,
  .history-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .history-main {
    min-width: var(--toolbar-btn-size);
    padding: 0 0.3rem;
    border-radius: 0;
  }

  .history-caret {
    min-width: 1.1rem;
    padding: 0 0.2rem;
    border-left: 1px solid transparent;
    border-radius: 0;
  }

  .history-main:hover:not(:disabled),
  .history-caret:hover:not(:disabled),
  .history-caret[aria-expanded='true'] {
    background: var(--color-btn-hover);
  }

  .history-main:disabled,
  .history-caret:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .history-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 190px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    overflow: hidden;
  }

  .history-heading {
    padding: 0.4rem 0.6rem 0.3rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .history-list {
    max-height: 320px;
    overflow-y: auto;
    padding: 4px;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 0.35rem 0.5rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.82rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
  }

  /* Cumulative highlight: every row up to (and including) the hovered one. */
  .history-item.hot {
    background: var(--color-btn-hover);
  }

  .history-arrow {
    flex: none;
    width: 1rem;
    text-align: center;
    color: var(--color-text-muted);
  }

  .history-label {
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-footer {
    padding: 0.35rem 0.6rem;
    border-top: 1px solid var(--color-border);
    font-size: 0.72rem;
    font-family: var(--font-sans);
    color: var(--color-text-muted);
    user-select: none;
  }
</style>
