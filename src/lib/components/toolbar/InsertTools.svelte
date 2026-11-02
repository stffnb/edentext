<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import IslandButton from './IslandButton.svelte';
  import IslandMenu from './IslandMenu.svelte';
  import TablePicker from '../TablePicker.svelte';
  import SpecialCharPicker from '../SpecialCharPicker.svelte';
  import DateTimePicker from '../DateTimePicker.svelte';
  import RubyDialog from '../RubyDialog.svelte';
  import { closeMenu } from '../ribbon/menu.svelte';
  import { OPEN_LINK_DIALOG_EVENT } from '../../editor/extensions/link';
  import { OPEN_BOOKMARK_DIALOG_EVENT } from '../../editor/extensions/bookmark';
  import { OPEN_CROSS_REF_DIALOG_EVENT, hasRefTargets } from '../../editor/extensions/crossReference';
  import { EDIT_FORMULA_EVENT } from '../../editor/extensions/formula';
  import { pageDimsCm, type PageFormat } from '../../storage/pageFormat';
  import { cmToPx, type PageMargins } from '../../storage/pageMargins';
  import type { Orientation } from '../../storage/pageOrientation';
  import { clampHfDistance, DEFAULT_HF_DISTANCES, type HfDistances, type HfZone } from '../../storage/headerFooter';
  import { t } from '../../i18n/i18n.svelte';
  import { shortcutHint } from '../../editor/shortcuts';

  // The Insert category, as the ribbon's Insert tab.
  let {
    editor, tick, hfActive = null, pageMargins, pageOrientation, pageFormat,
    hfDistances = $bindable(DEFAULT_HF_DISTANCES),
    differentFirstPage = $bindable(false),
    differentOddEven = $bindable(false),
    onEditZone, onManageTableStyles, onAutoText, onTabsDialog,
  }: {
    editor: Editor | null;
    tick: number;
    hfActive?: HfZone | null;
    pageMargins: PageMargins;
    pageOrientation: Orientation;
    pageFormat: PageFormat;
    hfDistances?: HfDistances;
    differentFirstPage?: boolean;
    differentOddEven?: boolean;
    onEditZone?: (zone: HfZone) => void;
    onManageTableStyles?: () => void;
    onAutoText?: () => void;
    onTabsDialog?: () => void;
  } = $props();

  let rubyOpen = $state(false);
  let isLink = $derived(tick >= 0 && !!editor?.isActive('link'));
  let hasRefs = $derived(tick >= 0 && !!editor && hasRefTargets(editor.state.doc));

  // The page text box in px, so an inserted image never starts wider or taller than
  // one page (the same content-width math the export does).
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
    if (!file || !editor) return; // editor = activeEditor (body or the active zone)
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

  // The dialogs live in EventDialogs.svelte, which hears Ctrl+K and the context menu too.
  const open = (name: string) => () => window.dispatchEvent(new CustomEvent(name));

  // A page field only means anything inside a zone, so open the footer first.
  function insertPageField(type: 'pageNumber' | 'pageCount') {
    closeMenu();
    if (!hfActive) return void onEditZone?.('footer');
    editor?.chain().focus().insertContent({ type }).run();
  }
</script>

