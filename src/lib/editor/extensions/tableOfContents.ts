import { Node, mergeAttributes } from '@tiptap/core';
import { REBUILDING } from './trackChanges';
import { styleSheet } from '../../styles/sheet.svelte';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MAX_HEADING_LEVEL } from '../../styles/headings';
import { seqCategoryOf, type SeqCategory } from './caption';
import { blockText, headingNumbers } from './outline';
import { indexEntries, indexRows } from './indexEntry';
import { bibliographyEntries, bibliographyRows } from './bibliographyEntry';
import { isCitationStyle, type CitationStyle } from '../../utils/citationStyle';
import { t } from '../../i18n/i18n.svelte';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { pageOfElement, topInEditor, scheduleFieldRound, isSplitPane, FORCE_PAGE_RECALC, type FieldWrite, type PageGrid, type VMargins } from './pageBreaks';

// A generated index: a block atom listing every source with its page number — the
// headings for a table of contents, the captions of one category for a list of figures
// or tables. Like a Word/LO field it shows its cached `entries` until updated
// (`updateIndexes`); `entries: null` has none yet and generates on mount.

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

// The heading above the entries, in the language the app speaks — the same names the
// References menu offers. An imported index keeps the one its file used ("Inhalt",
// "目錄", …), or none at all where the file put its heading in a separate paragraph
// (`''`); an inserted one gets this written onto it, so the exports carry it too.
export function indexTitle(kind: IndexKind): string {
  return t().ribbon.indexes[kind];
}

// Only for a node that reached an exporter without a title and outside the app's own
// reach; everything the user inserts carries its own.
export const INDEX_TITLES: Record<IndexKind, string> = {
  toc: 'Table of Contents',
  figures: 'List of Figures',
  tables: 'List of Tables',
  alphabetical: 'Index',
  bibliography: 'Bibliography',
};
// Enough leader dots to cross the widest gap a page can offer; fillLeaders cuts each
// row's back to what its own gap holds, measuring one dot with this sample.
// The gap between an index's columns where the file names none: Word's, for its `INDEX \c`.
export const INDEX_COLUMN_GAP_CM = 1.27;
const LEADER_DOTS = 200;
const LEADER_PROBE = 10;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      setTableOfContents: (index?: IndexKind) => ReturnType;
      updateIndexes: (mode?: IndexUpdate) => ReturnType;
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
      // Columns the rows flow through (Word's `INDEX \c`, the ODF index section's
      // style:columns), filled down each page in turn; null = one.
      columns: {
        default: null as number | null,
        parseHTML: el => Number((el as HTMLElement).getAttribute('data-toc-columns')) || null,
        renderHTML: attrs => (attrs.columns > 1 ? { 'data-toc-columns': String(attrs.columns) } : {}),
      },
      columnGapCm: {
        default: null as number | null,
        parseHTML: el => Number((el as HTMLElement).getAttribute('data-toc-column-gap')) || null,
        renderHTML: attrs => (attrs.columnGapCm ? { 'data-toc-column-gap': String(attrs.columnGapCm) } : {}),
      },
      // Whether the rows carry a page number at all: Word's `TOC \n`, an ODF entry
      // template naming no <text:index-entry-page-number/>. false = the text alone.
      pageNumbers: {
        default: true,
        parseHTML: el => (el as HTMLElement).getAttribute('data-toc-pages') !== 'off',
        renderHTML: attrs => (attrs.pageNumbers === false ? { 'data-toc-pages': 'off' } : {}),
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
        default: [] as TocEntry[] | null,
        parseHTML: el => {
          try { return JSON.parse((el as HTMLElement).getAttribute('data-entries') ?? '[]'); }
          catch { return null; }
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
        ({ commands, state, tr }) => {
          // An index has no form for a change; over a selection the text goes recorded.
          if (state.selection.empty) tr.setMeta(REBUILDING, true);
          return commands.insertContent({ type: this.name, attrs: { index, title: indexTitle(index), entries: null } });
        },
      // Every index of the document regenerates, as LibreOffice's Update All does; 'pages'
      // keeps each index's rows and renews only their page numbers, Word's other choice.
      updateIndexes:
        (mode = 'all') =>
        ({ editor, dispatch }) => {
          if (dispatch) editor.view.dom.dispatchEvent(new CustomEvent(INDEX_UPDATE, { bubbles: true, detail: mode }));
          return true;
        },
    };
  },

  addNodeView() {
    return ({ editor, node, getPos, view }) => new TocView(editor, node, getPos as () => number, view);
  },
});

