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
  // The two pictures East Asian documents write a date in.
  { key: 'ymd_cjk', kind: 'date', tokens: [
    { t: 'year', long: true }, { t: 'lit', s: '年' }, { t: 'month', style: 'num' }, { t: 'lit', s: '月' }, { t: 'day', pad: false }, { t: 'lit', s: '日' } ] },
  { key: 'ymd_slash', kind: 'date', tokens: [
    { t: 'year', long: true }, { t: 'lit', s: '/' }, { t: 'month', style: 'num2' }, { t: 'lit', s: '/' }, { t: 'day', pad: true } ] },
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

// The format a field falls back to when it names none — a stored value's own picture,
// so it stays put whatever the UI language is.
export const DEFAULT_DATE_FORMAT = 'dmy_dots';
export const DEFAULT_TIME_FORMAT = 'hm24';

// The picture a *newly inserted* date field takes, by UI locale: a date is written
// differently in each place, else the locale's own numeric form. Only the preselection.
const DATE_FORMAT_BY_LOCALE: Record<string, string> = {
  'zh-Hans': 'ymd_cjk', 'zh-Hant': 'ymd_cjk', ja: 'ymd_cjk', en: 'mdy_slash',
};

export function defaultDateFormat(locale: string): string {
  return DATE_FORMAT_BY_LOCALE[locale] ?? dateFormatsFor(locale)[0]?.key ?? DEFAULT_DATE_FORMAT;
}

// A UI language's own way of writing a date as tokens, read off Intl for a day and month
// of one digit (so the padding shows); null where Intl writes a part no token has.
function intlTokens(tag: string, opts: Intl.DateTimeFormatOptions): Token[] | null {
  const out: Token[] = [];
  for (const p of new Intl.DateTimeFormat(tag, opts).formatToParts(new Date(2026, 0, 5))) {
    if (p.type === 'literal') {
      // Bidi marks around the numbers are Intl's rendering, not the picture's.
      const lit = p.value.replace(/[\u200E\u200F\u061C]/g, '');
      if (lit) out.push({ t: 'lit', s: lit });
    } else if (p.type === 'year') out.push({ t: 'year', long: p.value.length > 2 });
    else if (p.type === 'day') out.push({ t: 'day', pad: p.value.length > 1 });
    else if (p.type === 'weekday') out.push({ t: 'weekday', long: true });
    else if (p.type === 'month') out.push({ t: 'month', style: !/^\d+$/.test(p.value) ? 'longText' : p.value.length > 1 ? 'num2' : 'num' });
    else return null;
  }
  return out;
}

// The date formats the picker offers in a UI language: its own numeric, long and full
// form (Intl's, a catalog key where one matches), then the catalog's purely numeric ones.
// A catalog form with a month or weekday name is one language's order and is not offered
// elsewhere: "20. نوفمبر 2026" is German order in Arabic words.
export function dateFormatsFor(locale: string): DtFormat[] {
  const tag = localeTag(locale);
  const own = [
    { day: 'numeric', month: 'numeric', year: 'numeric' },
    { day: 'numeric', month: 'long', year: 'numeric' },
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  ].flatMap((o) => {
    const tokens = intlTokens(tag, o as Intl.DateTimeFormatOptions);
    if (!tokens) return [];
    // A catalog format differing only in padding stands for it (dd.MM.yyyy for d.M.yyyy).
    const loose = (ts: Token[]) => JSON.stringify(ts.map((t) => (t.t === 'day' ? { t: 'day' } : t.t === 'month' && t.style.startsWith('num') ? { t: 'month' } : t)));
    const near = DATE_FORMATS.find((f) => loose(f.tokens) === loose(tokens));
    return [near ?? { key: docxPicture({ key: '', kind: 'date', tokens }), kind: 'date' as const, tokens }];
  });
  const numeric = DATE_FORMATS.filter((f) => f.tokens.every((t) => t.t !== 'weekday' && (t.t !== 'month' || t.style.startsWith('num')) && (t.t !== 'lit' || /^[\s./-]*$/.test(t.s))));
  const seen = new Set<string>();
  return [...own, ...numeric].filter((f) => !seen.has(f.key) && !!seen.add(f.key));
}

