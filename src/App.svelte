<script lang="ts">
  import { onMount, tick as domUpdated, untrack } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import type { Content, Editor } from '@tiptap/core';
  import { EditorState, Selection } from '@tiptap/pm/state';
  import { watchState, noteState, rebaseStates } from './lib/editor/extensions/stateHistory';
  import EditorComponent from './lib/components/Editor.svelte';
  import Toolbar from './lib/components/Toolbar.svelte';
  import ToolbarExpanded from './lib/components/ToolbarExpanded.svelte';
  import Ribbon from './lib/components/ribbon/Ribbon.svelte';
  import EventDialogs from './lib/components/EventDialogs.svelte';
  import CommandSearch from './lib/components/ribbon/CommandSearch.svelte';
  import Icon from './lib/components/ribbon/Icon.svelte';
  import { RIBBON_COMMANDS, TABS, actOnCommand, searchableCommands, styleCommands, tabOf, type RibbonCommand, type Tab } from './lib/components/ribbon/commands';
  import { contextualTabs } from './lib/components/ribbon/contextTabs';
  import { closeMenu } from './lib/components/ribbon/menu.svelte';
  import { ISLAND_PLACE, RIBBON_ONLY, categoryOf, isCategory, islandVia, type Category } from './lib/components/toolbar/island';
  import FindReplaceBar from './lib/components/FindReplaceBar.svelte';
  import type { TiptapNode } from 'odf-kit';
  import { exportPdf, printPdf, printRaster } from './lib/export/pdf';
  import { supportsFsAccess, saveDocument, openOdt, allowWrite, protect, mimeOf } from './lib/export/saveFile';
  import { takeOpenedFile } from './lib/storage/desktopFiles';
  import { loadRecentFiles, rememberRecentFile, readRecentFile, forgetRecentFile, forgetRecentFiles, pruneRecentFiles, getHandle, type RecentFile } from './lib/storage/recentFiles';
  import { isProtected, decryptPackage, WRONG_PASSWORD } from './lib/crypto/protect';
  import { convertUnsupportedImages } from './lib/import/imageFormats';
  import { repairContent, repairZones } from './lib/import/repairContent';
  import en from './lib/i18n/locales/en';
  import { getPageBreakDebug } from './lib/editor/extensions/pageBreaks';
  import { RECORDING, settledDoc } from './lib/editor/extensions/trackChanges';
  import { getColumnsFlowDebug } from './lib/editor/extensions/columnsFlow';
  import { getTextBoxDebug, withRenderedBoxHeights } from './lib/editor/extensions/textBox';
  import { getTableCellDebug } from './lib/editor/extensions/tableCellAlign';
  import { getFrameDebug } from './lib/editor/extensions/caption';
  import { getColorDebug } from './lib/utils/colorDebug';
  import { CHUNK_FAILURE, reportLoadFailure } from './lib/utils/loadFailure';
  import { resetHistoryLog } from './lib/utils/historyLog.svelte';
  import type { TextStats } from './lib/utils/wordCount';
  import { ensureUserName, shownStats, toggleRecordChanges } from './lib/components/reviewItems';
  import type { Node as PmNode } from 'prosemirror-model';
  import { clampZoom, wheelZoomFactor, MIN_ZOOM, MAX_ZOOM } from './lib/utils/zoom';
  import { loadTheme, saveTheme, applyTheme, loadToolbarExpanded, saveToolbarExpanded, loadToolbarCategory, saveToolbarCategory, loadChromeMode, saveChromeMode, loadFormattingMarks, saveFormattingMarks, loadFieldShading, saveFieldShading, loadPageLabels, savePageLabels, loadRuler, saveRuler, loadSplitView, saveSplitView, loadPageColumns, savePageColumns, type ThemeMode, type ChromeMode } from './lib/storage/theme';
  import { loadPageMargins, savePageMargins, fitMargins, DEFAULT_MARGINS, type PageMargins } from './lib/storage/pageMargins';
  import { loadOrientation, saveOrientation, type Orientation } from './lib/storage/pageOrientation';
  import { loadTabInterval, saveTabInterval, applyTabIntervalVar, DEFAULT_TAB_INTERVAL_CM } from './lib/storage/tabInterval';
  import { loadSpacingModel, saveSpacingModel, loadSpacingAtPageStart, saveSpacingAtPageStart, type SpacingModel } from './lib/storage/spacingModel';
  import { loadPageRtl, savePageRtl } from './lib/storage/writingMode';
  import { loadPageFormat, savePageFormat, pageDimsCm, type PageFormat } from './lib/storage/pageFormat';
  import { setStyleSheet, showAllStyles, styleSheet } from './lib/styles/sheet.svelte';
  import { noteSettings, setNoteSettings } from './lib/storage/notes.svelte';
  import { OPEN_COMPARE_EVENT, OPEN_RECORD_LOCK_EVENT, recordChanges, recordLock, setRecordChanges, setRecordLock } from './lib/storage/trackChanges.svelte';
  import { DEFAULT_NOTE_SETTINGS, type NoteSettings } from './lib/storage/noteSettings';
  import { builtinStyleSheet, visibleStyles, type StyleFamily, type StyleSheet } from './lib/styles/styleSheet';
  import { loadHfDoc, saveHfDoc, loadHfDistances, saveHfDistances, loadDifferentFirstPage, saveDifferentFirstPage, loadDifferentOddEven, saveDifferentOddEven, hfIsEmpty, spreadMargins, DEFAULT_HF_DISTANCES, HF_ZONE_KEYS, EMPTY_HF_SET, loadExtraHfSections, saveExtraHfSections, loadHfPictures, type HfDoc, type HfZone, type HfDistances, type HfSet } from './lib/storage/headerFooter';
  import { loadDocName, saveDocName, loadDocFormat, saveDocFormat, stripOdtExtension, docNameOfFile, sanitizeNameForFile, deriveFilename, filenameFor, loadDocProtected, saveDocProtected, loadDocFile, saveDocFile, type DocumentFormat } from './lib/storage/documentName';
  import { loadDocProperties, saveDocProperties, EMPTY_DOC_PROPERTIES, type DocProperties } from './lib/storage/docProperties';
  import { userName, setUserName } from './lib/storage/userName.svelte';
  import { embedded, attribution, whiteLabel } from './lib/embed/mode';
  import { startBridge, notify, type EmbedSettings, type ExportFormat } from './lib/embed/bridge';
  import { loadHyphenation, saveHyphenation } from './lib/storage/hyphenation';
  import { loadPageNumbering, savePageNumbering, DEFAULT_PAGE_NUMBERING, type PageNumbering } from './lib/storage/pageNumbering';
  import { loadPageDecor, savePageDecor, EMPTY_PAGE_DECOR, type PageDecor } from './lib/storage/pageDecor';
  import { loadLineNumbering, saveLineNumbering, DEFAULT_LINE_NUMBERING, type LineNumbering } from './lib/storage/lineNumbering';
  import { loadBalanceSpaces, saveBalanceSpaces } from './lib/storage/balanceSpaces';
  import { loadLineGrid, saveLineGrid, DEFAULT_LINE_GRID, type LineGrid } from './lib/storage/lineGrid';
  import { loadFoldMarks, saveFoldMarks } from './lib/storage/foldMarks';
  import { printMarkup } from './lib/storage/printMarkup.svelte';
  import { commentsInPane, changesInPane, markupAttrs, markupView, setShowChanges, setShowComments } from './lib/storage/markup.svelte';
  import { isAsianTag, loadDocumentLanguage, numberingScripts, loadDocumentLanguageOther, pickDocumentLanguage, saveDocumentLanguage, saveDocumentLanguageOther, odfFromLanguage, tagForLanguage, westernCode, type DocumentLanguage } from './lib/storage/documentLanguage';
  import { setTableLanguage } from './lib/storage/tableOptions.svelte';
  import { spellController } from './lib/spell/controller';
  import { setGrammarLanguage } from './lib/spell/grammar.svelte';
  import LanguagePicker from './lib/components/LanguagePicker.svelte';
  import BusyIndicator, { type BusyTask } from './lib/components/BusyIndicator.svelte';
  import GrammarToggle from './lib/components/GrammarToggle.svelte';
  import UiLanguagePicker from './lib/components/UiLanguagePicker.svelte';
  import AboutDialog from './lib/components/AboutDialog.svelte';
  import PoweredBy from './lib/components/PoweredBy.svelte';
  import SettingsDialog, { type Section as SettingsSection } from './lib/components/SettingsDialog.svelte';
  import TemplateGalleryDialog from './lib/components/TemplateGalleryDialog.svelte';
  import type { TemplateEntry } from './lib/templates/types';
  import DocPropertiesDialog from './lib/components/DocPropertiesDialog.svelte';
  import BrowserDocumentsDialog from './lib/components/BrowserDocumentsDialog.svelte';
  import ResumeCard from './lib/components/ResumeCard.svelte';
  import { volatile } from './lib/storage/docScope';
  import PasswordDialog from './lib/components/PasswordDialog.svelte';
  import PromptDialog from './lib/components/PromptDialog.svelte';
  import { askComposer } from './lib/components/CommentComposer.svelte';
  import CommentsPane from './lib/components/CommentsPane.svelte';
  import RevisionsPane from './lib/components/RevisionsPane.svelte';
  import ConnectorLayer from './lib/components/ConnectorLayer.svelte';
  import NavigatorPane from './lib/components/NavigatorPane.svelte';
  import AiPane, { askAi, resetAiChat } from './lib/components/AiPane.svelte';
  import { aiConfig, aiAnswering, aiEnabled, AI_COMMENT_EVENT, OPEN_AI_CHAT_EVENT } from './lib/storage/ai.svelte';
  import { navigatorSettings, setNavigator } from './lib/storage/navigator.svelte';
  import { aiErrorText, isAbort } from './lib/ai/client';
  import { abortAll as abortAiRequests, answerComment, startRequest, endRequest, type AiHost } from './lib/ai/tools';
  import { commentDraft, OPEN_COMMENT_EVENT } from './lib/editor/extensions/comment';
  import AutoCorrectDialog from './lib/components/AutoCorrectDialog.svelte';
  import AutoTextDialog from './lib/components/AutoTextDialog.svelte';
  import ThesaurusDialog from './lib/components/ThesaurusDialog.svelte';
  import { OPEN_THESAURUS_EVENT } from './lib/spell/thesaurus';
  import StyleManagerDialog from './lib/components/StyleManagerDialog.svelte';
  import NoteOptionsDialog from './lib/components/NoteOptionsDialog.svelte';
  import SaveFormatDialog from './lib/components/SaveFormatDialog.svelte';
  import { t, locale, setLocale } from './lib/i18n/i18n.svelte';
  import { isLocale } from './lib/i18n/config';
  import { fnv1a } from './lib/utils/hash';
  import { withShortcut } from './lib/i18n/shortcut';
  import { DEFAULT_SHORTCUTS, matchesEvent, shortcutHint } from './lib/editor/shortcuts';
  import { localizeImportMessage } from './lib/i18n/importMessages';
  import { unavailableFonts } from './lib/utils/fontDetect';
  import { registerEmbeddedFonts, clearEmbeddedFonts, embeddedFonts } from './lib/fonts/embeddedFonts';
  import { saveEmbeddedFonts, loadEmbeddedFonts, clearEmbeddedFontStore } from './lib/storage/embeddedFontStore';
  import { noteEmbeddedFonts } from './lib/components/ribbon/fontList.svelte';
  import { OPEN_COMMAND_SEARCH_EVENT } from './lib/components/ribbon/commands';

  // launchQueue is not in lib.dom yet; reach it through this shape.
  type WithLaunchQueue = Window & {
    launchQueue?: { setConsumer: (c: (p: { files: FileSystemFileHandle[] }) => void) => void };
  };

  let editor: Editor | null = $state(null);
  let tick: number = $state(0);
  let currentPage: number = $state(1);
  let numPages: number = $state(1);
  let aboutOpen = $state(false);
  let styleManagerOpen = $state(false);
  let styleManagerFamily = $state<StyleFamily | 'outline'>('paragraph');
  let noteOptionsOpen = $state(false);

  function openStyleManager(family: StyleFamily | 'outline') {
    styleManagerFamily = family;
    styleManagerOpen = true;
  }

  // Header/footer content + live-edit state. While a zone is being edited, the
  // top toolbars target hfEditor instead of the body editor (activeEditor below).
  // Stored zones pass the zone schema's check, as an import does.
  const storedZones = repairZones({
    header: loadHfDoc('header'), footer: loadHfDoc('footer'),
    headerFirst: loadHfDoc('header', 'first'), footerFirst: loadHfDoc('footer', 'first'),
    headerEven: loadHfDoc('header', 'even'), footerEven: loadHfDoc('footer', 'even'),
  });
  let headerDoc: HfDoc = $state(storedZones.header);
  let footerDoc: HfDoc = $state(storedZones.footer);
  // First-page header/footer, shown on page 1 when the flag is on.
  let headerFirstDoc: HfDoc = $state(storedZones.headerFirst);
  let footerFirstDoc: HfDoc = $state(storedZones.footerFirst);
  let differentFirstPage: boolean = $state(loadDifferentFirstPage());
  // Even-page header/footer, shown on even pages when the flag is on.
  let headerEvenDoc: HfDoc = $state(storedZones.headerEven);
  let footerEvenDoc: HfDoc = $state(storedZones.footerEven);
  let differentOddEven: boolean = $state(loadDifferentOddEven());
  let hfDistances: HfDistances = $state(loadHfDistances());
  // Sections past the first; the layer edits them in place, section 1 stays the
  // per-zone state above.
  let extraHfSections: HfSet[] = $state(loadExtraHfSections().map((z) => repairZones(z)));
  // Counts the zones replaced since start-up: their pictures come back from the image
  // store afterwards, and only into the zones they were read for.
  let zoneEpoch = 0;
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

  // Word/character counts for the status-bar counter. A selection-only transaction
  // keeps the doc object, so nothing recounts; a changed document is counted a beat
  // later, off the keystroke — a long document's walk is not free.
  let wordCountOpen = $state(false);
  let docStats = $state<TextStats>({ words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 });
  let countedDoc: PmNode | null = null;
  let countedView = '';
  let countTimer: ReturnType<typeof setTimeout> | undefined;
  // Throttled, not debounced: a document that keeps changing (a settle pass, the spell
  // checker's decorations) would push a debounced count out for as long as it goes on.
  $effect(() => {
    if (tick < 0 || !editor) return;
    const { doc } = editor.state, { hideDeletions, hideInsertions } = markupView();
    const view = `${hideDeletions}${hideInsertions}`;
    if (doc === countedDoc && view === countedView) return;
    countedDoc = doc;
    countedView = view;
    countTimer ??= setTimeout(() => {
      countTimer = undefined;
      const now = editor!.state.doc;
      docStats = shownStats(now);
    }, 300);
  });

  // Changed since the last save into a file — the dot both word processors show.
  // Everything the file holds counts: the text, and the page setup, styles and zones
  // beside it, which is what the exporter is handed. Same beat as the word count.
  let dirty = $state(false);
  // The text as saved, compared as a tree: every unchanged node is the very object the
  // saved tree holds, so the comparison is cheap however many pictures ride along.
  let cleanDoc: PmNode | null = null;
  let cleanRest = 0;
  let sumTimer: ReturnType<typeof setTimeout> | undefined;
  // Whether there is a file to lose those changes from — a saved file makes the dot,
  // and the unload warning, follow the changes rather than the document's existence.
  let documentHasFile = $state(false);

  // The page count rides in with the zones but is a layout result, not an edit: a
  // late-loading font repaginating the document must not mark it changed.
  function restSum(): number {
    const [margins, orientation, hf, ...rest] = exportArgs();
    const { pageCount: _pages, ...zones } = hf;
    return fnv1a(JSON.stringify([documentName, margins, orientation, zones, ...rest]));
  }

  function markSaved(): void {
    // A document just put in front of the reader brings its page setup; that is no edit.
    rebaseStates();
    cleanDoc = editor?.state.doc ?? null;
    cleanRest = restSum();
    dirty = false;
  }

  $effect(() => {
    if (tick < 0 || !editor) return; // the tick is the document's own signal
    exportArgs(); // subscribes to every value the file carries beside the text,
    void documentName; // and to the name it is saved under
    // The document the editor comes up with is the file's, taken here and not in the
    // timer: under a repagination the timer can be pushed out past the first edit,
    // which would make that edit the baseline.
    if (cleanDoc === null) {
      markSaved();
      return;
    }
    sumTimer ??= setTimeout(() => {
      sumTimer = undefined;
      dirty = !editor || !cleanDoc || !editor.state.doc.eq(cleanDoc) || restSum() !== cleanRest;
    }, 300);
  });

  $effect(() => {
    // A document with no file behind it lives in this browser alone, so closing the tab
    // is worth the browser's warning as much as changes a file has not got yet. The
    // same emptiness test the confirm before a new document uses.
    // Embedded, the host application holds the document and asks about leaving it.
    if (embedded || (documentHasFile ? !dirty : tick < 0 || !isDocNonEmpty())) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  });
  let selStats = $derived.by<TextStats | null>(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    return empty ? null : shownStats(editor.state.doc, from, to);
  });

  let themeMode: ThemeMode = $state(loadTheme());
  let themeOpen = $state(false);
  let toolbarExpanded = $state(loadToolbarExpanded());
  // Which chrome mounts: the floating island or the ribbon. Both drive one editor.
  let chromeMode: ChromeMode = $state(loadChromeMode());
  let showFormattingMarks = $state(loadFormattingMarks());
  let showFieldShading = $state(loadFieldShading());
  let showPageLabels = $state(loadPageLabels());
  let showRuler = $state(loadRuler());
  let splitView = $state(loadSplitView());
  let pageColumns = $state(loadPageColumns());
  let zoom = $state(clampZoom(parseInt(localStorage.getItem('edentext-zoom') ?? '100', 10)));
  let pageMargins: PageMargins = $state(loadPageMargins());
  let pageOrientation: Orientation = $state(loadOrientation());
  let pageFormat: PageFormat = $state(loadPageFormat());
  let tabIntervalCm = $state(loadTabInterval());
  let spacingModel: SpacingModel = $state(loadSpacingModel());
  let spacingAtPageStart = $state(loadSpacingAtPageStart());
  // The page's text direction, from the file's own page setup (writingMode.ts).
  let pageRtl = $state(loadPageRtl());
  // Bumped for each document opened (import, new); Editor hides the page until that
  // document's pagination holds still.
  let documentEpoch = $state(0);

  // The document's spell-check language; round-trips through the .odt. The effect
  // below persists it and switches the shared spell controller (loads the dict).
  let documentLanguage: DocumentLanguage = $state(loadDocumentLanguage());
  let documentLanguageOther: string | null = $state(loadDocumentLanguageOther());
  function setDocumentLanguage(code: DocumentLanguage) {
    ({ main: documentLanguage, other: documentLanguageOther } = pickDocumentLanguage(documentLanguage, documentLanguageOther, code));
  }

  // The document name (without .odt). Source of truth for the save filename;
  // set on open, editable in the header, blank → heading-derived fallback.
  let documentName: string = $state(loadDocName());
  // The loaded file's format; drives the title's extension label and which
  // exporter "Save" round-trips through (odt-opened saves odt, docx-opened saves docx).
  let documentFormat: DocumentFormat = $state(loadDocFormat());
  let docProps: DocProperties = $state(loadDocProperties());
  let docPropsOpen = $state(false);
  let browserDocsOpen = $state(false);
  let settingsOpen = $state(false);
  let settingsSection = $state<SettingsSection>('general');
  let hyphenate = $state(loadHyphenation());
  let pageNumbering: PageNumbering = $state(loadPageNumbering());
  let pageDecor: PageDecor = $state(loadPageDecor());
  let lineNumbering: LineNumbering = $state(loadLineNumbering());
  let lineGrid: LineGrid = $state(loadLineGrid());
  let balanceSpaces = $state(loadBalanceSpaces());
  let foldMarks = $state(loadFoldMarks());
  // The switch keeps the user's wish; only A4 portrait, the paper DIN 5008 describes,
  // actually draws and exports the marks. Import and templates set the flag too, so
  // the check sits here, behind all three.
  const foldMarksOn = $derived(foldMarks && pageFormat === 'A4' && pageOrientation === 'portrait');

  // The page setup, styles, note settings and language ride the body's undo stack, as in
  // both word processors (stateHistory.ts): every change, from whichever control, lands.
  const isZoneKey = (k: string) => (HF_ZONE_KEYS as readonly string[]).includes(k);
  const layoutFields = () => ({
    pageMargins, pageOrientation, pageFormat, hfDistances, differentFirstPage, differentOddEven,
    pageNumbering, pageDecor, lineNumbering, lineGrid, tabIntervalCm, spacingModel,
    spacingAtPageStart, pageRtl, hyphenate, balanceSpaces, foldMarks, sections: extraHfSections,
  });
  // A section's zones are steps of their own (HeaderFooterLayer.svelte), so a step drops them.
  const layoutWatch = watchState('layout', () => editor, layoutFields, (to) => {
    ({
      pageMargins, pageOrientation, pageFormat, hfDistances, differentFirstPage, differentOddEven,
      pageNumbering, pageDecor, lineNumbering, lineGrid, tabIntervalCm, spacingModel,
      spacingAtPageStart, pageRtl, hyphenate, balanceSpaces, foldMarks,
    } = to as ReturnType<typeof layoutFields>);
    // The section count is the snapshot's; each keeps the zones it has now.
    extraHfSections = (to.sections as HfSet[]).map((set, i) => {
      const zones = extraHfSections[i] ?? EMPTY_HF_SET;
      return { ...set, ...Object.fromEntries(HF_ZONE_KEYS.map((k) => [k, zones[k]])) } as HfSet;
    });
  }, (v) => ({ ...v, sections: (v.sections as HfSet[]).map((set) => Object.fromEntries(Object.entries(set).filter(([k]) => !isZoneKey(k)))) }));
  const styleWatch = watchState('styles', () => editor, () => ({ sheet: styleSheet() }), (to) => setStyleSheet(to.sheet as StyleSheet));
  const noteWatch = watchState('notes', () => editor, () => ({ notes: noteSettings() }), (to) => setNoteSettings(to.notes as NoteSettings));
  const languageWatch = watchState('language', () => editor, () => ({ main: documentLanguage, other: documentLanguageOther }), (to) => {
    documentLanguage = to.main as DocumentLanguage;
    documentLanguageOther = to.other as string | null;
  });
  for (const w of [layoutWatch, styleWatch, noteWatch, languageWatch]) $effect(() => noteState(w));

  // What the assistant may set beside the text. An open zone editor keeps its own copy,
  // so it closes first; a first-page or even-page zone switches its variant on.
  const aiHost: AiHost = {
    setZone(zone, variant, doc, section = 1) {
      hfActive = null;
      if (section > 1) {
        // A section without its own set shows section 1's, so a gap is filled with a copy.
        const out = extraHfSections.slice();
        while (out.length < section - 1) out.push({ ...EMPTY_HF_SET, ...hfSetOfState() });
        const key = `${zone}${variant === 'first' ? 'First' : variant === 'even' ? 'Even' : ''}` as const;
        out[section - 2] = { ...out[section - 2], [key]: doc,
          ...(variant === 'first' ? { differentFirstPage: true } : variant === 'even' ? { differentOddEven: true } : {}) };
        extraHfSections = out;
        return;
      }
      if (variant === 'first') { differentFirstPage = true; if (zone === 'header') headerFirstDoc = doc; else footerFirstDoc = doc; }
      else if (variant === 'even') { differentOddEven = true; if (zone === 'header') headerEvenDoc = doc; else footerEvenDoc = doc; }
      else if (zone === 'header') headerDoc = doc;
      else footerDoc = doc;
    },
    setPage({ format, orientation, margins, start, numberFormat, lineNumbers, hyphenation, foldMarks: fold, decor, properties }) {
      if (format) pageFormat = format;
      if (orientation) pageOrientation = orientation;
      if (margins) {
        const dims = pageDimsCm(pageFormat, pageOrientation);
        const next = fitMargins({ ...pageMargins, ...margins }, dims.w, dims.h);
        extraHfSections = spreadMargins(extraHfSections, pageMargins, next);
        pageMargins = next;
      }
      if (start != null) pageNumbering = { ...pageNumbering, start };
      if (numberFormat) pageNumbering = { ...pageNumbering, format: numberFormat };
      if (lineNumbers != null) lineNumbering = { ...lineNumbering, on: lineNumbers };
      if (hyphenation != null) hyphenate = hyphenation;
      if (fold != null) foldMarks = fold;
      if (decor) pageDecor = { ...pageDecor, ...decor };
      if (properties) { docProps = { ...docProps, ...properties }; saveDocProperties(docProps); }
    },
    setLanguage: (code) => setDocumentLanguage(code),
  };

  let templateGalleryOpen = $state(false);
  let autoCorrectOpen = $state(false);
  let autoTextOpen = $state(false);
  let thesaurusOpen = $state(false);
  // Kept per browser, so the pane is back after a reload, as in both word processors.
  const navigatorOpen = $derived(navigatorSettings().open);
  const toggleNavigator = () => setNavigator({ open: !navigatorOpen });
  let aiOpen = $state(false);
  // The kill switch stops whatever is in flight; a new document starts a new chat.
  $effect(() => { if (!aiEnabled()) abortAiRequests(); });
  // Not on mount: the chat kept with this document survives a reload.
  $effect(() => { if (documentEpoch) { abortAiRequests(); resetAiChat(); } });
  function openAiChat(prefill: string, send = false) {
    aiOpen = true;
    askAi(prefill, send);
  }
  $effect(() => {
    const onChat = (e: Event) => { const d = (e as CustomEvent<{ prefill: string; send?: boolean }>).detail; openAiChat(d.prefill, d.send); };
    window.addEventListener(OPEN_AI_CHAT_EVENT, onChat);
    return () => window.removeEventListener(OPEN_AI_CHAT_EVENT, onChat);
  });

  // Width of the hidden mirror span (below), so the title input grows/shrinks
  // with its text instead of sitting in a fixed-width box.
  let docNameSizerWidth = $state(0);

  // Shown in the empty title field: what an actual save would name the file — read
  // off the document's first heading, not a JSON of the whole document per transaction.
  let namePlaceholder = $derived.by(() => {
    if (documentName.trim() || tick < 0 || !editor) return t().app.untitled;
    let title: string | undefined;
    editor.state.doc.forEach((n) => {
      if (title === undefined && n.type.name === 'heading' && n.childCount) title = n.firstChild?.text ?? '';
    });
    const base = stripOdtExtension(filenameFor(title));
    return base === 'document' ? t().app.untitled : base;
  });

  // The window or tab names its document, as a word processor's title bar does.
  $effect(() => {
    document.title = `${documentName.trim() || namePlaceholder} – EdenText`;
  });

  function suggestedFilename(json: TiptapNode): string {
    const n = documentName.trim();
    return n ? `${sanitizeNameForFile(n)}.odt` : deriveFilename(json);
  }

  function suggestedFilenameDocx(json: TiptapNode): string {
    const n = documentName.trim();
    return n ? `${sanitizeNameForFile(n)}.docx` : deriveFilename(json).replace(/\.odt$/, '.docx');
  }

  $effect(() => {
    saveChromeMode(chromeMode);
  });

  $effect(() => {
    saveFormattingMarks(showFormattingMarks);
  });

  $effect(() => {
    saveFieldShading(showFieldShading);
  });

  $effect(() => {
    savePageLabels(showPageLabels);
  });

  $effect(() => {
    saveRuler(showRuler);
  });

  $effect(() => {
    saveSplitView(splitView);
  });

  $effect(() => {
    savePageColumns(pageColumns);
  });

  // An empty document at startup is one page, as after New, so it opens without the page grid.
  $effect(() => {
    if (editor) untrack(() => { if (!isDocNonEmpty()) pageColumns = 1; });
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
    saveSpacingModel(spacingModel);
    saveSpacingAtPageStart(spacingAtPageStart);
  });


  $effect(() => {
    savePageRtl(pageRtl);
  });

  $effect(() => {
    saveHyphenation(hyphenate);
  });

  $effect(() => {
    savePageNumbering(pageNumbering);
    savePageDecor(pageDecor);
    saveLineNumbering(lineNumbering);
    saveLineGrid(lineGrid);
    saveBalanceSpaces(balanceSpaces);
    saveFoldMarks(foldMarks);
  });

  $effect(() => {
    saveDocumentLanguage(documentLanguage);
    saveDocumentLanguageOther(documentLanguageOther);
    void spellController.setLanguage(westernCode(documentLanguage, documentLanguageOther));
    // A table cell's number is read and written in the document's language.
    setTableLanguage(documentLanguage);
    setGrammarLanguage(westernCode(documentLanguage, documentLanguageOther));
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
  });

  $effect(() => {
    saveDifferentFirstPage(differentFirstPage);
  });

  $effect(() => {
    saveHfDistances(hfDistances);
  });
  $effect(() => {
    saveExtraHfSections(extraHfSections);
  });

  $effect(() => {
    saveDocName(documentName);
    saveDocFormat(documentFormat);
    saveDocProtected(docProtected);
  });

  function setZoom(value: number) {
    zoom = clampZoom(value);
    localStorage.setItem('edentext-zoom', String(zoom));
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

  // The island's Tools category, kept across sessions like the row's open state.
  const storedCategory = loadToolbarCategory();
  let toolbarCategory = $state<Category>(isCategory(storedCategory) ? storedCategory : 'home');
  $effect(() => saveToolbarCategory(toolbarCategory));

  // The island's command search: the ribbon's index, offered while the control is there —
  // a contextual tab's commands while its floating toolbar is shown.
  let islandShown = $derived([...TABS, ...(activeTick >= 0 ? contextualTabs(activeEditor, hfActive) : [])] as Tab[]);
  let islandCommands = $derived(searchableCommands([
    ...RIBBON_COMMANDS,
    ...styleCommands(visibleStyles(styleSheet(), showAllStyles()).map((s) => s.name)),
  ], islandShown, { ai: aiEnabled(), volatile, embedded }).filter((c) => !RIBBON_ONLY.has(c.id)));

  // Where the island keeps a command: its own place if it moved one, the ribbon's tab otherwise.
  function islandPlace(c: RibbonCommand): { category: Category | null; via?: string } {
    const tab = c.id in ISLAND_PLACE ? ISLAND_PLACE[c.id].tab : tabOf(c, islandShown);
    return { category: tab ? categoryOf(tab) : null, via: islandVia(c) };
  }

  const focusActiveEditor = () => (activeEditor as Editor | null)?.commands.focus();

  const findCommand = (id: string) => document.querySelector(`main [data-cmd="${CSS.escape(id)}"]`);

  // A hit is clicked where it lives, so the user sees the place and a disabled one stays
  // disabled: the File commands in the Save menu, the rest in their Tools category unless
  // the first row or a floating toolbar already shows them.
  async function runIslandCommand(c: RibbonCommand) {
    closeMenu();
    themeOpen = false;
    const { category, via } = islandPlace(c);
    if (c.tab === null && !findCommand(c.id)) exportMenuOpen = true;
    else if (!findCommand(via ?? c.id) && category) {
      toolbarExpanded = true;
      saveToolbarExpanded(true);
      toolbarCategory = category;
    }
    await domUpdated();
    if (via) {
      actOnCommand(findCommand(via));
      await domUpdated();
    }
    actOnCommand(findCommand(c.id));
  }

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

  // The file the document is saved to (File System Access API), and its modification
  // time as last read or written, so a save notices the file changed elsewhere.
  let fileHandle: FileSystemFileHandle | null = $state(null);
  let fileModified = 0;
  // The password the document is saved with. Session-only: it is never written to
  // localStorage, and the autosaved copy there stays unencrypted.
  let docPassword: string | null = $state(null);
  // Set after a reload: the document is protected, but the password went with the session.
  let passwordLost = $state(loadDocProtected());
  let docProtected = $derived(docPassword !== null || passwordLost);
  // Set while the file input is picking a file to compare with, not one to open.
  let compareTheirs: boolean | null = null;
  let recordLockOpen = $state(false);
  let recordLockWrong = $state(false);
  // What asked for the password: accepting or rejecting goes on once it is given.
  let afterUnlock: (() => void) | null = null;
  let passwordSetOpen = $state(false);
  let setResolve: ((decided: boolean) => void) | null = null;
  let passwordAskOpen = $state(false);
  let passwordWrong = $state(false);
  let askResolve: ((password: string | null) => void) | null = null;
  // Word's and LibreOffice's recent-documents list; a click reopens the file itself.
  // Only a browser with the File System Access API has handles to reopen from, so
  // elsewhere the list stays empty; a startup prune drops entries whose handle is gone.
  const fsSupported = supportsFsAccess();
  let recentFiles: RecentFile[] = $state(fsSupported ? loadRecentFiles() : []);
  if (fsSupported) void pruneRecentFiles().then((list) => (recentFiles = list));
  // With autosave off no file is recorded, so the menus offer none; Settings still clears the old list.
  const menuRecentFiles = $derived(volatile ? [] : recentFiles);
  // A reload keeps the document's file, as long as the recent list still holds its handle.
  const boundFile = fsSupported ? loadDocFile() : null;
  if (boundFile) void getHandle(boundFile.id).then((h) => {
    if (h && !fileHandle) { fileHandle = h; fileModified = boundFile.modified; }
  });

  // Remember the file just opened or saved for the next reload and the next save's check.
  async function bindFile(): Promise<void> {
    const id = fileHandle && recentFiles[0]?.id;
    fileModified = (await fileHandle?.getFile().catch(() => null))?.lastModified ?? 0;
    saveDocFile(id ? { id, modified: fileModified } : null);
  }
  let fileInput: HTMLInputElement | null = $state(null);
  let pdfBusy = $state(false);
  // What the status bar's spinner names; a layout left running after it keeps the name.
  let busyTask = $state<BusyTask | null>(null);
  let busyProgress = $state<number | null>(null);
  // The spinner is painted before a long synchronous step starts, or not until after it.
  const painted = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  // The page grid builds a view of the whole document per cell, seconds on a long one,
  // so the editor takes a new page count only once the spinner is on screen.
  let gridColumns = $state(loadPageColumns());
  $effect(() => {
    const n = pageColumns;
    if (n === untrack(() => gridColumns)) return;
    if (n <= 1) {
      gridColumns = n;
      return;
    }
    untrack(() => (busyTask ??= 'updating'));
    painted().then(() => {
      gridColumns = pageColumns;
      return painted();
    }).then(() => {
      if (busyTask === 'updating') busyTask = null;
    });
  });
  let exportMenuOpen = $state(false);
  let saveFormatOpen = $state(false);
  let saveFormatKind: DocumentFormat | null = $state(null);

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

  // Putting a document in front of the reader is not an edit: while revisions are
  // recorded, the RECORDING meta keeps the whole file from arriving as this author's
  // insertion. Both word processors record what is typed after an open, not the file.
  // A new document opens at its start: the old caret and scroll offset would drop the
  // reader deep into a document that has not paginated yet.
  function loadContent(content: Content): void {
    editor?.chain().setMeta(RECORDING, true).cancelCommentDraft().setContent(wrapLooseTextBoxes(content))
      .command(({ tr }) => { tr.setSelection(Selection.atStart(tr.doc)); return true; }).run();
    editor?.view.dom.closest('.editor')?.scrollTo({ top: 0 });
  }

  // A text box used to be a block of its own; it is inline now, so a document written
  // before that (an autosave, a recent file) would lose every box it holds to the
  // schema. Give each one the paragraph it now needs.
  function wrapLooseTextBoxes(content: Content): Content {
    if (!content || typeof content !== 'object' || Array.isArray(content)) return content;
    const doc = content as { content?: { type?: string }[] };
    if (!doc.content?.some(n => n?.type === 'textBox')) return content;
    return { ...doc, content: doc.content.map(n =>
      n?.type === 'textBox' ? { type: 'paragraph', content: [n] } : n) } as Content;
  }

  // Reset every document side-car to its default; the $effects persist these.
  // Shared by New and New-from-template, which then assigns the template's own values.
  function resetDocumentState() {
    zoneEpoch++;
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
    spacingModel = 'add';
    spacingAtPageStart = true;
    hfDistances = { ...DEFAULT_HF_DISTANCES };
    extraHfSections = [];
    documentName = '';
    hyphenate = false;
    pageNumbering = { ...DEFAULT_PAGE_NUMBERING };
    pageDecor = { ...EMPTY_PAGE_DECOR };
    lineNumbering = { ...DEFAULT_LINE_NUMBERING };
    lineGrid = { ...DEFAULT_LINE_GRID };
    balanceSpaces = false;
    foldMarks = false;
    // A new document is one page, so the page grid would show only empty cells.
    pageColumns = 1;
    // Recording belongs to the document, so a new one starts off, as it does in both.
    setRecordLock(null);
    setRecordChanges(false);
    docProps = { ...EMPTY_DOC_PROPERTIES };
    saveDocProperties(docProps);
    fileHandle = null;
    fileModified = 0;
    saveDocFile(null);
    documentFormat = 'odt';
    documentHasFile = false;
    docPassword = null;
    passwordLost = false;
    // Styles and note settings live in the document, so a new one starts from the built-ins
    setStyleSheet(builtinStyleSheet());
    setNoteSettings(DEFAULT_NOTE_SETTINGS);
    clearEmbeddedFonts();
    noteEmbeddedFonts([]);
    void clearEmbeddedFontStore();
  }

  function handleNew() {
    if (!editor || embedded) return;
    if (isDocNonEmpty() && !confirm(t().dialogs.confirmNew)) return;
    loadContent('<p></p>'); // onUpdate fires → autosave
    documentEpoch++;
    resetHistory();
    resetDocumentState();
    markSaved();
    editor.commands.focus();
  }

  // A built-in template: a full reset, then the template's content and side-cars —
  // the same set an .ott import adopts. No file handle, so the first Save asks where.
  function applyTemplate(entry: TemplateEntry) {
    if (!editor) return;
    if (isDocNonEmpty() && !confirm(t().dialogs.confirmNew)) return;
    const data = entry.build();
    loadContent(data.content);
    documentEpoch++;
    resetHistory();
    resetDocumentState();
    if (data.format) pageFormat = data.format;
    if (data.margins) pageMargins = { ...data.margins };
    if (data.styles?.length) {
      const sheet = styleSheet();
      const paragraph = { ...sheet.paragraph };
      for (const s of data.styles) paragraph[s.name] = s;
      setStyleSheet({ ...sheet, paragraph });
    }
    foldMarks = data.foldMarks === true;
    documentName = entry.name();
    markSaved();
    editor.commands.focus();
  }

  // Replace the document with a parsed .odt; adopt its geometry/header/footer and
  // track the source handle (null for the fallback file input) so Save overwrites it.
  // Distinct explicit font names (textStyle marks, either half of the pair) anywhere in a
  // TipTap JSON tree.
  function collectFontFamilies(node: unknown, out: Set<string>): void {
    if (!node || typeof node !== 'object') return;
    const n = node as { marks?: { type?: string; attrs?: { fontFamily?: unknown; fontFamilyAsian?: unknown } }[]; content?: unknown[] };
    if (Array.isArray(n.marks)) {
      for (const m of n.marks) {
        if (m?.type !== 'textStyle') continue;
        for (const f of [m.attrs?.fontFamily, m.attrs?.fontFamilyAsian]) if (typeof f === 'string') out.add(f);
      }
    }
    if (Array.isArray(n.content)) for (const c of n.content) collectFontFamilies(c, out);
  }

  // A lock without a key holds nothing to check a password against.
  async function openRecordLock(e: Event): Promise<void> {
    afterUnlock = (e as CustomEvent<(() => void) | null>).detail ?? null;
    const lock = recordLock();
    if (lock && !lock.key) { setRecordLock(null); afterUnlock?.(); return; }
    if (!lock && !(await ensureUserName())) return;
    recordLockWrong = false;
    recordLockOpen = true;
  }

  async function applyRecordLock(password: string | null): Promise<void> {
    if (password == null) return;
    const lock = recordLock();
    const { recordKey, recordKeyMatches } = await import('./lib/crypto/protect');
    if (!lock) {
      setRecordLock({ key: await recordKey(password) });
      setRecordChanges(true);
    } else if (await recordKeyMatches(lock.key!, password)) {
      setRecordLock(null);
      afterUnlock?.();
    } else {
      recordLockWrong = true;
      recordLockOpen = true;
    }
  }

  function settleAsk(password: string | null): void {
    const resolve = askResolve;
    askResolve = null;
    resolve?.(password);
  }

  function applyPassword(password: string | null): void {
    docPassword = password;
    passwordLost = false;
    setResolve?.(true);
    setResolve = null;
  }

  function cancelPasswordSet(): void {
    setResolve?.(false);
    setResolve = null;
  }

  // A reload keeps the document marked protected but not its password: the first save
  // asks for it again, or for the protection to be lifted, rather than writing the
  // file open. False = the user backed out, and the save with it.
  function ensurePassword(): Promise<boolean> {
    if (!passwordLost) return Promise.resolve(true);
    return new Promise((resolve) => {
      setResolve = resolve;
      passwordSetOpen = true;
    });
  }

  // Ask until the password fits or the user gives up; null means give up.
  async function unprotect(bytes: Uint8Array): Promise<{ bytes: Uint8Array; password: string } | null> {
    for (;;) {
      const password = await new Promise<string | null>((resolve) => {
        askResolve = resolve;
        passwordAskOpen = true;
      });
      if (password === null) return null;
      try {
        const plain = await decryptPackage(bytes, password);
        passwordWrong = false;
        return { bytes: plain, password };
      } catch (err) {
        if ((err as Error)?.message !== WRONG_PASSWORD) throw err;
        passwordWrong = true;
      }
    }
  }

  async function importBytes(bytes: Uint8Array, name: string) {
    let isDocx = name.endsWith('.docx') || name.endsWith('.dotx');
    // Pre-decode any images in a format the browser can't render (TIFF, …) to PNG.
    // Lazy: the decoder loads only when such an image is present, else this is a no-op.
    const converted = await convertUnsupportedImages(bytes);
    // An extension can be wrong (a renamed or mis-saved file) and both word processors
    // go by content, so the other format is tried before the file is called broken —
    // a file that is neither reports the error for the extension it carries.
    const [{ importOdt }, { importDocx }] = await Promise.all([import('./lib/import/odt'), import('./lib/import/docx')]);
    try {
      return { result: isDocx ? importDocx(bytes, converted) : importOdt(bytes, converted), isDocx };
    } catch (err) {
      try {
        return { result: isDocx ? importOdt(bytes, converted) : importDocx(bytes, converted), isDocx: !isDocx };
      } catch { throw err; }
    }
  }

  // The differences to another file, recorded here. Compared, that file is the older one
  // and the changes lead up to this document; merged in, they lead to that file.
  async function compareWith(bytes: Uint8Array, name: string, theirs: boolean) {
    if (!editor || (!theirs && !(await ensureUserName()))) return;
    try {
      if (isProtected(bytes)) {
        const opened = await unprotect(bytes);
        if (!opened) return;
        bytes = opened.bytes;
      }
      busyTask = 'loading';
      await painted();
      const { result } = await importBytes(bytes, name.toLowerCase());
      const { recordDifferences } = await import('./lib/editor/compare');
      const other = settledDoc(editor.schema.nodeFromJSON(repairContent(result.content, editor.schema).content), true);
      const { tr } = editor.state;
      const differs = recordDifferences(tr, other, theirs ? result.props.author.trim() : userName(), theirs);
      busyTask = null;
      if (differs) editor.view.dispatch(tr);
      else alert(t().revisions.noDifferences);
    } catch (err) {
      busyTask = null;
      console.error('[compare] Failed to read the file:', err);
      alert(t().dialogs.couldNotOpen);
    }
  }

  async function pickToCompare(theirs: boolean) {
    if (!fsSupported) {
      compareTheirs = theirs;
      fileInput?.click();
      return;
    }
    try {
      const r = await openOdt();
      if (r) await compareWith(r.bytes, r.name, theirs);
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') alert(t().dialogs.couldNotOpen);
    }
  }

  // `host` is an embedding application's load: it replaces the document unasked, and
  // hears of warnings and failures instead of the reader. False = nothing was opened.
  async function applyImport(bytes: Uint8Array, handle: FileSystemFileHandle | null, sourceName?: string, host?: { warn: (warnings: string[]) => void }): Promise<boolean> {
    if (!editor) return false;
    try {
      // Before anything reads the archive: an encrypted file is not one yet.
      let password: string | null = null;
      if (isProtected(bytes)) {
        const opened = await unprotect(bytes);
        if (!opened) return false;
        ({ bytes, password } = opened);
      }
      busyTask = 'loading';
      await painted();
      const name = sourceName?.toLowerCase() ?? '';
      // A template is loaded for its content but never bound as the handle, so the
      // first Save prompts for a new document instead of overwriting the template.
      const isTemplate = name.endsWith('.ott') || name.endsWith('.dotx');
      const { result, isDocx } = await importBytes(bytes, name);
      const { content, error: bodyError } = repairContent(result.content, editor.schema);
      const zoneErrors: string[] = [];
      Object.assign(result, repairZones(result, zoneErrors));
      result.hfSections = result.hfSections?.map((z) => repairZones(z, zoneErrors));
      const structureError = bodyError ?? zoneErrors[0];
      if (structureError) {
        console.warn('[import] Repaired invalid structure:', structureError);
        result.warnings.push(en.importWarn.structureRepaired);
      }

      const hasContent = editor.state.doc.textContent.length > 0 || editor.state.doc.childCount > 1;
      busyTask = null;
      if (hasContent && !host && !confirm(t().dialogs.confirmReplace)) {
        return false;
      }
      busyTask = 'loading';
      await painted();

      // Register the document's embedded fonts (and persist them for next reload) before
      // rendering, so its text shows in the right face and isn't flagged as missing below.
      await registerEmbeddedFonts(result.fonts);
      void saveEmbeddedFonts(result.fonts);
      noteEmbeddedFonts(result.fonts.map((f) => f.family));

      loadContent(content); // onUpdate fires → autosave
      documentEpoch++;
      zoneEpoch++;
      resetHistory();
      // Adopt the opened file's name as the document name (drives the save filename).
      if (sourceName) documentName = docNameOfFile(sourceName);
      // Adopt the document's page geometry; the $effects persist it and
      // Editor.svelte re-paginates.
      if (result.margins) pageMargins = result.margins;
      if (result.orientation) pageOrientation = result.orientation;
      if (result.format) pageFormat = result.format;
      if (result.tabIntervalCm) tabIntervalCm = result.tabIntervalCm;
      spacingModel = result.spacingModel;
      spacingAtPageStart = result.spacingAtPageStart !== false;
      pageRtl = result.rtl;
      hyphenate = result.hyphenate;
      pageNumbering = result.pageNumbering;
      pageDecor = result.decor;
      lineNumbering = result.lineNumbering;
      lineGrid = result.lineGrid;
      balanceSpaces = result.balanceSpaces;
      foldMarks = result.foldMarks === true;
      // The file says whether it goes on recording; ours is not the setting that counts.
      setRecordLock(result.recordLock);
      setRecordChanges(result.recordChanges);
      if (result.recordChanges) void ensureUserName();
      // Adopt the document's spell-check language (the $effect switches the
      // controller + loads its dictionary). null = file declared none; keep ours.
      if (result.language) {
        documentLanguage = result.language;
        documentLanguageOther = result.languageOther ?? null;
      }
      // Adopt the document's named paragraph styles (built-ins + the file's own). Table
      // styles are not stored in the file (ODF has no banding), so the registry survives —
      // an imported table finds its style again by name.
      setStyleSheet({ ...result.styles, table: styleSheet().table });
      setNoteSettings(result.notes);
      docProps = result.props;
      saveDocProperties(docProps);
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
      documentFormat = isDocx ? 'docx' : 'odt';
      // The file's password belongs to the document once it is actually the open one,
      // and an unprotected file drops the previous document's.
      docPassword = password;
      passwordLost = false;
      // The document as opened is what its file holds — a template's is the new
      // document's own, which is nowhere yet.
      documentHasFile = !isTemplate;
      markSaved();
      if (sourceName) recentFiles = await rememberRecentFile(sourceName, isTemplate ? null : handle);
      await bindFile();

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

      busyTask = null;
      const warnings = result.warnings.map(localizeImportMessage);
      if (missingFonts.length) warnings.push(t().importWarn.missingFonts(missingFonts.join(', ')));
      if (warnings.length) {
        console.warn('[import] Opened file with limitations:', result.warnings, missingFonts);
        if (host) host.warn(warnings);
        else alert(t().dialogs.openedWithLimitations(warnings.join('\n• ')));
      }
      return true;
    } catch (err) {
      busyTask = null;
      if (host) throw err;
      console.error('[import] Failed to open file:', err);
      if (err instanceof Error && CHUNK_FAILURE.test(err.message)) reportLoadFailure(t().dialogs.couldNotOpen, err);
      else alert(err instanceof Error ? localizeImportMessage(err.message) : t().dialogs.couldNotOpen);
      return false;
    }
  }

  function openReviewSettings() { settingsSection = 'review'; settingsOpen = true; }

  // The comment is written beside its text, which stays in view; a second New Comment
  // moves the open card to the new selection and keeps what is typed in it.
  async function addComment() {
    if (!editor || editor.state.selection.empty || !(await ensureUserName()) || !editor) return;
    const fresh = !commentDraft(editor.state);
    // A comment nobody can see is worse than none: the new one brings its kind back.
    setShowComments(true);
    editor.commands.startCommentDraft();
    askComposer(fresh);
  }

  // The page grid has no balloons: a card being written needs the pane there.
  let draftInPane = $derived.by(() => tick >= 0 && !!editor && gridColumns > 1 && !!commentDraft(editor.state));

  // Comments hidden while one is being written: it goes with them.
  $effect(() => {
    if (tick >= 0 && editor && !markupView().comments && commentDraft(editor.state)) editor.commands.cancelCommentDraft();
  });

  // "@KI" in a comment or reply: the assistant answers in the thread, a turn of its own.
  async function askAiInComment(id: string) {
    const cfg = aiConfig();
    if (!editor || !cfg || aiAnswering.get(id) === '') return;
    aiAnswering.set(id, '');
    const request = startRequest();
    try {
      await answerComment({ cfg, editor, id, host: aiHost, signal: request.signal });
      aiAnswering.delete(id);
    } catch (e) {
      if (isAbort(e)) aiAnswering.delete(id);
      else aiAnswering.set(id, aiErrorText(e, t().ai.errors, cfg.endpoint));
    } finally {
      endRequest(request);
    }
  }

  $effect(() => {
    const ask = (e: Event) => void askAiInComment((e as CustomEvent<{ id: string }>).detail.id);
    window.addEventListener(AI_COMMENT_EVENT, ask);
    return () => window.removeEventListener(AI_COMMENT_EVENT, ask);
  });

  $effect(() => {
    const open = () => addComment();
    window.addEventListener(OPEN_COMMENT_EVENT, open);
    return () => window.removeEventListener(OPEN_COMMENT_EVENT, open);
  });

  // The context menu and both chromes' Thesaurus entries open the one dialog here.
  $effect(() => {
    const open = () => (thesaurusOpen = true);
    window.addEventListener(OPEN_THESAURUS_EVENT, open);
    return () => window.removeEventListener(OPEN_THESAURUS_EVENT, open);
  });

  // A document double-clicked in the OS reaches the installed app through launchQueue
  // (the manifest's `file_handlers`). It fires once at startup, so it waits for the
  // editor; the handle comes with write permission, so a later Save writes that file.
  // The desktop app hands its document over by path instead.
  $effect(() => {
    if (!editor || embedded) return;
    (window as WithLaunchQueue).launchQueue?.setConsumer(({ files }) => void openLaunched(files?.[0]));
    void takeOpenedFile().then(openLaunched);
  });

  async function openLaunched(handle: FileSystemFileHandle | null | undefined) {
    if (!handle) return;
    try {
      const file = await handle.getFile();
      await applyImport(new Uint8Array(await file.arrayBuffer()), handle, file.name);
    } catch (err) {
      console.error('[open] Failed to open file:', err);
      alert(t().dialogs.couldNotOpen);
    }
  }

  async function handleOpen() {
    if (!editor || embedded) return;
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
    const theirs = compareTheirs;
    compareTheirs = null;
    if (!file) return;
    if (theirs != null) await compareWith(new Uint8Array(await file.arrayBuffer()), file.name, theirs);
    else await applyImport(new Uint8Array(await file.arrayBuffer()), null, file.name);
  }

  // Both exporters take the same document-wide arguments, and every save path needs
  // one of them. The exporter module loads on first use.
  function exportLanguage() {
    const odf = odfFromLanguage(documentLanguage);
    return odf && { ...odf, other: documentLanguageOther };
  }
  function exportArgs() {
    return [pageMargins, pageOrientation, hfOpts(), exportLanguage(), pageFormat, styleSheet(), tabIntervalCm, spacingModel, pageRtl, noteSettings(), docProps, hyphenate, pageNumbering, pageDecor, lineNumbering, recordChanges(), foldMarksOn, spacingAtPageStart, embeddedFonts(), lineGrid, balanceSpaces, recordLock()] as const;
  }

  async function buildBytes(kind: DocumentFormat, json: TiptapNode): Promise<Uint8Array> {
    if (kind === 'docx') {
      const { buildDocx } = await import('./lib/export/docx');
      return buildDocx(editor ? withRenderedBoxHeights(editor.view) as TiptapNode : json, ...exportArgs());
    }
    const { buildOdt } = await import('./lib/export/odt');
    return buildOdt(json, ...exportArgs());
  }

  async function handleSave() {
    if (!editor) return;
    exportMenuOpen = false;
    // Embedded, the host application saves: it is asked to, and fetches the bytes itself.
    if (embedded) return notify('saveRequest');
    // A document with no file behind it has no format yet: ask, the way saving an
    // untitled document does everywhere else, and let Save As do the rest.
    if (!fileHandle && !documentHasFile) { saveFormatKind = null; saveFormatOpen = true; return; }
    if (!(await ensurePassword())) return;
    const json = editor.getJSON() as TiptapNode;
    try {
      // Someone else's changes to the file are not overwritten unasked: declining saves
      // under another name instead.
      if (fileHandle) {
        if (!(await allowWrite(fileHandle))) throw new DOMException('', 'NotAllowedError');
        const { lastModified } = await fileHandle.getFile();
        if (fileModified && lastModified !== fileModified && !confirm(t().dialogs.fileChangedElsewhere(fileHandle.name))) return handleSaveAs(documentFormat);
      }
      // A document opened as .docx round-trips through the same format, like both
      // reference word processors — not silently rewritten to .odt under its old name.
      const name = documentFormat === 'docx' ? suggestedFilenameDocx(json) : suggestedFilename(json);
      const picked = !fileHandle;
      fileHandle = await saveDocument(await buildBytes(documentFormat, json), name, documentFormat, fileHandle, docPassword);
      // A file chosen in the save dialog names the document, as opening it would.
      if (picked && fileHandle) documentName = docNameOfFile(fileHandle.name);
      recentFiles = await rememberRecentFile(fileHandle?.name ?? name, fileHandle);
      await bindFile();
      documentHasFile = true;
      markSaved();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      // A stored handle may have lost its permission or its file: prompt for a new one,
      // in the document's own format. Every other error is reported, not papered over.
      const name = (err as DOMException)?.name;
      if (fileHandle && (name === 'NotAllowedError' || name === 'NotFoundError')) { fileHandle = null; return handleSave(); }
      console.error('[save] Failed to save file:', err);
      reportLoadFailure(t().dialogs.couldNotSave, err);
    }
  }

  // Save As is one entry per format: the format has to be settled before the bytes are
  // built (a download cannot read a name back), and it is the document's from then on.
  async function handleSaveAs(kind: DocumentFormat, typedName?: string) {
    if (!editor) return;
    exportMenuOpen = false;
    // A download never reports the name it was saved under, so the dialog asks for it first.
    if (!fsSupported && typedName === undefined) { saveFormatKind = kind; saveFormatOpen = true; return; }
    if (typedName !== undefined) documentName = typedName;
    if (!(await ensurePassword())) return;
    const json = editor.getJSON() as TiptapNode;
    const name = kind === 'docx' ? suggestedFilenameDocx(json) : suggestedFilename(json);
    try {
      fileHandle = await saveDocument(await buildBytes(kind, json), name, kind, null, docPassword);
      documentFormat = kind;
      if (fileHandle) documentName = docNameOfFile(fileHandle.name);
      recentFiles = await rememberRecentFile(fileHandle?.name ?? name, fileHandle);
      await bindFile();
      documentHasFile = true;
      markSaved();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('[save] Failed to save file:', err);
      reportLoadFailure(t().dialogs.couldNotSave, err);
    }
  }

  // A template in the document's own format (.ott, or .dotx for a .docx document). It
  // is never bound as the current file, exactly as opening one isn't.
  async function handleSaveTemplate() {
    if (!editor) return;
    exportMenuOpen = false;
    if (!(await ensurePassword())) return;
    const json = editor.getJSON() as TiptapNode;
    try {
      const { odtToOtt, docxToDotx } = await import('./lib/export/template');
      const kind = documentFormat === 'docx' ? 'dotx' : 'ott';
      const bytes = kind === 'dotx' ? docxToDotx(await buildBytes('docx', json)) : odtToOtt(await buildBytes('odt', json));
      await saveDocument(bytes, `${stripOdtExtension(suggestedFilename(json))}.${kind}`, kind, null, docPassword);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('[save] Failed to save template:', err);
      reportLoadFailure(t().dialogs.couldNotSave, err);
    }
  }

  // Reopen a file from the recent list. Only a file that is really gone drops the
  // entry; a permission prompt declined or dismissed keeps it for the next try.
  async function handleOpenRecent(entry: RecentFile) {
    exportMenuOpen = false;
    try {
      const r = await readRecentFile(entry.id);
      if (r === 'gone') {
        alert(t().dialogs.recentUnavailable(entry.name));
        recentFiles = forgetRecentFile(entry.id);
        return;
      }
      if (r === 'denied') {
        alert(t().dialogs.recentDenied(entry.name));
        return;
      }
      await applyImport(r.bytes, r.handle, r.name);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return;
      console.error('[open] Failed to reopen a recent file:', err);
      alert(t().dialogs.couldNotOpen);
    }
  }

  function handleForgetRecent() {
    forgetRecentFiles();
    recentFiles = [];
    exportMenuOpen = false;
  }

  // Lay the document out into A4 pages (Paged.js) and open the print dialog so the
  // user can "Save as PDF" — vector text matching the editor, with header/footer.
  function handleExportPdf() {
    void rasterPdf(false);
  }

  // `toBytes` hands the PDF to an embedding host, which hears of a failure itself.
  async function rasterPdf(toBytes: boolean): Promise<ArrayBuffer | undefined> {
    if (!editor || pdfBusy) {
      if (toBytes) throw new Error('busy');
      return;
    }
    exportMenuOpen = false;
    pdfBusy = true;
    busyTask = 'pdf';
    await painted();
    try {
      // A view showing a finished text prints it finished, merged paragraphs included.
      const view = markupView();
      const shown = view.hideDeletions || view.hideInsertions ? settledDoc(editor.state.doc, view.hideDeletions) : editor.state.doc;
      const json = shown.toJSON() as TiptapNode;
      return await exportPdf({
        toBytes,
        source: editor.view.dom as HTMLElement,
        json,
        fileName: suggestedFilename(json),
        orientation: pageOrientation,
        pageFormat,
        numPages,
        commentLabels: { heading: t().comments.title, onPage: t().comments.onPage },
        printMarkup: printMarkup(),
        onProgress: (done) => { busyProgress = done; },
      });
    } catch (err) {
      if (toBytes) throw err;
      console.error('[pdf] Export failed:', err);
      reportLoadFailure(t().dialogs.couldNotExportPdf, err);
    } finally {
      pdfBusy = false;
      busyTask = null;
      busyProgress = null;
    }
  }

  // Embedded, the host application loads and saves the document through the bridge
  // (lib/embed/bridge.ts); the reader's own file commands are gone.
  function configureEmbed(s: EmbedSettings): void {
    if (typeof s.user === 'string') setUserName(s.user);
    if (typeof s.locale === 'string' && isLocale(s.locale)) setLocale(s.locale);
    if (s.theme === 'light' || s.theme === 'dark' || s.theme === 'allBlack' || s.theme === 'auto') selectTheme(s.theme);
    if (s.chrome === 'ribbon' || s.chrome === 'modern') chromeMode = s.chrome;
    if (typeof s.name === 'string') {
      // The file's name as the host keeps it, which is no edit of the document.
      const clean = !dirty;
      documentName = s.name;
      if (clean) markSaved();
    }
  }

  async function exportForHost(format: ExportFormat): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
    if (!editor) throw new Error('editor not ready');
    const json = editor.getJSON() as TiptapNode;
    if (format === 'pdf') {
      const pdf = await rasterPdf(true);
      if (!pdf) throw new Error('nothing to export');
      return { bytes: new Uint8Array(pdf), mime: mimeOf('pdf'), name: `${stripOdtExtension(suggestedFilename(json))}.pdf` };
    }
    const name = format === 'docx' ? suggestedFilenameDocx(json) : suggestedFilename(json);
    return { bytes: await protect(await buildBytes(format, json), docPassword), mime: mimeOf(format), name };
  }

  let bridged = false;
  $effect(() => {
    if (!embedded || !editor || bridged) return;
    bridged = true;
    startBridge({
      configure: configureEmbed,
      load: (bytes, name) => applyImport(bytes, null, name, { warn: (warnings) => notify('warning', { warnings }) }),
      exportAs: exportForHost,
      // The host has stored what it exported: the document now has a file behind it.
      markSaved: () => { documentHasFile = true; markSaved(); },
    });
  });
  $effect(() => {
    if (embedded) notify('dirty', { dirty });
  });

  // Print via the browser's print dialog using the exact raster of the editor (tables,
  // header/footer, band masks intact) — print or "Save as PDF". Used by the printer
  // button and Ctrl+P, since the vector path re-paginates and mangles tables.
  async function handlePrint() {
    if (!editor || pdfBusy) return;
    exportMenuOpen = false;
    pdfBusy = true;
    busyTask = 'print';
    await painted();
    try {
      const json = editor.getJSON() as TiptapNode;
      await printRaster({
        source: editor.view.dom as HTMLElement,
        json,
        fileName: suggestedFilename(json),
        orientation: pageOrientation,
        pageFormat,
        numPages,
        commentLabels: { heading: t().comments.title, onPage: t().comments.onPage },
        printMarkup: printMarkup(),
        onProgress: (done) => { busyProgress = done; },
      });
    } catch (err) {
      console.error('[pdf] Print failed:', err);
      reportLoadFailure(t().dialogs.couldNotPrint, err);
    } finally {
      pdfBusy = false;
      busyTask = null;
      busyProgress = null;
    }
  }

  // Vector PDF via the browser's print dialog: crisp, tiny, fonts embedded. Tables
  // break natively; header/footer become CSS @page boxes (basic text + page numbers).
  async function handlePrintPdf() {
    if (!editor) return;
    exportMenuOpen = false;
    try {
      const json = editor.getJSON() as TiptapNode;
      await printPdf({
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
        commentLabels: { heading: t().comments.title, onPage: t().comments.onPage },
        printMarkup: printMarkup(),
        markupAttrs: markupAttrs(),
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[pdf] Print failed:', err);
      reportLoadFailure(t().dialogs.couldNotPrintPdf, err);
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
    // Saving must not depend on the server: a redeploy deletes this build's lazy chunks, so
    // everything a save loads comes in once the editor is idle. The tiny ODT export pulls
    // odf-kit's own lazy chunk; a failure here is reported by the save that needs it.
    const preloadSave = () => void Promise.all([
      buildBytes('odt', { type: 'doc', content: [{ type: 'paragraph' }] }),
      import('./lib/export/docx'), import('./lib/export/template'), import('./lib/crypto/odf'), import('./lib/crypto/ooxml'),
    ]).catch(() => {});
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preloadSave, { timeout: 5000 });
    else setTimeout(preloadSave, 2000);
    void loadHfPictures().then((stored) => {
      if (!stored || zoneEpoch !== 0 || hfActive) return;
      const zones = repairZones(stored.zones);
      headerDoc = zones.header;
      footerDoc = zones.footer;
      headerFirstDoc = zones.headerFirst;
      footerFirstDoc = zones.footerFirst;
      headerEvenDoc = zones.headerEven;
      footerEvenDoc = zones.footerEven;
      extraHfSections = stored.sections.map((z) => repairZones(z));
      if (stored.missing) alert(t().dialogs.picturesNotRestored(stored.missing));
    });
    // Re-register the restored document's embedded fonts so it renders in the right face;
    // FontFace load fires 'loadingdone', which Editor.svelte re-paginates on. A file opened
    // while the store was still reading has its own, and registering would replace them.
    void loadEmbeddedFonts().then((fonts) => {
      if (embeddedFonts().length) return;
      noteEmbeddedFonts(fonts.map((f) => f.family));
      void registerEmbeddedFonts(fonts);
    });

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
      [DEFAULT_SHORTCUTS.navigator, toggleNavigator],
      [DEFAULT_SHORTCUTS.thesaurus, () => (thesaurusOpen = true)],
      [DEFAULT_SHORTCUTS.splitView, () => (splitView = !splitView)],
      [DEFAULT_SHORTCUTS.recordChanges, toggleRecordChanges],
      [DEFAULT_SHORTCUTS.zoomIn, () => setZoom(zoom + 10)],
      [DEFAULT_SHORTCUTS.zoomOut, () => setZoom(zoom - 10)],
      [DEFAULT_SHORTCUTS.zoomReset, () => setZoom(100)],
      [DEFAULT_SHORTCUTS.commandSearch, () => window.dispatchEvent(new Event(OPEN_COMMAND_SEARCH_EVENT))],
    ];

    function onKeydown(e: KeyboardEvent) {
      // The editor gets the key first: F3 expands an AutoText shortcut where the caret
      // has one (both word processors' key for it) and only otherwise finds the next
      // match, which is what the extension leaves unhandled.
      if (e.defaultPrevented) return;
      // Drafting needs the body editor; without the assistant the key is the browser's.
      if (aiEnabled() && !hfActive && matchesEvent(e, DEFAULT_SHORTCUTS.aiDraft)) {
        e.preventDefault();
        openAiChat('/draft ');
        return;
      }

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
    window.addEventListener(OPEN_RECORD_LOCK_EVENT, openRecordLock);
    const onCompare = (e: Event) => void pickToCompare((e as CustomEvent<boolean>).detail);
    window.addEventListener(OPEN_COMPARE_EVENT, onCompare);
    return () => {
      window.removeEventListener(OPEN_COMPARE_EVENT, onCompare);
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener(OPEN_RECORD_LOCK_EVENT, openRecordLock);
    };
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
      // Where each picture sits in the column beside its caption: the rest of the dump
      // measures the flow downwards, and a misplaced caption is a sideways question.
      frames: getFrameDebug(editor.view),
      // Cell alignment reads as broken whenever the content fills the box, so the
      // dump carries the spacing that decides that: the sheet and the model it uses.
      tableCells: getTableCellDebug(editor.view),
      spacingModel,
      spacingAtPageStart,
      styles: styleSheet(),
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

<!-- The ribbon docks in flow, so only the modern island needs the editor's top
     padding to clear an overlay. -->
<main style="--toolbar-overlay-h: {chromeMode === 'ribbon' ? 0 : toolbarRegionH}px">
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
  {#if chromeMode === 'ribbon'}
  <div bind:clientHeight={toolbarRegionH}>
    <Ribbon
      editor={activeEditor}
      tick={activeTick}
      bind:documentName
      {documentFormat}
      {dirty}
      bind:showFormattingMarks
      bind:showFieldShading
      bind:showRuler
      bind:splitView
      bind:pageColumns
      {documentLanguage}
      {documentLanguageOther}
      onLanguage={setDocumentLanguage}
      {zoom}
      onZoom={setZoom}
      onDebugDump={import.meta.env.DEV ? handleDebugDump : undefined}
      bind:tabIntervalCm
      bind:pageMargins
      bind:pageOrientation
      bind:pageFormat
      bind:extraHfSections
      bind:hfDistances
      bind:differentFirstPage
      bind:differentOddEven
      bind:hyphenate
      bind:pageNumbering
      bind:pageDecor
      bind:lineNumbering
      bind:foldMarks
      {hfActive}
      onManageStyles={openStyleManager}
      onManageTableStyles={() => openStyleManager('table')}
      onNoteOptions={() => (noteOptionsOpen = true)}
      onHeadingNumbering={() => openStyleManager('outline')}
      onEditZone={(zone) => (hfActive = zone)}
      onFind={openFind}
      {namePlaceholder}
      {themeMode}
      onSelectTheme={selectTheme}
      {pdfBusy}
      onNew={handleNew}
      onNewFromTemplate={() => (templateGalleryOpen = true)}
      onOpen={handleOpen}
      onSave={handleSave}
      onSaveAs={handleSaveAs}
      onSaveTemplate={handleSaveTemplate}
      recentFiles={menuRecentFiles}
      onOpenRecent={(id) => { const f = recentFiles.find((r) => r.id === id); if (f) void handleOpenRecent(f); }}
      onForgetRecent={handleForgetRecent}
      onExportPdf={handleExportPdf}
      onPrintPdf={handlePrintPdf}
      onPrint={handlePrint}
      onAbout={() => (aboutOpen = true)}
      onSettings={() => (settingsOpen = true)}
      onDocProperties={() => (docPropsOpen = true)}
      onBrowserDocuments={() => (browserDocsOpen = true)}
      onProtect={() => (passwordSetOpen = true)}
      hasPassword={docProtected}
      onAutoCorrect={() => (autoCorrectOpen = true)}
      onAutoText={() => (autoTextOpen = true)}
      onNewComment={addComment}
      onReviewSettings={openReviewSettings}
      {navigatorOpen}
      onToggleNavigator={toggleNavigator}
      {aiOpen}
      onToggleAi={() => (aiOpen = !aiOpen)}
    />
  </div>
  {:else}
  <div class="toolbar-region" bind:clientHeight={toolbarRegionH}>
    <div class="toolbar-clip" id="primary-toolbar" bind:this={toolbarClipEl} onwheel={onToolbarWheel}>
      <div class="toolbar-stack" bind:this={toolbarStackEl} style="transform: translateX(-{tbScroll}px);">
  <header class:expanded={toolbarExpanded}>
    {#if !whiteLabel}
    <button class="logo-btn" data-cmd="about" onclick={() => (aboutOpen = true)} aria-label={t().about.label} title={t().about.label}>
      <img src="EdenText.png" alt="EdenText" class="app-logo" />
    </button>
    {/if}
    <Toolbar editor={activeEditor} tick={activeTick} onManageStyles={openStyleManager} scripts={numberingScripts(documentLanguage, documentLanguageOther, locale())} />
    <div class="header-actions">
      <CommandSearch variant="island" commands={islandCommands} onRun={runIslandCommand} onCancel={focusActiveEditor} />
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
          readonly={embedded}
          placeholder={namePlaceholder}
          title={t().app.documentName}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          onblur={() => (documentName = documentName.trim())}
        />
        <span class="doc-name-ext">.{documentFormat}</span>
        {#if dirty}<span class="doc-dirty">• {t().app.unsavedChanges}</span>{/if}
        <svg class="doc-name-pencil" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11.3 2.3a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4l-7 7-2.8.9.9-2.8 7-7.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="file-actions">
        {#if !embedded}
        <button class="file-action-btn" data-cmd="newDocument" onclick={handleNew} disabled={!editor} title={t().app.newDocument}>
          <!-- Page with folded corner + plus -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M9 1.75V5.5h3.75" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M8 8v3.5M6.25 9.75h3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="file-action-btn" data-cmd="newFromTemplate" onclick={() => (templateGalleryOpen = true)} disabled={!editor} title={t().templates.title}>
          <!-- Page with folded corner + text lines: new from template -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M9 1.75H4.5A1.25 1.25 0 0 0 3.25 3v10A1.25 1.25 0 0 0 4.5 14.25h7A1.25 1.25 0 0 0 12.75 13V5.5L9 1.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M9 1.75V5.5h3.75" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="file-action-btn" data-cmd="open" onclick={handleOpen} disabled={!editor} title={`${t().app.open} (${shortcutHint('open')})`}>
          <!-- Folder -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M1.75 12.5V4a1 1 0 0 1 1-1h3.2a1 1 0 0 1 .8.4l.7.95a1 1 0 0 0 .8.4h4.2a1 1 0 0 1 1 1v6.75a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
        {/if}
        <!-- Single Save / Export button → ODT, Raster PDF, or Vector PDF (beta). -->
        <div class="save-split" use:exportMenuClickOutside>
          <div class="save-control">
            <button class="file-action-btn save-main" data-cmd="save" onclick={handleSave} disabled={!editor || pdfBusy} title={`${t().app.save} (${withShortcut('Ctrl+S')})`}>
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
              {#if !embedded}
              <button class="theme-option" onclick={handleSave} role="menuitem">
                <span>{t().app.odt}</span>
                <span class="theme-option-hint">{t().app.openDocument}</span>
              </button>
              <button class="theme-option" data-cmd="saveAsOdt" onclick={() => handleSaveAs('odt')} role="menuitem">
                <span>{t().ribbon.saveAs} (.odt)</span>
              </button>
              <button class="theme-option" data-cmd="saveAsDocx" onclick={() => handleSaveAs('docx')} role="menuitem">
                <span>{t().ribbon.saveAs} (.docx)</span>
              </button>
              {/if}
              <button class="theme-option" data-cmd="rasterPdf" onclick={handleExportPdf} disabled={pdfBusy} role="menuitem">
                <span>{pdfBusy ? t().app.exporting : t().app.rasterPdf}</span>
                <span class="theme-option-hint">{t().app.rasterHint}</span>
              </button>
              <button class="theme-option" data-cmd="vectorPdf" onclick={handlePrintPdf} role="menuitem">
                <span>{t().app.vectorPdf}</span>
                <span class="theme-option-hint">{t().app.vectorHint}</span>
              </button>
              {#if !volatile}
                <button class="theme-option" data-cmd="browserDocuments" onclick={() => { exportMenuOpen = false; browserDocsOpen = true; }} role="menuitem">
                  <span>{t().browserDocs.title}</span>
                </button>
              {/if}
              {#if !embedded}
              <button class="theme-option" data-cmd="saveTemplate" onclick={handleSaveTemplate} role="menuitem">
                <span>{t().app.template}</span>
                <span class="theme-option-hint">{t().app.templateHint}</span>
              </button>
              {/if}
              {#if menuRecentFiles.length}
                <div class="theme-heading">{t().app.recentFiles}</div>
                {#each menuRecentFiles as f (f.id)}
                  <button class="theme-option" onclick={() => handleOpenRecent(f)} role="menuitem">
                    <span class="recent-name">{f.name}</span>
                  </button>
                {/each}
                <button class="theme-option" onclick={handleForgetRecent} role="menuitem">
                  <span class="theme-option-hint">{t().app.clearRecentFiles}</span>
                </button>
              {/if}
              <button class="theme-option" data-cmd="protect" onclick={() => { exportMenuOpen = false; passwordSetOpen = true; }} role="menuitem">
                <span>{t().password.menu}</span>
                {#if docProtected}<span class="theme-option-hint">{t().password.menuOn}</span>{/if}
              </button>
              <div class="theme-heading">{t().docProps.title}</div>
              <button class="theme-option" data-cmd="docProperties" onclick={() => { exportMenuOpen = false; docPropsOpen = true; }} role="menuitem">
                <span>{t().docProps.title}</span>
              </button>
              {#if whiteLabel}
                <button class="theme-option" data-cmd="about" onclick={() => { exportMenuOpen = false; aboutOpen = true; }} role="menuitem">
                  <span>{t().about.label}</span>
                </button>
              {/if}
            </div>
          {/if}
        </div>
        <button class="file-action-btn" data-cmd="print" onclick={handlePrint} disabled={!editor || pdfBusy} title={`${t().app.print} (${withShortcut('Ctrl+P')})`}>
          <!-- Printer -->
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.5 6V2.25h7V6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <path d="M4.5 12H3.25A1.25 1.25 0 0 1 2 10.75V7.25A1.25 1.25 0 0 1 3.25 6h9.5A1.25 1.25 0 0 1 14 7.25v3.5A1.25 1.25 0 0 1 12.75 12H11.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
            <rect x="4.5" y="10" width="7" height="4" rx="0.5" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      {#if aiEnabled()}
        <button class="theme-btn" class:active={aiOpen} data-cmd="aiPane" onclick={() => (aiOpen = !aiOpen)} title={t().ai.chatTitle} aria-pressed={aiOpen}>
          <Icon name="sparkle" size={16} />
        </button>
      {/if}
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
              <circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.5"/>
              <path d="M12.07 3.93a5.75 5.75 0 0 1-8.14 8.14z" fill="currentColor"/>
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
            <div class="theme-heading">{t().autoCorrect.title}</div>
            <button class="theme-option" onclick={() => { themeOpen = false; autoCorrectOpen = true; }} role="menuitem">
              <span>{t().ribbon.autoCorrect}</span>
            </button>
            <button class="theme-option" onclick={() => { themeOpen = false; autoTextOpen = true; }} role="menuitem">
              <span>{t().autoText.title}</span>
            </button>
            <button class="theme-option" onclick={() => { themeOpen = false; thesaurusOpen = true; }} role="menuitem" title={t().thesaurus.hint}>
              <span>{t().thesaurus.title}</span>
              <span class="theme-option-hint">{shortcutHint('thesaurus')}</span>
            </button>
            <button class="theme-option" onclick={() => { themeOpen = false; settingsOpen = true; }} role="menuitem">
              <span>{t().settings.title}</span>
            </button>
          </div>
        {/if}
      </div>
      <UiLanguagePicker />
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
          bind:category={toolbarCategory}
          bind:showFormattingMarks
          bind:showFieldShading
          bind:showRuler
          bind:splitView
          bind:pageColumns
          bind:tabIntervalCm
          bind:pageMargins
          bind:pageOrientation
          bind:pageFormat
          bind:extraHfSections
          bind:hfDistances
          bind:differentFirstPage
          bind:differentOddEven
          bind:hyphenate
          bind:pageNumbering
          bind:pageDecor
          bind:lineNumbering
          bind:foldMarks
          {hfActive}
          asianDocument={isAsianTag(tagForLanguage(documentLanguage) ?? '') || isAsianTag(locale())}
          {documentLanguage}
          {documentLanguageOther}
          onLanguage={setDocumentLanguage}
          {zoom}
          onZoom={setZoom}
          {navigatorOpen}
          onToggleNavigator={toggleNavigator}
          onEditZone={(zone) => (hfActive = zone)}
          onDebugDump={import.meta.env.DEV ? handleDebugDump : undefined}
          onManageTableStyles={() => openStyleManager('table')}
          onNoteOptions={() => (noteOptionsOpen = true)}
          onHeadingNumbering={() => openStyleManager('outline')}
          onFind={openFind}
          onAutoCorrect={() => (autoCorrectOpen = true)}
          onAutoText={() => (autoTextOpen = true)}
          onNewComment={addComment}
          onReviewSettings={openReviewSettings}
        />
      </div>
      {@render toolbarScrollbar()}
    {/if}
  </div>
      </div>
    </div>
  </div>
  {/if}
  <EventDialogs editor={activeEditor} tick={activeTick} />
  <!-- Outside the chrome fork: `handleOpen` clicks it wherever the File System
       Access API is missing, and both chromes reach that path. -->
  <input
    bind:this={fileInput}
    type="file"
    accept=".odt,.ott,.docx,.dotx,application/vnd.oasis.opendocument.text,application/vnd.oasis.opendocument.text-template,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.wordprocessingml.template"
    class="file-input"
    onchange={handleImportFile}
  />
  <div class="editor-row">
  <EditorComponent
    onDocumentLost={resetDocumentState}
    {documentEpoch}
    {pageRtl}
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
    {spacingModel}
    {spacingAtPageStart}
    {hyphenate}
    {documentLanguage}
    {pageNumbering}
    {pageDecor}
    {lineNumbering}
    {lineGrid}
    {balanceSpaces}
    foldMarks={foldMarksOn}
    commentAuthor={userName()}
    bind:extraHfSections
    {zoom}
    onZoom={setZoom}
    {showFormattingMarks}
    {showFieldShading}
    {showPageLabels}
    {showRuler}
    {splitView}
    pageColumns={gridColumns}
    {pageMargins}
    orientation={pageOrientation}
    {pageFormat}
  />
  {#if navigatorOpen}
    <NavigatorPane {editor} {tick} onClose={() => setNavigator({ open: false })} />
  {/if}
  {#if aiEnabled() && aiOpen}
    <AiPane {editor} host={aiHost} onClose={() => (aiOpen = false)} onSettings={() => { settingsSection = 'ai'; settingsOpen = true; }} />
  {/if}
  {#if commentsInPane() || draftInPane}
    <CommentsPane {editor} {tick} author={userName()} onClose={() => setShowComments(false)} />
  {/if}
  {#if changesInPane()}
    <RevisionsPane {editor} {tick} onClose={() => setShowChanges(false)} />
  {/if}
  {#if commentsInPane() || changesInPane()}
    <ConnectorLayer {editor} {tick} />
  {/if}
  </div>
  {#if findOpen && editor}
    <div class="find-bar-anchor" style="top: {toolbarRegionH + 8}px;">
      <FindReplaceBar {editor} {tick} mode={findMode} focusNonce={findNonce} onClose={closeFind} />
    </div>
  {/if}
  <footer class="statusbar" class:w-chrome={chromeMode === 'ribbon'}>
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
      <!-- The body editor, not activeEditor: a header/footer zone has no paragraph language. -->
      <LanguagePicker value={documentLanguage} other={documentLanguageOther} onChange={setDocumentLanguage} {editor} {tick} />
      <GrammarToggle value={documentLanguage} other={documentLanguageOther} {editor} {tick} />
    </div>
    <div class="sb-right">
    {#if embedded && attribution}<PoweredBy />{/if}
    <BusyIndicator {editor} task={busyTask} progress={busyProgress} />
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
  <TemplateGalleryDialog bind:open={templateGalleryOpen} onPick={applyTemplate} />
  <AutoCorrectDialog bind:open={autoCorrectOpen} />
  <AutoTextDialog bind:open={autoTextOpen} editor={activeEditor} />
  <ThesaurusDialog bind:open={thesaurusOpen} editor={activeEditor} />
  <BrowserDocumentsDialog bind:open={browserDocsOpen} />
  <SettingsDialog
    bind:open={settingsOpen}
    bind:section={settingsSection}
    {themeMode}
    onSelectTheme={selectTheme}
    bind:showRuler
    bind:showFormattingMarks
    bind:showFieldShading
    bind:showPageLabels
    bind:chromeMode
    recentCount={recentFiles.length}
    onClearRecent={() => { forgetRecentFiles(); recentFiles = []; }}
    onAutoCorrect={() => (autoCorrectOpen = true)}
    {documentLanguage}
    onLanguage={setDocumentLanguage}
  />
  <ResumeCard show={!volatile && tick >= 0 && !!editor && !isDocNonEmpty()} onShowAll={() => (browserDocsOpen = true)} />
  <PromptDialog />
  <DocPropertiesDialog bind:open={docPropsOpen} props={docProps} onApply={(p) => { docProps = p; saveDocProperties(p); }} />
  <PasswordDialog
    bind:open={passwordSetOpen}
    mode="set"
    hasPassword={docProtected}
    lost={passwordLost}
    onApply={applyPassword}
    onCancel={cancelPasswordSet}
  />
  <PasswordDialog
    bind:open={passwordAskOpen}
    mode="ask"
    wrong={passwordWrong}
    onApply={settleAsk}
    onCancel={() => settleAsk(null)}
  />
  <PasswordDialog
    bind:open={recordLockOpen}
    mode={recordLock() ? 'ask' : 'set'}
    title={recordLock() ? t().revisions.protectOff : t().revisions.protect}
    note={t().revisions.protectNote}
    wrong={recordLockWrong}
    onApply={applyRecordLock}
  />
  <!-- One instance for every entry point (styles gallery, insert-table menu): the
       callers only say which family to land on. -->
  <StyleManagerDialog bind:open={styleManagerOpen} family={styleManagerFamily} editor={activeEditor} asianDocument={isAsianTag(tagForLanguage(documentLanguage) ?? '')} scripts={numberingScripts(documentLanguage, documentLanguageOther, locale())} />
  <NoteOptionsDialog bind:open={noteOptionsOpen} />
  <SaveFormatDialog bind:open={saveFormatOpen} kind={saveFormatKind} askName={!fsSupported} name={documentName} placeholder={namePlaceholder} onPick={handleSaveAs} />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-bottom: 26px;
    position: relative;
  }

  /* The document scroller and the comments pane side by side; min-height keeps the
     scroller from growing past the row instead of scrolling inside it. */
  .editor-row {
    display: flex;
    flex: 1;
    min-height: 0;
    /* The origin ConnectorLayer draws in — it spans the scroller and the panes. */
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

  .doc-dirty {
    flex-shrink: 0;
    white-space: nowrap;
    font-size: 0.72rem;
    color: var(--color-text-muted);
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

  .theme-btn.active {
    background: var(--color-primary);
    color: white;
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

  .theme-option:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  .theme-option:disabled {
    opacity: 0.5;
    cursor: default;
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
    gap: 0.85rem;
    padding: 0 1rem;
    background: var(--color-toolbar-bg);
    border-top: 1px solid var(--color-border);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    color: var(--color-text);
    white-space: nowrap;
    user-select: none;
    z-index: 50;
  }

  /* The bar closes the frame the chrome above it opens, so under the ribbon it takes
     the ribbon's palette — the same token remap .ribbon does for its pickers, which
     is what the popup and the language picker inside here read too. */
  .statusbar.w-chrome {
    --color-toolbar-bg: var(--w-chrome);
    --color-surface: var(--w-surface);
    --color-border: var(--w-border);
    --color-text: var(--w-text);
    --color-text-muted: var(--w-text-dim);
    --color-primary: var(--w-accent);
    --color-btn-hover: var(--w-hover);
    --font-sans: var(--w-font);
    --radius: 3px;

    border-top-color: var(--w-border-strong);
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
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
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

  /* A narrow window drops the slider, a very narrow one the −/+ buttons too; the
     percentage stays as the reset button. */
  @media (max-width: 720px) {
    .zoom-slider {
      display: none;
    }
  }

  @media (max-width: 600px) {
    .zoom-btn {
      display: none;
    }
  }
</style>
