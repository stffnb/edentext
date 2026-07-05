// UI locale configuration. Plain module (no runes), safe to import anywhere —
// keeps appLanguage.ts and i18n.svelte.ts free of circular runes imports.

export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
};

export function isLocale(value: string | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

// navigator.language ('de-AT', 'en-GB', …) → a supported base locale, default 'en'.
export function resolveBrowserLocale(): Locale {
  const base = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return isLocale(base) ? base : 'en';
}
