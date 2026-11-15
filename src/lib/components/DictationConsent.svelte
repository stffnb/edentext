<script lang="ts">
  // Asked once before the first dictation that the browser cannot recognize on this
  // machine: the audio then goes to its speech service. The answer yes is kept.
  import { answerDictationConsent, dictationState } from '../dictation/session.svelte';
  import { t } from '../i18n/i18n.svelte';

  let dialogEl = $state<HTMLDialogElement | null>(null);
  const asking = $derived(dictationState().asking);

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (asking && !el.open) el.showModal();
    else if (!asking && el.open) el.close();
  });
</script>

<dialog bind:this={dialogEl} class="dictation-consent" onclose={() => asking && answerDictationConsent(false)} aria-labelledby="dictation-consent-title">
  {#if asking}
    <div class="body">
      <h2 id="dictation-consent-title">{t().dictation.consentTitle}</h2>
      <p>{t().dictation.consentText}</p>
      <div class="actions">
        <button onclick={() => answerDictationConsent(false)}>{t().common.cancel}</button>
        <button class="primary" onclick={() => answerDictationConsent(true)}>{t().dictation.agree}</button>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 400px;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  h2 { margin: 0; font-size: 1rem; }
  p { margin: 0; line-height: 1.45; }

  .actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }

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
</style>
