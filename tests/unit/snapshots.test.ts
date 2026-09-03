import { describe, it, expect, vi } from 'vitest';

// A two-call IndexedDB in memory — what openDb/idbRequest (storage/idb.ts) ask for.
function fakeIndexedDb() {
  const data = new Map<number, unknown>();
  const req = (result: unknown) => {
    const r: Record<string, unknown> = { result };
    queueMicrotask(() => (r.onsuccess as (() => void) | undefined)?.());
    return r;
  };
  const store = {
    put: (v: unknown, k: number) => { data.set(k, v); return req(undefined); },
    get: (k: number) => req(data.get(k)),
    getAllKeys: () => req([...data.keys()]),
    delete: (k: number) => { data.delete(k); return req(undefined); },
  };
  const db = { transaction: () => ({ objectStore: () => store }), createObjectStore: () => {}, close: () => {} };
  return {
    data,
    open: () => {
      const r: Record<string, unknown> = { result: db };
      queueMicrotask(() => {
        (r.onupgradeneeded as (() => void) | undefined)?.();
        (r.onsuccess as (() => void) | undefined)?.();
      });
      return r;
    },
  };
}

describe('the autosave keeps a few earlier versions', () => {
  it('takes one every few minutes and holds on to the newest three', async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal('indexedDB', { open: idb.open });
    const { keepSnapshot, snapshots, readSnapshot } = await import('../../src/lib/storage/snapshots.svelte');
    const now = vi.spyOn(Date, 'now');
    const at = (min: number) => 1_800_000_000_000 + min * 60_000;

    now.mockReturnValue(at(0));
    await keepSnapshot({ type: 'doc', v: 1 });
    now.mockReturnValue(at(1));
    await keepSnapshot({ type: 'doc', v: 2 }); // a minute on: still the same version
    expect(snapshots()).toEqual([at(0)]);

    for (const m of [6, 12, 18]) {
      now.mockReturnValue(at(m));
      await keepSnapshot({ type: 'doc', v: m });
    }
    expect(snapshots()).toEqual([at(18), at(12), at(6)]);
    expect(idb.data.size).toBe(3);
    expect(await readSnapshot(at(12))).toEqual({ type: 'doc', v: 12 });
    expect(await readSnapshot(at(0))).toBeNull();
  });
});
