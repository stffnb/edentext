<script lang="ts">
  import type { Snippet } from 'svelte';

  // `onLauncher` renders Word's ↘ corner arrow, which opens the group's dialog.
  let { label, grow = false, onLauncher, launcherTitle, children }: {
    label: string;
    grow?: boolean;
    onLauncher?: () => void;
    launcherTitle?: string;
    children: Snippet;
  } = $props();
</script>

<div class="ribbon-group" class:grow>
  <div class="ribbon-group-items">{@render children()}</div>
  <div class="ribbon-group-foot">
    <span class="ribbon-group-label">{label}</span>
    {#if onLauncher}
      <button class="ribbon-launcher" onclick={onLauncher} title={launcherTitle ?? label} aria-label={launcherTitle ?? label}>
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
          <path d="M8 1v7H1" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6.6 6.6 3.2 3.2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .ribbon-group {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    padding: 2px 4px 0;
  }

  .ribbon-group.grow {
    flex: 1;
    min-width: 0;
  }

  .ribbon-group-items {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  /* Word's labelled group footer; the ↘ launcher sits at its right edge. */
  .ribbon-group-foot {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 15px;
  }

  .ribbon-group-label {
    font-family: var(--w-font);
    font-size: 11px;
    color: var(--w-text-dim);
    white-space: nowrap;
  }

  .ribbon-launcher {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: none;
    background: none;
    border-radius: 2px;
    color: var(--w-text-dim);
    cursor: pointer;
  }

  .ribbon-launcher:hover { background: var(--w-hover); color: var(--w-text); }
</style>
