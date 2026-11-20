<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../ribbon/Icon.svelte';
  import type { IconName } from '../ribbon/icons';
  import IslandButton from './IslandButton.svelte';
  import { clickOutside, closeMenu, isMenuOpen, toggleMenu } from '../ribbon/menu.svelte';
  import { keepInView } from './island';

  // A button that drops a panel below itself. With `onclick` it is a split button: the
  // main half acts, the chevron opens the panel. One menu is open at a time (menu.svelte.ts).
  let { id, icon, content, label, title, caretTitle, cmd, caretCmd, active = false, disabled = false, align = 'left', minWidth, onclick, children }: {
    id: string;
    icon?: IconName;
    content?: Snippet;
    label?: string;
    title?: string;
    caretTitle?: string;
    cmd?: string;
    // A split's chevron, for the command search to open the panel by.
    caretCmd?: string;
    active?: boolean;
    disabled?: boolean;
    align?: 'left' | 'right';
    minWidth?: number;
    onclick?: () => void;
    children: Snippet;
  } = $props();

  const open = $derived(isMenuOpen(id));
</script>

<div class="im-wrap" use:clickOutside={id}>
  {#if onclick}
    <span class="im-split" class:active class:open>
      <button class="im-main" class:active {disabled} title={title ?? label} aria-label={label ? undefined : title} aria-pressed={active} data-cmd={cmd} onclick={() => { closeMenu(); onclick(); }}>
        {#if content}{@render content()}{:else if icon}<Icon name={icon} size={16} />{/if}
        {#if label}<span class="im-label-text">{label}</span>{/if}
      </button>
      <button class="im-chevron" {disabled} title={caretTitle ?? title} aria-label={caretTitle ?? title} aria-haspopup="menu" aria-expanded={open} data-cmd={caretCmd} onclick={() => toggleMenu(id)}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
          <path d="M1 2.5l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </span>
  {:else}
    <IslandButton {icon} {content} {label} {title} {cmd} {active} {disabled} caret expanded={open} onclick={() => toggleMenu(id)} />
  {/if}
  {#if open}
    <div class="island-menu" class:right={align === 'right'} style:min-width={minWidth && `${minWidth}px`} role="menu" use:keepInView>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .im-wrap {
    position: relative;
    display: inline-flex;
  }

  /* Main toggle and chevron as one joined control, as the list buttons are. */
  .im-split {
    display: inline-flex;
    align-items: stretch;
    height: var(--toolbar-btn-size);
    border: 1px solid transparent;
    border-radius: var(--radius);
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .im-split:hover,
  .im-split.open { border-color: var(--color-primary); }
  .im-split:hover .im-chevron,
  .im-split.open .im-chevron { border-inline-start-color: var(--color-border); }

  .im-main,
  .im-chevron {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 100%;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .im-main { padding-block: 0; padding-inline: 0.3rem 0.2rem; min-width: calc(var(--toolbar-btn-size) - 0.5rem); }
  .im-chevron { width: 1rem; padding: 0; border-inline-start: 1px solid transparent; }

  .im-main:hover:not(:disabled),
  .im-chevron:hover:not(:disabled),
  .open .im-chevron { background: var(--color-btn-hover); }

  .im-main.active { background: var(--color-primary); color: white; }

  .im-main:disabled,
  .im-chevron:disabled { opacity: 0.35; cursor: not-allowed; }

  .im-label-text { line-height: 1; }
</style>
