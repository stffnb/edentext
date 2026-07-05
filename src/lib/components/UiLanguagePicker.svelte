<script lang="ts">
  import { LOCALES, LOCALE_LABELS, type Locale } from '../i18n/config';
  import { t, locale, setLocale } from '../i18n/i18n.svelte';

  let open = $state(false);
  let currentLocale = $derived(locale());

  function pick(l: Locale) {
    open = false;
    setLocale(l);
  }

  function clickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) open = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="lang-wrap" use:clickOutside>
  <button
    class="lang-btn"
    onclick={() => (open = !open)}
    title={t().appearance.language}
    aria-haspopup="true"
    aria-expanded={open}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.4"/>
      <path d="M1.75 8h12.5M8 1.75c1.8 1.7 2.8 3.9 2.8 6.25S9.8 12.55 8 14.25C6.2 12.55 5.2 10.35 5.2 8S6.2 3.45 8 1.75z"
            stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
  </button>
  {#if open}
    <div class="lang-dropdown" role="menu">
      <div class="lang-heading">{t().appearance.language}</div>
      {#each LOCALES as l}
        <button
          class="lang-option"
          class:selected={currentLocale === l}
          onclick={() => pick(l)}
          role="menuitem"
        >
          {LOCALE_LABELS[l]}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .lang-wrap {
    position: relative;
  }

  .lang-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--toolbar-btn-size);
    width: var(--toolbar-btn-size);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .lang-btn:hover {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
  }

  .lang-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    right: 0;
    min-width: 130px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .lang-heading {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .lang-option {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .lang-option:hover {
    background: var(--color-btn-hover);
  }

  .lang-option.selected {
    background: var(--color-primary);
    color: white;
  }
</style>
