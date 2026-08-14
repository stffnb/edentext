import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { outline, chapterMove, chapterLevels } from '../../src/lib/editor/extensions/outline';

const schema = getSchema(extensions);

const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

// "A" owning "A.1", then "B": the shape every chapter operation has to get right.
const doc = () => PMNode.fromJSON(schema, {
  type: 'doc',
  content: [h(1, 'A'), p('a text'), h(2, 'A.1'), p('a1 text'), h(1, 'B'), p('b text')],
});

// The move as the command performs it, so the test exercises the real positions.
function move(node: PMNode, index: number, dir: -1 | 1): string | null {
  const plan = chapterMove(outline(node), outline(node)[index].pos, dir);
  if (!plan) return null;
  const slice = node.slice(plan.from, plan.to);
  const cut = node.replace(plan.from, plan.to, PMNode.fromJSON(schema, { type: 'doc' }).slice(0, 0));
  const out = cut.replace(plan.at, plan.at, slice);
  const parts: string[] = [];
  out.forEach((n) => parts.push(n.textContent));
  return parts.join('|');
}

describe('outline', () => {
  it('gives each chapter the blocks up to the next heading of its level or above', () => {
    const d = doc();
    const list = outline(d);
    expect(list.map((e) => `${e.level}:${e.text}`)).toEqual(['1:A', '2:A.1', '1:B']);
    // A owns everything up to B; A.1 only its own paragraph.
    expect(d.slice(list[0].pos, list[0].end).content.childCount).toBe(4);
    expect(d.slice(list[1].pos, list[1].end).content.childCount).toBe(2);
    expect(list[2].end).toBe(d.content.size);
  });

  it('moves a chapter with everything under it', () => {
    expect(move(doc(), 2, -1)).toBe('B|b text|A|a text|A.1|a1 text');
    expect(move(doc(), 0, 1)).toBe('B|b text|A|a text|A.1|a1 text');
  });

  it('has no sibling to swap with at the ends, or alone at its level', () => {
    expect(move(doc(), 0, -1)).toBeNull();
    expect(move(doc(), 2, 1)).toBeNull();
    // A.1 is the only level-2 chapter, and a move never leaves its own level.
    expect(move(doc(), 1, 1)).toBeNull();
  });

  it('promotes and demotes the whole subtree', () => {
    const list = outline(doc());
    expect(chapterLevels(list, list[0].pos, 1, 6)).toEqual([
      { pos: list[0].pos, level: 2 }, { pos: list[1].pos, level: 3 },
    ]);
    // Only the chapter itself, when nothing is under it.
    expect(chapterLevels(list, list[2].pos, 1, 6)).toEqual([{ pos: list[2].pos, level: 2 }]);
  });

  it('refuses a shift that would take any of the subtree out of range', () => {
    const list = outline(doc());
    expect(chapterLevels(list, list[0].pos, -1, 6)).toBeNull(); // A is already level 1
    expect(chapterLevels(list, list[0].pos, 1, 2)).toBeNull();  // A.1 would reach 3
    expect(chapterLevels(list, list[1].pos, -1, 6)).toEqual([{ pos: list[1].pos, level: 1 }]);
  });
});
