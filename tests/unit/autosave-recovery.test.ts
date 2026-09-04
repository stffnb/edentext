import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDocument, markDocumentLoaded, saveDocument } from '../../src/lib/storage/autosave';
import { keepSnapshot } from '../../src/lib/storage/snapshots';
import { fakeIndexedDb } from '../fakeIdb';

// A document that freezes the editor would be reloaded from localStorage forever, so
// loading raises a boot flag that only a completed startup clears. Loading is async
// because the document's pictures come back out of IndexedDB (imageStore.ts).
describe('autosave crash recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { void cb; return 0; });
    vi.stubGlobal('alert', () => {});
    vi.stubGlobal('confirm', () => false);
  });

  it('loads the document again after a startup that completed', async () => {
    localStorage.setItem('edentext-doc', '{"type":"doc"}');
    expect(await loadDocument()).toEqual({ type: 'doc' });
    markDocumentLoaded();
    expect(await loadDocument()).toEqual({ type: 'doc' });
  });

  it('parks the document and starts empty when the last startup never finished', async () => {
    localStorage.setItem('edentext-doc', '{"type":"doc"}');
    await loadDocument(); // raises the boot flag, then the "editor hangs"
    expect(await loadDocument()).toBeNull();
    expect(localStorage.getItem('edentext-doc-broken')).toBe('{"type":"doc"}');
    expect(localStorage.getItem('edentext-doc')).toBeNull();
  });

  it('loads the document again when the user asks for another try', async () => {
    vi.stubGlobal('confirm', () => true);
    localStorage.setItem('edentext-doc', '{"type":"doc"}');
    await loadDocument();
    expect(await loadDocument()).toEqual({ type: 'doc' });
    expect(localStorage.getItem('edentext-doc-broken')).toBeNull();
    expect(localStorage.getItem('edentext-doc-loading')).toBe('1');
  });

  it('keeps the next document after a recovery', async () => {
    localStorage.setItem('edentext-doc', '{"type":"doc","content":[]}');
    await loadDocument();
    expect(await loadDocument()).toBeNull(); // recovered: boot flag cleared, doc parked
    vi.useFakeTimers();
    saveDocument({ type: 'doc' });
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await loadDocument()).toEqual({ type: 'doc' });
  });
});

// Nothing in the UI points at the kept versions: a document that cannot be loaded is
// where they are offered, one question each, newest first.
describe('a document that cannot be loaded falls back on a kept version', () => {
  // A version is kept at most every five minutes, and an earlier test in this file has
  // already taken one — so each case sets its own clock well past that window.
  let clock = 2_000_000_000_000;
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { void cb; return 0; });
    vi.stubGlobal('alert', () => {});
    vi.stubGlobal('indexedDB', { open: fakeIndexedDb().open });
    vi.spyOn(Date, 'now').mockReturnValue((clock += 600_000));
  });

  it('offers the version once the reader gives up on the document', async () => {
    await keepSnapshot({ type: 'doc', content: [{ type: 'paragraph' }] });
    localStorage.setItem('edentext-doc', '{"type":"doc"}');
    await loadDocument(); // raises the boot flag, then the "editor hangs"
    // First question: another try, declined. Second: the kept version, taken.
    let asked = 0;
    vi.stubGlobal('confirm', () => asked++ > 0);
    expect(await loadDocument()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(asked).toBe(2);
    // The parked document stays where it was, and the version starts under the flag.
    expect(localStorage.getItem('edentext-doc-broken')).toBe('{"type":"doc"}');
    expect(localStorage.getItem('edentext-doc-loading')).toBe('1');
  });

  it('starts empty when every version is turned down', async () => {
    await keepSnapshot({ type: 'doc', content: [] });
    localStorage.setItem('edentext-doc', '{"type":"doc"}');
    await loadDocument();
    vi.stubGlobal('confirm', () => false);
    expect(await loadDocument()).toBeNull();
  });
});

// The debounce is a second; a tab closed inside it would lose that second. Hiding
// the page writes what is pending at once, without the IndexedDB round trip.
describe('autosave flush on pagehide', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('alert', () => {});
  });

  it('writes the pending document when the page is hidden', () => {
    vi.useFakeTimers();
    saveDocument({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(localStorage.getItem('edentext-doc')).toBeNull();
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem('edentext-doc')!)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    vi.useRealTimers();
  });

  it('writes nothing when nothing is pending', async () => {
    vi.useFakeTimers();
    saveDocument({ type: 'doc' });
    await vi.runAllTimersAsync();
    localStorage.removeItem('edentext-doc');
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem('edentext-doc')).toBeNull();
    vi.useRealTimers();
  });
});
