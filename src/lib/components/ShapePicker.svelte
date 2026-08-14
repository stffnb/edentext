<script lang="ts">
  import { SHAPES, shapePath, linePaths, isLineKind, type ShapeKind } from '../utils/shapes';
  import { t } from '../i18n/i18n.svelte';

  // The shape gallery, shared by the floating box toolbar and the ribbon's Shape tab.
  // Every tile is drawn from the same preset the editor and both exports use, so a
  // shape added to `utils/shapes.ts` needs no icon of its own.
  let { value, onPick, compact = false }: {
    value: ShapeKind;
    onPick: (k: ShapeKind) => void;
    compact?: boolean;
  } = $props();

  const KINDS = Object.keys(SHAPES) as ShapeKind[];
  let open = $state(false);
  let host = $state<HTMLElement | null>(null);

  const label = (k: ShapeKind) => t().textBox.shapes[k];

  function onWindowClick(e: MouseEvent) {
    if (open && host && !host.contains(e.target as HTMLElement)) open = false;
  }
</script>

<svelte:window onclick={onWindowClick} />

<div class="shape-picker" bind:this={host}>
  <button
    class="shape-btn"
    class:compact
    title={t().textBox.chooseShape}
    aria-label={t().textBox.chooseShape}
    aria-haspopup="true"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {@render tile(value)}
    <span class="chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="shape-menu" role="menu">
      {#each KINDS as k}
        <button
          class="shape-tile"
          class:active={value === k}
          role="menuitemradio"
          aria-checked={value === k}
          title={label(k)}
          aria-label={label(k)}
          onclick={() => { onPick(k); open = false; }}
        >
          {@render tile(k)}
        </button>
      {/each}
    </div>
  {/if}
</div>

{#snippet tile(k: ShapeKind)}
  <svg viewBox="0 0 100 100" fill="none" aria-hidden="true">
    {#if isLineKind(k)}
      <!-- The tile's box is square, so the heads keep their shape as drawn. -->
      {@const p = linePaths(k, 76, 76, true, 26)}
      <path d={p?.line} stroke="currentColor" stroke-width="7" transform="translate(12,12)" />
      {#each p?.heads ?? [] as d}
        <path {d} fill="currentColor" transform="translate(12,12)" />
      {/each}
    {:else if k === 'ellipse'}
      <ellipse cx="50" cy="50" rx="45" ry="35" stroke="currentColor" stroke-width="7" />
    {:else if k === 'roundRect'}
      <rect x="5" y="15" width="90" height="70" rx="18" stroke="currentColor" stroke-width="7" />
    {:else if k === 'textbox'}
      <rect x="5" y="15" width="90" height="70" stroke="currentColor" stroke-width="7" />
    {:else}
      <path d={shapePath(k)} stroke="currentColor" stroke-width="7" stroke-linejoin="round" />
    {/if}
  </svg>
{/snippet}

<style>
  .shape-picker { position: relative; display: inline-flex; }

  .shape-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 3px 4px;
    border: none;
    border-radius: 4px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .shape-btn:hover { background: var(--w-hover, rgba(0, 0, 0, 0.08)); }
  .shape-btn svg { width: 22px; height: 22px; }
  .shape-btn.compact svg { width: 18px; height: 18px; }
  .chevron { font-size: 9px; line-height: 1; }

  .shape-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 60;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 2px;
    padding: 6px;
    border: 1px solid var(--w-border, #d0d0d0);
    border-radius: 6px;
    background: var(--w-surface, #fff);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  }

  .shape-tile {
    display: inline-flex;
    padding: 5px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .shape-tile svg { width: 22px; height: 22px; }
  .shape-tile:hover { background: var(--w-hover, rgba(0, 0, 0, 0.08)); }
  .shape-tile.active { border-color: var(--accent, #3b82f6); }
</style>
