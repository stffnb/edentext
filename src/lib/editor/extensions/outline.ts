import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { headingStyleName } from '../../styles/styleSheet';

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

export function outline(doc: PMNode): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    out.push({
      pos: offset,
      end: doc.content.size,
      level: Math.max(1, Number(node.attrs.level) || 1),
      text: node.textContent,
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
    };
  },
});