<div class="toolbar-group">
  <IslandButton icon="pageBreak" cmd="pageBreak" title={hfActive ? t().toolbarExpanded.breaksNotInHf : `${t().ribbon.pageBreak} (${shortcutHint('pageBreak')})`} disabled={!editor || !!hfActive} onclick={() => editor?.chain().focus().insertPageBreak().run()} />
  <span class="cmd" data-cmd="table"><TablePicker
    {editor}
    onOpen={closeMenu}
    onInsert={(rows, cols, range) => editor?.chain().focus().setTextSelection(range).insertTable({ rows, cols, withHeaderRow: false }).run()}
    onManageStyles={onManageTableStyles}
  /></span>
  <IslandButton icon="image" cmd="picture" title={t().toolbarExpanded.insertImage} disabled={!editor} onclick={() => imageInput?.click()} />
  <IslandButton icon="textBox" cmd="textBox" title={t().toolbarExpanded.insertTextBox} disabled={!editor} onclick={() => editor?.chain().focus().insertTextBox().run()} />
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="link" cmd="link" title={`${isLink ? t().link.dialogLabel : t().toolbarExpanded.insertLink} (${shortcutHint('link')})`} active={isLink} disabled={!editor} onclick={open(OPEN_LINK_DIALOG_EVENT)} />
  <IslandButton icon="bookmark" cmd="bookmark" title={hfActive ? t().toolbarExpanded.bookmarkNotInHf : t().toolbarExpanded.insertBookmark} disabled={!editor || !!hfActive} onclick={open(OPEN_BOOKMARK_DIALOG_EVENT)} />
  <IslandButton icon="crossRef" cmd="crossRef" title={hasRefs ? t().toolbarExpanded.insertCrossRef : t().crossRef.none} disabled={!editor || !hasRefs} onclick={open(OPEN_CROSS_REF_DIALOG_EVENT)} />
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="header" cmd="header" title={t().toolbarExpanded.editHeader} active={hfActive === 'header'} disabled={!editor} onclick={() => onEditZone?.('header')} />
  <IslandButton icon="footer" cmd="footer" title={t().toolbarExpanded.editFooter} active={hfActive === 'footer'} disabled={!editor} onclick={() => onEditZone?.('footer')} />
  <IslandMenu id="pageField" icon="pageNumber" cmd="pageNumber" title={t().ribbon.pageNumber} disabled={!editor}>
    <button onclick={() => insertPageField('pageNumber')}>{t().hf.pageNumber}</button>
    <button onclick={() => insertPageField('pageCount')}>{t().hf.pageCount}</button>
  </IslandMenu>
  <IslandMenu id="hfOptions" icon="settings" cmd="hfOptions" title={t().toolbarExpanded.headerFooter} minWidth={220}>
    <label class="im-row" data-cmd="differentFirstPage" title={t().toolbarExpanded.differentFirstPageHint}>
      <input type="checkbox" bind:checked={differentFirstPage} />
      {t().toolbarExpanded.differentFirstPage}
    </label>
    <label class="im-row" data-cmd="differentOddEven" title={t().toolbarExpanded.differentOddEvenHint}>
      <input type="checkbox" bind:checked={differentOddEven} />
      {t().toolbarExpanded.differentOddEven}
    </label>
    <div class="im-label">{t().toolbarExpanded.position}</div>
    <div class="im-grid">
      {#each ['header', 'footer'] as const as axis}
        <label class="im-field">
          <span>{t().toolbarExpanded.hfDist[axis]}</span>
          <input
            type="number"
            min="0"
            max="10"
            step="0.1"
            value={hfDistances[axis]}
            onchange={(e) => (hfDistances = { ...hfDistances, [axis]: clampHfDistance(Number(e.currentTarget.value)) })}
          />
        </label>
      {/each}
    </div>
    <hr />
    <button data-cmd="hfTabs" onclick={() => { closeMenu(); onTabsDialog?.(); }}>{t().paragraphDialog.tabsButton}</button>
  </IslandMenu>
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <IslandButton icon="quickParts" cmd="autoText" title={t().autoText.title} disabled={!editor || !onAutoText} onclick={() => onAutoText?.()} />
  <IslandButton icon="ruby" cmd="ruby" title={t().ruby.title} disabled={!editor} onclick={() => (rubyOpen = true)} />
  <span class="cmd" data-cmd="dateTime"><DateTimePicker
    {editor}
    onOpen={closeMenu}
    onInsert={(opts, range) => editor?.chain().focus().setTextSelection(range).insertDateTimeField(opts).run()}
  /></span>
  <span class="cmd" data-cmd="symbol"><SpecialCharPicker
    {editor}
    onOpen={closeMenu}
    onInsert={(char, range) => editor?.chain().focus().setTextSelection(range).insertContent(char).run()}
  /></span>
  <IslandButton content={equationIcon} cmd="equation" title={t().formula.insert} disabled={!editor} onclick={open(EDIT_FORMULA_EVENT)} />
</div>

<!-- No .file-input class: App's document input carries it, and a bare class selector
     must keep finding that one. -->
<input bind:this={imageInput} type="file" accept="image/*" style="display: none" onchange={onImageFile} />

<RubyDialog bind:open={rubyOpen} {editor} />

{#snippet equationIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3h7M4 3l4 5-4 5M4 13h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
{/snippet}
