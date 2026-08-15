// What the reviewing pane needs: a colour per author, in order of first appearance, and
// accept/reject by change id — a change split by a paragraph boundary is one row there
// and must be applied whole. Drives a real editor with just the track-changes extension.
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { TrackChanges, Insertion, Deletion, revisions, authorColorIndex, REVISION_AUTHOR_COLORS } from '../../src/lib/editor/extensions/trackChanges';

type N = any;

const R = (kind: string, id: string, author: string, text: string): N =>
  ({ type: 'text', text, marks: [{ type: kind, attrs: { id, author, date: '2026-08-14T10:00:00.000Z' } }] });

function makeEditor(content: N) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: [Document, Paragraph, Text, Insertion, Deletion, TrackChanges], content });
}

// One change (r1) split over two paragraphs, plus a second author's deletion.
const doc: N = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'a ' }, R('insertion', 'r1', 'Ada', 'one')] },
    { type: 'paragraph', content: [R('insertion', 'r1', 'Ada', 'two'), { type: 'text', text: ' b ' }, R('deletion', 'r2', 'Grace', 'gone')] },
  ],
};

describe('revisions for the reviewing pane', () => {
  it('gives each author its own palette slot, in order of appearance', () => {
    const editor = makeEditor(doc);
    const order = authorColorIndex(revisions(editor.state.doc));
    expect(order.get('Ada')).toBe(0);
    expect(order.get('Grace')).toBe(1);
    expect(REVISION_AUTHOR_COLORS[0]).not.toBe(REVISION_AUTHOR_COLORS[1]);
    editor.destroy();
  });

  it('accepts every range of one change and leaves the others', () => {
    const editor = makeEditor(doc);
    editor.commands.acceptRevision('r1');
    const left = revisions(editor.state.doc);
    expect(left.map((r) => r.id)).toEqual(['r2']);
    expect(editor.state.doc.textContent).toBe('a onetwo b gone');
    editor.destroy();
  });

  it('rejects a change by id: an insertion goes, a deletion comes back', () => {
    const editor = makeEditor(doc);
    editor.commands.rejectRevision('r1');
    expect(editor.state.doc.textContent).toBe('a  b gone');
    editor.commands.acceptRevision('r2');
    expect(editor.state.doc.textContent).toBe('a  b ');
    expect(revisions(editor.state.doc)).toHaveLength(0);
    editor.destroy();
  });
});
