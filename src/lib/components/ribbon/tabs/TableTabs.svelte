<script lang="ts">
  import type { Editor, ChainedCommands } from '@tiptap/core';
  import { isInTable, selectedRect } from '@tiptap/pm/tables';
  import { cellAttr, cellPadding, repeatsHeader } from '../../tableCells';
  import { cellSideIndex } from '../../../editor/extensions/tableView';
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
  import CaptionDialog from '../../CaptionDialog.svelte';
  import { captionClicks, anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { isHeaderStyled } from '../../../editor/extensions/tableHeaderRow';
  import type { CellPadding } from '../../../editor/extensions/tableCellPadding';
  import type { CellVerticalAlign } from '../../../editor/extensions/tableCellAlign';
  import { currentCellFormat, currentCellFormula, currentCellName, guessFormula } from '../../../editor/extensions/tableFormula';
  import type { CellFormat } from '../../../utils/cellFormat';
  import { numberRecognition, setNumberRecognition } from '../../../storage/tableOptions.svelte';
  import { t } from '../../../i18n/i18n.svelte';

  // Word splits the table's contextual tabs in two: Design paints it, Layout
  // changes its shape.
  let { editor, tick, which }: {
    editor: Editor | null;
    tick: number;
    which: 'design' | 'layout';
  } = $props();

  let captionOpen = $state(false);

  function run(cmd: (chain: ChainedCommands) => ChainedCommands) {
    if (!editor) return;
    cmd(editor.chain().focus()).run();
  }

  const canMerge = $derived(tick >= 0 && !!editor && editor.can().mergeCells());
  const inTable = $derived(tick >= 0 && !!editor && isInTable(editor.state));
  // What the sort and formula popovers open on: the grid around the cursor's cell.
  const NO_TABLE = { columns: 1, column: 0, headerRow: false, cell: null as string | null, formula: '=SUM(ABOVE)', format: null as CellFormat | null };
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
      format: currentCellFormat(editor.state),
    };
  });
  const isHeaderRow = $derived(tick >= 0 && !!editor && isHeaderStyled(editor.state, 'row'));
  const isHeaderCol = $derived(tick >= 0 && !!editor && isHeaderStyled(editor.state, 'column'));
  const repeatHeader = $derived(tick >= 0 && !!editor && repeatsHeader(editor.state));
  const cellColor = $derived(tick >= 0 && editor ? cellAttr(editor.state, 'backgroundColor') : null);
  const vAlign = $derived(tick >= 0 && editor ? cellAttr(editor.state, 'verticalAlign') : null);
  const padding = $derived(tick >= 0 && editor ? cellPadding(editor.state) : null);

  // Left and right are what the reader sees; a right-to-left table's columns run mirrored.
  const sideIndex = (i: number) => (editor ? cellSideIndex(editor.view, i) : i);

  function setPaddingEdge(i: number, cm: number) {
    if (!editor || !padding) return;
    const next = [...padding] as CellPadding;
    next[i] = cm;
    editor.chain().focus().setCellAttribute('cellPadding', next).run();
  }

  // Word folds the three deletions into one big button's menu, so the four inserts
  // beside it are the group's whole width.
  const DELETES: { key: string; icon: IconName; label: () => string; cmd: (c: ChainedCommands) => ChainedCommands }[] = [
    { key: 'deleteRow', icon: 'deleteRow', label: () => t().table.deleteRow, cmd: (c) => c.deleteRow() },
    { key: 'deleteColumn', icon: 'deleteCol', label: () => t().table.deleteColumn, cmd: (c) => c.deleteColumn() },
    { key: 'deleteTable', icon: 'deleteTable', label: () => t().table.deleteTable, cmd: (c) => c.deleteTable() },
  ];

  const VALIGNS: { key: CellVerticalAlign | null; icon: 'alignTop' | 'alignMiddle' | 'alignBottom'; label: () => string }[] = [
    { key: null, icon: 'alignTop', label: () => t().table.cellAlignTop },
    { key: 'middle', icon: 'alignMiddle', label: () => t().table.cellAlignMiddle },
    { key: 'bottom', icon: 'alignBottom', label: () => t().table.cellAlignBottom },
  ];
</script>

