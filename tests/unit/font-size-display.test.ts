import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blockFontSize, DEFAULT_FONT_SIZE, HEADING_SIZES } from '../../src/lib/utils/fontSize';

// The toolbar's size box shows blockFontSize() for text without its own size mark, while
// the page renders what editor.css says — so the two tables must not drift apart.
const css = readFileSync(resolve(process.cwd(), 'src/styles/editor.css'), 'utf8');

function cssFontSize(selector: string): string | null {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{[^}]*?font-size:\\s*([^;]+);`);
  return css.match(re)?.[1].trim() ?? null;
}

describe('toolbar font size vs. rendered font size', () => {
  it('shows the paragraph-mark size, else the block default', () => {
    const para = { type: { name: 'paragraph' }, attrs: {} };
    expect(blockFontSize(para)).toBe(DEFAULT_FONT_SIZE);
    expect(blockFontSize({ ...para, attrs: { fontSize: '22pt' } })).toBe('22pt');
    expect(blockFontSize({ type: { name: 'heading' }, attrs: { level: 5 } })).toBe(HEADING_SIZES[5]);
    // An explicit paragraph-mark size beats the heading default (style gallery, imports).
    expect(blockFontSize({ type: { name: 'heading' }, attrs: { level: 1, fontSize: '9pt' } })).toBe('9pt');
    expect(blockFontSize(null)).toBe(DEFAULT_FONT_SIZE);
  });

  it('matches the sizes editor.css renders', () => {
    expect(cssFontSize('.paper .tiptap')).toBe(DEFAULT_FONT_SIZE);
    for (const [level, size] of Object.entries(HEADING_SIZES)) {
      expect(cssFontSize(`.paper .tiptap h${level}`), `h${level}`).toBe(size);
    }
  });
});
