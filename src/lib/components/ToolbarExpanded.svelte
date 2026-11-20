<script lang="ts">
  import ReadGate from './ReadGate.svelte';
  import type { Editor } from '@tiptap/core';
  import HomeTools from './toolbar/HomeTools.svelte';
  import InsertTools from './toolbar/InsertTools.svelte';
  import LayoutTools from './toolbar/LayoutTools.svelte';
  import ReferenceTools from './toolbar/ReferenceTools.svelte';
  import ReviewTools from './toolbar/ReviewTools.svelte';
  import ViewTools from './toolbar/ViewTools.svelte';
  import ParagraphDialog from './ParagraphDialog.svelte';
  import { OPEN_TABS_DIALOG_EVENT } from '../editor/extensions/tabStops';
  import { CATEGORIES, type Category } from './toolbar/island';
  import { closeMenu } from './ribbon/menu.svelte';
  import { DEFAULT_MARGINS, type PageMargins } from '../storage/pageMargins';
  import type { Orientation } from '../storage/pageOrientation';
  import type { PageFormat } from '../storage/pageFormat';
  import { DEFAULT_HF_DISTANCES, type HfDistances, type HfSet, type HfZone } from '../storage/headerFooter';
  import { DEFAULT_PAGE_NUMBERING, type PageNumbering } from '../storage/pageNumbering';
  import { EMPTY_PAGE_DECOR, type PageDecor } from '../storage/pageDecor';
  import { DEFAULT_LINE_NUMBERING, type LineNumbering } from '../storage/lineNumbering';
  import type { DocumentLanguage } from '../storage/documentLanguage';
  import type { StyleFamily } from '../styles/styleSheet';
  import { t } from '../i18n/i18n.svelte';

  // The island's Tools row: a strip of categories and the chosen one's controls — what
  // the ribbon's tabs hold beyond the island's first row.
  let {
    editor, tick,
    category = $bindable<Category>('home'),
    showFormattingMarks = $bindable(false),
    showFieldShading = $bindable(true),
    showRuler = $bindable(true),
    splitView = $bindable(false),
    pageColumns = $bindable(1),
    pageMargins = $bindable(DEFAULT_MARGINS),
    pageOrientation = $bindable<Orientation>('portrait'),
    pageFormat = $bindable<PageFormat>('A4'),
    extraHfSections = $bindable<HfSet[]>([]),
    hfDistances = $bindable(DEFAULT_HF_DISTANCES),
    differentFirstPage = $bindable(false),
    differentOddEven = $bindable(false),
    hyphenate = $bindable(false),
    pageRtl = $bindable(false),
    pageNumbering = $bindable(DEFAULT_PAGE_NUMBERING),
    pageDecor = $bindable(EMPTY_PAGE_DECOR),
    lineNumbering = $bindable(DEFAULT_LINE_NUMBERING),
    foldMarks = $bindable(false),
    hfActive = null,
    asianDocument = false,
    documentLanguage,
    documentLanguageOther,
    zoom = 100,
    navigatorOpen = false,
    onLanguage, onZoom, onEditZone, onDebugDump, onManageTableStyles, onNoteOptions, onHeadingNumbering,
    onFind, onAutoCorrect, onAutoText, onNewComment, onReviewSettings, onToggleNavigator,
  }: {
    editor: Editor | null;
    tick: number;
    category?: Category;
    showFormattingMarks?: boolean;
    showFieldShading?: boolean;
    showRuler?: boolean;
    splitView?: boolean;
    pageColumns?: number;
    pageMargins?: PageMargins;
    pageOrientation?: Orientation;
    pageFormat?: PageFormat;
    extraHfSections?: HfSet[];
    hfDistances?: HfDistances;
    differentFirstPage?: boolean;
    differentOddEven?: boolean;
    hyphenate?: boolean;
    pageRtl?: boolean;
    pageNumbering?: PageNumbering;
    pageDecor?: PageDecor;
    lineNumbering?: LineNumbering;
    foldMarks?: boolean;
    hfActive?: HfZone | null;
    asianDocument?: boolean;
    documentLanguage: DocumentLanguage;
    documentLanguageOther: string | null;
    zoom?: number;
    navigatorOpen?: boolean;
    onLanguage: (code: DocumentLanguage) => void;
    onZoom?: (value: number) => void;
    onEditZone?: (zone: HfZone) => void;
    onDebugDump?: () => void;
    onManageTableStyles?: (family: StyleFamily) => void;
    onNoteOptions?: () => void;
    onHeadingNumbering?: () => void;
    onFind?: (mode: 'find' | 'replace') => void;
    onAutoCorrect?: () => void;
    onAutoText?: () => void;
    onNewComment?: () => void;
    onReviewSettings?: () => void;
    onToggleNavigator?: () => void;
  } = $props();

  let paragraphDialogOpen = $state(false);
  const openTabs = () => window.dispatchEvent(new CustomEvent(OPEN_TABS_DIALOG_EVENT));
