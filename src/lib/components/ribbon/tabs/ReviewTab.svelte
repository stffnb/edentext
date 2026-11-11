<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { Snippet } from 'svelte';
  import RibbonGroup from '../RibbonGroup.svelte';
  import RibbonButton from '../RibbonButton.svelte';
  import ReadGate from '../../ReadGate.svelte';
  import Icon from '../Icon.svelte';
  import LanguagePicker from '../../LanguagePicker.svelte';
  import GrammarToggle from '../../GrammarToggle.svelte';
  import { captionClicks, anchored, clickOutside, closeMenu, isMenuOpen, toggleMenu } from '../menu.svelte';
  import type { TextStats } from '../../../utils/wordCount';
  import type { DocumentLanguage } from '../../../storage/documentLanguage';
  import { OPEN_COMPARE_EVENT, OPEN_RECORD_LOCK_EVENT, recordChanges, recordLock } from '../../../storage/trackChanges.svelte';
  import { printMarkup, setPrintMarkup } from '../../../storage/printMarkup.svelte';
  import {
    MARKUP_MODES, MARKUP_PLACES, markupMode, setMarkupMode,
    showChanges, setShowChanges, showComments, setShowComments,
    commentPlace, setCommentPlace, changePlace, setChangePlace, showResolved, setShowResolved,
    type MarkupMode, type MarkupPlace,
  } from '../../../storage/markup.svelte';
  import { comments } from '../../../editor/extensions/comment';
  import { goToMarkup, hasRevisions, settleAll, settleHere, shownStats, toggleRecordChanges } from '../../reviewItems';
  import { OPEN_THESAURUS_EVENT } from '../../../spell/thesaurus';
  import { shortcutHint } from '../../../editor/shortcuts';
  import { t } from '../../../i18n/i18n.svelte';

  let { editor, tick, documentLanguage, documentLanguageOther, onLanguage, onAutoCorrect, onNewComment, onReviewSettings }: {
    editor: Editor | null;
    tick: number;
    documentLanguage: DocumentLanguage;
    documentLanguageOther: string | null;
    onLanguage: (code: DocumentLanguage) => void;
    onAutoCorrect?: () => void;
    onNewComment?: () => void;
    onReviewSettings?: () => void;
  } = $props();

  let hasSelection = $derived(tick >= 0 && !!editor && !editor.state.selection.empty);
  // Accepting a change stays possible even where the view hides it, as it is in Word.
  let anyRevisions = $derived(tick >= 0 && !!editor && hasRevisions(editor));
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

  function go(kind: 'comment' | 'revision', dir: 1 | -1): void {
    if (editor) goToMarkup(editor, kind, dir);
  }

  let stats = $derived.by<TextStats>(() => {
    if (tick < 0 || !editor) return { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
    const { doc } = editor.state;
    return shownStats(doc);
  });

  let selStats = $derived.by<TextStats | null>(() => {
    if (tick < 0 || !editor) return null;
    const { from, to, empty } = editor.state.selection;
    return empty ? null : shownStats(editor.state.doc, from, to);
  });

  const ROWS = (s: TextStats) => [
    { label: t().status.wordsLabel, value: s.words },
    { label: t().status.charsWithSpaces, value: s.charsWithSpaces },
    { label: t().status.charsNoSpaces, value: s.charsNoSpaces },
    { label: t().status.paragraphs, value: s.paragraphs },
  ];
</script>

<RibbonGroup label={t().ribbon.groups.proofing} reads>
  <ReadGate>
  <RibbonButton
    variant="big"
    icon="thesaurus"
    cmd="thesaurus"
    label={t().thesaurus.title}
    title={`${t().thesaurus.hint} — ${shortcutHint('thesaurus')}`}
    onclick={() => window.dispatchEvent(new CustomEvent(OPEN_THESAURUS_EVENT))}
  />
  </ReadGate>
  <div class="rb-menu-wrap" use:clickOutside={'wordCount'}>
    <RibbonButton
      variant="big"
      icon="wordCount"
      cmd="wordCount"
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
    cmd="autoCorrect"
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
                   at: MarkupPlace, setAt: (p: MarkupPlace) => void, more?: Snippet)}
  <div class="rb-menu-wrap" use:clickOutside={id}>
    <RibbonButton
      variant="big"
      icon="comment"
      cmd={id}
      {label}
      title={`${label} — ${PLACE_LABEL[at]()}`}
      caret
      caretPrimary
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
        {@render more?.()}
      </div>
    {/if}
  </div>
{/snippet}

