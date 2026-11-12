<script lang="ts">
  import { collabView } from '../collab/appSession.svelte';
  import { aiEnabled } from '../storage/ai.svelte';
  import { t } from '../i18n/i18n.svelte';

  // After an `@` in a comment, reply or chat box, offers the people in the session (and the
  // assistant, so it stays reachable) by arrow keys and Enter; the box gets plain `@Name`.
  // Outside a session nothing is offered and an `@` stays text.
  let { box, ai = true }: { box: HTMLTextAreaElement | null | undefined; ai?: boolean } = $props();

  let query = $state<{ at: number; text: string } | null>(null);
  let index = $state(0);

  const names = $derived.by(() => {
    const v = collabView();
    if (!v || v.status === 'closed' || v.status === 'invalid') return [];
    return [...new Set([...v.peers, ...v.readers].map((p) => p.name))];
  });
  const list = $derived.by(() => {
    if (!query || !names.length) return [];
    const q = query.text.toLocaleLowerCase();
    const hit = (n: string) => n.toLocaleLowerCase().startsWith(q) || n.toLocaleLowerCase().includes(` ${q}`);
    return [...names.filter(hit), ...(ai && aiEnabled() && hit(t().ai.author) ? [t().ai.author] : [])].slice(0, 6);
  });

  function read() {
    if (!box || !names.length) { query = null; return; }
    const caret = box.selectionStart;
    const m = /(?:^|\s)@([^\s@]{0,40})$/u.exec(box.value.slice(0, caret));
    const next = m ? { at: caret - m[1].length - 1, text: m[1] } : null;
    if (next?.at !== query?.at || next?.text !== query?.text) index = 0;
    query = next;
  }

  // Written into the box at once with an input event, so the binding and the caret agree.
  function choose(name: string) {
    if (!box || !query) return;
    const end = query.at + 1 + query.text.length;
    const caret = query.at + name.length + 2;
    box.value = `${box.value.slice(0, query.at)}@${name} ${box.value.slice(end)}`;
    box.setSelectionRange(caret, caret);
    query = null;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Ahead of the box's own keys: Enter picks rather than sends, Escape shuts only the list.
  function keys(e: KeyboardEvent) {
    if (!list.length) return;
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) index = (index + step + list.length) % list.length;
    else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') choose(list[index]);
    else if (e.key === 'Escape') query = null;
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  $effect(() => {
    const el = box;
    if (!el) return;
    const shut = () => setTimeout(() => (query = null), 150);
    el.addEventListener('keydown', keys);
    el.addEventListener('input', read);
    el.addEventListener('click', read);
    el.addEventListener('blur', shut);
    return () => { el.removeEventListener('keydown', keys); el.removeEventListener('input', read); el.removeEventListener('click', read); el.removeEventListener('blur', shut); };
  });
</script>

{#if list.length}
  <ul class="mention-list" role="listbox" aria-label={t().collab.mentionList}>
    {#each list as name, i (name)}
      <li role="option" aria-selected={i === index} class:active={i === index}>
        <button tabindex="-1" onmousedown={(e) => { e.preventDefault(); choose(name); }}>@{name}</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .mention-list {
    list-style: none;
    margin: 2px 0;
    padding: 3px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-surface);
    max-height: 160px;
    overflow-y: auto;
  }
  button {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--color-text);
    padding: 3px 6px;
    border-radius: 3px;
    text-align: start;
    font: inherit;
    cursor: pointer;
  }
  li.active button, button:hover { background: var(--color-btn-hover); }
</style>
