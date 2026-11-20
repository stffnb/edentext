// The picker shows a CJK family under its Chinese name; picking or typing that name must
// still land the Latin family on the run, which is what CSS and both formats resolve.
import { describe, it, expect } from 'vitest';
import { fontFromLabel, fontLabel, fontMatches } from '../../src/lib/components/ribbon/fontList.svelte';
import { setLocale } from '../../src/lib/i18n/i18n.svelte';

const KNOWN = ['Arial', 'SimSun', 'Songti SC', 'Microsoft YaHei'];

describe('font labels', () => {
  it('names the CJK families in Chinese, others as they are', async () => {
    await setLocale('zh-Hans');
    expect(fontLabel('SimSun')).toBe('宋体');
    await setLocale('zh-Hant');
    expect(fontLabel('SimSun')).toBe('宋體');
    expect(fontLabel('Arial')).toBe('Arial');
    await setLocale('ja');
    expect(fontLabel('MS Mincho')).toBe('ＭＳ 明朝');
    expect(fontLabel('SimSun')).toBe('SimSun');
    await setLocale('ko');
    expect(fontLabel('Malgun Gothic')).toBe('맑은 고딕');
    await setLocale('de');
    expect(fontLabel('SimSun')).toBe('SimSun');
  });

  it('resolves a Chinese name back to the family', async () => {
    await setLocale('zh-Hans');
    expect(fontFromLabel('宋体', KNOWN)).toBe('SimSun');
    expect(fontFromLabel('微软雅黑', KNOWN)).toBe('Microsoft YaHei');
    expect(fontFromLabel('simsun', KNOWN)).toBe('SimSun');
    expect(fontFromLabel('宋', KNOWN)).toBe('SimSun');
    expect(fontFromLabel('Zapfino', KNOWN)).toBeUndefined();
    expect(fontMatches('Songti SC', '宋')).toBe(true);
    await setLocale('en');
    expect(fontFromLabel('宋体', KNOWN)).toBeUndefined();
  });
});
