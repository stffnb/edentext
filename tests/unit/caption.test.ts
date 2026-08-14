import { describe, it, expect } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import TextAlign from '@tiptap/extension-text-align';
import { sequenceFields, ODF_SEQ_CATEGORY, seqCategoryOf, SequenceField, framePlacement } from '../../src/lib/editor/extensions/caption';

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
    image: {
      group: 'inline', inline: true, atom: true,
      attrs: { wrap: { default: 'inline' }, wrapAlign: { default: null }, wrapOffset: { default: null } },
      toDOM: () => ['img'],
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

describe('framePlacement', () => {
  const picture = (attrs: Record<string, unknown>) =>
    schema.nodes.paragraph.create(null, schema.nodes.image.create(attrs));

  it('centres the caption under a frame that names neither side nor offset', () => {
    expect(framePlacement(picture({ wrap: 'topBottom' }))).toEqual({ textAlign: 'center', indent: null });
  });

  it('follows the side a frame is set against', () => {
    expect(framePlacement(picture({ wrap: 'topBottom', wrapAlign: 'right' })))
      .toEqual({ textAlign: 'right', indent: null });
  });

  it('indents to a frame’s own offset, which no alignment can express', () => {
    expect(framePlacement(picture({ wrap: 'topBottom', wrapOffset: 3.4 })))
      .toEqual({ textAlign: null, indent: 3.4 });
  });

  it('leaves an inline or side-wrapped picture to the flow', () => {
    // A side wrap has the caption beside the frame — where LibreOffice puts it too.
    expect(framePlacement(picture({ wrap: 'inline' }))).toBeNull();
    expect(framePlacement(picture({ wrap: 'right' }))).toBeNull();
    expect(framePlacement(schema.nodes.paragraph.create(null, schema.text('no picture')))).toBeNull();
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
