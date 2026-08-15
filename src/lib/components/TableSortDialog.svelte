<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../i18n/i18n.svelte';
  import { colName } from '../utils/tableFormula';
  import type { SortKey, SortType, TableSortOptions } from '../editor/extensions/tableSort';
  // LibreOffice's Table ▸ Sort / Word's Layout ▸ Sort: the three keys both offer, the
  // later ones off at column "none". The parent holds the cell selection it runs against.
  let {
    columns,
    column = 0,
    headerRow = false,
    onApply,
    onClose,
  }: {
    columns: number;
    /** The cursor's column, which is what the dialog offers first. */
    column?: number;
    headerRow?: boolean;
    onApply: (options: TableSortOptions) => void;
    onClose: () => void;
  } = $props();

  // Seeded from the cell the dialog opened on; from there the fields are the user's.
  const seed = untrack(() => Math.min(Math.max(0, column), Math.max(0, columns - 1)));
  let keys = $state<SortKey[]>([
    { column: seed, descending: false, type: 'auto' },
    { column: -1, descending: false, type: 'auto' },
    { column: -1, descending: false, type: 'auto' },
  ]);
  let header = $state(untrack(() => headerRow));
  let root = $state<HTMLElement | null>(null);

  $effect(() => {
    queueMicrotask(() => root?.querySelector('select')?.focus());
  });

  const types: { v: SortType; label: string }[] = $derived([
    { v: 'auto', label: t().table.sortTypeAuto },
    { v: 'number', label: t().table.sortTypeNumber },
    { v: 'text', label: t().table.sortTypeText },
  ]);

  const apply = () => onApply({ keys: keys.filter((k) => k.column >= 0), headerRow: header });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

<div
  class="sort-dialog"
  bind:this={root}
  role="dialog"
  tabindex="-1"
  aria-label={t().table.sortDialogLabel}
  onkeydown={onKeydown}
>
  <div class="sort-keys">
    {#each keys as key, i}
      <span class="sort-label">{i === 0 ? t().table.sortBy : t().table.sortThenBy}</span>
      <select bind:value={key.column} aria-label={i === 0 ? t().table.sortBy : t().table.sortThenBy}>
        {#if i > 0}<option value={-1}>{t().table.sortNone}</option>{/if}
        {#each Array.from({ length: columns }, (_, c) => c) as c}
          <option value={c}>{colName(c)}</option>
        {/each}
      </select>
      <select bind:value={key.type} aria-label={t().table.sortType} disabled={key.column < 0}>
        {#each types as ty}<option value={ty.v}>{ty.label}</option>{/each}
      </select>
      <select bind:value={key.descending} aria-label={t().table.sortDirection} disabled={key.column < 0}>
        <option value={false}>{t().table.sortAscending}</option>
        <option value={true}>{t().table.sortDescending}</option>
      </select>
    {/each}
  </div>
  <label class="sort-radio">
    <input type="checkbox" bind:checked={header} />
    <span>{t().table.sortHeaderRow}</span>
  </label>
  <div class="sort-actions">
    <span class="sort-spacer"></span>
    <button class="sort-cancel" onclick={onClose}>{t().common.cancel}</button>
    <button class="sort-apply" onclick={apply}>{t().common.ok}</button>
  </div>
</div>

<style>
  .sort-dialog {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  .sort-keys {
    display: grid;
    grid-template-columns: auto auto auto auto;
    align-items: center;
    gap: 0.35rem 0.4rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }

  select {
    min-width: 4.5rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }

  select:disabled { opacity: 0.5; }

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
