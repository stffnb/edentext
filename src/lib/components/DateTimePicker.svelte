<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import {
    DATE_FORMATS, TIME_FORMATS, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT,
    renderFormat, localeTag, type DtFormat,
  } from '../utils/dateTime';
  import { shortcutHint } from '../editor/shortcuts';
  import { t, locale } from '../i18n/i18n.svelte';

  let {
    editor,
    open = $bindable(false),
    onOpen,
    onInsert,
  }: {
    editor: Editor | null;
    open?: boolean;
    onOpen?: () => void;
    // Mirrors SpecialCharPicker: the parent runs the command against the saved range.
    onInsert: (
      opts: { kind: 'date' | 'time'; format: string; fixed: boolean },
      range: { from: number; to: number },
    ) => void;
  } = $props();

  let fixed = $state(true);
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  // A live clock so the samples show the real current date/time; ticks while open.
  let now = $state(new Date());
  $effect(() => {
    if (!open) return;
    now = new Date();
    const id = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(id);
  });

  function sample(fmt: DtFormat): string {
    return renderFormat(fmt, now, localeTag(locale()));
  }

  function openPicker() {
    if (!editor) return;
    onOpen?.();
    if (open) {
      open = false;
      return;
    }
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    now = new Date();
    open = true;
  }

  function pick(fmt: DtFormat) {
    if (!editor) return;
    const from = savedFrom ?? editor.state.selection.from;
    const to = savedTo ?? editor.state.selection.to;
    onInsert({ kind: fmt.kind, format: fmt.key, fixed }, { from, to });
    open = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      open = false;
      (e.currentTarget as HTMLElement).blur();
    }
  }

  function dtPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) open = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="dt-picker" use:dtPickerClickOutside>
  <button class="dt-trigger" onclick={openPicker} title={t().dateTime.insert} aria-pressed={open} aria-label={t().dateTime.insert}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="11.5" rx="1.5" stroke="currentColor" />
      <path d="M1.75 5.5h12.5M4.5 1.5v2.5M11.5 1.5v2.5" stroke="currentColor" stroke-linecap="round" />
      <circle cx="8" cy="10" r="2.4" stroke="currentColor" />
      <path d="M8 8.8V10l0.9 0.6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <div class="dt-dropdown" role="dialog" aria-label={t().dateTime.insert} tabindex="-1" onkeydown={onKeydown}>
      <div class="dt-columns">
        <div class="dt-col">
          <div class="dt-section-label">{t().dateTime.dateHeading}</div>
          {#each DATE_FORMATS as fmt (fmt.key)}
            <button class="dt-cell" onclick={() => pick(fmt)} title={fmt.key === DEFAULT_DATE_FORMAT ? shortcutHint('dateField') : undefined}>{sample(fmt)}</button>
          {/each}
        </div>
        <div class="dt-col">
          <div class="dt-section-label">{t().dateTime.timeHeading}</div>
          {#each TIME_FORMATS as fmt (fmt.key)}
            <button class="dt-cell" onclick={() => pick(fmt)} title={fmt.key === DEFAULT_TIME_FORMAT ? shortcutHint('timeField') : undefined}>{sample(fmt)}</button>
          {/each}
        </div>
      </div>
      <label class="dt-auto" title={t().dateTime.updateHint}>
        <input type="checkbox" checked={!fixed} onchange={(e) => (fixed = !(e.currentTarget as HTMLInputElement).checked)} />
        {t().dateTime.updateAutomatically}
      </label>
    </div>
  {/if}
</div>

<style>
  .dt-picker {
    position: relative;
  }

  .dt-trigger {
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

  .dt-trigger:hover {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
  }

  .dt-trigger[aria-pressed='true'] {
    background: var(--color-primary);
    color: white;
  }

  .dt-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    right: 0;
    width: 340px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 8px;
  }

  .dt-columns {
    display: grid;
    grid-template-columns: 1.7fr 1fr;
    gap: 10px;
  }

  .dt-col {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dt-section-label {
    padding: 0.1rem 0.1rem 0.25rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted);
    font-family: var(--font-sans);
    user-select: none;
  }

  .dt-cell {
    text-align: left;
    padding: 0.32rem 0.45rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    color: var(--color-text);
    font-family: var(--font-serif, serif);
    font-size: 0.85rem;
    line-height: 1.2;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.1s, border-color 0.1s;
  }

  .dt-cell:hover {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: white;
  }

  .dt-auto {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--color-border);
    font-size: 0.78rem;
    font-family: var(--font-sans);
    color: var(--color-text);
    cursor: pointer;
    user-select: none;
  }
</style>
