<script lang="ts">
  import { chatOpen, presenceNews } from '../collab/chat.svelte';
  import { goToMention, mentionNews } from '../collab/mentions.svelte';
  import { t } from '../i18n/i18n.svelte';

  // Who came or went, a moment above the status bar and for screen readers, taking no
  // focus; the chat says it itself while open. `covered`: a session notice takes the corner.
  let { covered = false }: { covered?: boolean } = $props();

  const lines = $derived(chatOpen() ? [] : presenceNews());
  const text = (l: (typeof lines)[number]) => l.came
    ? (l.reading ? t().collab.readsAlong(l.names) : t().collab.chat.came(l.names))
    : `${t().collab.chat.went(l.names)}${l.reading ? ` · ${t().collab.readingAlong}` : ''}`;
</script>

<div class="collab-news" class:covered aria-live="polite" role="status">
  {#each lines as l (l.key)}<p data-news={l.came ? 'came' : 'went'}>{text(l)}</p>{/each}
  {#each mentionNews() as m (m.key)}
    <button data-news="mention" onclick={() => goToMention(m.id)}>{t().collab.mentioned(m.name || t().revisions.unknownAuthor)}</button>
  {/each}
</div>

<style>
  /* Bottom left, so the session notices in the right corner stay in view. */
  .collab-news {
    position: fixed;
    left: 16px;
    bottom: 34px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    max-width: calc(100vw - 32px);
    pointer-events: none;
  }
  .collab-news.covered { display: none; }
  p, button {
    margin: 0;
    padding: 5px 10px;
    border: 1px solid var(--w-border-strong);
    border-radius: 6px;
    background: var(--w-surface);
    color: var(--w-text);
    box-shadow: var(--w-menu-shadow);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    overflow-wrap: anywhere;
  }
  button { pointer-events: auto; cursor: pointer; border-left: 3px solid var(--color-primary); text-align: start; }
  button:hover { background: var(--color-btn-hover); }
  @media (min-width: 721px) {
    .collab-news.covered { display: flex; }
  }
</style>
