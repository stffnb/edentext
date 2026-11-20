import { describe, expect, it } from 'vitest';
import {
  codeForTag,
  findLanguage,
  hasDictionary,
  hasThesaurus,
  isAsianTag,
  LANGUAGES,
  languageFromOdf,
  odfFromLanguage,
  tagForLanguage,
} from '../../src/lib/storage/documentLanguage';

describe('French document language', () => {
  it('maps the dictionary code to the fr-FR document locale', () => {
    expect(findLanguage('fr')).toMatchObject({ code: 'fr', odf: { language: 'fr', country: 'FR' } });
    expect(odfFromLanguage('fr')).toEqual({ language: 'fr', country: 'FR' });
    expect(tagForLanguage('fr')).toBe('fr-FR');
  });

  it('maps French locale forms back to the dictionary code', () => {
    expect(codeForTag('fr-FR')).toBe('fr');
    expect(codeForTag('fr-CA')).toBe('fr');
    expect(languageFromOdf('fr', 'FR')).toBe('fr');
  });
});

describe('Portuguese document language', () => {
  it('maps the dictionary code to the pt-PT document locale', () => {
    expect(findLanguage('pt')).toMatchObject({ code: 'pt', odf: { language: 'pt', country: 'PT' } });
    expect(odfFromLanguage('pt')).toEqual({ language: 'pt', country: 'PT' });
    expect(tagForLanguage('pt')).toBe('pt-PT');
  });

  it('maps Portuguese locale forms back to the dictionary code', () => {
    expect(codeForTag('pt-PT')).toBe('pt');
    expect(codeForTag('pt-BR')).toBe('pt');
    expect(languageFromOdf('pt', 'PT')).toBe('pt');
  });
});

describe('British document language', () => {
  it('keeps the British dictionary apart from the US one by country', () => {
    expect(codeForTag('en-GB')).toBe('en-GB');
    expect(codeForTag('en-US')).toBe('en');
    expect(languageFromOdf('en', 'GB')).toBe('en-GB');
    expect(tagForLanguage('en-GB')).toBe('en-GB');
  });

  // Every code reaches Intl as the table number locale, which throws on a non-tag.
  it('gives every language a code Intl accepts', () => {
    for (const l of LANGUAGES) expect(() => new Intl.NumberFormat(l.code), l.code).not.toThrow();
  });
});

describe('Chinese document language', () => {
  // A document can be in Chinese without us shipping a dictionary for it: the file then
  // names its language instead of falling back to "no language", which reads as English.
  it('is a document language without a dictionary', () => {
    expect(findLanguage('zh-CN')?.label).toBe('中文（简体）');
    expect(hasDictionary('zh-CN')).toBe(false);
    expect(hasDictionary('de')).toBe(true);
  });

  it('tells the two scripts apart by country', () => {
    expect(codeForTag('zh-TW')).toBe('zh-TW');
    expect(languageFromOdf('zh', 'TW')).toBe('zh-TW');
    expect(languageFromOdf('zh', 'CN')).toBe('zh-CN');
    expect(tagForLanguage('zh-CN')).toBe('zh-CN');
  });

  // A tag with no entry of its own still lands on Chinese rather than on nothing.
  it('reads an unlisted Chinese region as Simplified', () => {
    expect(codeForTag('zh-HK')).toBe('zh-CN');
  });

  it('names Japanese without a dictionary, Korean with one and no thesaurus', () => {
    for (const [code, lang, country] of [['ja-JP', 'ja', 'JP'], ['ko-KR', 'ko', 'KR']]) {
      expect(hasDictionary(code)).toBe(code === 'ko-KR');
      expect(hasThesaurus(code)).toBe(false);
      expect(codeForTag(lang)).toBe(code);
      expect(languageFromOdf(lang, country)).toBe(code);
    }
    expect(hasThesaurus('de')).toBe(true);
  });

  it('counts the East Asian languages as asian, and only those', () => {
    expect(isAsianTag('zh-CN')).toBe(true);
    expect(isAsianTag('ja')).toBe(true);
    expect(isAsianTag('ko-KR')).toBe(true);
    expect(isAsianTag('de-DE')).toBe(false);
    expect(isAsianTag('he-IL')).toBe(false);
  });
});
