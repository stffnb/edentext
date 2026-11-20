<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { onMount } from 'svelte';
  import { fontFromLabel, fontLabel, fontMatches, isAsianFont } from '../ribbon/fontList.svelte';
  import { clickOutside, closeMenu, isMenuOpen, showMenu } from '../ribbon/menu.svelte';
  import { uniformFont } from '../../utils/selectionFormat';
  import { detectInstalledFonts, queryLocalFontsIfAllowed, supportsLocalFontAccess } from '../../utils/fontDetect';
  import { t } from '../../i18n/i18n.svelte';

  // The island's font name field: type to narrow the list, Enter applies the typed name.
  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  const MENU = 'font';

  // Always-shown fonts — render in the picker even when detection fails or is blocked.
  const WEB_SAFE_FONTS: readonly string[] = [
    'Liberation Serif', 'Arial', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New',
  ];
  const WEB_SAFE_SET = new Set<string>(WEB_SAFE_FONTS);

  const RECENT_FONTS_KEY = 'edentext-recent-fonts';
  const MAX_RECENT_FONTS = 5;

  let recentFonts = $state<string[]>([]);
  let detectedFonts = $state<string[]>([]);
  let allInstalledFonts = $state<string[] | null>(null);
  const localFontAccessSupported = typeof window !== 'undefined' && supportsLocalFontAccess();

  function loadRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_FONTS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_FONTS);
    } catch { return []; }
  }

  function saveRecents(fonts: string[]) {
    try { localStorage.setItem(RECENT_FONTS_KEY, JSON.stringify(fonts)); } catch { /* quota or disabled */ }
  }

  async function ensureDetectionRan() {
    detectedFonts = await detectInstalledFonts();
  }

  onMount(() => {
    recentFonts = loadRecents();
    // Run detection during browser idle time after first paint so the picker
    // is primed before the user ever clicks it, without delaying initial render.
    const schedule = typeof requestIdleCallback === 'function'
      ? (cb: () => void) => requestIdleCallback(cb, { timeout: 1000 })
      : (cb: () => void) => setTimeout(cb, 0);
    schedule(() => ensureDetectionRan());
  });

  let extraFontsList = $derived.by(() => {
    const source = allInstalledFonts ?? detectedFonts;
    const out: string[] = [];
    const recentSet = new Set(recentFonts);
    for (const f of source) {
      if (!WEB_SAFE_SET.has(f) && !recentSet.has(f)) out.push(f);
    }
    return out.sort((a, b) => a.localeCompare(b));
  });

  async function showAllInstalledFonts() {
    const list = await queryLocalFontsIfAllowed();
    if (list && list.length > 0) allInstalledFonts = list;
  }

  // The uniform font of the selection, '' when fonts are mixed.
  let currentFont = $derived(tick >= 0 && editor ? uniformFont(editor.state) : '');

  let open = $derived(isMenuOpen(MENU));
  let inputFocused = $state(false);
  let inputValue = $state('');
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  // The typed text survives the input's blur while the dropdown is open: clicking an
  // option blurs first, and re-expanding the list there would move the click target away.
  $effect(() => {
    if (!inputFocused && !open) inputValue = fontLabel(currentFont);
  });

  // While the user types, the dropdown narrows to the matching fonts.
  let filter = $derived(open && inputValue !== fontLabel(currentFont) ? inputValue.trim().toLowerCase() : '');
  const matchesFilter = (f: string) => !filter || fontMatches(f, filter);
  let recentShown = $derived(recentFonts.filter(matchesFilter));
  let webSafeShown = $derived(WEB_SAFE_FONTS.filter(matchesFilter));
  let extraShown = $derived(extraFontsList.filter(matchesFilter));

  function toggle() {
    if (!editor) return;
    // Save selection before the picker button steals focus.
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    if (open) return closeMenu();
    // Detection normally runs on mount; this is the safety net for an early click.
    ensureDetectionRan();
    showMenu(MENU);
  }

  function onFocus(e: FocusEvent) {
    inputFocused = true;
    if (!open) toggle();
    (e.target as HTMLInputElement).select();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const typed = inputValue.trim();
      const known = [...recentFonts, ...WEB_SAFE_FONTS, ...extraFontsList];
      // Exact name wins; otherwise the first prefix match, like LibreOffice's
      // autocomplete. An unknown name is applied as typed (the font may exist).
      const hit = fontFromLabel(typed, known);
      if (typed) pick(hit ?? typed);
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      inputFocused = false;
      (e.target as HTMLInputElement).blur();
      editor?.commands.focus();
    }
  }

  function pick(value: string) {
    if (!editor) return;
    closeMenu();
    inputFocused = false;
    const from = savedFrom ?? editor.state.selection.from;
    const to = savedTo ?? editor.state.selection.to;
    savedFrom = null;
    savedTo = null;
    const chain = editor.chain().focus().setTextSelection({ from, to });
    (isAsianFont(value) ? chain.setFontFamilyAsian(value) : chain.setFontFamily(value)).run();

    const next = [value, ...recentFonts.filter((f) => f !== value)].slice(0, MAX_RECENT_FONTS);
    recentFonts = next;
    saveRecents(next);
  }
