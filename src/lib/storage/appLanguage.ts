// The UI language, persisted to localStorage. Distinct from the per-document
// spell-check language (documentLanguage.ts): this drives only the app chrome.

import { isLocale, resolveBrowserLocale, type Locale } from '../i18n/config';

const KEY = 'odf-editor-app-language';

export function loadAppLanguage(): Locale {
  const saved = localStorage.getItem(KEY);
  return isLocale(saved) ? saved : resolveBrowserLocale();
}

export function saveAppLanguage(locale: Locale): void {
  localStorage.setItem(KEY, locale);
}
