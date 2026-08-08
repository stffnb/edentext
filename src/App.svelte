<script lang="ts">
  import { onMount, tick as domUpdated } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { Editor } from '@tiptap/core';
  import { EditorState } from '@tiptap/pm/state';
  import EditorComponent from './lib/components/Editor.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import ToolbarExpanded from './lib/components/ToolbarExpanded.svelte';
  import FindReplaceBar from './lib/components/FindReplaceBar.svelte';
  import { buildOdt, deriveFilename } from './lib/export/odt';
  import { exportPdf, printPdf, printRaster } from './lib/export/pdf';
  import { supportsFsAccess, saveOdt, saveAsOdt, saveAsDocx, openOdt } from './lib/export/saveFile';
  import { importOdt } from './lib/import/odt';
  import { importDocx } from './lib/import/docx';
  import { convertUnsupportedImages } from './lib/import/imageFormats';
  import { getPageBreakDebug } from './lib/editor/extensions/pageBreaks';
  import { getColumnsFlowDebug } from './lib/editor/extensions/columnsFlow';
  import { getTextBoxDebug } from './lib/editor/extensions/textBox';
  import { getColorDebug } from './lib/utils/colorDebug';
  import { resetHistoryLog } from './lib/utils/historyLog.svelte';
  import { countText, type TextStats } from './lib/utils/wordCount';
  import { clampZoom, wheelZoomFactor, MIN_ZOOM, MAX_ZOOM } from './lib/utils/zoom';
  import { loadTheme, saveTheme, applyTheme, loadToolbarExpanded, saveToolbarExpanded, loadFormattingMarks, saveFormattingMarks, loadRuler, saveRuler, type ThemeMode } from './lib/storage/theme';
  import { loadPageMargins, savePageMargins, DEFAULT_MARGINS, type PageMargins } from './lib/storage/pageMargins';
  import { loadOrientation, saveOrientation, type Orientation } from './lib/storage/pageOrientation';
  import { loadTabInterval, saveTabInterval, applyTabIntervalVar, DEFAULT_TAB_INTERVAL_CM } from './lib/storage/tabInterval';
  import { loadPageFormat, savePageFormat, type PageFormat } from './lib/storage/pageFormat';
  import { setStyleSheet, styleSheet } from './lib/styles/sheet.svelte';
  import { builtinStyleSheet, type StyleFamily } from './lib/styles/styleSheet';
  import { loadHfDoc, saveHfDoc, loadHfDistances, saveHfDistances, loadDifferentFirstPage, saveDifferentFirstPage, loadDifferentOddEven, saveDifferentOddEven, hfIsEmpty, DEFAULT_HF_DISTANCES, loadExtraHfSections, saveExtraHfSections, type HfDoc, type HfZone, type HfDistances, type HfSet } from './lib/storage/headerFooter';
  import { loadDocName, saveDocName, stripOdtExtension, sanitizeNameForFile } from './lib/storage/documentName';
  import { loadDocumentLanguage, saveDocumentLanguage, odfFromLanguage, type DocumentLanguage } from './lib/storage/documentLanguage';
  import { spellController } from './lib/spell/controller';
  import LanguagePicker from './lib/components/LanguagePicker.svelte';
  import UiLanguagePicker from './lib/components/UiLanguagePicker.svelte';
  import AboutDialog from './lib/components/AboutDialog.svelte';
  import StyleManagerDialog from './lib/components/StyleManagerDialog.svelte';
  import { t } from './lib/i18n/i18n.svelte';
  import { withShortcut } from './lib/i18n/shortcut';
  import { DEFAULT_SHORTCUTS, matchesEvent, shortcutHint } from './lib/editor/shortcuts';
  import { OPEN_LINK_DIALOG_EVENT } from './lib/editor/extensions/link';
  import { localizeImportMessage } from './lib/i18n/importMessages';
  import { unavailableFonts } from './lib/utils/fontDetect';
  import { registerEmbeddedFonts, clearEmbeddedFonts } from './lib/fonts/embeddedFonts';
  import { saveEmbeddedFonts, loadEmbeddedFonts, clearEmbeddedFontStore } from './lib/storage/embeddedFontStore';

  let editor: Editor | null = $state(null);
  let tick: number = $state(0);
  let currentPage: number = $state(1);
  let numPages: number = $state(1);
  let aboutOpen = $state(false);
  let styleManagerOpen = $state(false);
  let styleManagerFamily = $state<StyleFamily>('paragraph');

  function openStyleManager(family: StyleFamily) {
    styleManagerFamily = family;
    styleManagerOpen = true;
  }

  // Header/footer content + live-edit state. While a zone is being edited, the
  // top toolbars target hfEditor instead of the body editor (activeEditor below).
  let headerDoc: HfDoc = $state(loadHfDoc('header'));
  let footerDoc: HfDoc = $state(loadHfDoc('footer'));
  // First-page header/footer, shown on page 1 when the flag is on.
  let headerFirstDoc: HfDoc = $state(loadHfDoc('header', 'first'));
  let footerFirstDoc: HfDoc = $state(loadHfDoc('footer', 'first'));
  let differentFirstPage: boolean = $state(loadDifferentFirstPage());
  // Even-page header/footer, shown on even pages when the flag is on.
  let headerEvenDoc: HfDoc = $state(loadHfDoc('header', 'even'));
  let footerEvenDoc: HfDoc = $state(loadHfDoc('footer', 'even'));
  let differentOddEven: boolean = $state(loadDifferentOddEven());
  let hfDistances: HfDistances = $state(loadHfDistances());
  // Sections past the first: imported and exported, not editable (see HeaderFooterLayer).
  let extraHfSections: HfSet[] = $state(loadExtraHfSections());
  let hfEditor: Editor | null = $state(null);
  let hfActive: HfZone | null = $state(null);
  let hfTick: number = $state(0);

  let activeEditor = $derived(hfActive ? hfEditor : editor);
  let activeTick = $derived(hfActive ? hfTick : tick);

  // Find & Replace bar (searchReplace.ts). Targets the body editor; positioned just
  // below the toolbar region (toolbarRegionH tracks its height, expanded or not).
  let findOpen = $state(false);
  let findMode: 'find' | 'replace' = $state('find');
  let findNonce = $state(0);
  let toolbarRegionH = $state(0);

  function openFind(mode: 'find' | 'replace') {
    findMode = mode;
    findOpen = true;
    findNonce++;
  }

  function closeFind() {
    findOpen = false;
    editor?.commands.clearSearch();
  }

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
  let showRuler = $state(loadRuler());
  let zoom = $state(clampZoom(parseInt(localStorage.getItem('odf-editor-zoom') ?? '100', 10)));
  let pageMargins: PageMargins = $state(loadPageMargins());
  let pageOrientation: Orientation = $state(loadOrientation());
  let pageFormat: PageFormat = $state(loadPageFormat());
  let tabIntervalCm = $state(loadTabInterval());

  // The document's spell-check language; round-trips through the .odt. The effect
  // below persists it and switches the shared spell controller (loads the dict).
  let documentLanguage: DocumentLanguage = $state(loadDocumentLanguage());

  // The document name (without .odt). Source of truth for the save filename;
  // set on open, editable in the header, blank → heading-derived fallback.
  let documentName: string = $state(loadDocName());

  // Width of the hidden mirror span (below), so the title input grows/shrinks
  // with its text instead of sitting in a fixed-width box.
  let docNameSizerWidth = $state(0);

  // Shown in the empty title field: what an actual save would name the file.
  // Only computed while the field is blank (otherwise the placeholder is hidden,
  // so we skip the per-transaction getJSON).
  let namePlaceholder = $derived.by(() => {
    if (documentName.trim() || tick < 0 || !editor) return t().app.untitled;
    const base = stripOdtExtension(deriveFilename(editor.getJSON() as Parameters<typeof buildOdt>[0]));
    return base === 'document' ? t().app.untitled : base;
  });

  function suggestedFilename(json: Parameters<typeof buildOdt>[0]): string {
    const n = documentName.trim();
    return n ? `${sanitizeNameForFile(n)}.odt` : deriveFilename(json);
  }

  function suggestedFilenameDocx(json: Parameters<typeof buildOdt>[0]): string {
    const n = documentName.trim();
    return n ? `${sanitizeNameForFile(n)}.docx` : deriveFilename(json).replace(/\.odt$/, '.docx');
  }

  $effect(() => {
    saveFormattingMarks(showFormattingMarks);
  });

  $effect(() => {
    saveRuler(showRuler);
  });

  $effect(() => {
    savePageMargins(pageMargins);
  });

  $effect(() => {
    saveOrientation(pageOrientation);
  });

  $effect(() => {
    savePageFormat(pageFormat);
  });

  $effect(() => {
    saveTabInterval(tabIntervalCm);
    applyTabIntervalVar(tabIntervalCm);
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
    saveHfDoc('header', headerFirstDoc, 'first');
  });

  $effect(() => {
    saveHfDoc('footer', footerFirstDoc, 'first');
  });

  $effect(() => {
    saveHfDoc('header', headerEvenDoc, 'even');
  });

  $effect(() => {
    saveHfDoc('footer', footerEvenDoc, 'even');
  });

  $effect(() => {
    saveDifferentOddEven(differentOddEven);
    hfActive = null;
  });

  // Persist the flag and end any active header/footer edit when it flips (the live
  // editor is bound to one variant for its lifetime).
  $effect(() => {
    saveDifferentFirstPage(differentFirstPage);
    hfActive = null;
  });

  $effect(() => {
    saveHfDistances(hfDistances);
  });
  $effect(() => {
    saveExtraHfSections(extraHfSections);
  });

  $effect(() => {
    saveDocName(documentName);
  });

  function setZoom(value: number) {
    zoom = clampZoom(value);
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

  // The link dialog lives in ToolbarExpanded, which isn't mounted while the secondary
  // toolbar is collapsed — Ctrl+K and the context menu's link entry would go nowhere.
  // Expand it (not persisted) and re-fire once the dialog's own listener exists.
  $effect(() => {
    const open = () => {
      if (toolbarExpanded) return;
      toolbarExpanded = true;
      domUpdated().then(() => window.dispatchEvent(new CustomEvent(OPEN_LINK_DIALOG_EVENT)));
    };
    window.addEventListener(OPEN_LINK_DIALOG_EVENT, open);
    return () => window.removeEventListener(OPEN_LINK_DIALOG_EVENT, open);
  });

  // Horizontal toolbar scrolling: when too narrow for all buttons, the toolbar stack
  // is translated left via a custom scrollbar (a native one auto-hides on macOS), so
  // the document stays centered — the page itself never scrolls horizontally.
  const MIN_THUMB = 24;
  let toolbarClipEl: HTMLDivElement | null = $state(null);
  let toolbarStackEl: HTMLDivElement | null = $state(null);
  // The track lives inside the island (header / expanded row) so its dropdowns can
  // paint above it, and is counter-translated so it stays viewport-fixed while the
  // stack scrolls. Its width spans the visible island minus an edge inset.
  const STACK_PAD_PX = 13.6; // 0.85rem — keep in sync with .toolbar-stack padding
  const TRACK_EDGE = 20;     // track inset from the island's side edges
  let toolbarStackWidth = $state(0); // full content width of the stack
  let toolbarViewWidth = $state(0);  // visible (clipped) width
  let tbScroll = $state(0);          // current left offset in px
  let tbOverflow = $derived(Math.max(0, toolbarStackWidth - toolbarViewWidth));
  let tbTrackW = $derived(Math.max(0, toolbarViewWidth - 2 * (STACK_PAD_PX + TRACK_EDGE)));
  // Thumb: proportional, but capped short (25% of the track) so it reads clearly.
  let thumbWidth = $derived(
    toolbarStackWidth > 0
      ? Math.max(MIN_THUMB, Math.min(0.25 * tbTrackW, (toolbarViewWidth / toolbarStackWidth) * tbTrackW))
      : 0,
  );
  let thumbTravel = $derived(Math.max(0, tbTrackW - thumbWidth));
  let thumbLeft = $derived(tbOverflow > 0 ? (tbScroll / tbOverflow) * thumbTravel : 0);

  // Track the stack's content width and the visible width; clamp the offset into
  // range when either changes (e.g. window resize, toolbar expand/collapse).
  $effect(() => {
    const clip = toolbarClipEl, stack = toolbarStackEl;
    if (!clip || !stack) return;
    const measure = () => {
      toolbarViewWidth = clip.clientWidth;
      toolbarStackWidth = stack.scrollWidth;
      tbScroll = Math.min(tbScroll, Math.max(0, toolbarStackWidth - toolbarViewWidth));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(clip);
    ro.observe(stack);
    measure();
    return () => ro.disconnect();
  });

  // Wheel over the toolbar scrolls it horizontally (it has no vertical scroll), so a
  // trackpad/mouse can pan to the hidden buttons without grabbing the scrollbar.
  function onToolbarWheel(e: WheelEvent) {
    // A zoom gesture, not a pan: zoom the document rather than let the browser scale
    // the whole app. No pointer anchor here — the document isn't under the cursor.
    if (e.ctrlKey) {
      e.preventDefault();
      setZoom(zoom * wheelZoomFactor(e.deltaY, e.deltaMode));
      return;
    }
    if (tbOverflow <= 0) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (delta === 0) return;
    e.preventDefault();
    tbScroll = Math.min(tbOverflow, Math.max(0, tbScroll + delta));
  }

  // Custom scrollbar drag. All handlers live on the track; a press outside the thumb
  // first jumps it under the pointer, then both modes drag from there.
  let tbDragX = 0, tbDragScroll = 0, tbDragging = false;
  function onScrollbarPointerDown(e: PointerEvent) {
    if (thumbTravel <= 0) return;
    const track = e.currentTarget as HTMLElement;
    // The track overlays the island: suppress native text selection under the
    // drag, and re-focus manually since preventDefault also blocks click-focus.
    e.preventDefault();
    track.focus();
    const thumb = track.querySelector('.toolbar-scrollbar-thumb');
    if (!thumb?.contains(e.target as Node)) {
      const rect = track.getBoundingClientRect();
      tbScroll = Math.min(tbOverflow, Math.max(0, ((e.clientX - rect.left - thumbWidth / 2) / thumbTravel) * tbOverflow));
    }
    tbDragging = true;
    tbDragX = e.clientX;
    tbDragScroll = tbScroll;
    track.setPointerCapture(e.pointerId);
  }
  function onScrollbarPointerMove(e: PointerEvent) {
    if (!tbDragging || thumbTravel <= 0) return;
    const delta = ((e.clientX - tbDragX) / thumbTravel) * tbOverflow;
    tbScroll = Math.min(tbOverflow, Math.max(0, tbDragScroll + delta));
  }
  function onScrollbarPointerUp(e: PointerEvent) {
    tbDragging = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
  }
  function onScrollbarKeydown(e: KeyboardEvent) {
    if (thumbTravel <= 0) return;
    let next = tbScroll;
    if (e.key === 'ArrowLeft') next -= 40;
    else if (e.key === 'ArrowRight') next += 40;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tbOverflow;
    else return;
    e.preventDefault();
    tbScroll = Math.min(tbOverflow, Math.max(0, next));
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
  let docxBusy = $state(false);
  let exportMenuOpen = $state(false);

  // The editable zones as one section — section 1 of the export.
  function hfSetOfState(): HfSet {
    return {
      header: headerDoc, footer: footerDoc,
      headerFirst: headerFirstDoc, footerFirst: footerFirstDoc, differentFirstPage,
      headerEven: headerEvenDoc, footerEven: footerEvenDoc, differentOddEven,
    };
  }

  // odf-kit export options for the current header/footer + page geometry.
  function hfOpts() {
    return {
      header: headerDoc, footer: footerDoc,
      headerFirst: headerFirstDoc, footerFirst: footerFirstDoc, differentFirstPage,
      headerEven: headerEvenDoc, footerEven: footerEvenDoc, differentOddEven,
      pageCount: numPages,
      sections: [hfSetOfState(), ...extraHfSections],
      headerDistanceCm: hfDistances.header, footerDistanceCm: hfDistances.footer,
    };
  }

  function isDocNonEmpty(): boolean {
    if (!editor) return false;
    const body = editor.state.doc.textContent.length > 0 || editor.state.doc.childCount > 1;
    return body || !hfIsEmpty(headerDoc) || !hfIsEmpty(footerDoc) || !hfIsEmpty(headerFirstDoc) || !hfIsEmpty(footerFirstDoc) || !hfIsEmpty(headerEvenDoc) || !hfIsEmpty(footerEvenDoc);
  }

  // Drop the undo/redo stack after loading a document, so it can't be undone back
  // into the previous one. prosemirror-history has no clear command, so re-create
  // the state with a fresh history plugin on the same doc.
  function resetHistory() {
    if (!editor) return;
    const { state, view } = editor;
    view.updateState(EditorState.create({
      doc: state.doc, selection: state.selection, plugins: state.plugins,
    }));
    resetHistoryLog();
    tick++;
  }

  function handleNew() {
    if (!editor) return;
    if (isDocNonEmpty() && !confirm(t().dialogs.confirmNew)) return;
    editor.commands.setContent('<p></p>'); // onUpdate fires → autosave
    resetHistory();
    // Reset everything to defaults; the $effects persist these.
    hfActive = null;
    headerDoc = null;
    footerDoc = null;
    headerFirstDoc = null;
    footerFirstDoc = null;
    differentFirstPage = false;
    headerEvenDoc = null;
    footerEvenDoc = null;
    differentOddEven = false;
    pageMargins = { ...DEFAULT_MARGINS };
    pageOrientation = 'portrait';
    pageFormat = 'A4';
    tabIntervalCm = DEFAULT_TAB_INTERVAL_CM;
    hfDistances = { ...DEFAULT_HF_DISTANCES };
    extraHfSections = [];
    documentName = '';
    fileHandle = null;
    // Styles live in the document, so a new one starts from the built-ins
    setStyleSheet(builtinStyleSheet());
    clearEmbeddedFonts();
    void clearEmbeddedFontStore();
    editor.commands.focus();
  }

  // Replace the document with a parsed .odt; adopt its geometry/header/footer and
  // track the source handle (null for the fallback file input) so Save overwrites it.
  // Distinct explicit fontFamily values (textStyle marks) anywhere in a TipTap JSON tree.
  function collectFontFamilies(node: unknown, out: Set<string>): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { marks?: { type?: string; attrs?: { fontFamily?: unknown } }[]; content?: unknown[] };
    if (Array.isArray(n.marks)) {
      for (const m of n.marks) {
        if (m?.type === 'textStyle' && typeof m.attrs?.fontFamily === 'string') out.add(m.attrs.fontFamily);
      }
    }
    if (Array.isArray(n.content)) for (const c of n.content) collectFontFamilies(c, out);
  }

  async function applyImport(bytes: Uint8Array, handle: FileSystemFileHandle | null, sourceName?: string) {
    if (!editor) return;
    try {
      const isDocx = sourceName?.toLowerCase().endsWith('.docx');
      // An .ott is a template: load its content but don't bind the handle, so the
      // first Save prompts for a new .odt instead of overwriting the template.
      const isTemplate = sourceName?.toLowerCase().endsWith('.ott');
      // Pre-decode any images in a format the browser can't render (TIFF, …) to PNG.
      // Lazy: the decoder loads only when such an image is present, else this is a no-op.
      const converted = await convertUnsupportedImages(bytes);
      const result = isDocx ? importDocx(bytes, converted) : importOdt(bytes, converted);

      const hasContent = editor.state.doc.textContent.length > 0 || editor.state.doc.childCount > 1;
      if (hasContent && !confirm(t().dialogs.confirmReplace)) {
        return;
      }

      // Register the document's embedded fonts (and persist them for next reload) before
      // rendering, so its text shows in the right face and isn't flagged as missing below.
      await registerEmbeddedFonts(result.fonts);
      void saveEmbeddedFonts(result.fonts);

      editor.commands.setContent(result.content); // onUpdate fires → autosave
      resetHistory();
      // Adopt the opened file's name as the document name (drives the save filename).
      if (sourceName) documentName = stripOdtExtension(sourceName).replace(/\.docx$/i, '');
      // Adopt the document's page geometry; the $effects persist it and
      // Editor.svelte re-paginates.
      if (result.margins) pageMargins = result.margins;
      if (result.orientation) pageOrientation = result.orientation;
      if (result.format) pageFormat = result.format;
      if (result.tabIntervalCm) tabIntervalCm = result.tabIntervalCm;
      // Adopt the document's spell-check language (the $effect switches the
      // controller + loads its dictionary). null = file declared none; keep ours.
      if (result.language) documentLanguage = result.language;
      // Adopt the document's named paragraph styles (built-ins + the file's own). Table
      // styles are not stored in the file (ODF has no banding), so the registry survives —
      // an imported table finds its style again by name.
      setStyleSheet({ ...result.styles, table: styleSheet().table });
      // Adopt header/footer + first-page variants (null clears the zone); end any edit.
      hfActive = null;
      headerDoc = result.header;
      footerDoc = result.footer;
      headerFirstDoc = result.headerFirst;
      footerFirstDoc = result.footerFirst;
      differentFirstPage = result.differentFirstPage;
      headerEvenDoc = result.headerEven;
      footerEvenDoc = result.footerEven;
      differentOddEven = result.differentOddEven;
      extraHfSections = (result.hfSections ?? []).slice(1);
      hfDistances = {
        header: result.headerDistanceCm ?? DEFAULT_HF_DISTANCES.header,
        footer: result.footerDistanceCm ?? DEFAULT_HF_DISTANCES.footer,
      };
      fileHandle = isTemplate ? null : handle;

      // Warn about fonts the document uses but the browser can't render, so text
      // silently shown in a substitute (Liberation Serif) is at least flagged.
      const fontSet = new Set<string>();
      collectFontFamilies(result.content, fontSet);
      collectFontFamilies(result.header, fontSet);
      collectFontFamilies(result.footer, fontSet);
      collectFontFamilies(result.headerFirst, fontSet);
      collectFontFamilies(result.footerFirst, fontSet);
      collectFontFamilies(result.headerEven, fontSet);
      collectFontFamilies(result.footerEven, fontSet);
      const missingFonts = await unavailableFonts(fontSet);

      const warnings = result.warnings.map(localizeImportMessage);
      if (missingFonts.length) warnings.push(t().importWarn.missingFonts(missingFonts.join(', ')));
      if (warnings.length) {
        console.warn('[import] Opened file with limitations:', result.warnings, missingFonts);
        alert(t().dialogs.openedWithLimitations(warnings.join('\n• ')));
      }
    } catch (err) {
      console.error('[import] Failed to open file:', err);
      alert(err instanceof Error ? localizeImportMessage(err.message) : t().dialogs.couldNotOpen);
    }
  }

  async function handleOpen() {
    if (!editor) return;
    if (fsSupported) {
      try {
        const r = await openOdt();
        if (r) await applyImport(r.bytes, r.handle, r.name);
      } catch (err) {
        if ((err as DOMException)?.name !== 'AbortError') {
          console.error('[open] Failed to open file:', err);
          alert(t().dialogs.couldNotOpen);
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
    await applyImport(new Uint8Array(await file.arrayBuffer()), null, file.name);
  }

  async function handleSave() {
    if (!editor) return;
    exportMenuOpen = false;
    const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
    try {
      const bytes = await buildOdt(json, pageMargins, pageOrientation, hfOpts(), odfFromLanguage(documentLanguage), pageFormat, styleSheet(), tabIntervalCm);
      fileHandle = await saveOdt(bytes, suggestedFilename(json), fileHandle);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      // A stored handle may have lost permission; re-prompt via Save As.
      if (fileHandle) { fileHandle = null; await handleSaveAs(); return; }
      console.error('[save] Failed to save file:', err);
      alert(t().dialogs.couldNotSave);
    }
  }

  async function handleSaveAs() {
    if (!editor) return;
    exportMenuOpen = false;
    const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
    try {
      const bytes = await buildOdt(json, pageMargins, pageOrientation, hfOpts(), odfFromLanguage(documentLanguage), pageFormat, styleSheet(), tabIntervalCm);
      fileHandle = await saveAsOdt(bytes, suggestedFilename(json));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('[save] Failed to save file:', err);
      alert(t().dialogs.couldNotSave);
    }
  }

  // Export to Word .docx. The exporter (and the `docx` library) is lazy-loaded so it
  // never enters the initial bundle. Export-style like PDF: always prompt, no handle.
  async function handleSaveDocx() {
    if (!editor || docxBusy) return;
    exportMenuOpen = false;
    docxBusy = true;
    try {
      const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
      const { buildDocx } = await import('./lib/export/docx');
      const bytes = await buildDocx(json, pageMargins, pageOrientation, hfOpts(), odfFromLanguage(documentLanguage), pageFormat, styleSheet(), tabIntervalCm);
      await saveAsDocx(bytes, suggestedFilenameDocx(json));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('[docx] Export failed:', err);
      alert(t().dialogs.couldNotExportDocx);
    } finally {
      docxBusy = false;
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
        pageFormat,
        numPages,
      });
    } catch (err) {
      console.error('[pdf] Export failed:', err);
      alert(t().dialogs.couldNotExportPdf);
    } finally {
      pdfBusy = false;
    }
  }

  // Print via the browser's print dialog using the exact raster of the editor (tables,
  // header/footer, band masks intact) — print or "Save as PDF". Used by the printer
  // button and Ctrl+P, since the vector path re-paginates and mangles tables.
  async function handlePrint() {
    if (!editor || pdfBusy) return;
    exportMenuOpen = false;
    pdfBusy = true;
    try {
      const json = editor.getJSON() as Parameters<typeof buildOdt>[0];
      await printRaster({
        source: editor.view.dom as HTMLElement,
        json,
        fileName: suggestedFilename(json),
        orientation: pageOrientation,
        pageFormat,
        numPages,
      });
    } catch (err) {
      console.error('[pdf] Print failed:', err);
      alert(t().dialogs.couldNotPrint);
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
        pageFormat,
        headerDoc,
        footerDoc,
        headerFirstDoc,
        footerFirstDoc,
        differentFirstPage,
        headerEvenDoc,
        footerEvenDoc,
        differentOddEven,
      });
    } catch (err) {
      console.error('[pdf] Print failed:', err);
      alert(t().dialogs.couldNotPrintPdf);
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
    // Re-register the restored document's embedded fonts so it renders in the right face;
    // FontFace load fires 'loadingdone', which Editor.svelte re-paginates on.
    void loadEmbeddedFonts().then(registerEmbeddedFonts);

    // Shortcuts that must work regardless of focus and that suppress the browser's
    // own binding (save page, find, open, zoom). Everything editor-scoped lives in
    // the Shortcuts extension instead.
    const appActions: [string, () => void][] = [
      [DEFAULT_SHORTCUTS.save, handleSave],
      [DEFAULT_SHORTCUTS.open, handleOpen],
      [DEFAULT_SHORTCUTS.print, handlePrint],
      [DEFAULT_SHORTCUTS.find, () => openFind('find')],
      [DEFAULT_SHORTCUTS.replace, () => openFind('replace')],
      // Closing the bar clears the search, so F3 with no bar starts one.
      [DEFAULT_SHORTCUTS.findNext, () => (findOpen ? editor?.commands.findNext() : openFind('find'))],
      [DEFAULT_SHORTCUTS.findPrevious, () => (findOpen ? editor?.commands.findPrevious() : openFind('find'))],
      [DEFAULT_SHORTCUTS.formattingMarks, () => (showFormattingMarks = !showFormattingMarks)],
      [DEFAULT_SHORTCUTS.zoomIn, () => setZoom(zoom + 10)],
      [DEFAULT_SHORTCUTS.zoomOut, () => setZoom(zoom - 10)],
      [DEFAULT_SHORTCUTS.zoomReset, () => setZoom(100)],
    ];

    function onKeydown(e: KeyboardEvent) {
      for (const [combo, run] of appActions) {
        if (!matchesEvent(e, combo)) continue;
        e.preventDefault();
        run();
        return;
      }
      // Escape closes the bar (when it isn't handled inside an input).
      if (e.key === 'Escape' && findOpen) closeFind();
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
      columnsFlow: getColumnsFlowDebug(editor.view),
      textBoxes: getTextBoxDebug(editor.view),
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

<main style="--toolbar-overlay-h: {toolbarRegionH}px">
  {#snippet toolbarScrollbar()}
    {#if tbOverflow > 0}
      <div
        class="toolbar-scrollbar"
        style="width: {tbTrackW}px; transform: translateX({tbScroll + TRACK_EDGE}px);"
        role="scrollbar"
        tabindex={0}
        aria-orientation="horizontal"
        aria-controls="primary-toolbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(tbOverflow)}
        aria-valuenow={Math.round(tbScroll)}
        onpointerdown={onScrollbarPointerDown}
        onpointermove={onScrollbarPointerMove}
        onpointerup={onScrollbarPointerUp}
        onkeydown={onScrollbarKeydown}
      >
        <div class="toolbar-scrollbar-thumb" style="width: {thumbWidth}px; transform: translateX({thumbLeft}px);"></div>
      </div>
    {/if}
  {/snippet}
  <div class="toolbar-region" bind:clientHeight={toolbarRegionH}>
    <div class="toolbar-clip" id="primary-toolbar" bind:this={toolbarClipEl} onwheel={onToolbarWheel}>
      <div class="toolbar-stack" bind:this={toolbarStackEl} style="transform: translateX(-{tbScroll}px);">
  <header class:expanded={toolbarExpanded}>
    <button class="logo-btn" onclick={() => (aboutOpen = true)} aria-label={t().about.label} title={t().about.label}>
      <img src="/EdenText.png" alt="EdenText" class="app-logo" />
    </button>
    <Toolbar editor={activeEditor} tick={activeTick} onManageStyles={openStyleManager} />
    <div class="header-actions">
      {#snippet saveIcon()}
        <!-- Floppy disk -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2.75 2.5h7.65L13.5 5.6V12.75a.75.75 0 0 1-.75.75H3.25a.75.75 0 0 1-.75-.75V3.25a.75.75 0 0 1 .25-.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M5 2.5v3h4.5v-3" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
          <rect x="4.75" y="8.75" width="6.5" height="4.75" rx="0.5" stroke="currentColor" stroke-width="1.3"/>
        </svg>
      {/snippet}
      <div class="doc-name" class:has-value={documentName.trim().length > 0}>
        <!-- Document with lines -->
        <svg class="doc-name-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <path d="M9 1.75V5.5h3.75" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          <line x1="5.5" y1="8.25" x2="10" y2="8.25" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <line x1="5.5" y1="10.5" x2="10" y2="10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <span class="doc-name-sizer" aria-hidden="true" bind:clientWidth={docNameSizerWidth}>{documentName || namePlaceholder}</span>
        <input
          class="doc-name-input"
          type="text"
          style="width: {docNameSizerWidth + 4}px"
          bind:value={documentName}
          placeholder={namePlaceholder}
          title={t().app.documentName}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onblur={() => (documentName = documentName.trim())}
        />
        <span class="doc-name-ext">.odt</span>
        <svg class="doc-name-pencil" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-7 7-2.8.9.9-2.8 7-7.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="file-actions">
        <button class="file-action-btn" onclick={handleNew} disabled={!editor} title={t().app.newDocument}>
          <!-- Page with folded corner + plus -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M9 1.75V5.5h3.75" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M8 8v3.5M6.25 9.75h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="file-action-btn" onclick={handleOpen} disabled={!editor} title={`${t().app.openOdt} (${shortcutHint('open')})`}>
          <!-- Folder -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M1.75 12.5V4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 .8.4l.7.95a1 1 0 0 0 .8.4h4.2a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
        <!-- Single Save / Export button → ODT, Raster PDF, or Vector PDF (beta). -->
        <div class="save-split" use:exportMenuClickOutside>
          <div class="save-control">
            <button class="file-action-btn save-main" onclick={handleSave} disabled={!editor || pdfBusy} title={`${t().app.save} (${withShortcut('Ctrl+S')})`}>
              {@render saveIcon()}
            </button>
            <button
              class="save-chevron"
              onclick={() => (exportMenuOpen = !exportMenuOpen)}
              disabled={!editor || pdfBusy}
              title={t().app.saveExport}
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
              <div class="theme-heading">{t().app.saveExport}</div>
              <button class="theme-option" onclick={handleSave} role="menuitem">
                <span>{t().app.odt}</span>
                <span class="theme-option-hint">{t().app.openDocument}</span>
              </button>
              <button class="theme-option" onclick={handleSaveDocx} disabled={docxBusy} role="menuitem">
                <span>{docxBusy ? t().app.exporting : t().app.wordDocx}</span>
                <span class="theme-option-hint">{t().app.microsoftWord}</span>
              </button>
              <button class="theme-option" onclick={handleExportPdf} disabled={pdfBusy} role="menuitem">
                <span>{pdfBusy ? t().app.exporting : t().app.rasterPdf}</span>
                <span class="theme-option-hint">{t().app.rasterHint}</span>
              </button>
              <button class="theme-option" onclick={handlePrintPdf} role="menuitem">
                <span>{t().app.vectorPdf}</span>
                <span class="theme-option-hint">{t().app.vectorHint}</span>
              </button>
            </div>
          {/if}
        </div>
        <button class="file-action-btn" onclick={handlePrint} disabled={!editor || pdfBusy} title={`${t().app.print} (${withShortcut('Ctrl+P')})`}>
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
          title={t().appearance.title}
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
            <div class="theme-heading">{t().appearance.title}</div>
            {#each (['light', 'dark', 'allBlack', 'auto'] as const) as m}
              <button
                class="theme-option"
                class:selected={themeMode === m}
                onclick={() => selectTheme(m)}
                role="menuitem"
              >
                <span>{t().appearance[m]}</span>
                {#if m === 'allBlack'}
                  <span class="theme-option-hint">{t().appearance.allBlackHint}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <UiLanguagePicker />
      <input
        bind:this={fileInput}
        type="file"
        accept=".odt,.ott,.docx,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.text-template,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        class="file-input"
        onchange={handleImportFile}
      />
    </div>
    {#if !toolbarExpanded}
      {@render toolbarScrollbar()}
    {/if}
  </header>
  <div class="toolbar-secondary" class:expanded={toolbarExpanded}>
    <button
      class="expand-toggle"
      class:active={toolbarExpanded}
      onclick={toggleToolbar}
      title={toolbarExpanded ? t().app.hideExtraTools : t().app.showExtraTools}
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
      <span class="expand-label">{t().app.tools}</span>
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
          bind:showRuler
          bind:pageMargins
          bind:pageOrientation
          bind:pageFormat
          bind:hfDistances
          bind:differentFirstPage
          bind:differentOddEven
          hfActive={hfActive}
          onEditZone={(zone) => (hfActive = zone)}
          onDebugDump={handleDebugDump}
          onManageTableStyles={() => openStyleManager('table')}
        />
      </div>
      {@render toolbarScrollbar()}
    {/if}
  </div>
      </div>
    </div>
  </div>
  <EditorComponent
    bind:editor
    bind:tick
    bind:currentPage
    bind:numPages
    bind:headerDoc
    bind:footerDoc
    bind:headerFirstDoc
    bind:footerFirstDoc
    {differentFirstPage}
    bind:headerEvenDoc
    bind:footerEvenDoc
    {differentOddEven}
    bind:hfEditor
    bind:hfActive
    bind:hfTick
    {hfDistances}
    {tabIntervalCm}
    {extraHfSections}
    {zoom}
    onZoom={setZoom}
    {showFormattingMarks}
    {showRuler}
    {pageMargins}
    orientation={pageOrientation}
    {pageFormat}
  />
  {#if findOpen && editor}
    <div class="find-bar-anchor" style="top: {toolbarRegionH + 8}px;">
      <FindReplaceBar {editor} {tick} mode={findMode} focusNonce={findNonce} onClose={closeFind} />
    </div>
  {/if}
  <footer class="statusbar">
    <div class="sb-left">
      <span>{t().status.pageOf(currentPage, numPages)}</span>
      <div class="wordcount-wrap" use:wordCountClickOutside>
        <button
          class="wordcount-btn"
          onclick={() => (wordCountOpen = !wordCountOpen)}
          title={t().status.statistics}
          aria-haspopup="dialog"
          aria-expanded={wordCountOpen}
        >
          {#if selStats}
            {t().status.selectedOf(selStats.words, docStats.words)}
          {:else}
            {t().status.words(docStats.words)}
          {/if}
        </button>
        {#if wordCountOpen}
          <div class="wordcount-popup" role="dialog" aria-label={t().status.statistics}>
            <div class="wc-heading">{t().status.statistics}</div>
            {#if selStats}
              <div class="wc-section">{t().status.selection}</div>
              <div class="wc-row"><span>{t().status.wordsLabel}</span><span>{t().status.num(selStats.words)}</span></div>
              <div class="wc-row"><span>{t().status.charsWithSpaces}</span><span>{t().status.num(selStats.charsWithSpaces)}</span></div>
              <div class="wc-row"><span>{t().status.charsNoSpaces}</span><span>{t().status.num(selStats.charsNoSpaces)}</span></div>
              <div class="wc-divider"></div>
              <div class="wc-section">{t().status.document}</div>
            {/if}
            <div class="wc-row"><span>{t().status.wordsLabel}</span><span>{t().status.num(docStats.words)}</span></div>
            <div class="wc-row"><span>{t().status.charsWithSpaces}</span><span>{t().status.num(docStats.charsWithSpaces)}</span></div>
            <div class="wc-row"><span>{t().status.charsNoSpaces}</span><span>{t().status.num(docStats.charsNoSpaces)}</span></div>
            <div class="wc-row"><span>{t().status.paragraphs}</span><span>{t().status.num(docStats.paragraphs)}</span></div>
            <div class="wc-row"><span>{t().status.pages}</span><span>{t().status.num(numPages)}</span></div>
          </div>
        {/if}
      </div>
    </div>
    <div class="sb-center">
      <LanguagePicker value={documentLanguage} onChange={(code) => (documentLanguage = code)} />
    </div>
    <div class="sb-right">
    <div class="zoom-controls">
      <button class="zoom-btn" onclick={() => setZoom(zoom - 10)} disabled={zoom <= MIN_ZOOM} title={t().status.zoomOut}>−</button>
      <input
        type="range"
        class="zoom-slider"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step="1"
        value={zoom}
        oninput={(e) => setZoom(parseInt((e.target as HTMLInputElement).value, 10))}
        title={t().status.zoom}
      />
      <button class="zoom-btn" onclick={() => setZoom(zoom + 10)} disabled={zoom >= MAX_ZOOM} title={t().status.zoomIn}>+</button>
      <button class="zoom-pct" onclick={() => setZoom(100)} title={t().status.resetZoom}>{zoom}%</button>
    </div>
    </div>
  </footer>

  <AboutDialog bind:open={aboutOpen} />
  <!-- One instance for every entry point (styles gallery, insert-table menu): the
       callers only say which family to land on. -->
  <StyleManagerDialog bind:open={styleManagerOpen} family={styleManagerFamily} editor={activeEditor} />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
  }

  /* Find & Replace bar: floats at the top-right of the editing area, just under the
     toolbar (top is set inline from the toolbar height). Below the toolbar's z-index. */
  .find-bar-anchor {
    position: fixed;
    right: 1.5rem;
    z-index: 190;
  }

  /* Toolbar scroll region: an overlay pinned over the full-height editor, so the document
     scrolls under the floating island and stays visible in the gaps around it. Pointer
     events pass through except on the island; z-index lifts it (and its dropdowns). */
  .toolbar-region {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 200;
    pointer-events: none;
  }

  .toolbar-region header,
  .toolbar-region .expand-toggle,
  .toolbar-region .toolbar-secondary.expanded {
    pointer-events: auto;
  }

  /* Clips the off-screen part of the toolbar horizontally only, so the page never
     scrolls sideways (document stays centered). overflow-y stays visible so the
     toolbar dropdowns can still open downward over the document. */
  .toolbar-clip {
    overflow-x: clip;
  }

  /* Both toolbar rows share one column sized to its widest row (buttons don't shrink);
     translated left via inline transform to reveal hidden buttons. min-width keeps it
     filling the viewport when the window is wide. */
  .toolbar-stack {
    width: max-content;
    min-width: 100%;
    position: relative;
    z-index: 1;
    /* Inset that floats the toolbar island off the window edges. */
    padding: 0.55rem 0.85rem 0.35rem;
  }

  /* Custom scrollbar strip under the toolbar (a native one auto-hides on macOS).
     The thumb's width/position track the visible fraction of the stack; only rendered
     when the toolbar overflows. */
  /* Runs along the inside of the island's bottom edge, counter-translated (inline style)
     so it stays put while the stack scrolls; z:1 paints it above the island surface but
     below the dropdowns (z ≥ 200 in the same stacking context). */
  .toolbar-scrollbar {
    position: absolute;
    left: 0;
    bottom: 4px;
    height: 3px;
    z-index: 1;
    background: color-mix(in srgb, var(--color-btn-hover) 35%, transparent);
    border-radius: 2px;
    cursor: pointer;
    touch-action: none;
  }

  .toolbar-scrollbar-thumb {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 2px;
    background: var(--scrollbar-thumb, var(--color-btn-hover));
    cursor: grab;
    touch-action: none;
  }

  .toolbar-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover, var(--color-text-muted));
  }

  .toolbar-scrollbar-thumb:active {
    cursor: grabbing;
  }

  /* Basic toolbar: a floating rounded "command island" (frosted card) rather than
     an edge-to-edge bar. When the extended toolbar opens, the island's bottom half
     moves to .toolbar-secondary so the two rows read as one card. */
  header {
    display: flex;
    align-items: center;
    position: relative;
    /* backdrop-filter makes this a stacking context; z-index keeps its dropdowns
       above .toolbar-secondary (160). */
    z-index: 200;
    background: color-mix(in srgb, var(--color-toolbar-bg) 92%, transparent);
    backdrop-filter: blur(12px) saturate(1.35);
    -webkit-backdrop-filter: blur(12px) saturate(1.35);
    border: 1px solid var(--color-border);
    border-radius: var(--island-radius);
    box-shadow: 0 8px 24px -12px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.06);
    transition: background 0.18s, border-color 0.18s, box-shadow 0.18s, border-radius 0.18s;
  }

  /* Brand hairline: the signature gradient along the island's top edge. */
  header::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 1.25rem;
    right: 1.25rem;
    height: 2px;
    border-radius: 2px;
    background: var(--brand-gradient);
    opacity: 0.65;
    pointer-events: none;
  }

  header.expanded {
    border-radius: var(--island-radius) var(--island-radius) 0 0;
    border-bottom-color: transparent;
    box-shadow: none;
  }

  .logo-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--toolbar-btn-size);
    padding: 0 0.4rem;
    margin: 0 0.25rem 0 1.4rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    flex-shrink: 0;
  }
  .logo-btn:hover {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
  }

  .app-logo {
    height: 15px;
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

  /* Editable document title, borderless at rest: the text auto-sizes to its content (via
     the hidden .doc-name-sizer mirror), an underline grows in on focus, a pencil hint
     fades in on hover. Drives the suggested save filename. */
  .doc-name {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.4rem;
    margin-right: 0.25rem;
    height: var(--toolbar-btn-size);
    border-radius: var(--radius);
    color: var(--color-text-muted);
    transition: background 0.15s;
  }

  .doc-name:hover,
  .doc-name:focus-within {
    background: var(--color-btn-hover);
  }

  .doc-name-icon {
    flex-shrink: 0;
    transition: color 0.15s;
  }

  .doc-name:focus-within .doc-name-icon {
    color: var(--color-primary);
  }

  /* Invisible twin of the input's text; its measured width drives the
     input's width so the field grows/shrinks like a title, not a box. */
  .doc-name-sizer {
    position: absolute;
    visibility: hidden;
    white-space: pre;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }

  .doc-name-input {
    min-width: 3ch;
    max-width: 15rem;
    height: 100%;
    padding: 0 1px;
    border: none;
    border-bottom: 1.5px solid transparent;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.85rem;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .doc-name-input::placeholder {
    color: var(--color-text-muted);
    font-style: italic;
  }

  .doc-name-input:focus {
    border-bottom-color: var(--color-primary);
  }

  .doc-name-ext {
    flex-shrink: 0;
    font-size: 0.72rem;
    letter-spacing: 0.01em;
    color: var(--color-text-muted);
    opacity: 0.7;
  }

  .doc-name:not(.has-value) .doc-name-ext {
    display: none;
  }

  .doc-name-pencil {
    flex-shrink: 0;
    color: var(--color-text-muted);
    opacity: 0;
    transform: translateX(-3px);
    transition: opacity 0.15s ease, transform 0.15s ease;
  }

  .doc-name:hover .doc-name-pencil,
  .doc-name:focus-within .doc-name-pencil {
    opacity: 1;
    transform: none;
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
    width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
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
    height: var(--toolbar-btn-size);
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
    /* The toggle is absolute while collapsed (adds no height) so the bar is 0-height
       and the document fills up to here; expanded, the toggle joins the flex flow
       (rule below) and the extended toolbar follows it — no reserved column needed. */
    padding: 0 1rem;
    background: transparent;
    border: 1px solid transparent;
    border-top: none;
    border-radius: 0 0 var(--island-radius) var(--island-radius);
    transition: background 0.18s, border-color 0.18s, box-shadow 0.18s;
  }

  /* Expanded it becomes the island's bottom half: same frosted fill, side/bottom
     borders and the bottom corner radius complete the card. Shadow casts downward
     only so it doesn't bleed up into the junction with the basic toolbar. */
  .toolbar-secondary.expanded {
    padding-bottom: 0.5rem;
    background: color-mix(in srgb, var(--color-toolbar-bg) 92%, transparent);
    backdrop-filter: blur(12px) saturate(1.35);
    -webkit-backdrop-filter: blur(12px) saturate(1.35);
    border-color: var(--color-border);
    box-shadow: 0 10px 26px -14px rgba(0, 0, 0, 0.25);
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
    height: var(--toolbar-btn-size);
    padding: 0 0.45rem;
    position: absolute;
    /* Clear of the island's rounded bottom-left corner. */
    left: 1.35rem;
    top: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-toolbar-bg);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s;
  }

  /* Collapsed: the tab hangs from the basic toolbar's bottom edge — straddle the
     island's border, drop the top border and round only the bottom so the divider
     bulges around it, and carry the toolbar's elevation so it reads as part of it. */
  .toolbar-secondary:not(.expanded) .expand-toggle {
    top: -1px;
    border-top-color: transparent;
    border-radius: 0 0 var(--radius) var(--radius);
    box-shadow: var(--shadow);
  }

  /* Expanded: the toggle sits in the flex flow so its width is content-driven (any
     language) and the extended toolbar starts right after it, never overlapping. */
  .toolbar-secondary.expanded .expand-toggle {
    position: relative;
    left: auto;
    top: auto;
    flex: none;
    margin: 0 0.6rem 0 0.35rem;
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
    width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
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
