<script lang="ts">
  import type { SessionView } from '../collab/session';
  import { initials } from '../collab/names';
  import { heldZones } from '../collab/zones.svelte';
  import { follow, following, jumpTo, whereIs } from '../collab/presence.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { nameIsland } from '../i18n/shortcut';

  // Who else is in the session, as circles beside the session button: writers filled,
  // readers as rings. A click goes to that person's caret and offers to follow it; a
  // click on the one followed stops. Past MAX (fewer on a narrow bar) a "+n" opens the list.
  let { view, onAll }: { view: SessionView; onAll: () => void } = $props();

  const MAX = 4;
  let width = $state(1024);
  let menu = $state<number | null>(null);
  let row = $state<HTMLElement | null>(null);

  type Person = { id: number; name: string; color: string; reader: boolean; where: 'caret' | 'zone' | null; zone: string };
  const people = $derived.by((): Person[] => {
    const zones = new Map(heldZones().map(([id, h]) => [h.id, /:header/.test(id) ? t().collab.inHeader : t().collab.inFooter]));
    return [
      ...view.peers.map((p) => ({ id: p.id, name: p.name, color: p.color, reader: false, where: whereIs(p.id), zone: zones.get(p.id) ?? '' })),
      ...view.readers.map((r) => ({ id: r.id, name: r.name, color: r.color, reader: true, where: null, zone: '' })),
    ];
  });
  const max = $derived(width < 600 ? 2 : MAX);
  const shown = $derived(people.length > max ? people.slice(0, max) : people);

  function label(p: Person): string {
    if (following() === p.id && !p.reader) return t().collab.following(nameIsland(p.name));
    return [nameIsland(p.name), p.reader ? t().collab.readingAlong : p.zone, p.where ? '' : t().collab.noCaret].filter(Boolean).join(' · ');
  }

  function pick(p: Person) {
    if (following() === p.id) return follow(null);
    if (!p.where) return;
    jumpTo(p.id);
    menu = p.id;
  }

  // The menu closes on a click elsewhere or Escape, and when its person leaves.
  $effect(() => {
    if (menu === null) return;
    if (!people.some((p) => p.id === menu && p.where)) { menu = null; return; }
    const away = (e: Event) => { if (!(e.target instanceof Node && row?.contains(e.target))) menu = null; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') menu = null; };
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true); };
  });
</script>

<svelte:window bind:innerWidth={width} />

{#if people.length}
  <div class="collab-people" role="group" aria-label={t().collab.people} bind:this={row}>
    {#each shown as p (`${p.reader}${p.id}`)}
      <span class="slot">
        <button class="person" class:reader={p.reader} class:followed={following() === p.id && !p.reader} class:still={!p.where}
          style:--c={p.color} data-person={p.reader ? 'reader' : 'writer'} aria-disabled={!p.where && following() !== p.id}
          aria-haspopup={p.where ? 'menu' : undefined} aria-expanded={p.where ? menu === p.id : undefined}
          title={label(p)} aria-label={label(p)} onclick={() => pick(p)}>{initials(p.name)}</button>
        {#if menu === p.id}
          <div class="menu" role="menu">
            <button role="menuitem" data-cmd="collabGoTo" onclick={() => { jumpTo(p.id); menu = null; }}>{t().collab.goTo}</button>
            <button role="menuitem" data-cmd="collabFollow" onclick={() => { follow(p.id); menu = null; }}>{t().collab.follow}</button>
          </div>
        {/if}
      </span>
    {/each}
    {#if people.length > shown.length}
      <button class="person more" data-cmd="collabEveryone" title={t().collab.more(people.length - shown.length)}
        aria-label={t().collab.more(people.length - shown.length)} onclick={onAll}>+{people.length - shown.length}</button>
    {/if}
  </div>
{/if}

<style>
  .collab-people { display: flex; align-items: center; }
  .slot { position: relative; display: flex; }
  .slot + .slot, .slot + .more { margin-inline-start: -3px; }
  .person {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 2px solid var(--c, var(--color-border));
    border-radius: 50%;
    box-sizing: border-box;
    background: var(--c, var(--color-surface));
    color: #fff;
    font: 600 0.6rem/16px var(--font-sans);
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 0 1.5px var(--color-toolbar-bg);
  }
  .person.reader { background: var(--color-toolbar-bg); color: var(--color-text); }
  .person.still { cursor: default; }
  .person.followed { box-shadow: 0 0 0 1.5px var(--color-toolbar-bg), 0 0 0 3px var(--color-primary); }
  .person.more { --c: var(--color-border); background: var(--color-surface); color: var(--color-text); font-weight: 500; }
  .person:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
  .menu {
    position: absolute;
    bottom: 26px;
    inset-inline-end: 0;
    z-index: 60;
    display: flex;
    flex-direction: column;
    min-width: 160px;
    padding: 4px;
    border: 1px solid var(--w-border-strong);
    border-radius: 6px;
    background: var(--w-surface);
    box-shadow: var(--w-menu-shadow);
  }
  .menu button {
    border: none;
    background: transparent;
    color: var(--w-text);
    padding: 5px 10px;
    border-radius: 4px;
    text-align: start;
    font: inherit;
    cursor: pointer;
  }
  .menu button:hover, .menu button:focus-visible { background: var(--color-btn-hover); }
</style>
