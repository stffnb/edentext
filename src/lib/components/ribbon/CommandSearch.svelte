<script lang="ts">
  import Icon from './Icon.svelte';
  import { anchored, clickOutside, closeMenu, isMenuOpen, showMenu } from './menu.svelte';
  import { OPEN_COMMAND_SEARCH_EVENT, RIBBON_COMMANDS, searchCommands, type RibbonCommand, type Tab } from './commands';
  import { t } from '../../i18n/i18n.svelte';
  import { shortcutHint } from '../../editor/shortcuts';
  import { loadRecentCommands, saveRecentCommands } from '../../storage/theme';
  import { keepInView } from '../toolbar/island';

  // Word's search box: type part of a command's name, Enter runs the first hit. The
  // island's variant drops its list in the island's look, inside the island's own flow.
  let { commands, onRun, onCancel, variant = 'ribbon' }: {
    commands: RibbonCommand[];
    onRun: (cmd: RibbonCommand) => void;
    onCancel?: () => void;
    variant?: 'ribbon' | 'island';
  } = $props();

  const placeList = (node: HTMLElement) => (variant === 'island' ? keepInView(node) : anchored(node));

  let input = $state<HTMLInputElement>();
  let query = $state('');
  let active = $state(0);
  let recent = $state(loadRecentCommands());
  let hits = $derived(searchCommands(query, commands, t(), recent));
  // Where the hit lives: its tab, and for a menu entry the control that opens the menu.
  function place(cmd: RibbonCommand): string {
    const m = t();
    const key: Tab | 'file' = cmd.tab === null ? 'file' : [cmd.tab].flat()[0];
    const tab = m.ribbon.tabs[key];
    const via = cmd.via && RIBBON_COMMANDS.find((c) => c.id === cmd.via);
    return via ? `${tab} › ${via.label(m)}` : tab;
  }

  let open = $derived(isMenuOpen('search') && (hits.length > 0 || !!query.trim()));

  $effect(() => {
    const focus = () => { input?.focus(); input?.select(); showMenu('search'); };
    window.addEventListener(OPEN_COMMAND_SEARCH_EVENT, focus);
    return () => window.removeEventListener(OPEN_COMMAND_SEARCH_EVENT, focus);
  });

  function run(cmd: RibbonCommand) {
    recent = [cmd.id, ...recent.filter((id) => id !== cmd.id)].slice(0, 5);
    saveRecentCommands(recent);
    query = '';
    input?.blur();
    onRun(cmd);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      showMenu('search');
      if (hits.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      run(hits[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      query = '';
      closeMenu();
      onCancel?.();
    }
  }
</script>

<div class="cmd-search" class:island={variant === 'island'} use:clickOutside={'search'}>
  <Icon name="find" size={14} />
  <input
    bind:this={input}
    bind:value={query}
    type="text"
    role="combobox"
    aria-expanded={open}
    aria-controls="cmd-search-list"
    aria-activedescendant={open && hits[active] ? `cmd-search-${hits[active].id}` : undefined}
    aria-autocomplete="list"
    placeholder={`${t().ribbon.search} (${shortcutHint('commandSearch')})`}
    oninput={() => { active = 0; showMenu('search'); }}
    onfocus={() => showMenu('search')}
    {onkeydown}
  />
  {#if open}
    <div class={variant === 'island' ? 'island-menu right' : 'ribbon-menu'} id="cmd-search-list" role="listbox" use:placeList style="min-width: 260px">
      {#each hits as cmd, i (cmd.id)}
        <!-- Pressed without taking focus, so the input keeps it and the menu stays open. -->
        <button
          id={`cmd-search-${cmd.id}`}
          role="option"
          tabindex="-1"
          aria-selected={i === active}
          class:selected={i === active}
          onmousedown={(e) => e.preventDefault()}
          onmouseenter={() => (active = i)}
          onclick={() => run(cmd)}
        >
          {cmd.label(t())}<span class="menu-sub">{place(cmd)}</span>
        </button>
      {:else}
        <div class={variant === 'island' ? 'im-label' : 'rb-menu-label rb-menu-empty'}>{t().ribbon.searchNoResults}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .cmd-search {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 8px;
    padding: 0 6px;
    border: 1px solid var(--w-border-strong);
    border-radius: 4px;
    background: var(--w-surface);
    color: var(--w-text-dim);
  }

  .cmd-search:focus-within { border-color: var(--w-accent); }

  /* The island's own field look: its tokens, its control height, and narrower until
     it is used. */
  .cmd-search.island {
    height: var(--toolbar-btn-size);
    margin: 0;
    border-color: var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text-muted);
  }
  .cmd-search.island:hover,
  .cmd-search.island:focus-within { border-color: var(--color-primary); }
  .cmd-search.island input {
    width: 8rem;
    color: var(--color-text);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    transition: width 0.15s ease;
  }
  .cmd-search.island input:focus { width: 13rem; }

  .cmd-search input {
    width: 12rem;
    padding: 3px 0;
    border: none;
    outline: none;
    background: none;
    color: var(--w-text);
    font: inherit;
    font-size: 12px;
  }
</style>
