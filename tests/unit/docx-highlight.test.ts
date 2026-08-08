// Word's highlighter pen is w:highlight (a palette name), not the w:shd hex fill.
import { describe, it, expect } from 'vitest';
import { parseRunProps, mergeRunProps, W } from '../../src/lib/import/docxStyles';

const rPr = (inner: string) =>
  new DOMParser().parseFromString(`<w:rPr xmlns:w="${W}">${inner}</w:rPr>`, 'application/xml').documentElement;

describe('parseRunProps highlight', () => {
  it('resolves a palette name to its hex', () => {
    expect(parseRunProps(rPr('<w:highlight w:val="yellow"/>')).highlightFill).toBe('FFFF00');
  });

  it("lets a run's w:highlight none cancel the character style's pen", () => {
    const base = parseRunProps(rPr('<w:highlight w:val="green"/>'));
    const merged = mergeRunProps(base, parseRunProps(rPr('<w:highlight w:val="none"/>')));
    expect(merged.highlightFill).toBe('auto');
  });

  it('ignores an unknown name rather than inventing a colour', () => {
    expect(parseRunProps(rPr('<w:highlight w:val="chartreuse"/>')).highlightFill).toBeUndefined();
  });
});
