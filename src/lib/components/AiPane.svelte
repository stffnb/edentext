<script module lang="ts">
  import type { ChatMessage } from '../ai/client';
  import type { Command, Target } from '../ai/commands';
  import { loadAiChat, saveAiChat } from '../storage/aiChat';

  // A command's reply is a proposal: it reaches the document by its buttons only.
  type Proposal = { kind: Command['kind']; target: Target; applied: boolean };
  // `historyAt`: the history's length when a question was sent, so editing or regenerating
  // it cuts the history there; `revs`: the tracked changes a reply made; `files` and
  // `context`: the files a question came with and their text, which is never stored.
  type Entry = { role: 'user' | 'assistant'; text: string; tools: string[]; error: string; proposal?: Proposal; historyAt?: number; revs?: string[]; files?: string[]; context?: string };

  // The conversation outlives the pane being closed and a reload: it is kept with the document.
  const stored = loadAiChat<{ entries: Entry[]; history: ChatMessage[] }>();
  let entries = $state<Entry[]>(Array.isArray(stored?.entries) ? stored.entries : []);
  let history: ChatMessage[] = Array.isArray(stored?.history) ? stored.history : [];
  let prefill = $state<string | null>(null);
  let sendPrefill = false;

  /** Fills the chat field, or sends `text` at once, as the pane opens or while it is open. */
  export function askAi(text: string, send = false): void {
    sendPrefill = send;
    prefill = text;
  }

  /** A new document starts a new chat — the old one talks about other paragraphs. */
  export function resetAiChat(): void {
    entries = [];
    history = [];
    saveAiChat(null);
  }
</script>

