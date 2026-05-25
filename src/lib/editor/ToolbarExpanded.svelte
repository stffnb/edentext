<script lang="ts">
  import type { Editor } from '@tiptap/core';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  let isAlignLeft    = $derived(tick >= 0 && !!editor?.isActive({ textAlign: 'left' }));
  let isAlignCenter  = $derived(tick >= 0 && !!editor?.isActive({ textAlign: 'center' }));
  let isAlignRight   = $derived(tick >= 0 && !!editor?.isActive({ textAlign: 'right' }));
  let isAlignJustify = $derived(tick >= 0 && !!editor?.isActive({ textAlign: 'justify' }));

  const FONTS = [
    { value: 'Arial',            label: 'Arial'            },
    { value: 'Verdana',          label: 'Verdana'          },
    { value: 'Trebuchet MS',     label: 'Trebuchet MS'     },
    { value: 'Georgia',          label: 'Georgia'          },
    { value: 'Times New Roman',  label: 'Times New Roman'  },
    { value: 'Courier New',      label: 'Courier New'      },
  ] as const;

  // Returns the uniform font of the selection, or '' when fonts are mixed.
  let currentFont = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const marks = editor.state.storedMarks ?? editor.state.selection.$head.marks();
      return marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? '';
    }
    let font: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return;
      const f: string = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? '';
      if (font === undefined) font = f;
      else if (font !== f) mixed = true;
    });
    return mixed ? '' : (font ?? '');
  });

  let fontOpen = $state(false);
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  function openFontPicker() {
    if (!editor) return;
    // Save selection before the picker button steals focus.
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    fontOpen = !fontOpen;
  }

  function pickFont(value: string) {
    if (!editor) return;
    fontOpen = false;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    editor.chain().focus().setTextSelection({ from, to }).setFontFamily(value).run();
  }

  function fontPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) fontOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="toolbar-expanded">
  {#if editor}
    <div class="font-picker" use:fontPickerClickOutside>
      <button class="font-trigger" onclick={openFontPicker} title="Font Name">
        <span class="font-trigger-label" style={currentFont ? `font-family: ${currentFont}` : ''}>{currentFont}</span>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if fontOpen}
        <div class="font-dropdown">
          {#each FONTS as font}
            <button
              class="font-option"
              class:active={currentFont === font.value}
              style="font-family: {font.value}"
              onclick={() => pickFont(font.value)}
            >{font.label}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <select
        class="font-size-select"
        disabled
        title="Font size (coming soon)"
      >
        <option>16</option>
      </select>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button disabled title="Font color (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <text x="3" y="11" font-size="10" font-weight="bold" font-family="sans-serif" fill="currentColor">A</text>
          <rect x="2" y="13" width="12" height="2" rx="0.5" fill="currentColor"/>
        </svg>
      </button>
      <button disabled title="Highlight color (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" opacity="0.3"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={isAlignLeft}
        disabled
        title="Align left (coming soon)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class:active={isAlignCenter}
        disabled
        title="Align center (coming soon)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class:active={isAlignRight}
        disabled
        title="Align right (coming soon)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="4" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class:active={isAlignJustify}
        disabled
        title="Justify (coming soon)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button disabled title="Insert table (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="1.5" y="1.5" width="13" height="13" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <line x1="1.5" y1="5.5" x2="14.5" y2="5.5" stroke="currentColor" stroke-width="1"/>
          <line x1="1.5" y1="9.5" x2="14.5" y2="9.5" stroke="currentColor" stroke-width="1"/>
          <line x1="5.5" y1="5.5" x2="5.5" y2="14.5" stroke="currentColor" stroke-width="1"/>
          <line x1="10.5" y1="5.5" x2="10.5" y2="14.5" stroke="currentColor" stroke-width="1"/>
        </svg>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button disabled title="Clear formatting (coming soon)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .toolbar-expanded {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 1rem;
    background: var(--color-toolbar-bg);
    border-bottom: 1px solid var(--color-border);
  }

  .toolbar-group {
    display: flex;
    gap: 2px;
  }

  .toolbar-separator {
    width: 1px;
    height: 1.5rem;
    background: var(--color-border);
    margin: 0 0.5rem;
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 2rem;
    height: 2rem;
    padding: 0 0.5rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    cursor: pointer;
    transition: background 0.15s;
  }

  button:hover:not(:disabled) {
    background: var(--color-btn-hover);
  }

  button.active {
    background: var(--color-primary);
    color: white;
  }

  button:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .font-picker {
    position: relative;
  }

  .font-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem 0 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    cursor: pointer;
    width: 145px;
    transition: border-color 0.15s;
  }

  .font-trigger:hover {
    border-color: var(--color-primary);
  }

  .font-trigger-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    font-size: 0.8rem;
  }

  .font-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 100%;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
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
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .font-option:hover {
    background: var(--color-btn-hover);
  }

  .font-option.active {
    background: var(--color-primary);
    color: white;
  }

  .font-size-select {
    height: 2rem;
    padding: 0 0.5rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    cursor: not-allowed;
    opacity: 0.35;
  }
</style>
