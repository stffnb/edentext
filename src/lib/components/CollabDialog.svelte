<script lang="ts" module>
  export type CollabNotice = 'unreachable' | 'failing' | 'unkept' | 'missing';
</script>

<script lang="ts">
  import type { SessionView } from '../collab/session';
  import { loadRetention } from '../storage/docScope';
  import { t } from '../i18n/i18n.svelte';

  // Starting a shared session, its link, who is there, and leaving (docs/architecture/collab.md).
  // A joiner that has the document is asked whether to keep it (`asking`); `opening` asks
  // before another document opens here alone. `notice` tells, beside the status bar, of what
  // does not stop editing, so no dialog covers the page while someone types.
  let { open = $bindable(false), asking = $bindable(false), opening = $bindable(false), notice = $bindable(null), view, onStart, onLeave }: {
    open?: boolean;
    asking?: boolean;
    opening?: boolean;
    notice?: CollabNotice | null;
    view: SessionView | null;
    onStart: () => void;
    onLeave: (choice: 'keep' | 'discard' | null) => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let copied = $state(false);
  let hadDoc = $state(false);
  let storesNothing = $state(false);

  $effect(() => {
    if (view?.status === 'live') hadDoc = true;
  });

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (open && !el.open) { copied = false; storesNothing = loadRetention() === 'none'; el.showModal(); }
    else if (!open && el.open) el.close();
  });

  function leave() {
    if (view?.keeps) onLeave(null);
    else if (hadDoc) asking = true;
    else onLeave('discard');
  }

  async function copy() {
    if (!view) return;
    try { await navigator.clipboard.writeText(view.link); copied = true; } catch { /* the field stays selectable */ }
  }
</script>

<dialog
  bind:this={dialogEl}
  onclose={() => { open = false; asking = false; opening = false; }}
  onclick={(e) => e.target === dialogEl && (open = false)}
  aria-label={t().collab.title}
>
  <div class="body">
    <h2>{t().collab.title}</h2>
    {#if !view}
      <p>{t().collab.intro}</p>
      <div class="actions">
        <span class="spacer"></span>
        <button onclick={() => (open = false)}>{t().common.cancel}</button>
        <button class="primary" data-cmd="collabStart" onclick={onStart}>{t().collab.start}</button>
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
      {#if view.status === 'live' && !view.kept}
        <p class="notice" data-notice="unkept">{t().collab.unkept}</p>
      {/if}
      {#if view.missing}<p data-missing>{t().collab.missing(view.missing)}</p>{/if}
      {#if view.status !== 'invalid'}
        <label class="row">
          <span>{t().collab.link}</span>
          <input readonly value={view.link} onfocus={(e) => e.currentTarget.select()} />
          <button onclick={copy}>{copied ? t().collab.copied : t().collab.copy}</button>
        </label>
      {/if}
      <div class="peers">
        <span class="label">{t().collab.here}</span>
        {#if view.peers.length}
          <ul>
            {#each view.peers as p (p.id)}
              <li><span class="dot" style:background={p.color}></span>{p.name}</li>
            {/each}
          </ul>
        {:else}
          <span class="muted">{t().collab.alone}</span>
        {/if}
      </div>
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
    <p>{notice === 'unkept' ? t().collab.unkept : notice === 'missing' ? t().collab.missing(view.missing) : t().collab.status[notice]}</p>
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
    border-left: 3px solid var(--color-primary);
    background: var(--color-surface);
  }

  /* Floats over the page's corner like the resume card, and takes no focus. */
  .collab-notice {
    position: fixed;
    right: 16px;
    bottom: 40px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(340px, calc(100vw - 32px));
    padding: 12px 14px 10px;
    border: 1px solid var(--w-border-strong);
    border-left: 3px solid var(--color-primary);
    border-radius: 8px;
    background: var(--w-surface);
    color: var(--w-text);
    box-shadow: var(--w-menu-shadow);
    font-family: var(--font-sans);
    font-size: 0.85rem;
  }
  .collab-notice .actions { padding-top: 0; }

  .row { display: flex; align-items: center; gap: 8px; }
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

  .peers { display: flex; gap: 8px; align-items: baseline; }
  .peers .label { color: var(--color-text-muted); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; }
  li { display: flex; align-items: center; gap: 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }

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
