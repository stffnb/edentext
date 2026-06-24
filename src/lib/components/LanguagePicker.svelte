<script lang="ts">
  import { LANGUAGES, NO_LANGUAGE, type DocumentLanguage } from '../storage/documentLanguage';

  let {
    value,
    onChange,
  }: {
    value: DocumentLanguage;
    onChange: (code: DocumentLanguage) => void;
  } = $props();
</script>

<label class="lang-picker" title="Spell-check language">
  <svg width="13" height="13" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <path d="M2 13l3-8 3 8M3.2 10.5h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 14.5l1.6-1.6 1.6 1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
  <select
    aria-label="Spell-check language"
    onchange={(e) => onChange((e.currentTarget as HTMLSelectElement).value)}
  >
    {#each LANGUAGES as l}
      <option value={l.code} selected={l.code === value}>{l.label}</option>
    {/each}
    <option value={NO_LANGUAGE} selected={value === NO_LANGUAGE}>No spell check</option>
  </select>
</label>

<style>
  .lang-picker {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--color-text);
    cursor: pointer;
  }

  .lang-picker svg {
    flex: none;
    opacity: 0.8;
  }

  select {
    appearance: none;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    padding: 1px 2px;
    border-radius: 2px;
    cursor: pointer;
  }

  select:hover {
    background: var(--color-btn-hover);
  }

  /* The option list is OS-drawn; keep its text legible in dark themes. */
  option {
    color: initial;
  }
</style>
