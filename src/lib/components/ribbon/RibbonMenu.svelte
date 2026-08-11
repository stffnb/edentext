<script lang="ts">
  import type { Snippet } from 'svelte';

  // Drops from the control that owns it; the wrapper must be position: relative.
  // `align="right"` pins the right edges instead, for menus near the window edge.
  let { align = 'left', minWidth = 180, heading, children }: {
    align?: 'left' | 'right';
    minWidth?: number;
    heading?: string;
    children: Snippet;
  } = $props();
</script>

<div class="ribbon-menu" class:right={align === 'right'} style="min-width: {minWidth}px" role="menu">
  {#if heading}<div class="ribbon-menu-heading">{heading}</div>{/if}
  {@render children()}
</div>

<style>
  .ribbon-menu {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    padding: 5px;
    background: var(--w-surface);
    border: 1px solid var(--w-border-strong);
    border-radius: 6px;
    box-shadow: var(--w-menu-shadow);
    font-family: var(--w-font);
    color: var(--w-text);
  }

  .ribbon-menu.right {
    left: auto;
    right: 0;
  }

  .ribbon-menu-heading {
    padding: 4px 12px 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--w-text-tertiary);
    user-select: none;
  }
</style>
