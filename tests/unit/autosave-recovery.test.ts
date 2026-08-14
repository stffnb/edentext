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
