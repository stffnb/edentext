import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDocument, markDocumentLoaded, saveDocument } from '../../src/lib/storage/autosave';

// A document that freezes the editor would be reloaded from localStorage forever, so
// loading raises a boot flag that only a completed startup clears. Loading is async
// because the document's pictures come back out of IndexedDB (imageStore.ts).
describe('autosave crash recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { void cb; return 0; });
    vi.stubGlobal('alert', () => {});
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
