// The vector print path turns the document into an HTML string and the reader parses it
// back. A text box is an inline node carrying blocks, and no <p> can hold those — the
// parser breaks the paragraph open around it — so the box gets a paragraph of its own
// first and the artifacts of that split are cleaned out.
import { describe, it, expect } from 'vitest';
import { buildBodyHtml } from '../../src/lib/export/pdf';

type N = any;
const T = (text: string): N => ({ type: 'text', text });
const P = (...content: N[]): N => ({ type: 'paragraph', ...(content.length ? { content } : {}) });
const BOX = (): N => ({ type: 'textBox', attrs: { width: 160, height: 60 }, content: [P(T('KASTEN'))] });

// The blocks the reader's parser makes of that string.
function shape(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return Array.from(doc.body.children)
    .map((el) => {
      const tag = (el as HTMLElement).dataset.textbox !== undefined ? 'BOX' : el.tagName;
      const text = el.textContent?.replace(/\s+/g, ' ').trim();
      return text ? `${tag}(${text})` : tag;
    })
    .join(' ');
}

describe('a text box in the printed HTML', () => {
  it('stands between whole paragraphs, with no split artifacts', () => {
    const doc: N = { type: 'doc', content: [P(T('vor '), BOX(), T(' nach')), P(T('ende'))] };
    expect(shape(buildBodyHtml(doc))).toBe('P(vor nach) BOX(KASTEN) P(ende)');
  });

  it("keeps a blank line the reader wrote next to it", () => {
    const doc: N = { type: 'doc', content: [P(), P(T('mit '), BOX()), P()] };
    // Each empty paragraph keeps its own line (a <br> the pass re-adds); only the two
    // the split invented are gone.
    expect(shape(buildBodyHtml(doc))).toBe('P P(mit) BOX(KASTEN) P');
  });

  it('leaves a document without boxes untouched', () => {
    const doc: N = { type: 'doc', content: [P(T('eins')), P(T('zwei'))] };
    expect(shape(buildBodyHtml(doc))).toBe('P(eins) P(zwei)');
  });
});
