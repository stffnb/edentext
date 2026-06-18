<script lang="ts">
  import { onMount } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import EditorComponent from './lib/editor/Editor.svelte';
  import Toolbar from './lib/editor/Toolbar.svelte';
  import ToolbarExpanded from './lib/editor/ToolbarExpanded.svelte';
  import { buildOdt, deriveFilename } from './lib/export/odt';
  import { exportPdf, printPdf } from './lib/export/pdf';
  import { supportsFsAccess, saveOdt, saveAsOdt, openOdt } from './lib/export/saveFile';
  import { importOdt } from './lib/import/odt';
  import { getPageBreakDebug } from './lib/editor/pageBreaks';
  import { getColorDebug } from './lib/editor/colorDebug';
  import { loadTheme, saveTheme, applyTheme, loadToolbarExpanded, saveToolbarExpanded, loadFormattingMarks, saveFormattingMarks, type ThemeMode } from './lib/storage/theme';
  import { loadPageMargins, savePageMargins, DEFAULT_MARGINS, type PageMargins } from './lib/storage/pageMargins';
  import { loadOrientation, saveOrientation, type Orientation } from './lib/storage/pageOrientation';
  import { loadHfDoc, saveHfDoc, loadHfDistances, saveHfDistances, hfIsEmpty, DEFAULT_HF_DISTANCES, type HfDoc, type HfZone, type HfDistances } from './lib/storage/headerFooter';
  import { loadDocName, saveDocName, stripOdtExtension, sanitizeNameForFile } from './lib/storage/documentName';

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

  // The document name (without .odt). Source of truth for the save filename;
  // set on open, editable in the header, blank → heading-derived fallback.
  let documentName: string = $state(loadDocName());

  // Shown in the empty title field: what an actual save would name the file.
  // Only computed while the field is blank (otherwise the placeholder is hidden,
  // so we skip the per-transaction getJSON).
  let namePlaceholder = $derived.by(() => {
    if (documentName.trim() || tick < 0 || !editor) return 'Untitled document';
    const base = stripOdtExtension(deriveFilename(editor.getJSON() as Parameters<typeof buildOdt>[0]));
    return base === 'document' ? 'Untitled document' : base;
  });

  function suggestedFilename(json: Parameters<typeof buildOdt>[0]): string {
    const n = documentName.trim();
    return n ? `${sanitizeNameForFile(n)}.odt` : deriveFilename(json);
  }

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

  $effect(() => {
    saveDocName(documentName);
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

  // The file the document is saved to (File System Access API). Session-only: a
  // reload restores the doc from localStorage but the first Save re-prompts.
  let fileHandle: FileSystemFileHandle | null = $state(null);
  const fsSupported = supportsFsAccess();
  let fileInput: HTMLInputElement | null = $state(null);
  let pdfBusy = $state(false);
  let exportMenuOpen = $state(false);

  // odf-kit export options for the current header/footer + page geometry.
  function hfOpts() {
    return {
      header: headerDoc, footer: footerDoc, pageCount: numPages,
      headerDistanceCm: hfDistances.header, footerDistanceCm: hfDistances.footer,
    };
  }

  function isDocNonEmpty(): boolean {
    if (!editor) return false;
    const body = editor.state.doc.textContent.length > 0 || editor.state.doc.childCount > 1;
    return body || !hfIsEmpty(headerDoc) || !hfIsEmpty(footerDoc);
  }

  function handleNew() {
    if (!editor) return;
    if (isDocNonEmpty() && !confirm('Start a new document? Any unsaved changes will be lost.')) return;
    editor.commands.setContent('<p></p>'); // onUpdate fires → autosave
    // Reset everything to defaults; the $effects persist these.
    hfActive = null;
    headerDoc = null;
    footerDoc = null;
    pageMargins = { ...DEFAULT_MARGINS };
    pageOrientation = 'portrait';
    hfDistances = { ...DEFAULT_HF_DISTANCES };
    documentName = '';
    fileHandle = null;
    editor.commands.focus();
  }

  // Replace the document with a parsed .odt; adopt its geometry/header/footer and
  // track the source handle (null for the fallback file input) so Save overwrites it.
  function applyImport(bytes: Uint8Array, handle: FileSystemFileHandle | null, sourceName?: string) {
    if (!editor) return;
    try {
      const result = importOdt(bytes);

      const hasContent = editor.state.doc.textContent.length > 0 || editor.state.doc.childCount > 1;
      if (hasContent && !confirm('Opening this file will replace the current document. Continue?')) {
        return;
      }

      editor.commands.setContent(result.content); // onUpdate fires → autosave
      // Adopt the opened file's name as the document name (drives the save filename).
      if (sourceName) documentName = stripOdtExtension(sourceName);
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
      fileHandle = handle;

      if (result.warnings.length) {
        console.warn('[import] Unsupported content in opened file:', result.warnings);
        alert(`Opened with limitations:\n• ${result.warnings.join('\n• ')}`);
      }
    } catch (err) {
      console.error('[import] Failed to open file:', err);
      alert(err instanceof Error ? err.message : 'Could not open this file.');
    }
  }

  async function handleOpen() {
    if (!editor) return;
    if (fsSupported) {
      try {
        const r = await openOdt();
        if (r) applyImport(r.bytes, r.handle, r.name);
      } catch (err) {
        if ((err as DOMException)?.name !== 'AbortError') {
          console.error('[open] Failed to open file:', err);
          alert('Could not open this file.');
        }
      }
    } else {
      fileInput?.click();
    }
  }

  async function handleImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    applyImport(new Uint8Array(await file.arrayBuffer()), null, file.name);
  }

  async function handleSave() {
    if (!editor) return;
    exportMenuOpen = false;
    const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
    try {
      const bytes = await buildOdt(json, pageMargins, pageOrientation, hfOpts());
      fileHandle = await saveOdt(bytes, suggestedFilename(json), fileHandle);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      // A stored handle may have lost permission; re-prompt via Save As.
      if (fileHandle) { fileHandle = null; await handleSaveAs(); return; }
      console.error('[save] Failed to save file:', err);
      alert('Could not save this file.');
    }
  }

  async function handleSaveAs() {
    if (!editor) return;
    exportMenuOpen = false;
    const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
    try {
      const bytes = await buildOdt(json, pageMargins, pageOrientation, hfOpts());
      fileHandle = await saveAsOdt(bytes, suggestedFilename(json));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('[save] Failed to save file:', err);
      alert('Could not save this file.');
    }
  }

  // Lay the document out into A4 pages (Paged.js) and open the print dialog so the
  // user can "Save as PDF" — vector text matching the editor, with header/footer.
  async function handleExportPdf() {
    if (!editor || pdfBusy) return;
    exportMenuOpen = false;
    pdfBusy = true;
    try {
      const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
      await exportPdf({
        source: editor.view.dom as HTMLElement,
        json,
        fileName: suggestedFilename(json),
        orientation: pageOrientation,
        numPages,
      });
    } catch (err) {
      console.error('[pdf] Export failed:', err);
      alert('Could not export to PDF.');
    } finally {
      pdfBusy = false;
    }
  }

  // Vector PDF via the browser's print dialog: crisp, tiny, fonts embedded. Tables
  // break natively; header/footer become CSS @page boxes (basic text + page numbers).
  function handlePrintPdf() {
    if (!editor) return;
    exportMenuOpen = false;
    try {
      const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
      printPdf({
        json,
        fileName: suggestedFilename(json),
        margins: pageMargins,
        orientation: pageOrientation,
        headerDoc,
        footerDoc,
      });
    } catch (err) {
      console.error('[pdf] Print failed:', err);
      alert('Could not print to PDF.');
    }
  }

  function exportMenuClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) exportMenuOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  onMount(() => {
    function onKeydown(e: KeyboardEvent) {
      // Ctrl/Cmd+S → Save (suppress the browser's save-page dialog).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

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
      {#snippet saveIcon()}
        <!-- Floppy disk -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.75 2.5h7.65L13.5 5.6V12.75a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V3.25a.75.75 0 0 1 .25-.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M5 2.5v3h4.5v-3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          <rect x="4.75" y="8.75" width="6.5" height="4.75" rx="0.5" stroke="currentColor" stroke-width="1.3"/>
        </svg>
      {/snippet}
      <div class="doc-name">
        <!-- Document with lines -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M9 1.75V5.5h3.75" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <line x1="5.5" y1="8.25" x2="10" y2="8.25" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <line x1="5.5" y1="10.5" x2="10" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <input
          class="doc-name-input"
          type="text"
          bind:value={documentName}
          placeholder={namePlaceholder}
          title="Document name"
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onblur={() => (documentName = documentName.trim())}
        />
      </div>
      <div class="file-actions">
        <button class="file-action-btn" onclick={handleNew} disabled={!editor} title="New document">
          <!-- Page with folded corner + plus -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M9 1.75V5.5h3.75" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M8 8v3.5M6.25 9.75h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="file-action-btn" onclick={handleOpen} disabled={!editor} title="Open .odt…">
          <!-- Folder -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M1.75 12.5V4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 .8.4l.7.95a1 1 0 0 0 .8.4h4.2a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
        <!-- Single Save / Export button → ODT, Raster PDF, or Vector PDF (beta). -->
        <div class="save-split" use:exportMenuClickOutside>
          <button class="file-action-btn save-main" onclick={handleSave} disabled={!editor || pdfBusy} title="Save .odt (Ctrl+S)">
            {@render saveIcon()}
          </button>
          <button
            class="save-chevron"
            onclick={() => (exportMenuOpen = !exportMenuOpen)}
            disabled={!editor || pdfBusy}
            title="Save / Export"
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          {#if exportMenuOpen}
            <div class="theme-dropdown" role="menu">
              <div class="theme-heading">Save / Export</div>
              <button class="theme-option" onclick={handleSave} role="menuitem">
                <span>ODT</span>
                <span class="theme-option-hint">OpenDocument · fully editable</span>
              </button>
              <button class="theme-option" onclick={handleExportPdf} disabled={pdfBusy} role="menuitem">
                <span>{pdfBusy ? 'Exporting…' : 'Raster PDF'}</span>
                <span class="theme-option-hint">Exact copy of the editor</span>
              </button>
              <button class="theme-option" onclick={handlePrintPdf} role="menuitem">
                <span>Vector PDF (beta)</span>
                <span class="theme-option-hint">Sharp &amp; small, but only basic headers/footers · opens print dialog</span>
              </button>
            </div>
          {/if}
        </div>
      </div>
      <div class="action-separator"></div>
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
            <div class="theme-heading">Appearance</div>
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
      <input
        bind:this={fileInput}
        type="file"
        accept=".odt,application/vnd.oasis.opendocument.text"
        class="file-input"
        onchange={handleImportFile}
      />
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
      onDebugDump={handleDebugDump}
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

  .file-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* Editable document title (Google-Docs style): borderless at rest, subtle
     frame on hover/focus. Drives the suggested save filename. */
  .doc-name {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0 0.25rem 0 0.4rem;
    margin-right: 0.25rem;
    border-radius: var(--radius);
    color: var(--color-text-muted);
    transition: background 0.15s;
  }

  .doc-name:hover,
  .doc-name:focus-within {
    background: var(--color-btn-hover);
  }

  .doc-name-input {
    width: 13rem;
    height: 1.9rem;
    padding: 0 0.25rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.15s, background 0.15s;
  }

  .doc-name-input::placeholder {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .doc-name-input:focus {
    border-color: var(--color-border);
    background: var(--color-surface);
  }

  .action-separator {
    width: 1px;
    height: 1.5rem;
    background: var(--color-border);
  }

  .file-action-btn {
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

  .file-action-btn:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .file-action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Save split button: floppy + chevron that opens the Save As menu. */
  .save-split {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .save-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .save-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 2rem;
    padding: 0;
    border: none;
    border-radius: var(--radius);
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s;
  }

  .save-chevron:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .save-chevron:disabled {
    opacity: 0.4;
    cursor: not-allowed;
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
    max-width: 240px;
    z-index: 100;
    overflow: hidden;
  }

  .theme-heading {
    padding: 0.45rem 0.75rem 0.3rem;
    border-bottom: 1px solid var(--color-border);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
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
    white-space: normal;
    line-height: 1.3;
  }

  .file-input {
    display: none;
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
