import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import { PageNumber } from '../../src/lib/editor/extensions/pageField';
import { countText } from '../../src/lib/utils/wordCount';

const schema = getSchema([Document, Paragraph, Text, HardBreak, Heading, PageNumber]);
const doc = (...content: unknown[]) => schema.nodes.doc.create(null, content as never);
const p = (...content: unknown[]) => schema.nodes.paragraph.create(null, content as never);
const t = (s: string) => schema.text(s);
const whole = (d: ReturnType<typeof doc>) => countText(d, 0, d.content.size);

describe('countText', () => {
  it('counts words, characters and paragraphs', () => {
    const d = doc(p(t('Ein kleiner Satz.')), p(t('Noch einer.')));
    expect(whole(d)).toEqual({ words: 5, charsWithSpaces: 28, charsNoSpaces: 25, paragraphs: 2 });
  });

  it('never merges words across paragraphs, headings or hard breaks', () => {
    const d = doc(
      schema.nodes.heading.create({ level: 1 }, t('Titel')),
      p(t('ab'), schema.nodes.hardBreak.create(), t('cd')),
      p(t('ef')),
    );
    const s = whole(d);
    expect(s.words).toBe(4);
    expect(s.paragraphs).toBe(3);
    // The stand-in newlines are word boundaries, not characters.
    expect(s.charsWithSpaces).toBe(11);
    expect(s.charsNoSpaces).toBe(11);
  });

  it('counts leaf atoms (images, fields) as no text', () => {
    const d = doc(p(t('vor '), schema.nodes.pageNumber.create(), t(' nach')));
    expect(whole(d)).toEqual({ words: 2, charsWithSpaces: 9, charsNoSpaces: 7, paragraphs: 1 });
  });

  it('counts an empty document as zero', () => {
    const d = doc(p());
    expect(whole(d)).toEqual({ words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 1 });
  });

  it('counts a selection range only', () => {
    const d = doc(p(t('eins zwei drei')));
    // Positions 1..5: the run "eins" inside the first paragraph.
    expect(countText(d, 1, 5).words).toBe(1);
    expect(countText(d, 1, 5).charsWithSpaces).toBe(4);
  });
});
