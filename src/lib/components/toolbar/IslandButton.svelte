<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../ribbon/Icon.svelte';
  import type { IconName } from '../ribbon/icons';

  // One island toolbar button: an icon (or a snippet) with its name as the tooltip. A
  // `label` shows beside the glyph where an icon alone would not say enough.
  let { icon, content, label, title, cmd, active = false, disabled = false, caret = false, expanded = false, onclick }: {
    icon?: IconName;
    content?: Snippet;
    label?: string;
    title?: string;
    // The command search clicks the control by this id; see ribbon/commands.ts.
    cmd?: string;
    active?: boolean;
    disabled?: boolean;
    caret?: boolean;
    expanded?: boolean;
    onclick?: (e: MouseEvent) => void;
  } = $props();
</script>

<button
  class="ib"
  class:active
  class:open={expanded}
  {disabled}
  title={title ?? label}
  aria-label={label ? undefined : title}
  aria-pressed={caret ? undefined : active}
  aria-haspopup={caret ? 'menu' : undefined}
  aria-expanded={caret ? expanded : undefined}
  data-cmd={cmd}
  {onclick}
>
  {#if content}{@render content()}{:else if icon}<Icon name={icon} size={16} />{/if}
  {#if label}<span class="ib-label">{label}</span>{/if}
  {#if caret}
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  {/if}
</button>

<style>
  .ib {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-width: var(--toolbar-btn-size);
    height: var(--toolbar-btn-size);
    padding: 0 0.3rem;
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .ib:hover:not(:disabled),
  .ib.open {
    background: var(--color-btn-hover);
    border-color: var(--color-primary);
  }

  .ib.active {
    background: var(--color-primary);
    color: white;
  }

  .ib:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .ib-label { line-height: 1; }
</style>
