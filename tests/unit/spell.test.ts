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
  const dic = factory.mountBuffer(readFileSync(dictPath(`${code}/${code}.dic`)), `${code}.dic`);
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
