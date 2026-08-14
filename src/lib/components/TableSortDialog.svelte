<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  import { colName } from '../utils/tableFormula';
  import type { TableSortOptions } from '../editor/extensions/tableSort';
  // LibreOffice's Table ▸ Sort / Word's Layout ▸ Sort, on the one key both put
  // first. The parent owns `open` and holds the cell selection the sort runs against.
  let {
    open,
    top,
    left,
    columns,
    column = 0,
    headerRow = false,
    onApply,
    onClose,
  }: {
    open: boolean;
    top: number;
    left: number;
    columns: number;
    /** The cursor's column, which is what the dialog offers first. */
    column?: number;
    headerRow?: boolean;
    onApply: (options: TableSortOptions) => void;
    onClose: () => void;
  } = $props();

  let pick = $state(0);
  let header = $state(false);
  let descending = $state(false);
  let firstField = $state<HTMLSelectElement | null>(null);

  $effect(() => {
    if (open) {
      pick = Math.min(Math.max(0, column), Math.max(0, columns - 1));
      header = headerRow;
      descending = false;
      queueMicrotask(() => firstField?.focus());
    }
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); onApply({ column: pick, descending, headerRow: header }); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

{#if open}
  <div
    class="sort-dialog"
    style="top: {top}px; left: {left}px;"
    role="dialog"
    tabindex="-1"
    aria-label={t().table.sortDialogLabel}
    onkeydown={onKeydown}
  >
    <label class="sort-row">
      <span>{t().table.sortBy}</span>
      <select bind:this={firstField} bind:value={pick}>
        {#each Array.from({ length: columns }, (_, i) => i) as i}
          <option value={i}>{colName(i)}</option>
        {/each}
      </select>
    </label>
    <div class="sort-dirs" role="radiogroup" aria-label={t().table.sortDialogLabel}>
      {#each [{ v: false, label: t().table.sortAscending }, { v: true, label: t().table.sortDescending }] as d}
        <label class="sort-radio">
          <input type="radio" value={d.v} bind:group={descending} />
          <span>{d.label}</span>
        </label>
      {/each}
    </div>
    <label class="sort-radio">
      <input type="checkbox" bind:checked={header} />
      <span>{t().table.sortHeaderRow}</span>
    </label>
    <div class="sort-actions">
      <span class="sort-spacer"></span>
      <button class="sort-cancel" onclick={onClose}>{t().common.cancel}</button>
      <button class="sort-apply" onclick={() => onApply({ column: pick, descending, headerRow: header })}>
        {t().common.ok}
      </button>
    </div>
  </div>
{/if}

<style>
  .sort-dialog {
    position: absolute;
    /* Sit just above the table's top-left corner, like TableToolbar. */
    transform: translateY(calc(-100% - 6px));
    z-index: 300;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  .sort-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }

  select {
    min-width: 5rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }

  .sort-dirs {
    display: flex;
    gap: 0.8rem;
  }

  .sort-radio {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }

  .sort-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .sort-spacer { flex: 1; }

  .sort-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .sort-actions button:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .sort-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
</style>
