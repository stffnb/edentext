<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { tick as settle } from 'svelte';
  import { TextSelection } from '@tiptap/pm/state';
  import { outline, type OutlineEntry } from '../editor/extensions/outline';
  import { bookmarks, goToTarget } from '../editor/extensions/bookmark';
  import type { MenuEntry } from '../editor/contextMenuItems';
  import BookmarkRow from './BookmarkRow.svelte';
  import ContextMenu from './ContextMenu.svelte';
  import PaneResize from './PaneResize.svelte';
  import PaneOptions, { layoutItems } from './PaneOptions.svelte';
  import { t } from '../i18n/i18n.svelte';
  import { navigatorSettings, setNavigator, NAVIGATOR_TABS, NAVIGATOR_WIDTH, type NavigatorTab } from '../storage/navigator.svelte';
  import { clampPaneWidth } from '../storage/panes.svelte';

  // LibreOffice's Navigator and Word's Navigation pane: the chapters of the document as a
  // tree to fold, click to jump, and the chapter operations beside them and on a right
  // click. The other tabs list the bookmarks and the tables and pictures to jump to.
  let { editor, tick, onClose }: {
    editor: Editor | null;
    tick: number;
    onClose: () => void;
  } = $props();

  const settings = $derived(navigatorSettings());
  const left = $derived(settings.side === 'left');

  const MIN_WIDTH = 180;
  const width = $derived(clampPaneWidth(settings.width, MIN_WIDTH));
  const setWidth = (w: number) => setNavigator({ width: clampPaneWidth(w, MIN_WIDTH) });

  let chapters = $derived.by<OutlineEntry[]>(() => (tick < 0 || !editor ? [] : outline(editor.state.doc)));

  // A row's identity across edits, which shift every position after them: its level and
  // text, and which of the same pair it is. Folding is kept by it.
  type Row = OutlineEntry & { key: string; parent: boolean };
  let rows = $derived.by<Row[]>(() => {
    const seen = new Map<string, number>();
    return chapters.map((c, i) => {
      const id = `${c.level}:${c.text}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return { ...c, key: `${id}#${n}`, parent: (chapters[i + 1]?.level ?? 0) > c.level };
    });
  });

  let folded = $state(new Set<string>());
  const isFolded = (r: Row) => r.parent && folded.has(r.key);

  // What the tree shows: every row with no folded chapter above it.
  let visible = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    let under: number | null = null;
    for (const r of rows) {
      if (under !== null && r.level > under) continue;
      under = isFolded(r) ? r.level : null;
      out.push(r);
    }
    return out;
  });

  function setFolded(keys: Iterable<string>) { folded = new Set(keys); }
  function toggle(r: Row, open = isFolded(r)) {
    const next = new Set(folded);
    if (open) next.delete(r.key); else next.add(r.key);
    folded = next;
  }
  const foldBelow = (level: number) => setFolded(rows.filter((r) => r.parent && r.level >= level).map((r) => r.key));

  type Target = { pos: number; label: string };

  // Tables and pictures anywhere in the document, in document order.
  let objects = $derived.by<{ tables: Target[]; images: Target[] }>(() => {
    const tables: Target[] = [];
    const images: Target[] = [];
    if (tick < 0 || !editor) return { tables, images };
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tables.push({ pos, label: t().navigator.tableN(tables.length + 1) });
      } else if (node.type.name === 'image') {
        images.push({ pos, label: String(node.attrs.alt || t().navigator.imageN(images.length + 1)) });
      }
      return true;
    });
    return { tables, images };
  });

  // One row per name, as the bookmark window lists them.
  let marks = $derived(tick < 0 || !editor ? [] : [...new Set(bookmarks(editor.state.doc).map((b) => b.name))]);

  function jumpTo(pos: number) {
    if (!editor) return;
    const { state, view } = editor;
    const at = Math.min(Math.max(pos, 0), state.doc.content.size);
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))).scrollIntoView());
    view.focus();
  }

  // The caret's own chapter, or the folded one it lies in, so the pane shows where the reader is.
  let currentKey = $derived.by<string | null>(() => {
    if (tick < 0 || !editor) return null;
    const head = editor.state.selection.head;
    let found: string | null = null;
    for (const r of visible) if (r.pos <= head) found = r.key;
    return found;
  });

  let list: HTMLElement | undefined = $state();
  const rowEl = (key: string) => list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`) ?? null;

  // The current row stays in view as the caret moves through a long outline.
  $effect(() => {
    if (currentKey && settings.tab === 'headings') rowEl(currentKey)?.scrollIntoView({ block: 'nearest' });
  });

  // One row of the tree takes Tab focus, the arrow keys move it (WAI-ARIA tree view).
  let focusKey = $state<string | null>(null);
  const tabKey = $derived(visible.some((r) => r.key === focusKey) ? focusKey : (currentKey ?? visible[0]?.key ?? null));

  function focusRow(r: Row | undefined) {
    if (!r) return;
    focusKey = r.key;
    void settle().then(() => rowEl(r.key)?.focus());
  }

  function rowKey(e: KeyboardEvent, r: Row) {
    const i = visible.findIndex((v) => v.key === r.key);
    if (e.key === 'ArrowDown') focusRow(visible[i + 1]);
    else if (e.key === 'ArrowUp') focusRow(visible[i - 1]);
    else if (e.key === 'Home') focusRow(visible[0]);
    else if (e.key === 'End') focusRow(visible[visible.length - 1]);
    else if (e.key === 'ArrowRight') { if (isFolded(r)) toggle(r, true); else if (r.parent) focusRow(visible[i + 1]); }
    else if (e.key === 'ArrowLeft') {
      if (r.parent && !isFolded(r)) toggle(r, false);
      else focusRow(visible.slice(0, i).reverse().find((v) => v.level < r.level));
    } else if (e.key === 'Enter' || e.key === ' ') jumpTo(r.pos);
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(chapterMenu(r), box.left + 16, box.bottom, e.currentTarget as HTMLElement);
    } else return;
    e.preventDefault();
  }

  const move = (c: OutlineEntry, dir: -1 | 1) => editor?.chain().focus().moveChapter(c.pos, dir).run();
  const shift = (c: OutlineEntry, d: -1 | 1) => editor?.chain().focus().shiftChapterLevel(c.pos, d).run();

  function selectChapter(c: OutlineEntry) {
    if (!editor) return;
    const { state, view } = editor;
    view.dispatch(state.tr.setSelection(TextSelection.between(state.doc.resolve(c.pos + 1), state.doc.resolve(c.end - 1))).scrollIntoView());
    view.focus();
  }

  // A chapter's context menu, placed in the window so the pane's scroller cannot clip it.
  let menu = $state<{ items: MenuEntry[]; x: number; y: number; from: HTMLElement } | null>(null);

  function openMenu(items: MenuEntry[], x: number, y: number, from: HTMLElement) {
    menu = { items, x, y, from };
  }

  function closeMenu() {
    const from = menu?.from;
    menu = null;
    // Escape hands focus back to what opened the menu; a command has moved it on.
    queueMicrotask(() => { if (!document.activeElement || document.activeElement === document.body) from?.focus(); });
  }

  function chapterMenu(r: Row): MenuEntry[] {
    const can = editor?.can();
    const n = t().navigator;
    return [
      { kind: 'item', label: n.moveUp, disabled: !can?.moveChapter(r.pos, -1), run: () => move(r, -1) },
      { kind: 'item', label: n.moveDown, disabled: !can?.moveChapter(r.pos, 1), run: () => move(r, 1) },
      { kind: 'item', label: n.promote, disabled: !can?.shiftChapterLevel(r.pos, -1), run: () => shift(r, -1) },
      { kind: 'item', label: n.demote, disabled: !can?.shiftChapterLevel(r.pos, 1), run: () => shift(r, 1) },
      { kind: 'sep' },
      { kind: 'item', label: n.selectChapter, run: () => selectChapter(r) },
      { kind: 'item', label: n.deleteChapter, run: () => editor?.chain().focus().deleteChapter(r.pos).run() },
      ...(r.parent ? [{ kind: 'sep' } as const, { kind: 'item', label: isFolded(r) ? n.expand : n.collapse, run: () => toggle(r) } as const] : []),
    ];
  }

  function optionsMenu(): MenuEntry[] {
    const n = t().navigator;
    const deepest = Math.max(1, ...rows.map((r) => r.level));
    const hasParents = rows.some((r) => r.parent);
    return [
      { kind: 'item', label: n.expandAll, disabled: !hasParents, run: () => setFolded([]) },
      { kind: 'item', label: n.collapseAll, disabled: !hasParents, run: () => foldBelow(1) },
      { kind: 'sub', label: n.expandToLevel, disabled: !hasParents, items: Array.from({ length: deepest }, (_, i) => ({ kind: 'item', label: n.levelN(i + 1), run: () => foldBelow(i + 1) })) },
      { kind: 'sep' },
      ...layoutItems(settings, setNavigator),
      { kind: 'item', label: n.wrap, checked: settings.wrap, run: () => setNavigator({ wrap: !settings.wrap }) },
    ];
  }

  const tabLabel = (tab: NavigatorTab) => ({ headings: t().navigator.headings, bookmarks: t().navigator.bookmarks, objects: t().navigator.objects })[tab];

  function tabKeys(e: KeyboardEvent) {
    const i = NAVIGATOR_TABS.indexOf(settings.tab);
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const tab = NAVIGATOR_TABS[(i + step + NAVIGATOR_TABS.length) % NAVIGATOR_TABS.length];
    setNavigator({ tab });
    void settle().then(() => (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  }
</script>

<aside class="navigator-pane size-{settings.size}" class:left class:wrap={settings.wrap} aria-label={t().navigator.title} style:flex-basis="{width}px">
  <PaneResize {width} min={MIN_WIDTH} {left} label={t().navigator.paneWidth} onWidth={setWidth} onReset={() => setWidth(NAVIGATOR_WIDTH)} />
  <header>
    <span class="title">{t().navigator.title}</span>
    <PaneOptions label={t().navigator.options} {left} items={optionsMenu} />
    <button class="icon" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  <div class="tabs" role="tablist" tabindex="-1" onkeydown={tabKeys}>
    {#each NAVIGATOR_TABS as tab (tab)}
      <button role="tab" id="nav-tab-{tab}" aria-controls="nav-panel" aria-selected={settings.tab === tab} tabindex={settings.tab === tab ? 0 : -1} onclick={() => setNavigator({ tab })}>{tabLabel(tab)}</button>
    {/each}
  </div>

  <div class="body" id="nav-panel" role="tabpanel" aria-labelledby="nav-tab-{settings.tab}">
    {#if settings.tab === 'headings'}
      {#if !rows.length}
        <p class="empty">{t().navigator.empty}</p>
      {:else}
        <ul class="chapters" role="tree" aria-label={t().navigator.headings} bind:this={list}>
          {#each visible as r (r.key)}
            <li role="treeitem" data-key={r.key} aria-level={r.level} aria-expanded={r.parent ? !isFolded(r) : undefined}
              aria-selected={r.key === currentKey} class:current={r.key === currentKey}
              tabindex={r.key === tabKey ? 0 : -1} style:padding-inline-start="calc(2px + {r.level - 1} * 0.9em)"
              onclick={() => { focusKey = r.key; jumpTo(r.pos); }} onkeydown={(e) => rowKey(e, r)} onfocus={() => (focusKey = r.key)}
              oncontextmenu={(e) => { e.preventDefault(); focusKey = r.key; openMenu(chapterMenu(r), e.clientX, e.clientY, e.currentTarget); }}
              title={r.text}>
              <!-- The twisty is a mouse target; the keyboard folds with the arrow keys. -->
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <span class="twisty" class:hidden={!r.parent} onclick={(e) => { e.stopPropagation(); toggle(r); }}
                title={isFolded(r) ? t().navigator.expand : t().navigator.collapse}>
                <svg width="8" height="8" viewBox="0 0 8 8" class:folded={isFolded(r)} aria-hidden="true"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="label">{r.text || t().navigator.untitled}</span>
              <span class="ops">
                <button tabindex="-1" onclick={(e) => { e.stopPropagation(); move(r, -1); }} title={t().navigator.moveUp} aria-label={t().navigator.moveUp}>↑</button>
                <button tabindex="-1" onclick={(e) => { e.stopPropagation(); move(r, 1); }} title={t().navigator.moveDown} aria-label={t().navigator.moveDown}>↓</button>
                <button tabindex="-1" onclick={(e) => { e.stopPropagation(); shift(r, -1); }} title={t().navigator.promote} aria-label={t().navigator.promote}>←</button>
                <button tabindex="-1" onclick={(e) => { e.stopPropagation(); shift(r, 1); }} title={t().navigator.demote} aria-label={t().navigator.demote}>→</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if settings.tab === 'bookmarks'}
      {#if !marks.length}
        <p class="empty">{t().navigator.noBookmarks}</p>
      {:else}
        <div class="marks">
          {#each marks as name (name)}
            <BookmarkRow
              {name}
              onGoTo={() => editor && goToTarget(editor.view, name)}
              onRemove={() => editor?.chain().focus().removeBookmark(name).run()}
              onRename={(to) => !!editor?.chain().focus().renameBookmark(name, to).run()}
            />
          {/each}
        </div>
      {/if}
    {:else}
      {#if !objects.tables.length && !objects.images.length}
        <p class="empty">{t().navigator.noObjects}</p>
      {/if}
      {#each [
        { label: t().navigator.tables, items: objects.tables },
        { label: t().navigator.images, items: objects.images },
      ] as group}
        {#if group.items.length}
          <div class="group">{group.label}</div>
          <ul>
            {#each group.items as o (o.pos)}
              <li><button class="jump" onclick={() => jumpTo(o.pos)} title={o.label}>{o.label}</button></li>
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}
  </div>

  {#if menu}
    <div class="menu-layer">
      <ContextMenu top={menu.y} left={menu.x} items={menu.items} onClose={closeMenu} />
    </div>
  {/if}
</aside>

<style>
  .navigator-pane {
    display: flex;
    flex-direction: column;
    position: relative;
    flex: 0 0 240px;
    min-width: 0;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    --nav-text: 0.8rem;
    /* The modern chrome's toolbar island overlays the top of the row. The ribbon sets
       the variable to 0, being in flow. */
    margin-top: var(--toolbar-overlay-h, 0px);
  }
  /* Outermost of the panes docked left, as it is innermost on the right (App.svelte). */
  .navigator-pane.left { order: -4; border-left: none; border-right: 1px solid var(--color-border); }
  .size-small { --nav-text: 0.72rem; }
  .size-large { --nav-text: 1rem; }

  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 6px 6px 10px;
  }
  .title { flex: 1; font-weight: 600; }

  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 6px;
    border-bottom: 1px solid var(--color-border);
    font-size: var(--nav-text);
  }
  .tabs button {
    padding: 4px 6px 5px;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--color-text-muted);
  }
  .tabs button:hover { color: var(--color-text); }
  .tabs button[aria-selected='true'] { color: var(--color-text); border-bottom-color: var(--color-primary); font-weight: 600; }

  .body { flex: 1; min-height: 0; overflow-y: auto; font-size: var(--nav-text); padding-bottom: 6px; }

  .empty { padding: 12px 10px; color: var(--color-text-muted); }

  .group {
    padding: 8px 10px 2px;
    color: var(--color-text-muted);
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  ul { list-style: none; margin: 0; padding: 2px 0 0; }
  .marks { padding: 1px 4px; }

  li {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px;
  }

  .chapters li {
    margin: 0 4px;
    border-radius: var(--radius);
    cursor: pointer;
    outline: none;
  }
  .chapters li:hover { background: var(--color-btn-hover); }
  .chapters li:focus-visible { box-shadow: inset 0 0 0 1.5px var(--color-primary); }
  /* The reader's chapter: a light tint of the accent and a bar, apart from the hover grey. */
  .chapters li.current {
    background: color-mix(in srgb, var(--color-primary) 22%, transparent);
    box-shadow: inset 2px 0 0 var(--color-primary);
  }
  .chapters li.current:focus-visible { box-shadow: inset 2px 0 0 var(--color-primary), inset 0 0 0 1.5px var(--color-primary); }

  .twisty {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: calc(1lh + 6px);
    align-self: flex-start;
    color: var(--color-text-muted);
  }
  .twisty.hidden { visibility: hidden; }
  .twisty svg { transition: transform 0.12s; }
  .twisty svg.folded { transform: rotate(-90deg); }
  .twisty:hover { color: var(--color-text); }

  .label {
    flex: 1;
    min-width: 0;
    padding: 3px 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wrap .label { white-space: normal; overflow-wrap: anywhere; }

  button {
    border: none;
    border-radius: var(--radius);
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .jump {
    flex: 1;
    min-width: 0;
    padding: 3px 4px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .jump:hover { background: var(--color-btn-hover); }
  .wrap .jump { white-space: normal; overflow-wrap: anywhere; }

  /* The chapter operations stay out of the way until the row is worth acting on. */
  .ops { display: none; gap: 0; align-self: flex-start; padding-top: 2px; }
  li:hover .ops, li.current .ops { display: flex; }
  .ops button {
    padding: 1px 3px;
    color: var(--color-text-muted);
    line-height: 1;
  }
  .ops button:hover { background: var(--color-btn-hover); color: var(--color-text); }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    color: var(--color-text-muted);
  }
  .icon:hover { background: var(--color-btn-hover); color: var(--color-text); }

  /* The menus sit in the window, so the pane's scroller cannot clip them. */
  .menu-layer { position: fixed; inset: 0; z-index: 300; pointer-events: none; }
  .menu-layer :global(.cm-menu) { pointer-events: auto; }
</style>
