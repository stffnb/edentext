<script lang="ts">
  import MentionSuggest from './MentionSuggest.svelte';
  import { onMount, tick as settled } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import PaneResize from './PaneResize.svelte';
  import PaneOptions, { layoutItems } from './PaneOptions.svelte';
  import { t, locale } from '../i18n/i18n.svelte';
  import { localeTag } from '../utils/dateTime';
  import { clampPaneWidth, paneLayout, setPaneLayout, REVIEW_PANE_WIDTH, type PaneLayout } from '../storage/panes.svelte';
  import { collabView } from '../collab/appSession.svelte';
  import { MAX_CHAT, chatLines, sendChat, type ChatLine, type SendResult } from '../collab/chat.svelte';

  // The session chat (`collab/chat.svelte.ts`), docked as the reviewing panes are. Text stays
  // text: only http(s) addresses become links. A reader may write here though its document
  // is read-only; the field is shut while the line is not live, and nothing waits to be sent.
  let { editor, onClose }: { editor: Editor | null; onClose: () => void } = $props();

  const MIN_WIDTH = 200;
  const layout = $derived(paneLayout('chat'));
  const left = $derived(layout.side === 'left');
  const width = $derived(clampPaneWidth(layout.width, MIN_WIDTH));
  const setLayout = (patch: Partial<PaneLayout>) => setPaneLayout('chat', patch);
  const setWidth = (w: number) => setLayout({ width: clampPaneWidth(w, MIN_WIDTH) });

  const lines = $derived(chatLines());
  const live = $derived(collabView()?.status === 'live');
  const time = $derived(new Intl.DateTimeFormat(localeTag(locale()), { hour: '2-digit', minute: '2-digit' }));

  let draft = $state('');
  let note = $state<SendResult | null>(null);
  let log: HTMLElement | undefined = $state();
  let field: HTMLTextAreaElement | undefined = $state();
  let below = $state(false);

  // The counter shows only near the limit; a longer text is cut, and the pane says so.
  const near = $derived(draft.length > MAX_CHAT - 200);

  /** The text in runs, each an address (http or https) or plain text. */
  function runs(text: string): { text: string; href?: string }[] {
    const out: { text: string; href?: string }[] = [];
    let at = 0;
    for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"]+/gi)) {
      const href = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
      if (m.index! > at) out.push({ text: text.slice(at, m.index) });
      out.push({ text: href, href });
      at = m.index! + href.length;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  }

  /** Whether a message continues the run of the line before it (same person, within 5 min). */
  function follows(i: number): boolean {
    const a = lines[i - 1], b = lines[i];
    return !!a && a.kind === 'message' && b.kind === 'message' && a.who === b.who && b.at - a.at < 300_000;
  }

  function atBottom(): boolean {
    return !log || log.scrollHeight - log.scrollTop - log.clientHeight < 24;
  }

  function toBottom() {
    if (log) log.scrollTop = log.scrollHeight;
    below = false;
  }

  // A new line scrolls into view, unless the reader scrolled up; then a hint says so.
  let count = 0;
  $effect.pre(() => {
    const n = lines.length;
    if (n === count) return;
    const own = lines.at(-1)?.kind === 'message' && (lines.at(-1) as Extract<ChatLine, { kind: 'message' }>).own;
    const follow = atBottom() || own;
    count = n;
    void settled().then(() => { if (follow) toBottom(); else below = true; });
  });

  function send() {
    const result = sendChat(draft);
    note = result === 'sent' || result === 'empty' ? null : result;
    if (result === 'sent') draft = '';
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      editor?.commands.focus();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  }

  $effect(() => { if (live && note === 'offline') note = null; });
  // Opened on purpose, the pane takes the focus once; arriving messages never do.
  onMount(() => field?.focus());
</script>

