// Reactive i18n core. `current` is a $state rune; any component reading t() in a
// template or $derived re-renders when setLocale() reassigns it — no store bridge.

import en, { type Messages } from './locales/en';
import de from './locales/de';
import es from './locales/es';
import fr from './locales/fr';
import it from './locales/it';
import pt from './locales/pt';
import el from './locales/el';
import ru from './locales/ru';
import uk from './locales/uk';
import ja from './locales/ja';
import zhHans from './locales/zh-Hans';
import zhHant from './locales/zh-Hant';
import { loadAppLanguage, saveAppLanguage } from '../storage/appLanguage';
import type { Locale } from './config';

const catalogs: Record<Locale, Messages> = { en, de, es, fr, it, pt, el, ru, uk, ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant };

let current = $state<Locale>(loadAppLanguage());

// The active catalog. Reading this tracks `current`, so callers stay reactive.
export function t(): Messages {
  return catalogs[current];
}

// A built-in style's translated name; any other style shows its own.
export function styleLabel(name: string): string {
  return t().styleNames[name] ?? t().table.styleNames[name] ?? name;
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
