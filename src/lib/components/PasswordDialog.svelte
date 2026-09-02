<script lang="ts">
  import { t } from '../i18n/i18n.svelte';

  // Two jobs, one dialog: setting the password a document is saved with, and asking
  // for the one an encrypted document was saved with.
  let { open = $bindable(false), mode, hasPassword = false, wrong = false, onApply, onCancel }: {
    open?: boolean;
    mode: 'set' | 'ask';
    hasPassword?: boolean;
    wrong?: boolean;
    onApply: (password: string | null) => void;
    onCancel?: () => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let firstInput = $state<HTMLInputElement | null>(null);
  let password = $state('');
  let repeat = $state('');
  let show = $state(false);

  const mismatch = $derived(mode === 'set' && repeat !== '' && password !== repeat);
  const canApply = $derived(password !== '' && (mode === 'ask' || password === repeat));

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  });

  $effect(() => {
    if (!open) return;
    password = '';
    repeat = '';
    show = false;
    queueMicrotask(() => firstInput?.focus());
  });

  function apply(value: string | null) {
    onApply(value);
    open = false;
  }

  function cancel() {
    open = false;
    onCancel?.();
  }
</script>

{#snippet peek()}
  <button
    class="peek"
    type="button"
    aria-label={show ? t().password.hide : t().password.show}
    title={show ? t().password.hide : t().password.show}
    onclick={() => (show = !show)}
  >
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1.5 8S4 4 8 4s6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4z" />
      <path d="M8 9.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5z" />
      {#if !show}<path d="M3 13 13 3" />{/if}
    </svg>
  </button>
{/snippet}

<dialog
  bind:this={dialogEl}
  onclose={cancel}
  onclick={(e) => e.target === dialogEl && cancel()}
  aria-label={mode === 'set' ? t().password.setTitle : t().password.askTitle}
>
  <div class="body">
    <h2>{mode === 'set' ? t().password.setTitle : t().password.askTitle}</h2>

    {#if wrong}<p class="wrong">{t().password.wrong}</p>{/if}

    <div class="row">
      <label>
        <span>{t().password.password}</span>
        <input
          bind:this={firstInput}
          type={show ? 'text' : 'password'}
          bind:value={password}
          autocomplete="off"
          spellcheck="false"
          onkeydown={(e) => { if (e.key === 'Enter' && canApply) apply(password); }}
        />
      </label>
      {@render peek()}
    </div>

    {#if mode === 'set'}
      <div class="row">
        <label>
          <span>{t().password.repeat}</span>
          <input
            type={show ? 'text' : 'password'}
            bind:value={repeat}
            autocomplete="off"
            spellcheck="false"
            onkeydown={(e) => { if (e.key === 'Enter' && canApply) apply(password); }}
          />
        </label>
        {@render peek()}
      </div>
      {#if mismatch}<p class="wrong">{t().password.mismatch}</p>{/if}
      <p class="note">{t().password.note}</p>
    {/if}

    <div class="actions">
      {#if mode === 'set' && hasPassword}
        <button onclick={() => apply(null)}>{t().password.remove}</button>
      {/if}
      <span class="spacer"></span>
      <button onclick={cancel}>{t().common.cancel}</button>
      <button class="primary" disabled={!canApply} onclick={() => apply(password)}>
        {t().common.ok}
      </button>
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
    width: 360px;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { font-size: 1rem; margin-bottom: 4px; }

  .row { display: flex; align-items: center; gap: 8px; }
  .row label { display: contents; }
  .row span { flex: 1; color: var(--color-text-muted); }

  input {
    height: 26px;
    width: 200px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }

  .peek {
    display: flex;
    border: none;
    background: none;
    color: var(--color-text-muted);
    padding: 2px;
    cursor: pointer;
  }
  .peek:hover { color: var(--color-text); }
  .peek svg { width: 16px; height: 16px; }

  .note { color: var(--color-text-muted); line-height: 1.35; }
  .wrong { color: #c62828; }

  .actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
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
  .actions button:disabled { opacity: 0.5; cursor: default; }
  .actions .primary { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }
</style>
