<script lang="ts">
  import type { Editor, ChainedCommands } from '@tiptap/core';

  let {
    editor,
    top,
    left,
    tick,
    onSplit,
  }: {
    editor: Editor | null;
    top: number;
    left: number;
    tick: number;
    onSplit: () => void;
  } = $props();

  // Run a table command without disturbing the cell selection: preventDefault on
  // mousedown keeps focus/selection in the editor, then .focus() in the chain
  // re-anchors to that selection so the row/column lands at the active cell.
  function run(cmd: (chain: ChainedCommands) => ChainedCommands) {
    if (!editor) return;
    cmd(editor.chain().focus()).run();
  }

  // Merge needs a multi-cell selection; re-evaluated per transaction via `tick`.
  const canMerge = $derived(tick >= 0 && !!editor && editor.can().mergeCells());
</script>

<div
  class="table-toolbar"
  style="top: {top}px; left: {left}px;"
  role="toolbar"
  tabindex="-1"
  aria-label="Table editing"
  onmousedown={(e) => e.preventDefault()}
>
  <button
    class="tt-btn"
    title="Insert row above"
    aria-label="Insert row above"
    onclick={() => run((c) => c.addRowBefore())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="9" width="12" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="1.1"/>
      <path d="M9 2v4M7 4l2-2 2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title="Insert row below"
    aria-label="Insert row below"
    onclick={() => run((c) => c.addRowAfter())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="12" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.1"/>
      <path d="M9 16v-4M7 14l2 2 2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title="Insert column left"
    aria-label="Insert column left"
    onclick={() => run((c) => c.addColumnBefore())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="9" x2="15" y2="9" stroke="currentColor" stroke-width="1.1"/>
      <path d="M2 9h4M4 7l-2 2 2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title="Insert column right"
    aria-label="Insert column right"
    onclick={() => run((c) => c.addColumnAfter())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="9" x2="3" y2="9" stroke="currentColor" stroke-width="1.1"/>
      <path d="M16 9h-4M14 7l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  <button
    class="tt-btn tt-danger"
    title="Delete row"
    aria-label="Delete row"
    onclick={() => run((c) => c.deleteRow())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="6" width="12" height="6" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="6" y1="9" x2="12" y2="9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn tt-danger"
    title="Delete column"
    aria-label="Delete column"
    onclick={() => run((c) => c.deleteColumn())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="6" y="3" width="6" height="12" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="6" x2="9" y2="12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn tt-danger"
    title="Delete table"
    aria-label="Delete table"
    onclick={() => run((c) => c.deleteTable())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L13 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  <button
    class="tt-btn"
    title="Merge cells"
    aria-label="Merge cells"
    disabled={!canMerge}
    onclick={() => run((c) => c.mergeCells())}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <path d="M6 9h6M6 9l1.6-1.6M6 9l1.6 1.6M12 9l-1.6-1.6M12 9l-1.6 1.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title="Split cells…"
    aria-label="Split cells"
    onclick={() => onSplit()}
  >
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="4" x2="9" y2="14" stroke="currentColor" stroke-width="1.3"/>
      <path d="M9 7.4L7.4 9 9 10.6M9 7.4L10.6 9 9 10.6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
</div>

<style>
  .table-toolbar {
    position: absolute;
    /* Sit just above the table's top-left corner. */
    transform: translateY(calc(-100% - 6px));
    z-index: 150;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
    /* The toolbar is a sibling of the zoomed .paper, so it renders at a constant
       size regardless of editor zoom. */
  }

  .tt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    min-width: unset;
    padding: 0;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .tt-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .tt-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .tt-danger:hover {
    background: #fdecea;
    color: #c0392b;
  }

  .tt-sep {
    width: 1px;
    height: 1.1rem;
    margin: 0 2px;
    background: var(--color-border);
  }
</style>
