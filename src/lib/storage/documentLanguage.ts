// The document's language: a main one, persisted to localStorage and round-tripped
// through the default paragraph style, plus the other slot's tag (western or asian).
// 'none' disables checking.

import { resolveBrowserLocale } from '../i18n/config';
import { docKey, docStore } from './docScope';

export const NO_LANGUAGE = 'none';

export type DocumentLanguage = string;

export interface LanguageDef {
  code: string;
  label: string;
  // Dictionary assets live at public/dictionaries/<code>/<code>.{aff,dic}.
  odf: { language: string; country: string };
  // harper.js, the grammar engine, only knows English.
  grammar?: true;
  // A language the document can be in without a bundled dictionary: the picker offers
  // it so the file names its language, spell-checking simply stays off.
  noDict?: true;
}

// The languages a document can be in. Most carry a bundled Hunspell dictionary — add one
// by dropping a folder in public/dictionaries/<code>/ and appending an entry here; a
// `noDict` entry names its language for the file without checking it. A code has to be a valid
// BCP-47 tag: it reaches Intl as the number locale, which throws on anything else.
export const LANGUAGES: LanguageDef[] = [
  { code: 'en', label: 'English (US)', odf: { language: 'en', country: 'US' }, grammar: true },
  { code: 'en-GB', label: 'English (UK)', odf: { language: 'en', country: 'GB' }, grammar: true },
  { code: 'de', label: 'Deutsch', odf: { language: 'de', country: 'DE' } },
  { code: 'es', label: 'Español (España)', odf: { language: 'es', country: 'ES' } },
  { code: 'fr', label: 'Français', odf: { language: 'fr', country: 'FR' } },
  { code: 'it', label: 'Italiano', odf: { language: 'it', country: 'IT' } },
  { code: 'pt', label: 'Português (Portugal)', odf: { language: 'pt', country: 'PT' } },
  { code: 'el', label: 'Ελληνικά', odf: { language: 'el', country: 'GR' } },
  { code: 'ru', label: 'Русский', odf: { language: 'ru', country: 'RU' } },
  { code: 'uk', label: 'Українська', odf: { language: 'uk', country: 'UA' } },
  { code: 'ja-JP', label: '日本語', odf: { language: 'ja', country: 'JP' }, noDict: true },
  { code: 'zh-CN', label: '中文（简体）', odf: { language: 'zh', country: 'CN' }, noDict: true },
  { code: 'zh-TW', label: '中文（繁體）', odf: { language: 'zh', country: 'TW' }, noDict: true },
];

const KEY = docKey('edentext-doc-language');
const OTHER_KEY = docKey('edentext-doc-language-other');

export function findLanguage(code: DocumentLanguage): LanguageDef | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export function hasGrammar(code: DocumentLanguage): boolean {
  return findLanguage(code)?.grammar === true;
}

// True where the language is known but has no bundled dictionary, so nothing is fetched
// and no importer warns about a dictionary it was never going to find.
export function hasDictionary(code: DocumentLanguage): boolean {
  const def = findLanguage(code);
  return !!def && def.noDict !== true;
}

// East Asian text: both formats keep its language in their own asian slot, and both word
// processors read it only from there. The complex slot (Hebrew, Arabic) is separate.
export function isAsianTag(tag: string): boolean {
  return /^(zh|ja|ko)\b/i.test(tag.trim());
}

export function isCyrillicTag(tag: string): boolean {
  return /^(ru|uk|be|bg|sr|mk)\b/i.test(tag.trim());
}

// The scripts whose list numbering the menus offer: the UI's and the document's.
export function numberingScripts(main: DocumentLanguage, other: string | null, uiLocale: string): { cjk: boolean; cyrillic: boolean } {
  const tags = [tagForLanguage(main) ?? '', other ?? '', uiLocale];
  return { cjk: tags.some(isAsianTag), cyrillic: tags.some(isCyrillicTag) };
}

// A tag's slot: a paragraph or a run carries a western and an asian language, and a tag
// in the wrong one (an older document's asian `lang`) counts for its own script.
export const westLang = (tag: unknown): string | null =>
  typeof tag === 'string' && tag && !isAsianTag(tag) ? tag : null;
export const asianLang = (tag: unknown): string | null =>
  typeof tag === 'string' && tag && isAsianTag(tag) ? tag : null;

// The document's western and asian language: its main one and the other slot's tag.
export function documentLangs(main: DocumentLanguage, other: string | null): { west: string | null; asian: string | null } {
  const tags = [tagForLanguage(main), other];
  return { west: tags.map(westLang).find(Boolean) ?? null, asian: tags.map(asianLang).find(Boolean) ?? null };
}

// The dictionary for text outside East Asian script: an East Asian document checks it
// in its western language, where it has one.
export function westernCode(main: DocumentLanguage, other: string | null): DocumentLanguage {
  const tag = tagForLanguage(main);
  if (!tag || !isAsianTag(tag)) return main;
  const west = westLang(other);
  return (west && codeForTag(west)) || main;
}

