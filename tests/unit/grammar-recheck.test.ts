// The pass after an edit re-lints the edited paragraph only; the other keeps its
// finding. Drives a real body editor with a stub linter that flags "run fast".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';

const { linted } = vi.hoisted(() => ({ linted: [] as string[] }));
vi.mock('../../src/lib/spell/grammar.svelte', () => ({
  grammarReady: () => true,
  subscribeGrammar: () => () => {},
  ignoreGrammar: () => {},
  lintText: async (text: string) => {
    linted.push(text);
    const i = text.indexOf('run fast');
    return i < 0 ? [] : [{ from: i, to: i + 8, message: 'Verb agreement', fixes: [{ kind: 'replace', text: 'runs fast' }] }];
  },
}));

const { extensions } = await import('../../src/lib/editor/extensions');
const { grammarErrorAt } = await import('../../src/lib/editor/extensions/grammarCheck');

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

// 'The dog run fast.' fills 1..18, so the second paragraph's text starts at 20.
const RUN_A = 10;
const RUN_B = 29;

async function makeEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions,
    content: { type: 'doc', content: [para('The dog run fast.'), para('The cat run fast.')] },
  });
  // The mount's whole-document pass waits for idle time and for the pagination to be
  // over, so it runs on real timers before the test takes them over.
  for (let i = 0; i < 100 && !grammarErrorAt(editor.state, RUN_B); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  linted.length = 0;
  return editor;
}

// The scheduler waits out the quiet window before it lints again.
async function settle(editor: Editor, until: () => boolean) {
  for (let i = 0; i < 100 && !until(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return editor;
}

afterEach(() => vi.restoreAllMocks());

describe('grammar recheck after an edit', () => {
  it('re-lints the edited paragraph only and keeps the other finding', async () => {
    const editor = await makeEditor();
    expect(grammarErrorAt(editor.state, RUN_A)?.message).toBe('Verb agreement');

    editor.view.dispatch(editor.state.tr.insertText('s', 31)); // cat run → cat runs
    await settle(editor, () => linted.length > 0);

    expect(linted).toEqual(['The cat runs fast.']);
    expect(grammarErrorAt(editor.state, RUN_B)).toBeNull();
    expect(grammarErrorAt(editor.state, RUN_A)?.message).toBe('Verb agreement');
    editor.destroy();
  });

  it('carries a finding\'s fixes on the decoration', async () => {
    const editor = await makeEditor();
    const found = grammarErrorAt(editor.state, RUN_A);
    expect(found).toMatchObject({ from: 9, to: 17, text: 'run fast' });
    expect(found?.fixes).toEqual([{ kind: 'replace', text: 'runs fast' }]);
    editor.destroy();
  });
});
