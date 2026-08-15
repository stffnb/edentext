// The recent-files list (storage/recentFiles.ts): dedupe by name, newest first,
// capped at eight, and tolerant of corrupt localStorage. jsdom has no IndexedDB,
// so the handle side no-ops — exactly the browser-without-picker path.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadRecentFiles, rememberRecentFile, forgetRecentFiles } from '../../src/lib/storage/recentFiles';

const KEY = 'edentext-recent-files';

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

  it('remembers newest first and dedupes a handleless file by name, keeping its id', async () => {
    await rememberRecentFile('a.odt', null);
    await rememberRecentFile('b.odt', null);
    expect(loadRecentFiles().map((f) => f.name)).toEqual(['b.odt', 'a.odt']);

    const idA = loadRecentFiles()[1].id;
    await rememberRecentFile('a.odt', null);
    const list = loadRecentFiles();
    expect(list.map((f) => f.name)).toEqual(['a.odt', 'b.odt']);
    expect(list[0].id).toBe(idA);
  });

  it('keeps at most eight entries, dropping the oldest', async () => {
    for (let i = 1; i <= 10; i++) await rememberRecentFile(`f${i}.odt`, null);
    const names = loadRecentFiles().map((f) => f.name);
    expect(names).toHaveLength(8);
    expect(names[0]).toBe('f10.odt');
    expect(names).not.toContain('f1.odt');
    expect(names).not.toContain('f2.odt');
  });

  it('forgetRecentFiles clears the list and removes the key', async () => {
    await rememberRecentFile('a.odt', null);
    forgetRecentFiles();
    expect(loadRecentFiles()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
