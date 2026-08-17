<script lang="ts">
  import type { Editor } from '@tiptap/core';
  import { TextSelection } from '@tiptap/pm/state';
  import { outline, type OutlineEntry } from '../editor/extensions/outline';
  import { bookmarks } from '../editor/extensions/bookmark';
  import { t } from '../i18n/i18n.svelte';

  // LibreOffice's Navigator and Word's Navigation pane: the chapters of the document,
  // click to jump, and the four chapter operations beside them. Below them the other
  // things LibreOffice lists — tables, pictures, bookmarks — as plain jump targets.
  let { editor, tick, onClose }: {
    editor: Editor | null;
    tick: number;
    onClose: () => void;
  } = $props();

  let chapters = $derived.by<OutlineEntry[]>(() => (tick < 0 || !editor ? [] : outline(editor.state.doc)));

  type Target = { pos: number; label: string };

  // Tables and pictures anywhere in the document, in document order.
  let objects = $derived.by<{ tables: Target[]; images: Target[]; marks: Target[] }>(() => {
    const tables: Target[] = [];
    const images: Target[] = [];
    if (tick < 0 || !editor) return { tables, images, marks: [] };
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') {
        tables.push({ pos, label: t().navigator.tableN(tables.length + 1) });
      } else if (node.type.name === 'image') {
        images.push({ pos, label: String(node.attrs.alt || t().navigator.imageN(images.length + 1)) });
      }
      return true;
    });
    return { tables, images, marks: bookmarks(editor.state.doc).map((b) => ({ pos: b.from, label: b.name })) };
  });

  function jumpTo(pos: number) {
    if (!editor) return;
    const { state, view } = editor;
    const at = Math.min(Math.max(pos, 0), state.doc.content.size);
    view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))).scrollIntoView());
    view.focus();
  }

  // The caret's own chapter, so the pane shows where the reader is.
  let currentPos = $derived.by<number | null>(() => {
    if (tick < 0 || !editor) return null;
    const head = editor.state.selection.head;
    let found: number | null = null;
    for (const c of chapters) if (c.pos <= head) found = c.pos;
    return found;
  });

  const move = (c: OutlineEntry, dir: -1 | 1) => editor?.chain().focus().moveChapter(c.pos, dir).run();
  const shift = (c: OutlineEntry, d: -1 | 1) => editor?.chain().focus().shiftChapterLevel(c.pos, d).run();
</script>

<aside class="navigator-pane" aria-label={t().navigator.title}>
  <header>
    <span class="title">{t().navigator.title}</span>
    <button class="close" onclick={onClose} aria-label={t().common.close} title={t().common.close}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
  </header>

  {#if !chapters.length}
    <p class="empty">{t().navigator.empty}</p>
  {:else}
    <ul class="chapters">
      {#each chapters as c (c.pos)}
        <li style="padding-left: {4 + (c.level - 1) * 12}px" class:current={c.pos === currentPos}>
          <button class="jump" onclick={() => jumpTo(c.pos)} title={c.text}>
            {c.text || t().navigator.untitled}
          </button>
          <span class="ops">
            <button onclick={() => move(c, -1)} title={t().navigator.moveUp} aria-label={t().navigator.moveUp}>↑</button>
            <button onclick={() => move(c, 1)} title={t().navigator.moveDown} aria-label={t().navigator.moveDown}>↓</button>
            <button onclick={() => shift(c, -1)} title={t().navigator.promote} aria-label={t().navigator.promote}>←</button>
            <button onclick={() => shift(c, 1)} title={t().navigator.demote} aria-label={t().navigator.demote}>→</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  {#each [
    { label: t().navigator.tables, items: objects.tables },
    { label: t().navigator.images, items: objects.images },
    { label: t().navigator.bookmarks, items: objects.marks },
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
</aside>

<style>
  .navigator-pane {
    display: flex;
    flex-direction: column;
    flex: 0 0 240px;
    min-width: 0;
    overflow-y: auto;
    border-left: 1px solid var(--color-border);
    background: var(--color-surface);
    font-family: var(--font-sans);
    font-size: 0.8rem;
    /* The modern chrome's toolbar island overlays the top of the row; a margin, not
       padding, or the sticky header would scroll up under it. The ribbon sets the
       variable to 0, being in flow. */
    margin-top: var(--toolbar-overlay-h, 0px);
  }

  header {
    display: flex;
    align-items: center;
    gap: 6px;
    position: sticky;
    top: 0;
    padding: 8px 10px;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }
  .title { flex: 1; font-weight: 600; }

  .empty { padding: 12px 10px; color: var(--color-text-muted); }

  .group {
    padding: 8px 10px 2px;
    color: var(--color-text-muted);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  ul { list-style: none; margin: 0; padding: 0; }

  li {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px 1px 4px;
  }
  li.current { background: var(--color-btn-hover); }

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

  /* The chapter operations stay out of the way until the row is worth acting on. */
  .ops { display: none; gap: 0; }
  li:hover .ops, li.current .ops { display: flex; }
  .ops button {
    padding: 1px 3px;
    color: var(--color-text-muted);
    line-height: 1;
  }
  .ops button:hover { background: var(--color-btn-hover); color: var(--color-text); }

  .close {
    padding: 2px 6px;
    color: var(--color-text-muted);
  }
  .close:hover { background: var(--color-btn-hover); color: var(--color-text); }
</style>
