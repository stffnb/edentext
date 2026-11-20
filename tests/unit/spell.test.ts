// @vitest-environment node
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModule, type Hunspell } from 'hunspell-asm';
import { checkerOf, type Checker } from '../../src/lib/spell/dictionary';

// Exercises the real engine against the vendored dictionaries, mirroring
// dictionary.ts's mount+create. Guards German compounds, which rely on the
// .aff COMPOUND rules.
function dictPath(rel: string): string {
  return fileURLToPath(new URL(`../../public/dictionaries/${rel}`, import.meta.url));
}

async function makeChecker(code: string): Promise<Hunspell> {
  const factory = await loadModule();
  const aff = factory.mountBuffer(readFileSync(dictPath(`${code}/${code}.aff`)), `${code}.aff`);
  const dic = factory.mountBuffer(readFileSync(dictPath(`${code}/${code}.dic.txt`)), `${code}.dic`);
  return factory.create(aff, dic);
}

describe('German spell-check (hunspell-asm)', () => {
  let de: Hunspell;
  beforeAll(async () => {
    de = await makeChecker('de');
  });

  it('accepts compound words that are not standalone dictionary entries', () => {
    for (const w of ['Fußgänger', 'Krankenversicherung', 'Bundesausbildungsförderungsgesetz', 'Autobahnraststätte']) {
      expect(de.spell(w), w).toBe(true);
    }
  });

  it('accepts base words with umlauts and ß', () => {
    for (const w of ['Straße', 'Universität', 'Häuser', 'schön']) {
      expect(de.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(de.spell('Computerx')).toBe(false);
    expect(de.suggest('Computerx')).toContain('Computer');
  });

  it('accepts a runtime-added personal word', () => {
    expect(de.spell('Claudewort')).toBe(false);
    de.addWord('Claudewort');
    expect(de.spell('Claudewort')).toBe(true);
  });
});

describe('Spanish spell-check (hunspell-asm)', () => {
  let es: Hunspell;
  beforeAll(async () => {
    es = await makeChecker('es');
  });

  it('accepts accented words and ñ', () => {
    for (const w of ['español', 'mañana', 'corazón', 'vergüenza']) {
      expect(es.spell(w), w).toBe(true);
    }
  });

  // Pronouns glued onto the verb; they come from the .aff rules, not the word list.
  it('accepts enclitic verb forms', () => {
    for (const w of ['dámelo', 'decírselo']) {
      expect(es.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(es.spell('ordenadr')).toBe(false);
    expect(es.suggest('ordenadr')).toContain('ordenador');
  });
});

describe('French spell-check (hunspell-asm)', () => {
  let fr: Hunspell;
  beforeAll(async () => {
    fr = await makeChecker('fr');
  });

  it('accepts accents, a cedilla and a ligature', () => {
    for (const w of ['français', 'garçon', 'Noël', 'cœur']) {
      expect(fr.spell(w), w).toBe(true);
    }
  });

  it('accepts conjugated and inflected forms from the affix rules', () => {
    for (const w of ['mangeaient', 'finissions', 'heureuses']) {
      expect(fr.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(fr.spell('françias')).toBe(false);
    expect(fr.suggest('françias')).toContain('français');
  });
});

describe('Portuguese spell-check (hunspell-asm)', () => {
  let pt: Hunspell;
  beforeAll(async () => {
    pt = await makeChecker('pt');
  });

  it('accepts accents, a cedilla and inflected forms', () => {
    for (const w of ['português', 'ação', 'coração', 'informações']) {
      expect(pt.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(pt.spell('computadr')).toBe(false);
    expect(pt.suggest('computadr')).toContain('computador');
  });
});

describe('Russian spell-check (hunspell-asm)', () => {
  let ru: Hunspell;
  beforeAll(async () => {
    ru = await makeChecker('ru');
  });

  it('accepts Cyrillic base words, ё and a hyphenated form', () => {
    for (const w of ['язык', 'Москва', 'съёмка', 'по-русски']) {
      expect(ru.spell(w), w).toBe(true);
    }
  });

  // Inflections come from the .aff rules, not the word list.
  it('accepts inflected forms', () => {
    for (const w of ['сделанный', 'программы', 'книгами']) {
      expect(ru.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(ru.spell('компютер')).toBe(false);
    expect(ru.suggest('компютер')).toContain('компьютер');
  });
});

describe('Ukrainian spell-check (hunspell-asm)', () => {
  let uk: Hunspell;
  beforeAll(async () => {
    uk = await makeChecker('uk');
  });

  // The word list writes the apostrophe as ', the .aff maps ’ and ʼ onto it (ICONV).
  it('accepts ґ, є, ї and every apostrophe form', () => {
    for (const w of ['ґанок', 'Київ', 'єдність', "м'ясо", 'м’ясо', 'мʼясо']) {
      expect(uk.spell(w), w).toBe(true);
    }
  });

  it('accepts inflected forms', () => {
    for (const w of ['книжками', 'програми', 'зробленого']) {
      expect(uk.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(uk.spell('компютер')).toBe(false);
    expect(uk.suggest('компютер')).toContain("комп'ютер");
  });
});

describe('Indonesian spell-check (hunspell-asm)', () => {
  let id: Hunspell;
  beforeAll(async () => {
    id = await makeChecker('id');
  });

  // The word list holds roots; prefixes, suffixes and circumfixes come from the .aff.
  it('accepts affixed and reduplicated forms', () => {
    for (const w of ['membaca', 'dipelajari', 'perpustakaan', 'mempertanggungjawabkan', 'bukunya', 'buku-buku']) {
      expect(id.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(id.spell('perpustakan')).toBe(false);
    expect(id.suggest('perpustakan')).toContain('perpustakaan');
  });
});

describe('Polish spell-check (hunspell-asm)', () => {
  let pl: Hunspell;
  beforeAll(async () => {
    pl = await makeChecker('pl');
  });

  // The affix file ships as ISO-8859-2 and is vendored as UTF-8, so the diacritics must match.
  it('accepts diacritics and inflected forms', () => {
    for (const w of ['źdźbło', 'zażółcić', 'gęślą', 'jaźń', 'najpiękniejszymi', 'nieprzyjacielskiego', 'Warszawie']) {
      expect(pl.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(pl.spell('zażułcić')).toBe(false);
    expect(pl.suggest('zażułcić')).toContain('zażółcić');
  });
});

describe('Arabic spell-check (hunspell-asm)', () => {
  let ar: Hunspell;
  beforeAll(async () => {
    ar = await makeChecker('ar');
  });

  // Article, conjunction, preposition and pronoun attach to the word; vowel marks and
  // the tatweel that stretches a word are optional in writing.
  it('accepts attached particles, vowelled and stretched words', () => {
    for (const w of ['كتاب', 'الكتاب', 'والكتاب', 'بالكتاب', 'كتابها', 'يكتبون', 'المدارس', 'كِتَابٌ', 'العـــربية']) {
      expect(ar.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(ar.spell('مدرصة')).toBe(false);
    expect(ar.suggest('مدرصة')).toContain('مدرسة');
  });
});

describe('Italian spell-check (hunspell-asm)', () => {
  let it_: Checker;
  beforeAll(async () => {
    it_ = checkerOf(await makeChecker('it'));
  });

  // The word list stores elisions with ', which AutoCorrect types as ’.
  it('accepts accents and elisions with either apostrophe', () => {
    for (const w of ['perché', 'città', "l'anno", 'l’anno', 'dell’arte', 'un’altra', 'dicessero']) {
      expect(it_.correct(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(it_.correct('squola')).toBe(false);
    expect(it_.suggest('squola')).toContain('scuola');
    expect(it_.suggest('dell’artte')).toContain('dell’arte');
  });
});

describe('British spell-check (hunspell-asm)', () => {
  let gb: Hunspell;
  beforeAll(async () => {
    gb = await makeChecker('en-GB');
  });

  it('accepts the British spellings the US list rejects', () => {
    for (const w of ['colour', 'organise', 'centre', 'travelling', 'favourite']) {
      expect(gb.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(gb.spell('recieve')).toBe(false);
    expect(gb.suggest('recieve')).toContain('receive');
  });
});
describe('Korean spell-check (hunspell-asm)', () => {
  let ko: Hunspell;
  beforeAll(async () => {
    ko = await makeChecker('ko-KR');
  });

  // The affix file decomposes syllables into jamo on the way in and composes suggestions back.
  it('accepts conjugated forms and words with particles', () => {
    for (const w of ['한국어', '사랑합니다', '갔습니다', '먹었다', '학교에서', '며칠']) {
      expect(ko.spell(w), w).toBe(true);
    }
  });

  it('flags a genuine misspelling and suggests the correction', () => {
    expect(ko.spell('먹엇다')).toBe(false);
    expect(ko.suggest('먹엇다')).toContain('먹었다');
    expect(ko.suggest('됬다')).toContain('됐다');
  });
});

// A document in Arabic keeps a western language beside it: each word is checked in the
// language of its own script, and a script without a language is left alone.
describe('spell-check language by script', () => {
  it('sends Latin words to the western language and Arabic ones to the Arabic', async () => {
    const asked: [string, string][] = [];
    vi.resetModules();
    vi.doMock('../../src/lib/spell/dictionary', () => ({
      loadChecker: async (code: string) => ({ correct: (w: string) => { asked.push([code, w]); return false; }, suggest: () => [], add: () => {} }),
    }));
    const { spellController } = await import('../../src/lib/spell/controller');
    const settle = () => new Promise((r) => setTimeout(r, 0));

    await spellController.setLanguage('ar', 'en');
    spellController.check('hello'); // loads the western dictionary
    await settle();
    asked.length = 0;
    expect(spellController.check('hello')).toBe(false);
    expect(spellController.check('كتاب')).toBe(false);
    expect(asked).toEqual([['en', 'hello'], ['ar', 'كتاب']]);

    await spellController.setLanguage('ar', null);
    expect(spellController.check('hello')).toBe(true);
    await spellController.setLanguage('en', null);
    expect(spellController.check('كتاب')).toBe(true);

    // Hangul goes to the asian language wherever the document names it, else nowhere.
    expect(spellController.check('한국어')).toBe(true);
    for (const [code, alt] of [['ko-KR', null], ['en', 'ko-KR']] as const) {
      await spellController.setLanguage(code, alt);
      spellController.check('한국어');
      spellController.check('hello');
      await settle();
      asked.length = 0;
      expect(spellController.check('한국어')).toBe(false);
      spellController.check('hello');
      expect(asked).toEqual(alt ? [['ko-KR', '한국어'], ['en', 'hello']] : [['ko-KR', '한국어']]);
    }
    vi.doUnmock('../../src/lib/spell/dictionary');
  });
});
