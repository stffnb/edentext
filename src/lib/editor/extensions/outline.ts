import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { headingStyleName } from '../../styles/styleSheet';
import { MAX_HEADING_LEVEL } from '../../styles/headings';
import { outlineIsEmpty, outlineLabel, type OutlineNumbering } from '../../styles/outlineNumbering';
import { formatOrdinal } from '../../utils/orderedListTypes';
import { sequenceFieldText } from './caption';
import { MOVING } from './trackChanges';
import { markupView } from '../../storage/markup.svelte';

// The document's chapters, as LibreOffice's Navigator and Word's Navigation pane show
// them: every top-level heading, each owning the blocks up to the next heading of its
// own level or higher. A heading inside a cell or a text box is not a chapter — moving
// one would mean moving it out of its container — so only the body's own blocks count.

export type OutlineEntry = {
  /** Start of the heading node. */
  pos: number;
  /** End of the chapter: the next heading at this level or above, else the body's end. */
  end: number;
  level: number;
  text: string;
};

// A block's text with its atoms spelled out: a hard break is a line of the entry (a
// book's "Chapter 1" / title pair is two lines in LibreOffice's own index) and a
// sequence field is its number, which is most of what a caption entry says. Text the view
// hides is not there for an index, the navigator or a reference, as in LibreOffice.
export function blockText(node: PMNode): string {
  const { hideDeletions, hideInsertions } = markupView();
  const hidden = (child: PMNode) => child.marks.some((m) => m.type.name === (hideDeletions ? 'deletion' : hideInsertions ? 'insertion' : ''));
  let raw = '';
  node.forEach((child) => { if (!hidden(child)) raw += child.type.name === 'hardBreak' ? '\n' : inlineText(child); });
  return raw.trim();
}

// What an inline node contributes to a text walk. An atom has no text of its own, but
// every field caches the string it shows — which is what a bookmark over a caption's
// number or a note's anchor has to pick up.
export function inlineText(node: PMNode): string {
  if (node.isText) return node.text ?? '';
  if (node.type.name === 'sequenceField') return sequenceFieldText(node);
  if (node.isAtom && node.isInline) return String(node.attrs?.text ?? '');
  return node.textContent;
}

// A heading inside a table cell or a list item is numbered by neither product.
export function inCellOrItem(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader' || name === 'listItem') return true;
  }
  return false;
}

/**
 * The chapter number every numbered heading carries, keyed by its position. Drawn on
 * the page by CSS counters (`outlineCss`), which no text walk can read, so the
 * contents rows and the cross-references count it the same way here.
 *
 * `label` is what the heading shows, prefix and suffix included; `parts` the bare
 * ordinal per level, which is what a reference "with no context" or "full context"
 * picks from.
 */
export type HeadingNumber = { parts: string[]; label: string };

export function headingNumbers(doc: PMNode, numbering: OutlineNumbering | null | undefined): Map<number, HeadingNumber> {
  const out = new Map<number, HeadingNumber>();
  if (outlineIsEmpty(numbering)) return out;
  const levels = numbering!;
  const counts: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true;
    if (inCellOrItem(doc, pos)) return false;
    const level = Math.min(MAX_HEADING_LEVEL, Number(node.attrs.level) || 1);
    counts[level - 1] = (counts[level - 1] ?? (levels[level - 1]?.start ?? 1) - 1) + 1;
    for (let d = level; d < counts.length; d++) counts[d] = (levels[d]?.start ?? 1) - 1;
    const parts: string[] = [];
    for (let l = 1; l <= level; l++) {
      const at = levels[l - 1];
      if (!at || at.format === 'none') continue;
      parts.push(formatOrdinal(counts[l - 1] ?? at.start, at.format));
    }
    out.set(pos, { parts, label: outlineLabel(levels, level, counts, formatOrdinal) });
    return false;
  });
  return out;
}

export function outline(doc: PMNode): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    out.push({
      pos: offset,
      end: doc.content.size,
      level: Math.max(1, Number(node.attrs.level) || 1),
      text: blockText(node),
    });
  });
  // A chapter ends where the next one at its level or above begins.
  for (let i = 0; i < out.length; i++) {
    const next = out.slice(i + 1).find((e) => e.level <= out[i].level);
    if (next) out[i].end = next.pos;
  }
  return out;
}

