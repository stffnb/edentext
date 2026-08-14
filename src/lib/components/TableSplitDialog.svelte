<script lang="ts">
  import { t } from '../i18n/i18n.svelte';
  // Word/LibreOffice "Split Cells…" popover: collects column + row counts. The parent
  // mounts it and runs the splitCellInto command against the saved cell selection
  // (focus moves to the inputs, like LinkDialog/TablePicker).
  let {
    onApply,
    onClose,
  }: {
    onApply: (cols: number, rows: number) => void;
    onClose: () => void;
  } = $props();

  const MIN = 1;
  const MAX = 20;

  let colsInput = $state('2');
  let rowsInput = $state('1');
  let firstField = $state<HTMLInputElement | null>(null);

  $effect(() => {
    queueMicrotask(() => firstField?.focus());
    queueMicrotask(() => firstField?.select());
  });

  function clamp(v: string): number {
    const n = Math.round(parseFloat(v));
    if (!Number.isFinite(n)) return MIN;
    return Math.max(MIN, Math.min(MAX, n));
  }

  function apply() {
    onApply(clamp(colsInput), clamp(rowsInput));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

<div class="split-dialog" role="dialog" tabindex="-1" aria-label={t().table.splitDialogLabel}>
  <div class="split-fields">
    <label>
      <span>{t().table.columns}</span>
      <input
        bind:this={firstField}
        bind:value={colsInput}
        type="number"
        min={MIN}
        max={MAX}
        onkeydown={onKeydown}
      />
    </label>
    <label>
      <span>{t().table.rowsField}</span>
      <input
        bind:value={rowsInput}
        type="number"
        min={MIN}
        max={MAX}
        onkeydown={onKeydown}
      />
    </label>
  </div>
  <div class="split-actions">
    <span class="split-spacer"></span>
    <button class="split-cancel" onclick={onClose}>{t().common.cancel}</button>
    <button class="split-apply" onclick={apply}>{t().table.split}</button>
  </div>
</div>

<style>
  .split-dialog {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  .split-fields {
    display: flex;
    gap: 0.6rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }

  input {
    width: 4.5rem;
    box-sizing: border-box;
    padding: 0.35rem 0.45rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.85rem;
  }

  .split-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .split-spacer { flex: 1; }

  .split-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .split-actions button:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .split-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
</style>
