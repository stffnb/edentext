import { describe, it, expect } from 'vitest';
import { orderedTypeDef, orderedTypesFor, orderedTypeFromFormat, DEFAULT_ORDERED_TYPE, defaultOrderedType, orderedTypeAttr, effectiveOrderedDef, formatOrdinal, cycleSlotOf, childCycle, defaultOrderedTypeAt, ROOT_ORDERED_CYCLE } from '../../src/lib/utils/orderedListTypes';

describe('orderedTypeDef', () => {
  it('returns the matching definition for a known key', () => {
    const def = orderedTypeDef('lower-roman-paren');
    expect(def.numFormat).toBe('i');
    expect(def.numSuffix).toBe(')');
  });

  it('falls back to the default for null/undefined', () => {
    expect(orderedTypeDef(null).key).toBe(DEFAULT_ORDERED_TYPE);
    expect(orderedTypeDef(undefined).key).toBe(DEFAULT_ORDERED_TYPE);
  });

  it('falls back to the default for an unknown key', () => {
    expect(orderedTypeDef('bogus').key).toBe(DEFAULT_ORDERED_TYPE);
  });
});

describe('orderedTypeFromFormat (ODF → listStyleType)', () => {
  it('maps roman + ) to lower-roman-paren', () => {
    expect(orderedTypeFromFormat('i', ')')).toBe('lower-roman-paren');
  });

  it('maps decimal + . to decimal', () => {
    expect(orderedTypeFromFormat('1', '.')).toBe('decimal');
  });

  it('treats a missing suffix as "."', () => {
    expect(orderedTypeFromFormat('a', null)).toBe('lower-alpha');
  });

  it('falls back to decimal for an unknown suffix', () => {
    expect(orderedTypeFromFormat('1', '1.')).toBe('decimal');
  });

  it('falls back to decimal for an unknown format', () => {
    expect(orderedTypeFromFormat('Z', '.')).toBe('decimal');
  });
});

describe('depth defaults (null attr → 1. → a. → i. cycle)', () => {
  it('cycles decimal → lower-alpha → lower-roman and wraps', () => {
    expect(defaultOrderedType(0)).toBe('decimal');
    expect(defaultOrderedType(1)).toBe('lower-alpha');
    expect(defaultOrderedType(2)).toBe('lower-roman');
    expect(defaultOrderedType(3)).toBe('decimal');
  });

  it('orderedTypeAttr suppresses the cycle key at its own depth only', () => {
    expect(orderedTypeAttr('decimal', 0)).toBeNull();
    expect(orderedTypeAttr('lower-alpha', 1)).toBeNull();
    expect(orderedTypeAttr('lower-alpha', 0)).toBe('lower-alpha');
    expect(orderedTypeAttr('upper-roman-paren', 1)).toBe('upper-roman-paren');
  });

  it('effectiveOrderedDef resolves null by depth and keys explicitly', () => {
    expect(effectiveOrderedDef(null, 1).numFormat).toBe('a');
    expect(effectiveOrderedDef('upper-roman', 1).numFormat).toBe('I');
  });
});

describe('cycle re-anchoring (nested default advances past its parent)', () => {
  it('cycleSlotOf keys by num-format, sharing paren/case variants', () => {
    expect(cycleSlotOf('decimal')).toBe(0);
    expect(cycleSlotOf('decimal-paren')).toBe(0);
    expect(cycleSlotOf('lower-alpha')).toBe(1);
    expect(cycleSlotOf('upper-alpha-paren')).toBe(1);
    expect(cycleSlotOf('lower-roman')).toBe(2);
    expect(cycleSlotOf(null)).toBe(0);
  });

  it('childCycle advances one slot, re-anchoring slot + suffix at an explicit parent', () => {
    // Plain cycle from the root: top → a., → i. (dot suffix throughout).
    expect(defaultOrderedTypeAt(childCycle(ROOT_ORDERED_CYCLE, null, true))).toBe('lower-alpha');
    expect(defaultOrderedTypeAt(childCycle(childCycle(ROOT_ORDERED_CYCLE, null, true), null, true))).toBe('lower-roman');
    // An explicit "a., b." parent makes its child default to i. (not another a.).
    expect(defaultOrderedTypeAt(childCycle(ROOT_ORDERED_CYCLE, 'lower-alpha', true))).toBe('lower-roman');
    // Suffix inherits: an explicit "a)" parent makes the child default to i) not i.
    expect(defaultOrderedTypeAt(childCycle(ROOT_ORDERED_CYCLE, 'lower-alpha-paren', true))).toBe('lower-roman-paren');
    // And the ")" keeps propagating a further level down (→ decimal-paren, "1)").
    const twoDeep = childCycle(childCycle(ROOT_ORDERED_CYCLE, 'lower-alpha-paren', true), null, true);
    expect(defaultOrderedTypeAt(twoDeep)).toBe('decimal-paren');
    // A bullet parent doesn't re-anchor; it still advances the depth, keeping the suffix.
    expect(childCycle({ slot: 1, suffix: ')' }, null, false)).toEqual({ slot: 2, suffix: ')' });
  });
});

