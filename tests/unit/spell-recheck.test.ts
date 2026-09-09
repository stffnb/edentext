// The check after an edit looks at the edited paragraph only; the others keep their
// squiggles. Drives a real body editor with a stub checker that flags xx-words.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';

const { checks } = vi.hoisted(() => ({ checks: [] as string[] }));
vi.mock('../../src/lib/spell/controller', () => ({
  spellController: {
    isEnabled: () => true,
    check: (w: string) => { checks.push(w); return !w.startsWith('xx'); },
    suggest: () => [],
    getLanguage: () => 'en-US',
    addWord: () => {},
    ignoreWord: () => {},
    subscribe: () => () => {},
  },
}));

const { extensions } = await import('../../src/lib/editor/extensions');
const { spellErrorAt } = await import('../../src/lib/editor/extensions/spellCheck');

const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

async function makeEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions,
    content: { type: 'doc', content: [para('alpha xxone beta'), para('gamma xxtwo delta')] },
  });
  // The mount's whole-document check waits for idle time and for the pagination to be
  // over, so it runs on real timers before the test takes them over.
  for (let i = 0; i < 50 && !spellErrorAt(editor.state, XXONE); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  checks.length = 0;
  return editor;
}

// 'alpha xxone beta' fills 1..17, so the second paragraph's text starts at 19.
const XXONE = 8;
const XXTWO = 26;

afterEach(() => vi.useRealTimers());

describe('spell recheck after an edit', () => {
  it('checks the edited paragraph only and keeps the other squiggles', async () => {
    const editor = await makeEditor();
    expect(spellErrorAt(editor.state, XXONE)).toEqual({ from: 7, to: 12 });

    editor.view.dispatch(editor.state.tr.insertText('q', 24)); // gamma → gammaq
    vi.advanceTimersByTime(400);
    expect(checks).toEqual(['gammaq', 'xxtwo', 'delta']);
    expect(spellErrorAt(editor.state, XXONE)).toEqual({ from: 7, to: 12 });
    expect(spellErrorAt(editor.state, XXTWO + 1)).toEqual({ from: 26, to: 31 });
    editor.destroy();
  });

  it('drops a squiggle the edit fixed, and re-reads a paragraph a deletion emptied into', async () => {
    const editor = await makeEditor();
    editor.view.dispatch(editor.state.tr.insertText('two', 25, 30)); // xxtwo → two
    vi.advanceTimersByTime(400);
    expect(spellErrorAt(editor.state, XXTWO)).toBeNull();
    expect(spellErrorAt(editor.state, XXONE)).toEqual({ from: 7, to: 12 });

    checks.length = 0;
    editor.view.dispatch(editor.state.tr.delete(19, 25)); // 'gamma ' gone: a point, not a range
    vi.advanceTimersByTime(400);
    expect(checks).toEqual(['two', 'delta']);
    editor.destroy();
  });
});
