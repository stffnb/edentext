import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';

// A comment: an annotation on a range of text. A mark, like `bookmark` — both formats
// store a range (ODF office:annotation + office:annotation-end, DOCX
// w:commentRangeStart/-End) and the pane has to find the text a comment points at.
// The whole comment rides the mark's attrs, so it needs no store of its own: two runs of
// the same comment carry identical attrs and merge back together.

export type CommentRange = {
  id: string;
  author: string;
  date: string;
  text: string;
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

export function commentMarkAt(marks: readonly PMMark[]): PMMark | null {
  return marks.find((m) => m.type.name === 'comment') ?? null;
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
      updateComment: (id: string, patch: { text?: string; resolved?: boolean }) => ReturnType;
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
            id: newCommentId(), author, text, date: new Date().toISOString(), resolved: false,
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
                resolved: patch.resolved ?? r.resolved,
              }));
            }
          }
          return true;
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
});
