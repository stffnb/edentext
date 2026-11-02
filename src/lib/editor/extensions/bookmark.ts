import { Mark, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode, Mark as PMMark } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { inlineText } from './outline';
import { liveText } from './trackChanges';

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

// Every bookmark on a run: Word and ODF both nest ranges, so one piece of text can
// carry several names.
export function bookmarkNamesOf(marks: readonly PMMark[]): string[] {
  return marks.filter((m) => m.type.name === 'bookmark')
    .map((m) => String(m.attrs?.name ?? '')).filter(Boolean);
}

// A note's text and a frame's blocks are stories of their own: a range never runs into
// or out of one, since both formats write them apart from the text around them.
const STORIES = new Set(['note', 'textBox']);
// The JSON's blocks of inline content, which the schema knows as `inlineContent`.
const TEXTBLOCKS = new Set(['paragraph', 'heading', 'note']);

export type BookmarkSpan<T> = { name: string; items: T[] };

// One range per stretch of a name: it stays open while every inline node it meets
// carries the name, so a paragraph boundary or an empty paragraph does not end it —
// unmarked text or a field does. Both formats store a range across paragraphs as one.
export function bookmarkSpans<T>(seq: Iterable<{ item: T; names: readonly string[] }>): BookmarkSpan<T>[] {
  const out: BookmarkSpan<T>[] = [];
  const open = new Map<string, BookmarkSpan<T>>();
  for (const { item, names } of seq) {
    for (const name of open.keys()) if (!names.includes(name)) open.delete(name);
    for (const name of new Set(names)) {
      const span = open.get(name);
      if (span) { span.items.push(item); continue; }
      const fresh = { name, items: [item] };
      out.push(fresh);
      open.set(name, fresh);
    }
  }
  return out;
}

type InlineAt = { node: PMNode; pos: number; block: PMNode };

// The inline leaves of each story in document order. Inline atoms count too: a bookmark
// over a caption's number or a note's anchor has no text node to hold on to.
function inlineStories(doc: PMNode): InlineAt[][] {
  const stories: InlineAt[][] = [[]];
  const walk = (node: PMNode, start: number, story: InlineAt[]) => {
    node.forEach((child, offset) => {
      const pos = start + offset;
      if (STORIES.has(child.type.name)) {
        const own: InlineAt[] = [];
        stories.push(own);
        walk(child, pos + 1, own);
      } else if (node.inlineContent && child.isLeaf) story.push({ node: child, pos, block: node });
      else walk(child, pos + 1, story);
    });
  };
  walk(doc, 0, stories[0]);
  return stories;
}