</script>

<div class="toolbar-expanded">
  <div class="categories" role="tablist" aria-label={t().app.tools}>
    {#each CATEGORIES as c}
      <button
        class="category"
        class:active={category === c}
        role="tab"
        aria-selected={category === c}
        data-category={c}
        onclick={() => { closeMenu(); category = c; }}
      >{t().ribbon.tabs[c]}</button>
    {/each}
  </div>

  <div class="toolbar-separator"></div>

  {#if editor}
    {#if category === 'home'}
      <HomeTools {editor} {tick} {asianDocument} bind:showFormattingMarks {onFind} onParagraphDialog={() => (paragraphDialogOpen = true)} />
    {:else if category === 'insert'}
      <ReadGate>
      <InsertTools {editor} {tick} {hfActive} {pageMargins} {pageOrientation} {pageFormat} bind:hfDistances bind:differentFirstPage bind:differentOddEven
        {onEditZone} onManageTableStyles={() => onManageTableStyles?.('table')} {onAutoText} onTabsDialog={openTabs} />
      </ReadGate>
    {:else if category === 'layout'}
      <ReadGate>
      <LayoutTools {editor} {tick} {hfActive} bind:pageMargins bind:pageOrientation bind:pageFormat bind:extraHfSections bind:hyphenate bind:pageRtl
        bind:pageNumbering bind:pageDecor bind:lineNumbering bind:foldMarks onParagraphDialog={() => (paragraphDialogOpen = true)} />
      </ReadGate>
    {:else if category === 'references'}
      <ReadGate>
      <ReferenceTools {editor} {tick} {hfActive} {onNoteOptions} {onHeadingNumbering} />
      </ReadGate>
    {:else if category === 'review'}
      <ReviewTools {editor} {tick} {documentLanguage} {documentLanguageOther} {onLanguage} {onAutoCorrect} {onNewComment} {onReviewSettings} />
    {:else}
      <ViewTools bind:showRuler bind:showFormattingMarks bind:showFieldShading bind:splitView bind:pageColumns {zoom} {onZoom} {onDebugDump} {navigatorOpen} {onToggleNavigator} />
    {/if}
  {/if}
</div>

<ParagraphDialog bind:open={paragraphDialogOpen} {editor} {tick} onTabs={openTabs} />

<style>
  /* Inner content of the second toolbar row; the surrounding .toolbar-secondary
     (App.svelte) owns the background, divider and elevation. */
  .toolbar-expanded {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex: 1;
    min-width: 0;
    padding: 0;
  }

  /* The categories as one segmented pill, in the island's control height. */
  .categories {
    display: inline-flex;
    flex: none;
    gap: 1px;
    padding: 2px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--color-btn-hover) 25%, transparent);
  }

  .category {
    height: calc(var(--toolbar-btn-size) - 6px);
    padding: 0 0.55rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.78rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .category:hover:not(.active) { background: var(--color-btn-hover); }

  .category.active {
    background: var(--color-primary);
    color: white;
  }

  /* The categories' groups share the first row's layout. */
  .toolbar-expanded :global(.toolbar-group) {
    display: flex;
    align-items: center;
    gap: 1px;
  }

  .toolbar-expanded :global(.toolbar-separator) {
    width: 1px;
    height: 1.2rem;
    background: var(--color-border);
    margin: 0 0.3rem;
  }

  /* Marks a reused picker for the command search without adding a box around it. */
  .toolbar-expanded :global(.cmd) { display: contents; }
</style>
