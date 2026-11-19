<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { Snippet } from 'svelte';
  import { onDestroy, tick, untrack } from 'svelte';
  import { t, startEdge, uiRtl } from '../i18n/i18n.svelte';
  import CustomColorPanel, { hsvToHex } from './CustomColorPanel.svelte';

  let {
    editor,
    currentColor,
    defaultColor,
    title,
    chevronTitle,
    clearLabel,
    open = $bindable(false),
    disabled = false,
    onApply,
    onClear,
    onOpen,
    icon,
  }: {
    editor: Editor | null;
    // Uniform color of the selection. null = no color anywhere; '' = mixed.
    currentColor: string | null;
    defaultColor: string;
    title: string;
    chevronTitle: string;
    clearLabel?: string;
    open?: boolean;
    disabled?: boolean;
    onApply: (color: string, range: { from: number; to: number }) => void;
    onClear: (range: { from: number; to: number }) => void;
    onOpen?: () => void;
    // A toolbar button's glyph. A dialog field passes none and is the swatch alone.
    icon?: Snippet;
  } = $props();

  // Row 1 = greyscale, row 2 = standard hues. Rows 3–7 are generated per column
  // as a light→dark gradient over the same hue, so each column reads as a shade ramp.
  const COLUMN_HUES: { h: number; sBase: number }[] = [
    { h: 0,   sBase: 0.85 }, // red (crimson side)
    { h: 8,   sBase: 1.00 }, // red
    { h: 35,  sBase: 1.00 }, // orange
    { h: 55,  sBase: 1.00 }, // yellow
    { h: 88,  sBase: 0.55 }, // yellow-green
    { h: 146, sBase: 1.00 }, // green
    { h: 195, sBase: 1.00 }, // cyan
    { h: 210, sBase: 1.00 }, // blue
    { h: 225, sBase: 1.00 }, // deep blue
    { h: 275, sBase: 0.65 }, // purple
  ];
  const SHADE_STOPS: { sScale: number; v: number }[] = [
    { sScale: 0.25, v: 1.00 },
    { sScale: 0.50, v: 0.95 },
    { sScale: 0.75, v: 0.82 },
    { sScale: 1.00, v: 0.55 },
    { sScale: 1.00, v: 0.30 },
  ];
  const COLOR_PALETTE: string[][] = [
    ['#000000', '#1A1A1A', '#333333', '#4D4D4D', '#666666', '#808080', '#999999', '#B3B3B3', '#CCCCCC', '#FFFFFF'],
    ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'],
    ...SHADE_STOPS.map(stop =>
      COLUMN_HUES.map(({ h, sBase }) => hsvToHex(h, sBase * stop.sScale, stop.v)),
    ),
  ];

  // 'palette' = swatch grid; 'custom' = HSV picker dialog. Both live under `open`,
  // so the parent can close the whole popover via the bindable `open` prop.
  let view = $state<'palette' | 'custom'>('palette');
  // Seeded once from the prop (constant per instance); the user's later picks
  // own this value, so we read the initial prop without tracking it.
  let lastColor = $state<string>(untrack(() => defaultColor));
  const eyeDropperSupported =
    typeof window !== 'undefined' && 'EyeDropper' in window;
  let customSeed = $state('');
  let savedFrom: number | null = null;
  let savedTo: number | null = null;
  // The panels are `fixed` and placed from the button's rect, so a scrolling
  // ancestor (the style manager's field column) can't clip them.
  let split = $state<HTMLElement>();
  // …and they live in the top layer, whose containing block is the viewport whatever
  // sits above the button: a transform makes an ancestor the containing block for
  // `fixed`, and the floating table toolbar has one (it hangs itself above the table).
  const topLayer = (node: HTMLElement) => node.showPopover();
  let panel = $state<HTMLElement>();
  // `left` runs from the window's start side (`startEdge`).
  let pos = $state({ top: 0, left: 0 });
  const posSide = $derived(uiRtl() ? 'right' : 'left');

  async function placePanel() {
    const anchor = split?.getBoundingClientRect();
    if (!anchor) return;
    // A ribbon panel drops below the whole band, or it would cover the controls
    // under it. The modern toolbar has no band, so this finds nothing there.
    const band = split?.closest('.ribbon-body')?.getBoundingClientRect();
    pos = { top: Math.max(anchor.bottom, band?.bottom ?? 0) + 3, left: startEdge(anchor).offset };
    await tick();
    const box = panel?.getBoundingClientRect();
    if (!box) return;
    const dx = Math.max(0, uiRtl() ? 8 - box.left : box.right + 8 - window.innerWidth);
    const dy = Math.max(0, box.bottom + 8 - window.innerHeight);
    if (dx || dy) pos = { top: Math.max(8, pos.top - dy), left: Math.max(8, pos.left - dx) };
  }

  // The range to restore when applying. No editor (style manager) = no range.
  function takeRange(): { from: number; to: number } {
    const from = savedFrom ?? editor?.state.selection.from ?? 0;
    const to   = savedTo   ?? editor?.state.selection.to   ?? 0;
    savedFrom = null;
    savedTo   = null;
    return { from, to };
  }

  async function openPicker() {
    onOpen?.();
    savedFrom = editor?.state.selection.from ?? null;
    savedTo = editor?.state.selection.to ?? null;
    if (open) {
      open = false;
    } else {
      view = 'palette';
      open = true;
      await placePanel();
      // A dialog field hands the keyboard to the palette it opened.
      if (!icon) panel?.querySelector<HTMLElement>('.color-automatic')?.focus();
    }
  }

  function applyColor(color: string) {
    open = false;
    view = 'palette';
    lastColor = color;
    onApply(color, takeRange());
    refocus();
  }

  function quickApplyColor() {
    // Save selection here too because the main button doesn't go through openPicker.
    if (savedFrom === null && editor) {
      savedFrom = editor.state.selection.from;
      savedTo = editor.state.selection.to;
    }
    applyColor(lastColor);
  }

  function clearColor() {
    open = false;
    view = 'palette';
    onClear(takeRange());
    refocus();
  }

  async function openMoreColors() {
    customSeed = (currentColor && currentColor !== '') ? currentColor : lastColor;
    view = 'custom';
    await placePanel();
    panel?.querySelector<HTMLElement>('.custom-color-hex')?.focus();
  }

  function cancelMoreColors() {
    open = false;
    view = 'palette';
    refocus();
  }

  // A dialog field takes focus back once its panel closes; a toolbar button's command
  // returns it to the editor instead.
  function refocus() {
    if (!icon) queueMicrotask(() => split?.querySelector<HTMLElement>('.color-main')?.focus());
  }

  function onPaletteKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    cancelMoreColors();
  }

  async function pickFromPage() {
    open = false;
    view = 'palette';
    if (eyeDropperSupported) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await new (window as any).EyeDropper().open();
        applyColor(String(result.sRGBHex).toUpperCase());
      } catch {
        savedFrom = null;
        savedTo = null;
      }
      return;
    }
    startDomPickMode();
  }

  let domPickActive = $state(false);
  let hoveredEl: HTMLElement | null = null;
  let prevOutline = '';
  let prevOutlineOffset = '';

  function getEditorRoot(): HTMLElement | null {
    return (editor?.view?.dom as HTMLElement | undefined) ?? null;
  }

  function rgbToHex(rgb: string): string | null {
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(rgb);
    if (!m) return null;
    const hex = (n: number) =>
      Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return `#${hex(+m[1])}${hex(+m[2])}${hex(+m[3])}`.toUpperCase();
  }

  function setHover(el: HTMLElement) {
    if (hoveredEl === el) return;
    clearHover();
    hoveredEl = el;
    prevOutline = el.style.outline;
    prevOutlineOffset = el.style.outlineOffset;
    el.style.outline = '2px solid var(--color-primary)';
    el.style.outlineOffset = '-2px';
  }

  function clearHover() {
    if (!hoveredEl) return;
    hoveredEl.style.outline = prevOutline;
    hoveredEl.style.outlineOffset = prevOutlineOffset;
    hoveredEl = null;
  }

  function startDomPickMode() {
    const root = getEditorRoot();
    if (!root) return;
    domPickActive = true;
    root.style.cursor = 'crosshair';
    root.addEventListener('mousemove', onPickMove, true);
    root.addEventListener('mousedown', onPickMouseDown, true);
    window.addEventListener('keydown', onPickKey, true);
    window.addEventListener('mousedown', onOutsideMouseDown, true);
  }

  function stopDomPickMode() {
    if (!domPickActive) return;
    domPickActive = false;
    const root = getEditorRoot();
    if (root) {
      root.style.cursor = '';
      root.removeEventListener('mousemove', onPickMove, true);
      root.removeEventListener('mousedown', onPickMouseDown, true);
    }
    window.removeEventListener('keydown', onPickKey, true);
    window.removeEventListener('mousedown', onOutsideMouseDown, true);
    clearHover();
  }

  onDestroy(stopDomPickMode);

  function onPickMove(e: MouseEvent) {
    const t = e.target;
    if (t instanceof HTMLElement) setHover(t);
  }

  function onPickMouseDown(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const t = e.target;
    let hex: string | null = null;
    if (t instanceof HTMLElement) {
      hex = rgbToHex(window.getComputedStyle(t).color);
    }
    stopDomPickMode();
    if (hex) applyColor(hex);
    else { savedFrom = null; savedTo = null; }
  }

  function onPickKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    stopDomPickMode();
    savedFrom = null;
    savedTo = null;
  }

  function onOutsideMouseDown(e: MouseEvent) {
    const root = getEditorRoot();
    if (root && !root.contains(e.target as Node)) {
      stopDomPickMode();
      savedFrom = null;
      savedTo = null;
    }
  }

  function colorPickerClickOutside(node: HTMLElement) {
    function handler(e: MouseEvent) {
      if (!node.contains(e.target as Node)) {
        open = false;
        view = 'palette';
      }
    }
    window.addEventListener('mousedown', handler);
    return { destroy() { window.removeEventListener('mousedown', handler); } };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="color-picker" use:colorPickerClickOutside onkeydown={onPaletteKeydown}>
  <div class="color-split" bind:this={split}>
    <!-- A toolbar button re-applies its last colour and shows it; a dialog field is one
         value, so its swatch reads that value and every click opens the palette. -->
    <button class="color-main" class:swatch={!icon} onclick={icon ? quickApplyColor : openPicker} {title} {disabled}>
      {#if icon}{@render icon()}{/if}
      <span class="color-bar" style="background: {icon ? lastColor : (currentColor || defaultColor)}"></span>
    </button>
    <button class="color-chevron" onclick={openPicker} tabindex="-1" title={chevronTitle} {disabled}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  {#if open && view === 'palette'}
    <div class="color-dropdown" popover="manual" use:topLayer bind:this={panel} style="top: {pos.top}px; {posSide}: {pos.left}px">
      <div class="color-title">{title}</div>
      <button
        class="color-automatic"
        class:active={currentColor === null}
        onclick={clearColor}
      >{clearLabel ?? t().color.automatic}</button>
      <div class="color-grid">
        {#each COLOR_PALETTE as row}
          <div class="color-row">
            {#each row as c}
              <button
                class="color-cell"
                class:active={currentColor === c}
                style="background: {c}"
                title={c}
                onclick={() => applyColor(c)}
                aria-label={c}
              ></button>
            {/each}
          </div>
        {/each}
      </div>
      <div class="color-extras">
        <button class="color-more-trigger" onclick={openMoreColors}>{t().color.moreColors}</button>
        {#if editor || eyeDropperSupported}
        <button
          class="color-pipette-trigger"
          onclick={pickFromPage}
          title={t().color.pickFromPage}
          aria-label={t().color.pickFromPage}
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <g transform="rotate(-45 8 8)" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">
              <rect x="6.25" y="1.5" width="3.5" height="2.6" rx="1" fill="currentColor" stroke="none" />
              <rect x="5" y="4.2" width="6" height="1.6" rx="0.4" />
              <path d="M6.75 5.8 L6.75 11.4 L8 13.7 L9.25 11.4 L9.25 5.8 Z" />
            </g>
          </svg>
        </button>
        {/if}
      </div>
    </div>
  {/if}
  {#if open && view === 'custom'}
    <div class="color-window" role="dialog" aria-label={t().color.chooseColor}
      popover="manual" use:topLayer
      bind:this={panel} style="top: {pos.top}px; {posSide}: {pos.left}px">
      <CustomColorPanel color={customSeed} onConfirm={applyColor} onCancel={cancelMoreColors} />
    </div>
  {/if}
</div>

<style>
  .color-picker {
    position: relative;
  }

  .color-split {
    display: inline-flex;
    align-items: stretch;
    height: var(--toolbar-btn-size);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .color-split:hover {
    border-color: var(--color-primary);
  }

  .color-main {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    min-width: 1.7rem;
    height: 100%;
    padding: 0 0.35rem;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .color-main:hover {
    background: var(--color-btn-hover);
  }

  .color-bar {
    display: block;
    width: 14px;
    height: 3px;
    border-radius: 1px;
  }

  /* No glyph above it, so the bar is the button: a swatch, outlined so white still
     reads against the surface. */
  .color-main.swatch .color-bar {
    width: 22px;
    height: 14px;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  .color-split:has(button:disabled) { opacity: 0.5; }
  .color-split button:disabled { cursor: default; }

  .color-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    min-width: unset;
    height: 100%;
    padding: 0;
    border: none;
    border-inline-start: 1px solid var(--color-border);
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
  }

  .color-chevron:hover {
    background: var(--color-btn-hover);
  }

  /* A popover carries the UA's own centring (`inset: 0; margin: auto`), which would
     beat the top/left placed above. */
  .color-dropdown,
  .color-window {
    inset: auto;
    margin: 0;
    overflow: visible;
  }

  .color-dropdown {
    position: fixed;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .color-title {
    padding: 0.1rem 0.2rem 0.2rem;
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text);
    font-family: var(--font-sans);
    user-select: none;
  }

  .color-automatic {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: center;
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s;
  }

  .color-automatic:hover {
    background: var(--color-btn-hover);
  }

  /* Marked like a chosen swatch: a filled button would read as the color it applies. */
  .color-automatic.active {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .color-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .color-row {
    display: flex;
    gap: 2px;
  }

  .color-cell {
    width: 18px;
    height: 18px;
    min-width: unset;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
    transition: transform 0.05s;
  }

  .color-cell:hover {
    transform: scale(1.15);
  }

  .color-cell.active {
    outline: 2px solid var(--color-primary);
    outline-offset: 1px;
  }

  .color-more-trigger {
    display: block;
    width: 100%;
    padding: 0.35rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: var(--font-sans);
    text-align: center;
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s;
  }

  .color-more-trigger:hover {
    background: var(--color-btn-hover);
  }

  .color-extras {
    display: flex;
    gap: 4px;
  }

  .color-extras .color-more-trigger {
    flex: 1;
    width: auto;
  }

  .color-pipette-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s;
  }

  .color-pipette-trigger:hover {
    background: var(--color-btn-hover);
  }

  .color-window {
    position: fixed;
    width: 210px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
    z-index: 200;
  }

</style>
