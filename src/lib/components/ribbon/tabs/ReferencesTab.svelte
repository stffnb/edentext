<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import CaptionDialog from '../../CaptionDialog.svelte';
  import BibliographyDialog from '../../BibliographyDialog.svelte';
  import type { IndexKind } from '../../../editor/extensions/tableOfContents';
  import { anchored, clickOutside, isMenuOpen, toggleMenu, closeMenu } from '../menu.svelte';
  import type { HfZone } from '../../../storage/headerFooter';
  import { t } from '../../../i18n/i18n.svelte';
  import { shortcutHint } from '../../../editor/shortcuts';
  import { HEADING_LEVELS } from '../../../export/odt';
  import { CITATION_STYLES, isCitationStyle, type CitationStyle } from '../../../utils/citationStyle';

  let { editor, tick, hfActive = null, onNoteOptions }: {
    editor: Editor | null;
    tick: number;
    hfActive?: HfZone | null;
    onNoteOptions?: () => void;
  } = $props();

  // The levels button drives a table of contents only — a caption index has one level.
  // The document holds at most one, so the first hit is it.
  let toc = $derived.by<{ pos: number; maxLevel: number } | null>(() => {
    if (tick < 0 || !editor) return null;
    let found: { pos: number; maxLevel: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'tableOfContents' || node.attrs.index !== 'toc') return;
      found = { pos, maxLevel: (node.attrs.maxLevel ?? 5) as number };
    });
    return found;
  });
  const LEVELS = HEADING_LEVELS;
  const INDEX_KINDS: IndexKind[] = ['toc', 'figures', 'tables', 'alphabetical', 'bibliography'];
  let captionOpen = $state(false);
  let citationOpen = $state(false);
  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);

  // The selected text is the term unless the reader gives another — the same prompt
  // both word processors open, which fills itself from the selection.
  function markIndexEntry() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const term = prompt(t().ribbon.indexEntryPrompt, editor.state.doc.textBetween(from, to, ' '));
    if (term?.trim()) editor.chain().focus().setTextSelection(to).insertIndexEntry(term).run();
  }

  function setMaxLevel(level: number) {
    closeMenu();
    if (!editor || !toc) return;
    editor.chain().focus().setNodeSelection(toc.pos).updateAttributes('tableOfContents', { maxLevel: level }).run();
  }

  // The document's bibliography, whose attrs hold the citation style — both formats keep
  // it there too, so a document without one cites by key and the button stays disabled.
  let bibliography = $derived.by<{ pos: number; style: CitationStyle } | null>(() => {
    if (tick < 0 || !editor) return null;
    let found: { pos: number; style: CitationStyle } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found || node.type.name !== 'tableOfContents' || node.attrs.index !== 'bibliography') return;
      found = { pos, style: isCitationStyle(node.attrs.citationStyle) ? node.attrs.citationStyle : 'key' };
    });
    return found;
  });

  function setCitationStyle(style: CitationStyle) {
    closeMenu();
    if (!editor || !bibliography) return;
    editor.chain().focus().setNodeSelection(bibliography.pos)
      .updateAttributes('tableOfContents', { citationStyle: style }).run();
  }
</script>

<RibbonGroup label={t().ribbon.groups.toc}>
  <div class="rb-menu-wrap" use:clickOutside={'indexKind'}>
    <RibbonButton
      variant="big"
      icon="toc"
      label={t().ribbon.toc}
      title={hfActive ? t().toolbarExpanded.tocNotInHf : t().toolbarExpanded.insertToc}
      disabled={!editor || !!hfActive}
      caret
      active={isMenuOpen('indexKind')}
      onclick={() => toggleMenu('indexKind')}
    />
    {#if isMenuOpen('indexKind')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each INDEX_KINDS as k}
          <button onclick={() => { closeMenu(); editor?.chain().focus().setTableOfContents(k).run(); }}>
            {t().ribbon.indexes[k]}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="rb-menu-wrap" use:clickOutside={'tocLevels'}>
    <RibbonButton
      variant="big"
      icon="tocLevels"
      label={t().ribbon.tocOptions}
      title={t().ribbon.tocOptions}
      disabled={!toc}
      caret
      active={isMenuOpen('tocLevels')}
      onclick={() => toggleMenu('tocLevels')}
    />
    {#if isMenuOpen('tocLevels')}
      <div class="ribbon-menu" use:anchored role="menu">
        <div class="rb-menu-label">{t().ribbon.tocMaxLevel}</div>
        {#each LEVELS as l}
          <button class:selected={toc?.maxLevel === l} onclick={() => setMaxLevel(l)}>{l}</button>
        {/each}
      </div>
    {/if}
  </div>
  <RibbonButton
    variant="big"
    icon="caption"
    label={t().ribbon.insertCaption}
    title={t().caption.title}
    disabled={!editor || !!hfActive}
    onclick={() => (captionOpen = true)}
  />
  <RibbonButton
    variant="big"
    icon="bookmark"
    label={t().ribbon.indexEntry}
    title={hasSelection ? t().ribbon.indexEntry : t().ribbon.indexEntryNeedsSelection}
    disabled={!editor || !!hfActive || !hasSelection}
    onclick={markIndexEntry}
  />
  <RibbonButton
    variant="big"
    icon="citation"
    label={t().ribbon.citation}
    title={t().bibliography.title}
    disabled={!editor || !!hfActive}
    onclick={() => (citationOpen = true)}
  />
  <div class="rb-menu-wrap" use:clickOutside={'citeStyle'}>
    <RibbonButton
      variant="small"
      icon="citation"
      label={t().bibliography.style}
      title={bibliography ? t().bibliography.style : t().bibliography.styleNeedsIndex}
      caret
      disabled={!editor || !bibliography}
      active={isMenuOpen('citeStyle')}
      onclick={() => toggleMenu('citeStyle')}
    />
    {#if isMenuOpen('citeStyle')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each CITATION_STYLES as cs}
          <button class:selected={bibliography?.style === cs} onclick={() => setCitationStyle(cs)}>
            {t().bibliography.styles[cs]}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</RibbonGroup>

<CaptionDialog bind:open={captionOpen} {editor} />
<BibliographyDialog bind:open={citationOpen} {editor} />

<!-- The options ride the group's ↘ launcher as they do in both word processors, and a
     named button as well: the corner arrow alone is easy to miss. -->
<RibbonGroup label={t().ribbon.groups.notes} onLauncher={onNoteOptions} launcherTitle={t().notesDialog.title}>
  <RibbonButton
    variant="big"
    icon="footnote"
    label={t().toolbarExpanded.insertFootnote}
    title={hfActive ? t().toolbarExpanded.noteNotInHf : `${t().toolbarExpanded.insertFootnote} (${shortcutHint('footnote')})`}
    disabled={!editor || !!hfActive}
    onclick={() => editor?.chain().focus().insertNote('footnote').run()}
  />
  <RibbonButton
    variant="big"
    icon="endnote"
    label={t().toolbarExpanded.insertEndnote}
    title={hfActive ? t().toolbarExpanded.noteNotInHf : `${t().toolbarExpanded.insertEndnote} (${shortcutHint('endnote')})`}
    disabled={!editor || !!hfActive}
    onclick={() => editor?.chain().focus().insertNote('endnote').run()}
  />
  <RibbonButton
    variant="big"
    icon="settings"
    label={t().ribbon.noteOptions}
    title={t().notesDialog.title}
    disabled={!onNoteOptions}
    onclick={() => onNoteOptions?.()}
  />
</RibbonGroup>

<style>
  .rb-menu-wrap { position: relative; }
</style>
