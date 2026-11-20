<script lang="ts" module>
  export type CollabNotice = 'unreachable' | 'failing' | 'unkept' | 'unwritten' | 'missing' | 'dropped' | 'loading';
</script>

<script lang="ts">
  import type { SessionView } from '../collab/session';
  import { loadRetention } from '../storage/docScope';
  import { t } from '../i18n/i18n.svelte';
  import { userName } from '../storage/userName.svelte';
  import { MAX_NAME } from '../collab/names';
  import { renameCollab } from '../collab/appSession.svelte';
  import { follow, following, jumpTo, whereIs } from '../collab/presence.svelte';

  // Starting a shared session, its link, who is there, and leaving (docs/architecture/collab.md).
  // A joiner that has the document is asked whether to keep it (`asking`); `opening` asks
  // before another document opens here alone. `notice` tells, beside the status bar, of what
  // does not stop editing, so no dialog covers the page while someone types. Whoever starts
  // or joins without a name is asked for one once (`naming` for a joiner); none is a guest.
  let { open = $bindable(false), asking = $bindable(false), opening = $bindable(false), naming = $bindable(false), notice = $bindable(null), view, onStart, onNamed, onLeave }: {
    open?: boolean;
    asking?: boolean;
    opening?: boolean;
    naming?: boolean;
    notice?: CollabNotice | null;
    view: SessionView | null;
    onStart: (name?: string) => void;
    onNamed: (name: string) => void;
    onLeave: (choice: 'keep' | 'discard' | null) => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let copied = $state<'edit' | 'view' | null>(null);
  let hadDoc = $state(false);
  let storesNothing = $state(false);
  let draft = $state('');
  let asked = $state(false);

  $effect(() => {
    if (view?.status === 'live') hadDoc = true;
  });

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) { copied = null; storesNothing = loadRetention() === 'none'; draft = userName(); asked = !userName(); el.showModal(); }
    else if (!open && el.open) el.close();
  });

  function leave() {
    if (view?.keeps) onLeave(null);
    else if (hadDoc) asking = true;
    else onLeave('discard');
  }

  async function copy(which: 'edit' | 'view', text: string) {
    try { await navigator.clipboard.writeText(text); copied = which; } catch { /* the field stays selectable */ }
  }
  // A reader's `link` is the read link, so it is offered only that one.
  const links = $derived(!view || view.status === 'invalid' ? []
    : view.reading ? [{ which: 'view' as const, url: view.link }]
    : [{ which: 'edit' as const, url: view.link }, { which: 'view' as const, url: view.viewLink }]);
  const unwritten = $derived(!!view?.reading && view.status === 'live' && !view.peers.length);
</script>

<!-- `ask`: the first time, with what the name is for; else a field that renames at once. -->
{#snippet nameField(ask: boolean)}
  <label class="name">
    <span>{t().collab.yourName}</span>
    <input data-field="collabName" maxlength={MAX_NAME * 4} bind:value={draft} placeholder={ask ? t().collab.guestHint : ''}
      onchange={() => !ask && renameCollab(draft)} onkeydown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (!ask) renameCollab(draft); else if (naming) open = false; else onStart(draft); }} />
  </label>
  {#if ask}<p class="muted">{storesNothing ? t().collab.nameHintOnce : t().collab.nameHint}</p>{/if}
{/snippet}

<dialog
  bind:this={dialogEl}
  onclose={() => { open = false; asking = false; opening = false; if (naming) { naming = false; onNamed(draft); } }}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().collab.title}
