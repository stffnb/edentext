import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';

// A shape's text takes no language from the Standard style, so LibreOffice spell-checks
// it in its own locale; the document's language has to be written on the block itself.
const box = (attrs: object, text: string, lang?: string) => ({
  type: 'paragraph',
  content: [{ type: 'textBox', attrs,
    content: [{ type: 'paragraph', ...(lang ? { attrs: { lang } } : {}), content: [{ type: 'text', text }] }] }],
});
const doc = {
  type: 'doc',
  content: [
    box({ width: 200, height: 100 }, 'frame'),
    box({ width: 200, height: 100, shapeKind: 'ellipse' }, 'shape'),
    box({ width: 200, height: 100, shapeKind: 'ellipse' }, 'own', 'fr-FR'),
  ],
};

const styleOf = (content: string, text: string) =>
  new RegExp(`text:style-name="([^"]+)">${text}<`).exec(content)?.[1] ?? '';
const langOf = (content: string, name: string) =>
  new RegExp(`style:name="${name}"[^>]*>(?:(?!</style:style>).)*?fo:language="([^"]+)" fo:country="([^"]+)"`, 's')
    .exec(content)?.slice(1).join('-') ?? '';

describe('the language of a shape\'s text', () => {
  it('spells the document language out, and leaves a block\'s own alone', async () => {
    const bytes = await buildOdt(doc as never, undefined, 'portrait', undefined, { language: 'de', country: 'DE' });
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    expect(langOf(content, styleOf(content, 'shape'))).toBe('de-DE');
    expect(langOf(content, styleOf(content, 'own'))).toBe('fr-FR');
    // A frame's text inherits it from Standard, as any other paragraph does.
    expect(styleOf(content, 'frame')).toBe('Standard');
  });

  it('writes none where the document declares none', async () => {
    const bytes = await buildOdt(doc as never, undefined, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    expect(styleOf(content, 'shape')).toBe('Standard');
  });
});
