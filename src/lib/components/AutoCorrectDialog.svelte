<script lang="ts">
  import { AUTOCORRECT_KEYS, DEFAULT_AUTOCORRECT, type AutoCorrectOptions } from '../storage/autoCorrect';
  import { autoCorrect, setAutoCorrect } from '../storage/autoCorrect.svelte';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Tools ▸ AutoCorrect Options: one checkbox per rule, applied while typing.
  let { open = $bindable(false) }: { open?: boolean } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  function toggle(key: keyof AutoCorrectOptions, on: boolean) {
    setAutoCorrect({ ...autoCorrect(), [key]: on });
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => (open = false)}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().autoCorrect.title}
>
  <div class="body">
    <h2>{t().autoCorrect.title}</h2>

    {#each AUTOCORRECT_KEYS as key}
      <label class="row">
        <input type="checkbox" checked={autoCorrect()[key]} onchange={(e) => toggle(key, e.currentTarget.checked)} />
        <span>
          {t().autoCorrect[key]}
          <em>{t().autoCorrect.examples[key]}</em>
        </span>
      </label>
    {/each}

    <div class="actions">
      <button class="reset" onclick={() => setAutoCorrect({ ...DEFAULT_AUTOCORRECT })}>{t().autoCorrect.reset}</button>
      <span class="spacer"></span>
      <button class="primary" onclick={() => (open = false)}>{t().common.close}</button>
    </div>
  </div>
</dialog>

<style>
  dialog {
    /* The global reset zeroes every margin, which also takes the auto centring a
       modal <dialog> gets by default. */
    margin: auto;
    border: none;
    border-radius: 8px;
    padding: 0;
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }

  dialog::backdrop { background: rgba(0, 0, 0, 0.35); }

  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 420px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; }

  .row { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
  .row em { color: var(--color-text-muted); font-style: normal; }

  .actions { display: flex; align-items: center; gap: 8px; padding-top: 6px; }
  .spacer { flex: 1; }

  .actions button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 5px 14px;
    font: inherit;
    cursor: pointer;
  }
  .actions button:hover { background: var(--color-btn-hover); }
  .actions .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
  .actions .reset { color: var(--color-text-muted); }
</style>
