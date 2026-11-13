import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { authorColor, authorColors } from '../authorColors';
import { highlightPlugin } from './highlights';

// A comment: an annotation on a range of text. A mark, like `bookmark` — both formats
// store a range (ODF office:annotation + office:annotation-end, DOCX
// w:commentRangeStart/-End) and the pane has to find the text a comment points at.
// The whole comment rides the mark's attrs, so it needs no store of its own: two runs of
// the same comment carry identical attrs and merge back together. Ranges overlap, so a
// run carries a mark per comment it lies in.

/** An answer in a comment's thread: ODF's loext:parent-name, Word's w15:paraIdParent. */
export type CommentReply = { author: string; date: string; text: string };

export type CommentRange = {
  id: string;
  author: string;
  date: string;
  text: string;
  replies: CommentReply[];
  resolved: boolean;
  from: number;
  to: number;
  // The commented text itself, for the pane's quote line.
  quote: string;
};

// Fired by the context menu; App.svelte owns the prompt and the pane.
export const OPEN_COMMENT_EVENT = 'odf-new-comment';

export function newCommentId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

// A comment still being written: only where it will go, so it is outside the document
// and its history until Add. A bookmark, as a cell selection comments several ranges.
const draftKey = new PluginKey<SelectionBookmark | null>('commentDraft');

export type CommentDraft = { from: number; to: number; quote: string };

export function commentDraft(state: EditorState): CommentDraft | null {
  const sel = draftKey.getState(state)?.resolve(state.doc);
  return sel ? { from: sel.from, to: sel.to, quote: state.doc.textBetween(sel.from, sel.to, ' ', ' ') } : null;
}

function commentMarks(marks: readonly PMMark[]): PMMark[] {
  return marks.filter((m) => m.type.name === 'comment' && typeof m.attrs.id === 'string' && m.attrs.id);
}

// The card last chosen: comments over one text cannot be told apart by the selection.
const pickedKey = new PluginKey<string | null>('commentPicked');

/** Makes `id` the active comment for as long as this selection stands. */
export function pickComment(tr: Transaction, id: string): Transaction {
  return tr.setMeta(pickedKey, id);
}

function repliesOf(value: unknown): CommentReply[] {
  const list = typeof value === 'string' ? safeParse(value) : value;
  if (!Array.isArray(list)) return [];
  return list.map((r) => ({
    author: String((r as CommentReply)?.author ?? ''),
    date: String((r as CommentReply)?.date ?? ''),
    text: String((r as CommentReply)?.text ?? ''),
  }));
}

function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return []; }
}

/** The comment the selection lies within — what the pane highlights and the bar thickens. */
export function commentIdAt(state: EditorState, ranges?: CommentRange[]): string | null {
  const { from, to } = state.selection;
  // By range, not by the marks at the caret: the mark is non-inclusive, so a selection
  // over the whole comment — what a click on the pane's card makes — carries none.
  const here = (ranges ?? commentRanges(state.doc)).filter((c) => c.from <= from && to <= c.to);
  const picked = pickedKey.getState(state);
  if (picked && here.some((c) => c.id === picked)) return picked;
  // Else the innermost: a click in a word means the word's comment, not the sentence's.
  return here.reduce<CommentRange | null>((best, c) => (!best || c.to - c.from < best.to - best.from ? c : best), null)?.id ?? null;
}

// Every comment range in document order. Adjacent text nodes sharing an id merge into
// one; an id split by a paragraph boundary yields several, which is why the commands
// walk all of them and the pane (`comments`) keeps only the first per id.
// Kept per doc, read-only: every view, bar and pane asks on each transaction.
const rangesOf = new WeakMap<PMNode, CommentRange[]>();
export function commentRanges(doc: PMNode): CommentRange[] {
  const known = rangesOf.get(doc);
  if (known) return known;
  const out: CommentRange[] = [];
  const last = new Map<string, CommentRange>();
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    for (const mark of commentMarks(node.marks)) {
      const id = mark.attrs.id as string;
      const before = last.get(id);
      if (before?.to === pos) {
        before.to = pos + node.nodeSize;
        before.quote += node.text ?? '';
        continue;
      }
      const range: CommentRange = {
        id,
        author: String(mark.attrs.author ?? ''),
        date: String(mark.attrs.date ?? ''),
        text: String(mark.attrs.text ?? ''),
        replies: repliesOf(mark.attrs.replies),
        resolved: mark.attrs.resolved === true,
        from: pos,
        to: pos + node.nodeSize,
        quote: node.text ?? '',
      };
      last.set(id, range);
      out.push(range);
    }
    return false;
  });
  // Oldest first where several start together: an edit reorders a run's marks.
  out.sort((a, b) => a.from - b.from || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  rangesOf.set(doc, out);
  return out;
}

