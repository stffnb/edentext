import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MAX_HEADING_LEVEL } from '../../export/odt';
import { seqCategoryOf, sequenceFieldText, type SeqCategory } from './caption';
import { indexEntries, indexRows } from './indexEntry';
import { bibliographyEntries, bibliographyRows } from './bibliographyEntry';
import { isCitationStyle, type CitationStyle } from '../../utils/citationStyle';
import { readVerticalMargins, pageOfElement, topInEditor, FORCE_PAGE_RECALC, type PageGrid } from './pageBreaks';

// A generated index: a block atom listing every source with its live page number — the
// headings for a table of contents, the captions of one category for a list of figures
// or tables. The node view regenerates entries from the sources + pagination and caches
// them in `entries` (persisted like a Word/LO field); round-trips to ODF/DOCX.

export type TocEntry = {
  text: string;
  level: number;
  page: number;
  /** Alphabetical index only: every page the term appears on, `page` being the first. */
  pages?: number[];
};

// Which sources the index collects. ODF has an element per family
// (text:table-of-content / -illustration-index / -table-index), Word the TOC field's
// \c switch.
export type IndexKind = 'toc' | 'figures' | 'tables' | 'alphabetical' | 'bibliography';

export function indexKindOf(value: unknown): IndexKind {
  return value === 'figures' || value === 'tables' || value === 'alphabetical' || value === 'bibliography'
    ? value
    : 'toc';
}

// The heading above the entries. An imported index keeps the one its file used
// ("Inhalt", "Sommaire", …), or none at all where the file put its heading in a
// separate paragraph (`''`); a freshly inserted one takes this.
export const INDEX_TITLES: Record<IndexKind, string> = {
  toc: 'Table of Contents',
  figures: 'List of Figures',
  tables: 'List of Tables',
  alphabetical: 'Index',
  bibliography: 'Bibliography',
};

const EMPTY_HINT: Record<IndexKind, string> = {
  toc: 'No headings yet — add an H1/H2/H3 to build the contents.',
  figures: 'No figure captions yet — insert one from the References tab.',
  tables: 'No table captions yet — insert one from the References tab.',
  alphabetical: 'No index entries yet — mark a word from the References tab.',
  bibliography: 'No citations yet — insert one from the References tab.',
};
// Enough leader dots to cross the widest gap a page can offer; fillLeaders cuts each
// row's back to what its own gap holds, measuring one dot with this sample.
const LEADER_DOTS = 200;
const LEADER_PROBE = 10;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      setTableOfContents: (index?: IndexKind) => ReturnType;
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
        parseHTML: el => (el as HTMLElement).getAttribute('data-toc-title'),
        renderHTML: attrs => (attrs.title != null ? { 'data-toc-title': String(attrs.title) } : {}),
      },
      // Deepest heading level the index lists (ODF text:outline-level, Word's TOC \o
      // range): listing more than the file asks for inflates the block by pages.
      maxLevel: {
        default: MAX_HEADING_LEVEL,
        parseHTML: el => Number((el as HTMLElement).getAttribute('data-toc-levels')) || MAX_HEADING_LEVEL,
        renderHTML: attrs => ({ 'data-toc-levels': String(attrs.maxLevel ?? MAX_HEADING_LEVEL) }),
      },
      // The character filling the gap to the page number; null = the file's index leaves
      // it empty. Round-trips to style:leader-char on the entry template.
      leader: {
        default: '.',
        parseHTML: el => (el as HTMLElement).getAttribute('data-toc-leader') || null,
        renderHTML: attrs => (attrs.leader ? { 'data-toc-leader': String(attrs.leader) } : {}),
      },
      // Where the page number ends, in cm from the text margin — the file's own stop.
      // null = the end of the column, which is where a fresh index puts it.
      tabPosCm: {
        default: null,
        parseHTML: el => Number((el as HTMLElement).getAttribute('data-toc-tab')) || null,
        renderHTML: attrs => (attrs.tabPosCm ? { 'data-toc-tab': String(attrs.tabPosCm) } : {}),
      },
      // The named paragraph style of each level's entries (ODF's per-level entry
      // template). The rows carry it as data-style, so the document stylesheet gives
      // them the file's own indent, spacing and font.
      levelStyles: {
        default: null as (string | null)[] | null,
        parseHTML: el => {
          try { return JSON.parse((el as HTMLElement).getAttribute('data-toc-styles') ?? 'null'); }
          catch { return null; }
        },
        renderHTML: attrs => (attrs.levelStyles ? { 'data-toc-styles': JSON.stringify(attrs.levelStyles) } : {}),
      },
      // Which family of index this is. Absent = a table of contents, so a stored
      // document from before the other two reads as one.
      index: {
        default: 'toc' as IndexKind,
        parseHTML: el => indexKindOf((el as HTMLElement).getAttribute('data-toc-index')),
        renderHTML: attrs => (attrs.index && attrs.index !== 'toc' ? { 'data-toc-index': String(attrs.index) } : {}),
      },
      // A bibliography's citation style: how its rows read and how a citation names a
      // source. Both formats keep it with the index, so it rides its node.
      citationStyle: {
        default: 'key' as CitationStyle,
        parseHTML: (el) => {
          const v = (el as HTMLElement).getAttribute('data-toc-cite');
          return isCitationStyle(v) ? v : 'key';
        },
        renderHTML: attrs => (attrs.citationStyle && attrs.citationStyle !== 'key' ? { 'data-toc-cite': String(attrs.citationStyle) } : {}),
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
    return ['div', mergeAttributes(HTMLAttributes, { 'data-toc': 'true' }), tocTitle(node.attrs.title, node.attrs.index)];
  },

  addCommands() {
    return {
      setTableOfContents:
        (index = 'toc') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { index } }),
    };
  },

  addNodeView() {
    return ({ editor, getPos }) => new TocView(editor, getPos as () => number);
  },
});