<aside class="chat-pane size-{layout.size}" class:left aria-label={t().collab.chat.title} style:flex-basis="{width}px">
  <PaneResize {width} min={MIN_WIDTH} {left} label={t().collab.chat.paneWidth} onWidth={setWidth} onReset={() => setWidth(REVIEW_PANE_WIDTH)} />
  <header>
    <span class="title">{t().collab.chat.title}</span>
    <PaneOptions label={t().collab.chat.options} {left} items={() => layoutItems(layout, setLayout)} />
    <button class="close" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  <!-- A scrolling log is reachable by keyboard so it can be read without a pointer. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="log" role="log" aria-live="polite" tabindex="0" bind:this={log} onscroll={() => { if (atBottom()) below = false; }}>
    <p class="intro">{t().collab.chat.intro}</p>
    {#each lines as line, i (line.key)}
      {#if line.kind === 'presence'}
        <p class="presence">{line.came ? t().collab.chat.came(line.names) : t().collab.chat.went(line.names)}{line.reading ? ` · ${t().collab.readingAlong}` : ''}</p>
      {:else}
        <div class="message" class:own={line.own} class:mention={line.mention} class:follows={follows(i)} data-who={line.own ? 'me' : line.who} title={line.mention ? t().collab.chat.mentionsYou : undefined}>
          {#if !follows(i)}
            <div class="meta">
              <span class="name" style:--who={line.color || null}>{line.name || '?'}</span>
              {#if line.own}<span class="tag">({t().collab.you})</span>{/if}
              {#if line.reading}<span class="tag">· {t().collab.readingAlong}</span>{/if}
              <time datetime={new Date(line.at).toISOString()}>{time.format(line.at)}</time>
            </div>
          {/if}
          <p class="text" dir="auto">{#each runs(line.text) as r}{#if r.href}<a href={r.href} target="_blank" rel="noopener noreferrer">{r.text}</a>{:else}{r.text}{/if}{/each}</p>
        </div>
      {/if}
    {/each}
  </div>
  {#if below}
    <button class="below" onclick={toBottom}>{t().collab.chat.newMessages} ↓</button>
  {/if}

  <footer>
    {#if !live}
      <p class="why" data-chat-note="offline">{t().collab.chat.offline}</p>
    {:else if note === 'busy'}
      <p class="why" data-chat-note="busy">{t().collab.chat.busy}</p>
    {:else if draft.length > MAX_CHAT}
      <p class="why" data-chat-note="long">{t().collab.chat.tooLong(MAX_CHAT)}</p>
    {/if}
    <MentionSuggest box={field} ai={false} />
    <textarea bind:this={field} bind:value={draft} rows="2" dir="auto" disabled={!live} onkeydown={onKey} oninput={() => { if (note === 'busy') note = null; }}
      placeholder={t().collab.chat.placeholder} aria-label={t().collab.chat.placeholder} title={t().collab.chat.hint}></textarea>
    {#if near && draft.length <= MAX_CHAT}<span class="count">{t().collab.chat.left(MAX_CHAT - draft.length)}</span>{/if}
  </footer>
</aside>

<style>
  .chat-pane {
    display: flex;
    flex-direction: column;
    position: relative;
    flex: 0 0 260px;
    min-width: 0;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    --pane-text: 0.8rem;
    margin-top: var(--toolbar-overlay-h, 0px);
  }
  .chat-pane.left { order: -3; border-left: none; border-right: 1px solid var(--color-border); }
  .size-small { --pane-text: 0.72rem; }
  .size-large { --pane-text: 1rem; }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 6px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  .title { flex: 1; font-weight: 600; }
  .close {
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: none;
    color: var(--color-text-muted);
    padding: 2px 6px;
    font: inherit;
    cursor: pointer;
  }
  .close:hover { background: var(--color-btn-hover); color: var(--color-text); }

  .log { flex: 1; min-height: 0; overflow-y: auto; padding: 8px 10px; font-size: var(--pane-text); }
  .log:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
  .intro { margin: 0 0 10px; color: var(--color-text-muted); }
  .message.mention { border-left: 3px solid var(--color-primary); padding-left: 6px; }
  .presence { margin: 6px 0; color: var(--color-text-muted); font-style: italic; text-align: center; }

  .message { margin-top: 8px; padding: 4px 8px; border-radius: 6px; }
  .message.follows { margin-top: 2px; }
  .message.own { background: var(--color-btn-hover); margin-inline-start: 16px; }
  .meta { display: flex; align-items: baseline; gap: 4px; flex-wrap: wrap; }
  /* A participant's colour, pulled toward the text colour so it stays legible in every theme. */
  .name { font-weight: 600; color: color-mix(in srgb, var(--who, var(--color-text)) 65%, var(--color-text)); }
  .tag { color: var(--color-text-muted); }
  time { margin-inline-start: auto; color: var(--color-text-muted); font-size: 0.85em; }
  .text { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .text a { color: var(--color-primary); }

  .below {
    position: absolute;
    bottom: 76px;
    inset-inline: 0;
    margin: 0 auto;
    width: max-content;
    padding: 2px 10px;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
    color: var(--color-text);
    font: inherit;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }

  footer { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-top: 1px solid var(--color-border); }
  .why { margin: 0; color: var(--color-text-muted); }
  textarea {
    resize: none;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    background: var(--color-bg, var(--color-surface));
    color: var(--color-text);
    font: inherit;
    font-size: var(--pane-text);
  }
  textarea:disabled { opacity: 0.6; }
  .count { align-self: flex-end; color: var(--color-text-muted); font-size: 0.85em; }
</style>
