import { describe, it, expect } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
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

  // Two clients adding the first note at once make two sections, and a block can land past
  // one; the schema takes any merge, and the notes plugin makes it one section at the end.
  it('admits note sections anywhere, and the editor keeps one, last, in anchor order', () => {
    const schema = getSchema(extensions);
    const p = schema.nodes.paragraph.createAndFill()!;
    const note = schema.nodes.note.create(null, p);
    const section = schema.nodes.noteSection.create(null, note);
    expect(() => schema.nodes.doc.createChecked(null, [p, section, section, p])).not.toThrow();

    const ref = (id: string) => ({ type: 'noteRef', attrs: { id, kind: 'footnote', text: '' } });
    const body = (id: string, text: string) => ({ type: 'noteSection', content: [{ type: 'note', attrs: { id, kind: 'footnote', text: '' }, content: [{ type: 'text', text }] }] });
    const editor = new Editor({ extensions, content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'One' }, ref('b')] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two' }, ref('a')] },
      body('a', 'Note a'), body('b', 'Note b'), { type: 'paragraph', content: [{ type: 'text', text: 'Three' }] },
    ] } });
    editor.view.dispatch(editor.state.tr.insertText('!', 1));
    const doc = editor.state.doc;
    const sections: string[] = [];
    doc.forEach((n) => { if (n.type.name === 'noteSection') sections.push(n.children.map((c) => `${c.attrs.id}=${c.attrs.text}:${c.textContent}`).join(',')); });
    expect(sections).toEqual(['b=1:Note b,a=2:Note a']);
    expect(doc.lastChild!.type.name).toBe('noteSection');
    editor.destroy();
  });
});
