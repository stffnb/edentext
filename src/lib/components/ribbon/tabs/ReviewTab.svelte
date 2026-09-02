<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import Icon from '../Icon.svelte';
  import LanguagePicker from '../../LanguagePicker.svelte';
  import { captionClicks, anchored, clickOutside, closeMenu, isMenuOpen, toggleMenu } from '../menu.svelte';
  import { countText, type TextStats } from '../../../utils/wordCount';
  import type { DocumentLanguage } from '../../../storage/documentLanguage';
  import { recordChanges, setRecordChanges } from '../../../storage/trackChanges.svelte';
  import { printMarkup, setPrintMarkup } from '../../../storage/printMarkup.svelte';
  import {
    MARKUP_MODES, MARKUP_PLACES, markupMode, setMarkupMode,
    showChanges, setShowChanges, showComments, setShowComments,
    commentPlace, setCommentPlace, changePlace, setChangePlace,
    type MarkupMode, type MarkupPlace,
  } from '../../../storage/markup.svelte';
  import { revisions } from '../../../editor/extensions/trackChanges';
  import { comments } from '../../../editor/extensions/comment';
  import { selectRange, step, visibleComments, visibleRevisions } from '../../reviewItems';
  import { OPEN_THESAURUS_EVENT } from '../../../spell/thesaurus';
  import { shortcutHint } from '../../../editor/shortcuts';
  import { t } from '../../../i18n/i18n.svelte';

  let { editor, tick, documentLanguage, onLanguage, onAutoCorrect, onNewComment }: {
    editor: Editor | null;
    tick: number;
    documentLanguage: DocumentLanguage;
    onLanguage: (code: DocumentLanguage) => void;
    onAutoCorrect?: () => void;
    onNewComment?: () => void;
  } = $props();

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);
  // Accepting a change stays possible even where the view hides it, as it is in Word.
  let hasRevisions = $derived(tick >= 0 && !!editor && revisions(editor.state.doc).length > 0);
  let hasComments = $derived(tick >= 0 && !!editor && comments(editor.state.doc).length > 0);

  const PLACE_LABEL: Record<MarkupPlace, () => string> = {
    balloons: () => t().revisions.placeBalloons,
    pane: () => t().revisions.placePane,
  };

  const MODE_LABEL: Record<MarkupMode, () => { label: string; hint: string }> = {
    all: () => ({ label: t().revisions.displayAll, hint: t().revisions.displayAllHint }),
    simple: () => ({ label: t().revisions.displaySimple, hint: t().revisions.displaySimpleHint }),
    none: () => ({ label: t().revisions.displayNone, hint: t().revisions.displayNoneHint }),
    original: () => ({ label: t().revisions.displayOriginal, hint: t().revisions.displayOriginalHint }),
  };

  // Only what the view shows is walked: a hidden change is not a place to jump to.
  function go(kind: 'comment' | 'revision', dir: 1 | -1): void {
    if (!editor) return;
    const doc = editor.state.doc;
    const list: { from: number; to: number }[] =
      kind === 'comment' ? visibleComments(doc) : visibleRevisions(doc);
    const hit = step(list, editor.state.selection.from, dir);
    if (hit) selectRange(editor, hit.from, hit.to);
  }

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

<!-- One button per kind: the click shows or hides it, the caret says where its cards go.
     What Word splits over Show markup, the balloon modes and the reviewing pane. -->
{#snippet showKind(id: string, label: string, on: boolean, toggle: () => void,
                   at: MarkupPlace, setAt: (p: MarkupPlace) => void)}
  <div class="rb-menu-wrap" use:clickOutside={id}>
    <RibbonButton
      variant="big"
      icon="comment"
      {label}
      title={`${label} — ${PLACE_LABEL[at]()}`}
      caret
      active={on}
      caretActive={isMenuOpen(id)}
      onclick={toggle}
      onCaret={() => toggleMenu(id)}
    />
    {#if isMenuOpen(id)}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each MARKUP_PLACES as p}
          <button class:selected={at === p} onclick={() => { closeMenu(); setAt(p); if (!on) toggle(); }}>
            {PLACE_LABEL[p]()}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<RibbonGroup label={t().comments.title}>
  <RibbonButton
    variant="big"
    icon="comment"
    label={t().comments.newComment}
    title={hasSelection ? t().comments.newComment : t().comments.needsSelection}
    disabled={!editor || !hasSelection}
    onclick={() => onNewComment?.()}
  />
  {@render showKind('commentPlace', t().comments.showPane, showComments(),
    () => setShowComments(!showComments()), commentPlace(), setCommentPlace)}
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="chevronLeft"
      label={t().revisions.prev}
      disabled={!hasComments}
      onclick={() => go('comment', -1)}
    />
    <RibbonButton
      variant="small"
      icon="chevronRight"
      label={t().revisions.next}
      disabled={!hasComments}
      onclick={() => go('comment', 1)}
    />
  </div>
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
  <div class="rb-menu-wrap" use:clickOutside={'markupDisplay'}>
    <RibbonButton
      variant="big"
      icon="trackChanges"
      label={t().revisions.display}
      title={MODE_LABEL[markupMode()]().label}
      caret
      active={isMenuOpen('markupDisplay')}
      onclick={() => toggleMenu('markupDisplay')}
    />
    {#if isMenuOpen('markupDisplay')}
      <div class="ribbon-menu" use:anchored role="menu">
        {#each MARKUP_MODES as m}
          <button class:selected={markupMode() === m} onclick={() => { closeMenu(); setMarkupMode(m); }}>
            {MODE_LABEL[m]().label}<span class="menu-sub">{MODE_LABEL[m]().hint}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
  {@render showKind('changePlace', t().revisions.showPane, showChanges(),
    () => setShowChanges(!showChanges()), changePlace(), setChangePlace)}
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
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="chevronLeft"
      label={t().revisions.prev}
      disabled={!hasRevisions}
      onclick={() => go('revision', -1)}
    />
    <RibbonButton
      variant="small"
      icon="chevronRight"
      label={t().revisions.next}
      disabled={!hasRevisions}
      onclick={() => go('revision', 1)}
    />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<!-- Both act on comments and changes alike, so they sit apart from the groups that
     each hold one of the two. -->
<RibbonGroup label={t().ribbon.groups.markup}>
  <!-- A checkbox, not a button: it settles what the next printout carries, it does not
       print. A pressed-looking button read as the command itself. -->
  <label class="rb-check" title={t().revisions.printMarkupHint}>
    <input
      type="checkbox"
      checked={printMarkup()}
      onchange={(e) => setPrintMarkup(e.currentTarget.checked)}
    />
    {t().revisions.printMarkup}
  </label>
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

  .rb-check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px;
    font-family: var(--w-font);
    font-size: 12px;
    color: var(--w-text);
    white-space: nowrap;
    cursor: pointer;
  }
  .rb-check input { accent-color: var(--w-accent); cursor: pointer; }
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