// A file's main language from its two defaults. Both word processors write an asian
// default into every file whatever it is written in, so that one leads only where the
// text is mostly East Asian, or where there is no western one.
export function mainOfPair(west: string | null, asian: string | null, asianText: boolean): { main: string | null; other: string | null } {
  return asian && (asianText || !west) ? { main: asian, other: west } : { main: west, other: asian };
}

// "For all text": the pick becomes the main language, and a main language of the other
// script moves to the other slot, so the text in that script keeps its language. No
// language clears both slots, as LibreOffice's "None" does.
export function pickDocumentLanguage(main: DocumentLanguage, other: string | null, code: DocumentLanguage): { main: DocumentLanguage; other: string | null } {
  if (code === NO_LANGUAGE) return { main: code, other: null };
  const was = tagForLanguage(main);
  const next = tagForLanguage(code);
  return { main: code, other: was && next && isAsianTag(was) !== isAsianTag(next) ? was : other };
}

// The Han font an East Asian document defaults to, by region; null for any other language.
const CJK_DOC_FONT: Record<string, string> = { TW: 'PMingLiU', HK: 'PMingLiU', MO: 'PMingLiU', JP: 'Yu Mincho' };
export function cjkDocFont(tag: string): string | null {
  if (!isAsianTag(tag)) return null;
  return CJK_DOC_FONT[odfFromTag(tag)?.country ?? ''] ?? 'SimSun';
}

function isValid(code: string): boolean {
  return code === NO_LANGUAGE || !!findLanguage(code);
}

export function loadDocumentLanguage(): DocumentLanguage {
  const code = docStore.getItem(KEY);
  return code && isValid(code) ? code : defaultDocumentLanguage();
}

// A new document's language follows the browser's, by full tag first so en-GB picks the
// British dictionary rather than the US one; resolveBrowserLocale covers the rest. A tag
// no entry claims leaves checking off rather than guessing.
export function defaultDocumentLanguage(): DocumentLanguage {
  const fromTag = codeForTag(navigator.language ?? '');
  if (fromTag) return fromTag;
  const ui = resolveBrowserLocale();
  return isValid(ui) ? ui : NO_LANGUAGE;
}

export function saveDocumentLanguage(code: DocumentLanguage): void {
  docStore.setItem(KEY, code);
}

export function loadDocumentLanguageOther(): string | null {
  const tag = docStore.getItem(OTHER_KEY);
  return tag && odfFromTag(tag) ? tag : null;
}

export function saveDocumentLanguageOther(tag: string | null): void {
  if (tag) docStore.setItem(OTHER_KEY, tag);
  else docStore.removeItem(OTHER_KEY);
}

// → ODF fo:language/fo:country for export; null when checking is off.
export function odfFromLanguage(code: DocumentLanguage): { language: string; country: string } | null {
  return findLanguage(code)?.odf ?? null;
}

// The document's language as the exporters take it: the main one split for ODF, plus
// the other slot's tag.
export type ExportLanguage = { language: string; country: string; other?: string | null };

// A full language tag ('en-US', 'fr-FR') ↔ ODF's split fo:language/fo:country. The tag is
// what a paragraph and a run carry, so a document in a language we have no dictionary for
// still saves the one it came with.
export function odfFromTag(tag: string): { language: string; country: string } | null {
  const m = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z]{2}|\d{3}))?$/.exec(tag.trim());
  return m ? { language: m[1].toLowerCase(), country: (m[2] ?? '').toUpperCase() } : null;
}

export function tagFromOdf(language: string, country?: string): string {
  const lang = language.toLowerCase();
  return country ? `${lang}-${country.toUpperCase()}` : lang;
}

// The dictionary code a language tag maps onto, null where we have no dictionary for it.
export function codeForTag(tag: string): DocumentLanguage | null {
  const odf = odfFromTag(tag);
  return odf ? languageFromOdf(odf.language, odf.country) : null;
}

// The tag a dictionary code stands for, for the language picker's own entries.
export function tagForLanguage(code: DocumentLanguage): string | null {
  const odf = odfFromLanguage(code);
  return odf ? tagFromOdf(odf.language, odf.country) : null;
}

// ODF fo:language(/country) → a known code, else null (caller maps to 'none').
// Matches on language first, preferring an exact country match when present.
export function languageFromOdf(language: string, country?: string): DocumentLanguage | null {
  const lang = language.toLowerCase();
  const ctry = country?.toUpperCase();
  const byLang = LANGUAGES.filter((l) => l.odf.language.toLowerCase() === lang);
  if (!byLang.length) return null;
  if (ctry) {
    const exact = byLang.find((l) => l.odf.country.toUpperCase() === ctry);
    if (exact) return exact.code;
  }
  return byLang[0].code;
}
