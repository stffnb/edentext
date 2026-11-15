<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '../i18n/i18n.svelte';

  // A line width in pt as the font size box offers one: the presets in a list, or a
  // typed value. With `none`, 'none' (an empty field or 0) draws no line; without it a
  // width is always kept. `style` sizes the box for its toolbar.
  // A typed width is clamped to min..max, by default the hairline to the 9pt LibreOffice's
  // border dialog allows, in 0.05pt steps; with unit '%' it is a whole percentage instead.
  // For another size than a line's, `title` names it and `lines` leaves the list's lines out.
  let { value, onChange, presets = [0.5, 0.75, 1, 1.5, 2.25], none = true, style = '', min = 0.05, max = 9, unit = 'pt', title, lines = unit === 'pt' }: {
    value: string; onChange: (width: string) => void; presets?: number[]; none?: boolean; style?: string; min?: number; max?: number;
    unit?: 'pt' | '%'; title?: string; lines?: boolean;
  } = $props();

  let open = $state(false);
  let focused = $state(false);
  let text = $state('');
  let box = $state<HTMLElement>();
  let pos = $state({ top: 0, left: 0, width: 0 });

  const label = (w: string) => (w === 'none' ? t().styles.noBorder : unit === '%' ? `${Number(w)}%` : t().borders.pt(Number(w)));
  const tip = $derived(title ?? t().borders.lineWidth);

  // A committed width shows until `value` moves: a caller may pass it back a frame later.
  let pending = $state<{ w: string; from: string } | null>(null);
  const shown = $derived(pending && pending.from === value ? pending.w : value);

  $effect(() => {
    if (!focused && !open) text = label(shown);
  });

  // An empty field or 0 is no line where there is one; anything unreadable keeps the width.
  function parse(input: string): string {
    const s = input.trim().replace(',', '.');
    const pt = s === '' ? 0 : parseFloat(s);
    if (!Number.isFinite(pt)) return shown;
    if (pt <= 0 && (s === '' || min > 0)) return none ? 'none' : shown;
    const steps = unit === '%' ? 1 : 20;
    return String(Math.round(Math.min(max, Math.max(min, pt)) * steps) / steps);
  }

  function commit(w: string) {
    open = false;
    text = label(w);
    if (w === shown) return;
    pending = { w, from: value };
    onChange(w);
  }

  // Fixed in the top layer, so the dialog's scrolling field column can't clip it.
  const topLayer = (node: HTMLElement) => node.showPopover();
  async function show() {
    const r = box?.getBoundingClientRect();
    if (!r) return;
    pos = { top: r.bottom + 3, left: r.left, width: r.width };
    open = true;
    await tick();
  }

  function onKeydown(e: KeyboardEvent) {
    const input = e.currentTarget as HTMLInputElement;
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(parse(text));
      input.blur();
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      text = label(shown);
      input.blur();
    }
  }

  function clickOutside(node: HTMLElement) {
    const handler = (e: MouseEvent) => { if (open && !node.contains(e.target as Node)) open = false; };
    window.addEventListener('mousedown', handler);
    return { destroy: () => window.removeEventListener('mousedown', handler) };
  }
</script>

<div class="bw" {style} use:clickOutside>
  <div class="bw-box" bind:this={box}>
    <input
      type="text"
      inputmode="decimal"
      bind:value={text}
      title={tip}
      onfocus={(e) => { focused = true; show(); e.currentTarget.select(); }}
      onblur={() => { focused = false; commit(parse(text)); }}
      onkeydown={onKeydown}
    />
    <button class="bw-caret" tabindex="-1" title={tip} aria-haspopup="menu" aria-expanded={open}
      onmousedown={(e) => e.preventDefault()} onclick={() => (open ? (open = false) : show())}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  {#if open}
    <div class="ribbon-menu bw-menu" role="menu" popover="manual" use:topLayer
      style="top: {pos.top}px; left: {pos.left}px; min-width: {pos.width}px">
      {#each [...(none ? ['none'] : []), ...presets.map(String)] as w}
        <!-- mousedown keeps the input's focus, so its blur can't commit the typed text first. -->
        <button class:selected={w === shown} onmousedown={(e) => e.preventDefault()} onclick={() => commit(w)}>
          {#if lines}<span class="bw-line" style="height: {w === 'none' ? 0 : Math.max(1, Math.round((Number(w) * 96) / 72))}px"></span>{/if}
          {label(w)}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .bw { flex: 1; min-width: 4.5rem; align-self: stretch; }
  .bw-box {
    display: flex;
    height: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
  }
  .bw-box:focus-within { border-color: var(--color-primary); }
  /* No intrinsic width, or the input's default size widens the dialog's grid column. */
  input {
    flex: 1;
    width: 0;
    min-width: 0;
    font: inherit;
    font-size: 0.85rem;
    padding: 0.25rem 0.35rem;
    border: none;
    background: none;
    color: var(--color-text);
  }
  input:focus { outline: none; }
  .bw-caret {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .bw-caret:hover { background: var(--color-btn-hover); }
  .bw-menu { position: fixed; margin: 0; inset: auto; }
  /* The line each width draws, as the panels' width buttons showed it. */
  .bw-line { flex: none; width: 2rem; background: currentColor; }
</style>
