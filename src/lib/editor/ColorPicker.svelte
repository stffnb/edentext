<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import type { Snippet } from 'svelte';
  import { onDestroy, untrack } from 'svelte';

  let {
    editor,
    currentColor,
    defaultColor,
    title,
    chevronTitle,
    clearLabel = 'Automatic',
    open = $bindable(false),
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
    onApply: (color: string, range: { from: number; to: number }) => void;
    onClear: (range: { from: number; to: number }) => void;
    onOpen?: () => void;
    icon: Snippet;
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
  let pickerH = $state<number>(0);
  let pickerS = $state<number>(1);
  let pickerV = $state<number>(0.75);
  let stagedColor = $derived(hsvToHex(pickerH, pickerS, pickerV));
  let savedFrom: number | null = null;
  let savedTo: number | null = null;

  function clamp01(n: number): number {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  function hsvToHex(h: number, s: number, v: number): string {
    const c = v * s;
    const hh = ((h % 360) + 360) % 360 / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (hh < 1)      { r = c; g = x; b = 0; }
    else if (hh < 2) { r = x; g = c; b = 0; }
    else if (hh < 3) { r = 0; g = c; b = x; }
    else if (hh < 4) { r = 0; g = x; b = c; }
    else if (hh < 5) { r = x; g = 0; b = c; }
    else             { r = c; g = 0; b = x; }
    const m = v - c;
    const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
  }

  function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
    const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const r = parseInt(m[1].slice(0, 2), 16) / 255;
    const g = parseInt(m[1].slice(2, 4), 16) / 255;
    const b = parseInt(m[1].slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r)      h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else                h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
  }

  function openPicker() {
    if (!editor) return;
    onOpen?.();
    savedFrom = editor.state.selection.from;
    savedTo = editor.state.selection.to;
    if (open) {
      open = false;
    } else {
      view = 'palette';
      open = true;
    }
  }

  function applyColor(color: string) {
    if (!editor) return;
    open = false;
    view = 'palette';
    lastColor = color;
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    onApply(color, { from, to });
  }

  function quickApplyColor() {
    if (!editor) return;
    // Save selection here too because the main button doesn't go through openPicker.
    if (savedFrom === null) {
      savedFrom = editor.state.selection.from;
      savedTo = editor.state.selection.to;
    }
    applyColor(lastColor);
  }

  function clearColor() {
    if (!editor) return;
    open = false;
    view = 'palette';
    const from = savedFrom ?? editor.state.selection.from;
    const to   = savedTo   ?? editor.state.selection.to;
    savedFrom = null;
    savedTo   = null;
    onClear({ from, to });
  }

  function openMoreColors() {
    const seed = (currentColor && currentColor !== '') ? currentColor : lastColor;
    const hsv = hexToHsv(seed) ?? { h: 0, s: 1, v: 0.75 };
    pickerH = hsv.h;
    pickerS = hsv.s;
    pickerV = hsv.v;
    view = 'custom';
  }

  function confirmMoreColors() {
    applyColor(stagedColor);
  }

  function cancelMoreColors() {
    open = false;
    view = 'palette';
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

  function onSvPointerDown(e: PointerEvent) {
    // Keep the editor's text selection visible by stopping the browser from
    // shifting focus / collapsing the selection on this click.
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const update = (ev: PointerEvent) => {
      pickerS = clamp01((ev.clientX - rect.left) / rect.width);
      pickerV = clamp01(1 - (ev.clientY - rect.top) / rect.height);
    };
    el.setPointerCapture(e.pointerId);
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onHuePointerDown(e: PointerEvent) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const update = (ev: PointerEvent) => {
      pickerH = clamp01((ev.clientY - rect.top) / rect.height) * 360;
    };
    el.setPointerCapture(e.pointerId);
    update(e);
    const move = (ev: PointerEvent) => update(ev);
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onHexInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    const hsv = hexToHsv(value);
    if (!hsv) return;
    pickerH = hsv.h;
    pickerS = hsv.s;
    pickerV = hsv.v;
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

<div class="color-picker" use:colorPickerClickOutside>
  <div class="color-split">
    <button class="color-main" onclick={quickApplyColor} {title}>
      {@render icon()}
      <span class="color-bar" style="background: {lastColor}"></span>
    </button>
    <button class="color-chevron" onclick={openPicker} tabindex="-1" title={chevronTitle}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  {#if open && view === 'palette'}
    <div class="color-dropdown">
      <button
        class="color-automatic"
        class:active={currentColor === null}
        onclick={clearColor}
      >{clearLabel}</button>
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
        <button class="color-more-trigger" onclick={openMoreColors}>More colors…</button>
        <button
          class="color-pipette-trigger"
          onclick={pickFromPage}
          title="Pick a color from the page"
          aria-label="Pick a color from the page"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <g transform="rotate(-45 8 8)" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round">
              <rect x="6.25" y="1.5" width="3.5" height="2.6" rx="1" fill="currentColor" stroke="none" />
              <rect x="5" y="4.2" width="6" height="1.6" rx="0.4" />
              <path d="M6.75 5.8 L6.75 11.4 L8 13.7 L9.25 11.4 L9.25 5.8 Z" />
            </g>
          </svg>
        </button>
      </div>
    </div>
  {/if}
  {#if open && view === 'custom'}
    <div class="color-window" role="dialog" aria-label="Choose color">
      <div class="color-window-body">
        <div
          class="sv-square"
          style="--hue: {pickerH}"
          onpointerdown={onSvPointerDown}
          role="presentation"
        >
          <div class="sv-thumb" style="left: {pickerS * 100}%; top: {(1 - pickerV) * 100}%"></div>
        </div>
        <div
          class="hue-slider"
          onpointerdown={onHuePointerDown}
          role="presentation"
        >
          <div class="hue-thumb" style="top: {(pickerH / 360) * 100}%"></div>
        </div>
      </div>
      <div class="color-window-readout">
        <span class="color-window-swatch" style="background: {stagedColor}"></span>
        <input class="color-window-hex" type="text" value={stagedColor} oninput={onHexInput} maxlength="7" />
      </div>
      <div class="color-more-actions">
        <button class="color-cancel" onclick={cancelMoreColors}>Cancel</button>
        <button class="color-confirm" onclick={confirmMoreColors}>OK</button>
      </div>
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
    height: 2rem;
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

  .color-chevron {
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

  .color-chevron:hover {
    background: var(--color-btn-hover);
  }

  .color-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
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

  .color-automatic.active {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
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
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
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

  .color-window-body {
    display: flex;
    gap: 8px;
  }

  .sv-square {
    position: relative;
    width: 160px;
    height: 160px;
    cursor: crosshair;
    border: 1px solid var(--color-border);
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, hsl(var(--hue, 0), 100%, 50%));
    touch-action: none;
  }

  .sv-thumb {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .hue-slider {
    position: relative;
    width: 18px;
    height: 160px;
    cursor: pointer;
    border: 1px solid var(--color-border);
    background: linear-gradient(
      to bottom,
      #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%
    );
    touch-action: none;
  }

  .hue-thumb {
    position: absolute;
    left: -3px;
    width: 22px;
    height: 6px;
    border: 1px solid white;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
    transform: translateY(-50%);
    pointer-events: none;
  }

  .color-window-readout {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .color-window-swatch {
    display: block;
    width: 28px;
    height: 24px;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    flex-shrink: 0;
  }

  .color-window-hex {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 0.4rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.8rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    outline: none;
  }

  .color-window-hex:focus {
    border-color: var(--color-primary);
  }

  .color-more-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .color-confirm,
  .color-cancel {
    padding: 0.25rem 0.6rem;
    border-radius: calc(var(--radius) - 2px);
    font-size: 0.75rem;
    font-family: var(--font-sans);
    cursor: pointer;
    min-width: unset;
    height: auto;
    transition: background 0.1s, border-color 0.15s;
  }

  .color-cancel {
    border: 1px solid var(--color-border);
    background: transparent;
    color: var(--color-text);
  }

  .color-cancel:hover {
    background: var(--color-btn-hover);
  }

  .color-confirm {
    border: 1px solid var(--color-primary);
    background: var(--color-primary);
    color: white;
  }

  .color-confirm:hover {
    filter: brightness(1.1);
  }
</style>
