import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadDocument, markDocumentLoaded, saveDocument } from '../../src/lib/storage/autosave';

// A document that freezes the editor would be reloaded from localStorage forever, so
// loading raises a boot flag that only a completed startup clears.
describe('autosave crash recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { void cb; return 0; });
    vi.stubGlobal('alert', () => {});
  });

  it('loads the document again after a startup that completed', () => {
    localStorage.setItem('odf-editor-doc', '{"type":"doc"}');
    expect(loadDocument()).toEqual({ type: 'doc' });
    markDocumentLoaded();
    expect(loadDocument()).toEqual({ type: 'doc' });
  });

  it('parks the document and starts empty when the last startup never finished', () => {
    localStorage.setItem('odf-editor-doc', '{"type":"doc"}');
    loadDocument(); // raises the boot flag, then the "editor hangs"
    expect(loadDocument()).toBeNull();
    expect(localStorage.getItem('odf-editor-doc-broken')).toBe('{"type":"doc"}');
    expect(localStorage.getItem('odf-editor-doc')).toBeNull();
  });

  it('keeps the next document after a recovery', () => {
    localStorage.setItem('odf-editor-doc', '{"type":"doc","content":[]}');
    loadDocument();
    expect(loadDocument()).toBeNull(); // recovered: boot flag cleared, doc parked
    vi.useFakeTimers();
    saveDocument({ type: 'doc' });
    vi.runAllTimers();
    vi.useRealTimers();
    expect(loadDocument()).toEqual({ type: 'doc' });
  });
});
