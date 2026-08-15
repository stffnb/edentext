<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { onMount } from 'svelte';
  import { FORMAT_MARKS, getSearchState, type FormatSpec } from '../editor/extensions/searchReplace';
  import { styleOrder } from '../styles/styleSheet';
  import { styleSheet } from '../styles/sheet.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { withShortcut } from '../i18n/shortcut';

  let { editor, tick, mode, focusNonce, onClose }:
    { editor: Editor | null; tick: number; mode: 'find' | 'replace'; focusNonce: number; onClose: () => void } = $props();

  let findText = $state('');
  let replaceText = $state('');
  let matchCase = $state(false);
  let wholeWord = $state(false);
  let useRegex = $state(false);
  let showReplace = $state(false); // set from `mode` in the focusNonce effect below
  let showFormat = $state(false);
  let findFormat = $state<FormatSpec>({});
  let replaceFormat = $state<FormatSpec>({});
  let findInput = $state<HTMLInputElement | null>(null);

  let paraStyles = $derived(styleOrder(styleSheet()));
  const markLabel: Record<string, () => string> = {
    bold: () => t().toolbar.bold, italic: () => t().toolbar.italic, underline: () => t().toolbar.underline,
  };

  // Live match count / current index, recomputed on every editor transaction.
  let results = $derived.by(() => {
    void tick;
    return editor ? getSearchState(editor.state) : { count: 0, current: -1, term: '' };
  });

  function applySearch() {
    editor?.commands.setSearch({ term: findText, matchCase, wholeWord, useRegex, format: { ...findFormat } });
    editor?.commands.scrollToCurrent();
  }

  function next() { editor?.commands.findNext(); }
  function prev() { editor?.commands.findPrevious(); }
  function replaceOne() { editor?.commands.replaceCurrent(replaceText, { ...replaceFormat }); }
  function replaceEvery() { editor?.commands.replaceAll(replaceText, { ...replaceFormat }); }

  function setFormat(find: boolean, patch: FormatSpec) {
    if (find) { findFormat = { ...findFormat, ...patch }; applySearch(); }
    else replaceFormat = { ...replaceFormat, ...patch };
  }

  const spec = (find: boolean): FormatSpec => (find ? findFormat : replaceFormat);

  function onFindKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? prev() : next(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  function onReplaceKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  function toggleCase() { matchCase = !matchCase; applySearch(); }
  function toggleWord() { wholeWord = !wholeWord; applySearch(); }
  function toggleRegex() { useRegex = !useRegex; applySearch(); }

  // Prefill from the current selection (single line) on first open.
  onMount(() => {
    if (editor) {
      const { from, to } = editor.state.selection;
      if (to > from) {
        const sel = editor.state.doc.textBetween(from, to, '\n');
        if (sel && !sel.includes('\n')) findText = sel;
      }
    }
    applySearch();
  });

  // Each Ctrl+F / Ctrl+H bumps focusNonce → refocus and reveal the replace row as asked.
  $effect(() => {
    void focusNonce;
    showReplace = showReplace || mode === 'replace';
    queueMicrotask(() => { findInput?.focus(); findInput?.select(); });
  });
</script>

<div class="find-bar" role="dialog" aria-label={t().findReplace.dialogLabel}>
  <button class="fb-expand" onclick={() => (showReplace = !showReplace)} title={showReplace ? t().findReplace.hideReplace : t().findReplace.showReplace} aria-label={t().findReplace.toggleReplace}>
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style="transform: rotate({showReplace ? 90 : 0}deg)">
      <path d="M3 1.5l3.5 3.5L3 8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  <div class="fb-rows">
    <div class="fb-row">
      <input
        bind:this={findInput}
        bind:value={findText}
        oninput={applySearch}
        onkeydown={onFindKeydown}
        type="text"
        placeholder={t().findReplace.findPlaceholder}
        spellcheck="false"
        autocomplete="off"
      />
      <span class="fb-count">
        {#if findText && results.count === 0}{t().findReplace.noResults}
        {:else if results.count > 0}{results.current + 1}/{results.count}
        {/if}
      </span>
      <button class="fb-opt" class:on={matchCase} onclick={toggleCase} title={t().findReplace.matchCase} aria-pressed={matchCase}>Aa</button>
      <button class="fb-opt fb-word" class:on={wholeWord} onclick={toggleWord} title={t().findReplace.wholeWord} aria-pressed={wholeWord}>
        <span>W</span>
      </button>
      <button class="fb-opt" class:on={useRegex} onclick={toggleRegex} title={t().findReplace.regex} aria-pressed={useRegex}>.*</button>
      <button class="fb-opt" class:on={showFormat} onclick={() => (showFormat = !showFormat)} title={t().findReplace.format} aria-pressed={showFormat}>¶</button>
      <button class="fb-nav" onclick={prev} disabled={!results.count} title={`${t().findReplace.previous} (${withShortcut('Shift+Enter')})`} aria-label={t().findReplace.previousAria}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 7.5L6 4l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="fb-nav" onclick={next} disabled={!results.count} title={`${t().findReplace.next} (Enter)`} aria-label={t().findReplace.nextAria}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="fb-close" onclick={onClose} title={`${t().common.close} (Esc)`} aria-label={t().common.close}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      </button>
    </div>

    {#if showReplace}
      <div class="fb-row">
        <input
          bind:value={replaceText}
          onkeydown={onReplaceKeydown}
          type="text"
          placeholder={t().findReplace.replacePlaceholder}
          spellcheck="false"
          autocomplete="off"
        />
        <button class="fb-text-btn" onclick={replaceOne} disabled={!results.count} title={t().findReplace.replaceCurrent}>{t().findReplace.replace}</button>
        <button class="fb-text-btn" onclick={replaceEvery} disabled={!results.count} title={t().findReplace.replaceAllTitle}>{t().findReplace.all}</button>
      </div>
    {/if}

    <!-- The formatting a match must carry, and the one a replacement applies. With no
         search text the formatting is the search, as it is in LibreOffice. -->
    {#if showFormat}
      {#each showReplace ? [true, false] : [true] as find}
        <div class="fb-row">
          <span class="fb-fmt-label">{find ? t().findReplace.formatFind : t().findReplace.formatReplace}</span>
          {#each FORMAT_MARKS as mark}
            <button
              class="fb-opt fb-fmt-{mark}"
              class:on={spec(find)[mark]}
              onclick={() => setFormat(find, { [mark]: spec(find)[mark] ? undefined : true })}
              title={markLabel[mark]()}
              aria-pressed={!!spec(find)[mark]}
            >{markLabel[mark]().slice(0, 1)}</button>
          {/each}
          <select
            value={spec(find).style ?? ''}
            onchange={(e) => setFormat(find, { style: e.currentTarget.value || undefined })}
            aria-label={t().findReplace.paragraphStyle}
          >
            <option value="">{t().findReplace.anyStyle}</option>
            {#each paraStyles as s}<option value={s.name}>{s.name}</option>{/each}
          </select>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .find-bar {
    display: flex;
    align-items: flex-start;
    gap: 0.25rem;
    padding: 0.4rem 0.5rem;
    background: var(--color-toolbar-bg, #fff);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    font-family: var(--font-sans);
  }

  .fb-rows { display: flex; flex-direction: column; gap: 0.3rem; }
  .fb-row { display: flex; align-items: center; gap: 0.25rem; }

  input {
    width: 14rem;
    box-sizing: border-box;
    padding: 0.3rem 0.45rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    /* --color-surface (not page-bg): page-bg stays white in dark mode, surface follows the theme. */
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.82rem;
  }

  .fb-count {
    min-width: 4.2rem;
    text-align: center;
    font-size: 0.72rem;
    color: var(--color-text-muted, #6b7280);
    white-space: nowrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.7rem;
    height: 1.7rem;
    padding: 0 0.4rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.74rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  button:hover:not(:disabled) { background: var(--color-btn-hover, rgba(0, 0, 0, 0.06)); }
  button:disabled { opacity: 0.4; cursor: default; }
  .fb-opt.on { background: var(--color-primary); color: #fff; }
  .fb-opt { font-weight: 600; }
  .fb-fmt-italic { font-style: italic; }
  .fb-fmt-underline { text-decoration: underline; }

  .fb-fmt-label {
    min-width: 4.6rem;
    font-size: 0.72rem;
    color: var(--color-text-muted, #6b7280);
  }

  select {
    height: 1.7rem;
    max-width: 9rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.76rem;
  }

  .fb-word span { text-decoration: underline; }
  .fb-text-btn { min-width: auto; padding: 0 0.6rem; border-color: var(--color-border); }
  .fb-expand { min-width: 1.2rem; width: 1.2rem; align-self: center; }
</style>
