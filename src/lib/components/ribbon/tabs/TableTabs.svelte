<script lang="ts">
  import type { Editor, ChainedCommands } from '@tiptap/core';
  import { CellSelection, isInTable, selectedRect } from '@tiptap/pm/tables';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import ColorPicker from '../../ColorPicker.svelte';
  import TableBorderPicker from '../../TableBorderPicker.svelte';
  import TableStylePicker from '../../TableStylePicker.svelte';
  import TableSplitDialog from '../../TableSplitDialog.svelte';
  import TableSortDialog from '../../TableSortDialog.svelte';
  import TableFormulaDialog from '../../TableFormulaDialog.svelte';
  import { captionClicks, anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { isHeaderStyled } from '../../../editor/extensions/tableHeaderRow';
  import { DEFAULT_CELL_PADDING, parseCellPadding, type CellPadding } from '../../../editor/extensions/tableCellPadding';
  import type { CellVerticalAlign } from '../../../editor/extensions/tableCellAlign';
  import { currentCellFormula, currentCellName, guessFormula } from '../../../editor/extensions/tableFormula';
  import { numberRecognition, setNumberRecognition } from '../../../storage/tableOptions.svelte';
  import { t } from '../../../i18n/i18n.svelte';

  // Word splits the table's contextual tabs in two: Design paints it, Layout
  // changes its shape.
  let { editor, tick, which }: {
    editor: Editor | null;
    tick: number;
    which: 'design' | 'layout';
  } = $props();

  function run(cmd: (chain: ChainedCommands) => ChainedCommands) {
    if (!editor) return;
    cmd(editor.chain().focus()).run();
  }

  const canMerge = $derived(tick >= 0 && !!editor && editor.can().mergeCells());
  const inTable = $derived(tick >= 0 && !!editor && isInTable(editor.state));
  // What the sort and formula popovers open on: the grid around the cursor's cell.
  const NO_TABLE = { columns: 1, column: 0, headerRow: false, cell: null as string | null, formula: '=SUM(ABOVE)' };
  const grid = $derived.by(() => {
    if (!inTable || !editor) return NO_TABLE;
    const rect = selectedRect(editor.state);
    return {
      columns: rect.map.width,
      column: rect.left,
      headerRow: rect.table.firstChild?.firstChild?.type.name === 'tableHeader'
        || rect.table.attrs.repeatHeader === true,
      cell: currentCellName(editor.state),
      formula: currentCellFormula(editor.state) || guessFormula(editor.state),
    };
  });
  const isHeaderRow = $derived(tick >= 0 && !!editor && isHeaderStyled(editor.state, 'row'));
  const isHeaderCol = $derived(tick >= 0 && !!editor && isHeaderStyled(editor.state, 'column'));
  // The structural header: the first row repeated on every page the table continues on.
  const repeatsHeader = $derived.by(() => {
    if (tick < 0 || !editor || !isInTable(editor.state)) return false;
    return selectedRect(editor.state).table.attrs.repeatHeader === true;
  });

  // One attribute over the selected cells: the shared value, '' if they disagree.
  function cellAttr(name: string): string | null {
    if (!editor) return null;
    const sel = editor.state.selection;
    const values = new Set<string | null>();
    if (sel instanceof CellSelection) {
      sel.forEachCell((cell) => values.add((cell.attrs[name] as string) ?? null));
    } else {
      const from = sel.$from;
      for (let d = from.depth; d > 0; d--) {
        const role = from.node(d).type.spec.tableRole;
        if (role === 'cell' || role === 'header_cell') {
          values.add((from.node(d).attrs[name] as string) ?? null);
          break;
        }
      }
    }
    if (values.size === 0) return null;
    return values.size > 1 ? '' : ([...values][0] ?? null);
  }

  const cellColor = $derived(tick >= 0 ? cellAttr('backgroundColor') : null);
  const vAlign = $derived(tick >= 0 ? cellAttr('verticalAlign') : null);
  // The cell's margins in cm, [top, right, bottom, left]; null outside a table.
  const padding = $derived.by<CellPadding | null>(() => {
    if (tick < 0 || !editor || !editor.isActive('table')) return null;
    // A cell that never set its margins reports none, and shows the format default.
    return parseCellPadding(cellAttr('cellPadding')) ?? DEFAULT_CELL_PADDING;
  });

  function setPaddingEdge(i: number, cm: number) {
    if (!editor || !padding) return;
    const next = [...padding] as CellPadding;
    next[i] = cm;
    editor.chain().focus().setCellAttribute('cellPadding', next).run();
  }

  // Word folds the three deletions into one big button's menu, so the four inserts
  // beside it are the group's whole width.
  const DELETES: { icon: IconName; label: () => string; cmd: (c: ChainedCommands) => ChainedCommands }[] = [
    { icon: 'deleteRow', label: () => t().table.deleteRow, cmd: (c) => c.deleteRow() },
    { icon: 'deleteCol', label: () => t().table.deleteColumn, cmd: (c) => c.deleteColumn() },
    { icon: 'deleteTable', label: () => t().table.deleteTable, cmd: (c) => c.deleteTable() },
  ];

  const VALIGNS: { key: CellVerticalAlign | null; icon: 'alignTop' | 'alignMiddle' | 'alignBottom'; label: () => string }[] = [
    { key: null, icon: 'alignTop', label: () => t().table.cellAlignTop },
    { key: 'middle', icon: 'alignMiddle', label: () => t().table.cellAlignMiddle },
    { key: 'bottom', icon: 'alignBottom', label: () => t().table.cellAlignBottom },
  ];
</script>

{#if which === 'design'}
  <RibbonGroup label={t().styles.tableStyles}>
    <div class="rb-captioned" use:captionClicks>
      <TableStylePicker {editor} {tick} />
      <span class="rb-caption">{t().table.tableStyle}</span>
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.tableDecor}>
    <div class="rb-captioned" use:captionClicks>
      <ColorPicker
        {editor}
        currentColor={cellColor}
        defaultColor="#D9D9D9"
        title={t().table.cellShading}
        chevronTitle={t().table.chooseCellColor}
        clearLabel={t().table.noFill}
        onApply={(c) => editor?.chain().focus().setCellAttribute('backgroundColor', c).run()}
        onClear={() => editor?.chain().focus().setCellAttribute('backgroundColor', null).run()}
        icon={shadeIcon}
      />
      <span class="rb-caption">{t().table.cellShading}</span>
    </div>
    <div class="rb-captioned" use:captionClicks>
      <TableBorderPicker {editor} {tick} />
      <span class="rb-caption">{t().borders.title}</span>
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.tableOptions}>
    <div class="rb-col">
      <RibbonButton variant="small" icon="headerRow" label={t().styles.regions.headerRow} active={isHeaderRow} onclick={() => run((c) => c.toggleHeaderRowStyle())} />
      <RibbonButton variant="small" icon="firstColumn" label={t().styles.regions.firstColumn} active={isHeaderCol} onclick={() => run((c) => c.toggleHeaderColumnStyle())} />
      <RibbonButton
        variant="small"
        icon="headerRow"
        label={t().ribbon.repeatHeaderRow}
        title={t().ribbon.repeatHeaderRowHint}
        active={repeatsHeader}
        onclick={() => run((c) => c.updateAttributes('table', { repeatHeader: repeatsHeader ? null : true }))}
      />
    </div>
  </RibbonGroup>
{:else}
  <RibbonGroup label={t().ribbon.groups.rowsColumns}>
    <div class="rb-menu-wrap" use:clickOutside={'tableDelete'}>
      <RibbonButton
        variant="big"
        icon="deleteRow"
        label={t().common.remove}
        title={t().common.remove}
        caret
        active={isMenuOpen('tableDelete')}
        onclick={() => toggleMenu('tableDelete')}
      />
      {#if isMenuOpen('tableDelete')}
        <div class="ribbon-menu" use:anchored role="menu">
          {#each DELETES as d}
            <button role="menuitem" onclick={() => { closeMenu(); run(d.cmd); }}>
              <Icon name={d.icon} size={16} />{d.label()}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="rb-mini-sep"></div>
    <div class="inserts">
      <RibbonButton variant="big" icon="rowAbove" label={t().ribbon.insertAbove} onclick={() => run((c) => c.addRowBefore())} />
      <RibbonButton variant="big" icon="rowBelow" label={t().ribbon.insertBelow} onclick={() => run((c) => c.addRowAfter())} />
      <RibbonButton variant="big" icon="colLeft" label={t().ribbon.insertLeft} onclick={() => run((c) => c.addColumnBefore())} />
      <RibbonButton variant="big" icon="colRight" label={t().ribbon.insertRight} onclick={() => run((c) => c.addColumnAfter())} />
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.merge}>
    <RibbonButton variant="big" icon="merge" label={t().table.mergeCells} disabled={!canMerge} onclick={() => run((c) => c.mergeCells())} />
    <span class="rb-menu-wrap" use:clickOutside={'tableSplit'}>
      <button class="split-trigger" onclick={() => toggleMenu('tableSplit')} title={t().table.splitCells}>
        <RibbonButton variant="big" icon="split" label={t().table.splitCellsAria} />
      </button>
      {#if isMenuOpen('tableSplit')}
        <div class="table-dialog" use:anchored>
          <TableSplitDialog
            onApply={(cols, rows) => { closeMenu(); editor?.chain().focus().splitCellInto(cols, rows).run(); }}
            onClose={closeMenu}
          />
        </div>
      {/if}
    </span>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().align.section}>
    {#each VALIGNS as v}
      <RibbonButton
        icon={v.icon}
        title={v.label()}
        active={vAlign === v.key}
        onclick={() => editor?.chain().focus().setCellAttribute('verticalAlign', v.key).run()}
      />
    {/each}
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.cellSize}>
    <div class="rb-menu-wrap" use:clickOutside={'cellMargins'}>
      <RibbonButton
        variant="big"
        icon="cellMargins"
        label={t().ribbon.cellMargins}
        title={t().ribbon.cellMargins}
        disabled={!padding}
        caret
        active={isMenuOpen('cellMargins')}
        onclick={() => toggleMenu('cellMargins')}
      />
      {#if isMenuOpen('cellMargins') && padding}
        <div class="ribbon-menu margin-menu" use:anchored role="menu">
          <div class="rb-menu-label">{t().ribbon.cellMargins}</div>
          <div class="margin-grid">
            {#each (['top', 'right', 'bottom', 'left'] as const) as edge, i}
              <label class="margin-field">
                <span>{t().toolbarExpanded.margins[edge]}</span>
                <input
                  type="text"
                  inputmode="decimal"
                  value={padding[i]}
                  onchange={(e) => {
                    const v = parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
                    if (!isNaN(v)) setPaddingEdge(i, Math.max(0, v));
                  }}
                />
              </label>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.tableData}>
    <span class="rb-menu-wrap" use:clickOutside={'tableSort'}>
      <button class="split-trigger" onclick={() => toggleMenu('tableSort')} title={t().table.sort}>
        <RibbonButton variant="big" icon="sortRows" label={t().table.sortAria} disabled={!inTable} />
      </button>
      {#if isMenuOpen('tableSort') && inTable}
        <div class="table-dialog" use:anchored>
          <TableSortDialog
            columns={grid.columns}
            column={grid.column}
            headerRow={grid.headerRow}
            onApply={(options) => { closeMenu(); editor?.chain().focus().sortTable(options).run(); }}
            onClose={closeMenu}
          />
        </div>
      {/if}
    </span>
    <span class="rb-menu-wrap" use:clickOutside={'tableFormula'}>
      <button class="split-trigger" onclick={() => toggleMenu('tableFormula')} title={t().table.formula}>
        <RibbonButton variant="big" icon="formula" label={t().table.formulaAria} disabled={!inTable} />
      </button>
      {#if isMenuOpen('tableFormula') && inTable}
        <div class="table-dialog" use:anchored>
          <TableFormulaDialog
            cell={grid.cell}
            initial={grid.formula}
            onApply={(formula) => { closeMenu(); editor?.chain().focus().setCellFormula(formula).run(); }}
            onClose={closeMenu}
          />
        </div>
      {/if}
    </span>
    <RibbonButton
      variant="small"
      icon="wordCount"
      label={t().table.numberRecognition}
      title={t().table.numberRecognitionHint}
      active={numberRecognition()}
      onclick={() => setNumberRecognition(!numberRecognition())}
    />
  </RibbonGroup>
{/if}

{#snippet shadeIcon()}<span class="shade-glyph"></span>{/snippet}

<style>
  .rb-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    height: 100%;
  }

  .rb-menu-wrap { position: relative; }

  /* Wrapped onto two lines, as in Word — on one they are half the group's width.
     `min-content` is what keeps the button off the label's unwrapped width, and
     the caret slot goes because the two lines already reach the group's foot. */
  .inserts {
    display: flex;
    align-items: stretch;
    gap: 2px;
  }

  .inserts :global(.rb-label) {
    width: min-content;
    white-space: normal;
    text-align: center;
    /* The two lines make this the band's tallest control, so --w-ribbon-h is cut
       to fit it: a ratio would put that height at the mercy of the font. */
    line-height: 13px;
  }

  .inserts :global(.rb-stack-caret) { display: none; }

  /* A big button wrapped in the trigger the popover hangs from; `anchored` drops
     the popover below the whole band, like every other ribbon menu. */
  .split-trigger {
    display: contents;
    border: none;
    background: none;
    padding: 0;
    cursor: pointer;
  }

  /* Out of flow before `anchored` measures, like .ribbon-menu: in flow it would
     stretch its own anchor and land that much too low. */
  .table-dialog {
    position: absolute;
    z-index: 300;
  }
  .margin-menu { min-width: 210px; }

  .margin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 2px 7px 4px;
  }

  .margin-field {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--w-font);
    font-size: 12px;
    color: var(--w-text-dim);
  }

  .margin-field input {
    width: 52px;
    height: 24px;
    border: 1px solid var(--w-border-strong);
    border-radius: 3px;
    background: var(--w-surface);
    padding: 0 5px;
    color: var(--w-text);
    font: inherit;
    text-align: right;
  }

  .margin-field input:focus { outline: none; border-color: var(--w-accent); }

  .shade-glyph {
    width: 24px;
    height: 24px;
    border: 1px solid currentColor;
    border-radius: 2px;
    background: repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 3px);
  }

</style>
