import { describe, it, expect } from 'vitest';
import { normalizeColor } from '../../src/lib/export/odt';

describe('normalizeColor', () => {
  it('expands 3-digit hex to upper-case #RRGGBB', () => {
    expect(normalizeColor('#abc')).toBe('#AABBCC');
  });

  it('drops the alpha nibble of 4-digit hex', () => {
    expect(normalizeColor('#abcd')).toBe('#AABBCC');
  });

  it('upper-cases 6-digit hex', () => {
    expect(normalizeColor('#aabbcc')).toBe('#AABBCC');
  });

  it('truncates 8-digit hex to its RGB part', () => {
    expect(normalizeColor('#aabbccdd')).toBe('#AABBCC');
  });

  it('converts rgb() to hex', () => {
    expect(normalizeColor('rgb(255, 0, 0)')).toBe('#FF0000');
  });

  it('converts rgba() to hex, ignoring alpha', () => {
    expect(normalizeColor('rgba(0, 128, 255, 0.5)')).toBe('#0080FF');
  });

  it('clamps over-range rgb channels to 255', () => {
    expect(normalizeColor('rgb(300, 0, 999)')).toBe('#FF00FF');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeColor('  #ff0000  ')).toBe('#FF0000');
  });

  it('returns undefined for empty input', () => {
    expect(normalizeColor('   ')).toBeUndefined();
  });

  it('passes named colors through unchanged', () => {
    expect(normalizeColor('red')).toBe('red');
  });
});
