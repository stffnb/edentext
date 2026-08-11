import { describe, it, expect } from 'vitest';
import { styleCss, builtinStyleSheet } from '../../src/lib/styles/styleSheet';

// ODF kerns by default and Word does not, so only the off state is ever stored.
describe('pair kerning', () => {
  it('renders font-kerning only where a style turns it off', () => {
    const sheet = builtinStyleSheet();
    expect(styleCss(sheet)).not.toContain('font-kerning');
    sheet.paragraph.Standard.text = { ...sheet.paragraph.Standard.text, kerning: false };
    expect(styleCss(sheet)).toContain('font-kerning: none');
  });

  it('inherits the off state down the parent chain', () => {
    const sheet = builtinStyleSheet();
    sheet.paragraph.Standard.text = { ...sheet.paragraph.Standard.text, kerning: false };
    const css = styleCss(sheet);
    const heading = css.slice(css.indexOf('[data-style="Heading 1"]'));
    expect(heading.slice(0, heading.indexOf('}'))).toContain('font-kerning: none');
  });
});
