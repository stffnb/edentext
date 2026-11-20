<script lang="ts">
  import { locale, t, startEdge, uiRtl } from '../i18n/i18n.svelte';
  import { parseSize, sizeLabel, sizeMenu } from '../utils/fontSize';

  // A font size in pt as the ribbon's size box offers one: its list, or a typed value in
  // the same 1–400 pt range. An empty field clears it (undefined); unreadable text keeps it.
  let { value, onChange, placeholder = '', style = '' }: {
    value: number | undefined; onChange: (pt: number | undefined) => void; placeholder?: string; style?: string;
  } = $props();

  let named = $derived(locale() === 'zh-Hans');
  let open = $state(false);
  let focused = $state(false);
  let text = $state('');
  let box = $state<HTMLElement>();
  let pos = $state({ top: 0, left: 0, width: 0 });

  const label = (pt: number | undefined) => (pt === undefined ? '' : sizeLabel(`${pt}pt`, named));

  $effect(() => {
    if (!focused && !open) text = label(value);
  });

  function parse(input: string): number | undefined {
    if (input.trim() === '') return undefined;
    return parseSize(input) ?? value;
  }

  function commit(pt: number | undefined) {
    open = false;
    text = label(pt);
    if (pt !== value) onChange(pt);
  }

  // Fixed in the top layer, so a dialog's scrolling field column can't clip it.
  const topLayer = (node: HTMLElement) => node.showPopover();
  function show() {
    const r = box?.getBoundingClientRect();
    if (!r) return;
    pos = { top: r.bottom + 3, left: startEdge(r).offset, width: r.width };
    open = true;
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
      text = label(value);
      input.blur();
    }
  }

  function clickOutside(node: HTMLElement) {
    const handler = (e: MouseEvent) => { if (open && !node.contains(e.target as Node)) open = false; };
    window.addEventListener('mousedown', handler);
    return { destroy: () => window.removeEventListener('mousedown', handler) };
  }
</script>

<div class="fs" {style} use:clickOutside>
  <div class="fs-box" bind:this={box}>
    <input
      type="text"
      inputmode="decimal"
      bind:value={text}
      {placeholder}
      title={t().toolbarExpanded.fontSize}
      aria-label={t().toolbarExpanded.fontSize}
      onfocus={(e) => { focused = true; show(); e.currentTarget.select(); }}
      onblur={() => { focused = false; commit(parse(text)); }}
      onkeydown={onKeydown}
    />
    <button class="fs-caret" tabindex="-1" title={t().toolbarExpanded.fontSizeList} aria-haspopup="menu" aria-expanded={open}
      onmousedown={(e) => e.preventDefault()} onclick={() => (open ? (open = false) : show())}>
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
        <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>
  {#if open}
    <div class="ribbon-menu fs-menu" role="menu" popover="manual" use:topLayer
      style="top: {pos.top}px; {uiRtl() ? 'right' : 'left'}: {pos.left}px; min-width: {pos.width}px">
      <div class="menu-scroll">
        {#each sizeMenu(named) as [name, pt]}
          <!-- mousedown keeps the input's focus, so its blur can't commit the typed text first. -->
          <button class:selected={pt === value} onmousedown={(e) => e.preventDefault()} onclick={() => commit(pt)}>{name}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .fs { flex: 1; min-width: 4.5rem; align-self: stretch; }
  .fs-box {
    display: flex;
    height: 100%;
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    overflow: hidden;
  }
  .fs-box:focus-within { border-color: var(--color-primary); }
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
  .fs-caret {
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
  .fs-caret:hover { background: var(--color-btn-hover); }
  .fs-menu { position: fixed; margin: 0; inset: auto; max-height: 320px; overflow: hidden; }
</style>
