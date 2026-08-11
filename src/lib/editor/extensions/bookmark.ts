import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';

// A bookmark: a named range of text, the target a cross-reference or internal link points
// at. A mark, not a point node — both formats store a range (ODF text:bookmark-start/-end,
// DOCX w:bookmarkStart/-End) and a REF field needs it to recompute its text.

export type BookmarkRef = { name: string; from: number; to: number; text: string };

// Fired by the context menu; ToolbarExpanded owns the dialog (as it does for links).
export const OPEN_BOOKMARK_DIALOG_EVENT = 'odf-open-bookmark-dialog';

// Bookmark names as Word writes them: letters, digits, underscore and dot, never
// leading with a digit, 40 chars at most. Sanitizing here also keeps the ODF export's
// sentinel pass free of XML escaping.
export function sanitizeBookmarkName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_.]/g, '_').slice(0, 40);
  if (!cleaned) return '';
  return /^[0-9]/.test(cleaned) ? `_${cleaned}`.slice(0, 40) : cleaned;
}

export function bookmarkNameOf(marks: readonly PMMark[]): string | null {
  const name = marks.find((m) => m.type.name === 'bookmark')?.attrs?.name;
  return typeof name === 'string' && name ? name : null;
}

// Every bookmark range in document order. Adjacent text nodes sharing a name merge into
// one range; a name that reappears later gets its own entry, and lookups take the first.
// ponytail: no cross-paragraph merge — the DOCX exporter can't write one either.
export function bookmarks(doc: PMNode): BookmarkRef[] {
  const out: BookmarkRef[] = [];
  let last: BookmarkRef | null = null;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const name = bookmarkNameOf(node.marks);
    if (!name) { last = null; return false; }
    if (last && last.name === name && last.to === pos) {
      last.to = pos + node.nodeSize;
      last.text += node.text ?? '';
      return false;
    }
    last = { name, from: pos, to: pos + node.nodeSize, text: node.text ?? '' };
    out.push(last);
    return false;
  });
  return out;
}

export function findBookmark(doc: PMNode, name: string): BookmarkRef | null {
  return bookmarks(doc).find((b) => b.name === name) ?? null;
}

// Unique names, document order — the pick list of both dialogs.
export function bookmarkNames(doc: PMNode): string[] {
  return [...new Set(bookmarks(doc).map((b) => b.name))];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bookmark: {
      setBookmark: (name: string) => ReturnType;
      unsetBookmark: () => ReturnType;
      removeBookmark: (name: string) => ReturnType;
    };
  }
}

export const Bookmark = Mark.create({
  name: 'bookmark',
  // The range is fixed: typing at either end stays outside it, as it does in Word.
  inclusive: false,

  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-bookmark') || '',
        renderHTML: (attrs) => ({ 'data-bookmark': String(attrs.name ?? '') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-bookmark]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setBookmark:
        (name) =>
        ({ commands }) => {
          const clean = sanitizeBookmarkName(name);
          return clean ? commands.setMark(this.name, { name: clean }) : false;
        },
      unsetBookmark:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      // Drop a bookmark by name from wherever it sits — the delete affordance in the
      // dialog, which works without moving the selection there first.
      removeBookmark:
        (name) =>
        ({ tr, state, dispatch }) => {
          const ranges = bookmarks(state.doc).filter((b) => b.name === name);
          if (!ranges.length) return false;
          if (dispatch) {
            for (const r of ranges) tr.removeMark(r.from, r.to, state.schema.marks.bookmark);
          }
          return true;
        },
    };
  },
});
