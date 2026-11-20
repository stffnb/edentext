// A DATE/TIME field whose picture the catalog does not list: it stays a live field,
// keyed by the picture itself, and renders and re-exports the same.
import { describe, it, expect } from 'vitest';
import { formatDecimal, parseDecimal } from '../../src/lib/i18n/number';
import { unzipSync, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';
import { findFormat, renderFormat, docxPicture, defaultDateFormat, dateFormatsFor, timeFormatsFor, localeTag, DEFAULT_DATE_FORMAT } from '../../src/lib/utils/dateTime';
import { docxOf } from '../docxFixture';

const BODY = `<w:p>
<w:r><w:fldChar w:fldCharType="begin"/></w:r>
<w:r><w:instrText xml:space="preserve"> DATE  \\@ "MMMM d"  \\* MERGEFORMAT </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r>
<w:r><w:t>July 10</w:t></w:r>
<w:r><w:fldChar w:fldCharType="end"/></w:r>
</w:p>`;

const file = docxOf(BODY);

const walk = (n: any, type: string, out: any[] = []): any[] => {
  for (const c of n.content ?? []) { if (c.type === type) out.push(c); walk(c, type, out); }
  return out;
};

describe('a date field format the catalog does not list', () => {
  it('imports as a live field keyed by its own picture', () => {
    const fields = walk(importDocx(file).content, 'dateTimeField');
    expect(fields).toHaveLength(1);
    expect(fields[0].attrs).toMatchObject({ kind: 'date', format: 'MMMM d', fixed: false });
  });

  it('renders the current date in that format', () => {
    const fmt = findFormat('MMMM d')!;
    expect(renderFormat(fmt, new Date(2026, 8, 10), 'en-US')).toBe('September 10');
    // A Slavic locale declines the month beside a day; the stand-alone form is "сентябрь".
    expect(renderFormat(fmt, new Date(2026, 8, 10), 'ru-RU')).toBe('сентября 10');
    expect(docxPicture(fmt)).toBe('MMMM d');
  });

  it('exports the picture back, so the field stays live in Word', async () => {
    const doc = importDocx(file).content;
    const xml = strFromU8(unzipSync(await buildDocx(doc as any))['word/document.xml']);
    expect(xml).toMatch(/<w:fldSimple[^>]*w:instr="[^"]*DATE[^"]*MMMM d/);
  });
});

// The picture a new date field takes follows the UI language; a stored field keeps its own,
// which is what DEFAULT_DATE_FORMAT stays for.
describe('East Asian date pictures', () => {
  const day = new Date(2026, 2, 15);

  it('renders the CJK pictures', () => {
    expect(renderFormat(findFormat('ymd_cjk')!, day, 'zh-CN')).toBe('2026年3月15日');
    expect(renderFormat(findFormat('ymd_slash')!, day, 'zh-CN')).toBe('2026/03/15');
  });

  it('preselects one per locale, and leaves the fallback alone', () => {
    expect(defaultDateFormat('zh-Hans')).toBe('ymd_cjk');
    expect(defaultDateFormat('zh-Hant')).toBe('ymd_cjk');
    expect(defaultDateFormat('ja')).toBe('ymd_cjk');
    expect(defaultDateFormat('en')).toBe('mdy_slash');
    expect(defaultDateFormat('de')).toBe(DEFAULT_DATE_FORMAT);
  });
});

// The picker offers each UI language its own forms, read off Intl, and no other language's
// word order around its month names.
describe('the date formats a UI language is offered', () => {
  const day = new Date(2026, 10, 20);
  const samples = (l: string) => dateFormatsFor(l).map((f) => renderFormat(f, day, localeTag(l)));

  it('writes a date as the language does, and keeps the catalog keys where they fit', () => {
    expect(samples('ar')).toEqual(expect.arrayContaining(['20/11/2026', '20 نوفمبر 2026', 'الجمعة، 20 نوفمبر 2026']));
    expect(samples('ar').some((s) => /\d\. /.test(s))).toBe(false);
    expect(samples('fr')).toContain('vendredi 20 novembre 2026');
    expect(dateFormatsFor('de').slice(0, 3).map((f) => f.key)).toEqual(['dmy_dots', 'dmy_long', 'weekday_dmy']);
    expect(dateFormatsFor('en').slice(0, 3).map((f) => f.key)).toEqual(['mdy_slash', 'mdy_long', 'weekday_mdy']);
    expect(defaultDateFormat('ar')).toBe(dateFormatsFor('ar')[0].key);
  });

  it('writes the day-period marker of the language where its clock puts it', () => {
    const pm = new Date(2026, 10, 20, 13, 40);
    const twelve = (l: string) => timeFormatsFor(l).filter((f) => f.tokens.some((t) => t.t === 'ampm'))[0];
    expect(['en', 'ar', 'ko', 'zh-Hans'].map((l) => renderFormat(twelve(l), pm, localeTag(l)))).toEqual(['1:40 PM', '1:40 م', '오후 1:40', '下午1:40']);
    expect(renderFormat(twelve('es'), pm, 'es-ES')).toMatch(/^1:40 p\.\s?m\.$/);
    expect(docxPicture(twelve('ko'))).toBe('AM/PM h:mm');
    expect(findFormat(twelve('ko').key)!.tokens).toEqual(twelve('ko').tokens);
  });

  it('keeps a form with Latin letters among its literals a live picture', () => {
    const es = dateFormatsFor('es').find((f) => renderFormat(f, day, 'es-ES') === '20 de noviembre de 2026')!;
    expect(findFormat(es.key)!.tokens).toEqual(es.tokens);
    expect(findFormat(docxPicture(es))!.tokens).toEqual(es.tokens);
  });
});

// A measurement field writes its number as the UI language does and reads either separator.
describe('measurements in the UI language', () => {
  it('formats with the language\'s separator and parses both', () => {
    expect(formatDecimal(1.25, 2, 'de')).toBe('1,25');
    expect(formatDecimal(1.25, 2, 'en')).toBe('1.25');
    expect(formatDecimal(0.5, 2, 'ar')).toBe('0.5');
    expect(formatDecimal(1234.5, 2, 'fr')).toBe('1234,5');
    expect(['1,25', '1.25', '1٫25', ' 1,25 ', '١٫٢٥', '۱,۲۵'].map(parseDecimal)).toEqual([1.25, 1.25, 1.25, 1.25, 1.25, 1.25]);
  });
});
