// Opening a document while revisions are recorded: the file itself is not this author's
// insertion, only what is typed after it. App.svelte marks the load with the RECORDING
// meta; without it the whole document arrives underlined in the author's colour.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TrackChanges, Insertion, Deletion, RECORDING, revisions } from '../../src/lib/editor/extensions/trackChanges';

function recordingEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, Insertion, Deletion,
      TrackChanges.configure({ recording: () => true, author: () => 'Ada' })],
    content: '<p>old</p>',
  });
}

describe('loading a document while recording', () => {
  it('leaves the loaded document unmarked', () => {
    const editor = recordingEditor();
    editor.chain().setMeta(RECORDING, true).setContent('<p>a file full of text</p>').run();
    expect(revisions(editor.state.doc)).toHaveLength(0);
    editor.destroy();
  });

  it('still records what is typed into it', () => {
    const editor = recordingEditor();
    editor.chain().setMeta(RECORDING, true).setContent('<p>a file</p>').run();
    editor.commands.insertContentAt(7, 'typed');
    const list = revisions(editor.state.doc);
    expect(list).toHaveLength(1);
    expect(editor.state.doc.textContent.slice(list[0].from - 1, list[0].to - 1)).toBe('typed');
    editor.destroy();
  });

  it('records a bare setContent, so the load has to say it is one', async () => {
    const editor = recordingEditor();
    editor.commands.setContent('<p>a file full of text</p>');
    // A replacement: rejected and re-dispatched a microtask later as both halves —
    // the document it replaced, struck out, and the new text.
    await Promise.resolve();
    expect(revisions(editor.state.doc).map((r) => r.kind)).toEqual(['deletion', 'insertion']);
    editor.destroy();
  });
});
