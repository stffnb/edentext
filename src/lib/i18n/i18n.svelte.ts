// Reactive i18n core. `current` is a $state rune; any component reading t() in a
// template or $derived re-renders when setLocale() reassigns it — no store bridge.

import en, { type Messages } from './locales/en';
import de from './locales/de';
import { loadAppLanguage, saveAppLanguage } from '../storage/appLanguage';
import type { Locale } from './config';

const catalogs: Record<Locale, Messages> = { en, de };

let current = $state<Locale>(loadAppLanguage());

// The active catalog. Reading this tracks `current`, so callers stay reactive.
export function t(): Messages {
  return catalogs[current];
}

export function locale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  current = next;
  saveAppLanguage(next);
  // <html lang> = UI locale (chrome a11y); document content language is separate.
  document.documentElement.lang = next;
}
