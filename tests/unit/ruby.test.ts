// A ruby annotation is one element in both formats — a base and the reading over it —
// so it travels as one atom. ODF writes <text:ruby> with a ruby-family style,
// Word a <w:ruby> run.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const doc: N = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Vor ' },
      { type: 'ruby', attrs: { base: '漢字', text: 'かんじ' } },
      { type: 'text', text: ' nach.' },
    ],
  }],
};

const margins = { top: 2, bottom: 2, left: 2, right: 2 };

// The imported paragraph's inline children, flattened to what this test cares about.
const inline = (r: N): N[] => ((r.content as N).content[0].content ?? []);

describe('ruby', () => {
  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('<text:ruby-base>漢字</text:ruby-base><text:ruby-text>かんじ</text:ruby-text>');
    expect(xml).toContain('style:family="ruby"');
    const back = inline(importOdt(bytes));
    expect(back.find((n) => n.type === 'ruby')?.attrs).toEqual({ base: '漢字', text: 'かんじ' });
    expect(back.map((n) => n.text ?? '').join('')).toBe('Vor  nach.');
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('<w:rubyBase><w:r><w:t xml:space="preserve">漢字</w:t></w:r></w:rubyBase>');
    expect(xml).toContain('<w:rubyPr>');
    const back = inline(importDocx(bytes));
    expect(back.find((n) => n.type === 'ruby')?.attrs).toEqual({ base: '漢字', text: 'かんじ' });
  });
});
