<script lang="ts">
  import { onMount } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '@tiptap/core';
  import EditorComponent from './lib/components/Editor.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import ToolbarExpanded from './lib/components/ToolbarExpanded.svelte';
  import { buildOdt, deriveFilename } from './lib/export/odt';
  import { exportPdf, printPdf } from './lib/export/pdf';
  import { supportsFsAccess, saveOdt, saveAsOdt, openOdt } from './lib/export/saveFile';
  import { importOdt } from './lib/import/odt';
  import { getPageBreakDebug } from './lib/editor/extensions/pageBreaks';
  import { getColorDebug } from './lib/utils/colorDebug';
  import { countText, type TextStats } from './lib/utils/wordCount';
  import { loadTheme, saveTheme, applyTheme, loadToolbarExpanded, saveToolbarExpanded, loadFormattingMarks, saveFormattingMarks, type ThemeMode } from './lib/storage/theme';
  import { loadPageMargins, savePageMargins, DEFAULT_MARGINS, type PageMargins } from './lib/storage/pageMargins';
  import { loadOrientation, saveOrientation, type Orientation } from './lib/storage/pageOrientation';
  import { loadHfDoc, saveHfDoc, loadHfDistances, saveHfDistances, hfIsEmpty, DEFAULT_HF_DISTANCES, type HfDoc, type HfZone, type HfDistances } from './lib/storage/headerFooter';
  import { loadDocName, saveDocName, stripOdtExtension, sanitizeNameForFile } from './lib/storage/documentName';
  import { loadDocumentLanguage, saveDocumentLanguage, odfFromLanguage, type DocumentLanguage } from './lib/storage/documentLanguage';
  import { spellController } from './lib/spell/controller';
  import LanguagePicker from './lib/components/LanguagePicker.svelte';
  import AboutDialog from './lib/components/AboutDialog.svelte';

  let editor: Editor | null = $state(null);
  let tick: number = $state(0);
  let currentPage: number = $state(1);
  let numPages: number = $state(1);
  let aboutOpen = $state(false);

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

  // Word/character counts for the status-bar counter. Reading `tick` makes these
  // recompute on every body transaction (incl. selection changes), so they stay
  // live without subscribing to ProseMirror directly.
  let wordCountOpen = $state(false);
  let docStats = $derived.by<TextStats>(() => {
    if (tick < 0 || !editor) return { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
    const { doc } = editor.state;
    return countText(doc, 0, doc.content.size);
  });
  let selStats = $derived.by<TextStats | null>(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    return empty ? null : countText(editor.state.doc, from, to);
  });

  let themeMode: ThemeMode = $state(loadTheme());
  let themeOpen = $state(false);
  let toolbarExpanded = $state(loadToolbarExpanded());
  let showFormattingMarks = $state(loadFormattingMarks());
  let zoom = $state(Math.max(20, Math.min(300, parseInt(localStorage.getItem('odf-editor-zoom') ?? '100', 10))));
  let pageMargins: PageMargins = $state(loadPageMargins());
  let pageOrientation: Orientation = $state(loadOrientation());

  // The document's spell-check language; round-trips through the .odt. The effect
  // below persists it and switches the shared spell controller (loads the dict).
  let documentLanguage: DocumentLanguage = $state(loadDocumentLanguage());

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
    saveDocumentLanguage(documentLanguage);
    void spellController.setLanguage(documentLanguage);
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

  // Combined height + opacity transition: the extended toolbar slides and fades
  // in/out as one motion when the toolbar is expanded/collapsed.
  function expand(node: HTMLElement, { duration = 180 } = {}) {
    const h = node.scrollHeight;
    return {
      duration,
      easing: cubicOut,
      css: (t: number) => `overflow: hidden; height: ${t * h}px; opacity: ${t};`,
    };
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
      // Adopt the document's spell-check language (the $effect switches the
      // controller + loads its dictionary). null = file declared none; keep ours.
      if (result.language) documentLanguage = result.language;
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
      const bytes = await buildOdt(json, pageMargins, pageOrientation, hfOpts(), odfFromLanguage(documentLanguage));
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
      const bytes = await buildOdt(json, pageMargins, pageOrientation, hfOpts(), odfFromLanguage(documentLanguage));
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

  function wordCountClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) wordCountOpen = false;
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
      // Ctrl/Cmd+P → Print the paginated document (not the whole app UI).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        handlePrintPdf();
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
  <header class:expanded={toolbarExpanded}>
    <button class="logo-btn" onclick={() => (aboutOpen = true)} aria-label="About PrimeText" title="About PrimeText">
      <img src="/PrimeText.png" alt="PrimeText" class="app-logo" />
    </button>
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
          <div class="save-control">
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
          </div>
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
        <button class="file-action-btn" onclick={handlePrintPdf} disabled={!editor} title="Print (Ctrl+P)">
          <!-- Printer -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.5 6V2.25h7V6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M4.5 12H3.25A1.25 1.25 0 0 1 2 10.75V7.25A1.25 1.25 0 0 1 3.25 6h9.5A1.25 1.25 0 0 1 14 7.25v3.5A1.25 1.25 0 0 1 12.75 12H11.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <rect x="4.5" y="10" width="7" height="4" rx="0.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
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
  <div class="toolbar-secondary" class:expanded={toolbarExpanded}>
    <button
      class="expand-toggle"
      class:active={toolbarExpanded}
      onclick={toggleToolbar}
      title={toolbarExpanded ? 'Hide extra tools' : 'Show extra tools'}
      aria-expanded={toolbarExpanded}
    >
      <!-- Sliders icon -->
      <svg class="tools-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <circle cx="5" cy="4" r="1.5" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.2"/>
        <circle cx="10" cy="8" r="1.5" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.2"/>
        <circle cx="7" cy="12" r="1.5" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.2"/>
      </svg>
      <span class="expand-label">Tools</span>
      <svg class="chevron" width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M2.5 1l3 3-3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    {#if toolbarExpanded}
      <div class="extended-wrap" transition:expand>
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
      </div>
    {/if}
  </div>
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
    <div class="sb-left">
      <span>Page {currentPage} of {numPages}</span>
      <div class="wordcount-wrap" use:wordCountClickOutside>
        <button
          class="wordcount-btn"
          onclick={() => (wordCountOpen = !wordCountOpen)}
          title="Statistics"
          aria-haspopup="dialog"
          aria-expanded={wordCountOpen}
        >
          {#if selStats}
            {selStats.words.toLocaleString()} of {docStats.words.toLocaleString()} words
          {:else}
            {docStats.words.toLocaleString()} {docStats.words === 1 ? 'Word' : 'Words'}
          {/if}
        </button>
        {#if wordCountOpen}
          <div class="wordcount-popup" role="dialog" aria-label="Statistics">
            <div class="wc-heading">Statistics</div>
            {#if selStats}
              <div class="wc-section">Selection</div>
              <div class="wc-row"><span>Words</span><span>{selStats.words.toLocaleString()}</span></div>
              <div class="wc-row"><span>Characters (with spaces)</span><span>{selStats.charsWithSpaces.toLocaleString()}</span></div>
              <div class="wc-row"><span>Characters (no spaces)</span><span>{selStats.charsNoSpaces.toLocaleString()}</span></div>
              <div class="wc-divider"></div>
              <div class="wc-section">Document</div>
            {/if}
            <div class="wc-row"><span>Words</span><span>{docStats.words.toLocaleString()}</span></div>
            <div class="wc-row"><span>Characters (with spaces)</span><span>{docStats.charsWithSpaces.toLocaleString()}</span></div>
            <div class="wc-row"><span>Characters (no spaces)</span><span>{docStats.charsNoSpaces.toLocaleString()}</span></div>
            <div class="wc-row"><span>Paragraphs</span><span>{docStats.paragraphs.toLocaleString()}</span></div>
            <div class="wc-row"><span>Pages</span><span>{numPages.toLocaleString()}</span></div>
          </div>
        {/if}
      </div>
    </div>
    <div class="sb-center">
      <LanguagePicker value={documentLanguage} onChange={(code) => (documentLanguage = code)} />
    </div>
    <div class="sb-right">
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
    </div>
  </footer>

  <AboutDialog bind:open={aboutOpen} />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* Basic toolbar: a complete toolbar with its own divider + elevation. When the
     extended toolbar opens, those move to .toolbar-secondary so the two rows read
     as one connected toolbar (border-color/shadow transition for a smooth merge). */
  header {
    display: flex;
    align-items: center;
    background: var(--color-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
    box-shadow: var(--shadow);
    transition: border-color 0.18s, box-shadow 0.18s;
  }

  header.expanded {
    border-bottom-color: transparent;
    box-shadow: none;
  }

  .logo-btn {
    display: inline-flex;
    align-items: center;
    padding: 4px;
    margin: 0 0.25rem 0 0.5rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    cursor: pointer;
    transition: background 0.12s;
    flex-shrink: 0;
  }
  .logo-btn:hover {
    background: var(--color-btn-hover);
  }

  .app-logo {
    height: 17px;
    width: auto;
    display: block;
    opacity: 1.0;
    flex-shrink: 0;
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

  /* Standalone file actions get a hover outline; save-main lives inside
     .save-control, which carries its own shared border, so it's excluded. */
  .file-actions > .file-action-btn {
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .file-actions > .file-action-btn:hover:not(:disabled) {
    border-color: var(--color-primary);
  }

  /* Save split button: floppy + chevron that opens the Save As menu, joined in
     one bordered control whose shared border highlights on hover. */
  .save-split {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .save-control {
    display: inline-flex;
    align-items: stretch;
    height: 2rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .save-control:hover:not(:has(:disabled)) {
    border-color: var(--color-primary);
  }

  .save-control:hover:not(:has(:disabled)) .save-chevron {
    border-left-color: var(--color-border);
  }

  .save-main {
    width: auto;
    height: 100%;
    padding: 0 0.2rem 0 0.5rem;
    border-radius: 0;
  }

  .save-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 100%;
    padding: 0;
    border: none;
    border-left: 1px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .save-chevron:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .save-chevron:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Second toolbar row: collapsed it's a transparent strip holding only the
     floating Tools tab; expanded it becomes the extended-toolbar bar. */
  .toolbar-secondary {
    display: flex;
    align-items: flex-start;
    position: relative;
    /* Above the editor overlays (≤151) so the tab and extended dropdowns stay on
       top, but below the basic toolbar (200) so its dropdowns open over this row;
       the header menus sit above everything via a higher z-index. */
    z-index: 160;
    /* The toggle is absolute (adds no height): collapsed the bar is 0-height so the
       document fills up to here; expanded it grows with the extended toolbar.
       padding-left reserves the tab's column. */
    padding: 0 1rem 0 6.5rem;
    background: transparent;
    border-bottom: 1px solid transparent;
    transition: background 0.18s, border-color 0.18s, box-shadow 0.18s;
  }

  /* Shadow casts downward only (negative spread) so it doesn't bleed up into the
     junction with the basic toolbar — the two read as one seamless toolbar. */
  .toolbar-secondary.expanded {
    padding-bottom: 0.4rem;
    background: var(--color-toolbar-bg);
    border-bottom-color: var(--color-border);
    box-shadow: 0 4px 4px -2px rgba(0, 0, 0, 0.08);
  }

  .extended-wrap {
    flex: 1;
    min-width: 0;
  }

  /* "Tools" expander. Overlay (out of flow) so it never reserves row height;
     top: -1px straddles the basic toolbar's bottom border. Base shape is a normal
     pill (used when expanded); the bulged tab look is collapsed-only below. */
  .expand-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 2rem;
    padding: 0 0.55rem;
    position: absolute;
    left: 0.75rem;
    top: -1px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-toolbar-bg);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }

  /* Collapsed: the tab hangs from the basic toolbar's bottom edge — drop the top
     border and round only the bottom so the divider bulges around it, and carry
     the toolbar's elevation so it reads as part of it. */
  .toolbar-secondary:not(.expanded) .expand-toggle {
    border-top-color: transparent;
    border-radius: 0 0 var(--radius) var(--radius);
    box-shadow: var(--shadow);
  }

  .expand-toggle:hover {
    border-color: var(--color-primary);
  }

  .expand-label {
    line-height: 1;
  }

  .expand-toggle .chevron {
    transition: transform 0.2s ease;
  }

  .expand-toggle.active .chevron {
    transform: rotate(180deg);
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
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .theme-btn:hover {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
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
    z-index: 300;
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

  /* Three zones: page count left, language picker centered, zoom right. The
     equal-flex sides keep the center cell centered regardless of side widths. */
  .sb-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.85rem;
  }

  .wordcount-wrap {
    position: relative;
    display: inline-flex;
  }

  .wordcount-btn {
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    padding: 0 6px;
    height: 18px;
    border-radius: 3px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .wordcount-btn:hover {
    background: var(--color-btn-hover);
  }

  /* Opens upward from the status bar; mirrors the theme/export dropdown styling. */
  .wordcount-popup {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    min-width: 220px;
    padding: 0 0 0.35rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 300;
  }

  .wc-heading {
    padding: 0.45rem 0.75rem 0.3rem;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 0.3rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
  }

  .wc-section {
    padding: 0.25rem 0.75rem 0.1rem;
    font-size: 0.62rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .wc-row {
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    padding: 0.18rem 0.75rem;
    font-size: 0.78rem;
    color: var(--color-text);
  }

  .wc-row span:last-child {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .wc-divider {
    height: 1px;
    margin: 0.3rem 0;
    background: var(--color-border);
  }

  .sb-center {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }

  .sb-right {
    flex: 1;
    display: flex;
    justify-content: flex-end;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 4px;
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
