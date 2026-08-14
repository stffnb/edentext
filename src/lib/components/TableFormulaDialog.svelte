<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../i18n/i18n.svelte';
  import { FORMULA_FUNCTIONS } from '../utils/tableFormula';
  // Word's Table ▸ Formula: the guessed formula, editable, plus the function list to
  // paste from. The parent mounts it and holds the cell the formula is set on.
  let {
    cell = null,
    initial = '=SUM(ABOVE)',
    onApply,
    onClose,
  }: {
    /** The cell's name (A1), which is how a formula refers to it. */
    cell?: string | null;
    initial?: string;
    onApply: (formula: string) => void;
    onClose: () => void;
  } = $props();

  // Seeded from the cell the dialog opened on; from there the field is the user's.
  let text = $state(untrack(() => initial));
  let field = $state<HTMLInputElement | null>(null);

  $effect(() => {
    queueMicrotask(() => field?.focus());
    queueMicrotask(() => field?.select());
  });

  // A formula the cell no longer has is an empty field, which clears it.
  function apply() {
    onApply(text.trim().replace(/^=/, ''));
  }

  function paste(fn: string) {
    text = text.trim() ? `${text}${fn}()` : `=${fn}()`;
    field?.focus();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
</script>

<div class="formula-dialog" role="dialog" tabindex="-1" aria-label={t().table.formulaDialogLabel}>
  <label class="formula-row">
    <span>{cell ? t().table.formulaCell(cell) : t().table.formulaField}</span>
    <input bind:this={field} bind:value={text} type="text" spellcheck="false" onkeydown={onKeydown} />
  </label>
  <div class="formula-funcs">
    {#each FORMULA_FUNCTIONS as fn}
      <button class="formula-fn" onclick={() => paste(fn)}>{fn}</button>
    {/each}
  </div>
  <div class="formula-actions">
    <span class="formula-spacer"></span>
    <button class="formula-cancel" onclick={onClose}>{t().common.cancel}</button>
    <button class="formula-apply" onclick={apply}>{t().common.ok}</button>
  </div>
</div>

<style>
  .formula-dialog {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 17rem;
    padding: 0.6rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  }

  .formula-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-text);
  }

  input {
    box-sizing: border-box;
    width: 100%;
    padding: 0.35rem 0.45rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-mono, monospace);
    font-size: 0.85rem;
  }

  .formula-funcs {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }

  .formula-fn {
    padding: 0.15rem 0.35rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.7rem;
    cursor: pointer;
  }

  .formula-fn:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }

  .formula-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .formula-spacer { flex: 1; }

  .formula-actions button {
    height: 1.8rem;
    padding: 0 0.7rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .formula-actions button:hover { background: var(--color-hover, rgba(0, 0, 0, 0.06)); }
  .formula-apply { border-color: var(--color-accent, #1a56db) !important; color: var(--color-accent, #1a56db); }
</style>
