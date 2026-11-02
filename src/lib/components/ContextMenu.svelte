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
  // The one open submenu, by index in items; it opens left or up when it would leave the window.
  let openSub = $state<number | null>(null);
  let subEl: HTMLDivElement | undefined = $state();
  let subLeft = $state(false);
  let subUp = $state(false);

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

  // Measured against the trigger, which the flip classes do not move.
  $effect(() => {
    if (!subEl) return;
    const trigger = subEl.parentElement!.getBoundingClientRect();
    subLeft = trigger.right + subEl.offsetWidth > window.innerWidth - 4;
    subUp = trigger.top + subEl.offsetHeight > window.innerHeight - 4;
  });

  const hasChecks = (list: MenuEntry[]) => list.some((e) => e.kind === 'item' && e.checked !== undefined);

  function showSub(i: number, focus: boolean) {
    const entry = items[i];
    openSub = entry.kind === 'sub' && !entry.disabled ? i : null;
    if (focus) queueMicrotask(() => subEl?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus());
  }

  // Roving focus with the arrow keys within the focused panel, as in a native menu;
  // right opens a submenu, left goes back to its trigger.
  function onKeydown(e: KeyboardEvent) {
    const focused = document.activeElement as HTMLElement | null;
    const panel = focused?.closest<HTMLElement>('[role=menu]') ?? menuEl;
    if (e.key === 'ArrowRight' && focused?.dataset.sub) {
      e.preventDefault();
      showSub(Number(focused.dataset.sub), true);
      return;
    }
    if (e.key === 'ArrowLeft' && panel && panel === subEl) {
      e.preventDefault();
      (panel.previousElementSibling as HTMLElement | null)?.focus();
      openSub = null;
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(panel?.querySelectorAll<HTMLButtonElement>(':scope > button:not([disabled]), :scope > .cm-subwrap > button:not([disabled])') ?? []);
    const i = buttons.indexOf(focused as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  }
</script>

<div
  bind:this={menuEl}
  class="cm-menu"
  class:flip-x={flipX}
  class:flip-y={flipY}
  class:checks={hasChecks(items)}
  style="top: {top}px; left: {left}px;"
  role="menu"
  tabindex="-1"
  onkeydown={onKeydown}
>
  {#each items as entry, i}
    {#if entry.kind === 'sep'}
      <span class="cm-sep"></span>
    {:else if entry.kind === 'sub'}
      <div class="cm-subwrap">
        <button
          class="cm-item"
          class:open={openSub === i}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openSub === i}
          aria-disabled={entry.disabled}
          title={entry.title}
          data-sub={i}
          onpointerenter={() => showSub(i, false)}
          onclick={() => showSub(i, true)}
        >
          <span class="cm-label">{entry.label}</span>
          <svg class="cm-hint" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><path d="M2.5 1l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
        {#if openSub === i}
          <div bind:this={subEl} class="cm-menu cm-sub" class:checks={hasChecks(entry.items)} class:left={subLeft} class:up={subUp} role="menu" tabindex="-1">
            {#each entry.items as sub}
              {#if sub.kind === 'item'}{@render item(sub)}{:else if sub.kind === 'sep'}<span class="cm-sep"></span>{/if}
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      {@render item(entry, () => (openSub = null))}
    {/if}
  {/each}
</div>

{#snippet item(entry: Extract<MenuEntry, { kind: 'item' }>, onenter?: () => void)}
  <button
    class="cm-item"
    class:strong={entry.strong}
    role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
    aria-checked={entry.checked}
    disabled={entry.disabled}
    onpointerenter={onenter}
    onclick={() => activate(entry)}
  >
    {#if entry.checked}<svg class="cm-check" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
    <span class="cm-label">{entry.label}</span>
    {#if entry.hint}<span class="cm-hint">{entry.hint}</span>{/if}
  </button>
{/snippet}

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

  /* A panel with a checkable entry keeps a column for the tick, so its labels align. */
  .cm-menu.checks > .cm-item, .cm-menu.checks > .cm-subwrap > .cm-item { position: relative; padding-left: 26px; }
  .cm-check { position: absolute; left: 9px; color: var(--color-primary); }

  .cm-subwrap { position: relative; }
  .cm-sub { top: -5px; left: 100%; }
  .cm-sub.left { left: auto; right: 100%; }
  .cm-sub.up { top: auto; bottom: -5px; }

  .cm-item:hover:not(:disabled, [aria-disabled='true']),
  .cm-item.open,
  .cm-item:focus-visible {
    background: var(--color-btn-hover);
    outline: none;
  }

  /* Spelling suggestions, as in the old spell menu. */
  .cm-item.strong { font-weight: 600; }

  .cm-item:disabled,
  .cm-item[aria-disabled='true'] {
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
