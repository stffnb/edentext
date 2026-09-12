<script lang="ts">
  import { hasGrammar, type DocumentLanguage } from '../storage/documentLanguage';
  import { grammarEnabled, setGrammarEnabled, grammarLoading } from '../spell/grammar.svelte';
  import { t } from '../i18n/i18n.svelte';

  let { value }: { value: DocumentLanguage } = $props();
</script>

<!-- Beside the control that decides whether it is available: pick German and it
     greys out, with the reason in its tooltip. -->
<label
  class="gr-toggle"
  class:off={!hasGrammar(value)}
  title={hasGrammar(value) ? t().grammar.hint : t().grammar.unavailable}
>
  <input
    type="checkbox"
    checked={grammarEnabled()}
    disabled={!hasGrammar(value)}
    onchange={(e) => setGrammarEnabled((e.currentTarget as HTMLInputElement).checked)}
  />
  <span>{grammarLoading() ? t().grammar.loadingLabel : t().grammar.label}</span>
</label>

<style>
  .gr-toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    margin-left: 8px;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    white-space: nowrap;
    cursor: pointer;
  }

  .gr-toggle.off {
    opacity: 0.45;
    cursor: default;
  }

  .gr-toggle input {
    margin: 0;
    cursor: inherit;
  }
</style>
