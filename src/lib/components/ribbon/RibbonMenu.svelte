<script lang="ts">
  import type { Snippet } from 'svelte';
  import { anchored } from './menu.svelte';

  // Drops from the control that owns it, so the wrapper must be position: relative.
  // `align="right"` pins the right edges instead, for menus near the window edge.
  // The panel's own look lives in global.css — a caller's snippet is scoped to the
  // caller, not here.
  let { align = 'left', minWidth = 180, heading, children }: {
    align?: 'left' | 'right';
    minWidth?: number;
    heading?: string;
    children: Snippet;
  } = $props();
</script>

<div class="ribbon-menu" use:anchored={align} style="min-width: {minWidth}px" role="menu">
  {#if heading}<div class="rb-menu-label">{heading}</div>{/if}
  {@render children()}
</div>
