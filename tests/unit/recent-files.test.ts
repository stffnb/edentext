// The recent-files list (storage/recentFiles.ts): dedupe, newest first, capped at
// eight, tolerant of corrupt localStorage, and never recording a handle-less file —
// nothing could reopen it. jsdom has no IndexedDB, so the handle store no-ops.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadRecentFiles, rememberRecentFile, forgetRecentFile, forgetRecentFiles, readRecentFile } from '../../src/lib/storage/recentFiles';

const KEY = 'edentext-recent-files';

// A stand-in for a picker handle; without IndexedDB it is matched by name only.
const stubHandle = () => ({ isSameEntry: async () => false }) as unknown as FileSystemFileHandle;

describe('recent files', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty and survives corrupt or foreign values under its key', () => {
    expect(loadRecentFiles()).toEqual([]);
    localStorage.setItem(KEY, 'not json{');
    expect(loadRecentFiles()).toEqual([]);
    localStorage.setItem(KEY, '{"a":1}');
    expect(loadRecentFiles()).toEqual([]);
    localStorage.setItem(KEY, '[{"id":"x","name":"ok.odt","at":1},{"id":"y","at":2},null]');
    expect(loadRecentFiles().map((f) => f.name)).toEqual(['ok.odt']);
  });

  it('records nothing without a handle — there is nothing to reopen from', async () => {
    await rememberRecentFile('a.odt', null);
    expect(loadRecentFiles()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('remembers newest first and dedupes a same-named file, keeping its id', async () => {
    await rememberRecentFile('a.odt', stubHandle());
    await rememberRecentFile('b.odt', stubHandle());
    expect(loadRecentFiles().map((f) => f.name)).toEqual(['b.odt', 'a.odt']);

    const idA = loadRecentFiles()[1].id;
    await rememberRecentFile('a.odt', stubHandle());
    const list = loadRecentFiles();
    expect(list.map((f) => f.name)).toEqual(['a.odt', 'b.odt']);
    expect(list[0].id).toBe(idA);
  });

  it('keeps at most eight entries, dropping the oldest', async () => {
    for (let i = 1; i <= 10; i++) await rememberRecentFile(`f${i}.odt`, stubHandle());
    const names = loadRecentFiles().map((f) => f.name);
    expect(names).toHaveLength(8);
    expect(names[0]).toBe('f10.odt');
    expect(names).not.toContain('f1.odt');
    expect(names).not.toContain('f2.odt');
  });

  it('forgetRecentFile drops one entry, forgetRecentFiles removes the key', async () => {
    await rememberRecentFile('a.odt', stubHandle());
    await rememberRecentFile('b.odt', stubHandle());
    const idB = loadRecentFiles()[0].id;
    expect(forgetRecentFile(idB).map((f) => f.name)).toEqual(['a.odt']);
    forgetRecentFiles();
    expect(loadRecentFiles()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('readRecentFile reports a missing handle as gone', async () => {
    expect(await readRecentFile('nope')).toBe('gone');
  });
});
