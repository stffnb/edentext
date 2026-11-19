<script lang="ts">
  import type { Editor, ChainedCommands } from '@tiptap/core';
  import { isHeaderStyled } from '../editor/extensions/tableHeaderRow';
  import type { CellPadding } from '../editor/extensions/tableCellPadding';
  import { cellSideIndex } from '../editor/extensions/tableView';
  import IslandMenu from './toolbar/IslandMenu.svelte';
  import CaptionDialog from './CaptionDialog.svelte';
  import Icon from './ribbon/Icon.svelte';
  import { cellAttr, cellPadding, repeatsHeader } from './tableCells';
  import type { CellVerticalAlign } from '../editor/extensions/tableCellAlign';
  import ColorPicker from './ColorPicker.svelte';
  import TableBorderPicker from './TableBorderPicker.svelte';
  import TableStylePicker from './TableStylePicker.svelte';
  import { numberRecognition, setNumberRecognition } from '../storage/tableOptions.svelte';
  import { t } from '../i18n/i18n.svelte';

  let {
    editor,
    top,
    left,
    tick,
    onDialog,
  }: {
    editor: Editor | null;
    top: number;
    left: number;
    tick: number;
    onDialog: (which: 'split' | 'sort' | 'formula') => void;
  } = $props();

  // Run a table command without disturbing the cell selection: preventDefault on
  // mousedown keeps focus/selection in the editor, then .focus() in the chain
  // re-anchors to that selection so the row/column lands at the active cell.
  // Left and right are what the reader sees; a right-to-left table's columns run mirrored.
  const sideIndex = (i: number) => (editor ? cellSideIndex(editor.view, i) : i);

  function run(cmd: (chain: ChainedCommands) => ChainedCommands) {
    if (!editor) return;
    cmd(editor.chain().focus()).run();
  }

  // Merge needs a multi-cell selection; re-evaluated per transaction via `tick`.
  const canMerge = $derived(tick >= 0 && !!editor && editor.can().mergeCells());

  // Whether the header row / first column area is on. With a table style that is its
  // Table Style Option (the same flag the gallery's checkbox shows), else the manual
  // header shading — so the two surfaces share one state, and one label.
  const isHeaderRow = $derived(tick >= 0 && !!editor && isHeaderStyled(editor.state, 'row'));
  const isHeaderCol = $derived(tick >= 0 && !!editor && isHeaderStyled(editor.state, 'column'));

  const currentCellColor = $derived(tick >= 0 && editor ? cellAttr(editor.state, 'backgroundColor') : null);
  // Where the content sits in the cell box; null = top, the default in both formats.
  const cellVAlign = $derived(tick >= 0 && editor ? cellAttr(editor.state, 'verticalAlign') : null);
  const repeatHeader = $derived(tick >= 0 && !!editor && repeatsHeader(editor.state));
  const padding = $derived(tick >= 0 && editor ? cellPadding(editor.state) : null);
  let captionOpen = $state(false);

  function setPaddingEdge(i: number, raw: string) {
    const v = parseFloat(raw.replace(',', '.'));
    if (!editor || !padding || isNaN(v)) return;
    const next = [...padding] as CellPadding;
    next[i] = Math.max(0, v);
    editor.chain().focus().setCellAttribute('cellPadding', next).run();
  }

  function setVAlign(v: CellVerticalAlign | null) {
    editor?.chain().focus().setCellAttribute('verticalAlign', v).run();
  }

  function applyCellColor(color: string) {
    editor?.chain().focus().setCellAttribute('backgroundColor', color).run();
  }
  function clearCellColor() {
    editor?.chain().focus().setCellAttribute('backgroundColor', null).run();
  }
</script>

<div
  class="table-toolbar"
  style="top: {top}px; left: {left}px;"
  role="toolbar"
  tabindex="-1"
  aria-label={t().table.editing}
  onmousedown={(e) => { if (!(e.target as HTMLElement).closest('.color-picker, input, select')) e.preventDefault(); }}
