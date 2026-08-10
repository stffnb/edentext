import { describe, it, expect } from 'vitest';
import { getSchema, generateHTML } from '@tiptap/core';
import { extensions } from '../../src/lib/editor/extensions';

// A named character style renders as a stylesheet rule, direct formatting as an inline
// style — so the charStyle span has to sit outside, or the rule beats the ancestor.
describe('mark nesting', () => {
  it('puts charStyle outside textStyle', () => {
    const schema = getSchema(extensions);
    expect(schema.marks.charStyle.rank).toBeLessThan(schema.marks.textStyle.rank);
    const html = generateHTML({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x',
        marks: [{ type: 'textStyle', attrs: { fontSize: '10pt' } }, { type: 'charStyle', attrs: { name: 'Code' } }] }] }],
    }, extensions);
    expect(html.indexOf('data-char-style')).toBeLessThan(html.indexOf('font-size'));
  });
});
