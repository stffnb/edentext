import { describe, it, expect } from 'vitest';
import { orderedTypeDef, orderedTypeFromFormat, DEFAULT_ORDERED_TYPE, defaultOrderedType, orderedTypeAttr, effectiveOrderedDef, formatOrdinal, cycleSlotOf, childCycle, defaultOrderedTypeAt, ROOT_ORDERED_CYCLE } from '../../src/lib/utils/orderedListTypes';

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