<!-- The comment caret's switch for resolved comments, under where their cards go. -->
{#snippet resolvedItem()}
  <hr />
  <button role="menuitemcheckbox" aria-checked={showResolved()} title={t().settings.resolvedHint}
    onclick={() => { closeMenu(); setShowResolved(!showResolved()); if (!showComments()) setShowComments(true); }}>
    <span class="menu-check">{showResolved() ? '✓' : ''}</span>{t().comments.showResolved}
  </button>
{/snippet}

<RibbonGroup label={t().comments.title} reads>
  <ReadGate>
  <RibbonButton
    variant="big"
    icon="comment"
    cmd="newComment"
    label={t().comments.newComment}
    title={hasSelection ? t().comments.newComment : t().comments.needsSelection}
    disabled={!editor || !hasSelection}
    onclick={() => onNewComment?.()}
  />
  </ReadGate>
  {@render showKind('commentPlace', t().comments.showPane, showComments(),
    () => setShowComments(!showComments()), commentPlace(), setCommentPlace, resolvedItem)}
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="chevronLeft"
      cmd="prevComment"
      label={t().revisions.prev}
      disabled={!hasComments}
      onclick={() => go('comment', -1)}
    />
    <RibbonButton
      variant="small"
      icon="chevronRight"
      cmd="nextComment"
      label={t().revisions.next}
      disabled={!hasComments}
      onclick={() => go('comment', 1)}
    />
    <!-- Here, not at the tab's end: on a usual window that end lies past the ribbon's edge. -->
    <RibbonButton
      variant="small"
      icon="settings"
      cmd="reviewSettings"
      label={t().settings.title}
      title={`${t().settings.title}: ${t().settings.sections.review}`}
      onclick={() => onReviewSettings?.()}
    />
  </div>
</RibbonGroup>

<div class="ribbon-sep"></div>

<RibbonGroup label={t().ribbon.groups.revisions} reads>
  <ReadGate>
  <RibbonButton
    variant="big"
    icon="trackChanges"
    cmd="trackChanges"
    label={t().revisions.record}
    title={recordLock() ? t().revisions.recordLocked : `${t().revisions.recordHint} — ${shortcutHint('recordChanges')}`}
    active={recordChanges()}
    disabled={!!recordLock()}
    onclick={toggleRecordChanges}
  />
  </ReadGate>
  <div class="rb-menu-wrap" use:clickOutside={'markupDisplay'}>
    <RibbonButton
      variant="big"
      icon="trackChanges"
      cmd="markupDisplay"
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
  <ReadGate>
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="check"
      cmd="accept"
      label={t().revisions.accept}
      title={t().revisions.acceptHint}
      disabled={!anyRevisions}
      onclick={() => editor && settleHere(editor, true)}
    />
    <RibbonButton
      variant="small"
      icon="check"
      cmd="acceptAll"
      label={t().revisions.acceptAll}
      disabled={!anyRevisions}
      onclick={() => editor && settleAll(editor, true)}
    />
  </div>
  </ReadGate>
  <ReadGate>
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="close"
      cmd="reject"
      label={t().revisions.reject}
      title={t().revisions.rejectHint}
      disabled={!anyRevisions}
      onclick={() => editor && settleHere(editor, false)}
    />
    <RibbonButton
      variant="small"
      icon="close"
      cmd="rejectAll"
      label={t().revisions.rejectAll}
      disabled={!anyRevisions}
      onclick={() => editor && settleAll(editor, false)}
    />
  </div>
  </ReadGate>
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="chevronLeft"
      cmd="prevChange"
      label={t().revisions.prev}
      disabled={!anyRevisions}
      onclick={() => go('revision', -1)}
    />
    <RibbonButton
      variant="small"
      icon="chevronRight"
      cmd="nextChange"
      label={t().revisions.next}
      disabled={!anyRevisions}
      onclick={() => go('revision', 1)}
    />
  </div>
  <ReadGate>
  <div class="rb-col">
    <RibbonButton
      variant="small"
      icon="compare"
      cmd="compareDocument"
      label={t().revisions.compare}
      title={t().revisions.compareHint}
      disabled={!editor}
      onclick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPARE_EVENT, { detail: false }))}
    />
    <RibbonButton
      variant="small"
      icon="mergeDocument"
      cmd="mergeDocument"
      label={t().revisions.merge}
      title={t().revisions.mergeHint}
      disabled={!editor}
      onclick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPARE_EVENT, { detail: true }))}
    />
    <RibbonButton
      variant="small"
      icon="lock"
      cmd="protectChanges"
      label={t().revisions.protect}
      title={recordLock() ? t().revisions.protectOff : t().revisions.protect}
      active={!!recordLock()}
      onclick={() => window.dispatchEvent(new Event(OPEN_RECORD_LOCK_EVENT))}
    />
  </div>
  </ReadGate>
</RibbonGroup>

<div class="ribbon-sep"></div>

<!-- Both act on comments and changes alike, so they sit apart from the groups that
     each hold one of the two. -->
<RibbonGroup label={t().ribbon.groups.markup} reads>
  <!-- A checkbox, not a button: it settles what the next printout carries, it does not
       print. A pressed-looking button read as the command itself. -->
  <label class="rb-check" data-cmd="printMarkup" title={t().revisions.printMarkupHint}>
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
  <div class="rb-captioned" data-cmd="spellLanguage" use:captionClicks>
    <LanguagePicker value={documentLanguage} other={documentLanguageOther} onChange={onLanguage} {editor} {tick} />
    <span class="rb-caption">{t().spellPicker.label}</span>
  </div>
  <!-- Beside the captioned picker, not under it: a third row pushes the group's own
       label out of the band. -->
  <div class="gr-slot"><GrammarToggle value={documentLanguage} other={documentLanguageOther} {editor} {tick} /></div>
</RibbonGroup>

<style>
  .rb-menu-wrap { position: relative; }
  .stats-menu { min-width: 240px; }

  .rb-col { display: flex; flex-direction: column; gap: 2px; }

  .gr-slot { display: flex; align-self: center; }

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
