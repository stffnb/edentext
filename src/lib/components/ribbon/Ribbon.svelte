<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { NodeSelection } from '@tiptap/pm/state';
  import Icon from './Icon.svelte';
  import RibbonMenu from './RibbonMenu.svelte';
  import HistoryButton from '../HistoryButton.svelte';
  import HomeTab from './tabs/HomeTab.svelte';
  import InsertTab from './tabs/InsertTab.svelte';
  import LayoutTab from './tabs/LayoutTab.svelte';
  import ReferencesTab from './tabs/ReferencesTab.svelte';
  import ReviewTab from './tabs/ReviewTab.svelte';
  import ViewTab from './tabs/ViewTab.svelte';
  import TableTabs from './tabs/TableTabs.svelte';
  import FrameTabs from './tabs/FrameTabs.svelte';
  import UiLanguagePicker from '../UiLanguagePicker.svelte';
  import ParagraphDialog from '../ParagraphDialog.svelte';
  import TabsDialog from '../TabsDialog.svelte';
  import { clickOutside, isMenuOpen, pinPanels, toggleMenu, closeMenu } from './menu.svelte';
  import { t } from '../../i18n/i18n.svelte';
  import { withShortcut } from '../../i18n/shortcut';
  import { shortcutHint } from '../../editor/shortcuts';
  import { findTextBox } from '../../editor/extensions/textBox';
  import { loadRibbonCollapsed, saveRibbonCollapsed, type ChromeMode, type ThemeMode } from '../../storage/theme';
  import type { StyleFamily } from '../../styles/styleSheet';
  import { DEFAULT_MARGINS, type PageMargins } from '../../storage/pageMargins';
  import type { Orientation } from '../../storage/pageOrientation';
  import type { PageFormat } from '../../storage/pageFormat';
  import type { HfSet, HfZone } from '../../storage/headerFooter';
  import type { DocumentLanguage } from '../../storage/documentLanguage';
  import { DEFAULT_TAB_INTERVAL_CM } from '../../storage/tabInterval';
  import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../../storage/pageNumbering';
  import { EMPTY_PAGE_DECOR, type PageDecor } from '../../storage/pageDecor';
  import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../../storage/lineNumbering';

  let {
    editor,
    tick,
    chromeMode = $bindable<ChromeMode>('ribbon'),
    documentName = $bindable(''),
    documentFormat = 'odt',
    showFormattingMarks = $bindable(false),
    showRuler = $bindable(true),
    splitView = $bindable(false),
    pageColumns = $bindable(1),
    documentLanguage,
    onLanguage,
    zoom = 100,
    onZoom,
    onDebugDump,
    tabIntervalCm = $bindable(DEFAULT_TAB_INTERVAL_CM),
    pageMargins = $bindable(DEFAULT_MARGINS),
    pageOrientation = $bindable<Orientation>('portrait'),
    pageFormat = $bindable<PageFormat>('A4'),
    extraHfSections = $bindable<HfSet[]>([]),
    hyphenate = $bindable(false),
    pageNumbering = $bindable(DEFAULT_PAGE_NUMBERING),
    pageDecor = $bindable(EMPTY_PAGE_DECOR),
    lineNumbering = $bindable(DEFAULT_LINE_NUMBERING),
    hfActive = null,
    onManageStyles,
    onManageTableStyles,
    onNoteOptions,
    onEditZone,
    onFind,
    namePlaceholder = '',
    themeMode = 'auto',
    onSelectTheme,
    docxBusy = false,
    pdfBusy = false,
    onNew, onOpen, onSave, onSaveAs, onSaveDocx, onSaveTemplate, onExportPdf, onPrintPdf, onPrint, onAbout, onDocProperties, onAutoCorrect, onAutoText, onNewComment, commentsOpen = false, onToggleComments, revisionsOpen = false, onToggleRevisions,
    navigatorOpen = false, onToggleNavigator,
    recentFiles = [], onOpenRecent, onForgetRecent,
  }: {
    editor: Editor | null;
    tick: number;
    chromeMode?: ChromeMode;
    documentName?: string;
    documentFormat?: 'odt' | 'docx';
    showFormattingMarks?: boolean;
    showRuler?: boolean;
    splitView?: boolean;
    pageColumns?: number;
    documentLanguage: DocumentLanguage;
    onLanguage: (code: DocumentLanguage) => void;
    zoom?: number;
    onZoom?: (value: number) => void;
    onDebugDump?: () => void;
    tabIntervalCm?: number;
    pageMargins?: PageMargins;
    pageOrientation?: Orientation;
    pageFormat?: PageFormat;
    extraHfSections?: HfSet[];
    hyphenate?: boolean;
    pageNumbering?: PageNumbering;
    pageDecor?: PageDecor;
    lineNumbering?: LineNumbering;
    hfActive?: HfZone | null;
    onManageStyles?: (family: StyleFamily) => void;
    onManageTableStyles?: (family: StyleFamily) => void;
    onNoteOptions?: () => void;
    onEditZone?: (zone: HfZone) => void;
    onFind?: (mode: 'find' | 'replace') => void;
    namePlaceholder?: string;
    themeMode?: ThemeMode;
    onSelectTheme?: (mode: ThemeMode) => void;
    docxBusy?: boolean;
    pdfBusy?: boolean;
    onNew?: () => void;
    onOpen?: () => void;
    onSave?: () => void;
    onSaveAs?: () => void;
    onSaveDocx?: () => void;
    onSaveTemplate?: () => void;
    recentFiles?: { id: string; name: string }[];
    onOpenRecent?: (id: string) => void;
    onForgetRecent?: () => void;
    onExportPdf?: () => void;
    onPrintPdf?: () => void;
    onPrint?: () => void;
    onAbout?: () => void;
    onDocProperties?: () => void;
    onAutoCorrect?: () => void;
    onAutoText?: () => void;
    onNewComment?: () => void;
    commentsOpen?: boolean;
    onToggleComments?: () => void;
    revisionsOpen?: boolean;
    onToggleRevisions?: () => void;
    navigatorOpen?: boolean;
    onToggleNavigator?: () => void;
  } = $props();

  const TABS = ['home', 'insert', 'layout', 'references', 'review', 'view'] as const;
  const CONTEXTUAL = ['tableDesign', 'tableLayout', 'pictureFormat', 'shapeFormat'] as const;
  type Tab = (typeof TABS)[number] | (typeof CONTEXTUAL)[number];

  // Word opens on Home every time, so the active tab is not persisted.
  let tab = $state<Tab>('home');

  // Word's contextual tabs: they appear while the caret is in the object and
  // vanish with it, so a tab that disappears hands the strip back to Home.
  let inTable = $derived(tick >= 0 && !!editor?.isActive('table'));

  let selectedNode = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    const sel = editor.state.selection;
    return sel instanceof NodeSelection ? sel.node.type.name : null;
  });

  // A text box is worked on with the caret inside it just as often as with the box
  // selected, so the tab follows the caret — the floating toolbar reads the same box.
  let textBox = $derived.by(() => (tick >= 0 && editor ? findTextBox(editor.state) : null));
  let inTextBox = $derived(!!textBox && selectedNode !== 'image');

  let frameAttrs = $derived.by<Record<string, unknown> | null>(() => {
    if (tick < 0 || !editor) return null;
    const sel = editor.state.selection;
    if (sel instanceof NodeSelection && !inTextBox) return sel.node.attrs;
    return textBox?.node.attrs ?? null;
  });

  let shown = $derived([
    ...TABS,
    ...(inTable ? (['tableDesign', 'tableLayout'] as const) : []),
    ...(selectedNode === 'image' ? (['pictureFormat'] as const) : []),
    ...(inTextBox ? (['shapeFormat'] as const) : []),
  ] as Tab[]);

  $effect(() => {
    if (!shown.includes(tab)) tab = 'home';
  });

  let docNameSizerWidth = $state(0);
  let paragraphDialogOpen = $state(false);
  let tabsDialogOpen = $state(false);

  let collapsed = $state(loadRibbonCollapsed());
  $effect(() => saveRibbonCollapsed(collapsed));

  function run(fn?: () => void) {
    closeMenu();
    fn?.();
  }
