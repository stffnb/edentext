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

  it('reads a word split by a formatting change as one word, ended by a break', async () => {
    checks.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bold = (text: string) => ({ type: 'text', text, marks: [{ type: 'bold' }] });
    const editor = new Editor({
      element: el,
      extensions,
      content: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hospi' }, bold('ta'), { type: 'text', text: 'lity' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'مست' }, bold('شفي'), { type: 'text', text: 'ات one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] },
      ] },
    });
    for (let i = 0; i < 50 && !checks.has('two'); i++) await new Promise((r) => setTimeout(r, 10));
    expect([...checks.keys()].sort()).toEqual(['hospitality', 'one', 'two', 'مستشفيات'].sort());
    editor.destroy();
  });

  it('checks Hangul words in the asian language and leaves Han, kana and mixed tokens alone', async () => {
    checks.clear();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const bold = (text: string) => ({ type: 'text', text, marks: [{ type: 'bold' }] });
    const editor = new Editor({
      element: el,
      extensions,
      content: { type: 'doc', content: [
        { type: 'paragraph', attrs: { langAsian: 'ko-KR' }, content: [{ type: 'text', text: '한' }, bold('국'), { type: 'text', text: '어 Word를 한글ABC 100원짜리 漢字 ひらがな 日本語의' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '사랑 last' }] },
      ] },
    });
    for (let i = 0; i < 50 && !checks.has('last'); i++) await new Promise((r) => setTimeout(r, 10));
    expect([...checks.entries()].sort()).toEqual([['last', undefined], ['사랑', undefined], ['한국어', 'ko-KR']].sort());
    editor.destroy();
  });
});
