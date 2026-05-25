<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import EditorComponent from './lib/editor/Editor.svelte';
  import Toolbar from './lib/editor/Toolbar.svelte';
  import { exportToOdt } from './lib/export/odt';
  import { loadTheme, saveTheme, applyTheme, type ThemeMode } from './lib/storage/theme';

  let editor: Editor | null = $state(null);
  let tick: number = $state(0);

  let themeMode: ThemeMode = $state(loadTheme());
  let themeOpen = $state(false);

  function selectTheme(m: ThemeMode) {
    themeMode = m;
    saveTheme(m);
    applyTheme(m);
    themeOpen = false;
  }

  function clickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) themeOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  async function handleExport() {
    if (editor) await exportToOdt(editor);
  }
</script>

<main>
  <header>
    <Toolbar {editor} {tick} />
    <div class="header-actions">
      <div class="theme-wrap" use:clickOutside>
        <button
          class="theme-btn"
          onclick={() => (themeOpen = !themeOpen)}
          title="Appearance"
          aria-haspopup="true"
          aria-expanded={themeOpen}
        >
          {#if themeMode === 'light'}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="2.8" stroke="currentColor" stroke-width="1.5"/>
              <line x1="8" y1="1" x2="8" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="8" y1="13" x2="8" y2="15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="1" y1="8" x2="3" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="13" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="2.93" y1="2.93" x2="4.34" y2="4.34" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="11.66" y1="11.66" x2="13.07" y2="13.07" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="2.93" y1="13.07" x2="4.34" y2="11.66" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="11.66" y1="4.34" x2="13.07" y2="2.93" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          {:else if themeMode === 'dark'}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          {:else}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
              <line x1="5.5" y1="14" x2="10.5" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="8" y1="11" x2="8" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          {/if}
        </button>
        {#if themeOpen}
          <div class="theme-dropdown" role="menu">
            {#each ([['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']] as const) as [m, label]}
              <button
                class="theme-option"
                class:selected={themeMode === m}
                onclick={() => selectTheme(m)}
                role="menuitem"
              >{label}</button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="export-btn" onclick={handleExport} disabled={!editor}>
        Download .odt
      </button>
    </div>
  </header>
  <EditorComponent bind:editor bind:tick />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    background: var(--color-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    margin-right: 1rem;
  }

  .theme-wrap {
    position: relative;
  }

  .theme-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s;
  }

  .theme-btn:hover {
    background: var(--color-btn-hover);
  }

  .theme-dropdown {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    min-width: 100px;
    z-index: 100;
    overflow: hidden;
  }

  .theme-option {
    display: block;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .theme-option:hover {
    background: var(--color-btn-hover);
  }

  .theme-option.selected {
    color: var(--color-primary);
    font-weight: 600;
  }

  .export-btn {
    margin-left: 0;
    margin-right: 0;
    padding: 0.4rem 1rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }

  .export-btn:hover:not(:disabled) {
    background: var(--color-primary-hover);
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
