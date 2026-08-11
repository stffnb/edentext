<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  // `caret` welds a second button to the right that opens a menu — Word's split
  // button. Without `onCaret` the caret is decorative and the whole control opens.
  let {
    icon,
    content,
    label,
    title,
    variant = 'icon',
    active = false,
    disabled = false,
    caret = false,
    caretTitle,
    caretActive = false,
    onclick,
    onCaret,
  }: {
    icon?: IconName;
    content?: Snippet;
    label?: string;
    title?: string;
    variant?: 'big' | 'small' | 'icon';
    active?: boolean;
    disabled?: boolean;
    caret?: boolean;
    caretTitle?: string;
    caretActive?: boolean;
    onclick?: () => void;
    onCaret?: () => void;
  } = $props();

  const ICON_SIZE = { big: 28, small: 14, icon: 20 } as const;
</script>

{#snippet face()}
  <span class="rb-face">
    {#if content}{@render content()}
    {:else if icon}<Icon name={icon} size={ICON_SIZE[variant]} />{/if}
    {#if caret && !onCaret}
      <Icon name="chevronDown" size={10} />
    {/if}
  </span>
  {#if label && variant !== 'icon'}<span class="rb-label">{label}</span>{/if}
{/snippet}

{#if caret && onCaret}
  <span class="rb-split" class:rb-split-active={active || caretActive}>
    <button class="rb rb-{variant}" class:active {disabled} {title} {onclick}>
      {@render face()}
    </button>
    <button
      class="rb-caret"
      class:active={caretActive}
      {disabled}
      title={caretTitle ?? title}
      aria-haspopup="menu"
      aria-expanded={caretActive}
      onclick={onCaret}
    >
      <Icon name="chevronDown" size={10} />
    </button>
  </span>
{:else}
  <button class="rb rb-{variant}" class:active {disabled} {title} {onclick}>
    {@render face()}
  </button>
{/if}

<style>
  .rb {
    display: flex;
    align-items: center;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--w-text);
    font-family: var(--w-font);
    font-size: 12px;
    white-space: nowrap;
    cursor: pointer;
  }

  .rb:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .rb-face {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }

  /* Icon over label. The hover tint paints the icon box, not the whole button —
     Word's signature, and what keeps a labelled column from looking like a slab. */
  .rb-big {
    flex-direction: column;
    gap: 4px;
    padding: 4px 7px 6px;
  }

  .rb-big .rb-face {
    align-self: stretch;
    min-height: 28px;
    flex: 1;
    border-radius: 4px;
    padding: 3px 4px;
    margin: 0 -4px;
  }

  .rb-big:hover:not(:disabled) .rb-face { background: var(--w-hover); }
  .rb-big:active:not(:disabled) .rb-face { background: var(--w-pressed); }
  .rb-big.active .rb-face { background: var(--w-active); }

  /* A row in a stacked mini-column (Cut / Copy under a big Paste). */
  .rb-small {
    gap: 5px;
    border-radius: 3px;
    padding: 3px 8px;
  }

  .rb-icon {
    justify-content: center;
    min-width: 28px;
    height: 30px;
    border-radius: 3px;
    padding: 0 4px;
  }

  .rb-small:hover:not(:disabled),
  .rb-icon:hover:not(:disabled) { background: var(--w-hover); }
  .rb-small:active:not(:disabled),
  .rb-icon:active:not(:disabled) { background: var(--w-pressed); }
  .rb-small.active,
  .rb-icon.active { background: var(--w-active); }

  .rb-label {
    color: inherit;
  }

  /* Split button: the two halves read as one control, so the hover outline sits on
     the wrapper and each half only tints its own surface. */
  .rb-split {
    display: inline-flex;
    align-items: stretch;
    border-radius: 3px;
  }

  .rb-split:hover { background: var(--w-hover); }
  .rb-split-active { background: var(--w-active); }

  .rb-caret {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    border: none;
    background: none;
    border-radius: 0 3px 3px 0;
    color: var(--w-text-dim);
    cursor: pointer;
  }

  .rb-caret:hover:not(:disabled) { background: var(--w-pressed); }
  .rb-caret:disabled { opacity: 0.4; cursor: default; }
  .rb-caret.active { background: var(--w-active); }
</style>