</script>

<div class="ribbon">
  <div class="ribbon-tabs" class:strip-only={collapsed}>
    <div class="file-tab-wrap" use:clickOutside={'file'}>
      <button
        class="ribbon-tab-file"
        class:open={isMenuOpen('file')}
        onclick={() => toggleMenu('file')}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen('file')}
      >
        {t().ribbon.tabs.file}
      </button>
      {#if isMenuOpen('file')}
        <RibbonMenu minWidth={230}>
          <button onclick={() => run(onNew)} disabled={!editor}>
            <Icon name="newDoc" size={16} />{t().app.newDocument}
          </button>
          <button onclick={() => run(onOpen)} disabled={!editor}>
            <Icon name="folder" size={16} />{t().app.open}
            <span class="menu-key">{shortcutHint('open')}</span>
          </button>
          <hr />
          <button onclick={() => run(onSave)} disabled={!editor || pdfBusy}>
            <Icon name="save" size={16} />{t().app.save}
            <span class="menu-key">{withShortcut('Ctrl+S')}</span>
          </button>
          <button onclick={() => run(onSaveAs)} disabled={!editor || pdfBusy}>
            <Icon name="save" size={16} />{t().ribbon.saveAs}
          </button>
          <hr />
          <button onclick={() => run(onSaveDocx)} disabled={docxBusy}>
            <Icon name="export" size={16} />{docxBusy ? t().app.exporting : t().app.wordDocx}
            <span class="menu-sub">{t().app.microsoftWord}</span>
          </button>
          <button onclick={() => run(onExportPdf)} disabled={pdfBusy}>
            <Icon name="export" size={16} />{pdfBusy ? t().app.exporting : t().app.rasterPdf}
            <span class="menu-sub">{t().app.rasterHint}</span>
          </button>
          <button onclick={() => run(onPrintPdf)}>
            <Icon name="export" size={16} />{t().app.vectorPdf}
            <span class="menu-sub">{t().app.vectorHint}</span>
          </button>
          <button onclick={() => run(onSaveTemplate)}>
            <Icon name="export" size={16} />{t().app.template}
            <span class="menu-sub">{t().app.templateHint}</span>
          </button>
          {#if recentFiles.length}
            <hr />
            {#each recentFiles as f (f.id)}
              <button onclick={() => { closeMenu(); onOpenRecent?.(f.id); }}>
                <Icon name="folder" size={16} />{f.name}
              </button>
            {/each}
            <button onclick={() => run(onForgetRecent)}>
              <span class="menu-sub">{t().app.clearRecentFiles}</span>
            </button>
          {/if}
          <hr />
          <button onclick={() => run(onPrint)} disabled={!editor || pdfBusy}>
            <Icon name="print" size={16} />{t().app.print}
            <span class="menu-key">{withShortcut('Ctrl+P')}</span>
          </button>
          <button onclick={() => run(onDocProperties)}>
            <Icon name="info" size={16} />{t().docProps.title}
          </button>
          <button onclick={() => run(onAbout)}>
            <Icon name="info" size={16} />{t().about.label}
          </button>
        </RibbonMenu>
      {/if}
    </div>

    <button class="qa-btn" onclick={onSave} disabled={!editor || pdfBusy} title={`${t().app.save} (${withShortcut('Ctrl+S')})`}>
      <Icon name="save" size={16} />
    </button>
    <HistoryButton {editor} {tick} direction="undo" />
    <HistoryButton {editor} {tick} direction="redo" />
    <span class="qa-sep"></span>

    {#each shown as id}
      <button
        class="ribbon-tab"
        class:active={tab === id}
        class:contextual={!(TABS as readonly string[]).includes(id)}
        onclick={() => { tab = id; collapsed = false; }}
      >
        {t().ribbon.tabs[id]}
      </button>
    {/each}

    <span class="ribbon-tabs-spacer"></span>

    <div class="doc-name">
      <span class="doc-name-sizer" aria-hidden="true" bind:clientWidth={docNameSizerWidth}>{documentName || namePlaceholder}</span>
      <input
        class="doc-name-input"
        type="text"
        style="width: {docNameSizerWidth + 14}px"
        bind:value={documentName}
        placeholder={namePlaceholder}
        title={t().app.documentName}
        onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        onblur={() => (documentName = documentName.trim())}
      />
      <span class="doc-name-ext">.{documentFormat}</span>
    </div>

    <!-- Word puts this chevron in the band's corner. It rides the strip so the band
         keeps its full width: a flex row can only reserve a column, never a corner. -->
    <button
      class="qa-btn rb-collapse"
      class:rb-collapse-up={!collapsed}
      onclick={() => (collapsed = !collapsed)}
      title={collapsed ? t().ribbon.expand : t().ribbon.collapse}
      aria-label={collapsed ? t().ribbon.expand : t().ribbon.collapse}
      aria-expanded={!collapsed}
    >
      <Icon name="chevronDown" size={16} />
    </button>

    <div class="appearance-wrap" use:clickOutside={'appearance'}>
      <button
        class="qa-btn"
        class:open={isMenuOpen('appearance')}
        onclick={() => toggleMenu('appearance')}
        title={t().appearance.title}
        aria-haspopup="menu"
        aria-expanded={isMenuOpen('appearance')}
      >
        <Icon name="ribbon" size={16} />
      </button>
      {#if isMenuOpen('appearance')}
        <RibbonMenu align="right" minWidth={220} heading={t().ribbon.chrome.title}>
          <button class:selected={chromeMode === 'ribbon'} onclick={() => { chromeMode = 'ribbon'; closeMenu(); }}>
            {t().ribbon.chrome.ribbon}<span class="menu-sub">{t().ribbon.chrome.ribbonHint}</span>
          </button>
          <button class:selected={chromeMode === 'modern'} onclick={() => { chromeMode = 'modern'; closeMenu(); }}>
            {t().ribbon.chrome.modern}<span class="menu-sub">{t().ribbon.chrome.modernHint}</span>
          </button>
          <hr />
          <div class="rb-menu-label">{t().appearance.title}</div>
          {#each (['light', 'dark', 'allBlack', 'auto'] as const) as m}
            <button class:selected={themeMode === m} onclick={() => { onSelectTheme?.(m); closeMenu(); }}>
              {t().appearance[m]}
              {#if m === 'allBlack'}<span class="menu-sub">{t().appearance.allBlackHint}</span>{/if}
            </button>
          {/each}
        </RibbonMenu>
      {/if}
    </div>

    <UiLanguagePicker />

    <button class="rb-logo-btn" onclick={() => run(onAbout)} title={t().about.label} aria-label={t().about.label}>
      <img src="favicon.svg" alt="" aria-hidden="true" />
    </button>
  </div>

  {#if !collapsed}
  <div class="ribbon-body" use:pinPanels>
    {#if tab === 'home'}
      <HomeTab {editor} {tick} bind:showFormattingMarks {onManageStyles} {onFind} onParagraphDialog={() => (paragraphDialogOpen = true)} />
    {:else if tab === 'insert'}
      <InsertTab {editor} {tick} {hfActive} {pageMargins} {pageOrientation} {pageFormat} {onEditZone} {onManageTableStyles} {onAutoText} />
    {:else if tab === 'layout'}
      <LayoutTab {editor} {tick} {hfActive} bind:pageMargins bind:pageOrientation bind:pageFormat bind:extraHfSections bind:hyphenate bind:pageNumbering bind:pageDecor bind:lineNumbering onParagraphDialog={() => (paragraphDialogOpen = true)} />
    {:else if tab === 'references'}
      <ReferencesTab {editor} {tick} {hfActive} {onNoteOptions} />
    {:else if tab === 'review'}
      <ReviewTab {editor} {tick} {documentLanguage} {onLanguage} {onAutoCorrect} {onNewComment} {commentsOpen} {onToggleComments} {revisionsOpen} {onToggleRevisions} />
    {:else if tab === 'view'}
      <ViewTab bind:showRuler bind:showFormattingMarks bind:splitView bind:pageColumns {zoom} {onZoom} {onDebugDump} {navigatorOpen} {onToggleNavigator} />
    {:else if tab === 'tableDesign' || tab === 'tableLayout'}
      <TableTabs {editor} {tick} which={tab === 'tableDesign' ? 'design' : 'layout'} />
    {:else if tab === 'pictureFormat' || tab === 'shapeFormat'}
      <FrameTabs
        {editor}
        which={tab === 'pictureFormat' ? 'picture' : 'shape'}
        wrap={(frameAttrs?.wrap ?? 'inline') as never}
        alt={(frameAttrs?.alt ?? '') as string}
        shapeKind={frameAttrs?.shapeKind as never}
        fillColor={frameAttrs?.fillColor as string | null}
        strokeColor={frameAttrs?.strokeColor as string | null}
        strokeWidthPt={frameAttrs?.strokeWidthPt as number}
        textVertical={frameAttrs?.textVertical === true}
      />
    {/if}
  </div>
  {/if}

  <ParagraphDialog bind:open={paragraphDialogOpen} {editor} {tick} onTabs={() => (tabsDialogOpen = true)} />
  <TabsDialog bind:open={tabsDialogOpen} {editor} {tick} bind:tabIntervalCm />
</div>

<style>
  /* Word's palette reaches the reused pickers (ColorPicker, HistoryButton, the
     table pickers …) by remapping the app's own tokens here: custom properties
     inherit, so those components adopt the ribbon's look with no edits, and the
     modern toolbar keeps the themed set. */
  .ribbon {
    --color-surface: var(--w-surface);
    --color-toolbar-bg: var(--w-chrome);
    --color-border: var(--w-border);
    --color-text: var(--w-text);
    --color-text-muted: var(--w-text-dim);
    /* Those pickers paint --color-primary as a surface under white far more than
       as text, so it takes the fill accent. */
    --color-primary: var(--w-accent-fill);
    --color-btn-hover: var(--w-hover);
    --font-sans: var(--w-font);
    --radius: 3px;
    --toolbar-btn-size: 30px;

    flex-shrink: 0;
    background: var(--w-chrome);
    border-bottom: 1px solid var(--w-border-strong);
    font-family: var(--w-font);
    color: var(--w-text);
    user-select: none;
  }

  /* Points down to bring the band back, up to send it away. */
  .rb-collapse :global(svg) { transition: transform 0.12s ease; }
  .rb-collapse-up :global(svg) { transform: rotate(180deg); }

  /* Those pickers frame their trigger for the modern toolbar's tinted island. A
     ribbon row is borderless icon buttons, so the frame comes off and the hover
     tint takes over — same 30px box as .rb-icon, so a row reads as one strip. */
  .ribbon :global(.color-split) {
    border-color: transparent;
    background: none;
  }

  .ribbon :global(.color-split:hover) {
    border-color: transparent;
    background: var(--w-hover);
  }

  .ribbon :global(.color-main) {
    min-width: 28px;
    padding: 0 4px;
  }

  .ribbon :global(.color-chevron) {
    width: 13px;
    border-left: none;
    color: var(--w-text-dim);
  }

  .ribbon :global(.color-chevron:hover) { background: var(--w-pressed); }

  .ribbon :global(.bp-trigger) { height: 30px; }

  /* Wraps once the tabs, the name and the chrome buttons stop fitting. It cannot
     scroll like the band does: the File and appearance menus drop from inside it,
     and a scroll container would clip them. */
  .ribbon-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px;
    padding: 3px 10px 0;
  }

  /* The active tab's underline hangs below its box, onto the band. Collapsed there
     is no band, so the strip lends it the room instead of the bottom border. */
  .ribbon-tabs.strip-only { padding-bottom: 5px; }

  .ribbon-tab {
    position: relative;
    border: none;
    background: none;
    padding: 5px 9px;
    border-radius: 4px 4px 0 0;
    color: var(--w-text);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .ribbon-tab:hover { color: var(--w-accent); }

  /* Word tints a contextual tab so it reads as belonging to the selected object
     rather than to the document. Ours takes the logo's second colour, so the pair
     appears where the two tab kinds sit side by side. */
  .ribbon-tab.contextual { color: var(--w-contextual); }
  .ribbon-tab.contextual::before {
    content: '';
    position: absolute;
    inset: 2px 4px auto;
    height: 2px;
    border-radius: 1px;
    background: var(--brand-clay);
  }
  .ribbon-tab.active { color: var(--w-accent); }

  /* Word's underline is inset from the tab's edges, not full width. */
  .ribbon-tab.active::after {
    content: '';
    position: absolute;
    left: 13px;
    right: 13px;
    bottom: -2.5px;
    height: 2.5px;
    border-radius: 1px;
    background: var(--w-accent);
  }

  .file-tab-wrap {
    position: relative;
  }

  /* The one place the accent is a surface rather than a line, so it has its own
     token: the accent that reads on the chrome is too light to carry white. */
  .rb-logo-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin-left: 6px;
    padding: 0;
    border: none;
    background: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .rb-logo-btn:hover { background: var(--w-hover); }
  .rb-logo-btn img { height: 18px; width: auto; display: block; }

  .ribbon-tab-file {
    border: none;
    background: var(--w-accent-fill);
    color: #fff;
    border-radius: 4px;
    padding: 5px 14px;
    margin-right: 6px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .ribbon-tab-file:hover,
  .ribbon-tab-file.open { background: var(--w-accent-fill-open); }

  .qa-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 26px;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--w-text);
    cursor: pointer;
  }

  .qa-btn:hover:not(:disabled),
  .qa-btn.open { background: var(--w-hover); }
  .qa-btn:disabled { color: var(--w-text-tertiary); cursor: default; }

  .qa-sep {
    width: 1px;
    height: 16px;
    margin: 0 6px;
    background: var(--w-border-strong);
  }

  .ribbon-tabs-spacer { flex: 1; }

  .appearance-wrap { position: relative; }

  /* The name field grows with its text: the sizer mirrors the value and lends the
     input its width. */
  .doc-name {
    display: inline-flex;
    align-items: center;
    max-width: 30%;
    color: var(--w-text-dim);
    font-size: 12px;
  }

  .doc-name-sizer {
    position: absolute;
    visibility: hidden;
    white-space: pre;
    font-size: 12px;
    font-family: inherit;
  }

  .doc-name-input {
    min-width: 2rem;
    max-width: 16rem;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 4px;
    background: none;
    color: var(--w-text-dim);
    font: inherit;
    font-size: 12px;
    text-align: right;
  }

  .doc-name-input:hover { border-color: var(--w-border-strong); }
  .doc-name-input:focus { outline: none; border-color: var(--w-accent); color: var(--w-text); }

  .doc-name-ext { margin-right: 6px; }

  .ribbon-body {
    display: flex;
    align-items: stretch;
    height: var(--w-ribbon-h);
    padding: 3px 10px;
    /* Fixed height, scroll instead of Word's responsive group collapsing — the
       scrollbar is hidden so the band stays clean. */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .ribbon-body::-webkit-scrollbar { display: none; }
</style>