{#if which === 'design'}
  <RibbonGroup label={t().styles.tableStyles}>
    <div class="rb-captioned" data-cmd="tableStyle" use:captionClicks>
      <TableStylePicker {editor} {tick} />
      <span class="rb-caption">{t().table.tableStyle}</span>
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.tableDecor}>
    <div class="rb-captioned" data-cmd="cellShading" use:captionClicks>
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
    <div class="rb-captioned" data-cmd="tableBorders" use:captionClicks>
      <TableBorderPicker {editor} {tick} />
      <span class="rb-caption">{t().borders.title}</span>
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.tableOptions}>
    <div class="rb-col">
      <RibbonButton variant="small" icon="headerRow" cmd="headerRow" label={t().styles.regions.headerRow} active={isHeaderRow} onclick={() => run((c) => c.toggleHeaderRowStyle())} />
      <RibbonButton variant="small" icon="firstColumn" cmd="firstColumn" label={t().styles.regions.firstColumn} active={isHeaderCol} onclick={() => run((c) => c.toggleHeaderColumnStyle())} />
      <RibbonButton
        variant="small"
        icon="headerRow"
        cmd="repeatHeaderRow"
        label={t().ribbon.repeatHeaderRow}
        title={t().ribbon.repeatHeaderRowHint}
        active={repeatHeader}
        onclick={() => run((c) => c.updateAttributes('table', { repeatHeader: repeatHeader ? null : true }))}
      />
    </div>
  </RibbonGroup>
{:else}
  <RibbonGroup label={t().ribbon.groups.rowsColumns}>
    <div class="rb-menu-wrap" use:clickOutside={'tableDelete'}>
      <RibbonButton
        variant="big"
        icon="deleteRow"
        cmd="tableDelete"
        label={t().common.remove}
        title={t().common.remove}
        caret
        active={isMenuOpen('tableDelete')}
        onclick={() => toggleMenu('tableDelete')}
      />
      {#if isMenuOpen('tableDelete')}
        <div class="ribbon-menu" use:anchored role="menu">
          {#each DELETES as d}
            <button role="menuitem" data-cmd={`tableDelete-${d.key}`} onclick={() => { closeMenu(); run(d.cmd); }}>
              <Icon name={d.icon} size={16} />{d.label()}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="rb-mini-sep"></div>
    <div class="inserts">
      <RibbonButton variant="big" icon="rowAbove" cmd="insertAbove" label={t().ribbon.insertAbove} onclick={() => run((c) => c.addRowBefore())} />
      <RibbonButton variant="big" icon="rowBelow" cmd="insertBelow" label={t().ribbon.insertBelow} onclick={() => run((c) => c.addRowAfter())} />
      <RibbonButton variant="big" icon="colLeft" cmd="insertLeft" label={t().ribbon.insertLeft} onclick={() => run((c) => c.addColumnLeft())} />
      <RibbonButton variant="big" icon="colRight" cmd="insertRight" label={t().ribbon.insertRight} onclick={() => run((c) => c.addColumnRight())} />
    </div>
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <RibbonGroup label={t().ribbon.groups.merge}>
    <RibbonButton variant="big" icon="merge" cmd="mergeCells" label={t().table.mergeCells} title={canMerge ? t().table.mergeCells : t().table.mergeNeedsCells} disabled={!canMerge} onclick={() => run((c) => c.mergeCells())} />
    <span class="rb-menu-wrap" use:clickOutside={'tableSplit'}>
      <button class="split-trigger" onclick={() => toggleMenu('tableSplit')} title={t().table.splitCells}>
        <RibbonButton variant="big" icon="split" cmd="splitCells" label={t().table.splitCellsAria} />
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
        cmd={`cellAlign-${v.icon.slice(5)}`}
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
        cmd="cellMargins"
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
                  value={padding[sideIndex(i)]}
                  onchange={(e) => {
                    const v = parseFloat((e.currentTarget as HTMLInputElement).value.replace(',', '.'));
                    if (!isNaN(v)) setPaddingEdge(sideIndex(i), Math.max(0, v));
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
        <RibbonButton variant="big" icon="sortRows" cmd="sort" label={t().table.sortAria} disabled={!inTable} />
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
        <RibbonButton variant="big" icon="formula" cmd="tableFormula" label={t().table.formulaAria} disabled={!inTable} />
      </button>
      {#if isMenuOpen('tableFormula') && inTable}
        <div class="table-dialog" use:anchored>
          <TableFormulaDialog
            cell={grid.cell}
            initial={grid.formula}
            initialFormat={grid.format}
            onApply={(formula, format) => { closeMenu(); editor?.chain().focus().setCellFormula(formula, format).run(); }}
            onClose={closeMenu}
          />
        </div>
      {/if}
    </span>
    <RibbonButton
      variant="small"
      icon="wordCount"
      cmd="numberRecognition"
      label={t().table.numberRecognition}
      title={t().table.numberRecognitionHint}
      active={numberRecognition()}
      onclick={() => setNumberRecognition(!numberRecognition())}
    />
  </RibbonGroup>

  <div class="ribbon-sep"></div>

  <!-- Also in the References tab, where both products keep it — but that is a tab away
       from the table it captions, and this one only shows while the caret is in one. -->
  <RibbonGroup label={t().ribbon.groups.captions}>
    <RibbonButton
      variant="big"
      icon="caption"
      label={t().ribbon.insertCaption}
      title={t().caption.title}
      disabled={!inTable}
      onclick={() => (captionOpen = true)}
    />
  </RibbonGroup>
{/if}

<CaptionDialog bind:open={captionOpen} {editor} />

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
     `min-content` breaks at every space, tighter than the button's own cap. */
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
