import { locale } from '../i18n/i18n.svelte';
import { localeTag } from '../utils/dateTime';

// How the app writes a moment for a reader: comment and change cards, the review print,
// kept versions and the browser's document list. `auto` is the UI language's convention;
// Settings ▸ General can pick another region's, or ISO 8601.

const KEY = 'edentext-date-format';

export const DATE_FORMATS = [
  'auto', 'de-DE', 'en-US', 'en-GB', 'fr-FR', 'es-ES', 'it-IT', 'pt-PT', 'el-GR', 'ru-RU', 'uk-UA', 'ja-JP', 'zh-CN', 'zh-TW', 'iso',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const isFormat = (v: unknown): v is DateFormat => DATE_FORMATS.includes(v as DateFormat);
const stored = localStorage.getItem(KEY);
let current = $state<DateFormat>(isFormat(stored) ? stored : 'auto');

export function dateFormat(): DateFormat { return current; }

export function setDateFormat(f: DateFormat): void {
  current = f;
  if (f === 'auto') localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, f);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date and time to the minute; a stored value that is no date comes back as it is. */
export function formatMoment(value: string | number | Date, f: DateFormat = current): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  if (f === 'iso') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Intl.DateTimeFormat(f === 'auto' ? localeTag(locale()) : f, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit',
  }).format(d);
}
