<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { WrapMode } from '../editor/extensions/image';
  import { t } from '../i18n/i18n.svelte';

  let {
    editor,
    top,
    left,
    wrap,
    inFront,
  }: {
    editor: Editor | null;
    top: number;
    left: number;
    wrap: WrapMode;
    inFront: boolean;
  } = $props();

  // preventDefault on mousedown keeps the image node-selected; .focus() re-anchors
  // to it so setImageWrap targets the right node.
  function set(m: WrapChoice) {
    editor?.chain().focus().setImageWrap(m === 'behind' || m === 'front' ? 'through' : m, m === 'front').run();
  }

  // The list Word's layout options offer, without "tight" (no browser wraps text along
  // a contour). The two run-through entries are one mode, told apart by which side of
  // the text the frame lands on.
  type WrapChoice = WrapMode | 'behind' | 'front';
  const modes: WrapChoice[] = ['inline', 'left', 'right', 'topBottom', 'behind', 'front'];
  const active = $derived<WrapChoice>(wrap === 'through' ? (inFront ? 'front' : 'behind') : wrap);
  function wrapTitle(m: WrapChoice): string {
    return m === 'inline' ? t().image.wrapInline
      : m === 'left' ? t().image.wrapLeft
      : m === 'right' ? t().image.wrapRight
      : m === 'behind' ? t().image.wrapBehind
      : m === 'front' ? t().image.wrapFront
      : t().image.wrapTopBottom;
  }
</script>

<div
  class="image-toolbar"
  style="top: {top}px; left: {left}px;"
  role="toolbar"
  tabindex="-1"
  aria-label={t().image.wrapToolbar}
  onmousedown={(e) => e.preventDefault()}
>
  {#each modes as m}
    <button
      class="it-btn"
      class:active={active === m}
      title={wrapTitle(m)}
      aria-label={wrapTitle(m)}
      aria-pressed={active === m}
      onclick={() => set(m)}
    >
      {#if m === 'inline'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <line x1="2.5" y1="3" x2="15.5" y2="3" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="12" x2="5.5" y2="12" stroke="currentColor" stroke-width="1.2" />
          <rect x="6.5" y="6" width="5" height="6" rx="1" fill="currentColor" />
          <line x1="12.5" y1="12" x2="15.5" y2="12" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="15" x2="15.5" y2="15" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else if m === 'left'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <line x1="2.5" y1="3" x2="15.5" y2="3" stroke="currentColor" stroke-width="1.2" />
          <rect x="2.5" y="6" width="6" height="6" rx="1" fill="currentColor" />
          <line x1="10" y1="7" x2="15.5" y2="7" stroke="currentColor" stroke-width="1.2" />
          <line x1="10" y1="10" x2="15.5" y2="10" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="15" x2="15.5" y2="15" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else if m === 'right'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <line x1="2.5" y1="3" x2="15.5" y2="3" stroke="currentColor" stroke-width="1.2" />
          <rect x="9.5" y="6" width="6" height="6" rx="1" fill="currentColor" />
          <line x1="2.5" y1="7" x2="8" y2="7" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="10" x2="8" y2="10" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="15" x2="15.5" y2="15" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else if m === 'behind'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="5" y="4.5" width="8" height="9" rx="1" stroke="currentColor" stroke-width="1.2" opacity="0.45" />
          <line x1="2.5" y1="6" x2="15.5" y2="6" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="9" x2="15.5" y2="9" stroke="currentColor" stroke-width="1.2" />
          <line x1="2.5" y1="12" x2="15.5" y2="12" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {:else if m === 'front'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <line x1="2.5" y1="6" x2="15.5" y2="6" stroke="currentColor" stroke-width="1.2" opacity="0.45" />
          <line x1="2.5" y1="9" x2="15.5" y2="9" stroke="currentColor" stroke-width="1.2" opacity="0.45" />
          <line x1="2.5" y1="12" x2="15.5" y2="12" stroke="currentColor" stroke-width="1.2" opacity="0.45" />
          <rect x="5" y="4.5" width="8" height="9" rx="1" fill="currentColor" />
        </svg>
      {:else}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
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