// One entry per comment, in document order — what the pane lists.
export function comments(doc: PMNode): CommentRange[] {
  const seen = new Set<string>();
  return commentRanges(doc).filter((c) => !seen.has(c.id) && seen.add(c.id));
}

// Takes one comment off its range; a comment over the same text keeps its mark.
function removeCommentMark(tr: Transaction, doc: PMNode, r: CommentRange): void {
  doc.nodesBetween(r.from, r.to, (node, pos) => {
    for (const m of commentMarks(node.marks)) {
      if (m.attrs.id === r.id) tr.removeMark(Math.max(pos, r.from), Math.min(pos + node.nodeSize, r.to), m);
    }
  });
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      /** Comment the selection; returns false on an empty one, as in Word. */
      addComment: (opts: { author: string; text: string }) => ReturnType;
      updateComment: (id: string, patch: { text?: string; resolved?: boolean; replies?: CommentReply[] }) => ReturnType;
      /** Appends to the comment's thread, as the reply box in either review view does. */
      replyToComment: (id: string, reply: { author: string; text: string }) => ReturnType;
      removeComment: (id: string) => ReturnType;
      /** Opens a comment on the selection for writing; nothing changes in the document. */
      startCommentDraft: () => ReturnType;
      cancelCommentDraft: () => ReturnType;
      /** Comments the text the draft was opened on, which has followed every edit since. */
      submitCommentDraft: (opts: { author: string; text: string }) => ReturnType;
    };
  }
}

