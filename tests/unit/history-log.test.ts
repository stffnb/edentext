// The labelled undo/redo mirror (utils/historyLog.svelte.ts) against a live editor:
// labels per edit kind, entries moving between the stacks on undo/redo, and the
// redo branch being discarded by a fresh edit.
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { extensions } from '../../src/lib/editor/extensions';
import { historyLog, recordTransaction, resetHistoryLog } from '../../src/lib/utils/historyLog.svelte';

function makeEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    onTransaction: ({ editor, transaction }) => recordTransaction(editor.state, transaction),
  });
}

// Consecutive edits in one test tick share a timestamp and would merge into one
// undo group; an explicit group boundary keeps one log entry per edit.
const endGroup = (editor: Editor) =>
  editor.view.dispatch(closeHistory(editor.state.tr));

const undoLabels = () => historyLog.undo.map((e) => e.label);
const redoLabels = () => historyLog.redo.map((e) => e.label);

describe('history log', () => {
  beforeEach(resetHistoryLog);

  it('labels typing, marks, structure and delete', () => {
    const editor = makeEditor();
    editor.commands.insertContent('Hello world');
    endGroup(editor);
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    endGroup(editor);
    editor.commands.insertContentAt(editor.state.doc.content.size,
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] });
    endGroup(editor);
    editor.chain().setTextSelection({ from: 7, to: 12 }).deleteSelection().run();

    expect(undoLabels()).toEqual(['Typing: “Hello world”', 'Bold', 'Heading 2', 'Delete']);
    expect(redoLabels()).toEqual([]);
    editor.destroy();
  });

  it('labels feature nodes and marks', () => {
    const editor = makeEditor();
    editor.commands.insertContent('Hello');
    endGroup(editor);
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'image', attrs: { src: 'data:,' } });
    endGroup(editor);
    editor.commands.insertNote('footnote');
    endGroup(editor);
    editor.chain().setTextSelection({ from: 1, to: 6 }).setLink({ href: 'https://example.com' }).run();

    expect(undoLabels()).toEqual(['Typing: “Hello”', 'Insert image', 'Footnote', 'Link']);
    editor.destroy();
  });

  it('moves entries across on undo/redo and keeps counts at the plugin depths', () => {
    const editor = makeEditor();
    editor.commands.insertContent('one');
    endGroup(editor);
    editor.chain().selectAll().toggleBold().run();

    editor.commands.undo();
    expect(undoLabels()).toEqual(['Typing: “one”']);
    expect(redoLabels()).toEqual(['Bold']);

    editor.commands.redo();
    expect(undoLabels()).toEqual(['Typing: “one”', 'Bold']);
    expect(redoLabels()).toEqual([]);
    editor.destroy();
  });

  it('a fresh edit after undo discards the redo branch', () => {
    const editor = makeEditor();
    editor.commands.insertContent('one');
    endGroup(editor);
    editor.commands.insertContent(' two');
    editor.commands.undo();
    expect(redoLabels()).toHaveLength(1);

    editor.commands.insertContent(' three');
    expect(redoLabels()).toEqual([]);
    expect(undoLabels()).toEqual(['Typing: “one”', 'Typing: “three”']);
    editor.destroy();
  });
});
