// Framework-free date/time field support: a catalog of formats built from field
// tokens, with renderers for the three consumers (on-screen display, ODF
// <number:date/time-style>, DOCX field picture) all derived from one token list.

export type FieldKind = 'date' | 'time';

// One piece of a format: a literal string, or a field with a rendering variant.
export type Token =
  | { t: 'lit'; s: string }
  | { t: 'year'; long: boolean }
  | { t: 'month'; style: 'num' | 'num2' | 'longText' | 'shortText' }
  | { t: 'day'; pad: boolean }
  | { t: 'weekday'; long: boolean }
  | { t: 'hour24'; pad: boolean }
  | { t: 'hour12'; pad: boolean }
  | { t: 'minute' }
  | { t: 'second' }
  | { t: 'ampm' };

export interface DtFormat {
  /** Stable key stored on the node and round-tripped. */
  key: string;
  /** ODF element / DOCX field this format serializes to. */
  kind: FieldKind;
  tokens: Token[];
}

// Format catalog. Samples in the picker render the current time, so the exact
// ordering/separators are visible when choosing.
export const DATE_FORMATS: DtFormat[] = [
  { key: 'iso', kind: 'date', tokens: [
    { t: 'year', long: true }, { t: 'lit', s: '-' }, { t: 'month', style: 'num2' }, { t: 'lit', s: '-' }, { t: 'day', pad: true } ] },
  { key: 'dmy_dots', kind: 'date', tokens: [
    { t: 'day', pad: true }, { t: 'lit', s: '.' }, { t: 'month', style: 'num2' }, { t: 'lit', s: '.' }, { t: 'year', long: true } ] },
  { key: 'mdy_slash', kind: 'date', tokens: [
    { t: 'month', style: 'num' }, { t: 'lit', s: '/' }, { t: 'day', pad: false }, { t: 'lit', s: '/' }, { t: 'year', long: true } ] },
  { key: 'dmy_long', kind: 'date', tokens: [
    { t: 'day', pad: false }, { t: 'lit', s: '. ' }, { t: 'month', style: 'longText' }, { t: 'lit', s: ' ' }, { t: 'year', long: true } ] },
  { key: 'mdy_long', kind: 'date', tokens: [
    { t: 'month', style: 'longText' }, { t: 'lit', s: ' ' }, { t: 'day', pad: false }, { t: 'lit', s: ', ' }, { t: 'year', long: true } ] },
  { key: 'weekday_dmy', kind: 'date', tokens: [
    { t: 'weekday', long: true }, { t: 'lit', s: ', ' }, { t: 'day', pad: false }, { t: 'lit', s: '. ' }, { t: 'month', style: 'longText' }, { t: 'lit', s: ' ' }, { t: 'year', long: true } ] },
  { key: 'weekday_mdy', kind: 'date', tokens: [
    { t: 'weekday', long: true }, { t: 'lit', s: ', ' }, { t: 'month', style: 'longText' }, { t: 'lit', s: ' ' }, { t: 'day', pad: false }, { t: 'lit', s: ', ' }, { t: 'year', long: true } ] },
];

export const TIME_FORMATS: DtFormat[] = [
  { key: 'hm24', kind: 'time', tokens: [
    { t: 'hour24', pad: true }, { t: 'lit', s: ':' }, { t: 'minute' } ] },
  { key: 'hms24', kind: 'time', tokens: [
    { t: 'hour24', pad: true }, { t: 'lit', s: ':' }, { t: 'minute' }, { t: 'lit', s: ':' }, { t: 'second' } ] },
  { key: 'hm12', kind: 'time', tokens: [
    { t: 'hour12', pad: false }, { t: 'lit', s: ':' }, { t: 'minute' }, { t: 'lit', s: ' ' }, { t: 'ampm' } ] },
  { key: 'hms12', kind: 'time', tokens: [
    { t: 'hour12', pad: false }, { t: 'lit', s: ':' }, { t: 'minute' }, { t: 'lit', s: ':' }, { t: 'second' }, { t: 'lit', s: ' ' }, { t: 'ampm' } ] },
];

const BY_KEY = new Map<string, DtFormat>([...DATE_FORMATS, ...TIME_FORMATS].map(f => [f.key, f]));

