<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { t } from '../i18n/i18n.svelte';
  import AlignIcon from './AlignIcon.svelte';
  import { shortcutHint, type ShortcutId } from '../editor/shortcuts';

  import type { AlignValue } from './AlignIcon.svelte';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

  const ALIGNMENTS: AlignValue[] = ['left', 'center', 'right', 'justify'];

  const ALIGN_SHORTCUTS: Record<AlignValue, ShortcutId> = {
    left: 'alignLeft', center: 'alignCenter', right: 'alignRight', justify: 'alignJustify',
  };

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

  let alignOpen = $state(false);

  function openAlignPicker() {
    if (!editor) return;
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

<div class="align-picker" use:alignPickerClickOutside>
  <button class="align-trigger" onclick={openAlignPicker} title={t().align.title}>
    <AlignIcon value={currentAlign || 'left'} />
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  {#if alignOpen}
    <div class="align-dropdown">
      <div class="align-section-label">{t().align.section}</div>
      {#each ALIGNMENTS as a}
        <button
          class="align-option"
          class:active={currentAlign === a}
          onclick={() => pickAlign(a)}
          title={`${t().align.alignTo(t().align[a])} (${shortcutHint(ALIGN_SHORTCUTS[a])})`}
        >
          <AlignIcon value={a} />
          <span>{t().align[a]}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .align-picker {
    position: relative;
  }

  .align-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--toolbar-btn-size);
    padding: 0 0.3rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .align-trigger:hover {
    background: var(--color-btn-hover);
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

  .align-section-label {
    padding: 0.4rem 0.6rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
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
  }

  .align-option:hover {
    background: var(--color-btn-hover);
  }

  .align-option.active {
    background: var(--color-primary);
    color: white;
  }
</style>
