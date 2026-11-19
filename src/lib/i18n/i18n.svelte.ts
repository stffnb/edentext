// Reactive i18n core. `current` is a $state rune; any component reading t() in a
// template or $derived re-renders when setLocale() reassigns it — no store bridge.

import en, { type Messages } from './locales/en';
import { loadAppLanguage, saveAppLanguage } from '../storage/appLanguage';
import { isRtlLocale, reflectLocale, type Locale } from './config';

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
  id: () => import('./locales/id'),
  ar: () => import('./locales/ar'),
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
/** The interface runs right to left; script-placed parts mirror by it. */
export function uiRtl(): boolean {
  return isRtlLocale(current);
}

/** Where a script-placed panel starts under its anchor: the CSS side to set and the
 *  anchor's distance from that side of the window. */
export function startEdge(anchor: DOMRect): { side: 'left' | 'right'; offset: number } {
  return uiRtl() ? { side: 'right', offset: window.innerWidth - anchor.right } : { side: 'left', offset: anchor.left };
}

export async function setLocale(next: Locale, keep = true): Promise<void> {
  wanted = next;
  if (keep) saveAppLanguage(next);
  await loadCatalog(next);
  if (wanted !== next) return;
  current = next;
  // <html lang dir> = UI locale (chrome a11y); document content language is separate.
  reflectLocale(next);
}
