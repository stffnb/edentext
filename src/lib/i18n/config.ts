// UI locale configuration. Plain module (no runes), safe to import anywhere —
// keeps appLanguage.ts and i18n.svelte.ts free of circular runes imports.

export const LOCALES = ['en', 'de', 'es', 'fr', 'it', 'pt', 'el', 'ru', 'uk', 'ja', 'zh-Hans', 'zh-Hant'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español (España)',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português (Portugal)',
  el: 'Ελληνικά',
  ru: 'Русский',
  uk: 'Українська',
  ja: '日本語',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

export function isLocale(value: string | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

// Chinese is the one locale split by script rather than by language: the browser reports
// a region ('zh-CN', 'zh-TW', 'zh-Hant-HK'), and Hong Kong and Macau write traditional.
const ZH_TRADITIONAL = /^zh-(hant|tw|hk|mo)\b/;

// navigator.language ('de-AT', 'en-GB', 'zh-TW', …) → a supported locale, default 'en'.
export function resolveBrowserLocale(): Locale {
  const tag = (navigator.language || 'en').toLowerCase();
  if (tag === 'zh' || tag.startsWith('zh-')) return ZH_TRADITIONAL.test(tag) ? 'zh-Hant' : 'zh-Hans';
  const base = tag.slice(0, 2);
  return isLocale(base) ? base : 'en';
}
