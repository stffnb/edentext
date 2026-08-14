import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import TextAlign from '@tiptap/extension-text-align';
import { sequenceFields, ODF_SEQ_CATEGORY, seqCategoryOf, SequenceField, captionPlacement } from '../../src/lib/editor/extensions/caption';

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

describe('captionPlacement', () => {
  it('boxes the caption to a centred frame, and centres it in that box', () => {
    expect(captionPlacement(4.2, 4.2)).toEqual({ indent: 4.2, indentRight: 4.2, textAlign: 'center' });
  });

  it('leaves a frame against the far edge left-flush in its box', () => {
    // The indent is what lifts the caption clear of a side-wrapped frame: its lines
    // have no room beside the float and drop below it.
    expect(captionPlacement(9.45, 0)).toEqual({ indent: 9.45, indentRight: null, textAlign: null });
  });

  it('indents nothing for a frame that fills the column', () => {
    expect(captionPlacement(0, 0)).toEqual({ indent: null, indentRight: null, textAlign: null });
    expect(captionPlacement(0.02, 0.01)).toEqual({ indent: null, indentRight: null, textAlign: null });
  });
});

describe('insertCaption', () => {
  const makeEditor = (textAlign: string | null) => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({
      element: el,
      extensions: [Document, Paragraph, Text, SequenceField, TextAlign.configure({ types: ['paragraph'] })],
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign }, content: [{ type: 'text', text: 'picture' }] }] },
    });
  };
  const insert = (editor: Editor) =>
    editor.chain().focus().insertCaption({ category: 'figure', label: 'Figure', separator: ': ', text: 'x', above: false }).run();

  // No frame here, which is the fallback leg: a block without one has only its alignment.
  it('takes the alignment of the block it captions, so it stands under the picture', () => {
    const editor = makeEditor('center');
    insert(editor);
    const [, caption] = editor.getJSON().content as any[];
    expect(caption.attrs.textAlign).toBe('center');
    editor.destroy();
  });

  it('leaves the caption of an unaligned block unaligned', () => {
    const editor = makeEditor(null);
    insert(editor);
    const [, caption] = editor.getJSON().content as any[];
    expect(caption.attrs.textAlign ?? null).toBe(null);
    editor.destroy();
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
