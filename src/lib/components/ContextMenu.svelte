<script lang="ts">
  import type { MenuEntry } from '../editor/contextMenuItems';

  let {
    top,
    left,
    items,
    onClose,
  }: {
    top: number;
    left: number;
    items: MenuEntry[];
    onClose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();
  // Flips set after measuring: the menu opens up/left when it would leave the viewport.
  let flipX = $state(false);
  let flipY = $state(false);

  function activate(entry: Extract<MenuEntry, { kind: 'item' }>) {
    if (entry.disabled) return;
    onClose();
    entry.run();
  }

  // Dismiss on outside click or Escape (standard context-menu behaviour).
  $effect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuEl && !menuEl.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  });

  // Keep the panel inside the window; a right-click near an edge otherwise opens a menu
  // that runs off-screen. Measured from the layout box (offset*), not getBoundingClientRect,
  // so the flip transform below can't feed back into the next measurement.
  $effect(() => {
    void [top, left, items];
    if (!menuEl) return;
    const parent = menuEl.offsetParent as HTMLElement | null;
    const pr = parent?.getBoundingClientRect();
    const x = (pr?.left ?? 0) + menuEl.offsetLeft - (parent?.scrollLeft ?? 0);
    const y = (pr?.top ?? 0) + menuEl.offsetTop - (parent?.scrollTop ?? 0);
    flipX = x + menuEl.offsetWidth > window.innerWidth - 4;
    flipY = y + menuEl.offsetHeight > window.innerHeight - 4;
    menuEl.focus({ preventScroll: true });
  });

  // Roving focus with the arrow keys, as in a native menu.
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(menuEl?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }
</script>

<div
  bind:this={menuEl}
  class="cm-menu"
  class:flip-x={flipX}
  class:flip-y={flipY}
  style="top: {top}px; left: {left}px;"
  role="menu"
  tabindex="-1"
  onkeydown={onKeydown}
>
  {#each items as entry}
    {#if entry.kind === 'sep'}
      <span class="cm-sep"></span>
    {:else}
      <button
        class="cm-item"
        class:strong={entry.strong}
        role="menuitem"
        disabled={entry.disabled}
        onclick={() => activate(entry)}
      >
        <span class="cm-label">{entry.label}</span>
        {#if entry.hint}<span class="cm-hint">{entry.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  /* Sibling of the zoomed .paper, so the menu renders constant-size regardless of zoom. */
  .cm-menu {
    position: absolute;
    z-index: 200;
    min-width: 13rem;
    padding: 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    font-family: var(--font-sans);
    font-size: 0.8125rem;
  }

  .cm-menu.flip-x { transform: translateX(-100%); }
  .cm-menu.flip-y { transform: translateY(-100%); }
  .cm-menu.flip-x.flip-y { transform: translate(-100%, -100%); }

  .cm-item {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    width: 100%;
    padding: 4px 10px;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }

  .cm-item:hover:not(:disabled),
  .cm-item:focus-visible {
    background: var(--color-btn-hover);
    outline: none;
  }

  /* Spelling suggestions, as in the old spell menu. */
  .cm-item.strong { font-weight: 600; }

  .cm-item:disabled {
    color: var(--color-text-muted, #888);
    cursor: default;
  }

  .cm-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cm-hint {
    color: var(--color-text-muted, #888);
    font-size: 0.75rem;
  }

  .cm-sep {
    display: block;
    height: 1px;
    margin: 4px 2px;
    background: var(--color-border);
  }
</style>
