import { describe, it, expect } from 'vitest';
import {
  builtinStyleSheet, resolveStyle, styleCss, styleOrder, DEFAULT_STYLE, type StyleSheet,
} from '../../src/lib/styles/styleSheet';
import { HEADING_STYLE_OVERRIDES } from '../../src/lib/export/odt';

const ptOf = (len: string) => (len.endsWith('cm') ? (parseFloat(len) / 2.54) * 72 : parseFloat(len));

describe('named paragraph styles', () => {
  it('inherits along the parent chain, nearest wins', () => {
    const sheet = builtinStyleSheet();
    const h1 = resolveStyle(sheet, 'Heading 1');
    expect(h1.text.fontSizePt).toBe(18);          // own
    expect(h1.text.bold).toBe(true);              // from Heading
    expect(h1.text.fontFamily).toBe('Arial');     // from Heading, shadowing Standard's serif
    expect(h1.para.spaceBefore).toBe(12);         // from Heading
    const standard = resolveStyle(sheet, DEFAULT_STYLE);
    expect(standard.text.fontFamily).toBe('Liberation Serif');
    expect(standard.para.spaceBefore).toBe(0);
  });

  it('falls back to Standard for unknown names and survives a parent cycle', () => {
    const sheet = builtinStyleSheet();
    expect(resolveStyle(sheet, 'Nope').text.fontSizePt).toBe(12);
    const cyclic: StyleSheet = { paragraph: {
      A: { name: 'A', parent: 'B', next: null, para: {}, text: { fontSizePt: 9 } },
      B: { name: 'B', parent: 'A', next: null, para: {}, text: { bold: true } },
    } };
    const a = resolveStyle(cyclic, 'A');
    expect(a.text.fontSizePt).toBe(9);
    expect(a.text.bold).toBe(true);
  });

  it('matches the heading sizes/margins the exporters write', () => {
    const sheet = builtinStyleSheet();
    HEADING_STYLE_OVERRIDES.forEach((o, i) => {
      const r = resolveStyle(sheet, `Heading ${i + 1}`);
      expect(r.text.fontSizePt, o.name).toBe(ptOf(o.fontSize));
      expect(r.para.spaceBefore!, o.name).toBeCloseTo(ptOf(o.marginTop), 1);
      expect(r.para.spaceAfter!, o.name).toBeCloseTo(ptOf(o.marginBottom), 1);
    });
  });

  it('renders CSS keyed by data-style, with a fallback for unnamed headings', () => {
    const css = styleCss(builtinStyleSheet());
    expect(css).toContain('.paper .tiptap [data-style="Heading 1"]');
    expect(css).toContain('.paper .tiptap h1:not([data-style])');
    expect(css).toContain('.paper .tiptap p:not([data-style])');
    const h1Rule = css.slice(css.indexOf('[data-style="Heading 1"]'));
    expect(h1Rule.slice(0, h1Rule.indexOf('}'))).toContain('font-size: 18pt');
  });

  it('lists the gallery order without the abstract Heading parent', () => {
    const names = styleOrder(builtinStyleSheet()).map((s) => s.name);
    expect(names[0]).toBe(DEFAULT_STYLE);
    expect(names).not.toContain('Heading');
    expect(names).toContain('Heading 5');
    expect(names).toContain('Quotations');
  });
});
