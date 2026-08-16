// Typing or pasting over a selection is a deletion and an insertion at once. Recording
// it as the insertion alone dropped the replaced text, so rejecting lost the original.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TextSelection } from '@tiptap/pm/state';
import { TrackChanges, Insertion, Deletion, revisions } from '../../src/lib/editor/extensions/trackChanges';

function editorOver(text: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, Insertion, Deletion,
      TrackChanges.configure({ recording: () => true, author: () => 'Ada' })],
    content: `<p>${text}</p>`,
  });
}

// Replace "quick" (positions 5–10 in "The quick fox") with "slow".
async function replaceQuick(editor: Editor) {
  const { state, view } = editor;
  view.dispatch(state.tr
    .setSelection(TextSelection.create(state.doc, 5, 10))
    .replaceSelectionWith(state.schema.text('slow'), false));
  await Promise.resolve();
}

describe('recording a replacement', () => {
  it('keeps the replaced text as a deletion beside the insertion', async () => {
    const editor = editorOver('The quick fox');
    await replaceQuick(editor);
    expect(editor.state.doc.textContent).toBe('The quickslow fox');
    expect(revisions(editor.state.doc).map((r) => [r.kind, r.text]))
      .toEqual([['deletion', 'quick'], ['insertion', 'slow']]);
    editor.destroy();
  });

  it('restores the original on reject', async () => {
    const editor = editorOver('The quick fox');
    await replaceQuick(editor);
    editor.commands.rejectRevisions(true);
    expect(editor.state.doc.textContent).toBe('The quick fox');
    editor.destroy();
  });

  it('keeps only the new text on accept', async () => {
    const editor = editorOver('The quick fox');
    await replaceQuick(editor);
    editor.commands.acceptRevisions(true);
    expect(editor.state.doc.textContent).toBe('The slow fox');
    editor.destroy();
  });
});
