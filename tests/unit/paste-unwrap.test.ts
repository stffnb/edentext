import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { unwrapPastedBox } from '../../src/lib/editor/extensions/textBox';

const schema = getSchema(extensions);
const para = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const boxed = (attrs: Record<string, unknown>) =>
  Slice.maxOpen(Fragment.from(schema.nodes.textBox.create(attrs, [para('one'), para('two')])), true);

describe('unwrapPastedBox', () => {
  it('spills the blocks of a box the paste parser invented', () => {
    const slice = unwrapPastedBox(boxed({}));
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.firstChild!.type.name).toBe('paragraph');
  });

  it('keeps a box that carries a size, which every real one does', () => {
    const slice = boxed({ width: 280, height: 120 });
    expect(unwrapPastedBox(slice)).toBe(slice);
  });
});
