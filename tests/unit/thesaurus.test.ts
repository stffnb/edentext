// The thesaurus lookup: a word is matched as a whole group member, never as a
// substring of one, and the groups come back without the word itself.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { synonyms, loadThesaurus } from '../../src/lib/spell/thesaurus';
import { NO_LANGUAGE } from '../../src/lib/storage/documentLanguage';

const DATA = [
  'Ausgedingehaus;Stöckli;Haus',
  'Haus;Gebäude;Bauwerk',
  'Haus;Zuhause;Heim',
  'Hausboot;Boot',
  'schnell;rasch;flink',
  'C++;Programmiersprache',
].join('\n');

// One language per test file run: the module caches a loaded thesaurus for the session.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(DATA, { status: 200 })));
});

describe('synonyms', () => {
  it('returns every group the word is in, without the word', async () => {
    // The groups leading with it come first — its own senses before a compound's.
    expect(await synonyms('de', 'Haus')).toEqual([
      ['Gebäude', 'Bauwerk'],
      ['Zuhause', 'Heim'],
      ['Ausgedingehaus', 'Stöckli'],
    ]);
  });

  it('matches whole members only, and ignores case', async () => {
    expect(await synonyms('de', 'haus')).toHaveLength(3); // the groups holding Haus, not Hausboot's
    expect(await synonyms('de', 'boot')).toEqual([['Hausboot']]);
  });

  it('takes a word with regex characters in it', async () => {
    expect(await synonyms('de', 'C++')).toEqual([['Programmiersprache']]);
  });

  it('has nothing for an unknown word or no language', async () => {
    expect(await synonyms('de', 'Fahrrad')).toEqual([]);
    expect(await synonyms(NO_LANGUAGE, 'Haus')).toEqual([]);
  });

  it('fetches the file once per language', async () => {
    await synonyms('en', 'Haus'); // 'en' is untouched above, so this is its first load
    await loadThesaurus('en');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('has nothing, quietly, for a language the instance does not serve', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    // A 404, or a server that answers every unknown path with its HTML page.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await synonyms('it', 'casa')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })));
    expect(await synonyms('es', 'casa')).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it('loads French data and preserves accented synonyms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(readFileSync('public/thesaurus/fr/fr.txt'), { status: 200 })));

    const groups = await synonyms('fr', 'maison');
    expect(groups.flat()).toContain('bâtisse');
    expect(groups.flat()).not.toContain('maison');
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/thesaurus/fr/fr.txt');
  });

  it('finds an Arabic word whether or not it is written with vowel marks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(readFileSync('public/thesaurus/ar/ar.txt'), { status: 200 })));

    expect((await synonyms('ar', 'جميل')).flat()).toContain('حسن');
    expect(await synonyms('ar', 'جَمِيل')).toEqual(await synonyms('ar', 'جميل'));
  });

  it('looks an Arabic word up past its article and proclitics, and gives them back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(readFileSync('public/thesaurus/ar/ar.txt'), { status: 200 })));

    const bare = (await synonyms('ar', 'فاسد')).flat();
    expect(bare).toContain('رديء');
    expect((await synonyms('ar', 'الفاسد')).flat()).toEqual(bare.map((w) => (w.includes(' ') || w.startsWith('ال') ? w : 'ال' + w)));
    expect((await synonyms('ar', 'وفاسد')).flat()).toContain('ورديء');
    expect((await synonyms('ar', 'بالفاسد')).flat()).toContain('بالرديء');
    expect((await synonyms('ar', 'للفاسد')).flat()).toContain('للرديء');
    expect((await synonyms('ar', 'والفاسد')).flat()).toContain('والرديء');
    // A stem the thesaurus does not know is no match, however the word begins.
    expect(await synonyms('ar', 'بلابلابل')).toEqual([]);
  });

  it('loads Portuguese data and preserves accented synonyms', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(readFileSync('public/thesaurus/pt/pt.txt'), { status: 200 })));

    const groups = await synonyms('pt', 'casa');
    expect(groups.flat()).toContain('habitação');
    expect(groups.flat()).not.toContain('casa');
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/thesaurus/pt/pt.txt');
  });
});
