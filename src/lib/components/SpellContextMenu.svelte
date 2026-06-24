<script lang="ts">
  let {
    top,
    left,
    suggestions,
    onReplace,
    onAdd,
    onIgnore,
    onClose,
  }: {
    top: number;
    left: number;
    suggestions: string[];
    onReplace: (word: string) => void;
    onAdd: () => void;
    onIgnore: () => void;
    onClose: () => void;
  } = $props();

  let menuEl: HTMLDivElement | undefined = $state();

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
</script>

<div
  bind:this={menuEl}
  class="spell-menu"
  style="top: {top}px; left: {left}px;"
  role="menu"
  tabindex="-1"
  aria-label="Spelling suggestions"
>
  {#if suggestions.length}
    {#each suggestions as s}
      <button class="sm-item sm-suggest" role="menuitem" onclick={() => onReplace(s)}>{s}</button>
    {/each}
  {:else}
    <span class="sm-empty">No suggestions</span>
  {/if}
  <span class="sm-sep"></span>
  <button class="sm-item" role="menuitem" onclick={onAdd}>Add to Dictionary</button>
  <button class="sm-item" role="menuitem" onclick={onIgnore}>Ignore All</button>
</div>

<style>
  .spell-menu {
    position: absolute;
    z-index: 200;
    min-width: 11rem;
    max-height: 18rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
    font-family: var(--font-sans);
    font-size: 0.8125rem;
    /* Sibling of the zoomed .paper, so it renders constant-size regardless of zoom. */
  }

  .sm-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 4px 10px;
    border: none;
    border-radius: calc(var(--radius) - 2px);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s;
  }

  .sm-item:hover {
    background: var(--color-btn-hover);
  }

  .sm-suggest {
    font-weight: 600;
  }

  .sm-empty {
    padding: 4px 10px;
    color: var(--color-text-muted, #888);
    font-style: italic;
  }

  .sm-sep {
    height: 1px;
    margin: 4px 2px;
    background: var(--color-border);
  }
</style>
