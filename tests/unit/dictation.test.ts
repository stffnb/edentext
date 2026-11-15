// Dictation through its public entry points: the editor command a settled phrase goes
// through, and a session on a stand-in recognizer (window.SpeechRecognition).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';
import { setRecordChanges } from '../../src/lib/storage/trackChanges.svelte';
import { setUserName } from '../../src/lib/storage/userName.svelte';
import { revisions } from '../../src/lib/editor/extensions/trackChanges';

const make = (content: string) => new Editor({ element: document.createElement('div'), extensions, content });
const texts = (ed: Editor) => (ed.getJSON().content ?? []).map((p) => (p.content ?? []).map((n) => (n.type === 'hardBreak' ? '\n' : n.text ?? '')).join(''));

afterEach(() => setRecordChanges(false));

describe('insertDictation', () => {
  // [document, caret (null: end of the first paragraph), phrases, language, paragraphs after]
  const cases: [string, number | null, string[], string, string[]][] = [
    ['<p></p>', null, ['hello world'], 'en-US', ['Hello world']],
    ['<p>Hello</p>', null, ['world'], 'en-US', ['Hello world']],
    ['<p>It ends.</p>', null, ['and then'], 'en-US', ['It ends. And then']],
    ['<p></p>', null, ['first comma second period new paragraph third'], 'en-US', ['First, second.', 'Third']],
    ['<p></p>', null, ['hallo Komma Welt Punkt neue Zeile weiter'], 'de-DE', ['Hallo, Welt.\nWeiter']],
    // A recognizer that punctuates and capitalizes itself passes unchanged.
    ['<p></p>', null, ['Hello, world.', ' How are you?'], 'en-US', ['Hello, world. How are you?']],
    ['<p>Quoi</p>', null, ['?'], 'fr-FR', ['Quoi ?']],
    ['<p>abcd</p>', 3, ['x'], 'en-US', ['ab x cd']],
    ['<p>你好</p>', null, ['世界'], 'zh-CN', ['你好世界']],
  ];
  for (const [doc, caret, phrases, lang, want] of cases) {
    it(`${JSON.stringify(phrases)} in ${lang}`, () => {
      const ed = make(doc);
      ed.commands.setTextSelection(caret ?? ed.state.doc.firstChild!.nodeSize - 1);
      for (const p of phrases) ed.commands.insertDictation(p, lang);
      expect(texts(ed)).toEqual(want);
      ed.destroy();
    });
  }

  it('replaces the selection with its marks, one undo step per phrase', () => {
    const ed = make('<p>one <strong>two</strong> three</p>');
    ed.commands.setTextSelection({ from: 5, to: 8 });
    ed.commands.insertDictation('four', 'en-US');
    ed.commands.insertDictation('five', 'en-US');
    expect(texts(ed)).toEqual(['one four five three']);
    expect(JSON.stringify(ed.getJSON())).toContain('"marks":[{"type":"bold"}],"text":"four five"');
    ed.commands.undo();
    expect(texts(ed)).toEqual(['one four three']);
    ed.destroy();
  });

  it('is recorded as the user’s insertion while changes are recorded', () => {
    setUserName('Ada');
    setRecordChanges(true);
    const ed = make('<p>Hello</p>');
    ed.commands.setTextSelection(6);
    ed.commands.insertDictation('world', 'en-US');
    expect(revisions(ed.state.doc).map((r) => [r.kind, r.author, r.text])).toEqual([['insertion', 'Ada', ' world']]);
    ed.destroy();
  });

  it('shows the words still being heard without touching the document or the history', () => {
    const ed = make('<p>Hello</p>');
    const before = ed.state.doc;
    ed.commands.setDictationInterim('world');
    expect(ed.state.doc.eq(before)).toBe(true);
    expect(ed.can().undo()).toBe(false);
    ed.destroy();
  });
});

// A recognizer that reports what the test says it heard.
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = '';
  processLocally = false;
  continuous = false;
  interimResults = false;
  running = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.last = this; }
  start() { this.running = true; }
  stop() { this.running = false; }
  abort() { this.running = false; }
  hear(text: string, isFinal: boolean) {
    const result = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: Object.assign([result], { length: 1 }) });
  }
}

describe('dictation session', () => {
  it('asks once, inserts settled phrases where the caret is and stops on Esc or an error', async () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    vi.resetModules();
    const session = await import('../../src/lib/dictation/session.svelte');
    const { extensions: exts } = await import('../../src/lib/editor/extensions');
    const ed = new Editor({ element: document.createElement('div'), extensions: exts, content: '<p lang="de-DE">Hallo</p>' });
    ed.commands.setTextSelection(6);
    const unbind = session.bindDictation(() => ed, () => 'en-US');

    await session.toggleDictation();
    expect(session.dictationState().asking).toBe(true);
    session.answerDictationConsent(true);
    const rec = FakeRecognition.last!;
    expect([rec.running, rec.lang, session.dictationState().listening]).toEqual([true, 'de-DE', true]);

    rec.hear('Welt', false);
    expect(texts(ed)).toEqual(['Hallo']);
    rec.hear('Welt Punkt', true);
    expect(texts(ed)).toEqual(['Hallo Welt.']);
    // A recognizer ends after a pause; the session starts it again.
    rec.running = false;
    rec.onend?.();
    expect(rec.running).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect([rec.running, session.dictationState().listening]).toEqual([false, false]);

    // Consent is kept; an error ends the session and says why.
    await session.toggleDictation();
    expect(session.dictationState().asking).toBe(false);
    FakeRecognition.last!.onerror?.({ error: 'not-allowed' });
    expect(session.dictationState()).toMatchObject({ listening: false, error: 'denied' });

    unbind();
    ed.destroy();
    vi.unstubAllGlobals();
  });

  it('recognizes on this machine without asking where the browser has the language', async () => {
    class LocalRecognition extends FakeRecognition {
      static available = async (o: { processLocally: boolean }) => (o.processLocally ? 'available' : 'unavailable');
    }
    vi.stubGlobal('SpeechRecognition', LocalRecognition);
    localStorage.clear();
    vi.resetModules();
    const session = await import('../../src/lib/dictation/session.svelte');
    const { extensions: exts } = await import('../../src/lib/editor/extensions');
    const ed = new Editor({ element: document.createElement('div'), extensions: exts, content: '<p></p>' });
    const unbind = session.bindDictation(() => ed, () => 'en-US');
    await session.toggleDictation();
    expect([session.dictationState().asking, FakeRecognition.last!.processLocally, FakeRecognition.last!.running]).toEqual([false, true, true]);
    unbind();
    ed.destroy();
    vi.unstubAllGlobals();
  });
});
