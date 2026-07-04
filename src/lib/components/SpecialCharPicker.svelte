<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { CHAR_CATEGORIES, type SpecialChar } from '../utils/specialChars';

  let {
    editor,
    open = $bindable(false),
    onOpen,
    onInsert,
  }: {
    editor: Editor | null;
    open?: boolean;
    onOpen?: () => void;
    // Mirrors TablePicker's onInsert: the parent runs the editor command against
    // the saved selection range (focus is stolen by the popover).
    onInsert: (char: string, range: { from: number; to: number }) => void;
  } = $props();

  const RECENT_CHARS_KEY = 'odf-editor-recent-chars';
  const MAX_RECENT = 12;

  // De-duplicated flat index across all categories, for search and name lookup.
  const flatIndex: SpecialChar[] = (() => {
    const seen = new Set<string>();
    const out: SpecialChar[] = [];
    for (const cat of CHAR_CATEGORIES) {
      for (const c of cat.chars) {
        if (!seen.has(c.char)) { seen.add(c.char); out.push(c); }
      }
    }
    return out;
  })();
  const nameByChar = new Map(flatIndex.map((e) => [e.char, e.name]));

  let activeIndex = $state(0);
  let query = $state('');
  let recentChars = $state<string[]>(loadRecents());

  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  function loadRecents(): string[] {
    try {
      const raw = localStorage.getItem(RECENT_CHARS_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT);
    } catch { return []; }
  }

  function saveRecents(chars: string[]) {
    try { localStorage.setItem(RECENT_CHARS_KEY, JSON.stringify(chars)); } catch { /* quota or disabled */ }
  }

  function hexOf(char: string): string {
    return (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
  }

  function titleOf(char: string): string {
    const name = nameByChar.get(char);
    return `${name ? name + ' ' : ''}(U+${hexOf(char)})`;
  }

  // Search results when the query is non-empty, otherwise the active category.
  // Matches a name substring, the literal glyph, or a hex codepoint prefix.
  let displayed = $derived.by(() => {
    const raw = query.trim();
    if (!raw) return CHAR_CATEGORIES[activeIndex].chars;
    const q = raw.toLowerCase();
    const hexQ = q.replace(/^u\+/, '').replace(/^0x/, '').replace(/\s+/g, '');
    const isHex = /^[0-9a-f]+$/.test(hexQ);
    return flatIndex.filter((e) =>
      e.name.includes(q) ||
      e.char === raw ||
      (isHex && hexOf(e.char).toLowerCase().startsWith(hexQ)),
    );
  });

  function openPicker() {
    if (!editor) return;
    onOpen?.();
    if (open) {
      open = false;
      return;
    }
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    query = '';
    open = true;
  }

  // Insert at the saved range, then keep the popover open and advance the saved
  // caret to just after the glyph so consecutive picks type out in sequence.
  function pick(char: string) {
    if (!editor) return;
    const from = savedFrom ?? editor.state.selection.from;
    const to = savedTo ?? editor.state.selection.to;
    onInsert(char, { from, to });
    savedFrom = savedTo = editor.state.selection.to;

    const next = [char, ...recentChars.filter((c) => c !== char)].slice(0, MAX_RECENT);
    recentChars = next;
    saveRecents(next);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
      (e.currentTarget as HTMLElement).blur();
    }
  }

  function charPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) open = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="char-picker" use:charPickerClickOutside>
  <button class="char-trigger" onclick={openPicker} title="Insert special character" aria-pressed={open}>
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <text x="8" y="12.5" font-size="14" font-weight="700" font-family="var(--font-serif, serif)" fill="currentColor" text-anchor="middle">Ω</text>
    </svg>
  </button>

  {#if open}
    <div class="char-dropdown" role="dialog" aria-label="Insert special character" tabindex="-1" onkeydown={onKeydown}>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        class="char-search"
        bind:value={query}
        placeholder="Search by name or code…"
        aria-label="Search special characters"
        autofocus
      />

      {#if !query && recentChars.length > 0}
        <div class="char-section-label">Recent</div>
        <div class="char-grid">
          {#each recentChars as c (c)}
            <button class="char-cell" title={titleOf(c)} onclick={() => pick(c)}>{c}</button>
          {/each}
        </div>
      {/if}

      {#if !query}
        <div class="char-tabs" role="tablist">
          {#each CHAR_CATEGORIES as cat, i}
            <button
              class="char-tab"
              class:active={i === activeIndex}
              role="tab"
              aria-selected={i === activeIndex}
              onclick={() => (activeIndex = i)}
            >{cat.name}</button>
          {/each}
        </div>
      {/if}

      {#if displayed.length > 0}
        <div class="char-grid main">
          {#each displayed as entry (entry.char)}
            <button class="char-cell" title={titleOf(entry.char)} onclick={() => pick(entry.char)}>{entry.char}</button>
          {/each}
        </div>
      {:else}
        <div class="char-empty">No matching characters</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .char-picker {
    position: relative;
  }

  .char-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
    padding: 0 0.3rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .char-trigger:hover {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
  }

  .char-trigger[aria-pressed='true'] {
    background: var(--color-primary);
    color: white;
  }

  .char-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    right: 0;
    width: 312px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 8px;
  }

  .char-search {
    width: 100%;
    height: 1.9rem;
    padding: 0 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.82rem;
    font-family: var(--font-sans);
    outline: none;
    transition: border-color 0.15s;
  }

  .char-search:hover,
  .char-search:focus {
    border-color: var(--color-primary);
  }

  .char-section-label {
    padding: 0.45rem 0.1rem 0.2rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    user-select: none;
  }

  .char-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin: 6px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--color-border);
  }

  .char-tab {
    padding: 0.2rem 0.45rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-muted);
    font-size: 0.72rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }

  .char-tab:hover {
    background: var(--color-btn-hover);
    color: var(--color-text);
  }

  .char-tab.active {
    background: var(--color-primary);
    color: white;
  }

  .char-grid {
    display: grid;
    grid-template-columns: repeat(10, 1fr);
    gap: 2px;
  }

  .char-grid.main {
    max-height: 220px;
    overflow-y: auto;
  }

  .char-cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: unset;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-serif, serif);
    font-size: 1rem;
    line-height: 1;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }

  .char-cell:hover {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .char-empty {
    padding: 1rem 0.5rem;
    text-align: center;
    font-size: 0.8rem;
    font-family: var(--font-sans);
    color: var(--color-text-muted);
  }
</style>