>
  <button
    class="tt-btn"
    title={t().table.insertRowAbove}
    data-cmd="insertAbove"
    aria-label={t().table.insertRowAbove}
    onclick={() => run((c) => c.addRowBefore())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="9.5" width="15" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="1.5" y1="13" x2="16.5" y2="13" stroke="currentColor" stroke-width="1.1"/>
      <path d="M9 1.5v6M6 4.5h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title={t().table.insertRowBelow}
    data-cmd="insertBelow"
    aria-label={t().table.insertRowBelow}
    onclick={() => run((c) => c.addRowAfter())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="1.5" y1="5" x2="16.5" y2="5" stroke="currentColor" stroke-width="1.1"/>
      <path d="M9 10.5v6M6 13.5h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title={t().table.insertColumnLeft}
    data-cmd="insertLeft"
    aria-label={t().table.insertColumnLeft}
    onclick={() => run((c) => c.addColumnLeft())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="9.5" y="1.5" width="7" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="13" y1="1.5" x2="13" y2="16.5" stroke="currentColor" stroke-width="1.1"/>
      <path d="M1.5 9h6M4.5 6v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title={t().table.insertColumnRight}
    data-cmd="insertRight"
    aria-label={t().table.insertColumnRight}
    onclick={() => run((c) => c.addColumnRight())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="7" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="5" y1="1.5" x2="5" y2="16.5" stroke="currentColor" stroke-width="1.1"/>
      <path d="M10.5 9h6M13.5 6v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  <button
    class="tt-btn tt-danger"
    title={t().table.deleteRow}
    data-cmd="tableDelete-deleteRow"
    aria-label={t().table.deleteRow}
    onclick={() => run((c) => c.deleteRow())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M1.5 2.5H16.5M1.5 15.5H16.5" stroke="currentColor" stroke-width="1.1" opacity="0.35"/>
      <rect x="1.5" y="6.5" width="15" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <path d="M2 15.5L16 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn tt-danger"
    title={t().table.deleteColumn}
    data-cmd="tableDelete-deleteColumn"
    aria-label={t().table.deleteColumn}
    onclick={() => run((c) => c.deleteColumn())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 1.5V16.5M15.5 1.5V16.5" stroke="currentColor" stroke-width="1.1" opacity="0.35"/>
      <rect x="6.5" y="1.5" width="5" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <path d="M2.5 16L15.5 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>

  <button
    class="tt-btn tt-danger"
    title={t().table.deleteTable}
    data-cmd="tableDelete-deleteTable"
    aria-label={t().table.deleteTable}
    onclick={() => run((c) => c.deleteTable())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h13M6.5 4.5V2h5v2.5M4.5 4.5l.8 11a1.1 1.1 0 0 0 1.1 1h5.2a1.1 1.1 0 0 0 1.1-1l.8-11" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  <button
    class="tt-btn"
    title={canMerge ? t().table.mergeCells : t().table.mergeNeedsCells}
    data-cmd="mergeCells"
    aria-label={t().table.mergeCells}
    disabled={!canMerge}
    onclick={() => run((c) => c.mergeCells())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="15" height="11" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="3.5" x2="9" y2="14.5" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.6"/>
      <path d="M2.5 9h4.5M7 9L4.8 6.8M7 9l-2.2 2.2M15.5 9H11M11 9l2.2-2.2M11 9l2.2 2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title={t().table.splitCells}
    data-cmd="splitCells"
    aria-label={t().table.splitCellsAria}
    onclick={() => onDialog('split')}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="3.5" width="15" height="11" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <line x1="9" y1="3.5" x2="9" y2="14.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M7.5 9H3M3 9l2.2-2.2M3 9l2.2 2.2M10.5 9H15M15 9l-2.2-2.2M15 9l-2.2 2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  <button
    class="tt-btn"
    title={t().table.sort}
    data-cmd="sort"
    aria-label={t().table.sortAria}
    onclick={() => onDialog('sort')}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 4.5h11M3 9h7.5M3 13.5h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M15 6v8M12.6 11.6L15 14l2.4-2.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    title={t().table.formula}
    data-cmd="tableFormula"
    aria-label={t().table.formulaAria}
    onclick={() => onDialog('formula')}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M13.5 3H5l4.2 6L5 15h8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    class:active={numberRecognition()}
    title={t().table.numberRecognition}
    data-cmd="numberRecognition"
    aria-label={t().table.numberRecognition}
    aria-pressed={numberRecognition()}
    onclick={() => setNumberRecognition(!numberRecognition())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <path d="M7.5 5.4A1.9 1.9 0 0 1 10.6 6.9c0 1.5-3.1 2.6-3.1 5.7h3.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  {#each [
    { v: null, key: 'Top', label: t().table.cellAlignTop, d: 'M5 5h8M5 8h5' },
    { v: 'middle', key: 'Middle', label: t().table.cellAlignMiddle, d: 'M5 7.5h8M5 10.5h5' },
    { v: 'bottom', key: 'Bottom', label: t().table.cellAlignBottom, d: 'M5 10h8M5 13h5' },
  ] as const as a}
    <button
      class="tt-btn"
      class:active={cellVAlign === a.v}
      title={a.label}
      data-cmd={`cellAlign-${a.key}`}
      aria-label={a.label}
      aria-pressed={cellVAlign === a.v}
      onclick={() => setVAlign(a.v)}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="15" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
        <path d={a.d} stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </button>
  {/each}

  <span class="tt-sep"></span>

  <span class="cmd" data-cmd="cellShading"><ColorPicker
    {editor}
    currentColor={currentCellColor}
    defaultColor="#D9D9D9"
    title={t().table.cellShading}
    chevronTitle={t().table.chooseCellColor}
    clearLabel={t().table.noFill}
    onApply={(c) => applyCellColor(c)}
    onClear={() => clearCellColor()}
  >
    {#snippet icon()}
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M7.5 2.5l6 6-5 5a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1 0-2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M7.5 2.5L6 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M15 12c0 1-.7 2-1.5 2S12 13 12 12c0-.8 1.5-2.3 1.5-2.3S15 11.2 15 12z" fill="currentColor" stroke="none"/>
      </svg>
    {/snippet}
  </ColorPicker></span>

  <span class="cmd" data-cmd="tableBorders"><TableBorderPicker {editor} {tick} /></span>

  <span class="cmd" data-cmd="tableStyle"><TableStylePicker {editor} {tick} /></span>

  <span class="tt-sep"></span>

  <button
    class="tt-btn"
    class:active={isHeaderRow}
    title={t().styles.regions.headerRow}
    data-cmd="headerRow"
    aria-label={t().styles.regions.headerRow}
    aria-pressed={isHeaderRow}
    onclick={() => run((c) => c.toggleHeaderRowStyle())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <rect x="1.5" y="1.5" width="15" height="5" fill="currentColor" opacity="0.85"/>
      <line x1="1.5" y1="6.5" x2="16.5" y2="6.5" stroke="currentColor" stroke-width="1.1"/>
      <line x1="1.5" y1="11.5" x2="16.5" y2="11.5" stroke="currentColor" stroke-width="1.1"/>
      <line x1="9" y1="6.5" x2="9" y2="16.5" stroke="currentColor" stroke-width="1.1"/>
    </svg>
  </button>

  <button
    class="tt-btn"
    class:active={isHeaderCol}
    title={t().styles.regions.firstColumn}
    data-cmd="firstColumn"
    aria-label={t().styles.regions.firstColumn}
    aria-pressed={isHeaderCol}
    onclick={() => run((c) => c.toggleHeaderColumnStyle())}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" rx="1" stroke="currentColor" stroke-width="1.3"/>
      <rect x="1.5" y="1.5" width="5" height="15" fill="currentColor" opacity="0.85"/>
      <line x1="6.5" y1="1.5" x2="6.5" y2="16.5" stroke="currentColor" stroke-width="1.1"/>
      <line x1="11.5" y1="1.5" x2="11.5" y2="16.5" stroke="currentColor" stroke-width="1.1"/>
      <line x1="6.5" y1="9" x2="16.5" y2="9" stroke="currentColor" stroke-width="1.1"/>
    </svg>
  </button>

  <!-- The structural header: the first row again on every page the table runs on to. -->
  <button
    class="tt-btn"
    class:active={repeatHeader}
    title={t().ribbon.repeatHeaderRowHint}
    aria-label={t().ribbon.repeatHeaderRow}
    aria-pressed={repeatHeader}
    data-cmd="repeatHeaderRow"
    onclick={() => run((c) => c.updateAttributes('table', { repeatHeader: repeatHeader ? null : true }))}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="4.5" rx="1" fill="currentColor" opacity="0.85"/>
      <rect x="1.5" y="10.5" width="15" height="4.5" rx="1" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.5"/>
      <path d="M9 7v2.5M7.5 8.2 9 9.7l1.5-1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <span class="tt-sep"></span>

  <IslandMenu id="cellMargins" icon="cellMargins" cmd="cellMargins" title={t().ribbon.cellMargins} disabled={!padding} minWidth={210}>
    {#if padding}
      <div class="im-label">{t().ribbon.cellMargins} (cm)</div>
      <div class="im-grid">
        {#each (['top', 'right', 'bottom', 'left'] as const) as edge, i}
          <label class="im-field">
            <span>{t().toolbarExpanded.margins[edge]}</span>
            <input type="text" inputmode="decimal" value={padding[sideIndex(i)]} onchange={(e) => setPaddingEdge(sideIndex(i), e.currentTarget.value)} />
          </label>
        {/each}
      </div>
    {/if}
  </IslandMenu>

  <button class="tt-btn" title={t().caption.title} aria-label={t().ribbon.insertCaption} onclick={() => (captionOpen = true)}>
    <Icon name="caption" size={18} />
  </button>
</div>

<CaptionDialog bind:open={captionOpen} {editor} />

<style>
  .table-toolbar {
    /* The island's menu triggers take the floating toolbars' button size. */
    --toolbar-btn-size: 1.7rem;
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

  .tt-btn.active {
    background: var(--color-btn-hover);
    color: var(--color-primary);
  }

  .tt-danger:hover {
    background: #fdecea;
    color: #c0392b;
  }

  /* Marks a reused picker for the command search without adding a box around it. */
  .cmd { display: contents; }

  .tt-sep {
    width: 1px;
    height: 1.1rem;
    margin: 0 2px;
    background: var(--color-border);
  }
</style>
