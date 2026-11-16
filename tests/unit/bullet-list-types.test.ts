import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BULLET_CYCLE,
  defaultBulletChar,
  bulletCharAttr,
  bulletCharFromDocx,
  bulletCharFromOdf,
} from '../../src/lib/utils/bulletListTypes';

describe('defaultBulletChar', () => {
  it('cycles • ◦ ▪ ▸ – · and wraps past depth 6', () => {
    expect(DEFAULT_BULLET_CYCLE).toEqual(['•', '◦', '▪', '▸', '–', '·']);
    expect(defaultBulletChar(0)).toBe('•');
    expect(defaultBulletChar(5)).toBe('·');
    expect(defaultBulletChar(6)).toBe('•');
  });
});

describe('bulletCharAttr (default suppression)', () => {
  it('suppresses the cycle char at its own depth', () => {
    expect(bulletCharAttr('•', 0)).toBeNull();
    expect(bulletCharAttr('◦', 1)).toBeNull();
    expect(bulletCharAttr('▪', 2)).toBeNull();
  });

  it('keeps a cycle char at a foreign depth', () => {
    expect(bulletCharAttr('•', 1)).toBe('•');
    expect(bulletCharAttr('▪', 0)).toBe('▪');
  });

  it('keeps non-default chars and drops empty ones', () => {
    expect(bulletCharAttr('❖', 0)).toBe('❖');
    expect(bulletCharAttr(null, 0)).toBeNull();
    expect(bulletCharAttr('', 3)).toBeNull();
  });
});

describe('bulletCharFromDocx (Word numbering.xml patterns)', () => {
  it('maps the Wingdings bullets from list1.docx', () => {
    expect(bulletCharFromDocx('', 'Wingdings')).toBe('❖');
    expect(bulletCharFromDocx('', 'Wingdings')).toBe('➢');
    expect(bulletCharFromDocx('', 'Wingdings')).toBe('▪');
    expect(bulletCharFromDocx('', 'Wingdings')).toBe('⇨');
    expect(bulletCharFromDocx('', 'Wingdings')).toBe('✓');
  });

  it("maps the arrows of Word's bullet library", () => {
    expect(bulletCharFromDocx('\uf0e0', 'Wingdings')).toBe('→');
    expect(bulletCharFromDocx('\uf0e8', 'Wingdings')).toBe('➔');
  });

  it("maps the Symbol bullets through the font's whole encoding", () => {
    expect(bulletCharFromDocx('\uf02d', 'Symbol')).toBe('−');
    expect(bulletCharFromDocx('\uf061', 'Symbol')).toBe('α');
    expect(bulletCharFromDocx('\uf0e0', 'Symbol')).toBe('◊');
    expect(bulletCharFromDocx('\uf09f', 'Wingdings')).toBe('•');
    expect(bulletCharFromOdf('•', 'Symbol')).toBe('•');
    expect(bulletCharFromDocx('', 'Symbol')).toBe('•');
    expect(bulletCharFromDocx('', 'Symbol')).toBe('♦');
  });

  it('resolves symbol fonts addressed without the PUA offset', () => {
    expect(bulletCharFromDocx('v', 'Wingdings')).toBe('❖');
  });

  it("keeps Word's hollow bullet the letter it is", () => {
    // A Courier New "o" — LibreOffice and Word both draw the glyph, not a ring.
    expect(bulletCharFromDocx('o', 'Courier New')).toBe('o');
  });

  it('passes literal chars in text fonts through', () => {
    expect(bulletCharFromDocx('>', 'Aptos')).toBe('>');
    expect(bulletCharFromDocx('-', undefined)).toBe('-');
  });

  it('draws a soft hyphen label as the hyphen both word processors show', () => {
    expect(bulletCharFromDocx('\u00ad', 'Courier New')).toBe('-');
    expect(bulletCharFromOdf('\u00ad', null)).toBe('-');
  });

  it('returns null for unmapped symbol glyphs and PUA chars in unknown fonts', () => {
    expect(bulletCharFromDocx('\uf021', 'Wingdings')).toBeNull();
    expect(bulletCharFromDocx('', 'SomeDingbats')).toBeNull();
    expect(bulletCharFromDocx('', 'Wingdings')).toBeNull();
    expect(bulletCharFromDocx(undefined, 'Wingdings')).toBeNull();
  });

  it('uses only the first char of a multi-char lvlText', () => {
    expect(bulletCharFromDocx('x', 'Wingdings')).toBe('➢');
  });
});

describe('bulletCharFromOdf', () => {
  it('passes real Unicode chars (LibreOffice output) through', () => {
    expect(bulletCharFromOdf('➢', null)).toBe('➢');
    expect(bulletCharFromOdf('•', 'OpenSymbol')).toBe('•');
  });

  it('resolves PUA chars via the declared symbol font', () => {
    expect(bulletCharFromOdf('', 'Wingdings')).toBe('➢');
    expect(bulletCharFromOdf('', 'Symbol')).toBe('•');
  });

  it('returns null for missing or unresolvable chars', () => {
    expect(bulletCharFromOdf(null, 'Wingdings')).toBeNull();
    expect(bulletCharFromOdf('', null)).toBeNull();
  });
});