export const Comment = Mark.create({
  name: 'comment',
  // The range is fixed: typing at either end stays outside it, as in Word.
  inclusive: false,
  // Above the formatting marks, so the highlight wraps them rather than splitting them.
  excludes: '',

  addAttributes() {
    return {
      id: { default: '', parseHTML: (el) => el.getAttribute('data-comment') || '', renderHTML: (a) => ({ 'data-comment': String(a.id ?? '') }) },
      author: { default: '', parseHTML: (el) => el.getAttribute('data-comment-author') || '', renderHTML: (a) => ({ 'data-comment-author': String(a.author ?? '') }) },
      date: { default: '', parseHTML: (el) => el.getAttribute('data-comment-date') || '', renderHTML: (a) => ({ 'data-comment-date': String(a.date ?? '') }) },
      text: { default: '', parseHTML: (el) => el.getAttribute('data-comment-text') || '', renderHTML: (a) => ({ 'data-comment-text': String(a.text ?? '') }) },
      replies: {
        default: [] as CommentReply[],
        parseHTML: (el) => repliesOf(el.getAttribute('data-comment-replies') || '[]'),
        renderHTML: (a) => {
          const list = repliesOf(a.replies);
          return list.length ? { 'data-comment-replies': JSON.stringify(list) } : {};
        },
      },
      resolved: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-comment-resolved') === 'true',
        renderHTML: (a) => (a.resolved ? { 'data-comment-resolved': 'true' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'pm-comment' }), 0];
  },

  addCommands() {
    return {
      addComment:
        ({ author, text }) =>
        ({ tr, state, dispatch }) => {
          if (tr.selection.empty) return false;
          if (dispatch) {
            // tr.addMark, not setMark: that would merge this comment into one already there.
            const id = newCommentId();
            const mark = state.schema.marks.comment.create({
              id, author, text, replies: [], date: new Date().toISOString(), resolved: false,
            });
            for (const { $from, $to } of tr.selection.ranges) tr.addMark($from.pos, $to.pos, mark);
            pickComment(tr, id);
          }
          return true;
        },
      updateComment:
        (id, patch) =>
        ({ tr, state, dispatch }) => {
          const ranges = commentRanges(state.doc).filter((c) => c.id === id);
          if (!ranges.length) return false;
          if (dispatch) {
            for (const r of ranges) {
              removeCommentMark(tr, state.doc, r);
              tr.addMark(r.from, r.to, state.schema.marks.comment.create({
                id: r.id, author: r.author, date: r.date,
                text: patch.text ?? r.text,
                replies: patch.replies ?? r.replies,
                resolved: patch.resolved ?? r.resolved,
              }));
            }
          }
          return true;
        },
      replyToComment:
        (id, reply) =>
        ({ state, commands }) => {
          const c = commentRanges(state.doc).find((r) => r.id === id);
          if (!c || !reply.text.trim()) return false;
          return commands.updateComment(id, {
            replies: [...c.replies, { author: reply.author, text: reply.text.trim(), date: new Date().toISOString() }],
          });
        },
      removeComment:
        (id) =>
        ({ tr, state, dispatch }) => {
          const ranges = commentRanges(state.doc).filter((c) => c.id === id);
          if (!ranges.length) return false;
          if (dispatch) for (const r of ranges) removeCommentMark(tr, state.doc, r);
          return true;
        },
      startCommentDraft:
        () =>
        ({ tr, state, dispatch }) => {
          if (state.selection.empty) return false;
          if (dispatch) tr.setMeta(draftKey, state.selection.getBookmark());
          return true;
        },
      cancelCommentDraft:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(draftKey, null);
          return true;
        },
      submitCommentDraft:
        (opts) =>
        ({ tr, state, commands, dispatch }) => {
          const draft = draftKey.getState(state);
          if (!draft) return false;
          if (dispatch) tr.setSelection(draft.resolve(tr.doc)).setMeta(draftKey, null);
          return commands.addComment(opts);
        },
    };
  },

  addProseMirrorPlugins() {
    let cache: { doc: PMNode; id: string | null; set: DecorationSet } | null = null;
    return [
      new Plugin<SelectionBookmark | null>({
        key: draftKey,
        state: {
          init: () => null,
          // The draft goes with its text: nothing is left to comment on.
          apply(tr, draft) {
            const set = tr.getMeta(draftKey) as SelectionBookmark | null | undefined;
            if (set !== undefined) return set;
            if (!draft || !tr.docChanged) return draft;
            const next = draft.map(tr.mapping);
            return next.resolve(tr.doc).empty ? null : next;
          },
        },
      }),
      // Tinted while the caret is away in the box the comment is written in.
      highlightPlugin('comment-draft', (state) => {
        const sel = draftKey.getState(state)?.resolve(state.doc);
        return sel ? DecorationSet.create(state.doc, sel.ranges.map((r) =>
          Decoration.inline(r.$from.pos, r.$to.pos, { class: 'pm-comment-tint pm-comment-active' }))) : null;
      }),
      new Plugin<string | null>({
        key: pickedKey,
        state: {
          init: () => null,
          apply: (tr, id) => tr.getMeta(pickedKey) ?? (tr.selectionSet ? null : id),
        },
        props: {
          // Each open comment tinted in its author's colour, which the mark cannot know;
          // the one the selection lies in heavier, the document half of the pairing the
          // pane draws on its card. A handled one keeps the mark's grey underline.
          decorations(state) {
            const ranges = commentRanges(state.doc);
            const id = commentIdAt(state, ranges);
            if (cache?.doc === state.doc && cache.id === id) return cache.set;
            const colors = authorColors(state.doc);
            const set = DecorationSet.create(state.doc, ranges.filter((c) => !c.resolved).map((c) =>
              Decoration.inline(c.from, c.to, {
                class: c.id === id ? 'pm-comment-tint pm-comment-active' : 'pm-comment-tint',
                style: `--comment-author: ${authorColor(colors, c.author)}`,
              })));
            cache = { doc: state.doc, id, set };
            return set;
          },
        },
      }),
    ];
  },
});