<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { untrack } from 'svelte';
  import { t } from '../i18n/i18n.svelte';
  import { aiConfig, aiSettings, docBudget, setAi } from '../storage/ai.svelte';
  import { showChanges, setShowChanges } from '../storage/markup.svelte';
  import { whenUnlocked } from '../storage/trackChanges.svelte';
  import { revisions, shownRange } from '../editor/extensions/trackChanges';
  import { aiErrorText, isAbort, streamChat } from '../ai/client';
  import { blockTexts, contentToDom, htmlToSlice, stripFences } from '../ai/doc';
  import { TextSelection } from '@tiptap/pm/state';
  import { splitDocumentHtml } from '../ai/dialect';
  import { COMMANDS, captureTarget, commandLabel, commandName, commandRequest, expandCustom, insertAtCursor, insertBelowTarget, parseCommand, replaceTarget, uiLanguage } from '../ai/commands';
  import { runTurn, startRequest, endRequest, type AiHost } from '../ai/tools';
  import { readSource, sourcesBlock, SOURCE_ACCEPT, type Source } from '../ai/sources';
  import { LANGUAGES } from '../storage/documentLanguage';
  import Icon from './ribbon/Icon.svelte';
  import PaneResize from './PaneResize.svelte';

  // Copilot's chat pane: questions about the document with the document as context, and
  // changes the assistant makes through its tools — text edits as tracked changes under
  // its own author, which the Review pane accepts or rejects like anyone else's.
  let { editor, host, onClose, onSettings }: { editor: Editor | null; host?: AiHost; onClose: () => void; onSettings: () => void } = $props();

  let question = $state('');
  let busy = $state(false);
  let list = $state<HTMLElement | null>(null);
  let field = $state<HTMLTextAreaElement | null>(null);
  let request: AbortController | null = null;
  // Sent while a turn runs: shown at once, read by the turn after its next round of tools,
  // or sent as the next turn when it ends without one.
  let queued: string[] = [];
  // The entry the running request writes into; a queued message waits below it.
  let replying = $state(-1);

  function startReply(): Entry {
    entries.push({ role: 'assistant', text: '', tools: [], error: '' });
    replying = entries.length - 1;
    return entries[replying];
  }
  let configured = $derived(!!aiConfig());
  // Written once a reply is complete, not per streamed token; history changes only then too.
  $effect(() => {
    const snapshot = $state.snapshot(entries).map(({ context: _, ...e }) => e);
    if (!busy) saveAiChat({ entries: snapshot, history });
  });
  // Settings ▸ AI can dock the pane left of the pages; the editor row orders it first.
  let left = $derived(aiSettings().side === 'left');
  // The selection goes with every question (serializeDoc); the chip shows that it does.
  let selected = $state('');

  const bump = () => docVersion++;
  $effect(() => {
    const ed = editor;
    if (!ed) return;
    const read = () => {
      const { from, to } = ed.state.selection;
      const text = shownRange(ed.state.doc, from, to, ' ', ' ').replace(/\s+/g, ' ').trim();
      selected = text.length > 40 ? text.slice(0, 40) + '…' : text;
    };
    read();
    ed.on('update', bump);
    ed.on('selectionUpdate', read);
    ed.on('update', read);
    return () => { ed.off('selectionUpdate', read); ed.off('update', read); ed.off('update', bump); };
  });

  function clearSelection() {
    if (editor) editor.commands.setTextSelection(editor.state.selection.to);
  }

  const SUGGESTIONS = ['summarize', 'keyPoints', 'proofread'] as const;
  // The rewrite presets for the selection; translate waits in the field for its language.
  const PRESETS = COMMANDS.filter((c) => c.preset);
  const runPreset = (c: Command) => (c.preset === 'translate' ? askAi('/translate ') : void send(`/${c.name}`));

  // Keeps the newest message in view while it streams.
  $effect(() => {
    void entries.length;
    void entries[entries.length - 1]?.text;
    if (list) list.scrollTop = list.scrollHeight;
  });

  $effect(() => () => stop());

  // Dragged wider or narrower by its left edge, as an editor's side bar; kept per browser.
  const WIDTH_KEY = 'edentext-ai-width';
  const MIN_WIDTH = 260;
  const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * 0.6));
  const clampWidth = (w: number) => Math.round(Math.min(maxWidth(), Math.max(MIN_WIDTH, w)));
  let width = $state(clampWidth((() => { try { return Number(localStorage.getItem(WIDTH_KEY)) || 320; } catch { return 320; } })()));

  function setWidth(w: number) {
    width = clampWidth(w);
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* not kept */ }
  }

  $effect(() => {
    // A command sent from the menu while a turn runs waits for it to end.
    if (prefill === null || !field || (sendPrefill && busy)) return;
    const el = field;
    const text = prefill;
    prefill = null;
    if (sendPrefill) return void untrack(() => send(text));
    // An empty prefill only focuses the field, keeping a half-typed question.
    if (text) question = text;
    menuIndex = 0;
    menuHidden = false;
    queueMicrotask(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  });

  function stop() {
    request?.abort();
    if (request) endRequest(request);
    request = null;
    queued = [];
    busy = false;
  }

  async function send(text = question, target?: Target, again?: Pick<Entry, 'files' | 'context'>) {
    const q = text.trim();
    const cfg = aiConfig();
    // A saved command stands for its prompt and runs as a chat turn, the tools included.
    const custom = cfg && expandCustom(q, cfg.commands);
    const parsed = custom ? null : parseCommand(q);
    if (!q || !cfg || !editor || (busy && parsed)) return;
    if (text === question) question = '';
    recall = -1;
    // Attached files go with the next question that starts a turn; a queued one waits.
    const files = again ?? (busy || !attached.length ? {} : { files: attached.map((s) => s.name), context: sourcesBlock(attached, docBudget(cfg) / 2) });
    if (!again && files.files) attached = [];
    attachError = '';
    if (parsed) return command(q, parsed, target, files);
    entries.push({ role: 'user', text: q, tools: [], error: '', historyAt: history.length, ...files });
    if (busy) return void queued.push(custom ?? q);
    let reply = startReply();
    const author = t().ai.author;
    const before = revisions(editor.state.doc).filter((r) => r.author === author).length;
    busy = true;
    let asked = custom ?? q;
    let context = files.context;
    let mine: AbortController;
    for (;;) {
      mine = request = startRequest();
      const known = new Set(aiRevisionIds(editor));
      try {
        await runTurn({
          cfg, editor, history, question: asked, author, host, context,
          onText: (d) => (reply.text += d),
          onTool: (s) => reply.tools.push(s),
          signal: mine.signal,
          takeQueued: () => { const q = queued; queued = []; if (q.length) reply = startReply(); return q; },
        });
      } catch (e) {
        if (!isAbort(e)) reply.error = aiErrorText(e, t().ai.errors, cfg.endpoint);
      } finally {
        endRequest(mine);
        const made = aiRevisionIds(editor).filter((id) => !known.has(id));
        if (made.length) reply.revs = [...(reply.revs ?? []), ...made];
      }
      if (request !== mine || !queued.length) break;
      asked = queued.join('\n\n');
      context = undefined;
      queued = [];
      reply = startReply();
    }
    if (request === mine) { request = null; busy = false; }
    // Tracked edits nobody can see would look like nothing happened.
    if (!showChanges() && revisions(editor.state.doc).filter((r) => r.author === author).length > before) setShowChanges(true);
  }

  async function command(q: string, parsed: NonNullable<ReturnType<typeof parseCommand>>, kept?: Target, files: Pick<Entry, 'files' | 'context'> = {}) {
    const cfg = aiConfig();
    if (!cfg || !editor) return;
    entries.push({ role: 'user', text: q, tools: [], error: '', historyAt: history.length, ...files });
    const reply = startReply();
    if ('unknown' in parsed) return void (reply.error = t().ai.unknownCommand(parsed.unknown));
    // Regenerated or edited, a command rewrites the selection it was first sent with.
    const target = kept ?? captureTarget(editor.state);
    if (parsed.command.kind === 'rewrite' && !target.html) return void (reply.error = t().ai.needSelection);
    const made = commandRequest(parsed.command, parsed.arg, editor.state, target, uiLanguage(), docBudget(cfg), files.context);
    if (!made) return void (reply.error = t().ai.needInstruction);
    reply.proposal = { kind: parsed.command.kind, target, applied: false };
    busy = true;
    const mine = (request = startRequest());
    try {
      await streamChat(cfg, made.request, (d) => (reply.text += d), mine.signal);
      // A follow-up such as "more formal still" reads as a chat turn about this one.
      history.push({ role: 'user', content: made.asked }, { role: 'assistant', content: reply.text });
    } catch (e) {
      if (!isAbort(e)) reply.error = aiErrorText(e, t().ai.errors, cfg.endpoint);
    } finally {
      endRequest(mine);
      if (request === mine) { request = null; busy = false; }
    }
  }

  function apply(e: Entry, place: typeof replaceTarget) {
    if (!editor || !e.proposal) return;
    if (place(editor, e.proposal.target, e.text)) e.proposal.applied = true;
    else e.error = t().ai.selectionChanged;
  }

  const aiRevisionIds = (ed: Editor) => [...new Set(revisions(ed.state.doc).filter((r) => r.author === t().ai.author).map((r) => r.id))];

  // The replies' tracked changes still pending, re-read as the document changes.
  let docVersion = $state(0);
  let pendingIds = $derived.by(() => {
    void docVersion;
    return editor && entries.some((e) => e.revs?.length) ? new Set(aiRevisionIds(editor)) : new Set<string>();
  });
  const pending = (e: Entry) => e.revs?.filter((id) => pendingIds.has(id)) ?? [];

  // Keep or discard everything one reply changed, in one undoable step.
  function settle(e: Entry, accept: boolean) {
    const ids = pending(e);
    if (!editor || !ids.length) return;
    const ready = editor;
    whenUnlocked(() => (accept ? ready.commands.acceptRevision(ids) : ready.commands.rejectRevision(ids)));
  }

  // Sends question i again, as typed or edited: the replies after it go, and with them
  // the changes they left pending; the history is cut back to where it was sent.
  function resend(i: number, text: string) {
    const asked = entries[i];
    if (busy || asked?.role !== 'user' || asked.historyAt == null) return;
    const target = entries[i + 1]?.proposal?.target;
    // A file's text is kept for this session only; after a reload the question goes without it.
    const files = asked.context ? { files: asked.files, context: asked.context } : {};
    for (const e of entries.slice(i)) settle(e, false);
    history.length = Math.min(history.length, asked.historyAt);
    entries.splice(i);
    editing = -1;
    void send(text, target, files);
  }

  // Files attached to the next question, read to text in the browser.
  let attached = $state<Source[]>([]);
  let attachError = $state('');
  let picker = $state<HTMLInputElement | null>(null);
  let dragging = $state(false);

  async function attach(files: Iterable<File>) {
    if (!editor) return;
    attachError = '';
    for (const file of files) {
      try {
        const source = await readSource(file, editor.schema);
        attached = [...attached.filter((s) => s.name !== source.name), source];
      } catch {
        attachError = t().ai.attachFailed(file.name);
      }
    }
  }

  function onDrop(e: DragEvent) {
    dragging = false;
    if (!e.dataTransfer?.files.length || !configured) return;
    e.preventDefault();
    void attach(e.dataTransfer.files);
  }

  let editing = $state(-1);
  let editText = $state('');

  // The reply as it shows, so a paste elsewhere keeps its formatting.
  async function copy(i: number, from: HTMLElement) {
    const content = from.closest('.msg')?.querySelector<HTMLElement>('.content');
    // No clipboard API outside a secure context (a self-hosted copy over plain HTTP).
    if (!content || !navigator.clipboard) return;
    const html = content.innerHTML, plain = content.innerText;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    } catch {
      await navigator.clipboard.writeText(plain).catch(() => {});
    }
    copied = i;
    setTimeout(() => { if (copied === i) copied = -1; }, 1500);
  }
  let copied = $state(-1);

  // ¶12 or ¶12–14 in a reply is a paragraph number as the model read the document; a
  // click selects it. Numbers are re-resolved on click, so later inserts can shift them.
  const CITE = /¶\s?(\d+)(?:\s?[–-]\s?(\d+))?/g;
  function linkCitations(root: HTMLElement) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits: Text[] = [];
    while (walker.nextNode()) if ((walker.currentNode as Text).data.includes('¶')) hits.push(walker.currentNode as Text);
    for (const node of hits) {
      const parts: (string | HTMLElement)[] = [];
      let last = 0;
      for (const m of node.data.matchAll(CITE)) {
        parts.push(node.data.slice(last, m.index));
        const a = Object.assign(document.createElement('button'), { className: 'cite', textContent: m[0], title: t().ai.jumpTo });
        a.dataset.from = m[1];
        a.dataset.to = m[2] ?? m[1];
        parts.push(a);
        last = m.index! + m[0].length;
      }
      if (last) node.replaceWith(...parts, node.data.slice(last));
    }
  }

  function jump(ev: MouseEvent) {
    const cite = (ev.target as HTMLElement).closest<HTMLElement>('.cite');
    if (!cite || !editor) return;
    const blocks = blockTexts(editor.state.doc);
    const a = blocks.find((b) => b.n === Number(cite.dataset.from));
    const b = blocks.find((x) => x.n === Number(cite.dataset.to)) ?? a;
    if (!a || !b) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, a.from, Math.max(a.from, b.to))).scrollIntoView());
    view.focus();
  }

  // Typing `/` lists the commands, filtered by name or label, and `/translate ` the
  // languages, one of which sends at once; Esc hides the list.
  const TARGETS = [...new Set(LANGUAGES.map((l) => l.label))];
  let menuIndex = $state(0);
  let menuHidden = $state(false);
  let matches = $derived.by((): { name: string; label: string; language?: boolean }[] => {
    const lang = /^\/translate\s+([^\n]*)$/i.exec(question);
    if (lang && !menuHidden) return TARGETS.filter((l) => l.toLowerCase().includes(lang[1].trim().toLowerCase())).map((l) => ({ name: l, label: '', language: true }));
    if (menuHidden || !/^\/\S*$/.test(question)) return [];
    const q = question.slice(1).toLowerCase();
    const all = [
      ...COMMANDS.map((c) => ({ name: c.name, label: commandLabel(c, t().ai) })),
      ...aiSettings().commands.map((c) => ({ name: commandName(c.name), label: c.prompt.trim().split('\n')[0] }))
        .filter((c) => c.name && !COMMANDS.some((b) => b.name === c.name)),
    ];
    return all.filter((c) => c.name.startsWith(q) || c.label.toLowerCase().includes(q));
  });

  function pick(i: number) {
    const c = matches[i];
    if (c.language) { question = ''; return void send(`/translate ${c.name}`); }
    question = `/${c.name} `;
    field?.focus();
  }

  // A reply as document content: parsed through the schema, re-rendered once a frame.
  function render(node: HTMLElement, html: string) {
    let frame = 0;
    const paint = (h: string) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!editor) return;
        // A draft's header and footer show as a small line above and below its body.
        const { body, zones } = splitDocumentHtml(stripFences(h));
        const line = (z: (typeof zones)[number]) => Object.assign(document.createElement('div'), { className: 'zone-line', textContent: new DOMParser().parseFromString(z.html, 'text/html').body.textContent ?? '' });
        node.replaceChildren(
          ...zones.filter((z) => z.zone === 'header').map(line),
          ...(body ? [contentToDom(htmlToSlice(body, editor.state).content, editor.schema)] : []),
          ...zones.filter((z) => z.zone === 'footer').map(line),
        );
        linkCitations(node);
      });
    };
    paint(html);
    return { update: paint, destroy: () => cancelAnimationFrame(frame) };
  }

  // Up and Down on the field's first or last line step through the questions sent, as a
  // shell does; stepping past the newest brings back the draft.
  let recall = -1;
  let draft = '';

  function step(e: KeyboardEvent, by: number) {
    const sent = entries.filter((x) => x.role === 'user').map((x) => x.text);
    const field = e.currentTarget as HTMLTextAreaElement;
    const caret = field.selectionStart;
    if (caret !== field.selectionEnd) return;
    if (by < 0 ? question.slice(0, caret).includes('\n') : question.slice(caret).includes('\n')) return;
    const at = recall < 0 ? sent.length : recall;
    const next = Math.min(sent.length, Math.max(0, at + by));
    if (next === at) return;
    e.preventDefault();
    if (recall < 0) draft = question;
    recall = next === sent.length ? -1 : next;
    question = recall < 0 ? draft : sent[next];
  }

  function onKeydown(e: KeyboardEvent) {
    if (matches.length) {
      const by = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (by) { e.preventDefault(); menuIndex = (menuIndex + by + matches.length) % matches.length; return; }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); pick(Math.min(menuIndex, matches.length - 1)); return; }
      if (e.key === 'Escape') { e.preventDefault(); menuHidden = true; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
    else if (e.key === 'ArrowUp') step(e, -1);
    else if (e.key === 'ArrowDown') step(e, 1);
  }
