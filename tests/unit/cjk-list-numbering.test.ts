import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { formatOrdinal } from '../../src/lib/utils/orderedListTypes';

// The numbering styles Chinese, Japanese and Korean documents actually use. Every spelling below was read
// out of LibreOffice: a .docx carrying one w:numFmt per list, converted both ways.
const KEYS = ['cjk-counting', 'cjk-legal', 'cjk-stem', 'circled-decimal', 'katakana', 'katakana-iroha',
  'hangul', 'hangul-paren', 'hangul-consonant', 'korean-counting', 'korean-legal'] as const;
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

describe('CJK list numbering', () => {
  it('names the Word formats LibreOffice writes for them', async () => {
    const want: Record<string, string> = {
      'cjk-counting': 'chineseCountingThousand',
      'cjk-legal': 'chineseLegalSimplified',
      'cjk-stem': 'ideographTraditional',
      'circled-decimal': 'decimalEnclosedCircle',
      katakana: 'aiueoFullWidth',
      'katakana-iroha': 'irohaFullWidth',
      hangul: 'ganada',
      'hangul-paren': 'ganada',
      'hangul-consonant': 'chosung',
      'korean-counting': 'koreanCounting',
      'korean-legal': 'koreanLegal',
    };
    for (const key of KEYS) {
      const files = unzipSync(await buildDocx(docOf(key) as never, MARGINS, 'portrait'));
      expect(strFromU8(files['word/numbering.xml']), key).toContain(`w:numFmt w:val="${want[key]}"`);
    }
  });

  // LibreOffice spells these as the whole sequence, not as one character — a bare 一 is
  // dropped back to decimal on the next save.
  it('names the ODF formats as the sequence', async () => {
    const files = unzipSync(await buildOdt(docOf('cjk-counting') as never, MARGINS, 'portrait'));
    const xml = strFromU8(files['content.xml']) + strFromU8(files['styles.xml']);
    expect(xml).toContain('style:num-format="一, 二, 三, ..."');
    expect(xml).toContain('style:num-suffix="、"');
  });

  // LibreOffice's own rendering, read from a converted list of each format.
  it('counts as LibreOffice does', () => {
    const at = (f: Parameters<typeof formatOrdinal>[1], ns: number[]) => ns.map((n) => formatOrdinal(n, f));
    expect(at('가, 나, 다, ...', [1, 14, 15])).toEqual(['가', '하', '가']);
    expect(at('ㄱ, ㄴ, ㄷ, ...', [1, 14, 15])).toEqual(['ㄱ', 'ㅎ', 'ㄱ']);
    expect(at('일, 이, 삼, ...', [10, 11, 101, 2023, 10001, 12345])).toEqual(['십', '십일', '백일', '이천이십삼', '만일', '만이천삼백사십오']);
    expect(at('하나, 둘, 셋, ...', [1, 11, 99, 101])).toEqual(['하나', '열하나', '아흔아홉', '백일']);
  });

  it('round-trips through both formats', async () => {
    for (const key of KEYS) {
      expect(listKey(importDocx(await buildDocx(docOf(key) as never, MARGINS, 'portrait')).content), key).toBe(key);
      expect(listKey((await importOdt(await buildOdt(docOf(key) as never, MARGINS, 'portrait'))).content), key).toBe(key);
    }
  });
});
