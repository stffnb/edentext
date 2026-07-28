import { describe, it, expect } from 'vitest';
import { blockFontSize, DEFAULT_FONT_SIZE } from '../../src/lib/utils/fontSize';
import { builtinStyleSheet, resolveStyle } from '../../src/lib/styles/styleSheet';

// The toolbar's size box shows blockFontSize() for text without its own size mark, while
// the page renders the block's named style — the two must not drift apart.
describe('toolbar font size vs. rendered font size', () => {
  const sheet = builtinStyleSheet();

  it('shows the paragraph-mark size, else the block style default', () => {
    const para = { type: { name: 'paragraph' }, attrs: {} };
    expect(blockFontSize(para)).toBe(DEFAULT_FONT_SIZE);
    expect(blockFontSize({ ...para, attrs: { fontSize: '22pt' } })).toBe('22pt');
    expect(blockFontSize(null)).toBe(DEFAULT_FONT_SIZE);
  });

  it('reads a heading from its style, by name or by level', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      const expected = `${resolveStyle(sheet, `Heading ${level}`).text.fontSizePt}pt`;
      expect(blockFontSize({ type: { name: 'heading' }, attrs: { level } })).toBe(expected);
      expect(blockFontSize({ type: { name: 'paragraph' }, attrs: { styleName: `Heading ${level}` } })).toBe(expected);
    }
    // An explicit paragraph-mark size beats the style (direct formatting wins).
    expect(blockFontSize({ type: { name: 'heading' }, attrs: { level: 1, fontSize: '9pt' } })).toBe('9pt');
  });
});
