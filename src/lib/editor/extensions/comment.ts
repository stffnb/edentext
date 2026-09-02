import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// A comment: an annotation on a range of text. A mark, like `bookmark` — both formats
// store a range (ODF office:annotation + office:annotation-end, DOCX
// w:commentRangeStart/-End) and the pane has to find the text a comment points at.
// The whole comment rides the mark's attrs, so it needs no store of its own: two runs of
// the same comment carry identical attrs and merge back together.

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

function commentIdOf(marks: readonly PMMark[]): string | null {
  const id = marks.find((m) => m.type.name === 'comment')?.attrs?.id;
  return typeof id === 'string' && id ? id : null;
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

export function commentMarkAt(marks: readonly PMMark[]): PMMark | null {
  return marks.find((m) => m.type.name === 'comment') ?? null;
}

/** The comment the selection lies within — what the pane highlights and the bar thickens. */
export function commentIdAt(state: EditorState, ranges?: CommentRange[]): string | null {
  const { from, to } = state.selection;
  // By range, not by the marks at the caret: the mark is non-inclusive, so a selection
  // over the whole comment — what a click on the pane's card makes — carries none.
  return (ranges ?? commentRanges(state.doc)).find((c) => c.from <= from && to <= c.to)?.id ?? null;
}

// Every comment range in document order. Adjacent text nodes sharing an id merge into
// one; an id split by a paragraph boundary yields several, which is why the commands
// walk all of them and the pane (`comments`) keeps only the first per id.
export function commentRanges(doc: PMNode): CommentRange[] {
  const out: CommentRange[] = [];
  let last: CommentRange | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = commentMarkAt(node.marks);
    const id = mark ? commentIdOf(node.marks) : null;
    if (!id || !mark) { last = null; return false; }
    if (last && last.id === id && last.to === pos) {
      last.to = pos + node.nodeSize;
      last.quote += node.text ?? '';
      return false;
    }
    last = {
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
    out.push(last);
    return false;
  });
  return out;
}

// One entry per comment, in document order — what the pane lists.
export function comments(doc: PMNode): CommentRange[] {
  const seen = new Set<string>();
  return commentRanges(doc).filter((c) => !seen.has(c.id) && seen.add(c.id));
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
        ({ state, commands }) => {
          if (state.selection.empty) return false;
          return commands.setMark(this.name, {
            id: newCommentId(), author, text, replies: [], date: new Date().toISOString(), resolved: false,
          });
        },
      updateComment:
        (id, patch) =>
        ({ tr, state, dispatch }) => {
          const ranges = commentRanges(state.doc).filter((c) => c.id === id);
          if (!ranges.length) return false;
          if (dispatch) {
            for (const r of ranges) {
              tr.removeMark(r.from, r.to, state.schema.marks.comment);
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
          if (dispatch) for (const r of ranges) tr.removeMark(r.from, r.to, state.schema.marks.comment);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // The comment the selection lies in, tinted heavier — the document half of
          // the pairing the pane draws on its card. A handled one stays grey.
          decorations(state) {
            const ranges = commentRanges(state.doc);
            const id = commentIdAt(state, ranges);
            const hit = id ? ranges.filter((c) => c.id === id) : [];
            if (!hit.length || hit[0].resolved) return null;
            return DecorationSet.create(state.doc,
              hit.map((c) => Decoration.inline(c.from, c.to, { class: 'pm-comment-active' })));
          },
        },
      }),
    ];
  },
});
