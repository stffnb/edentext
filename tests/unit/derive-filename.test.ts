import { describe, it, expect } from 'vitest';
import { deriveFilename } from '../../src/lib/export/odt';

const doc = (...content: any[]) => ({ type: 'doc', content }) as any;
const heading = (text: string) => ({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] });
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

describe('deriveFilename', () => {
  it('derives the name from the first non-empty heading', () => {
    expect(deriveFilename(doc(heading('Invoice Report 2026')))).toBe('Invoice-Report-2026.odt');
  });

  it('skips leading paragraphs and uses the first heading', () => {
    expect(deriveFilename(doc(para('intro'), heading('Annual Summary')))).toBe('Annual-Summary.odt');
  });

  it('strips disallowed characters and collapses whitespace', () => {
    expect(deriveFilename(doc(heading('Hä?llo / World!')))).toBe('Hllo-World.odt');
  });

  it('truncates to 50 characters before sanitizing', () => {
    const long = 'a'.repeat(80);
    expect(deriveFilename(doc(heading(long)))).toBe(`${'a'.repeat(50)}.odt`);
  });

  it('falls back to document.odt when there is no heading', () => {
    expect(deriveFilename(doc(para('just a paragraph')))).toBe('document.odt');
  });

  it('falls back to document.odt when the heading sanitizes to empty', () => {
    expect(deriveFilename(doc(heading('???')))).toBe('document.odt');
  });

  it('falls back to document.odt for an empty document', () => {
    expect(deriveFilename(doc())).toBe('document.odt');
  });
});
