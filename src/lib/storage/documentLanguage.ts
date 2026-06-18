// The document's spell-check language. One value per document, persisted to
// localStorage and round-tripped through the .odt (fo:language/fo:country on
// the default paragraph style). 'none' disables checking.

export const NO_LANGUAGE = 'none';

export type DocumentLanguage = string;

export interface LanguageDef {
  code: string;
  label: string;
  // Dictionary assets live at public/dictionaries/<code>/<code>.{aff,dic}.
  odf: { language: string; country: string };
}

// Languages with a bundled Hunspell dictionary. Add one by dropping a folder in
// public/dictionaries/<code>/ and appending an entry here.
export const LANGUAGES: LanguageDef[] = [
  { code: 'en', label: 'English (US)', odf: { language: 'en', country: 'US' } },
];

export const DEFAULT_LANGUAGE: DocumentLanguage = 'en';

const KEY = 'odf-editor-doc-language';

export function findLanguage(code: DocumentLanguage): LanguageDef | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

function isValid(code: string): boolean {
  return code === NO_LANGUAGE || !!findLanguage(code);
}

export function loadDocumentLanguage(): DocumentLanguage {
  const code = localStorage.getItem(KEY);
  return code && isValid(code) ? code : DEFAULT_LANGUAGE;
}

export function saveDocumentLanguage(code: DocumentLanguage): void {
  localStorage.setItem(KEY, code);
}

// → ODF fo:language/fo:country for export; null when checking is off.
export function odfFromLanguage(code: DocumentLanguage): { language: string; country: string } | null {
  return findLanguage(code)?.odf ?? null;
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
