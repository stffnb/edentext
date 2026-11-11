<script lang="ts">
  import ReadGate from '../ReadGate.svelte';
  import type { Editor } from '@tiptap/core';
  import IslandButton from './IslandButton.svelte';
  import IslandMenu from './IslandMenu.svelte';
  import LanguagePicker from '../LanguagePicker.svelte';
  import GrammarToggle from '../GrammarToggle.svelte';
  import { closeMenu } from '../ribbon/menu.svelte';
  import { goToMarkup, hasRevisions, settleAll, settleHere, shownStats, toggleRecordChanges } from '../reviewItems';
  import type { TextStats } from '../../utils/wordCount';
  import type { DocumentLanguage } from '../../storage/documentLanguage';
  import { OPEN_COMPARE_EVENT, OPEN_RECORD_LOCK_EVENT, recordChanges, recordLock } from '../../storage/trackChanges.svelte';
  import { printMarkup, setPrintMarkup } from '../../storage/printMarkup.svelte';
  import {
    MARKUP_MODES, MARKUP_PLACES, markupMode, setMarkupMode,
    showChanges, setShowChanges, showComments, setShowComments,
    commentPlace, setCommentPlace, changePlace, setChangePlace, showResolved, setShowResolved,
    type MarkupMode, type MarkupPlace,
  } from '../../storage/markup.svelte';
  import { comments } from '../../editor/extensions/comment';
  import { OPEN_THESAURUS_EVENT } from '../../spell/thesaurus';
  import { shortcutHint } from '../../editor/shortcuts';
  import { t } from '../../i18n/i18n.svelte';

  // The Review category, as the ribbon's Review tab.
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

  const go = (kind: 'comment' | 'revision', dir: 1 | -1) => editor && goToMarkup(editor, kind, dir);

  let stats = $derived.by<TextStats>(() => {
    if (tick < 0 || !editor) return { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
    return shownStats(editor.state.doc);
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

<!-- One split per kind: the click shows or hides it, the chevron says where its cards go. -->
{#snippet showKind(id: string, label: string, on: boolean, toggle: () => void, at: MarkupPlace, setAt: (p: MarkupPlace) => void, resolved: boolean)}
  <IslandMenu {id} icon="comment" cmd={id} title={`${label} — ${PLACE_LABEL[at]()}`} active={on} onclick={toggle}>
    {#each MARKUP_PLACES as p}
      <button class:selected={at === p} onclick={() => { closeMenu(); setAt(p); if (!on) toggle(); }}>{PLACE_LABEL[p]()}</button>
    {/each}
    {#if resolved}
      <hr />
      <button role="menuitemcheckbox" aria-checked={showResolved()} title={t().settings.resolvedHint}
        onclick={() => { closeMenu(); setShowResolved(!showResolved()); if (!showComments()) setShowComments(true); }}>
        <span class="menu-check">{showResolved() ? '✓' : ''}</span>{t().comments.showResolved}
      </button>
    {/if}
  </IslandMenu>
{/snippet}

<div class="toolbar-group">
  <ReadGate>
  <IslandButton icon="thesaurus" cmd="thesaurus" title={`${t().thesaurus.hint} — ${shortcutHint('thesaurus')}`} onclick={() => window.dispatchEvent(new CustomEvent(OPEN_THESAURUS_EVENT))} />
  </ReadGate>
  <IslandMenu id="wordCount" icon="wordCount" cmd="wordCount" title={t().status.statistics} minWidth={240}>
    {#if selStats}
      <div class="im-label">{t().status.selection}</div>
      {#each ROWS(selStats) as r}
        <div class="stat"><span>{r.label}</span><b>{t().status.num(r.value)}</b></div>
      {/each}
    {/if}
    <div class="im-label">{t().status.document}</div>
    {#each ROWS(stats) as r}
      <div class="stat"><span>{r.label}</span><b>{t().status.num(r.value)}</b></div>
    {/each}
  </IslandMenu>
  <IslandButton icon="autoCorrect" cmd="autoCorrect" title={t().autoCorrect.title} disabled={!onAutoCorrect} onclick={() => onAutoCorrect?.()} />
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <ReadGate>
  <IslandButton content={newCommentIcon} cmd="newComment" title={hasSelection ? t().comments.newComment : t().comments.needsSelection} disabled={!editor || !hasSelection} onclick={() => onNewComment?.()} />
  </ReadGate>
  {@render showKind('commentPlace', t().comments.showPane, showComments(), () => setShowComments(!showComments()), commentPlace(), setCommentPlace, true)}
  <IslandButton icon="chevronLeft" cmd="prevComment" title={`${t().comments.title}: ${t().revisions.prev}`} disabled={!hasComments} onclick={() => go('comment', -1)} />
  <IslandButton icon="chevronRight" cmd="nextComment" title={`${t().comments.title}: ${t().revisions.next}`} disabled={!hasComments} onclick={() => go('comment', 1)} />
  <IslandButton icon="settings" cmd="reviewSettings" title={`${t().settings.title}: ${t().settings.sections.review}`} onclick={() => onReviewSettings?.()} />
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <ReadGate>
  <IslandButton icon="trackChanges" cmd="trackChanges" title={recordLock() ? t().revisions.recordLocked : `${t().revisions.recordHint} — ${shortcutHint('recordChanges')}`} active={recordChanges()} disabled={!!recordLock()} onclick={toggleRecordChanges} />
  </ReadGate>
  <ReadGate>
  <IslandButton icon="lock" cmd="protectChanges" title={recordLock() ? t().revisions.protectOff : t().revisions.protect} active={!!recordLock()} onclick={() => window.dispatchEvent(new Event(OPEN_RECORD_LOCK_EVENT))} />
  </ReadGate>
  <IslandMenu id="markupDisplay" label={MODE_LABEL[markupMode()]().label} cmd="markupDisplay" title={t().revisions.display}>
    {#each MARKUP_MODES as m}
      <button class:selected={markupMode() === m} onclick={() => { closeMenu(); setMarkupMode(m); }}>
        {MODE_LABEL[m]().label}<span class="menu-sub">{MODE_LABEL[m]().hint}</span>
      </button>
    {/each}
  </IslandMenu>
  {@render showKind('changePlace', t().revisions.showPane, showChanges(), () => setShowChanges(!showChanges()), changePlace(), setChangePlace, false)}
  <ReadGate>
  <IslandMenu id="accept" icon="check" cmd="accept" caretCmd="acceptMenu" title={t().revisions.acceptHint} disabled={!anyRevisions} onclick={() => editor && settleHere(editor, true)}>
    <button onclick={() => { closeMenu(); editor && settleHere(editor, true); }}>{t().revisions.accept}</button>
    <button data-cmd="acceptAll" onclick={() => { closeMenu(); editor && settleAll(editor, true); }}>{t().revisions.acceptAll}</button>
  </IslandMenu>
  </ReadGate>
  <ReadGate>
  <IslandMenu id="reject" icon="close" cmd="reject" caretCmd="rejectMenu" title={t().revisions.rejectHint} disabled={!anyRevisions} onclick={() => editor && settleHere(editor, false)}>
    <button onclick={() => { closeMenu(); editor && settleHere(editor, false); }}>{t().revisions.reject}</button>
    <button data-cmd="rejectAll" onclick={() => { closeMenu(); editor && settleAll(editor, false); }}>{t().revisions.rejectAll}</button>
  </IslandMenu>
  </ReadGate>
  <IslandButton icon="chevronLeft" cmd="prevChange" title={`${t().ribbon.groups.revisions}: ${t().revisions.prev}`} disabled={!anyRevisions} onclick={() => go('revision', -1)} />
  <IslandButton icon="chevronRight" cmd="nextChange" title={`${t().ribbon.groups.revisions}: ${t().revisions.next}`} disabled={!anyRevisions} onclick={() => go('revision', 1)} />
  <ReadGate>
  <IslandButton icon="compare" cmd="compareDocument" title={t().revisions.compareHint} disabled={!editor} onclick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPARE_EVENT, { detail: false }))} />
  </ReadGate>
  <ReadGate>
  <IslandButton icon="mergeDocument" cmd="mergeDocument" title={t().revisions.mergeHint} disabled={!editor} onclick={() => window.dispatchEvent(new CustomEvent(OPEN_COMPARE_EVENT, { detail: true }))} />
  </ReadGate>
  <!-- A checkbox, not a button: it settles what the next printout carries, it does not print. -->
  <label class="check" data-cmd="printMarkup" title={t().revisions.printMarkupHint}>
    <input type="checkbox" checked={printMarkup()} onchange={(e) => setPrintMarkup(e.currentTarget.checked)} />
    {t().revisions.printMarkup}
  </label>
</div>

<div class="toolbar-separator"></div>

<div class="toolbar-group">
  <ReadGate>
  <span class="lang" data-cmd="spellLanguage"><LanguagePicker value={documentLanguage} other={documentLanguageOther} onChange={onLanguage} {editor} {tick} /></span>
  </ReadGate>
  <GrammarToggle value={documentLanguage} other={documentLanguageOther} {editor} {tick} />
</div>

{#snippet newCommentIcon()}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.5 3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7l-3 2.5v-2.5h-.5a1 1 0 0 1-1-1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M8 4.75v4M6 6.75h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>
{/snippet}

<style>
  .stat {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 3px 0.6rem;
    color: var(--color-text-muted);
  }
  .stat b { color: var(--color-text); }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: var(--toolbar-btn-size);
    padding: 0 0.35rem;
    font-family: var(--font-sans);
    font-size: 0.8rem;
    color: var(--color-text);
    white-space: nowrap;
    cursor: pointer;
  }
  .check input { accent-color: var(--color-primary); cursor: pointer; }

  /* The spell-check picker is chromeless for the status bar; in a row it needs a frame. */
  .lang {
    display: inline-flex;
    align-items: center;
    height: var(--toolbar-btn-size);
    padding: 0 0.35rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
  }
  .lang:hover,
  .lang:focus-within { border-color: var(--color-primary); }
</style>
