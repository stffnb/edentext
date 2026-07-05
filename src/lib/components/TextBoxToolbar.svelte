<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { WrapMode } from '../editor/extensions/image';
  import type { ShapeKind, TextBoxAttrs } from '../editor/extensions/textBox';
  import ColorPicker from './ColorPicker.svelte';
  import { t } from '../i18n/i18n.svelte';

  let {
    editor,
    top,
    left,
    wrap,
    shapeKind,
    fillColor,
    strokeColor,
    strokeWidthPt,
  }: {
    editor: Editor | null;
    top: number;
    left: number;
    wrap: WrapMode;
    shapeKind: ShapeKind;
    fillColor: string | null;
    strokeColor: string | null;
    strokeWidthPt: number;
  } = $props();

  let fillOpen = $state(false);
  let strokeOpen = $state(false);

  function set(attrs: Partial<TextBoxAttrs>) {
    editor?.chain().focus().setTextBoxAttrs(attrs).run();
  }

  const wrapModes: WrapMode[] = ['inline', 'left', 'right', 'topBottom'];
  function wrapTitle(m: WrapMode): string {
    return m === 'inline' ? t().textBox.wrapInline
      : m === 'left' ? t().textBox.wrapLeft
      : m === 'right' ? t().textBox.wrapRight
      : t().textBox.wrapTopBottom;
  }

  const shapes: ShapeKind[] = ['textbox', 'roundRect', 'ellipse'];
  function shapeTitle(k: ShapeKind): string {
    return k === 'textbox' ? t().textBox.shapeRect
      : k === 'roundRect' ? t().textBox.shapeRoundRect
      : t().textBox.shapeEllipse;
  }

  const strokeWidths = [0.5, 1, 2.25];
</script>

<div
  class="tb-toolbar"
  style="top: {top}px; left: {left}px;"
  role="toolbar"
  tabindex="-1"
  aria-label={t().textBox.toolbar}
  onmousedown={(e) => {
    // Keep the box selection/caret; buttons work via click.
    if ((e.target as HTMLElement).closest('select') === null) e.preventDefault();
  }}
>
  {#each wrapModes as m}
    <button
      class="tb-btn"
      class:active={wrap === m}
      title={wrapTitle(m)}
      aria-label={wrapTitle(m)}
      aria-pressed={wrap === m}
      onclick={() => set({ wrap: m })}
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
      {:else}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <line x1="2.5" y1="3" x2="15.5" y2="3" stroke="currentColor" stroke-width="1.2" />
          <rect x="6" y="6" width="6" height="6" rx="1" fill="currentColor" />
          <line x1="2.5" y1="15" x2="15.5" y2="15" stroke="currentColor" stroke-width="1.2" />
        </svg>
      {/if}
    </button>
  {/each}

  <span class="tb-sep"></span>

  {#each shapes as s}
    <button
      class="tb-btn"
      class:active={shapeKind === s}
      title={shapeTitle(s)}
      aria-label={shapeTitle(s)}
      aria-pressed={shapeKind === s}
      onclick={() => set({ shapeKind: s })}
    >
      {#if s === 'textbox'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2.5" y="4.5" width="13" height="9" stroke="currentColor" stroke-width="1.3" />
        </svg>
      {:else if s === 'roundRect'}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2.5" y="4.5" width="13" height="9" rx="3" stroke="currentColor" stroke-width="1.3" />
        </svg>
      {:else}
        <svg width="22" height="22" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <ellipse cx="9" cy="9" rx="6.5" ry="4.5" stroke="currentColor" stroke-width="1.3" />
        </svg>
      {/if}
    </button>
  {/each}

  <span class="tb-sep"></span>

  <ColorPicker
    {editor}
    bind:open={fillOpen}
    currentColor={fillColor}
    defaultColor="#FFFFFF"
    title={t().textBox.fillColor}
    chevronTitle={t().textBox.chooseFillColor}
    clearLabel={t().textBox.noFill}
    onOpen={() => (strokeOpen = false)}
    onApply={(c) => set({ fillColor: c })}
    onClear={() => set({ fillColor: null })}
  >
    {#snippet icon()}
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M7.5 2.5l6 6-5 5a1.4 1.4 0 0 1-2 0l-4-4a1.4 1.4 0 0 1 0-2z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
        <path d="M7.5 2.5L6 1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M15 12c0 1-.7 2-1.5 2S12 13 12 12c0-.8 1.5-2.3 1.5-2.3S15 11.2 15 12z" fill="currentColor" stroke="none"/>
      </svg>
    {/snippet}
  </ColorPicker>

  <ColorPicker
    {editor}
    bind:open={strokeOpen}
    currentColor={strokeColor}
    defaultColor="#000000"
    title={t().textBox.borderColor}
    chevronTitle={t().textBox.chooseBorderColor}
    clearLabel={t().textBox.noBorder}
    onOpen={() => (fillOpen = false)}
    onApply={(c) => set({ strokeColor: c })}
    onClear={() => set({ strokeColor: null })}
  >
    {#snippet icon()}
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.6" />
        <rect x="6.5" y="6.5" width="5" height="5" stroke="currentColor" stroke-width="0.9" stroke-dasharray="1.6 1.2" />
      </svg>
    {/snippet}
  </ColorPicker>

  <select
    class="tb-width"
    title={t().textBox.borderWidth}
    aria-label={t().textBox.borderWidth}
    value={String(strokeWidthPt)}
    onchange={(e) => set({ strokeWidthPt: parseFloat((e.target as HTMLSelectElement).value) })}
  >
    {#each strokeWidths as w}
      <option value={String(w)}>{t().textBox.pt(w)}</option>
    {/each}
    {#if !strokeWidths.includes(strokeWidthPt)}
      <option value={String(strokeWidthPt)}>{t().textBox.pt(strokeWidthPt)}</option>
    {/if}
  </select>
</div>

<style>
  .tb-toolbar {
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

  .tb-btn {
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

  .tb-btn:hover {
    background: var(--color-btn-hover);
  }

  .tb-btn.active {
    background: var(--color-btn-active, var(--color-btn-hover));
    color: var(--color-accent, #3b82f6);
  }

  .tb-sep {
    width: 1px;
    height: 1.1rem;
    margin: 0 3px;
    background: var(--color-border);
  }

  .tb-width {
    height: 1.7rem;
    padding: 0 0.2rem;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.72rem;
  }
</style>