>
  <div class="body">
    <h2>{t().collab.title}</h2>
    {#if naming}
      <p>{t().collab.joinIntro}</p>
      {@render nameField(true)}
      <div class="actions">
        <span class="spacer"></span>
        <button class="primary" data-cmd="collabJoin" onclick={() => (open = false)}>{t().collab.join}</button>
      </div>
    {:else if !view}
      <p>{t().collab.intro}</p>
      {#if asked}{@render nameField(true)}{/if}
      <div class="actions">
        <span class="spacer"></span>
        <button onclick={() => (open = false)}>{t().common.cancel}</button>
        <button class="primary" data-cmd="collabStart" onclick={() => onStart(asked ? draft : undefined)}>{t().collab.start}</button>
      </div>
    {:else if opening}
      <p data-notice="open">{t().collab.openIntro}</p>
      {#if view.keeps}<p>{t().collab.openReplaces}</p>
      {:else if hadDoc}<p>{storesNothing ? t().collab.keepNone : t().collab.openKeep}</p>{/if}
      <div class="actions">
        <button onclick={() => (open = false)}>{t().common.cancel}</button>
        <span class="spacer"></span>
        {#if !view.keeps && hadDoc}
          <button data-cmd="collabDiscard" onclick={() => onLeave('discard')}>{t().collab.discard}</button>
          {#if !storesNothing}
            <button class="primary" data-cmd="collabKeep" onclick={() => onLeave('keep')}>{t().collab.keep}</button>
          {/if}
        {:else}
          <button class="primary" data-cmd="collabLeaveOpen" onclick={() => onLeave(view.keeps ? null : 'discard')}>{t().collab.leaveOpen}</button>
        {/if}
      </div>
    {:else if asking}
      <p data-notice="keep">{storesNothing ? t().collab.keepNone : t().collab.keepAsk}</p>
      <div class="actions">
        <button onclick={() => (asking = false)}>{t().common.cancel}</button>
        <span class="spacer"></span>
        <button data-cmd="collabDiscard" onclick={() => onLeave('discard')}>{t().collab.discard}</button>
        {#if !storesNothing}
          <button class="primary" data-cmd="collabKeep" onclick={() => onLeave('keep')}>{t().collab.keep}</button>
        {/if}
      </div>
    {:else}
      <p class="status" data-status={view.status}>{t().collab.status[view.status]}</p>
      {#if view.paused}<p class="notice" data-notice="paused">{t().collab.pausedHint}</p>{/if}
      {#if view.reading}<p class="notice" data-notice="reading">{t().collab.readingHint}</p>{/if}
      {#if unwritten}<p class="notice" data-notice="unwritten">{t().collab.unwritten}</p>
      {:else if view.status === 'live' && !view.kept}<p class="notice" data-notice="unkept">{t().collab.unkept}</p>{/if}
      {#if view.missing}<p data-missing>{t().collab.missing(view.missing)}</p>{/if}
      {#if links.length}
        <div class="links">
          {#each links as l (l.which)}
            <label class="row" data-link={l.which}>
              <span>{l.which === 'edit' ? t().collab.editLink : t().collab.viewLink}</span>
              <input readonly dir="ltr" value={l.url} onfocus={(e) => e.currentTarget.select()} />
              <button onclick={() => copy(l.which, l.url)}>{copied === l.which ? t().collab.copied : t().collab.copy}</button>
            </label>
          {/each}
        </div>
        {#if !view.reading}<p class="muted">{t().collab.linksHint}</p>{/if}
      {/if}
      <div class="peers">
        <span class="label">{t().collab.here}</span>
        {#if view.peers.length || view.readers.length}
          <ul>
            {#each view.peers as p (p.id)}
              <li data-writer={p.id}>
                <span class="dot" style:background={p.color}></span>
                {#if whereIs(p.id)}
                  <button class="link" title={t().collab.goTo} onclick={() => { open = false; requestAnimationFrame(() => jumpTo(p.id)); }}><bdi>{p.name}</bdi></button>
                  <button class="link muted" data-cmd="collabFollow" onclick={() => { open = false; requestAnimationFrame(() => follow(following() === p.id ? null : p.id)); }}>
                    {following() === p.id ? t().collab.stopFollow : t().collab.follow}</button>
                {:else}<bdi>{p.name}</bdi><span class="muted">{t().collab.noCaret}</span>{/if}
              </li>
            {/each}
            {#each view.readers as p (p.id)}
              <li data-reader><span class="dot ring" style:border-color={p.color}></span><bdi>{p.name}</bdi><span class="muted">{t().collab.readingAlong}</span></li>
            {/each}
          </ul>
        {:else}
          <span class="muted">{t().collab.alone}</span>
        {/if}
      </div>
      {@render nameField(false)}
      <p class="muted">{view.keeps ? t().collab.leaveHint : t().collab.joinedHint}</p>
      <div class="actions">
        <button data-cmd="collabLeave" onclick={leave}>{t().collab.leave}</button>
        <span class="spacer"></span>
        <button class="primary" onclick={() => (open = false)}>{t().common.ok}</button>
      </div>
    {/if}
  </div>
</dialog>

{#if notice && view && !open}
  <aside class="collab-notice" role="status" data-notice={notice}>
    <p>{notice === 'unkept' ? t().collab.unkept : notice === 'unwritten' ? t().collab.unwritten : notice === 'missing' ? t().collab.missing(view.missing) : notice === 'dropped' ? t().collab.dropped : notice === 'loading' ? t().collab.picturesLoading : t().collab.status[notice]}</p>
    <div class="actions">
      <button data-cmd="collabDetails" onclick={() => { notice = null; open = true; }}>{t().collab.menu}</button>
      <span class="spacer"></span>
      <button onclick={() => (notice = null)}>{t().common.close}</button>
    </div>
  </aside>
{/if}

<style>
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 460px;
    max-width: calc(100vw - 32px);
    padding: 18px 20px 16px;
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  h2 { font-size: 1rem; }
  p { margin: 0; line-height: 1.45; }
  .muted { color: var(--color-text-muted); }
  .status { font-weight: 600; }
  .notice {
    padding: 8px 10px;
    border-inline-start: 3px solid var(--color-primary);
    background: var(--color-surface);
  }

  /* Floats over the page's corner like the resume card, and takes no focus. */
  .collab-notice {
    position: fixed;
    inset-inline-end: 16px;
    bottom: 40px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(340px, calc(100vw - 32px));
    padding: 12px 14px 10px;
    border: 1px solid var(--w-border-strong);
    border-inline-start: 3px solid var(--color-primary);
    border-radius: 8px;
    background: var(--w-surface);
    color: var(--w-text);
    box-shadow: var(--w-menu-shadow);
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  .collab-notice .actions { padding-top: 0; }

  /* One grid, so both links' fields line up whatever their labels' length. */
  .links { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 8px; align-items: center; }
  .row { display: contents; }
  .row > span { color: var(--color-text-muted); white-space: nowrap; }
  input {
    flex: 1;
    min-width: 0;
    height: 26px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 0 6px;
    font: inherit;
  }

  .name { display: flex; align-items: center; gap: 8px; }
  .name > span { color: var(--color-text-muted); white-space: nowrap; }
  .peers { display: flex; gap: 8px; align-items: baseline; }
  .peers .label { color: var(--color-text-muted); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  li { display: flex; align-items: center; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; box-sizing: border-box; }
  .dot.ring { border: 2px solid; background: transparent; }
  li .muted::before { content: '·'; margin: 0 4px; }
  button.link { border: none; background: none; padding: 0; color: inherit; text-decoration: underline dotted; }
  button.link:hover { background: none; text-decoration: underline; }

  .actions { display: flex; align-items: center; gap: 8px; padding-top: 4px; }
  .spacer { flex: 1; }
  button {
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    color: var(--color-text);
    padding: 5px 14px;
    font: inherit;
    cursor: pointer;
  }
  button:hover { background: var(--color-btn-hover); }
  .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: #fff;
  }
</style>