// Every bookmark range in document order; a name that reappears later gets its own
// entry, and lookups take the first. The text joins the paragraphs a range spans.
export function bookmarks(doc: PMNode): BookmarkRef[] {
  const out: BookmarkRef[] = [];
  for (const story of inlineStories(doc)) {
    const seq = story.map((at) => ({ item: at, names: bookmarkNamesOf(at.node.marks) }));
    for (const { name, items } of bookmarkSpans(seq)) {
      const last = items[items.length - 1];
      const text = items.map((at, i) => (i && at.block !== items[i - 1].block ? ' ' : '') + inlineText(at.node)).join('');
      out.push({ name, from: items[0].pos, to: last.pos + last.node.nodeSize, text });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

type JsonMark = { type: string; attrs?: Record<string, unknown> };
type JsonNode = { type: string; content?: JsonNode[]; marks?: JsonMark[] };
export type BookmarkEdge = { name: string; span: number; first: boolean; last: boolean };

// For the exporters, which bracket a range as two points: a copy of the document JSON
// whose bookmark marks say which range they belong to and whether they open or close
// it. `textOnly` counts only text runs as covered, for ODF, whose atoms take none.
export function stampBookmarkEdges<N extends JsonNode>(doc: N, textOnly = false): N {
  type Item = { item: JsonNode; names: string[] };
  const stories: Item[][] = [[]];
  const copy = (node: JsonNode, story: Item[], inline: boolean): JsonNode => {
    const out: JsonNode = { ...node };
    if (node.marks?.some((m) => m.type === 'bookmark')) {
      out.marks = node.marks.map((m) => (m.type === 'bookmark' ? { ...m, attrs: { ...m.attrs } } : m));
    }
    if (inline) {
      const names = textOnly && node.type !== 'text' ? [] : jsonBookmarkNames(out);
      story.push({ item: out, names });
    }
    if (node.content) {
      let own = story;
      if (STORIES.has(node.type)) stories.push((own = []));
      // An exporter's own block types hold text too, which is what marks them out.
      const holdsInline = TEXTBLOCKS.has(node.type) || node.content.some((c) => c.type === 'text');
      out.content = node.content.map((c) => copy(c, own, holdsInline && !c.content));
    }
    return out;
  };
  const stamped = copy(doc, stories[0], false) as N;
  let span = 0;
  for (const story of stories) {
    for (const { name, items } of bookmarkSpans(story)) {
      span++;
      items.forEach((node, i) => {
        const mark = node.marks?.find((m) => m.type === 'bookmark' && m.attrs?.name === name);
        if (mark) Object.assign(mark.attrs!, { span, first: i === 0, last: i === items.length - 1 });
      });
    }
  }
  return stamped;
}

const jsonBookmarkNames = (node: JsonNode): string[] =>
  (node.marks ?? []).filter((m) => m.type === 'bookmark').map((m) => String(m.attrs?.name ?? '')).filter(Boolean);

// The edges `stampBookmarkEdges` left on a node. A mark it never saw is a range of its own.
export function bookmarkEdgesOf(node: JsonNode): BookmarkEdge[] {
  return (node.marks ?? []).filter((m) => m.type === 'bookmark' && m.attrs?.name).map((m) => {
    const a = m.attrs!;
    const stamped = typeof a.span === 'number';
    return { name: String(a.name), span: stamped ? (a.span as number) : -1, first: !stamped || a.first === true, last: !stamped || a.last === true };
  });
}

export function findBookmark(doc: PMNode, name: string): BookmarkRef | null {
  return bookmarks(doc).find((b) => b.name === name) ?? null;
}

// The target a "#…" link or a cross-reference names. ODF also addresses a heading by
// its own text with a "|outline" suffix, which no bookmark answers to.
export function findTarget(doc: PMNode, ref: string): BookmarkRef | null {
  const name = ref.startsWith('#') ? ref.slice(1) : ref;
  const found = findBookmark(doc, name);
  if (found || !name.endsWith('|outline')) return found;
  const text = name.slice(0, -'|outline'.length);
  let hit: BookmarkRef | null = null;
  doc.descendants((node, pos) => {
    if (hit || !node.isBlock) return !hit;
    if (node.type.name !== 'heading' || liveText(node) !== text) return true;
    hit = { name, from: pos + 1, to: pos + node.nodeSize - 1, text };
    return false;
  });
  return hit;
}

// Follow a reference: scroll its target into view and select it, as both word
// processors do on a modifier-click. False where nothing answers to the name.
export function goToTarget(view: EditorView, ref: string): boolean {
  const found = findTarget(view.state.doc, ref);
  if (!found) return false;
  const at = view.domAtPos(found.from).node;
  const el = (at.nodeType === 1 ? at : at.parentElement) as HTMLElement | null;
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found.from, found.to)));
  view.focus();
  return true;
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
      renameBookmark: (from: string, to: string) => ReturnType;
    };
  }
}

export const Bookmark = Mark.create({
  name: 'bookmark',
  // The range is fixed: typing at either end stays outside it, as it does in Word.
  inclusive: false,
  // Ranges overlap in both formats — a heading's own name inside the contents' one —
  // so a run keeps every bookmark it is in rather than only the outermost.
  excludes: '',

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
      // A name the document already has moves to the selection, as in Word: two ranges
      // under one name are a single bookmark to both formats.
      setBookmark:
        (name) =>
        ({ commands }) => {
          const clean = sanitizeBookmarkName(name);
          if (!clean) return false;
          commands.removeBookmark(clean);
          return commands.setMark(this.name, { name: clean });
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
            // By name, not by type: a run inside another bookmark's range keeps that one.
            for (const r of ranges) tr.removeMark(r.from, r.to, state.schema.marks.bookmark.create({ name }));
          }
          return true;
        },
      // Rename on every run carrying the name, and the references along with it: a
      // cross-reference or a "#name" link keeps pointing at the same text.
      renameBookmark:
        (from, to) =>
        ({ tr, state, dispatch }) => {
          const clean = sanitizeBookmarkName(to);
          const names = bookmarkNames(state.doc);
          if (!clean || clean === from || names.includes(clean) || !names.includes(from)) return false;
          if (!dispatch) return true;
          const { bookmark, link } = state.schema.marks;
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'crossRef' && node.attrs.name === from && node.attrs.kind !== 'note') {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, name: clean });
            }
            if (!node.isLeaf || !node.isInline) return true;
            const end = pos + node.nodeSize;
            for (const m of node.marks) {
              if (m.type === bookmark && m.attrs.name === from) {
                tr.removeMark(pos, end, m).addMark(pos, end, bookmark.create({ name: clean }));
              } else if (link && m.type === link && m.attrs.href === `#${from}`) {
                tr.removeMark(pos, end, m).addMark(pos, end, link.create({ ...m.attrs, href: `#${clean}` }));
              }
            }
            return false;
          });
          return true;
        },
    };
  },
});
