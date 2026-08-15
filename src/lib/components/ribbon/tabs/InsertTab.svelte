<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import TablePicker from '../../TablePicker.svelte';
  import SpecialCharPicker from '../../SpecialCharPicker.svelte';
  import DateTimePicker from '../../DateTimePicker.svelte';
  import LinkDialog from '../../LinkDialog.svelte';
  import BookmarkDialog from '../../BookmarkDialog.svelte';
  import CrossRefDialog from '../../CrossRefDialog.svelte';
  import FormulaDialog from '../../FormulaDialog.svelte';
  import RubyDialog from '../../RubyDialog.svelte';
  import { captionClicks, anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import { OPEN_LINK_DIALOG_EVENT } from '../../../editor/extensions/link';
  import { OPEN_BOOKMARK_DIALOG_EVENT, bookmarkNames, findBookmark } from '../../../editor/extensions/bookmark';
  import { OPEN_CROSS_REF_DIALOG_EVENT } from '../../../editor/extensions/crossReference';
  import { EDIT_FORMULA_EVENT } from '../../../editor/extensions/formula';
  import { pageDimsCm, type PageFormat } from '../../../storage/pageFormat';
  import { cmToPx, type PageMargins } from '../../../storage/pageMargins';
  import type { Orientation } from '../../../storage/pageOrientation';
  import type { HfZone } from '../../../storage/headerFooter';
  import type { StyleFamily } from '../../../styles/styleSheet';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint } from '../../../editor/shortcuts';

  let {
    editor, tick, hfActive = null, pageMargins, pageOrientation, pageFormat,
    onEditZone, onManageTableStyles, onAutoText,
  }: {
    editor: Editor | null;
    tick: number;
    hfActive?: HfZone | null;
    pageMargins: PageMargins;
    pageOrientation: Orientation;
    pageFormat: PageFormat;
    onEditZone?: (zone: HfZone) => void;
    onManageTableStyles?: (family: StyleFamily) => void;
    onAutoText?: () => void;
  } = $props();

  let rubyOpen = $state(false);

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);
  let isLink = $derived(tick >= 0 && !!editor?.isActive('link'));
  let bmNames = $derived(tick >= 0 && editor && !hfActive ? bookmarkNames(editor.state.doc) : []);

  let tableOpen = $state(false);
  let charOpen = $state(false);
  let dateOpen = $state(false);

  // The page text box in px, so an inserted image never starts wider or taller
  // than one page (the same content-width math the export does).
  function contentBoxPx(): { maxW: number; maxH: number } {
    const { w, h } = pageDimsCm(pageFormat, pageOrientation);
    return {
      maxW: Math.round(cmToPx(w - pageMargins.left - pageMargins.right)),
      maxH: Math.round(cmToPx(h - pageMargins.top - pageMargins.bottom)),
    };
  }

  let imageInput = $state<HTMLInputElement | null>(null);

  function onImageFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so the same file can be picked again
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const probe = document.createElement('img');
      probe.onload = () => {
        let w = probe.naturalWidth || 1;
        let h = probe.naturalHeight || 1;
        const { maxW, maxH } = contentBoxPx();
        if (w > maxW) { h = (h * maxW) / w; w = maxW; }
        if (h > maxH) { w = (w * maxH) / h; h = maxH; }
        editor!.chain().focus().setImage({ src, alt: file.name, width: Math.round(w), height: Math.round(h) }).run();
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  }

  // --- Link ---
  let linkOpen = $state(false);
  let linkUrl = $state('');

  function openLink() {
    if (!editor || hfActive) return; // body-only; the HF schema has no link mark
    linkUrl = (editor.getAttributes('link').href as string) ?? '';
    linkOpen = true;
  }

  // A bare host or e-mail gets a scheme, as in Word and LibreOffice.
  function normalizeUrl(raw: string): string {
    const s = raw.trim();
    if (!s) return '';
    if (/^(https?:|mailto:|tel:|ftp:|#|\/)/i.test(s)) return s;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
    return `https://${s}`;
  }

  function applyLink(raw: string) {
    linkOpen = false;
    if (!editor) return;
    const href = normalizeUrl(raw);
    if (!href) return;
    const { empty } = editor.state.selection;
    // With nothing selected the URL becomes its own link text.
    if (empty) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  // --- Bookmarks and cross-references ---
  let bookmarkOpen = $state(false);
  let crossRefOpen = $state(false);

  function openBookmark() {
    if (!editor || hfActive || !hasSelection) return;
    crossRefOpen = false;
    bookmarkOpen = true;
  }

  function openCrossRef() {
    if (!editor || hfActive || !bmNames.length) return;
    bookmarkOpen = false;
    crossRefOpen = true;
  }

  function goToBookmark(name: string) {
    const found = editor && findBookmark(editor.state.doc, name);
    if (!editor || !found) return;
    bookmarkOpen = false;
    editor.chain().focus().setTextSelection({ from: found.from, to: found.to }).scrollIntoView().run();
  }

  // --- Formula ---
  let formulaOpen = $state(false);
  let formulaLatex = $state('');
  let formulaDisplay = $state(false);
  let formulaPos = $state<number | null>(null);

  function openFormula() {
    formulaPos = null;
    formulaLatex = '';
    formulaDisplay = false;
    formulaOpen = true;
  }

  function applyFormula(latex: string, display: boolean) {
    if (!editor) return;
    if (formulaPos != null) editor.chain().focus().updateFormula(formulaPos, { latex, display }).run();
    else editor.chain().focus().insertFormula({ latex, display }).run();
    formulaPos = null;
  }

  // Ctrl+K, the context menu and a double-click on a formula all arrive as events.
  $effect(() => {
    const onLink = () => openLink();
    const onBm = () => openBookmark();
    const onXr = () => openCrossRef();
    const onFormula = (e: Event) => {
      const d = (e as CustomEvent<{ pos: number; latex: string; display: boolean }>).detail;
      if (!d) return;
      formulaPos = d.pos;
      formulaLatex = d.latex;
      formulaDisplay = d.display;
      formulaOpen = true;
    };
    window.addEventListener(OPEN_LINK_DIALOG_EVENT, onLink);
    window.addEventListener(OPEN_BOOKMARK_DIALOG_EVENT, onBm);
    window.addEventListener(OPEN_CROSS_REF_DIALOG_EVENT, onXr);
    window.addEventListener(EDIT_FORMULA_EVENT, onFormula);
    return () => {
      window.removeEventListener(OPEN_LINK_DIALOG_EVENT, onLink);
      window.removeEventListener(OPEN_BOOKMARK_DIALOG_EVENT, onBm);
      window.removeEventListener(OPEN_CROSS_REF_DIALOG_EVENT, onXr);
      window.removeEventListener(EDIT_FORMULA_EVENT, onFormula);
    };
  });

  // A page field only means anything inside a zone, so open the footer first.
  function insertPageField(type: 'pageNumber' | 'pageCount') {
    closeMenu();
    if (!hfActive) return void onEditZone?.('footer');
    editor?.chain().focus().insertContent({ type }).run();
  }
</script>

<RibbonGroup label={t().ribbon.groups.pages}>
  <RibbonButton
    variant="big"
    icon="pageBreak"
    label={t().ribbon.pageBreak}
    title={`${t().ribbon.pageBreak} (${shortcutHint('pageBreak')})`}
    disabled={!editor || !!hfActive}
    onclick={() => editor?.chain().focus().insertPageBreak().run()}
  />
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.tables}>
  <div class="rb-captioned" use:captionClicks>
    <TablePicker
      {editor}
      bind:open={tableOpen}
      onInsert={(rows, cols, range) => editor?.chain().focus().setTextSelection(range).insertTable({ rows, cols, withHeaderRow: false }).run()}
      onManageStyles={() => onManageTableStyles?.('table')}
    />
    <span class="rb-caption">{t().ribbon.table}</span>
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.illustrations}>
  <RibbonButton variant="big" icon="image" label={t().ribbon.picture} title={t().toolbarExpanded.insertImage} disabled={!editor} onclick={() => imageInput?.click()} />
  <RibbonButton
    variant="big"
    icon="textBox"
    label={t().ribbon.textBox}
    title={hfActive ? t().toolbarExpanded.textBoxNotInHf : t().toolbarExpanded.insertTextBox}
    disabled={!editor || !!hfActive}
    onclick={() => editor?.chain().focus().insertTextBox().run()}
  />
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.links}>
  <div class="rb-col link-anchor">
    <RibbonButton variant="small" icon="link" label={t().ribbon.link} title={`${isLink ? t().link.dialogLabel : t().ribbon.link} (${shortcutHint('link')})`} disabled={!editor || !!hfActive} onclick={openLink} />
    <RibbonButton variant="small" icon="bookmark" label={t().ribbon.bookmark} title={hfActive ? t().toolbarExpanded.bookmarkNotInHf : hasSelection ? t().toolbarExpanded.insertBookmark : t().toolbarExpanded.bookmarkNeedsSelection} disabled={!editor || !!hfActive || !hasSelection} onclick={openBookmark} />
    <RibbonButton variant="small" icon="crossRef" label={t().ribbon.crossRef} title={hfActive ? t().toolbarExpanded.bookmarkNotInHf : bmNames.length ? t().toolbarExpanded.insertCrossRef : t().toolbarExpanded.crossRefNeedsBookmark} disabled={!editor || !!hfActive || !bmNames.length} onclick={openCrossRef} />
    <LinkDialog open={linkOpen} initialUrl={linkUrl} canRemove={isLink} onApply={applyLink} onRemove={() => { linkOpen = false; editor?.chain().focus().extendMarkRange('link').unsetLink().run(); }} onClose={() => (linkOpen = false)} />
    <BookmarkDialog open={bookmarkOpen} names={bmNames} onApply={(n) => { bookmarkOpen = false; editor?.chain().focus().setBookmark(n).run(); }} onRemove={(n) => editor?.chain().focus().removeBookmark(n).run()} onGoTo={goToBookmark} onClose={() => (bookmarkOpen = false)} />
    <CrossRefDialog open={crossRefOpen} names={bmNames} onInsert={(n, f) => { crossRefOpen = false; editor?.chain().focus().insertCrossRef({ name: n, format: f }).run(); }} onClose={() => (crossRefOpen = false)} />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.headerFooter}>
  <RibbonButton variant="big" icon="header" label={t().ribbon.header} title={t().toolbarExpanded.editHeader} disabled={!editor} onclick={() => onEditZone?.('header')} />
  <RibbonButton variant="big" icon="footer" label={t().ribbon.footer} title={t().toolbarExpanded.editFooter} disabled={!editor} onclick={() => onEditZone?.('footer')} />
  <div class="rb-menu-wrap" use:clickOutside={'pageField'}>
    <RibbonButton variant="big" icon="pageNumber" label={t().ribbon.pageNumber} title={t().ribbon.pageNumber} caret active={isMenuOpen('pageField')} onclick={() => toggleMenu('pageField')} />
    {#if isMenuOpen('pageField')}
      <div class="ribbon-menu" use:anchored role="menu">
        <button onclick={() => insertPageField('pageNumber')}>{t().hf.pageNumber}</button>
        <button onclick={() => insertPageField('pageCount')}>{t().hf.pageCount}</button>
      </div>
    {/if}
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.text}>
  <RibbonButton
    variant="big"
    icon="quickParts"
    label={t().autoText.title}
    title={t().autoText.title}
    disabled={!editor || !onAutoText}
    onclick={() => onAutoText?.()}
  />
  <RibbonButton
    variant="big"
    icon="ruby"
    label={t().ruby.title}
    title={t().ruby.title}
    disabled={!editor}
    onclick={() => (rubyOpen = true)}
  />
  <div class="rb-captioned" use:captionClicks>
    <DateTimePicker
      bind:open={dateOpen}
      {editor}
      onInsert={(opts, range) => editor?.chain().focus().setTextSelection(range).insertDateTimeField(opts).run()}
    />
    <span class="rb-caption">{t().ribbon.dateTime}</span>
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.symbols}>
  <div class="rb-captioned" use:captionClicks>
    <SpecialCharPicker
      bind:open={charOpen}
      {editor}
      onInsert={(char, range) => editor?.chain().focus().setTextSelection(range).insertContent(char).run()}
    />
    <span class="rb-caption">{t().ribbon.symbol}</span>
  </div>
  <RibbonButton variant="big" content={equationIcon} label={t().ribbon.equation} title={t().formula.insert} disabled={!editor} onclick={openFormula} />
</RibbonGroup>

<input
  bind:this={imageInput}
  type="file"
  accept="image/*"
  class="file-input"
  onchange={onImageFile}
/>

<RubyDialog bind:open={rubyOpen} {editor} />
<FormulaDialog bind:open={formulaOpen} initialLatex={formulaLatex} initialDisplay={formulaDisplay} onApply={applyFormula} />

<!-- Word's Equation button is a π, as its Symbol button beside it is an Ω. Same
     canvas, baseline and weight as that Ω; the size is 20 rather than its 14
     because π is lowercase, so at one size its x-height reads 1.44× smaller. -->
{#snippet equationIcon()}
  <svg width="28" height="28" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <text x="8" y="12.5" font-size="20" font-weight="700" font-family="var(--font-serif, serif)" fill="currentColor" text-anchor="middle">π</text>
  </svg>
{/snippet}

<style>
  .rb-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    height: 100%;
  }

  .link-anchor { position: relative; }

  .rb-menu-wrap { position: relative; }

  .file-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
</style>
