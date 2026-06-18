<script lang="ts">
  import type { Editor } from '@tiptap/core';

  let { editor, tick }: { editor: Editor | null; tick: number } = $props();

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
      <div class="align-section-label">Alignment</div>
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

<style>
  .align-picker {
    position: relative;
  }

  .align-trigger {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 2rem;
    padding: 0 0.4rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.15s;
  }

  .align-trigger:hover {
    background: var(--color-btn-hover);
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
