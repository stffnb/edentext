import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { unwrapPastedBoxes, flattenToInline } from '../../src/lib/editor/paste';

const schema = getSchema(extensions);
const para = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const box = (attrs: Record<string, unknown>, blocks = [para('one'), para('two')]) =>
  schema.nodes.textBox.create(attrs, blocks);
const slice = (...nodes: ReturnType<typeof para>[]) => Slice.maxOpen(Fragment.fromArray(nodes), true);

describe('unwrapPastedBoxes', () => {
  it('spills the blocks of every box the paste invented', () => {
    // A paste of text plus a table gets one wrapper box per block that did not fit.
    const out = unwrapPastedBoxes(slice(box({}), box({}, [para('three')])));
    expect(out.content.childCount).toBe(3);
    expect(out.content.child(0).type.name).toBe('paragraph');
  });

  it('keeps a box that carries a size, which every real one does', () => {
    const pasted = slice(box({ width: 280, height: 120 }));
    expect(unwrapPastedBoxes(pasted)).toBe(pasted);
  });
});

describe('flattenToInline', () => {
  it('joins blocks with line breaks, boxes walked into', () => {
    const out = flattenToInline(slice(para('a'), box({ width: 280 }, [para('b')])), schema);
    expect(out.content.content.map(n => (n.isText ? n.text : n.type.name)))
      .toEqual(['a', 'hardBreak', 'b']);
  });
});
