// A paragraph's language checks its own words only: the paragraphs after it fall back
// to the document's language. Drives a real body editor with a recording stub checker.
import { describe, it, expect, vi } from 'vitest';
import { Editor } from '@tiptap/core';

const { checks } = vi.hoisted(() => ({ checks: new Map<string, string | undefined>() }));
vi.mock('../../src/lib/spell/controller', () => ({
  spellController: {
    isEnabled: () => true,
    check: (w: string, code?: string) => { checks.set(w, code); return true; },
    suggest: () => [],
    getLanguage: () => 'de',
    addWord: () => {},
    ignoreWord: () => {},
    subscribe: () => () => {},
    refresh: () => {},
    knownShare: () => 0,
  },
}));

const { extensions } = await import('../../src/lib/editor/extensions');

describe('a paragraph language', () => {
  it('does not carry over to the paragraphs after it', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions,
      content: { type: 'doc', content: [
        { type: 'paragraph', attrs: { lang: 'en-US' }, content: [{ type: 'text', text: 'english' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'deutsch' }] },
      ] },
    });
    for (let i = 0; i < 50 && !checks.has('deutsch'); i++) await new Promise((r) => setTimeout(r, 10));
    expect(checks.get('english')).toBeTruthy();
    expect(checks.has('deutsch')).toBe(true);
    expect(checks.get('deutsch')).toBeUndefined();
    editor.destroy();
  });
});
