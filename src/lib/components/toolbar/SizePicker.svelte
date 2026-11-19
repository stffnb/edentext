<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { clickOutside, closeMenu, isMenuOpen, toggleMenu } from '../ribbon/menu.svelte';
  import { blockFontSize, coversWholeBlock, DEFAULT_FONT_SIZE, parseSize, sizeLabel, sizeMenu, type SizedBlock } from '../../utils/fontSize';
  import { locale, t } from '../../i18n/i18n.svelte';

  // The island's font size field: a typed size or one from the list.
  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  const MENU = 'fontSize';

  // A node that carries text formatting in the selection: a text node, or an inline
  // atom (e.g. a date/time field) bearing the mark. Selecting such an atom makes a
  // NodeSelection, so without this its size would read as default.
  const bearsMark = (node: { isText: boolean; isInline: boolean; isAtom: boolean; marks: readonly { type: { name: string } }[] }): boolean =>
    node.isText || (node.isInline && node.isAtom && node.marks.some((m) => m.type.name === 'textStyle'));

  function effectiveSize(node: { marks: readonly { type: { name: string }; attrs: Record<string, string> }[] }, parent: SizedBlock): string {
    const explicit = node.marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize;
    return explicit || blockFontSize(parent);
  }

  let currentFontSize = $derived.by(() => {
    if (tick < 0 || !editor) return '';
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      const head = editor.state.selection.$head;
      const marks = editor.state.storedMarks ?? head.marks();
      const explicit = marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize;
      if (explicit) return explicit;
      return blockFontSize(head.parent as SizedBlock);
    }
    let size: string | undefined;
    let mixed = false;
    editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (mixed || !bearsMark(node)) return;
      const s = effectiveSize(node as Parameters<typeof effectiveSize>[0], parent as SizedBlock);
      if (size === undefined) size = s;
      else if (size !== s) mixed = true;
    });
    return mixed ? '' : (size ?? DEFAULT_FONT_SIZE);
  });

  let open = $derived(isMenuOpen(MENU));
  let inputFocused = $state(false);
  let inputValue = $state('');
  let namedSizes = $derived(locale() === 'zh-Hans');
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  $effect(() => {
    if (!inputFocused) inputValue = currentFontSize ? sizeLabel(currentFontSize, namedSizes) : '';
  });

  function save() {
    if (!editor) return;
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
  }

  function apply(size: number) {
    if (!editor) return;
    const from = savedFrom ?? editor.state.selection.from;
    const to = savedTo ?? editor.state.selection.to;
    savedFrom = null;
    savedTo = null;
    const chain = editor.chain().focus().setTextSelection({ from, to }).setFontSize(`${size}pt`);
    if (coversWholeBlock(editor.state.doc, from, to)) chain.setBlockFontSize(`${size}pt`);
    chain.run();
  }

  function onFocus(e: FocusEvent) {
    if (!editor) return;
    inputFocused = true;
    if (open) closeMenu();
    save();
    (e.target as HTMLInputElement).select();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const num = parseSize(inputValue);
      if (num != null) apply(num);
      inputFocused = false;
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      inputFocused = false;
      (e.target as HTMLInputElement).blur();
    }
  }

  function toggle() {
    if (!editor) return;
    if (!inputFocused) save();
    toggleMenu(MENU);
  }

  function pick(size: number) {
    closeMenu();
    inputFocused = false;
    apply(size);
  }
</script>

<div class="size-picker" data-cmd="fontSize" use:clickOutside={MENU}>
  <div class="size-trigger-wrap">
    <input
      type="text"
      dir="ltr"
      class="size-input"
      bind:value={inputValue}
      onfocus={onFocus}
      onkeydown={onKeydown}
      onblur={() => (inputFocused = false)}
      title={t().toolbarExpanded.fontSize}
    />
    <button class="size-chevron" onclick={toggle} tabindex="-1" title={t().toolbarExpanded.fontSizeList}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  {#if open}
    <div class="size-dropdown">
      <div class="menu-scroll">
        <div class="size-label">{t().toolbarExpanded.fontSize}</div>
        {#each sizeMenu(namedSizes) as [label, size]}
          <button class="size-option" class:active={sizeLabel(currentFontSize, namedSizes) === label} onclick={() => pick(size)}>{label}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .size-picker {
    position: relative;
  }

  .size-trigger-wrap {
    display: inline-flex;
    align-items: center;
    height: var(--toolbar-btn-size);
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
    inset-inline-start: 0;
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
    overflow: hidden;
  }

  .size-label {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
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
    text-align: start;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s;
  }

  .size-option:hover {
    background: var(--color-btn-hover);
  }

  .size-option.active {
    background: var(--color-primary);
    color: white;
  }
</style>
