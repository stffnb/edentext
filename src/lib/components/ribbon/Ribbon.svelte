<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import Icon from './Icon.svelte';
  import RibbonMenu from './RibbonMenu.svelte';
  import HistoryButton from '../HistoryButton.svelte';
  import HomeTab from './tabs/HomeTab.svelte';
  import InsertTab from './tabs/InsertTab.svelte';
  import UiLanguagePicker from '../UiLanguagePicker.svelte';
  import { clickOutside, isMenuOpen, toggleMenu, closeMenu } from './menu.svelte';
  import { t } from '../../i18n/i18n.svelte';
  import { withShortcut } from '../../i18n/shortcut';
  import { shortcutHint } from '../../editor/shortcuts';
  import type { ChromeMode, ThemeMode } from '../../storage/theme';
  import type { StyleFamily } from '../../styles/styleSheet';
  import type { PageMargins } from '../../storage/pageMargins';
  import type { Orientation } from '../../storage/pageOrientation';
  import type { PageFormat } from '../../storage/pageFormat';
  import type { HfZone } from '../../storage/headerFooter';

  let {
    editor,
    tick,
    chromeMode = $bindable<ChromeMode>('ribbon'),
    documentName = $bindable(''),
    showFormattingMarks = $bindable(false),
    pageMargins,
    pageOrientation,
    pageFormat,
    hfActive = null,
    onManageStyles,
    onManageTableStyles,
    onEditZone,
    onFind,
    namePlaceholder = '',
    themeMode = 'auto',
    onSelectTheme,
    docxBusy = false,
    pdfBusy = false,
    onNew, onOpen, onSave, onSaveAs, onSaveDocx, onExportPdf, onPrintPdf, onPrint, onAbout,
  }: {
    editor: Editor | null;
    tick: number;
    chromeMode?: ChromeMode;
    documentName?: string;
    showFormattingMarks?: boolean;
    pageMargins: PageMargins;
    pageOrientation: Orientation;
    pageFormat: PageFormat;
    hfActive?: HfZone | null;
    onManageStyles?: (family: StyleFamily) => void;
    onManageTableStyles?: (family: StyleFamily) => void;
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
    onExportPdf?: () => void;
    onPrintPdf?: () => void;
    onPrint?: () => void;
    onAbout?: () => void;
  } = $props();

  const TABS = ['home', 'insert', 'layout', 'references', 'review', 'view'] as const;
  type Tab = (typeof TABS)[number];

  // Word opens on Home every time, so the active tab is not persisted.
  let tab = $state<Tab>('home');

  let docNameSizerWidth = $state(0);

  function run(fn?: () => void) {
    closeMenu();
    fn?.();
  }
</script>

<div class="ribbon">
  <div class="ribbon-tabs">
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
            <Icon name="folder" size={16} />{t().app.openOdt}
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
          <hr />
          <button onclick={() => run(onPrint)} disabled={!editor || pdfBusy}>
            <Icon name="print" size={16} />{t().app.print}
            <span class="menu-key">{withShortcut('Ctrl+P')}</span>
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

    {#each TABS as id}
      <button class="ribbon-tab" class:active={tab === id} onclick={() => (tab = id)}>
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
      <span class="doc-name-ext">.odt</span>
    </div>

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
          <button class:selected={chromeMode === 'classic'} onclick={() => { chromeMode = 'classic'; closeMenu(); }}>
            {t().ribbon.chrome.classic}<span class="menu-sub">{t().ribbon.chrome.classicHint}</span>
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
  </div>

  <div class="ribbon-body">
    {#if tab === 'home'}
      <HomeTab {editor} {tick} bind:showFormattingMarks {onManageStyles} {onFind} />
    {:else if tab === 'insert'}
      <InsertTab {editor} {tick} {hfActive} {pageMargins} {pageOrientation} {pageFormat} {onEditZone} {onManageTableStyles} />
    {/if}
  </div>
</div>

<style>
  /* Word's palette reaches the reused pickers (ColorPicker, HistoryButton, the
     table pickers …) by remapping the app's own tokens here: custom properties
     inherit, so those components adopt the ribbon's look with no edits, and the
     classic toolbar keeps the themed set. */
  .ribbon {
    --color-surface: var(--w-surface);
    --color-toolbar-bg: var(--w-chrome);
    --color-border: var(--w-border);
    --color-text: var(--w-text);
    --color-text-muted: var(--w-text-dim);
    --color-primary: var(--w-accent);
    --color-btn-hover: var(--w-hover);
    --font-sans: var(--w-font);
    --radius: 3px;
    --toolbar-btn-size: 28px;

    flex-shrink: 0;
    background: var(--w-chrome);
    border-bottom: 1px solid var(--w-border-strong);
    font-family: var(--w-font);
    color: var(--w-text);
    user-select: none;
  }

  .ribbon-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 10px 0;
  }

  .ribbon-tab {
    position: relative;
    border: none;
    background: none;
    padding: 7px 9px 6px;
    border-radius: 4px 4px 0 0;
    color: var(--w-text);
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .ribbon-tab:hover { color: var(--w-accent); }
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

  .ribbon-tab-file {
    border: none;
    background: var(--w-accent);
    color: #fff;
    border-radius: 4px;
    padding: 6px 16px;
    margin-right: 6px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .ribbon-tab-file:hover,
  .ribbon-tab-file.open { background: var(--w-accent-dark); }

  .qa-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 28px;
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
    padding: 6px 12px;
    /* Fixed height, scroll instead of Word's responsive group collapsing — the
       scrollbar is hidden so the band stays clean. */
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .ribbon-body::-webkit-scrollbar { display: none; }
</style>
