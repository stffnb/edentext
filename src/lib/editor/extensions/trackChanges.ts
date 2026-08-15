import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Recorded revisions, as both word processors keep them: an insertion is text marked as
// added, a deletion is text still in the document but marked as removed — nothing is
// dropped until a change is accepted. Two marks carry it (author, date and a shared id
// per change), so a revision survives every editing operation the way a comment does.
//
// ODF stores the pair in a <text:tracked-changes> registry and points at it from the
// body; a deletion's text lives in the registry, an insertion's stays inline. Word wraps
// runs in <w:ins>/<w:del> instead, keeping a deletion's text in <w:delText>. Both are
// probed — see src/lib/export/CLAUDE.md.

export type RevisionKind = 'insertion' | 'deletion';

export type Revision = {
  kind: RevisionKind;
  id: string;
  author: string;
  date: string;
  from: number;
  to: number;
  /** The text the change covers — a deletion's is what would come back on reject. */
  text: string;
};

export function newRevisionId(): string {
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

// Whether the editor is recording. A document-level switch, like LibreOffice's Edit ▸
// Track Changes ▸ Record; the extension reads it through this option so the toolbar can
// flip it without rebuilding the editor.
export const RECORDING = new PluginKey<boolean>('trackChangesRecording');

function revisionMark(name: RevisionKind, attr: string) {
  return Mark.create({
    name,
    // The range is fixed: typing at either end is its own change, as in Word.
    inclusive: false,
    excludes: '',

    addAttributes() {
      return {
        id: { default: '', parseHTML: (el) => el.getAttribute(attr) || '', renderHTML: (a) => ({ [attr]: String(a.id ?? '') }) },
        author: { default: '', parseHTML: (el) => el.getAttribute('data-rev-author') || '', renderHTML: (a) => ({ 'data-rev-author': String(a.author ?? '') }) },
        date: { default: '', parseHTML: (el) => el.getAttribute('data-rev-date') || '', renderHTML: (a) => ({ 'data-rev-date': String(a.date ?? '') }) },
      };
    },

    parseHTML() {
      return [{ tag: `span[${attr}]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { class: `pm-${name}` }), 0];
    },
  });
}

export const Insertion = revisionMark('insertion', 'data-insertion');
export const Deletion = revisionMark('deletion', 'data-deletion');

// Every recorded change in document order, adjacent runs of one id merged.
export function revisions(doc: PMNode): Revision[] {
  const out: Revision[] = [];
  let last: Revision | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText) { last = null; return true; }
    const mark = node.marks.find((m) => m.type.name === 'insertion' || m.type.name === 'deletion');
    if (!mark) { last = null; return false; }
    const kind = mark.type.name as RevisionKind;
    const id = String(mark.attrs.id ?? '');
    if (last && last.id === id && last.kind === kind && last.to === pos) {
      last.to = pos + node.nodeSize;
      last.text += node.text ?? '';
      return false;
    }
    last = {
      kind, id,
      author: String(mark.attrs.author ?? ''),
      date: String(mark.attrs.date ?? ''),
      from: pos, to: pos + node.nodeSize, text: node.text ?? '',
    };
    out.push(last);
    return false;
  });
  return out;
}

// One colour per author, as both word processors draw revisions: LibreOffice's own author
// palette, handed out in order of first appearance. Beyond nine, authors share again.
export const REVISION_AUTHOR_COLORS = [
  '#c69200', '#0646a2', '#579d1c', '#692b9d', '#c5000b', '#008080', '#8c8400', '#35556b', '#d17600',
];

/** Author → palette index, in the order the document's revisions first name them. */
export function authorColorIndex(list: Revision[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const r of list) {
    if (!order.has(r.author)) order.set(r.author, order.size % REVISION_AUTHOR_COLORS.length);
  }
  return order;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    trackChanges: {
      /** Accept the change under the cursor, or every one when `all`. */
      acceptRevisions: (all?: boolean) => ReturnType;
      /** Reject the change under the cursor, or every one when `all`. */
      rejectRevisions: (all?: boolean) => ReturnType;
      /** Accept every range of one change, wherever the reviewing pane lists it. */
      acceptRevision: (id: string) => ReturnType;
      /** Reject every range of one change. */
      rejectRevision: (id: string) => ReturnType;
    };
  }
}

// The revisions a command applies to: all of them, or the ones the selection touches
// (an empty selection takes the change the caret sits in).
function targets(state: EditorState, all: boolean): Revision[] {
  const list = revisions(state.doc);
  if (all) return list;
  const { from, to } = state.selection;
  return list.filter((r) => (from === to ? r.from <= from && from <= r.to : r.from < to && from < r.to));
}

// Applying a change is one pass from the end, so earlier positions stay valid. The
// RECORDING meta keeps the plugin's hands off it: without it the delete below is read
// as a fresh user deletion and marked up again instead of running.
// One change by id — every range of it, which is what a paragraph boundary splits a
// change into and what the pane lists as a single revision.
function byId(state: EditorState, tr: Transaction, dispatch: unknown, id: string, accept: boolean): boolean {
  const list = revisions(state.doc).filter((r) => r.id === id);
  if (!list.length) return false;
  if (dispatch) apply(state, tr, list, accept);
  return true;
}

function apply(state: EditorState, tr: Transaction, list: Revision[], accept: boolean): void {
  const drop = accept ? 'deletion' : 'insertion';
  for (const r of [...list].sort((a, b) => b.from - a.from)) {
    if (r.kind === drop) tr.delete(r.from, r.to);
    else tr.removeMark(r.from, r.to, state.schema.marks[r.kind]);
  }
  tr.setMeta(RECORDING, true);
}

export const TrackChanges = Extension.create<{ recording: () => boolean; author: () => string }>({
  name: 'trackChanges',

  addOptions() {
    return { recording: () => false, author: () => '' };
  },

  addCommands() {
    return {
      acceptRevisions: (all = false) => ({ state, tr, dispatch }) => {
        const list = targets(state, all);
        if (!list.length) return false;
        if (dispatch) apply(state, tr, list, true);
        return true;
      },
      rejectRevisions: (all = false) => ({ state, tr, dispatch }) => {
        const list = targets(state, all);
        if (!list.length) return false;
        if (dispatch) apply(state, tr, list, false);
        return true;
      },
      acceptRevision: (id) => ({ state, tr, dispatch }) => byId(state, tr, dispatch, id, true),
      rejectRevision: (id) => ({ state, tr, dispatch }) => byId(state, tr, dispatch, id, false),
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    // The mark cannot know the document's other authors, so the colour is a decoration:
    // one class per palette slot, keyed by where the author first appears. Cached on the
    // doc — the walk is the whole document, and this runs on every view update.
    let cache: { doc: PMNode; set: DecorationSet } | null = null;
    return [
      new Plugin({
        props: {
          decorations(state) {
            if (cache?.doc === state.doc) return cache.set;
            const list = revisions(state.doc);
            const order = authorColorIndex(list);
            const set = DecorationSet.create(state.doc, list.map((r) =>
              Decoration.inline(r.from, r.to, {
                class: `pm-rev-${r.kind === 'insertion' ? 'ins' : 'del'} pm-rev-a${order.get(r.author) ?? 0}`,
              })));
            cache = { doc: state.doc, set };
            return set;
          },
        },
      }),
      new Plugin({
        key: RECORDING,
        // Typing is intercepted here rather than by a keymap: every path that inserts
        // text — a paste, an input rule, a drop — goes through appendTransaction, and
        // each would otherwise need its own hook.
        appendTransaction: (transactions, oldState, newState) => {
          if (!options.recording()) return null;
          if (!transactions.some((t) => t.docChanged)) return null;
          // Our own accept/reject and the mark pass below must not recurse.
          if (transactions.some((t) => t.getMeta(RECORDING))) return null;
          const tr = newState.tr;
          let touched = false;
          const author = options.author();
          for (const t of transactions) {
            if (!t.docChanged) continue;
            for (const step of t.steps) {
              const map = step.getMap();
              map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                if (newEnd <= newStart) return;
                const from = tr.mapping.map(newStart);
                const to = tr.mapping.map(newEnd);
                // Anything freshly in the document is an insertion; a delete never gets
                // this far, because it was turned into a mark before it ran (below).
                // Typing joins the run it continues, so a sentence is one change and not
                // one per keystroke.
                tr.addMark(from, to, newState.schema.marks.insertion.create(
                  adjacentInsertion(newState, from, author) ?? { id: newRevisionId(), author, date: new Date().toISOString() },
                ));
                touched = true;
              });
            }
          }
          return touched ? tr.setMeta(RECORDING, true).setMeta('addToHistory', false) : null;
        },

        // A deletion must not reach the document: mark the range instead. Text already
        // marked as an insertion is the author's own and is simply removed, which is
        // what both word processors do.
        filterTransaction: (tr, state) => {
          if (!options.recording() || tr.getMeta(RECORDING)) return true;
          if (!tr.docChanged || !isPureDelete(tr, state)) return true;
          const ranges: [number, number][] = [];
          for (const step of tr.steps) {
            const map = step.getMap();
            map.forEach((oldStart, oldEnd) => { if (oldEnd > oldStart) ranges.push([oldStart, oldEnd]); });
          }
          if (!ranges.length) return true;
          const marked = state.tr;
          const attrs = { id: newRevisionId(), author: options.author(), date: new Date().toISOString() };
          let any = false;
          for (const [from, to] of ranges) {
            for (const keep of keptRanges(state, from, to)) {
              marked.addMark(keep[0], keep[1], state.schema.marks.deletion.create(attrs));
              any = true;
            }
            // The author's own unaccepted insertion goes for real.
            for (const own of [...ownInsertions(state, from, to)].reverse()) marked.delete(own[0], own[1]);
          }
          if (!any && !marked.docChanged) return true;
          queueMicrotask(() => this.editor.view.dispatch(marked.setMeta(RECORDING, true)));
          return false;
        },
      }),
    ];
  },
});

// The attrs of the insertion the text just before `pos` belongs to, when the same author
// made it — what makes consecutive typing one change rather than one per keystroke.
function adjacentInsertion(state: EditorState, pos: number, author: string): Record<string, string> | null {
  const before = pos > 0 ? state.doc.resolve(pos).nodeBefore : null;
  const mark = before?.marks.find((m) => m.type.name === 'insertion');
  if (!mark || String(mark.attrs.author ?? '') !== author) return null;
  return { id: String(mark.attrs.id), author, date: String(mark.attrs.date) };
}

// A transaction that only removes content (backspace, delete, cut) — a replacement
// inserts as well, and its insertion half must still run.
function isPureDelete(tr: Transaction, state: EditorState): boolean {
  if (!tr.steps.length) return false;
  return tr.doc.content.size < state.doc.content.size
    && tr.steps.every((step) => {
      let inserted = 0;
      step.getMap().forEach((_os, _oe, ns, ne) => { inserted += ne - ns; });
      return inserted === 0;
    });
}

// The parts of [from,to) that are not the author's own pending insertion — the ones a
// delete turns into a deletion mark.
function keptRanges(state: EditorState, from: number, to: number): [number, number][] {
  const own = ownInsertions(state, from, to);
  const out: [number, number][] = [];
  let cursor = from;
  for (const [s, e] of own) {
    if (s > cursor) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}

function ownInsertions(state: EditorState, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    if (!node.marks.some((m) => m.type.name === 'insertion')) return false;
    out.push([Math.max(from, pos), Math.min(to, pos + node.nodeSize)]);
    return false;
  });
  return out;
}