</script>

<div class="font-picker" data-cmd="fontFamily" use:clickOutside={MENU}>
  <div class="font-trigger-wrap">
    <input
      type="text"
      dir="ltr"
      class="font-input"
      style={currentFont ? `font-family: ${currentFont}` : ''}
      bind:value={inputValue}
      onfocus={onFocus}
      onkeydown={onKeydown}
      onblur={() => (inputFocused = false)}
      spellcheck="false"
      autocomplete="off"
      title={t().toolbarExpanded.fontName}
    />
    <button class="font-chevron" onclick={toggle} tabindex="-1" title={t().toolbarExpanded.fontName}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  {#if open}
    <div class="font-dropdown">
      <div class="menu-scroll">
        {#if recentShown.length > 0}
          <div class="font-section-label">{t().toolbarExpanded.recent}</div>
          {#each recentShown as font}
            <button class="font-option" class:active={currentFont === font} style="font-family: {font}" onclick={() => pick(font)}><bdi>{fontLabel(font)}</bdi></button>
          {/each}
        {/if}

        {#if webSafeShown.length > 0}
          <div class="font-section-label">{t().toolbarExpanded.webSafe}</div>
        {/if}
        {#each webSafeShown as font}
          <button class="font-option" class:active={currentFont === font} style="font-family: {font}" onclick={() => pick(font)}><bdi>{fontLabel(font)}</bdi></button>
        {/each}

        {#if extraShown.length > 0}
          <div class="font-section-label">{t().toolbarExpanded.allFonts}</div>
          {#each extraShown as font}
            <button class="font-option" class:active={currentFont === font} style="font-family: {font}" onclick={() => pick(font)}><bdi>{fontLabel(font)}</bdi></button>
          {/each}
        {/if}

        {#if localFontAccessSupported && !allInstalledFonts}
          <button class="font-show-all" onclick={showAllInstalledFonts}>
            {t().toolbarExpanded.loadAllFonts}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .font-picker {
    position: relative;
  }

  .font-trigger-wrap {
    display: inline-flex;
    align-items: center;
    height: var(--toolbar-btn-size);
    width: 145px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    transition: border-color 0.15s;
    overflow: hidden;
  }

  .font-trigger-wrap:hover,
  .font-trigger-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .font-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 0 0 0.5rem;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    outline: none;
    text-overflow: ellipsis;
  }

  .font-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 100%;
    padding: 0;
    border: none;
    border-left: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .font-chevron:hover {
    background: var(--color-btn-hover);
  }

  .font-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    inset-inline-start: 0;
    min-width: 100%;
    max-height: 360px;
    overflow: hidden;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  /* A ruled heading that stays pinned while its fonts scroll, so it never reads
     as one more font that cannot be picked. */
  .font-section-label {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 0.3rem 0.6rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-text-muted);
    font-family: var(--font-sans);
    user-select: none;
  }

  .font-section-label:not(:first-child) {
    margin-top: 6px;
  }

  .font-show-all {
    display: block;
    width: 100%;
    min-height: fit-content;
    padding: 0.4rem 0.6rem;
    margin-top: 2px;
    border: none;
    border-top: 1px solid var(--color-border);
    border-radius: 0;
    background: var(--color-surface);
    color: var(--color-primary);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: start;
    cursor: pointer;
    position: sticky;
    bottom: -2px;
  }

  .font-show-all:hover {
    background: var(--color-btn-hover);
  }

  .font-option {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    text-align: start;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .font-option:hover {
    background: var(--color-btn-hover);
  }

  .font-option.active {
    background: var(--color-primary);
    color: white;
  }
</style>
