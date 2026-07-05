// Localizes a canonical English import message (warning or thrown error) at display
// time. The parsers stay locale-agnostic and unit-testable — they emit the English
// text, and the UI maps it to the current locale here. Unknown text passes through.

import en from './locales/en';
import { t } from './i18n.svelte';

// The dictionary warning carries a language tag, so it's matched separately.
const DICT_RE = /^Spell-check language "(.+)" has no bundled dictionary/;

export function localizeImportMessage(message: string): string {
  const dict = DICT_RE.exec(message);
  if (dict) return t().importWarn.noDictionary(dict[1]);

  for (const [key, value] of Object.entries(en.importWarn)) {
    if (typeof value === 'string' && value === message) {
      return (t().importWarn as unknown as Record<string, string>)[key];
    }
  }
  for (const [key, value] of Object.entries(en.importError)) {
    if (value === message) return (t().importError as Record<string, string>)[key];
  }
  return message;
}
