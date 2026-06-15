<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import EditorComponent from './lib/editor/Editor.svelte';
  import Toolbar from './lib/editor/Toolbar.svelte';
  import ToolbarExpanded from './lib/editor/ToolbarExpanded.svelte';
  import { exportToOdt } from './lib/export/odt';
  import { importOdt } from './lib/import/odt';
  import { getPageBreakDebug } from './lib/editor/pageBreaks';
  import { getColorDebug } from './lib/editor/colorDebug';
  import { loadTheme, saveTheme, applyTheme, loadToolbarExpanded, saveToolbarExpanded, loadFormattingMarks, saveFormattingMarks, type ThemeMode } from './lib/storage/theme';
  import { loadPageMargins, savePageMargins, type PageMargins } from './lib/storage/pageMargins';
  import { loadOrientation, saveOrientation, type Orientation } from './lib/storage/pageOrientation';
  import { loadHfDoc, saveHfDoc, loadHfDistances, saveHfDistances, DEFAULT_HF_DISTANCES, type HfDoc, type HfZone, type HfDistances } from './lib/storage/headerFooter';

  let editor: Editor | null = $state(null);
  let tick: number = $state(0);
  let currentPage: number = $state(1);
  let numPages: number = $state(1);

  // Header/footer content + live-edit state. While a zone is being edited, the
  // top toolbars target hfEditor instead of the body editor (activeEditor below).
  let headerDoc: HfDoc = $state(loadHfDoc('header'));
  let footerDoc: HfDoc = $state(loadHfDoc('footer'));
  let hfDistances: HfDistances = $state(loadHfDistances());
  let hfEditor: Editor | null = $state(null);
  let hfActive: HfZone | null = $state(null);
  let hfTick: number = $state(0);

  let activeEditor = $derived(hfActive ? hfEditor : editor);
  let activeTick = $derived(hfActive ? hfTick : tick);

  let themeMode: ThemeMode = $state(loadTheme());
  let themeOpen = $state(false);
  let toolbarExpanded = $state(loadToolbarExpanded());
  let showFormattingMarks = $state(loadFormattingMarks());
  let zoom = $state(Math.max(20, Math.min(300, parseInt(localStorage.getItem('odf-editor-zoom') ?? '100', 10))));
  let pageMargins: PageMargins = $state(loadPageMargins());
  let pageOrientation: Orientation = $state(loadOrientation());

  $effect(() => {
    saveFormattingMarks(showFormattingMarks);
  });

  $effect(() => {
    savePageMargins(pageMargins);
  });

  $effect(() => {
    saveOrientation(pageOrientation);
  });

  $effect(() => {
    saveHfDoc('header', headerDoc);
  });

  $effect(() => {
    saveHfDoc('footer', footerDoc);
  });

  $effect(() => {
    saveHfDistances(hfDistances);
  });

  function setZoom(value: number) {
    zoom = Math.max(20, Math.min(300, value));
    localStorage.setItem('odf-editor-zoom', String(zoom));
  }

  function selectTheme(m: ThemeMode) {
    themeMode = m;
    saveTheme(m);
    applyTheme(m);
    themeOpen = false;
  }

  function toggleToolbar() {
    toolbarExpanded = !toolbarExpanded;
    saveToolbarExpanded(toolbarExpanded);
  }

  function clickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) themeOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  async function handleExport() {
    if (editor) {
      await exportToOdt(editor, pageMargins, pageOrientation, {
        header: headerDoc, footer: footerDoc, pageCount: numPages,
        headerDistanceCm: hfDistances.header, footerDistanceCm: hfDistances.footer,
      });
    }
  }

  let fileInput: HTMLInputElement | null = $state(null);

  async function handleImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file || !editor) return;

    try {
      const result = importOdt(new Uint8Array(await file.arrayBuffer()));

      const hasContent = editor.state.doc.textContent.length > 0 || editor.state.doc.childCount > 1;
      if (hasContent && !confirm('Opening this file will replace the current document. Continue?')) {
        return;
      }

      editor.commands.setContent(result.content); // onUpdate fires → autosave
      // Adopt the document's page geometry; the $effects persist it and
      // Editor.svelte re-paginates.
      if (result.margins) pageMargins = result.margins;
      if (result.orientation) pageOrientation = result.orientation;
      // Adopt header/footer (null clears the zone); end any active edit.
      hfActive = null;
      headerDoc = result.header;
      footerDoc = result.footer;
      hfDistances = {
        header: result.headerDistanceCm ?? DEFAULT_HF_DISTANCES.header,
        footer: result.footerDistanceCm ?? DEFAULT_HF_DISTANCES.footer,
      };

      if (result.warnings.length) {
        console.warn('[import] Unsupported content in opened file:', result.warnings);
        alert(`Opened with limitations:\n• ${result.warnings.join('\n• ')}`);
      }
    } catch (err) {
      console.error('[import] Failed to open file:', err);
      alert(err instanceof Error ? err.message : 'Could not open this file.');
    }
  }

  function handleDebugDump() {
    if (!editor) return;
    const snapshot = getPageBreakDebug(editor.view);
    if (!snapshot) {
      console.warn('[debug] No page-break snapshot yet — try again after the editor has rendered.');
      return;
    }
    const payload = {
      capturedAt: new Date().toISOString(),
      zoom,
      doc: editor.getJSON(),
      pageBreaks: snapshot,
      colors: getColorDebug(editor),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pagebreak-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<main>
  <header>
    <Toolbar editor={activeEditor} tick={activeTick} />
    <div class="header-actions">
      <button
        class="toolbar-toggle-btn"
        class:active={toolbarExpanded}
        onclick={toggleToolbar}
        title={toolbarExpanded ? 'Hide extended toolbar' : 'Show extended toolbar'}
      >
        <!-- Sliders/settings icon -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="5" cy="4" r="1.5" fill="var(--color-toolbar-bg)" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="10" cy="8" r="1.5" fill="var(--color-toolbar-bg)" stroke="currentColor" stroke-width="1.2"/>
          <circle cx="7" cy="12" r="1.5" fill="var(--color-toolbar-bg)" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
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
          {:else if themeMode === 'allBlack'}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="5.5" fill="currentColor"/>
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
            {#each ([['light', 'Light'], ['dark', 'Dark'], ['allBlack', 'AllBlack'], ['auto', 'Auto']] as const) as [m, label]}
              <button
                class="theme-option"
                class:selected={themeMode === m}
                onclick={() => selectTheme(m)}
                role="menuitem"
              >
                <span>{label}</span>
                {#if m === 'allBlack'}
                  <span class="theme-option-hint">font colors forced white</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if import.meta.env.DEV}
        <button class="debug-btn" onclick={handleDebugDump} disabled={!editor} title="Download page-break debug snapshot">
          Debug
        </button>
      {/if}
      <input
        bind:this={fileInput}
        type="file"
        accept=".odt,application/vnd.oasis.opendocument.text"
        class="file-input"
        onchange={handleImportFile}
      />
      <button class="export-btn open-btn" onclick={() => fileInput?.click()} disabled={!editor}>
        Open .odt
      </button>
      <button class="export-btn" onclick={handleExport} disabled={!editor}>
        Download .odt
      </button>
    </div>
  </header>
  {#if toolbarExpanded}
    <ToolbarExpanded
      editor={activeEditor}
      tick={activeTick}
      bind:showFormattingMarks
      bind:pageMargins
      bind:pageOrientation
      bind:hfDistances
      hfActive={hfActive}
      onEditZone={(zone) => (hfActive = zone)}
    />
  {/if}
  <EditorComponent
    bind:editor
    bind:tick
    bind:currentPage
    bind:numPages
    bind:headerDoc
    bind:footerDoc
    bind:hfEditor
    bind:hfActive
    bind:hfTick
    {hfDistances}
    {zoom}
    {showFormattingMarks}
    {pageMargins}
    orientation={pageOrientation}
  />
  <footer class="statusbar">
    <span>Page {currentPage} of {numPages}</span>
    <div class="zoom-controls">
      <button class="zoom-btn" onclick={() => setZoom(zoom - 10)} disabled={zoom <= 20} title="Zoom out">−</button>
      <input
        type="range"
        class="zoom-slider"
        min="20"
        max="300"
        step="1"
        value={zoom}
        oninput={(e) => setZoom(parseInt((e.target as HTMLInputElement).value, 10))}
        title="Zoom"
      />
      <button class="zoom-btn" onclick={() => setZoom(zoom + 10)} disabled={zoom >= 300} title="Zoom in">+</button>
      <button class="zoom-pct" onclick={() => setZoom(100)} title="Reset to 100%">{zoom}%</button>
    </div>
  </footer>
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

  .toolbar-toggle-btn {
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

  .toolbar-toggle-btn:hover {
    background: var(--color-btn-hover);
  }

  .toolbar-toggle-btn.active {
    background: var(--color-primary);
    color: white;
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
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
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

  .theme-option-hint {
    font-size: 0.7rem;
    color: var(--color-text-muted);
    font-style: italic;
    font-weight: 400;
  }

  .file-input {
    display: none;
  }

  /* Compound selector: must outweigh the later .export-btn rules. */
  .export-btn.open-btn {
    background: transparent;
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .export-btn.open-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
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

  .debug-btn {
    padding: 0.35rem 0.7rem;
    background: transparent;
    color: var(--color-text-muted);
    border: 1px dashed var(--color-border);
    border-radius: var(--radius);
    font-size: 0.75rem;
    font-family: var(--font-sans);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }

  .debug-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
    color: var(--color-text);
  }

  .debug-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .export-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .statusbar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 26px;
    display: flex;
    align-items: center;
    padding: 0 1rem;
    background: var(--color-toolbar-bg);
    border-top: 1px solid var(--color-border);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    color: var(--color-text);
    user-select: none;
    z-index: 50;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }

  .zoom-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    border-radius: 2px;
    transition: background 0.1s;
  }

  .zoom-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .zoom-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .zoom-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 3px;
    border-radius: 2px;
    background: var(--color-border);
    outline: none;
    cursor: pointer;
  }

  .zoom-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .zoom-slider:hover::-webkit-slider-thumb,
  .zoom-slider:focus::-webkit-slider-thumb {
    background: var(--color-primary);
  }

  .zoom-slider::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border: none;
    border-radius: 50%;
    background: var(--color-text);
    cursor: pointer;
    transition: background 0.1s;
  }

  .zoom-slider:hover::-moz-range-thumb,
  .zoom-slider:focus::-moz-range-thumb {
    background: var(--color-primary);
  }

  .zoom-pct {
    min-width: 36px;
    padding: 0 3px;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    text-align: right;
    cursor: pointer;
    border-radius: 2px;
    transition: background 0.1s;
  }

  .zoom-pct:hover {
    background: var(--color-btn-hover);
  }
</style>