// A format the catalog does not list is stored (and round-tripped) as its own DOCX
// picture — the one notation all three consumers are derived from, so a file's
// "MMMM d" stays a live field instead of freezing into text.
export function findFormat(key: string): DtFormat | null {
  const known = BY_KEY.get(key);
  if (known) return known;
  const tokens = parsePicture(key);
  return tokens ? { key, kind: pictureKind(tokens), tokens } : null;
}

const PICTURE_TOKENS: Record<string, Token> = {
  yyyy: { t: 'year', long: true }, yy: { t: 'year', long: false },
  MMMM: { t: 'month', style: 'longText' }, MMM: { t: 'month', style: 'shortText' },
  MM: { t: 'month', style: 'num2' }, M: { t: 'month', style: 'num' },
  dddd: { t: 'weekday', long: true }, ddd: { t: 'weekday', long: false },
  dd: { t: 'day', pad: true }, d: { t: 'day', pad: false },
  HH: { t: 'hour24', pad: true }, H: { t: 'hour24', pad: false },
  hh: { t: 'hour12', pad: true }, h: { t: 'hour12', pad: false },
  mm: { t: 'minute' }, m: { t: 'minute' }, ss: { t: 'second' }, s: { t: 'second' },
  'AM/PM': { t: 'ampm' }, 'am/pm': { t: 'ampm' }, 'A/P': { t: 'ampm' },
};

const PICTURE_RE = /yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|AM\/PM|am\/pm|A\/P|'[^']*'/g;

// A Word field picture ('dd.MM.yyyy', 'MMMM d') → tokens; null when it names no field
// at all. Quoted runs are literals, as they are in the field itself.
export function parsePicture(pic: string): Token[] | null {
  const out: Token[] = [];
  let lit = '';
  let last = 0;
  PICTURE_RE.lastIndex = 0;
  for (let m = PICTURE_RE.exec(pic); m; m = PICTURE_RE.exec(pic)) {
    lit += pic.slice(last, m.index);
    last = m.index + m[0].length;
    const tok = PICTURE_TOKENS[m[0]];
    if (!tok) { lit += m[0].slice(1, -1); continue; }
    if (lit) { out.push({ t: 'lit', s: lit }); lit = ''; }
    out.push({ ...tok });
  }
  lit += pic.slice(last);
  if (lit) out.push({ t: 'lit', s: lit });
  return out.some((t) => t.t !== 'lit') ? out : null;
}

const TIME_TOKENS = ['hour24', 'hour12', 'minute', 'second', 'ampm'];

// What a token list is: a clock without a calendar in it is a time, everything else
// (a date, or a date carrying a time) a date — the element each format serializes to.
export function pictureKind(tokens: Token[]): FieldKind {
  return tokens.some((t) => TIME_TOKENS.includes(t.t)) && !tokens.some((t) => ['year', 'month', 'day', 'weekday'].includes(t.t))
    ? 'time' : 'date';
}

export const DEFAULT_DATE_FORMAT = 'dmy_dots';
export const DEFAULT_TIME_FORMAT = 'hm24';

// Match a parsed token sequence back to a catalog format key (for import). Returns
// null when no format renders exactly these tokens — the caller then keeps the value
// as plain text rather than a field.
export function matchFormat(tokens: Token[], kind: FieldKind): string | null {
  const cands = kind === 'time' ? TIME_FORMATS : DATE_FORMATS;
  const key = JSON.stringify(tokens);
  for (const f of cands) if (JSON.stringify(f.tokens) === key) return f.key;
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// --- display -----------------------------------------------------------------

// Render the tokens for the given moment, using Intl for locale month/weekday names.
export function renderFormat(fmt: DtFormat, d: Date, locale: string): string {
  const monthName = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts).format(d);
  let out = '';
  for (const tok of fmt.tokens) {
    switch (tok.t) {
      case 'lit': out += tok.s; break;
      case 'year': out += tok.long ? String(d.getFullYear()) : pad2(d.getFullYear() % 100); break;
      case 'month':
        if (tok.style === 'num') out += String(d.getMonth() + 1);
        else if (tok.style === 'num2') out += pad2(d.getMonth() + 1);
        else out += monthName({ month: tok.style === 'longText' ? 'long' : 'short' });
        break;
      case 'day': out += tok.pad ? pad2(d.getDate()) : String(d.getDate()); break;
      case 'weekday': out += monthName({ weekday: tok.long ? 'long' : 'short' }); break;
      case 'hour24': out += tok.pad ? pad2(d.getHours()) : String(d.getHours()); break;
      case 'hour12': { const h = ((d.getHours() + 11) % 12) + 1; out += tok.pad ? pad2(h) : String(h); break; }
      case 'minute': out += pad2(d.getMinutes()); break;
      case 'second': out += pad2(d.getSeconds()); break;
      case 'ampm': out += d.getHours() < 12 ? 'AM' : 'PM'; break;
    }
  }
  return out;
}

