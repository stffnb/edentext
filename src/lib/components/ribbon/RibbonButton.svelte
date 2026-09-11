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
    caretPrimary = false,
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
    // The caret is the half of the control used most: it gets the bigger target.
    caretPrimary?: boolean;
    onclick?: () => void;
    onCaret?: () => void;
  } = $props();

  const ICON_SIZE = { big: 28, small: 14, icon: 20 } as const;

  // One or two words wrap into the same two lines whether the box is the full cap or
  // just its longest word, so those hug it — a longer label keeps the cap to wrap at.
  const hug = $derived(!!label && label.trim().split(/\s+/).length <= 2);
</script>

{#snippet face()}
  <span class="rb-face">
    {#if content}{@render content()}
    {:else if icon}<Icon name={icon} size={ICON_SIZE[variant]} />{/if}
    {#if caret && !onCaret && variant !== 'small'}
      <Icon name="chevronDown" size={10} />
    {/if}
  </span>
  {#if label && variant !== 'icon'}<span class="rb-label" class:hug>{label}</span>{/if}
  <!-- A row reads left to right, so its caret follows the label rather than the icon. -->
  {#if caret && !onCaret && variant === 'small'}<Icon name="chevronDown" size={10} />{/if}
{/snippet}

{#if caret && onCaret}
  <span class="rb-split" class:caret-primary={caretPrimary} class:rb-split-active={active || caretActive}>
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
      <Icon name="chevronDown" size={caretPrimary ? 16 : 10} />
    </button>
  </span>
{:else}
  <button
    class="rb rb-{variant}"
    class:active
    {disabled}
    {title}
    aria-haspopup={caret ? 'menu' : undefined}
    aria-expanded={caret ? active : undefined}
    {onclick}
  >
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

  /* Icon over label, with the tint over both, so a labelled button and a captioned
     picker beside it answer the pointer the same way. */
  .rb-big {
    flex-direction: column;
    gap: 2px;
    padding: 2px 6px 3px;
  }

  .rb-big .rb-face {
    align-self: stretch;
    min-height: 28px;
    flex: 1;
    border-radius: 4px;
    padding: 2px 4px;
    margin: 0 -4px;
  }

  .rb-big:hover:not(:disabled) { background: var(--w-hover); }
  .rb-big:active:not(:disabled) { background: var(--w-pressed); }
  .rb-big.active { background: var(--w-active); }

  /* A row in a stacked mini-column (Cut / Copy under a big Paste). */
  .rb-small {
    gap: 5px;
    border-radius: 3px;
    padding: 2px 8px;
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

  /* Word wraps a two-word label onto two lines; at the default line-height that
     button alone would set the band's height. */
  .rb-label {
    line-height: 14px;
    color: inherit;
  }

  /* The cap is what makes the wrap happen: unwrapped, a three-word label is twice
     the width of the icon above it. Two lines fit the band, a third is clipped.
     A hugging label drops the width it wrapped at, or it would push its neighbours a
     word's width apart. */
  .rb-big .rb-label {
    max-width: 78px;
    white-space: normal;
    text-align: center;
  }

  /* The cap can't wrap what has no space in it: a long compound painted past the
     button and over its neighbour. A hugging label sets its own width instead — a
     single word widens the button, as it does in Word's German ribbon. */
  .rb-big .rb-label.hug { width: min-content; max-width: none; }

  /* Split button: the two halves read as one control, so the hover outline sits on
     the wrapper and each half only tints its own surface. */
  .rb-split {
    display: inline-flex;
    align-items: stretch;
    border-radius: 3px;
  }

  .rb-split:hover:not(.rb-split-active) { background: var(--w-hover); }
  .rb-split-active { background: var(--w-active); }

  /* Each half answers its own hover a step past the tint the wrapper carries, so
     the pointer says which of the two it would hit. The mix is that step where the
     tint is already the pressed state — a darker grey in light mode, a lighter one
     in dark. */
  .rb-split .rb-big:hover:not(:disabled) { background: var(--w-pressed); }

  .rb-split-active .rb-big:hover:not(:disabled),
  .rb-split-active .rb-caret:hover:not(:disabled) {
    background: color-mix(in srgb, var(--w-active) 85%, var(--w-text));
  }

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

  /* Wider and in the text colour, not the dim one, where the menu is the half of the
     control used most. Scaled past its own box rather than given a bigger one: the
     glyph sits inside a third of empty canvas. */
  .caret-primary .rb-caret { width: 16px; color: var(--w-text); }
  .caret-primary .rb-caret :global(svg) { transform: scale(1.15); }

  /* That command half keeps only a hair of right padding, so the arrow sits against
     the label rather than at the far edge of a button the label does not fill. */
  .caret-primary .rb-big { padding-right: 4px; }
  .caret-primary .rb-big .rb-face { margin-right: 0; }

  .rb-caret:hover:not(:disabled) { background: var(--w-pressed); }
  .rb-caret:disabled { opacity: 0.4; cursor: default; }
  .rb-caret.active { background: var(--w-active); }
</style>
