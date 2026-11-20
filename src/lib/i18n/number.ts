import { locale } from './i18n.svelte';
import { localeTag } from '../utils/dateTime';

// A measurement as a field shows it: up to `digits` decimals with the UI language's
// separator, no grouping, Latin digits (the Arabic UI's tag asks for them).
export function formatDecimal(v: number, digits = 2, ui: string = locale()): string {
  return new Intl.NumberFormat(localeTag(ui), { maximumFractionDigits: digits, useGrouping: false }).format(v);
}

// A typed measurement, with either separator (or the Arabic one) whatever the UI language.
export function parseDecimal(raw: string): number {
  return parseFloat(raw.trim().replace(/[,٫]/, '.'));
}