// --- ODF values --------------------------------------------------------------

// text:date-value = ISO local datetime (no offset); text:time-value = ISO 8601 duration.
export function toDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// --- ODF number style --------------------------------------------------------

function escNumberText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// One <number:date-style>/<number:time-style> body from the tokens; the caller wraps
// it with the style name and language. Times/months render per the style's language.
export function odfNumberStyle(fmt: DtFormat, styleName: string, lang: { language: string; country: string } | null): string {
  const parts: string[] = [];
  for (const tok of fmt.tokens) {
    switch (tok.t) {
      case 'lit': parts.push(`<number:text>${escNumberText(tok.s)}</number:text>`); break;
      case 'year': parts.push(`<number:year number:style="${tok.long ? 'long' : 'short'}"/>`); break;
      case 'month':
        if (tok.style === 'num') parts.push('<number:month number:style="short"/>');
        else if (tok.style === 'num2') parts.push('<number:month number:style="long"/>');
        else parts.push(`<number:month number:style="${tok.style === 'longText' ? 'long' : 'short'}" number:textual="true"/>`);
        break;
      case 'day': parts.push(`<number:day number:style="${tok.pad ? 'long' : 'short'}"/>`); break;
      case 'weekday': parts.push(`<number:day-of-week number:style="${tok.long ? 'long' : 'short'}"/>`); break;
      case 'hour24': case 'hour12': parts.push(`<number:hours number:style="${tok.pad ? 'long' : 'short'}"/>`); break;
      case 'minute': parts.push('<number:minutes number:style="long"/>'); break;
      case 'second': parts.push('<number:seconds number:style="long"/>'); break;
      case 'ampm': parts.push('<number:am-pm/>'); break;
    }
  }
  const el = fmt.kind === 'date' ? 'number:date-style' : 'number:time-style';
  const langAttr = lang ? ` number:language="${lang.language}" number:country="${lang.country}"` : '';
  return `<${el} style:name="${styleName}"${langAttr}>${parts.join('')}</${el}>`;
}

// --- DOCX field picture ------------------------------------------------------

// Word field switch picture (e.g. `dd.MM.yyyy`). Month = M/MM/MMM/MMMM, minute = mm.
export function docxPicture(fmt: DtFormat): string {
  let out = '';
  for (const tok of fmt.tokens) {
    switch (tok.t) {
      case 'lit': out += tok.s; break;
      case 'year': out += tok.long ? 'yyyy' : 'yy'; break;
      case 'month':
        out += tok.style === 'num' ? 'M' : tok.style === 'num2' ? 'MM' : tok.style === 'longText' ? 'MMMM' : 'MMM';
        break;
      case 'day': out += tok.pad ? 'dd' : 'd'; break;
      case 'weekday': out += tok.long ? 'dddd' : 'ddd'; break;
      case 'hour24': out += tok.pad ? 'HH' : 'H'; break;
      case 'hour12': out += tok.pad ? 'hh' : 'h'; break;
      case 'minute': out += 'mm'; break;
      case 'second': out += 'ss'; break;
      case 'ampm': out += 'AM/PM'; break;
    }
  }
  return out;
}

const LOCALE_TAG: Record<string, string> = { en: 'en-US', de: 'de-DE' };

// Map a UI locale ('en'/'de') to a BCP-47 tag for Intl.
export function localeTag(locale: string): string {
  return LOCALE_TAG[locale] ?? locale;
}
