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

  // One button when the whole of it opens the menu, and the caret joins the column
  // under the label.
  let stackCaret = $derived(caret && !onCaret && variant === 'big');
</script>

{#snippet face(withLabel = true)}
  <span class="rb-face">
    {#if content}{@render content()}
    {:else if icon}<Icon name={icon} size={ICON_SIZE[variant]} />{/if}
    {#if caret && !onCaret && !stackCaret}
      <Icon name="chevronDown" size={10} />
    {/if}
  </span>
  {#if withLabel && label && variant !== 'icon'}<span class="rb-label">{label}</span>{/if}
  <!-- Held open on every big button, carrying a caret or nothing: the group centres
       its controls, so one taller button lifts its own icon and label off the row. -->
  {#if variant === 'big' && !onCaret}
    <span class="rb-stack-caret">{#if caret}<Icon name="chevronDown" size={10} />{/if}</span>
  {/if}
{/snippet}

{#if caret && onCaret}
  {@const stacked = variant === 'big'}
  <span class="rb-split" class:rb-split-col={stacked} class:rb-split-active={active || caretActive}>
    <button class="rb rb-{variant}" class:active {disabled} {title} {onclick}>
      {@render face(!stacked)}
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
      {#if stacked && label}<span class="rb-label">{label}</span>{/if}
      <Icon name="chevronDown" size={10} />
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

  /* Rides closer to the label than the 4px column gap: the two read as one line. */
  .rb-stack-caret {
    display: flex;
    height: 8px;
    margin-top: -3px;
    color: var(--w-text-dim);
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

  /* A big split button stacks, as in Word: the icon runs the command, the label
     and the caret under it open the menu. Icon, label and caret each get their
     own line — abreast, the caret widens the button by its own width. */
  .rb-split-col { flex-direction: column; }
  .rb-split-col .rb-big { padding: 2px 6px 0; }

  .rb-split-col .rb-caret {
    flex-direction: column;
    width: auto;
    padding: 0 6px 1px;
    border-radius: 0 0 3px 3px;
    color: var(--w-text);
  }

  .rb-caret:hover:not(:disabled) { background: var(--w-pressed); }
  .rb-caret:disabled { opacity: 0.4; cursor: default; }
  .rb-caret.active { background: var(--w-active); }
</style>
