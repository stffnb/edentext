import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { formatOrdinal, orderedTypeDef, orderedTypesFor, cycleSlotOf } from '../../src/lib/utils/orderedListTypes';

// Russian letters and letters that repeat past the last one (num-letter-sync). The markers
// below were read out of LibreOffice, converting a 60-item list per format to text.
const KEYS = [
  'lower-alpha-sync', 'lower-alpha-sync-paren', 'upper-alpha-sync', 'upper-alpha-sync-paren',
  'lower-cyrillic', 'lower-cyrillic-paren', 'upper-cyrillic', 'upper-cyrillic-paren',
  'lower-cyrillic-sync', 'lower-cyrillic-sync-paren', 'upper-cyrillic-sync', 'upper-cyrillic-sync-paren',
] as const;
const MARGINS = { top: 2, bottom: 2, left: 2, right: 2 } as never;

const docOf = (key: string) => ({
  type: 'doc',
  content: [{
    type: 'orderedList',
    attrs: { listStyleType: key },
    content: [
      { type: 'listItem', content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'one' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'two' }] }] },
    ],
  }],
});

const listKey = (doc: unknown) =>
  ((doc as { content?: { attrs?: { listStyleType?: string } }[] }).content?.[0].attrs ?? {}).listStyleType;
const marks = (key: string, ns: number[]) => ns.map((n) => formatOrdinal(n, orderedTypeDef(key).numFormat));

describe('letter list numbering', () => {
  it('counts as LibreOffice does', () => {
    expect(marks('lower-alpha-sync', [1, 26, 27, 28, 52, 53])).toEqual(['a', 'z', 'aa', 'bb', 'zz', 'aaa']);
    expect(marks('upper-alpha-sync', [27, 28, 53])).toEqual(['AA', 'BB', 'AAA']);
    expect(marks('lower-cyrillic', [1, 26, 29, 30, 31, 59])).toEqual(['а', 'ы', 'я', 'аа', 'аб', 'ба']);
    expect(marks('upper-cyrillic', [1, 29, 30, 31, 59])).toEqual(['А', 'Я', 'Аа', 'Аб', 'Ба']);
    expect(marks('lower-cyrillic-sync', [29, 30, 31, 59])).toEqual(['я', 'аа', 'бб', 'ааа']);
    expect(marks('upper-cyrillic-sync', [30, 31, 59])).toEqual(['Аа', 'Бб', 'Ааа']);
  });

  it('nests like the other letters', () => {
    for (const key of KEYS) expect(cycleSlotOf(key), key).toBe(1);
  });

  it('keeps the letter-repeating rows out of the quick menus', () => {
    const quick = orderedTypesFor({ cjk: false, cyrillic: true }).map((t) => t.key);
    expect(quick.filter((k) => k.includes('-sync'))).toEqual([]);
    expect(orderedTypesFor({ cjk: false, cyrillic: false }, null, true).map((t) => t.key)).toContain('lower-alpha-sync');
    expect(orderedTypesFor({ cjk: false, cyrillic: false }, 'upper-alpha-sync').map((t) => t.key)).toContain('upper-alpha-sync');
  });

  it('offers a script only where the UI or the document is in it', () => {
    const keys = (show: { cjk: boolean; cyrillic: boolean; korean?: boolean }, current?: string, rare = false) =>
      orderedTypesFor(show, current, rare).map((t) => t.key);
    const none = keys({ cjk: false, cyrillic: false });
    expect(none).not.toContain('lower-cyrillic');
    expect(none).not.toContain('cjk-counting');
    expect(keys({ cjk: false, cyrillic: true })).toContain('upper-cyrillic-paren');
    expect(keys({ cjk: false, cyrillic: true }, null, true)).toContain('upper-cyrillic-sync-paren');
    expect(keys({ cjk: true, cyrillic: false })).toContain('katakana');
    expect(keys({ cjk: false, cyrillic: false }, 'katakana')).toContain('katakana');
    expect(keys({ cjk: true, cyrillic: false })).not.toContain('hangul');
    expect(keys({ cjk: true, cyrillic: false, korean: true })).toContain('hangul');
  });

  it('writes letter-sync and the Russian spellings to ODF', async () => {
    const xmlOf = async (key: string) => {
      const files = unzipSync(await buildOdt(docOf(key) as never, MARGINS, 'portrait'));
      return strFromU8(files['content.xml']) + strFromU8(files['styles.xml']);
    };
    expect(await xmlOf('upper-alpha-sync-paren')).toContain('style:num-format="A" style:num-letter-sync="true" style:num-suffix=")"');
    expect(await xmlOf('lower-cyrillic-sync')).toContain('style:num-format="а, б, .., аа, бб, ... (ru)"');
  });

  it('names the Word formats LibreOffice writes for them', async () => {
    const want: Record<string, string> = {
      'lower-alpha-sync': 'lowerLetter', 'upper-alpha-sync': 'upperLetter',
      'lower-cyrillic': 'russianLower', 'lower-cyrillic-sync': 'russianLower',
      'upper-cyrillic': 'russianUpper', 'upper-cyrillic-sync': 'russianUpper',
    };
    for (const [key, fmt] of Object.entries(want)) {
      const files = unzipSync(await buildDocx(docOf(key) as never, MARGINS, 'portrait'));
      expect(strFromU8(files['word/numbering.xml']), key).toContain(`w:numFmt w:val="${fmt}"`);
    }
  });

  it('round-trips through ODT', async () => {
    for (const key of KEYS) {
      expect(listKey((await importOdt(await buildOdt(docOf(key) as never, MARGINS, 'portrait'))).content), key).toBe(key);
    }
  });

  // Word has one format per alphabet: the letter-repeating kind comes back as the other.
  it('round-trips through DOCX as far as Word can tell them apart', async () => {
    const back = (key: string) => key.replace('-alpha-sync', '-alpha').replace('-cyrillic-sync', '-cyrillic');
    for (const key of KEYS) {
      expect(listKey(importDocx(await buildDocx(docOf(key) as never, MARGINS, 'portrait')).content), key).toBe(back(key));
    }
  });
});
