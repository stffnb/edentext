import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { sequenceFields, ODF_SEQ_CATEGORY, seqCategoryOf } from '../../src/lib/editor/extensions/caption';

// The numbering rule both word processors apply: one counter per category, in document
// order. A schema of its own keeps the check off the editor's full extension list.
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    sequenceField: {
      group: 'inline', inline: true, atom: true,
      attrs: { category: { default: 'figure' }, number: { default: 1 } },
      toDOM: () => ['span'],
    },
  },
});

const seq = (category: string, number = 1) => schema.nodes.sequenceField.create({ category, number });
const para = (...content: ReturnType<typeof seq>[]) => schema.nodes.paragraph.create(null, content);

describe('sequenceFields', () => {
  it('counts each category on its own, in document order', () => {
    const doc = schema.nodes.doc.create(null, [
      para(seq('figure')), para(seq('table')), para(seq('figure')), para(seq('table')), para(seq('figure')),
    ]);
    expect(sequenceFields(doc).map((f) => `${f.node.attrs.category}${f.number}`))
      .toEqual(['figure1', 'table1', 'figure2', 'table2', 'figure3']);
  });

  it('numbers two fields in one paragraph left to right', () => {
    const doc = schema.nodes.doc.create(null, [para(seq('figure'), seq('figure'))]);
    expect(sequenceFields(doc).map((f) => f.number)).toEqual([1, 2]);
  });

  it('reports the stale cached number, which is what triggers a renumber', () => {
    const doc = schema.nodes.doc.create(null, [para(seq('figure', 7))]);
    const [only] = sequenceFields(doc);
    expect(only.number).toBe(1);
    expect(only.node.attrs.number).toBe(7);
  });
});

describe('category names', () => {
  it('reads both spellings of the picture counter', () => {
    expect(ODF_SEQ_CATEGORY.Illustration).toBe('figure'); // LibreOffice's
    expect(ODF_SEQ_CATEGORY.Figure).toBe('figure'); // Word's
    expect(ODF_SEQ_CATEGORY.Table).toBe('table');
    expect(ODF_SEQ_CATEGORY.Drawing).toBeUndefined();
  });

  it('falls back to the picture category', () => {
    expect(seqCategoryOf('table')).toBe('table');
    expect(seqCategoryOf(null)).toBe('figure');
    expect(seqCategoryOf('nonsense')).toBe('figure');
  });
});
