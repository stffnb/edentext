<script lang="ts">
  import type { SessionView } from '../collab/session';
  import { loadRetention } from '../storage/docScope';
  import { t } from '../i18n/i18n.svelte';

  // Starting a shared session, its link, who is there, and leaving (docs/architecture/collab.md).
  // A joiner that has the document is asked whether to keep it (`asking`, also set from
  // outside to ask before something else ends the session); the starter's copy is stored.
  let { open = $bindable(false), asking = $bindable(false), view, onStart, onLeave }: {
    open?: boolean;
    asking?: boolean;
    view: SessionView | null;
    onStart: () => void;
    onLeave: (choice: 'keep' | 'discard' | null) => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let copied = $state(false);
  let hadDoc = false;
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
  onclose={() => { open = false; asking = false; }}
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