const INDEX_UPDATE = 'pm-index-update';
export type IndexUpdate = 'all' | 'pages';

// Which fresh row each cached one is, in order and each used once: by its text, else with
// its number label and spacing set aside (a file's "1.\tIntroduction", our "1 Introduction").
// -1 where none reads the same — a heading since removed or retitled.
export function matchRows(cached: { text: string }[], fresh: { text: string }[]): number[] {
  const bare = (t: string) => t.replace(/\s+/g, ' ').trim().replace(/^(?:\d+|[A-Z])(?:[.:](?:\d+|[A-Z]))*[.:)]?\s+/, '');
  const used = new Set<number>();
  const out = cached.map(() => -1);
  for (const key of [(t: string) => t, bare]) {
    cached.forEach((c, i) => {
      if (out[i] >= 0) return;
      const j = fresh.findIndex((f, k) => !used.has(k) && key(f.text) === key(c.text));
      if (j >= 0) { out[i] = j; used.add(j); }
    });
  }
  return out;
}

// `''` is a title the file deliberately doesn't have, so only a missing one defaults.
const tocTitle = (title: unknown, index: unknown): string =>
  typeof title === 'string' ? title : indexTitle(indexKindOf(index));

type HeadingRef = { text: string; level: number; pos: number };

// Where a page boundary breaks the rows: in one column the row taking the gap as its top
// margin; in columns the row each further block starts at, and the block before's height.
type Break = { at: number; gap: number; height: number };

const tocViews = new Set<TocView>();

// A grid cell that catches up after a pause (Editor.svelte) missed its main view's
// repaints meanwhile: its indexes take that view's last layout.
export function catchUpIndexes(view: EditorView): void {
  for (const v of tocViews) if (v.view === view) v.adoptMain();
}

// Node view: renders the title + one clickable row per entry. While `updating` it
// regenerates on each pagination settle (pm-pagecount, caught on the .paper ancestor) in
// the field round, writing its entries back on the round's transaction, until a pass
// changes nothing; otherwise it paints the cached entries.
class TocView {
  dom: HTMLElement;
  private editor: Editor;
  // The view this index renders in, which its rows are measured against.
  readonly view: EditorView;
  private getPos: () => number;
  private lastKey = '';
  private lastLook = '';
  private wasPaginated: boolean | string = false;
  private breaks: Break[] = [];
  private painted: [TocEntry[], (HeadingRef | undefined)[] | null] | null = null;
  private updating: IndexUpdate | false;
  private paper: HTMLElement | null = null;
  private onPageCount = () => this.schedule();
  private onUpdate = (e: Event) => {
    this.updating = (e as CustomEvent).detail === 'pages' && Array.isArray(this.node()?.attrs?.entries) ? 'pages' : 'all';
    this.schedule();
  };

  // A font arriving after the rows were drawn changes the gap each leader was cut for.
  private onFonts = () => { if (!this.editor.isDestroyed) this.fillLeaders(); };

