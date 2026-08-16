import { describe, it, expect } from 'vitest';
import {
  builtinStyleSheet, mergeStoredSheet, resolveStyle, styleCss, styleOrder, visibleStyles, DEFAULT_STYLE,
  STYLE_SHEET_VERSION, type StyleSheet,
} from '../../src/lib/styles/styleSheet';
import { HEADING_STYLE_OVERRIDES } from '../../src/lib/export/odt';

const ptOf = (len: string) => (len.endsWith('cm') ? (parseFloat(len) / 2.54) * 72 : parseFloat(len));

describe('named paragraph styles', () => {
  it('inherits along the parent chain, nearest wins', () => {
    const sheet = builtinStyleSheet();
    const h1 = resolveStyle(sheet, 'Heading 1');
    expect(h1.text.fontSizePt).toBe(18);          // own
    expect(h1.text.bold).toBe(true);              // from Heading
    expect(h1.text.fontFamily).toBe('Liberation Sans'); // from Heading, shadowing Standard's serif
    expect(h1.para.spaceBefore).toBe(12);         // from Heading
    const standard = resolveStyle(sheet, DEFAULT_STYLE);
    expect(standard.text.fontFamily).toBe('Liberation Serif');
    expect(standard.para.spaceBefore).toBe(0);
  });

  it('treats an undefined own value as "not set" (the parent still applies)', () => {
    const sheet = builtinStyleSheet();
    // What the style manager stores when a field is cleared.
    sheet.paragraph['Heading 2'] = { ...sheet.paragraph['Heading 2'], text: { fontSizePt: undefined } };
    const h2 = resolveStyle(sheet, 'Heading 2');
    expect(h2.text.fontFamily).toBe('Liberation Sans'); // still inherited from Heading
    expect(h2.text.fontSizePt).toBe(12);        // falls back to Standard's size
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

  it('lists every style directly after its parent', () => {
    const sheet = builtinStyleSheet();
    for (const [name, parent] of [['warum', DEFAULT_STYLE], ['hallo', DEFAULT_STYLE], ['ordnung', 'warum']]) {
      sheet.paragraph[name] = { name, parent, next: null, para: {}, text: {} };
    }
    const names = styleOrder(sheet, true).map((s) => s.name);
    expect(names.indexOf('ordnung')).toBe(names.indexOf('warum') + 1);
    expect(names.indexOf('hallo')).toBeLessThan(names.indexOf('warum'));
    // Built-ins keep their listed order ahead of the user styles.
    expect(names.slice(0, 3)).toEqual([DEFAULT_STYLE, 'Heading', 'Heading 1']);
  });
});

// The sheet lives in localStorage, so a released change to the built-ins has to reach
// installations that already stored the old ones.
describe('persisted style sheet', () => {
  const own = { name: 'Merksatz', parent: 'Standard', next: null, para: {}, text: { bold: true } };

  it('re-seeds built-ins from an older version but keeps user styles', () => {
    const stale = { v: 1, paragraph: {
      Heading: { name: 'Heading', parent: 'Standard', next: 'Standard', builtin: true, para: {}, text: { fontFamily: 'Arial' } },
      Merksatz: own,
    } };
    const sheet = mergeStoredSheet(stale);
    expect(sheet.paragraph['Heading'].text.fontFamily).toBe('Liberation Sans'); // factory again
    expect(sheet.paragraph['Merksatz']).toEqual(own);                           // user style kept
  });

  it('keeps stored built-ins of the current version (edits, imported documents)', () => {
    const edited = { v: STYLE_SHEET_VERSION, paragraph: {
      Heading: { name: 'Heading', parent: 'Standard', next: 'Standard', builtin: true, para: {}, text: { fontFamily: 'Georgia' } },
    } };
    expect(mergeStoredSheet(edited).paragraph['Heading'].text.fontFamily).toBe('Georgia');
  });

  it('lists headings 1–5 in the gallery, the rest only on request or in use', () => {
    const sheet = builtinStyleSheet();
    const names = (styles: { name: string }[]) => styles.map((s) => s.name);
    expect(names(visibleStyles(sheet))).toContain('Heading 5');
    expect(names(visibleStyles(sheet))).not.toContain('Heading 6');
    expect(names(visibleStyles(sheet, true))).toContain('Heading 10');
    expect(names(visibleStyles(sheet, false, 'Heading 7'))).toContain('Heading 7');
  });

  it('falls back to the built-ins for junk', () => {
    expect(mergeStoredSheet(null).paragraph['Standard'].text.fontSizePt).toBe(12);
    expect(mergeStoredSheet({ v: 2 }).paragraph['Heading 1'].text.fontSizePt).toBe(18);
  });
});
