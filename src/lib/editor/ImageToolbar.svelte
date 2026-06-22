<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { WrapMode } from './image';

  let {
    editor,
    top,
    left,
    wrap,
  }: {
    editor: Editor | null;
    top: number;
    left: number;
    wrap: WrapMode;
  } = $props();

  // preventDefault on mousedown keeps the image node-selected; .focus() re-anchors
  // to it so setImageWrap targets the right node.
  function set(mode: WrapMode) {
    editor?.chain().focus().setImageWrap(mode).run();
  }

  const modes: { mode: WrapMode; title: string }[] = [
    { mode: 'inline', title: 'In line with text' },
    { mode: 'left', title: 'Wrap text — image left' },
    { mode: 'right', title: 'Wrap text — image right' },
    { mode: 'topBottom', title: 'Top and bottom' },
  ];
</script>

<div
  class="image-toolbar"
  style="top: {top}px; left: {left}px;"
  role="toolbar"
  tabindex="-1"
  aria-label="Image text wrap"
  onmousedown={(e) => e.preventDefault()}
>
  {#each modes as m}
    <button
      class="it-btn"
      class:active={wrap === m.mode}
      title={m.title}
      aria-label={m.title}
      aria-pressed={wrap === m.mode}
      onclick={() => set(m.mode)}
    >
      {#if m.mode === 'inline'}
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2.5" y="6" width="5" height="6" rx="1" fill="currentColor" />
          <line x1="9" y1="7.5" x2="15.5" y2="7.5" stroke="currentColor" stroke-width="1.2" />
          <line x1="9" y1="10.5" x2="15.5" y2="10.5" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else if m.mode === 'left'}
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2.5" y="4" width="6" height="6" rx="1" fill="currentColor" />
          <line x1="10" y1="5" x2="15.5" y2="5" stroke="currentColor" stroke-width="1.2" />
          <line x1="10" y1="8" x2="15.5" y2="8" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="13" x2="15.5" y2="13" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else if m.mode === 'right'}
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="9.5" y="4" width="6" height="6" rx="1" fill="currentColor" />
          <line x1="2.5" y1="5" x2="8" y2="5" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="8" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="13" x2="15.5" y2="13" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <line x1="2.5" y1="3" x2="15.5" y2="3" stroke="currentColor" stroke-width="1.2" />
          <rect x="6" y="6" width="6" height="6" rx="1" fill="currentColor" />
          <line x1="2.5" y1="15" x2="15.5" y2="15" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {/if}
    </button>
  {/each}
</div>

<style>
  .image-toolbar {
    position: absolute;
    transform: translateY(calc(-100% - 6px));
    z-index: 150;
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.14);
  }

  .it-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    height: 1.7rem;
    min-width: unset;
    padding: 0;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .it-btn:hover {
    background: var(--color-btn-hover);
  }

  .it-btn.active {
    background: var(--color-btn-active, var(--color-btn-hover));
    color: var(--color-accent, #3b82f6);
  }
</style>