  constructor(editor: Editor, node: PMNode, getPos: () => number, view: EditorView) {
    this.editor = editor;
    this.view = view;
    this.getPos = getPos;

    this.dom = document.createElement('div');
    this.dom.className = 'toc';
    this.dom.dataset.toc = 'true';
    this.dom.setAttribute('contenteditable', 'false');
    this.applyFlow(node);
    this.updating = Array.isArray(node.attrs.entries) ? false : 'all';
    this.lastLook = lookOf(node);

    tocViews.add(this);
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    // Mount deferred so .paper exists and the first pagination pass has run.
    requestAnimationFrame(() => {
      if (isSplitPane(this.view)) return this.adoptMain();
      this.paper = this.dom.closest('.paper') as HTMLElement | null;
      this.paper?.addEventListener('pm-pagecount', this.onPageCount);
      this.paper?.addEventListener(INDEX_UPDATE, this.onUpdate);
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.editor.isDestroyed || isSplitPane(this.view)) return;
    scheduleFieldRound(this.editor.view, this, (vm) => this.measure(vm));
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
        const text = has ? blockText(node) : '';
        if (text) out.push({ text, level: 1, pos });
        return false;
      });
      return out;
    }
    const max = Math.min(MAX_HEADING_LEVEL, Number(this.node()?.attrs?.maxLevel) || MAX_HEADING_LEVEL);
    // Chapter numbering is drawn by CSS counters on the page, which no text walk can
    // read — a contents row carries the same label, counted the same way.
    const doc = this.editor.state.doc;
    const numbers = headingNumbers(doc, styleSheet().outline);
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const text = blockText(node);
        const level = Math.min(MAX_HEADING_LEVEL, (node.attrs.level as number) ?? 1);
        if (text && level <= max) out.push({ text: (numbers.get(pos)?.label ?? '') + text, level, pos });
      }
    });
    return out;
  }

  private pageOf(pos: number, grid: PageGrid): number {
    const el = this.editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!el || el.nodeType !== 1) return 1;
    return pageOfElement(this.editor.view, el, grid);
  }

  private measure(vm: VMargins): FieldWrite | void {
    if (this.editor.isDestroyed || !this.dom.isConnected) return;
    const grid = vm.grid;
    const cached = this.node()?.attrs?.entries as TocEntry[] | null | undefined;
    let heads: (HeadingRef | undefined)[] | null = null;
    let entries: TocEntry[];
    if (!this.updating && Array.isArray(cached)) {
      entries = cached;
    } else if (indexKindOf(this.node()?.attrs?.index) === 'alphabetical') {
      // A term marked five times is one row with five page numbers, and the row jumps
      // to the first of them.
      const marks = this.sources().map(h => ({ ...h, page: this.pageOf(h.pos, grid) }));
      const rows = indexRows(marks.map(m => ({ term: m.text, key1: '', page: m.page })));
      entries = rows.map(r => ({ text: r.text, level: 1, page: r.pages[0], pages: r.pages }));
      heads = rows.map(r => marks.find(m => m.text === r.text)!);
    } else {
      const sources = this.sources();
      heads = sources;
      entries = sources.map(h => ({ text: h.text, level: h.level, page: this.pageOf(h.pos, grid) }));
    }
    if (this.updating === 'pages' && Array.isArray(cached)) {
      // The saved rows stay as they are; each takes the page of the source it names.
      const fresh = entries;
      const found = heads!;
      const at = matchRows(cached, fresh);
      entries = cached.map((e, i) => {
        const f = fresh[at[i]];
        if (!f) return e;
        const { pages: _old, ...row } = e;
        return { ...row, page: f.page, ...(f.pages ? { pages: f.pages } : {}) };
      });
      heads = at.map(j => found[j]);
    }
    // Repaint on anything a row is drawn from: the entries, and the index's own look
    // (leader, page numbers, title, level styles). Its cached entries are what syncAttr
    // writes back, so keying on them too would chase this pass's own result.
    const node = this.node();
    this.lastLook = node ? lookOf(node) : '';
    const key = JSON.stringify([entries, this.lastLook]);
    const stale = key !== this.lastKey;
    this.lastKey = key;
    if (!stale && heads) this.updating = false;
    return (tr) => {
      if (stale) {
        this.paint(entries, heads);
        for (const twin of this.twins()) twin.paint(entries, heads);
        if (heads) this.syncAttr(entries, tr);
      }
      // The rows carry their page numbers now, so where they fall is read once every
      // field of the round has written.
      return (last) => this.paginate(last, vm);
    };
  }

  // The index is a block atom: it has no inner document positions for pagination to put
  // a spacer at, so one longer than a page breaks itself — the row that would cross the
  // boundary takes the gap to the next page's content top as its margin.
  private paginate(tr: Transaction, vm: VMargins): void {
    const rows = Array.from(this.dom.querySelectorAll<HTMLElement>('.toc-entry'));
    if (!rows.length) return;
    const breaks = this.columnCount() > 1 ? this.columnBreaks(vm, rows) : this.rowBreaks(vm, rows);
    this.applyBreaks(breaks);
    for (const twin of this.twins()) twin.applyBreaks(breaks);
    // The index just changed height, and pagination measured the old one.
    const key = this.columnCount() > 1 ? breaks.map(b => b.at).join(',') : breaks.length > 0;
    if ((key || false) !== (this.wasPaginated || false)) {
      this.wasPaginated = key;
      tr.setMeta(FORCE_PAGE_RECALC, true);
    }
  }

  private rowBreaks(vm: VMargins, rows: HTMLElement[]): Break[] {
    for (const row of rows) row.style.marginTop = '';
    // Read every natural top and height first: applying a gap moves each row below it,
    // and one reflow for the whole index beats one per row.
    const boxes = rows.map(row => [topInEditor(this.view, row), row.offsetHeight]);
    const breaks: Break[] = [];
    let shift = 0;
    rows.forEach((_, i) => {
      const top = boxes[i][0] + shift;
      // The page's own content band: its section's header and footer reach as far as
      // they do, and a section on its own paper makes the page a different height.
      const page = vm.grid.pageAt(top);
      if (top + boxes[i][1] <= vm.grid.contentBottomOf(page)) return;
      const gap = vm.grid.contentTopOf(page + 1) - top;
      if (gap <= 0) return;
      // The margin replaces the row's own space above, which its natural top included.
      const above = i > 0 ? Math.max(0, boxes[i][0] - boxes[i - 1][0] - boxes[i - 1][1]) : parseFloat(getComputedStyle(rows[0]).marginTop) || 0;
      breaks.push({ at: i, gap: gap + above, height: 0 });
      shift += gap;
    });
    return breaks;
  }

  private columnCount(): number {
    return Math.min(3, Math.max(1, Number(this.node()?.attrs?.columns) || 1));
  }

  // One block of columns per page: each column runs down to the page's content bottom
  // before the next one starts, and the last block balances its columns, as a section
  // ending in a continuous break does in both word processors.
  private columnBreaks(vm: VMargins, rows: HTMLElement[]): Break[] {
    const count = this.columnCount();
    const first = this.joinColumns(rows);
    // Margins of stacked rows collapse to the larger of the two.
    const heights = rows.map(r => {
      const cs = getComputedStyle(r);
      return r.offsetHeight + Math.max(parseFloat(cs.marginTop) || 0, parseFloat(cs.marginBottom) || 0);
    });
    const grid = vm.grid;
    let top = topInEditor(this.view, first);
    let page = grid.pageAt(top);
    let avail = grid.contentBottomOf(page) - top;
    const splits: Break[] = [];
    let col = 0;
    let h = 0;
    heights.forEach((rh, i) => {
      if (h > 0 && h + rh > avail) {
        h = 0;
        if (++col === count) {
          const next = grid.contentTopOf(page + 1);
          splits.push({ at: i, height: avail, gap: next - (top + avail) });
          page += 1;
          top = next;
          avail = grid.contentBottomOf(page) - next;
          col = 0;
        }
      }
      h += rh;
    });
    return splits;
  }

  // All rows back in the first block of columns, unsized.
  private joinColumns(rows: HTMLElement[]): HTMLElement {
    const blocks = Array.from(this.dom.querySelectorAll<HTMLElement>('.toc-cols'));
    blocks.slice(1).forEach(b => b.remove());
    const first = blocks[0];
    first.append(...rows);
    first.style.height = '';
    first.style.marginTop = '';
    first.style.columnFill = '';
    return first;
  }

  // Writes the breaks one measurement found; a split or grid pane takes its main view's,
  // since it shows the same layout and a reading of its own may catch a passing one.
  private applyBreaks(breaks: Break[]): void {
    this.breaks = breaks;
    const rows = Array.from(this.dom.querySelectorAll<HTMLElement>('.toc-entry'));
    if (this.columnCount() === 1) {
      for (const row of rows) row.style.marginTop = '';
      for (const b of breaks) if (rows[b.at]) rows[b.at].style.marginTop = `${b.gap}px`;
      return;
    }
    let block = this.joinColumns(rows);
    breaks.forEach(sp => {
      block.style.height = `${sp.height}px`;
      block.style.columnFill = 'auto';
      const next = block.cloneNode(false) as HTMLElement;
      next.style.height = '';
      next.style.columnFill = '';
      next.style.marginTop = `${Math.max(0, sp.gap)}px`;
      next.append(...rows.slice(sp.at));
      block.after(next);
      block = next;
    });
  }

  // This index in the split and grid panes of the main view it renders in.
  private twins(): TocView[] {
    if (isSplitPane(this.view)) return [];
    const pos = this.getPos();
    return [...tocViews].filter(v => v !== this && v.editor === this.editor && isSplitPane(v.view) && v.getPos() === pos);
  }

  // A pane built after its main view laid the index out starts from that layout.
  adoptMain(): void {
    const pos = this.getPos();
    const main = [...tocViews].find(v => v.editor === this.editor && !isSplitPane(v.view) && v.getPos() === pos);
    if (!main?.painted) return;
    // A twin is painted with the main view's own arrays, so identity says it is current.
    if (this.painted?.[0] !== main.painted[0] || this.painted[1] !== main.painted[1]) this.paint(...main.painted);
    if (this.breaks !== main.breaks) this.applyBreaks(main.breaks);
  }

  // A cached row jumps to the source that reads the same; heads is null for those.
  private paint(entries: TocEntry[], heads: (HeadingRef | undefined)[] | null): void {
    this.painted = [entries, heads];
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
      empty.textContent = t().index.empty[indexKindOf(this.node()?.attrs?.index)];
      this.dom.appendChild(empty);
      return;
    }

    const noPage = indexKindOf(this.node()?.attrs?.index) === 'bibliography'
      || this.node()?.attrs?.pageNumbers === false;
    const fill = !noPage && typeof this.node()?.attrs?.leader === 'string' ? String(this.node()!.attrs.leader) : '';
    const levelStyles = this.node()?.attrs?.levelStyles as (string | null)[] | null | undefined;
    let host = this.dom;
    const count = this.columnCount();
    if (count > 1) {
      host = document.createElement('div');
      host.className = 'toc-cols';
      host.style.columnCount = String(count);
      host.style.columnGap = `${Number(this.node()?.attrs?.columnGapCm) || INDEX_COLUMN_GAP_CM}cm`;
      this.dom.appendChild(host);
    }
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
      // A term heading its subentries lists no page (`pages: []`), and leads to none.
      if (noPage || e.pages?.length === 0) {
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
      row.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const sources = heads ? null : this.sources();
        const pos = heads ? heads[i]?.pos : sources![matchRows(entries, sources!)[i]]?.pos;
        if (pos != null) this.goTo(pos);
      });
      host.appendChild(row);
    });
    this.stopAtTab();
    this.fillLeaders();
  }

  // Pull the rows' right edge in to the index's own tab stop, so the page numbers end
  // where the file puts them rather than at the column's edge.
  // In columns the stop counts from each column's own edge.
  private stopAtTab(): void {
    const cm = Number(this.node()?.attrs?.tabPosCm);
    const cols = this.dom.querySelector<HTMLElement>('.toc-cols');
    const el = cols ?? this.dom;
    el.style.paddingRight = '';
    if (!(cm > 0)) return;
    const count = this.columnCount();
    const gap = cols ? parseFloat(getComputedStyle(cols).columnGap) || 0 : 0;
    const width = cols ? (cols.clientWidth - gap * (count - 1)) / count : this.dom.clientWidth;
    const inset = width - (cm * 96) / 2.54;
    if (inset <= 1) return;
    if (cols) cols.querySelectorAll<HTMLElement>('.toc-entry').forEach(r => { r.style.paddingRight = `${Math.round(inset)}px`; });
    else this.dom.style.paddingRight = `${Math.round(inset)}px`;
  }

  // As many leader dots as the gap holds. The row clips the rest on screen, but nothing
  // else does: 200 of them reach the PDF, the clipboard and every measurement as text.
  private fillLeaders(): void {
    const leaders = Array.from(this.dom.querySelectorAll<HTMLElement>('.toc-leader')).filter(el => el.textContent);
    // One dot's advance, probed once per font: the levels have styles of their own, and
    // measuring level 1's dot for a smaller level 3 leaves its row short of the number.
    const keys = leaders.map((el) => {
      const cs = getComputedStyle(el);
      return `${el.textContent![0]}|${cs.fontSize}|${cs.fontFamily}|${cs.fontWeight}|${cs.fontStyle}`;
    });
    // Every gap is read before any row is written: a write between two reads is a layout.
    const widths = leaders.map(el => el.getBoundingClientRect().width);
    const advances = new Map<string, number>();
    const range = document.createRange();
    leaders.forEach((el, i) => {
      if (advances.has(keys[i])) return;
      el.textContent = keys[i][0].repeat(LEADER_PROBE);
      range.selectNodeContents(el);
      advances.set(keys[i], range.getBoundingClientRect().width / LEADER_PROBE);
    });
    leaders.forEach((el, i) => {
      const one = advances.get(keys[i]) ?? 0;
      el.textContent = one > 0 ? keys[i][0].repeat(Math.max(0, Math.floor(widths[i] / one))) : '';
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

  private syncAttr(entries: TocEntry[], tr: Transaction): void {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const node = this.editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'tableOfContents') return;
    if (JSON.stringify(node.attrs.entries ?? []) === JSON.stringify(entries)) return;
    tr.setNodeAttribute(pos, 'entries', entries);
  }

  // The node view never calls renderHTML, so the two flow flags pageBreaks.ts reads off
  // a top-level block (pageBreak.ts) have to be written here.
  private applyFlow(node: PMNode): void {
    if (node.attrs.breakBefore === 'page') this.dom.dataset.pageBreakBefore = 'page';
    else delete this.dom.dataset.pageBreakBefore;
    if (node.attrs.sectionBreak === true) this.dom.dataset.sectionBreak = 'true';
    else delete this.dom.dataset.sectionBreak;
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'tableOfContents') return false;
    this.applyFlow(node);
    // The entries are what syncAttr just wrote back; a changed look regenerates them,
    // as changing an index's settings does in both word processors.
    const look = lookOf(node);
    if (look !== this.lastLook) {
      this.lastLook = look;
      this.updating = 'all';
      this.schedule();
    } else if (!this.updating) {
      this.schedule(); // an undo can bring other cached entries back
    }
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
    tocViews.delete(this);
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
    this.paper?.removeEventListener('pm-pagecount', this.onPageCount);
    this.paper?.removeEventListener(INDEX_UPDATE, this.onUpdate);
  }
}

// Everything a row is drawn from but the entries themselves (and the flow flags).
function lookOf(node: PMNode): string {
  const { entries: _cached, breakBefore: _b, sectionBreak: _s, ...look } = node.attrs;
  return JSON.stringify(look);
}
