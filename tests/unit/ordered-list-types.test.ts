import { describe, it, expect } from 'vitest';
import { orderedTypeDef, orderedTypeFromFormat, DEFAULT_ORDERED_TYPE } from '../../src/lib/editor/orderedListTypes';

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
