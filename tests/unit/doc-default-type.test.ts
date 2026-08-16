import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';

// TipTap's clearNodes rewrites a block into its parent's `defaultType`, so the
// document's must stay a paragraph at every index — noteSection there made every
// style command on a block past the first throw (Invalid content for noteSection).
describe('document content expression', () => {
  it('offers a paragraph as the default type at every index', () => {
    const schema = getSchema(extensions);
    const p = schema.nodes.paragraph.createAndFill()!;
    const doc = schema.nodes.doc.create(null, [p, p, p]);
    for (let i = 0; i <= doc.childCount; i++) {
      expect(doc.contentMatchAt(i).defaultType?.name).toBe('paragraph');
    }
  });

  it('still admits a note section, last only', () => {
    const schema = getSchema(extensions);
    const p = schema.nodes.paragraph.createAndFill()!;
    const note = schema.nodes.note.create(null, p);
    const section = schema.nodes.noteSection.create(null, note);
    expect(() => schema.nodes.doc.createChecked(null, [p, section])).not.toThrow();
    expect(() => schema.nodes.doc.createChecked(null, [section, p])).toThrow();
  });
});
