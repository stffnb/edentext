<script lang="ts" module>
  import type { MenuEntry } from '../editor/contextMenuItems';
  import { PANE_SIZES, type PaneLayout } from '../storage/panes.svelte';
  import { t } from '../i18n/i18n.svelte';

  /** The entries every docked pane's options menu ends with: text size and side. */
  export function layoutItems(layout: PaneLayout, set: (patch: Partial<PaneLayout>) => void): MenuEntry[] {
    const p = t().pane;
    return [
      { kind: 'sub', label: p.textSize, items: PANE_SIZES.map((s) => ({ kind: 'item', label: p[s], checked: layout.size === s, run: () => set({ size: s }) })) },
      { kind: 'sub', label: p.dock, items: (['left', 'right'] as const).map((s) => ({ kind: 'item', label: s === 'left' ? p.dockLeft : p.dockRight, checked: layout.side === s, run: () => set({ side: s }) })) },
    ];
  }
</script>

<script lang="ts">
  import ContextMenu from './ContextMenu.svelte';

  // A docked pane's options button and the menu it opens, placed in the window so the
  // pane's scroller cannot clip it; on the pane's inner side, toward the page.
  let { label, left = false, items }: {
    label: string;
    left?: boolean;
    items: () => MenuEntry[];
  } = $props();

  let menu = $state<{ items: MenuEntry[]; x: number; y: number } | null>(null);
  let button: HTMLButtonElement | undefined = $state();
  let closedAt = 0;

  function close() {
    // A press on the button closes the menu ahead of its own click, which must not reopen it.
    if (button?.matches(':hover')) closedAt = performance.now();
    menu = null;
    // Escape hands focus back to the button; a command has moved it on.
    queueMicrotask(() => { if (!document.activeElement || document.activeElement === document.body) button?.focus(); });
  }

  function toggle() {
    if (menu || performance.now() - closedAt < 300 || !button) { menu = null; return; }
    const box = button.getBoundingClientRect();
    menu = { items: items(), x: left ? box.left : box.right - 208, y: box.bottom + 2 };
  }
</script>

<button class="pane-options" class:open={!!menu} bind:this={button} onclick={toggle} aria-haspopup="menu" aria-expanded={!!menu} aria-label={label} title={label}>
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 3.5h10M2 7h10M2 10.5h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="5" cy="3.5" r="1.5" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.2"/><circle cx="9.5" cy="7" r="1.5" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="10.5" r="1.5" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.2"/></svg>
</button>
{#if menu}
  <div class="menu-layer">
    <ContextMenu top={menu.y} left={menu.x} items={menu.items} onClose={close} />
  </div>
{/if}

<style>
  .pane-options {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
  }
  .pane-options:hover, .pane-options.open { background: var(--color-btn-hover); color: var(--color-text); }

  .menu-layer { position: fixed; inset: 0; z-index: 300; pointer-events: none; }
  .menu-layer :global(.cm-menu) { pointer-events: auto; }
</style>
