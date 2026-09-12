// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadModule, type Hunspell } from 'hunspell-asm';

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
