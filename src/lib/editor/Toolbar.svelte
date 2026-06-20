<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import HistoryButton from './HistoryButton.svelte';
  import AlignButton from './AlignButton.svelte';
  import { ORDERED_LIST_TYPES, DEFAULT_ORDERED_TYPE, type OrderedListType } from './orderedListTypes';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  // $derived re-evaluates whenever `tick` changes (i.e. on every TipTap transaction)
  let isH1         = $derived(tick >= 0 && !!editor?.isActive('heading', { level: 1 }));
  let isH2         = $derived(tick >= 0 && !!editor?.isActive('heading', { level: 2 }));
  let isH3         = $derived(tick >= 0 && !!editor?.isActive('heading', { level: 3 }));
  let isHeading    = $derived(isH1 || isH2 || isH3);
  // fontWeight:'normal' is set explicitly to override heading boldness
  let hasNormalWeight = $derived(tick >= 0 && !!editor?.isActive('textStyle', { fontWeight: 'normal' }));
  // Bold = explicit bold mark, OR inside a heading that hasn't been un-bolded
  let isBold       = $derived(tick >= 0 && (!!editor?.isActive('bold') || (isHeading && !hasNormalWeight)));
  let isItalic     = $derived(tick >= 0 && !!editor?.isActive('italic'));
  let isUnderline  = $derived(tick >= 0 && !!editor?.isActive('underline'));
  let isStrike     = $derived(tick >= 0 && !!editor?.isActive('strike'));
  let isBulletList = $derived(tick >= 0 && !!editor?.isActive('bulletList'));
  let isOrderedList= $derived(tick >= 0 && !!editor?.isActive('orderedList'));

  // Numbering style of the ordered list at the cursor (null when not in one).
  let currentOrderedType = $derived.by<OrderedListType | null>(() => {
    if (tick < 0 || !editor || !editor.isActive('orderedList')) return null;
    return (editor.getAttributes('orderedList').listStyleType ?? DEFAULT_ORDERED_TYPE) as OrderedListType;
  });

  let olMenuOpen = $state(false);

  // Toggle a plain (decimal) ordered list — the split button's main half.
  function toggleOrderedList() {
    olMenuOpen = false;
    editor?.chain().focus().toggleOrderedList().run();
  }

  // Apply a numbering style; creates the list first if the selection isn't in one.
  function applyOrderedType(key: OrderedListType) {
    if (!editor) return;
    olMenuOpen = false;
    const chain = editor.chain().focus();
    if (!editor.isActive('orderedList')) chain.toggleOrderedList();
    chain.updateAttributes('orderedList', { listStyleType: key }).run();
  }

  function olMenuClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) olMenuOpen = false;
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<div class="toolbar">
  {#if editor}
    <div class="toolbar-group">
      <button
        class:active={isBold}
        onclick={() => {
          if (isHeading) {
            if (hasNormalWeight) {
              // Restore heading's natural bold
              editor?.chain().focus().unsetFontWeight().run();
            } else {
              // Override heading bold with explicit font-weight: normal
              editor?.chain().focus().setFontWeight('normal').run();
            }
          } else {
            editor?.chain().focus().toggleBold().run();
          }
        }}
        title="Bold (Ctrl+B)"
      >
        <strong>B</strong>
      </button>
      <button
        class:active={isItalic}
        onclick={() => editor?.chain().focus().toggleItalic().run()}
        title="Italic (Ctrl+I)"
      >
        <em>I</em>
      </button>
      <button
        class:active={isUnderline}
        onclick={() => editor?.chain().focus().toggleUnderline().run()}
        title="Underline (Ctrl+U)"
      >
        <u>U</u>
      </button>
      <button
        class:active={isStrike}
        onclick={() => editor?.chain().focus().toggleStrike().run()}
        title="Strikethrough (Ctrl+Shift+S)"
      >
        <s>S</s>
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={isH1}
        onclick={() => editor?.chain().focus().toggleHeading({ level: 1 }).unsetFontSize().unsetFontWeight().removeEmptyTextStyle().run()}
        title="Heading 1"
      >
        H1
      </button>
      <button
        class:active={isH2}
        onclick={() => editor?.chain().focus().toggleHeading({ level: 2 }).unsetFontSize().unsetFontWeight().removeEmptyTextStyle().run()}
        title="Heading 2"
      >
        H2
      </button>
      <button
        class:active={isH3}
        onclick={() => editor?.chain().focus().toggleHeading({ level: 3 }).unsetFontSize().unsetFontWeight().removeEmptyTextStyle().run()}
        title="Heading 3"
      >
        H3
      </button>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <button
        class:active={isBulletList}
        onclick={() => editor?.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="2" cy="4" r="1.5" fill="currentColor"/>
          <circle cx="2" cy="8" r="1.5" fill="currentColor"/>
          <circle cx="2" cy="12" r="1.5" fill="currentColor"/>
          <line x1="5.5" y1="4" x2="15" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5.5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <line x1="5.5" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="ol-picker" use:olMenuClickOutside>
        <div class="ol-split">
          <button
            class="ol-main"
            class:active={isOrderedList}
            onclick={toggleOrderedList}
            title="Ordered list"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <text x="0" y="5.5" font-size="5" font-family="sans-serif" fill="currentColor">1.</text>
              <text x="0" y="9.5" font-size="5" font-family="sans-serif" fill="currentColor">2.</text>
              <text x="0" y="13.5" font-size="5" font-family="sans-serif" fill="currentColor">3.</text>
              <line x1="5.5" y1="4" x2="15" y2="4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5.5" y1="8" x2="15" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <line x1="5.5" y1="12" x2="15" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            class="ol-chevron"
            class:active={isOrderedList}
            onclick={() => (olMenuOpen = !olMenuOpen)}
            title="Numbering style"
            aria-haspopup="menu"
            aria-expanded={olMenuOpen}
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
              <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        {#if olMenuOpen}
          <div class="ol-dropdown" role="menu">
            <div class="ol-section-label">Numbering</div>
            {#each ORDERED_LIST_TYPES as t}
              <button
                class="ol-option"
                class:active={currentOrderedType === t.key}
                onclick={() => applyOrderedType(t.key)}
                title={t.label}
                role="menuitemradio"
                aria-checked={currentOrderedType === t.key}
              >
                <span class="ol-option-preview">{t.preview}</span>
                <span class="ol-option-label">{t.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <AlignButton {editor} {tick} />
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <HistoryButton {editor} {tick} direction="undo" />
    </div>

    <div class="toolbar-separator"></div>

    <div class="toolbar-group">
      <HistoryButton {editor} {tick} direction="redo" />
    </div>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.35rem 1rem;
    background: var(--color-toolbar-bg);
    position: sticky;
    top: 0;
    z-index: 200;
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

  /* Ordered-list split button: main toggle + chevron that opens the numbering
     style menu, rendered as one joined control. */
  .ol-picker {
    position: relative;
  }

  .ol-split {
    display: inline-flex;
    align-items: center;
  }

  .ol-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .ol-chevron {
    min-width: unset;
    width: 1rem;
    padding: 0;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .ol-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    min-width: 170px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 2px;
    display: flex;
    flex-direction: column;
  }

  .ol-section-label {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .ol-option {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-width: unset;
    height: auto;
    padding: 0.35rem 0.6rem;
    border-radius: calc(var(--radius) - 2px);
    justify-content: flex-start;
    text-align: left;
  }

  .ol-option:hover {
    background: var(--color-btn-hover);
  }

  .ol-option.active {
    background: var(--color-primary);
    color: white;
  }

  .ol-option-preview {
    display: inline-flex;
    justify-content: center;
    min-width: 1.6rem;
    font-family: var(--font-serif, serif);
    font-size: 0.9rem;
  }

  .ol-option-label {
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }

  .ol-option.active .ol-option-label {
    color: white;
  }
</style>
