// Applying a suggestion: the three fix kinds against the offsets Harper reports, and
// the marks of the replaced text carried over. The only place an offset bug hides.
import { describe, it, expect, vi } from 'vitest';
import { Editor } from '@tiptap/core';

vi.mock('../../src/lib/spell/grammar.svelte', () => ({
  grammarReady: () => false,
  subscribeGrammar: () => () => {},
  ignoreGrammar: () => {},
  lintText: async () => [],
}));

const { extensions } = await import('../../src/lib/editor/extensions');
const { grammarFix } = await import('../../src/lib/editor/extensions/grammarCheck');

function makeEditor(content: unknown) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions, content: content as never });
}

const para = (content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

describe('grammar fixes', () => {
  it('replaces, removes and inserts after the reported range', () => {
    for (const [fix, expected] of [
      [{ kind: 'replace' as const, text: 'runs' }, 'The dog runs fast'],
      [{ kind: 'remove' as const, text: '' }, 'The dog  fast'],
      [{ kind: 'insertAfter' as const, text: 's' }, 'The dog runs fast'],
    ]) {
      const editor = makeEditor(para([{ type: 'text', text: 'The dog run fast' }]));
      // 'run' sits at 9..12 — the document positions Harper's span maps onto.
      editor.view.dispatch(grammarFix(editor.state, { from: 9, to: 12 }, fix));
      expect(editor.state.doc.textBetween(1, editor.state.doc.content.size - 1)).toBe(expected);
      editor.destroy();
    }
  });

  it('keeps the marks of the text it replaces', () => {
    const editor = makeEditor(
      para([
        { type: 'text', text: 'The dog ' },
        { type: 'text', text: 'run', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' fast' },
      ]),
    );
    editor.view.dispatch(grammarFix(editor.state, { from: 9, to: 12 }, { kind: 'replace', text: 'runs' }));
    const marks = editor.state.doc.resolve(10).marks();
    expect(marks.map((m) => m.type.name)).toEqual(['bold']);
    editor.destroy();
  });
});
