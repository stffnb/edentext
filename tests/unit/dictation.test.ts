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
    await (await import('../../src/lib/storage/hostConfig.svelte')).loadHostConfig();
    const { extensions: exts } = await import('../../src/lib/editor/extensions');
    const ed = new Editor({ element: document.createElement('div'), extensions: exts, content: '<p lang="de-DE">Hallo</p>' });
    ed.commands.setTextSelection(6);
    const unbind = session.bindDictation(() => ed, () => 'en-US');

    await session.toggleDictation();
    expect(session.dictationState().asking).toBe('browser');
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
    expect(session.dictationState().asking).toBeNull();
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
    expect([session.dictationState().asking, FakeRecognition.last!.processLocally, FakeRecognition.last!.running]).toEqual([null, true, true]);
    unbind();
    ed.destroy();
    vi.unstubAllGlobals();
  });
});

// The user's speech server: a stand-in microphone fed with bursts and pauses, and fetch
// answering for the server. Each pause sends a phrase; texts land in the order spoken.
describe('speech server dictation', () => {
  const RATE = 16000;
  let feed: ((s: Float32Array) => void) | null = null;
  const burst = (s: number) => Float32Array.from({ length: s * RATE }, (_, i) => 0.3 * Math.sin(i / 3));
  const pause = (s: number) => new Float32Array(s * RATE);

  async function setup(address: string, reply: (form: FormData, n: number) => Promise<Response>, host?: unknown) {
    localStorage.clear();
    if (address) localStorage.setItem('edentext-dictation', JSON.stringify({ server: address, model: 'whisper-1' }));
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    FakeRecognition.last = null;
    feed = null;
    let n = 0;
    // Only the server's calls are counted; the spell checker's dictionaries are not there.
    const fetch = vi.fn((_url: string, init: RequestInit) => reply(init.body as FormData, n++));
    vi.stubGlobal('fetch', (url: string, init: RequestInit) =>
      /audio\/transcriptions/.test(String(url)) ? fetch(String(url), init)
        : Promise.resolve(new Response(JSON.stringify({ dictation: host }), { status: host && /edentext\.config\.json$/.test(String(url)) ? 200 : 404 })));
    vi.resetModules();
    vi.doMock('../../src/lib/dictation/microphone', () => ({
      listen: async (on: (s: Float32Array) => void) => { feed = on; return { rate: RATE, stop: () => {} }; },
    }));
    const session = await import('../../src/lib/dictation/session.svelte');
    await (await import('../../src/lib/storage/hostConfig.svelte')).loadHostConfig();
    const { extensions: exts } = await import('../../src/lib/editor/extensions');
    const ed = new Editor({ element: document.createElement('div'), extensions: exts, content: '<p lang="de-DE">Hallo</p>' });
    ed.commands.setTextSelection(6);
    const unbind = session.bindDictation(() => ed, () => 'en-US');
    const done = () => { unbind(); ed.destroy(); vi.doUnmock('../../src/lib/dictation/microphone'); vi.unstubAllGlobals(); };
    const storage = await import('../../src/lib/storage/dictation.svelte');
    return { session, storage, ed, fetch, done };
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('sends each phrase at its pause and inserts the answers in order', async () => {
    // The first answer comes last; it is still inserted first.
    const { session, ed, fetch, done } = await setup('localhost:8000', (_f, n) =>
      new Promise((r) => setTimeout(() => r(json({ text: n === 0 ? ' Welt Komma' : 'wie geht es dir Fragezeichen' })), n === 0 ? 60 : 0)));
    await session.toggleDictation();
    expect(session.dictationState()).toMatchObject({ listening: true, asking: null });
    await vi.waitFor(() => expect(feed).toBeTypeOf('function'));
    await new Promise((r) => setTimeout(r));
    feed!(pause(0.4));
    feed!(burst(0.5));
    expect(fetch).not.toHaveBeenCalled();
    feed!(pause(0.8));
    expect(fetch).toHaveBeenCalledTimes(1);
    feed!(burst(0.7));
    feed!(pause(0.8));
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[0];
    const form = init.body as FormData;
    const file = form.get('file') as Blob;
    expect([url, form.get('model'), form.get('language'), form.get('response_format'), file.type])
      .toEqual(['http://localhost:8000/v1/audio/transcriptions', 'whisper-1', 'de', 'json', 'audio/wav']);
    expect(new DataView(await file.arrayBuffer()).getUint32(24, true)).toBe(RATE);
    await vi.waitFor(() => expect(texts(ed)).toEqual(['Hallo Welt, wie geht es dir?']));
    expect(FakeRecognition.last).toBeNull();
    session.stopDictation();
    done();
  });

  it('ends with a visible error and no other engine when the server fails', async () => {
    for (const [reply, code] of [
      [() => Promise.reject(new TypeError('Failed to fetch')), 'network'],
      [() => Promise.resolve(json({ detail: 'Model not found' }, 404)), 'server'],
    ] as const) {
      const { session, ed, done } = await setup('http://127.0.0.1:8000', reply);
      await session.toggleDictation();
      await vi.waitFor(() => expect(feed).toBeTypeOf('function'));
      await new Promise((r) => setTimeout(r));
      feed!(pause(0.4));
      feed!(burst(0.5));
      feed!(pause(0.8));
      await vi.waitFor(() => expect(session.dictationState()).toMatchObject({ listening: false, error: code }));
      expect([texts(ed), FakeRecognition.last]).toEqual([['Hallo'], null]);
      done();
    }
  });

  it('asks once per host before audio leaves this machine', async () => {
    const { session, done } = await setup('http://192.168.1.20:8000', () => Promise.resolve(json({ text: '' })));
    await session.toggleDictation();
    expect(session.dictationState()).toMatchObject({ listening: false, asking: '192.168.1.20:8000' });
    session.answerDictationConsent(true);
    expect(session.dictationState().listening).toBe(true);
    session.stopDictation();
    await session.toggleDictation();
    expect(session.dictationState()).toMatchObject({ listening: true, asking: null });
    session.stopDictation();
    done();
  });

  it('offers the installation’s server first, under its own name, beside the user’s and the browser’s', async () => {
    const speak = async () => { feed!(pause(0.4)); feed!(burst(0.5)); feed!(pause(0.8)); };
    const start = async (session: Awaited<ReturnType<typeof setup>>['session']) => {
      await session.toggleDictation();
      await vi.waitFor(() => expect(feed).toBeTypeOf('function'));
      await new Promise((r) => setTimeout(r));
    };
    let s = await setup('', () => Promise.resolve(json({ text: '' })), { server: '/stt/v1', model: 'host-model', apiKey: 'no' });
    await start(s.session);
    await speak();
    const [url, init] = s.fetch.mock.calls[0];
    expect([url, (init.body as FormData).get('model')]).toEqual([`${location.origin}/stt/v1/audio/transcriptions`, 'host-model']);
    s.session.stopDictation();
    s.done();

    s = await setup('', () => Promise.resolve(json({ text: '' })), { server: 'https://stt.example.org/v1' });
    await s.session.toggleDictation();
    expect(s.session.dictationState()).toMatchObject({ asking: 'stt.example.org', installation: true });
    s.session.answerDictationConsent(false);
    s.storage.setDictation({ server: 'http://127.0.0.1:8000', service: 'own' });
    await start(s.session);
    await speak();
    expect(s.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/v1/audio/transcriptions');
    s.session.stopDictation();
    s.done();

    // The services offered beside a user's own server, the default first; the browser's
    // stays on offer unless the installation takes it away.
    const X = 'https://stt.example.org/v1';
    for (const [host, offered] of [
      [{}, ['own', 'browser']],
      [{ server: X }, ['installation', 'own', 'browser']],
      [{ server: X, locked: true }, ['installation', 'browser']],
      [{ server: X, webSpeech: false }, ['installation', 'own']],
    ] as const) {
      s = await setup('http://127.0.0.1:8000', () => Promise.resolve(json({ text: '' })), host);
      expect([s.session.dictationServices(), s.session.dictationService(), s.session.dictationAvailable()]).toEqual([offered, offered[0], true]);
      s.storage.setDictation({ service: 'browser' });
      expect([s.session.dictationService(), s.session.dictationServer()]).toEqual(offered.includes('browser') ? ['browser', null] : [offered[0], expect.anything()]);
      s.done();
    }
    for (const [address, host] of [['http://127.0.0.1:8000', { enabled: false }], ['', { webSpeech: false }]] as const) {
      s = await setup(address, () => Promise.resolve(json({ text: '' })), host);
      expect(s.session.dictationAvailable()).toBe(false);
      s.done();
    }
  });
});