describe('formatOrdinal', () => {
  it('formats alpha and roman ordinals', () => {
    expect(formatOrdinal(3, '1')).toBe('3');
    expect(formatOrdinal(3, 'a')).toBe('c');
    expect(formatOrdinal(28, 'a')).toBe('ab');
    expect(formatOrdinal(4, 'i')).toBe('iv');
    expect(formatOrdinal(9, 'I')).toBe('IX');
  });
});

// Chinese numbering. Every expectation here was rendered by LibreOffice (a .docx with one
// list per w:numFmt, converted to text) rather than reasoned out.
describe('Chinese ordered list types', () => {
  it('counts informally, dropping the leading 一 in the teens', () => {
    const f = (n: number) => formatOrdinal(n, '一, 二, 三, ...');
    expect([1, 9, 10, 11, 19, 20, 21, 99].map(f)).toEqual(
      ['一', '九', '十', '十一', '十九', '二十', '二十一', '九十九'],
    );
    expect(f(100)).toBe('一百');
    expect(f(101)).toBe('一百〇一');
  });

  it('counts formally, keeping it', () => {
    const f = (n: number) => formatOrdinal(n, '壹, 贰, 叁, ...');
    expect([1, 3, 9, 10, 11, 20, 21].map(f)).toEqual(
      ['壹', '叁', '玖', '壹拾', '壹拾壹', '贰拾', '贰拾壹'],
    );
  });

  // Past the tenth stem LibreOffice numbers on in decimal, and so do the circled digits
  // past the last one Unicode has.
  it('falls back where the sequence runs out', () => {
    expect(formatOrdinal(10, '甲, 乙, 丙, ...')).toBe('癸');
    expect(formatOrdinal(11, '甲, 乙, 丙, ...')).toBe('11');
    expect(formatOrdinal(20, '①, ②, ③, ...')).toBe('⑳');
    expect(formatOrdinal(21, '①, ②, ③, ...')).toBe('㉑');
    expect(formatOrdinal(50, '①, ②, ③, ...')).toBe('㊿');
    expect(formatOrdinal(51, '①, ②, ③, ...')).toBe('51');
  });

  it('reads the ODF spellings back whatever suffix they carry', () => {
    expect(orderedTypeFromFormat('一, 二, 三, ...', '、')).toBe('cjk-counting');
    expect(orderedTypeFromFormat('一, 二, 三, ...', null)).toBe('cjk-counting');
    expect(orderedTypeFromFormat('①, ②, ③, ...', '')).toBe('circled-decimal');
    expect(orderedTypeFromFormat('1', ')')).toBe('decimal-paren');
  });
});

// Japanese kana numbering, as LibreOffice renders a .docx with aiueo/iroha lists as text.
describe('Japanese ordered list types', () => {
  it('starts each syllabary over once it runs out', () => {
    const a = (n: number) => formatOrdinal(n, 'ア, イ, ウ, ...');
    expect([1, 10, 20, 40, 46, 47].map(a)).toEqual(['ア', 'コ', 'ト', 'リ', 'ン', 'ア']);
    const i = (n: number) => formatOrdinal(n, 'イ, ロ, ハ, ...');
    expect([1, 9, 29, 45, 48, 49].map(i)).toEqual(['イ', 'リ', 'ヤ', 'モ', 'ン', 'イ']);
  });

  it('reads the half-width ODF spellings as the full-width types', () => {
    expect(orderedTypeFromFormat('ｱ, ｲ, ｳ, ...', '.')).toBe('katakana');
    expect(orderedTypeFromFormat('ｲ, ﾛ, ﾊ, ...', null)).toBe('katakana-iroha');
  });
});

describe('Arabic ordered list types', () => {
  it('counts in Arabic-Indic digits and in both letter orders', () => {
    expect([1, 10, 23].map((n) => formatOrdinal(n, '١, ٢, ٣, ...'))).toEqual(['١', '١٠', '٢٣']);
    expect([1, 2, 3, 5].map((n) => formatOrdinal(n, 'أ, ب, ت, ...'))).toEqual(['أ', 'ب', 'ت', 'ج']);
    expect([1, 2, 3, 5].map((n) => formatOrdinal(n, 'ا, ب, ج, ...'))).toEqual(['ا', 'ب', 'ج', 'ه']);
  });

  it('reads the ODF spellings back with their suffix', () => {
    expect(orderedTypeFromFormat('أ, ب, ت, ...', '.')).toBe('arabic-alpha');
    expect(orderedTypeFromFormat('ا, ب, ج, ...', ')')).toBe('arabic-abjad-paren');
  });

  it('is offered where the document or the interface is in Arabic script', () => {
    const keys = (arabic: boolean) => orderedTypesFor({ cjk: false, cyrillic: false, arabic }).map((t) => t.key);
    expect(keys(true)).toContain('arabic-indic');
    expect(keys(false)).not.toContain('arabic-indic');
  });
});
