<script lang="ts" module>
  export function hsvToHex(h: number, s: number, v: number): string {
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

  function clamp01(n: number): number {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '../i18n/i18n.svelte';

  // The custom colour panel: HSV square, hue strip, typed value, OK/Cancel. ColorPicker
  // shows it in its own window; a menu or dialog with no room for a popover embeds it.
  let { color, onConfirm, onCancel, onInput }: {
    color: string;
    onConfirm: (hex: string) => void;
    onCancel: () => void;
    // Called with every staged change, for a caller that previews live.
    onInput?: (hex: string) => void;
  } = $props();

  const seed = untrack(() => hexToHsv(color)) ?? { h: 0, s: 1, v: 0.75 };
  let pickerH = $state(seed.h);
  let pickerS = $state(seed.s);
  let pickerV = $state(seed.v);
  let stagedColor = $derived(hsvToHex(pickerH, pickerS, pickerV));
  // Notation of the readout field only — the applied value stays #RRGGBB (ODF).
  let notation = $state<'hex' | 'rgb' | 'hsl'>('hex');
  let stagedText = $derived(formatColor(pickerH, pickerS, pickerV, notation));

  function stage(hsv: { h: number; s: number; v: number }) {
    pickerH = hsv.h;
    pickerS = hsv.s;
    pickerV = hsv.v;
    onInput?.(hsvToHex(hsv.h, hsv.s, hsv.v));
  }

  function formatColor(h: number, s: number, v: number, f: typeof notation): string {
    const hex = hsvToHex(h, s, v);
    if (f === 'hex') return hex;
    if (f === 'rgb') {
      const n = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
      return `${n(0)}, ${n(1)}, ${n(2)}`;
    }
    // Integer hsl like CSS: retyping the shown value can shift a channel by up to 4/255.
    const l = v * (1 - s / 2);
    const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
    return `${Math.round(h)}, ${Math.round(sl * 100)}, ${Math.round(l * 100)}`;
  }

  // Bare values in the shown notation ("192, 0, 0"); any separator, and a pasted
  // "rgb(192, 0, 0)" or "#" work too, since only the numbers are read.
  function parseColor(text: string, f: typeof notation): { h: number; s: number; v: number } | null {
    if (f === 'hex') {
      const hex = text.trim().replace(/^#?/, '#');
      return hexToHsv(hex);
    }
    const n = text.match(/[\d.]+/g)?.map(Number);
    if (!n || n.length < 3 || n.some(isNaN)) return null;
    if (f === 'rgb') {
      const byte = (x: number) =>
        Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
      return hexToHsv(`#${byte(n[0])}${byte(n[1])}${byte(n[2])}`);
    }
    const l = clamp01(n[2] / 100);
    const sl = clamp01(n[1] / 100);
    const v = l + sl * Math.min(l, 1 - l);
    return { h: n[0], s: v === 0 ? 0 : 2 * (1 - l / v), v };
  }

  // Drags update while the pointer is held; preventDefault keeps the editor's selection.
  function drag(e: PointerEvent, update: (x: number, y: number) => void) {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const at = (ev: PointerEvent) =>
      update(clamp01((ev.clientX - rect.left) / rect.width), clamp01((ev.clientY - rect.top) / rect.height));
    el.setPointerCapture(e.pointerId);
    at(e);
    const up = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener('pointermove', at);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', at);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onHexInput(e: Event) {
    const hsv = parseColor((e.target as HTMLInputElement).value, notation);
    if (hsv) stage(hsv);
  }

  // Enter takes the colour, Escape drops it, without reaching an enclosing menu or dialog.
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Enter') onConfirm(stagedColor);
    else onCancel();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="custom-color" onkeydown={onKeydown}>
  <div class="custom-color-body">
    <div class="sv-square" style="--hue: {pickerH}" role="presentation"
      onpointerdown={(e) => drag(e, (x, y) => stage({ h: pickerH, s: x, v: 1 - y }))}>
      <div class="sv-thumb" style="left: {pickerS * 100}%; top: {(1 - pickerV) * 100}%"></div>
    </div>
    <div class="hue-slider" role="presentation"
      onpointerdown={(e) => drag(e, (_, y) => stage({ h: y * 360, s: pickerS, v: pickerV }))}>
      <div class="hue-thumb" style="top: {(pickerH / 360) * 100}%"></div>
    </div>
  </div>
  <div class="custom-color-readout">
    <span class="custom-color-swatch" style="background: {stagedColor}"></span>
    <select class="custom-color-notation" bind:value={notation} aria-label="Format">
      <option value="hex">HEX</option>
      <option value="rgb">RGB</option>
      <option value="hsl">HSL</option>
    </select>
    <input class="custom-color-hex" type="text" value={stagedText} aria-label={t().color.chooseColor} oninput={onHexInput} />
  </div>
  <div class="custom-color-actions">
    <button class="color-cancel" onclick={onCancel}>{t().common.cancel}</button>
    <button class="color-confirm" onclick={() => onConfirm(stagedColor)}>{t().common.ok}</button>
  </div>
</div>

<style>
  .custom-color {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 192px;
  }

  .custom-color-body {
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

  .custom-color-readout {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .custom-color-swatch {
    display: block;
    width: 28px;
    height: 24px;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    flex-shrink: 0;
  }

  .custom-color-hex {
    flex: 1;
    width: auto;
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

  .custom-color-hex:focus {
    border-color: var(--color-primary);
  }

  .custom-color-notation {
    height: 24px;
    padding: 0 0.1rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    background: var(--color-surface);
    color: var(--color-text);
    font-size: 0.7rem;
    font-family: var(--font-sans);
    cursor: pointer;
    flex-shrink: 0;
  }

  .custom-color-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
  }

  .color-confirm,
  .color-cancel {
    width: auto;
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