</script>

<aside class="ai-pane" class:left class:dragging aria-label={t().ai.name} style:flex-basis="{width}px"
  ondragover={(e) => { if (configured && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); dragging = true; } }}
  ondragleave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dragging = false; }}
  ondrop={onDrop}>
  <PaneResize {width} min={MIN_WIDTH} {left} label={t().ai.paneWidth} onWidth={setWidth} onReset={() => setWidth(320)} />
  <header>
    <Icon name="sparkle" size={16} />
    <span class="title">{t().ai.name}</span>
    <button class="icon" onclick={resetAiChat} disabled={busy || !entries.length} title={t().ai.newChat} aria-label={t().ai.newChat}>
      <Icon name="newDoc" size={16} />
    </button>
    <button class="icon" onclick={onSettings} title={t().settings.title} aria-label={t().settings.title}>
      <Icon name="settings" size={16} />
    </button>
    <button class="icon" onclick={onClose} title={t().common.close} aria-label={t().common.close}>
      <Icon name="close" size={16} />
    </button>
  </header>

  <div class="messages" bind:this={list}>
    {#if !entries.length}
      <p class="intro">{t().ai.intro}</p>
      <div class="chips">
        {#each SUGGESTIONS as s (s)}
          <button class="chip" disabled={!configured || busy} onclick={() => send(t().ai.suggestions[s])}>{t().ai.suggestions[s]}</button>
        {/each}
      </div>
    {/if}
    {#each entries as e, i (i)}
      {#if e.role === 'user' && editing === i}
        <div class="msg user editing">
          <!-- svelte-ignore a11y_autofocus -->
          <textarea bind:value={editText} rows="3" autofocus aria-label={t().ai.editMessage}
            onkeydown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); resend(i, editText); } else if (ev.key === 'Escape') editing = -1; }}></textarea>
          <div class="acts">
            <button class="act" onclick={() => (editing = -1)}>{t().common.cancel}</button>
            <button class="act primary" disabled={!editText.trim()} onclick={() => resend(i, editText)}>{t().ai.send}</button>
          </div>
        </div>
      {:else if e.role === 'user'}
        <div class="msg user">{e.text}{#if e.files?.length}<span class="files">{#each e.files as f (f)}<span class="file"><Icon name="attach" size={12} />{f}</span>{/each}</span>{/if}{#if !busy && e.historyAt != null}<button class="icon edit" onclick={() => { editing = i; editText = e.text; }} title={t().ai.editMessage} aria-label={t().ai.editMessage}><Icon name="pencil" size={12} /></button>{/if}</div>
      {:else}
        <div class="msg assistant">
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          {#if e.text}<div class="content" use:render={e.text} onclick={jump}></div>{/if}
          {#each e.tools as line, k (k)}<div class="tool">✓ {line}</div>{/each}
          {#if e.error}<div class="error" role="alert">{e.error}</div>{/if}
          {#if busy && i === replying}<div class="working" role="status"><span class="spinner" aria-hidden="true"></span>{t().ai.working}</div>{/if}
          {#if pending(e).length && !(busy && i === replying)}
            <div class="acts round">
              <span class="tool">{t().ai.pendingChanges(pending(e).length)}</span>
              <button class="act primary" onclick={() => settle(e, true)}>{t().ai.keepChanges}</button>
              <button class="act" onclick={() => settle(e, false)}>{t().ai.undoChanges}</button>
            </div>
          {/if}
          {#if !(busy && i === replying) && (e.text || (i === entries.length - 1 && entries[i - 1]?.historyAt != null))}
            <div class="tools-row">
              {#if e.text}
                <button class="icon" onclick={(ev) => copy(i, ev.currentTarget)} title={copied === i ? t().ai.copied : t().ai.copy} aria-label={t().ai.copy}>
                  <Icon name={copied === i ? 'check' : 'copy'} size={14} />
                </button>
              {/if}
              {#if i === entries.length - 1 && !busy && entries[i - 1]?.role === 'user' && entries[i - 1].historyAt != null}
                <button class="icon" onclick={() => resend(i - 1, entries[i - 1].text)} title={t().ai.regenerate} aria-label={t().ai.regenerate}>
                  <Icon name="update" size={14} />
                </button>
              {/if}
            </div>
          {/if}
          {#if e.text && !(busy && i === replying)}
            {#if e.proposal?.applied}
              <div class="tool">✓ {t().ai.applied}</div>
            {:else if e.proposal?.kind === 'rewrite'}
              <div class="acts">
                <button class="act primary" onclick={() => apply(e, replaceTarget)}>{t().ai.replace}</button>
                <button class="act" onclick={() => apply(e, insertBelowTarget)}>{t().ai.insertBelow}</button>
              </div>
            {:else if e.proposal}
              <!-- Only a draft is content; a chat reply is mostly talk, and Copy takes what is not. -->
              <button class="link" onclick={() => { if (editor && e.proposal) { insertAtCursor(editor, e.text, host); e.proposal.applied = true; } }}>{t().ai.insertAtCursor}</button>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  <footer>
    {#if !configured}
      <p class="notice">{t().ai.notConfigured}</p>
    {:else}
      {#if matches.length}
        <div class="menu" role="listbox" aria-label={t().ai.commandsTitle}>
          {#each matches as c, k (c.name)}
            <button role="option" aria-selected={k === menuIndex} class:on={k === menuIndex} onmousedown={(ev) => ev.preventDefault()} onclick={() => pick(k)}>
              <span class="cmd">{c.language ? '' : '/'}{c.name}</span><span class="label">{c.label}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="ask">
        {#if selected}
          <div class="sel">
            <span class="sel-text"><b>{t().ai.selection}:</b> «{selected}»</span>
            <button class="icon" onclick={clearSelection} title={t().ai.clearSelection} aria-label={t().ai.clearSelection}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <div class="chips-row presets">
            {#each PRESETS as c (c.name)}
              <button class="chip" disabled={busy} onclick={() => runPreset(c)}>{t().ai.presets[c.preset!]}</button>
            {/each}
          </div>
        {/if}
        {#if attached.length || attachError}
          <div class="chips-row">
            {#each attached as s (s.name)}
              <span class="sel"><span class="sel-text"><Icon name="attach" size={12} /> {s.name}</span>
                <button class="icon" onclick={() => (attached = attached.filter((x) => x !== s))} title={t().ai.removeFile} aria-label={t().ai.removeFile}><Icon name="close" size={12} /></button>
              </span>
            {/each}
            {#if attachError}<span class="error" role="alert">{attachError}</span>{/if}
          </div>
        {/if}
        <textarea bind:this={field} bind:value={question} rows="3" placeholder={aiSettings().mode === 'chat' ? t().ai.placeholder : t().ai.placeholderEdit} onkeydown={onKeydown} oninput={() => { menuIndex = 0; menuHidden = false; }}></textarea>
        <div class="row">
          <input bind:this={picker} type="file" multiple accept={SOURCE_ACCEPT} hidden
            onchange={(e) => { const f = e.currentTarget.files; if (f) void attach([...f]); e.currentTarget.value = ''; }} />
          <button class="icon clip" onclick={() => picker?.click()} title={t().ai.attach} aria-label={t().ai.attach}><Icon name="attach" size={16} /></button>
          <!-- Read at send: a switch while the assistant works applies from the next turn. -->
          <div class="modes" role="radiogroup" aria-label={t().ai.modeLabel} title={t().ai.modeLabel}>
            {#each ['chat', 'edit'] as const as m (m)}
              <button role="radio" aria-checked={aiSettings().mode === m} class:on={aiSettings().mode === m} onclick={() => setAi({ mode: m })}>
                {m === 'chat' ? t().ai.modeChat : t().ai.modeEdit}
              </button>
            {/each}
          </div>
          {#if busy && !question.trim()}
            <button class="send" onclick={stop}>{t().ai.stop}</button>
          {:else}
            <button class="send" disabled={!question.trim()} onclick={() => send()}>{t().ai.send}</button>
          {/if}
        </div>
      </div>
    {/if}
    <p class="note">{t().ai.disclaimer}</p>
  </footer>
</aside>

<style>
  .ai-pane {
    display: flex;
    flex-direction: column;
    position: relative;
    flex: 0 0 320px;
    min-width: 0;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    /* As the Navigator: the modern chrome's island overlays the top of the row. */
    margin-top: var(--toolbar-overlay-h, 0px);
  }

  .ai-pane.left { order: -1; border-left: none; border-right: 1px solid var(--color-border); }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
    color: var(--w-accent);
  }
  .title { flex: 1; color: var(--color-text); font-weight: 600; }

  button {
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:disabled { opacity: 0.45; cursor: default; }
  .icon { display: grid; place-items: center; padding: 3px; color: var(--color-text-muted); }
  .icon:hover:not(:disabled) { background: var(--color-btn-hover); color: var(--color-text); }

  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
  }
  .intro { margin: 0; color: var(--color-text-muted); line-height: 1.4; }
  .chips { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .chip {
    padding: 6px 12px;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    text-align: left;
  }
  .chip:hover:not(:disabled) { border-color: var(--w-accent); background: var(--w-accent-soft); }

  .msg { max-width: 100%; line-height: 1.4; overflow-wrap: anywhere; }
  .msg.user {
    align-self: flex-end;
    max-width: 85%;
    padding: 7px 11px;
    border-radius: 14px 14px 4px 14px;
    background: var(--w-accent-soft, var(--color-btn-hover));
    white-space: pre-wrap;
  }
  .msg.assistant { display: flex; flex-direction: column; gap: 4px; }
  .content :global(p) { margin: 0 0 0.5em; }
  .content :global(.zone-line) { margin: 0.3em 0; padding: 0.2em 0; border-block: 1px dashed var(--w-border); font-size: 0.85em; opacity: 0.75; }
  .content :global(h1), .content :global(h2), .content :global(h3) { margin: 0.4em 0; font-size: 1em; }
  .content :global(ul), .content :global(ol) { margin: 0 0 0.5em; padding-left: 1.4em; }
  .content :global(table) { border-collapse: collapse; margin-bottom: 0.5em; }
  .content :global(td), .content :global(th) { border: 1px solid var(--color-border); padding: 2px 4px; }
  .tool { color: var(--color-text-muted); font-size: 0.75rem; }
  .error { color: #e5534b; }
  .working { display: flex; align-items: center; gap: 6px; color: var(--color-text-muted); }
  .link { align-self: flex-start; padding: 2px 0; color: var(--w-accent); font-size: 0.75rem; }
  .link:hover { text-decoration: underline; }

  .acts { display: flex; gap: 6px; }
  .acts.round { align-items: center; flex-wrap: wrap; }
  .tools-row { display: flex; gap: 2px; margin-left: -3px; }
  .msg.user { position: relative; }
  .msg.user .edit { position: absolute; left: -22px; top: 4px; opacity: 0; }
  .msg.user:hover .edit, .msg.user .edit:focus-visible { opacity: 1; }
  .msg.user.editing { align-self: stretch; max-width: none; display: flex; flex-direction: column; gap: 6px; white-space: normal; }
  .msg.user.editing textarea { width: 100%; box-sizing: border-box; padding: 2px 0; }
  .msg.user.editing .acts { justify-content: flex-end; }
  .content :global(.cite) { padding: 0 2px; border: none; background: none; border-radius: 4px; color: var(--w-accent); font: inherit; font-weight: 600; }
  .content :global(.cite:hover) { background: var(--w-accent-soft); text-decoration: underline; }
  .act {
    padding: 3px 10px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    font-size: 0.75rem;
  }
  .act:hover { background: var(--color-btn-hover); }
  .act.primary { border-color: var(--w-accent-fill); background: var(--w-accent-fill); color: #fff; font-weight: 600; }
  .act.primary:hover { background: var(--w-accent-fill-open); }

  footer { position: relative; padding: 8px 10px; border-top: 1px solid var(--color-border); }
  .menu {
    position: absolute;
    inset: auto 10px calc(100% - 4px) 10px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface);
    box-shadow: var(--w-menu-shadow, 0 8px 28px rgba(0, 0, 0, 0.22));
  }
  .menu button { display: flex; gap: 8px; align-items: baseline; padding: 5px 8px; text-align: left; }
  .menu button.on { background: var(--w-accent-soft); }
  .menu .cmd { font-weight: 600; color: var(--w-accent); }
  .menu .label { color: var(--color-text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* One composer box: the field and its button share the border and the focus ring. */
  .ask {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
  }
  .sel {
    display: flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    max-width: 100%;
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    background: var(--w-accent-soft);
    font-size: 0.72rem;
  }
  .sel-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sel b { color: var(--w-accent); font-weight: 600; }
  .ask:focus-within { border-color: var(--w-accent); box-shadow: 0 0 0 3px var(--w-accent-soft); }
  textarea {
    resize: none;
    padding: 2px 4px;
    border: none;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
  }
  .row { display: flex; align-items: center; gap: 6px; }
  .row .send { margin-left: auto; }
  .chips-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chips-row .error { font-size: 0.72rem; }
  .presets .chip { padding: 3px 9px; font-size: 0.75rem; }
  .files { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; white-space: normal; }
  .file { display: inline-flex; align-items: center; gap: 3px; font-size: 0.72rem; opacity: 0.8; }
  .ai-pane.dragging::after { content: ''; position: absolute; inset: 4px; border: 2px dashed var(--w-accent); border-radius: 10px; background: var(--w-accent-soft); pointer-events: none; }
  .modes {
    display: flex;
    padding: 2px;
    border-radius: 8px;
    background: var(--color-btn-hover);
  }
  .modes button {
    padding: 3px 10px;
    border-radius: 6px;
    color: var(--color-text-muted);
  }
  .modes button.on { background: var(--color-surface); color: var(--color-text); font-weight: 600; box-shadow: 0 0 0 1px var(--color-border); }
  .send {
    padding: 5px 12px;
    border-radius: 8px;
    background: var(--w-accent-fill);
    color: #fff;
    font-weight: 600;
  }
  .send:hover:not(:disabled) { background: var(--w-accent-fill-open); }
  .notice { margin: 0; color: var(--color-text-muted); }
  .note { margin: 6px 0 0; color: var(--color-text-muted); font-size: 0.7rem; }
</style>
