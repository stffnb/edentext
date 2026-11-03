<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { onDestroy } from 'svelte';
  import { getSearchState } from '../editor/extensions/searchReplace';
  import { t } from '../i18n/i18n.svelte';

  // The navigator's search box above its tabs: typing searches the document through the
  // find bar's own plugin and opens the results tab; the fold below it replaces.
  let { editor, tick, onSearch }: { editor: Editor | null; tick: number; onSearch: () => void } = $props();

  let term = $state('');
  let replaceText = $state('');
  let matchCase = $state(false);
  let wholeWord = $state(false);
  let useRegex = $state(false);
  let showReplace = $state(false);

  let results = $derived.by(() => {
    void tick;
    return editor ? getSearchState(editor.state) : { count: 0, current: -1, term: '' };
  });
  // The find bar shares the plugin: only a search of this box's own is counted here.
  const ours = $derived(!!term && results.term === term);
  const count = $derived(ours ? results.count : 0);

  function apply() {
    editor?.commands.setSearch({ term, matchCase, wholeWord, useRegex });
    if (term) onSearch();
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!ours) apply();
      if (e.shiftKey) editor?.commands.findPrevious(); else editor?.commands.findNext();
    } else if (e.key === 'Escape' && term) {
      e.preventDefault();
      term = '';
      apply();
    }
  }

  const toggle = (set: () => void) => () => { set(); if (term) apply(); };

  // Its highlights go with the pane, unless the find bar has searched since.
  onDestroy(() => { if (term && editor && getSearchState(editor.state).term === term) editor.commands.clearSearch(); });
</script>

<div class="nav-search">
  <div class="row">
    <button class="fold" onclick={() => (showReplace = !showReplace)} aria-expanded={showReplace}
      title={showReplace ? t().findReplace.hideReplace : t().findReplace.showReplace} aria-label={t().findReplace.toggleReplace}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style:transform="rotate({showReplace ? 0 : -90}deg)"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <input type="search" bind:value={term} oninput={apply} onkeydown={keydown} placeholder={t().navigator.searchDocument}
      aria-label={t().navigator.searchDocument} spellcheck="false" autocomplete="off" />
    {#if term}
      <span class="count" aria-live="polite">{count ? (results.current >= 0 ? `${results.current + 1}/${count}` : count) : t().findReplace.noResults}</span>
    {/if}
  </div>
  {#if showReplace}
    <div class="row indent">
      <input type="text" bind:value={replaceText} placeholder={t().findReplace.replacePlaceholder} aria-label={t().findReplace.replacePlaceholder}
        spellcheck="false" autocomplete="off"
        onkeydown={(e) => { if (e.key === 'Enter' && count) { e.preventDefault(); editor?.commands.replaceCurrent(replaceText); } }} />
    </div>
    <div class="row indent">
      <button class="opt" class:on={matchCase} aria-pressed={matchCase} title={t().findReplace.matchCase} onclick={toggle(() => (matchCase = !matchCase))}>Aa</button>
      <button class="opt word" class:on={wholeWord} aria-pressed={wholeWord} title={t().findReplace.wholeWord} onclick={toggle(() => (wholeWord = !wholeWord))}>W</button>
      <button class="opt" class:on={useRegex} aria-pressed={useRegex} title={t().findReplace.regex} onclick={toggle(() => (useRegex = !useRegex))}>.*</button>
      <span class="gap"></span>
      <button class="text" disabled={!count} title={t().findReplace.replaceCurrent} onclick={() => editor?.commands.replaceCurrent(replaceText)}>{t().findReplace.replace}</button>
      <button class="text" disabled={!count} title={t().findReplace.replaceAllTitle} onclick={() => editor?.commands.replaceAll(replaceText)}>{t().findReplace.all}</button>
    </div>
  {/if}
</div>

<style>
  .nav-search { display: flex; flex-direction: column; gap: 4px; padding: 0 6px 6px; font-size: var(--nav-text); }
  .row { display: flex; align-items: center; gap: 2px; min-width: 0; }
  .indent { padding-inline-start: 18px; }
  .gap { flex: 1; }

  input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    padding: 3px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
  }
  .count { flex: none; padding: 0 2px; color: var(--color-text-muted); font-size: 0.9em; white-space: nowrap; font-variant-numeric: tabular-nums; }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--color-btn-hover); }
  button:disabled { opacity: 0.4; cursor: default; }
  .fold { flex: none; width: 16px; height: 22px; padding: 0; color: var(--color-text-muted); }
  .fold svg { transition: transform 0.12s; }
  .opt { min-width: 22px; height: 22px; padding: 0 3px; font-weight: 600; font-size: 0.9em; }
  .opt.word { text-decoration: underline; }
  .opt.on { background: var(--color-primary); color: #fff; }
  .text { height: 22px; padding: 0 6px; border-color: var(--color-border); }
</style>