// The time formats the picker offers in a UI language: where its clock leads with the
// day-period marker (오전 1:40, 下午1:40, as LibreOffice's ko-KR formats do), the 12-hour
// forms put the marker first, with the language's own gap; the catalog's otherwise.
export function timeFormatsFor(locale: string): DtFormat[] {
  const parts = new Intl.DateTimeFormat(localeTag(locale), { hour: 'numeric', minute: '2-digit', hour12: true })
    .formatToParts(new Date(2026, 0, 5, 1, 40));
  const at = parts.findIndex((p) => p.type === 'dayPeriod');
  const hour = parts.findIndex((p) => p.type === 'hour');
  if (at < 0 || at > hour) return TIME_FORMATS;
  const gap = parts.slice(at + 1, hour).map((p) => p.value).join('');
  return TIME_FORMATS.map((f) => {
    if (f.tokens[f.tokens.length - 1].t !== 'ampm') return f;
    const tokens: Token[] = [{ t: 'ampm' }, ...(gap ? [{ t: 'lit' as const, s: gap }] : []), ...f.tokens.slice(0, -2)];
    return { key: docxPicture({ key: '', kind: 'time', tokens }), kind: 'time' as const, tokens };
  });
}

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
  const intl = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts).format(d);
  // The month beside a day number, so a Slavic locale yields the genitive it prints
  // a date in ("15 марта", not the stand-alone "март"); unchanged for en/de/es.
  const monthName = (style: 'long' | 'short') =>
    new Intl.DateTimeFormat(locale, { month: style, day: 'numeric' })
      .formatToParts(d).find((p) => p.type === 'month')!.value;
  let out = '';
  for (const tok of fmt.tokens) {
    switch (tok.t) {
      case 'lit': out += tok.s; break;
      case 'year': out += tok.long ? String(d.getFullYear()) : pad2(d.getFullYear() % 100); break;
      case 'month':
        if (tok.style === 'num') out += String(d.getMonth() + 1);
        else if (tok.style === 'num2') out += pad2(d.getMonth() + 1);
        else out += monthName(tok.style === 'longText' ? 'long' : 'short');
        break;
      case 'day': out += tok.pad ? pad2(d.getDate()) : String(d.getDate()); break;
      case 'weekday': out += intl({ weekday: tok.long ? 'long' : 'short' }); break;
      case 'hour24': out += tok.pad ? pad2(d.getHours()) : String(d.getHours()); break;
      case 'hour12': { const h = ((d.getHours() + 11) % 12) + 1; out += tok.pad ? pad2(h) : String(h); break; }
      case 'minute': out += pad2(d.getMinutes()); break;
      case 'second': out += pad2(d.getSeconds()); break;
      case 'ampm': out += dayPeriod(d, locale); break;
    }
  }
  return out;
}

// The locale's own morning/afternoon marker (오전, ص, a. m.), as both word processors
// render an AM/PM field; the file keeps the standard token.
function dayPeriod(d: Date, locale: string): string {
  const part = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true }).formatToParts(d).find((p) => p.type === 'dayPeriod');
  return part?.value ?? (d.getHours() < 12 ? 'AM' : 'PM');
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
      // Latin letters in a literal would read as fields, so they are quoted, as Word does.
      case 'lit': out += /[A-Za-z]/.test(tok.s) ? `'${tok.s}'` : tok.s; break;
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

const LOCALE_TAG: Record<string, string> = {
  en: 'en-US', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT', el: 'el-GR', ru: 'ru-RU', uk: 'uk-UA',
  pl: 'pl-PL', id: 'id-ID', ar: 'ar-EG-u-nu-latn', 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW', ja: 'ja-JP', ko: 'ko-KR',
};

// Map a UI locale to a BCP-47 tag for Intl.
export function localeTag(locale: string): string {
  return LOCALE_TAG[locale] ?? locale;
}
