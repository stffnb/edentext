// Reactive i18n core. `current` is a $state rune; any component reading t() in a
// template or $derived re-renders when setLocale() reassigns it — no store bridge.

import en, { type Messages } from './locales/en';
import { loadAppLanguage, saveAppLanguage } from '../storage/appLanguage';
import type { Locale } from './config';

// English is the contract and the stand-in; every other catalog is a chunk of its own,
// fetched when its language is picked, so a start carries one language, not twelve.
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Messages }>> = {
  de: () => import('./locales/de'),
  es: () => import('./locales/es'),
  fr: () => import('./locales/fr'),
  it: () => import('./locales/it'),
  pt: () => import('./locales/pt'),
  el: () => import('./locales/el'),
  ru: () => import('./locales/ru'),
  uk: () => import('./locales/uk'),
  ja: () => import('./locales/ja'),
  'zh-Hans': () => import('./locales/zh-Hans'),
  'zh-Hant': () => import('./locales/zh-Hant'),
};

let catalogs = $state.raw<Partial<Record<Locale, Messages>>>({ en });
const initial = loadAppLanguage();
let current = $state<Locale>(initial);
// The language asked for last, so a slower earlier fetch does not switch back to its own.
let wanted: Locale = initial;

/** Fetches a language's catalog; where that fails (offline), English stands in. */
export async function loadCatalog(l: Locale): Promise<void> {
  if (l === 'en' || catalogs[l]) return;
  try {
    const { default: messages } = await loaders[l]();
    catalogs = { ...catalogs, [l]: messages };
  } catch { /* English stands in */ }
}

// The active catalog. Reading this tracks `current`, so callers stay reactive.
export function t(): Messages {
  return catalogs[current] ?? en;
}

// A built-in style's translated name; any other style shows its own.
export function styleLabel(name: string): string {
  return t().styleNames[name] ?? t().table.styleNames[name] ?? name;
}

export function locale(): Locale {
  return current;
}

/** Switches once the catalog is in; resolves when the language is the active one. */
export async function setLocale(next: Locale, keep = true): Promise<void> {
  wanted = next;
  if (keep) saveAppLanguage(next);
  await loadCatalog(next);
  if (wanted !== next) return;
  current = next;
  // <html lang> = UI locale (chrome a11y); document content language is separate.
  document.documentElement.lang = next;
}
