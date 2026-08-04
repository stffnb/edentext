<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { t } from '../i18n/i18n.svelte';

  let {
    editor,
    open = $bindable(false),
    onOpen,
    onInsert,
    onManageStyles,
  }: {
    editor: Editor | null;
    open?: boolean;
    onOpen?: () => void;
    // Mirrors ColorPicker's onApply: the parent runs the actual editor command
    // against the saved selection range (focus is stolen by the popover).
    onInsert: (rows: number, cols: number, range: { from: number; to: number }) => void;
    // Opens the style manager on its table tab (mounted once, in App.svelte).
    onManageStyles?: () => void;
  } = $props();

  // Quick-pick grid size (like Word/LibreOffice). Hovering selects the top-left
  // rows×cols block; clicking inserts it.
  const GRID_ROWS = 8;
  const GRID_COLS = 10;
  const ROW_INDICES = Array.from({ length: GRID_ROWS }, (_, i) => i + 1);
  const COL_INDICES = Array.from({ length: GRID_COLS }, (_, i) => i + 1);

  // Manual-entry bounds for the row/column number inputs.
  const MAX_ROWS = 50;
  const MAX_COLS = 20;

  let hoverRows = $state(0);
  let hoverCols = $state(0);
  let rowsInput = $state('3');
  let colsInput = $state('3');

  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  function clamp(n: number, min: number, max: number): number {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function openPicker() {
    if (!editor) return;
    onOpen?.();
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    if (open) {
      open = false;
    } else {
      hoverRows = 0;
      hoverCols = 0;
      open = true;
    }
  }

  function insert(rows: number, cols: number) {
    if (!editor) return;
    open = false;
    const from = savedFrom ?? editor.state.selection.from;
    const to = savedTo ?? editor.state.selection.to;
    savedFrom = null;
    savedTo = null;
    onInsert(rows, cols, { from, to });
  }

  function insertFromInputs() {
    insert(clamp(parseInt(rowsInput, 10), 1, MAX_ROWS), clamp(parseInt(colsInput, 10), 1, MAX_COLS));
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      insertFromInputs();
    }
  }

  function tablePickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) open = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="table-picker" use:tablePickerClickOutside>
  <button class="table-trigger" onclick={openPicker} title={t().table.insertTable} aria-pressed={open}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" stroke="currentColor" stroke-width="1"/>
      <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" stroke="currentColor" stroke-width="1"/>
      <line x1="5.5" y1="5.5" x2="5.5" y2="14.5" stroke="currentColor" stroke-width="1"/>
      <line x1="10.5" y1="5.5" x2="10.5" y2="14.5" stroke="currentColor" stroke-width="1"/>
    </svg>
  </button>

  {#if open}
    <div class="table-dropdown">
      <div class="table-dim-label">
        {#if hoverRows > 0 && hoverCols > 0}
          {t().table.dimensions(hoverCols, hoverRows)}
        {:else}
          {t().table.insertTable}
        {/if}
      </div>

      <!-- svelte-ignore a11y_mouse_events_have_key_events -->
      <div
        class="table-grid"
        role="grid"
        tabindex="-1"
        aria-label={t().table.selectSize}
        onmouseleave={() => { hoverRows = 0; hoverCols = 0; }}
      >
        {#each ROW_INDICES as r}
          <div class="table-grid-row" role="row">
            {#each COL_INDICES as c}
              <button
                class="table-grid-cell"
                class:hot={r <= hoverRows && c <= hoverCols}
                role="gridcell"
                aria-label={t().table.byDimension(c, r)}
                onmouseover={() => { hoverRows = r; hoverCols = c; }}
                onfocus={() => { hoverRows = r; hoverCols = c; }}
                onclick={() => insert(r, c)}
              ></button>
            {/each}
          </div>
        {/each}
      </div>

      <div class="table-manual">
        <label class="table-manual-field">
          <span>{t().table.rows}</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={rowsInput}
            onkeydown={onInputKeydown}
            aria-label={t().table.numberOfRows}
          />
        </label>
        <label class="table-manual-field">
          <span>{t().table.cols}</span>
          <input
            type="text"
            inputmode="numeric"
            bind:value={colsInput}
            onkeydown={onInputKeydown}
            aria-label={t().table.numberOfColumns}
          />
        </label>
        <button class="table-insert-btn" onclick={insertFromInputs}>{t().table.insert}</button>
      </div>

      <button
        class="table-manage"
        title={t().table.manageStyles}
        onclick={() => { open = false; onManageStyles?.(); }}
      >
        <!-- Sliders, as on the style gallery's "Manage styles…" entry. -->
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4.5h8M13 4.5h1M2 11.5h1M6 11.5h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          <circle cx="11.5" cy="4.5" r="1.6" stroke="currentColor" stroke-width="1.4"/>
          <circle cx="4.5" cy="11.5" r="1.6" stroke="currentColor" stroke-width="1.4"/>
        </svg>
        <span class="table-manage-label">{t().table.manageStyles}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .table-picker {
    position: relative;
  }

  .table-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
    padding: 0 0.3rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .table-trigger:hover {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
  }

  .table-trigger[aria-pressed='true'] {
    background: var(--color-primary);
    color: white;
  }

  .table-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    /* A column so every child stretches to the panel width: a <button> with width:auto
       sizes to its content in WebKit, which left the manage row short of the edge. */
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 8px;
    /* Anchor near the right edge of the toolbar — keep it from spilling off-screen. */
    right: 0;
    left: auto;
  }

  .table-dim-label {
    font-size: 0.78rem;
    font-family: var(--font-sans);
    color: var(--color-text);
    text-align: center;
    margin-bottom: 6px;
    user-select: none;
  }

  .table-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
    /* Centred, so whichever of grid and manage row is wider, the other isn't left
       with a ragged gap on one side. */
    align-self: center;
  }

  .table-grid-row {
    display: flex;
    gap: 2px;
  }

  .table-grid-cell {
    width: 16px;
    height: 16px;
    min-width: unset;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    background: var(--color-surface);
    cursor: pointer;
  }

  .table-grid-cell.hot {
    border-color: var(--color-primary);
    background: var(--color-primary);
  }

  .table-manual {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--color-border);
  }

  .table-manual-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 0.7rem;
    font-family: var(--font-sans);
    color: var(--color-text-muted);
  }

  .table-manual-field input {
    width: 44px;
    height: 1.8rem;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    outline: none;
    transition: border-color 0.15s;
  }

  .table-manual-field input:hover,
  .table-manual-field input:focus {
    border-color: var(--color-primary);
  }

  .table-insert-btn {
    height: 1.8rem;
    padding: 0 0.7rem;
    min-width: unset;
    border: 1px solid var(--color-primary);
    border-radius: var(--radius);
    background: var(--color-primary);
    color: white;
    font-size: 0.78rem;
    font-family: var(--font-sans);
    cursor: pointer;
  }

  .table-insert-btn:hover {
    opacity: 0.9;
  }

  /* Bleeds to both panel edges below the grid, like the style gallery's manage row.
     The panel is shrink-to-fit, so its width must come from the grid alone: width:0
     keeps this row out of that calculation, and min-width then fills the resolved
     width plus the two negative margins. The label truncates instead (title = full). */
  .table-manage {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 0;
    min-width: calc(100% + 16px);
    margin: 8px -8px -8px;
    padding: 0.45rem 0.5rem;
    border: none;
    border-top: 1px solid var(--color-border);
    border-radius: 0;
    background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface));
    color: color-mix(in srgb, var(--color-primary) 55%, var(--color-text));
    font-family: var(--font-sans);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .table-manage-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .table-manage:hover {
    background: color-mix(in srgb, var(--color-primary) 16%, var(--color-surface));
  }
</style>