// `''` is a title the file deliberately doesn't have, so only a missing one defaults.
const tocTitle = (title: unknown, index: unknown): string =>
  typeof title === 'string' ? title : INDEX_TITLES[indexKindOf(index)];

type HeadingRef = { text: string; level: number; pos: number };

// A block's text with its atoms spelled out: a hard break is a line of the entry (a
// book's "Chapter 1" / title pair is two lines in LibreOffice's own index) and a
// sequence field is its number, which is most of what a caption entry says.
function entryText(node: PMNode): string {
  let raw = '';
  node.forEach((child) => {
    raw += child.type.name === 'hardBreak' ? '\n'
      : child.type.name === 'sequenceField' ? sequenceFieldText(child)
      : child.textContent;
  });
  return raw.trim();
}

// Node view: renders the title + one clickable row per heading. Recomputes on each
// pagination settle (pm-pagecount, caught on the .paper ancestor) and on doc change,
// writing entries back to the node attr — guarded by a serialized key against a loop.
class TocView {
  dom: HTMLElement;
  private editor: Editor;
  private getPos: () => number;
  private scheduled = false;
  private lastKey = '';
  private wasPaginated = false;
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

  // What the index lists, in document order: the headings down to its own level, or —
  // for a list of figures/tables — every caption paragraph counting that category. A
  // caption index has one level, as LibreOffice's does.
  private sources(): HeadingRef[] {
    const kind = indexKindOf(this.node()?.attrs?.index);
    const out: HeadingRef[] = [];
    if (kind === 'alphabetical') {
      // One source per mark; render() merges them into a row per term.
      for (const e of indexEntries(this.editor.state.doc)) {
        out.push({ text: e.key1 ? `${e.key1}: ${e.term}` : e.term, level: 1, pos: e.pos });
      }
      return out;
    }
    if (kind === 'bibliography') {
      // One row per source cited, at its first citation — no page number, as both word
      // processors print a bibliography.
      const cited = bibliographyEntries(this.editor.state.doc);
      const style = isCitationStyle(this.node()?.attrs?.citationStyle) ? this.node()!.attrs.citationStyle as CitationStyle : 'key';
      for (const row of bibliographyRows(cited, style)) {
        out.push({ text: row.text, level: 1, pos: cited.find(c => c.identifier === row.identifier)!.pos });
      }
      return out;
    }
    if (kind !== 'toc') {
      const category: SeqCategory = kind === 'tables' ? 'table' : 'figure';
      this.editor.state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        let has = false;
        node.forEach((child) => {
          if (child.type.name === 'sequenceField' && seqCategoryOf(child.attrs.category as string) === category) has = true;
        });
        const text = has ? entryText(node) : '';
        if (text) out.push({ text, level: 1, pos });
        return false;
      });
      return out;
    }
    const max = Math.min(MAX_HEADING_LEVEL, Number(this.node()?.attrs?.maxLevel) || MAX_HEADING_LEVEL);
    this.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const text = entryText(node);
        const level = Math.min(MAX_HEADING_LEVEL, (node.attrs.level as number) ?? 1);
        if (text && level <= max) out.push({ text, level, pos });
      }
    });
    return out;
  }

  private grid(): PageGrid {
    return readVerticalMargins(this.editor.view.dom as HTMLElement).grid;
  }

  private pageOf(pos: number, grid: PageGrid): number {
    const el = this.editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!el || el.nodeType !== 1) return 1;
    return pageOfElement(this.editor.view, el, grid);
  }

  private render(): void {
    if (this.editor.isDestroyed || !this.dom.isConnected) return;
    const grid = this.grid();
    let heads = this.sources();
    let entries: TocEntry[];
    if (indexKindOf(this.node()?.attrs?.index) === 'alphabetical') {
      // A term marked five times is one row with five page numbers, and the row jumps
      // to the first of them.
      const marks = heads.map(h => ({ ...h, page: this.pageOf(h.pos, grid) }));
      const rows = indexRows(marks.map(m => ({ term: m.text, key1: '', page: m.page })));
      entries = rows.map(r => ({ text: r.text, level: 1, page: r.pages[0], pages: r.pages }));
      heads = rows.map(r => marks.find(m => m.text === r.text)!);
    } else {
      entries = heads.map(h => ({ text: h.text, level: h.level, page: this.pageOf(h.pos, grid) }));
    }
    const key = JSON.stringify(entries);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.paint(entries, heads);
      this.syncAttr(entries);
    }
    this.paginate();
  }

  // The index is a block atom: it has no inner document positions for pagination to put
  // a spacer at, so one longer than a page breaks itself — the row that would cross the
  // boundary takes the gap to the next page's content top as its margin.
  private paginate(): void {
    const rows = Array.from(this.dom.querySelectorAll<HTMLElement>('.toc-entry'));
    if (!rows.length) return;
    const view = this.editor.view;
    const vm = readVerticalMargins(view.dom as HTMLElement);
    for (const row of rows) row.style.marginTop = '';
    // Read every natural top first: applying a gap moves each row below it, and one
    // reflow for the whole index beats one per row.
    const tops = rows.map(row => topInEditor(view, row));
    let shift = 0;
    let moved = false;
    rows.forEach((row, i) => {
      const top = tops[i] + shift;
      const page = Math.max(1, Math.floor(top / vm.cycle) + 1);
      if (top + row.offsetHeight <= (page - 1) * vm.cycle + vm.top + vm.contentHeight) return;
      const gap = page * vm.cycle + vm.top - top;
      if (gap <= 0) return;
      row.style.marginTop = `${gap}px`;
      shift += gap;
      moved = true;
    });
    // The index just changed height, and pagination measured the old one.
    if (moved !== this.wasPaginated) {
      this.wasPaginated = moved;
      view.dispatch(view.state.tr.setMeta('addToHistory', false).setMeta(FORCE_PAGE_RECALC, true));
    }
  }

  private paint(entries: TocEntry[], heads: HeadingRef[]): void {
    this.dom.textContent = '';
    const titleText = tocTitle(this.node()?.attrs?.title, this.node()?.attrs?.index);
    if (titleText) {
      const title = document.createElement('div');
      title.className = 'toc-title';
      title.textContent = titleText;
      this.dom.appendChild(title);
    }

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'toc-empty';
      empty.textContent = EMPTY_HINT[indexKindOf(this.node()?.attrs?.index)];
      this.dom.appendChild(empty);
      return;
    }

    const noPage = indexKindOf(this.node()?.attrs?.index) === 'bibliography';
    const fill = !noPage && typeof this.node()?.attrs?.leader === 'string' ? String(this.node()!.attrs.leader) : '';
    const levelStyles = this.node()?.attrs?.levelStyles as (string | null)[] | null | undefined;
    entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = `toc-entry toc-level-${e.level}`;
      const levelStyle = levelStyles?.[e.level - 1];
      if (levelStyle) row.dataset.style = levelStyle;
      const text = document.createElement('span');
      text.className = 'toc-text';
      e.text.split('\n').forEach((part, li) => {
        if (li) text.appendChild(document.createElement('br'));
        text.appendChild(document.createTextNode(part));
      });
      if (noPage) {
        row.append(text);
      } else {
        const leader = document.createElement('span');
        leader.className = 'toc-leader';
        // Real fill characters, as a word processor draws them: they scale with the font
        // and reach the PDF as text. The row clips whatever the gap has no room for.
        leader.textContent = fill.repeat(fill ? LEADER_DOTS : 0);
        const page = document.createElement('span');
        page.className = 'toc-page';
        page.textContent = e.pages ? e.pages.join(', ') : String(e.page);
        row.append(text, leader, page);
      }
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
    this.stopAtTab();
    this.fillLeaders();
  }

  // Pull the rows' right edge in to the index's own tab stop, so the page numbers end
  // where the file puts them rather than at the column's edge.
  private stopAtTab(): void {
    const cm = Number(this.node()?.attrs?.tabPosCm);
    this.dom.style.paddingRight = '';
    if (!(cm > 0)) return;
    const inset = this.dom.clientWidth - (cm * 96) / 2.54;
    if (inset > 1) this.dom.style.paddingRight = `${Math.round(inset)}px`;
  }

  // As many leader dots as the gap holds. The row clips the rest on screen, but nothing
  // else does: 200 of them reach the PDF, the clipboard and every measurement as text.
  private fillLeaders(): void {
    const range = document.createRange();
    // One dot's advance, probed once per font: the levels have styles of their own, and
    // measuring level 1's dot for a smaller level 3 leaves its row short of the number.
    const advances = new Map<string, number>();
    for (const el of this.dom.querySelectorAll<HTMLElement>('.toc-leader')) {
      const fill = el.textContent?.[0];
      if (!fill) continue;
      const cs = getComputedStyle(el);
      const key = `${fill}|${cs.fontSize}|${cs.fontFamily}|${cs.fontWeight}|${cs.fontStyle}`;
      let one = advances.get(key);
      if (one == null) {
        el.textContent = fill.repeat(LEADER_PROBE);
        range.selectNodeContents(el);
        one = range.getBoundingClientRect().width / LEADER_PROBE;
        advances.set(key, one);
      }
      el.textContent = one > 0 ? fill.repeat(Math.max(0, Math.floor(el.getBoundingClientRect().width / one))) : '';
    }
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
