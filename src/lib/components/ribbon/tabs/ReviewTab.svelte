<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import LanguagePicker from '../../LanguagePicker.svelte';
  import { captionClicks, anchored, clickOutside, isMenuOpen, toggleMenu } from '../menu.svelte';
  import { countText, type TextStats } from '../../../utils/wordCount';
  import type { DocumentLanguage } from '../../../storage/documentLanguage';
  import { recordChanges, setRecordChanges } from '../../../storage/trackChanges.svelte';
  import { revisions } from '../../../editor/extensions/trackChanges';
  import { OPEN_THESAURUS_EVENT } from '../../../spell/thesaurus';
  import { shortcutHint } from '../../../editor/shortcuts';
  import { t } from '../../../i18n/i18n.svelte';

  let { editor, tick, documentLanguage, onLanguage, onAutoCorrect, onNewComment, commentsOpen = false, onToggleComments, revisionsOpen = false, onToggleRevisions }: {
    editor: Editor | null;
    tick: number;
    documentLanguage: DocumentLanguage;
    onLanguage: (code: DocumentLanguage) => void;
    onAutoCorrect?: () => void;
    onNewComment?: () => void;
    commentsOpen?: boolean;
    onToggleComments?: () => void;
    revisionsOpen?: boolean;
    onToggleRevisions?: () => void;
  } = $props();

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);
  let hasRevisions = $derived(tick >= 0 && !!editor && revisions(editor.state.doc).length > 0);

  let stats = $derived.by<TextStats>(() => {
    if (tick < 0 || !editor) return { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
    const { doc } = editor.state;
    return countText(doc, 0, doc.content.size);
  });

  let selStats = $derived.by<TextStats | null>(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    return empty ? null : countText(editor.state.doc, from, to);
  });

  const ROWS = (s: TextStats) => [
    { label: t().status.wordsLabel, value: s.words },
    { label: t().status.charsWithSpaces, value: s.charsWithSpaces },
    { label: t().status.charsNoSpaces, value: s.charsNoSpaces },
    { label: t().status.paragraphs, value: s.paragraphs },
  ];
</script>

<RibbonGroup label={t().ribbon.groups.proofing}>
  <RibbonButton
    variant="big"
    icon="thesaurus"
    label={t().thesaurus.title}
    title={`${t().thesaurus.hint} — ${shortcutHint('thesaurus')}`}
    onclick={() => window.dispatchEvent(new CustomEvent(OPEN_THESAURUS_EVENT))}
  />
  <div class="rb-menu-wrap" use:clickOutside={'wordCount'}>
    <RibbonButton
      variant="big"
      icon="wordCount"
      label={t().status.statistics}
      title={t().status.statistics}
      active={isMenuOpen('wordCount')}
      onclick={() => toggleMenu('wordCount')}
    />
    {#if isMenuOpen('wordCount')}
      <div class="ribbon-menu stats-menu" use:anchored role="menu">
        {#if selStats}
          <div class="rb-menu-label">{t().status.selection}</div>
          {#each ROWS(selStats) as r}
            <div class="stat"><span>{r.label}</span><b>{t().status.num(r.value)}</b></div>
          {/each}
        {/if}
        <div class="rb-menu-label">{t().status.document}</div>
        {#each ROWS(stats) as r}
          <div class="stat"><span>{r.label}</span><b>{t().status.num(r.value)}</b></div>
        {/each}
      </div>
    {/if}
  </div>
  <RibbonButton
    variant="big"
    icon="autoCorrect"
    label={t().ribbon.autoCorrect}
    title={t().autoCorrect.title}
    disabled={!onAutoCorrect}
    onclick={() => onAutoCorrect?.()}
  />
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().comments.title}>
  <RibbonButton
    variant="big"
    icon="comment"
    label={t().comments.newComment}
    title={hasSelection ? t().comments.newComment : t().comments.needsSelection}
    disabled={!editor || !hasSelection}
    onclick={() => onNewComment?.()}
  />
  <RibbonButton
    variant="small"
    icon="comment"
    label={t().comments.title}
    title={t().comments.showPane}
    active={commentsOpen}
    onclick={() => onToggleComments?.()}
  />
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.revisions}>
  <RibbonButton
    variant="big"
    icon="trackChanges"
    label={t().revisions.record}
    title={t().revisions.recordHint}
    active={recordChanges()}
    onclick={() => setRecordChanges(!recordChanges())}
  />
  <RibbonButton
    variant="big"
    icon="comment"
    label={t().revisions.pane}
    title={t().revisions.showPane}
    active={revisionsOpen}
    onclick={() => onToggleRevisions?.()}
  />
  <!-- The one at the cursor over the whole document, so the pair reads as one column. -->
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="check"
      label={t().revisions.accept}
      title={t().revisions.acceptHint}
      disabled={!hasRevisions}
      onclick={() => editor?.chain().focus().acceptRevisions().run()}
    />
    <RibbonButton
      variant="small"
      icon="check"
      label={t().revisions.acceptAll}
      disabled={!hasRevisions}
      onclick={() => editor?.chain().focus().acceptRevisions(true).run()}
    />
  </div>
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="close"
      label={t().revisions.reject}
      title={t().revisions.rejectHint}
      disabled={!hasRevisions}
      onclick={() => editor?.chain().focus().rejectRevisions().run()}
    />
    <RibbonButton
      variant="small"
      icon="close"
      label={t().revisions.rejectAll}
      disabled={!hasRevisions}
      onclick={() => editor?.chain().focus().rejectRevisions(true).run()}
    />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.language}>
  <div class="rb-captioned" use:captionClicks>
    <LanguagePicker value={documentLanguage} onChange={onLanguage} />
    <span class="rb-caption">{t().spellPicker.label}</span>
  </div>
</RibbonGroup>

<style>
  .rb-menu-wrap { position: relative; }
  .stats-menu { min-width: 240px; }

  .rb-col { display: flex; flex-direction: column; gap: 2px; }
  .rb-col :global(.rb-small) { width: 100%; }

  .stat {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 3px 12px;
    font-family: var(--w-font);
    font-size: 12px;
    color: var(--w-text-dim);
  }

  .stat b { color: var(--w-text); }

</style>