/**
 * Where a chapter move lands: the range to lift out and the position to put it back
 * at. Moving up lands before the previous sibling, whose position the delete leaves
 * alone; moving down lands after the next one, past content the delete has shifted.
 *
 * The sibling is the adjacent chapter at the **same** level, and the search stops at a
 * heading above it: a subheading moves inside its own chapter and never reparents
 * itself by being moved. null = nothing to swap with, so the button does nothing.
 */
export function chapterMove(list: OutlineEntry[], pos: number, dir: -1 | 1): { from: number; to: number; at: number } | null {
  const i = list.findIndex((e) => e.pos === pos);
  if (i < 0) return null;
  const me = list[i];
  const search = dir < 0 ? [...list.slice(0, i)].reverse() : list.slice(i + 1);
  let sibling: OutlineEntry | undefined;
  for (const e of search) {
    if (e.level < me.level) break;
    if (e.level === me.level) { sibling = e; break; }
  }
  if (!sibling) return null;
  return { from: me.pos, to: me.end, at: dir < 0 ? sibling.pos : sibling.end - (me.end - me.pos) };
}

/**
 * The headings a promote/demote of the chapter at `pos` rewrites, with their new
 * levels — the heading and everything under it, as LibreOffice moves a whole chapter.
 * null when any of them would leave the 1…max range, so the subtree stays intact.
 */
export function chapterLevels(list: OutlineEntry[], pos: number, delta: -1 | 1, max: number): { pos: number; level: number }[] | null {
  const me = list.find((e) => e.pos === pos);
  if (!me) return null;
  const inside = list.filter((e) => e.pos >= me.pos && e.pos < me.end);
  if (inside.some((e) => e.level + delta < 1 || e.level + delta > max)) return null;
  return inside.map((e) => ({ pos: e.pos, level: e.level + delta }));
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    outline: {
      /** Move the chapter starting at `pos` past its previous (-1) or next (+1) sibling. */
      moveChapter: (pos: number, dir: -1 | 1) => ReturnType;
      /** Promote (-1) or demote (+1) the chapter's heading and its subheadings. */
      shiftChapterLevel: (pos: number, delta: -1 | 1) => ReturnType;
      /** Delete the chapter starting at `pos`: its heading and everything it owns. */
      deleteChapter: (pos: number) => ReturnType;
    };
  }
}

export const Outline = Extension.create<{ maxLevel: number }>({
  name: 'outline',

  addOptions() {
    return { maxLevel: 6 };
  },

  addCommands() {
    return {
      moveChapter: (pos, dir) => ({ state, tr, dispatch }) => {
        const plan = chapterMove(outline(state.doc), pos, dir);
        if (!plan) return false;
        if (!dispatch) return true;
        const slice = state.doc.slice(plan.from, plan.to);
        tr.delete(plan.from, plan.to);
        tr.insert(plan.at, slice.content);
        tr.setMeta(MOVING, true);
        return true;
      },

      shiftChapterLevel: (pos, delta) => ({ state, tr, dispatch }) => {
        const plan = chapterLevels(outline(state.doc), pos, delta, this.options.maxLevel);
        if (!plan) return false;
        if (!dispatch) return true;
        for (const { pos: at, level } of plan) {
          const node = state.doc.nodeAt(at);
          if (!node) continue;
          // The style follows the level: a heading's own is what both word processors
          // switch, and the level alone would leave the paragraph looking unchanged.
          tr.setNodeMarkup(at, undefined, { ...node.attrs, level, styleName: headingStyleName(level) });
        }
        return true;
      },

      // A plain delete, so recording turns it into one tracked deletion like any other.
      deleteChapter: (pos) => ({ state, tr, dispatch }) => {
        const me = outline(state.doc).find((e) => e.pos === pos);
        if (!me) return false;
        if (dispatch) tr.delete(me.pos, me.end).scrollIntoView();
        return true;
      },
    };
  },
});
