import { locale } from './i18n.svelte';
import { localeTag } from '../utils/dateTime';

// A measurement as a field shows it: up to `digits` decimals with the UI language's
// separator, no grouping, Latin digits (the Arabic UI's tag asks for them).
export function formatDecimal(v: number, digits = 2, ui: string = locale()): string {
  return new Intl.NumberFormat(localeTag(ui), { maximumFractionDigits: digits, useGrouping: false }).format(v);
}

// A typed measurement, with either separator (or the Arabic one) and Latin, Arabic-Indic
// or Persian digits, whatever the UI language.
export function parseDecimal(raw: string): number {
  const latin = raw.trim().replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) & 0xf));
  return parseFloat(latin.replace(/[,٫]/, '.'));
}
