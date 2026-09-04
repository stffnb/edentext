import { describe, it, expect, vi } from 'vitest';
import { fakeIndexedDb } from '../fakeIdb';

describe('the autosave keeps a few earlier versions', () => {
  it('takes one every few minutes and holds on to the newest three', async () => {
    const idb = fakeIndexedDb();
    vi.stubGlobal('indexedDB', { open: idb.open });
    const { keepSnapshot, listSnapshots, readSnapshot } = await import('../../src/lib/storage/snapshots');
    const now = vi.spyOn(Date, 'now');
    const at = (min: number) => 1_800_000_000_000 + min * 60_000;

    now.mockReturnValue(at(0));
    await keepSnapshot({ type: 'doc', v: 1 });
    now.mockReturnValue(at(1));
    await keepSnapshot({ type: 'doc', v: 2 }); // a minute on: still the same version
    expect(await listSnapshots()).toEqual([at(0)]);

    for (const m of [6, 12, 18]) {
      now.mockReturnValue(at(m));
      await keepSnapshot({ type: 'doc', v: m });
    }
    expect(await listSnapshots()).toEqual([at(18), at(12), at(6)]);
    expect(idb.data.size).toBe(3);
    expect(await readSnapshot(at(12))).toEqual({ type: 'doc', v: 12 });
    expect(await readSnapshot(at(0))).toBeNull();
  });
});
