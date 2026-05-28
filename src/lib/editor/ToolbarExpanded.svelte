<script lang="ts">
  import type { Editor } from '@tiptap/core';

  let { editor, tick, showFormattingMarks = $bindable() }: { editor: Editor | null; tick: number; showFormattingMarks: boolean } = $props();

  type AlignValue = 'left' | 'center' | 'right' | 'justify';

  const ALIGNMENTS: { value: AlignValue; label: string }[] = [
    { value: 'left',    label: 'Left'    },
    { value: 'center',  label: 'Center'  },
    { value: 'right',   label: 'Right'   },
    { value: 'justify', label: 'Justify' },
  ];

  // Empty string when the selection spans paragraphs/headings with different alignments.
  let currentAlign = $derived.by<AlignValue | ''>(() => {
    if (tick < 0 || !editor) return 'left';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      return (editor.state.selection.$head.parent.attrs.textAlign ?? 'left') as AlignValue;
    }
    let a: AlignValue | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed) return;
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
      const v = (node.attrs.textAlign ?? 'left') as AlignValue;
      if (a === undefined) a = v;
      else if (a !== v) mixed = true;
    });
    return mixed ? '' : (a ?? 'left');
  });

  // Must match the first font in --font-serif in editor.css
  const DEFAULT_EDITOR_FONT = 'Georgia';

  const FONTS = [
    { value: 'Arial',            label: 'Arial'            },
    { value: 'Verdana',          label: 'Verdana'          },
    { value: 'Trebuchet MS',     label: 'Trebuchet MS'     },
    { value: 'Georgia',          label: 'Georgia'          },
    { value: 'Times New Roman',  label: 'Times New Roman'  },
    { value: 'Courier New',      label: 'Courier New'      },
  ] as const;

  // Returns the uniform font of the selection, or '' when fonts are mixed.
  // Plain Text without an explicit mark falls back to DEFAULT_EDITOR_FONT.
  let currentFont = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const marks = editor.state.storedMarks ?? editor.state.selection.$head.marks();
      return marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? DEFAULT_EDITOR_FONT;
    }
    let font: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !node.isText) return;
      const f: string = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontFamily ?? DEFAULT_EDITOR_FONT;
      if (font === undefined) font = f;
      else if (font !== f) mixed = true;
    });
    return mixed ? '' : (font ?? DEFAULT_EDITOR_FONT);
  });

  // Must match the common document default and editor.css heading sizes (in pt)
  const DEFAULT_FONT_SIZE = '12pt';
  const HEADING_SIZES: Record<number, string> = { 1: '20pt', 2: '16pt', 3: '14pt' };
  const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];

  function effectiveSize(node: { isText: boolean; marks: readonly { type: { name: string }; attrs: Record<string, string> }[] }, parent: { type: { name: string }; attrs: Record<string, number> } | null): string {
    const explicit = node.marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize;
    if (explicit) return explicit;
    if (parent?.type.name === 'heading') return HEADING_SIZES[parent.attrs.level] ?? DEFAULT_FONT_SIZE;
    return DEFAULT_FONT_SIZE;
  }

  let currentFontSize = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const head = editor.state.selection.$head;
      const marks = editor.state.storedMarks ?? head.marks();
      const explicit = marks.find(m => m.type.name === 'textStyle')?.attrs.fontSize;
      if (explicit) return explicit;
      const parent = head.parent;
      if (parent.type.name === 'heading') return HEADING_SIZES[parent.attrs.level] ?? DEFAULT_FONT_SIZE;
      return DEFAULT_FONT_SIZE;
    }
    let size: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (mixed || !node.isText) return;
      const s = effectiveSize(node as Parameters<typeof effectiveSize>[0], parent as Parameters<typeof effectiveSize>[1]);
      if (size === undefined) size = s;
      else if (size !== s) mixed = true;
    });
    return mixed ? '' : (size ?? DEFAULT_FONT_SIZE);
  });

  // Must match line-height in editor.css (.paper .tiptap)
  const DEFAULT_LINE_HEIGHT = '1.5';
  const LINE_HEIGHTS = [
    { value: '1',    label: 'Single'      },
    { value: '1.15', label: '1.15'        },
    { value: '1.5',  label: '1.5'         },
    { value: '2',    label: 'Double'      },
  ] as const;

  let currentLineHeight = $derived.by(() => {
    if (tick < 0 || !editor) return DEFAULT_LINE_HEIGHT;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      return editor.state.selection.$head.parent.attrs.lineHeight ?? DEFAULT_LINE_HEIGHT;
    }
    let lh: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (mixed || !('lineHeight' in node.attrs)) return;
      const h: string = node.attrs.lineHeight ?? DEFAULT_LINE_HEIGHT;
      if (lh === undefined) lh = h;
      else if (lh !== h) mixed = true;
    });
    return mixed ? '' : (lh ?? DEFAULT_LINE_HEIGHT);
  });

  let fontOpen = $state(false);
  let sizeOpen = $state(false);
  let lineHeightOpen = $state(false);
  let alignOpen = $state(false);
  let sizeInputFocused = $state(false);
  let sizeInputValue = $state('');
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  $effect(() => {
    if (!sizeInputFocused) {
      sizeInputValue = currentFontSize ? currentFontSize.replace('pt', '') : '';
    }
  });

  function openFontPicker() {
    if (!editor) return;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    alignOpen = false;
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

  function applyFontSize(size: number) {
    if (!editor) return;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    editor.chain().focus().setTextSelection({ from, to }).setFontSize(`${size}pt`).run();
  }

  function onSizeInputFocus(e: FocusEvent) {
    if (!editor) return;
    sizeInputFocused = true;
    fontOpen = false;
    lineHeightOpen = false;
    alignOpen = false;
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    (e.target as HTMLInputElement).select();
  }

  function onSizeInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const num = parseInt(sizeInputValue, 10);
      if (!isNaN(num) && num >= 1 && num <= 400) applyFontSize(num);
      sizeInputFocused = false;
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      sizeInputFocused = false;
      (e.target as HTMLInputElement).blur();
    }
  }

  function onSizeInputBlur() {
    sizeInputFocused = false;
  }

  function openSizePicker() {
    if (!editor) return;
    fontOpen = false;
    lineHeightOpen = false;
    alignOpen = false;
    if (!sizeInputFocused) {
      savedFrom = editor.state.selection.from;
      savedTo = editor.state.selection.to;
    }
    sizeOpen = !sizeOpen;
  }

  function pickSize(size: number) {
    if (!editor) return;
    sizeOpen = false;
    sizeInputFocused = false;
    applyFontSize(size);
  }

  function sizePickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) {
        sizeOpen = false;
      }
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  function openLineHeightPicker() {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    alignOpen = false;
    lineHeightOpen = !lineHeightOpen;
  }

  function pickLineHeight(value: string) {
    if (!editor) return;
    lineHeightOpen = false;
    editor.chain().focus().setLineHeight(value).run();
  }

  function lineHeightPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) lineHeightOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }

  function openAlignPicker() {
    if (!editor) return;
    fontOpen = false;
    sizeOpen = false;
    sizeInputFocused = false;
    lineHeightOpen = false;
    alignOpen = !alignOpen;
  }

  function pickAlign(value: AlignValue) {
    if (!editor) return;
    alignOpen = false;
    editor.chain().focus().setTextAlign(value).run();
  }

  function alignPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) alignOpen = false;
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

    <div class="size-picker" use:sizePickerClickOutside>
      <div class="size-trigger-wrap">
        <input
          type="text"
          class="size-input"
          bind:value={sizeInputValue}
          onfocus={onSizeInputFocus}
          onkeydown={onSizeInputKeydown}
          onblur={onSizeInputBlur}
          inputmode="numeric"
          title="Font size"
        />
        <button class="size-chevron" onclick={openSizePicker} tabindex="-1" title="Font size list">
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
            <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      {#if sizeOpen}
        <div class="size-dropdown">
          {#each FONT_SIZES as size}
            <button
              class="size-option"
              class:active={currentFontSize === `${size}pt`}
              onclick={() => pickSize(size)}
            >{size}</button>
          {/each}
        </div>
      {/if}
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

    <div class="lh-picker" use:lineHeightPickerClickOutside>
      <button class="lh-trigger" onclick={openLineHeightPicker} title="Line spacing">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <line x1="5" y1="3"  x2="14" y2="3"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5" y1="8"  x2="14" y2="8"  stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5" y1="13" x2="14" y2="13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M2 5.5V1.5M2 1.5L1 2.8M2 1.5L3 2.8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 10.5V14.5M2 14.5L1 13.2M2 14.5L3 13.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if lineHeightOpen}
        <div class="lh-dropdown">
          {#each LINE_HEIGHTS as lh}
            <button
              class="lh-option"
              class:active={currentLineHeight === lh.value}
              onclick={() => pickLineHeight(lh.value)}
            >{lh.label}</button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="align-picker" use:alignPickerClickOutside>
      <button class="align-trigger" onclick={openAlignPicker} title="Text alignment">
        {#if currentAlign === 'center'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {:else if currentAlign === 'right'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="4" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {:else if currentAlign === 'justify'}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        {/if}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      {#if alignOpen}
        <div class="align-dropdown">
          {#each ALIGNMENTS as a}
            <button
              class="align-option"
              class:active={currentAlign === a.value}
              onclick={() => pickAlign(a.value)}
              title="Align {a.label.toLowerCase()}"
            >
              {#if a.value === 'left'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="7" x2="10" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="11" x2="12" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {:else if a.value === 'center'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="4" y1="7" x2="12" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="3" y1="11" x2="13" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {:else if a.value === 'right'}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="6" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="4" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {:else}
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="7" x2="14" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  <line x1="2" y1="11" x2="14" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              {/if}
              <span>{a.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={showFormattingMarks}
        onclick={() => (showFormattingMarks = !showFormattingMarks)}
        title="Formatting marks"
        aria-pressed={showFormattingMarks}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M11 2.25v11.5M7.5 2.25v11.5M11 2.25H6.75a2.75 2.75 0 0 0 0 5.5H7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
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

  .size-picker {
    position: relative;
  }

  .size-trigger-wrap {
    display: inline-flex;
    align-items: center;
    height: 2rem;
    width: 62px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    transition: border-color 0.15s;
    overflow: hidden;
  }

  .size-trigger-wrap:hover,
  .size-trigger-wrap:focus-within {
    border-color: var(--color-primary);
  }

  .size-input {
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
  }

  .size-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    min-width: unset;
    height: 100%;
    padding: 0;
    border: none;
    border-left: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .size-chevron:hover {
    background: var(--color-btn-hover);
  }

  .size-dropdown {
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
    max-height: 260px;
    overflow-y: auto;
  }

  .size-option {
    display: block;
    width: 100%;
    padding: 0.3rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .size-option:hover {
    background: var(--color-btn-hover);
  }

  .size-option.active {
    background: var(--color-primary);
    color: white;
  }

  .lh-picker {
    position: relative;
  }

  .lh-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    transition: border-color 0.15s;
  }

  .lh-trigger:hover {
    border-color: var(--color-primary);
  }

  .lh-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 110px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .lh-option {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .lh-option:hover {
    background: var(--color-btn-hover);
  }

  .lh-option.active {
    background: var(--color-primary);
    color: white;
  }

  .align-picker {
    position: relative;
  }

  .align-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    transition: border-color 0.15s;
  }

  .align-trigger:hover {
    border-color: var(--color-primary);
  }

  .align-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 130px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .align-option {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.85rem;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
    min-width: unset;
    height: auto;
    justify-content: flex-start;
  }

  .align-option:hover {
    background: var(--color-btn-hover);
  }

  .align-option.active {
    background: var(--color-primary);
    color: white;
  }
</style>
