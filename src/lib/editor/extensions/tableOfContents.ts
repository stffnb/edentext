import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MAX_HEADING_LEVEL } from '../../export/odt';

// A generated table of contents: a block atom listing every heading (levels 1–5) with its
// live page number. The node view regenerates entries from the headings + pagination and
// caches them in `entries` (persisted like a Word/LO TOC field); round-trips to ODF/DOCX.

export type TocEntry = { text: string; level: number; page: number };

// Mirrors pageBreaks.ts PAGE_GAP + Editor.svelte getCycle(): the rendered page of a
// heading is its offsetTop within .tiptap (spacers included) divided by the cycle.
const PAGE_GAP = 20;
const FALLBACK_PAGE_HEIGHT = 1123;
// The heading above the entries. An imported TOC keeps the one its file used
// ("Inhalt", "Sommaire", …); a freshly inserted one takes this.
const TITLE = 'Table of Contents';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      setTableOfContents: () => ReturnType;
    };
  }
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      title: {
        default: null as string | null,
        parseHTML: el => (el as HTMLElement).getAttribute('data-toc-title') || null,
        renderHTML: attrs => (attrs.title ? { 'data-toc-title': String(attrs.title) } : {}),
      },
      entries: {
        default: [] as TocEntry[],
        parseHTML: el => {
          try { return JSON.parse((el as HTMLElement).getAttribute('data-entries') ?? '[]'); }
          catch { return []; }
        },
        renderHTML: attrs => ({ 'data-entries': JSON.stringify(attrs.entries ?? []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': 'true' }), tocTitle(node.attrs.title)];
  },

  addCommands() {
    return {
      setTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },

  addNodeView() {
    return ({ editor, getPos }) => new TocView(editor, getPos as () => number);
  },
});

const tocTitle = (title: unknown): string => (typeof title === 'string' && title ? title : TITLE);

type HeadingRef = { text: string; level: number; pos: number };

// Node view: renders the title + one clickable row per heading. Recomputes on each
// pagination settle (pm-pagecount, caught on the .paper ancestor) and on doc change,
// writing entries back to the node attr — guarded by a serialized key against a loop.
class TocView {
  dom: HTMLElement;
  private editor: Editor;
  private getPos: () => number;
  private scheduled = false;
  private lastKey = '';
  private paper: HTMLElement | null = null;
  private onPageCount = () => this.schedule();

  constructor(editor: Editor, getPos: () => number) {
    this.editor = editor;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'toc';
    this.dom.dataset.toc = 'true';
    this.dom.setAttribute('contenteditable', 'false');

    // Mount deferred so .paper exists and the first pagination pass has run.
    requestAnimationFrame(() => {
      this.paper = this.dom.closest('.paper') as HTMLElement | null;
      this.paper?.addEventListener('pm-pagecount', this.onPageCount);
      this.render();
    });
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  // Every heading (level ≤ MAX_HEADING_LEVEL) with non-empty text, in document order.
  private headings(): HeadingRef[] {
    const out: HeadingRef[] = [];
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const text = node.textContent.trim();
        if (text) out.push({ text, level: Math.min(MAX_HEADING_LEVEL, (node.attrs.level as number) ?? 1), pos });
      }
    });
    return out;
  }

  private cycle(): number {
    const tiptap = this.editor.view.dom as HTMLElement;
    const ph = parseFloat(getComputedStyle(tiptap).getPropertyValue('--user-page-height'));
    return (Number.isFinite(ph) ? ph : FALLBACK_PAGE_HEIGHT) + PAGE_GAP;
  }

  // Rendered page of a heading: sum offsetTop up the offsetParent chain to .tiptap (the
  // live DOM already includes pagination spacers, so this is the on-page position),
  // divided by the page cycle. Mirrors topWithin/getPageForY in pageBreaks.ts.
  private pageOf(pos: number, cycle: number): number {
    const tiptap = this.editor.view.dom as HTMLElement;
    const el = this.editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!el || el.nodeType !== 1) return 1;
    let top = 0;
    let n: HTMLElement | null = el;
    while (n && n !== tiptap) {
      top += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    return Math.max(1, Math.floor(top / cycle) + 1);
  }

  private render(): void {
    if (this.editor.isDestroyed || !this.dom.isConnected) return;
    const heads = this.headings();
    const cycle = this.cycle();
    const entries: TocEntry[] = heads.map(h => ({ text: h.text, level: h.level, page: this.pageOf(h.pos, cycle) }));
    const key = JSON.stringify(entries);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.paint(entries, heads);
    this.syncAttr(entries);
  }

  private paint(entries: TocEntry[], heads: HeadingRef[]): void {
    this.dom.textContent = '';
    const title = document.createElement('div');
    title.className = 'toc-title';
    title.textContent = tocTitle(this.node()?.attrs?.title);
    this.dom.appendChild(title);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = 'No headings yet — add an H1/H2/H3 to build the contents.';
      this.dom.appendChild(empty);
      return;
    }

    entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = `toc-entry toc-level-${e.level}`;
      const text = document.createElement('span');
      text.className = 'toc-text';
      text.textContent = e.text;
      const leader = document.createElement('span');
      leader.className = 'toc-leader';
      const page = document.createElement('span');
      page.className = 'toc-page';
      page.textContent = String(e.page);
      row.append(text, leader, page);
      const pos = heads[i]?.pos;
      if (pos != null) {
        row.addEventListener('mousedown', ev => {
          ev.preventDefault();
          ev.stopPropagation();
          this.goTo(pos);
        });
      }
      this.dom.appendChild(row);
    });
  }

  // Scroll the heading into view and drop the cursor into it.
  private goTo(pos: number): void {
    const dom = this.editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.editor.chain().focus().setTextSelection(pos + 1).run();
  }

  private node(): PMNode | null {
    const pos = this.getPos();
    return typeof pos === 'number' ? this.editor.state.doc.nodeAt(pos) : null;
  }

  private syncAttr(entries: TocEntry[]): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const node = this.editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'tableOfContents') return;
    if (JSON.stringify(node.attrs.entries ?? []) === JSON.stringify(entries)) return;
    const tr = this.editor.state.tr.setNodeAttribute(pos, 'entries', entries).setMeta('addToHistory', false);
    this.editor.view.dispatch(tr);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'tableOfContents') return false;
    this.schedule();
    return true;
  }

  // Own the mouse on entry rows (navigation) but let clicks on the TOC background reach
  // ProseMirror so the block can be selected + deleted.
  stopEvent(event: Event): boolean {
    return event.type.startsWith('mouse') && !!(event.target as HTMLElement)?.closest?.('.toc-entry');
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.paper?.removeEventListener('pm-pagecount', this.onPageCount);
  }
}
