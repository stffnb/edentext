// A picture inside a note: the docx package writes the drawing into footnotes.xml and
// endnotes.xml but registers the media for the footnotes part only.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';
const img = { type: 'image', attrs: { src: PNG, width: 40, height: 30 } };
const doc = (kind: 'footnote' | 'endnote') => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'noteRef', attrs: { id: 'n1', kind, text: '1' } }] },
    { type: 'noteSection', content: [{ type: 'note', attrs: { id: 'n1', kind, text: '1' }, content: [{ type: 'text', text: 'x' }, img] }] },
  ],
}) as any;

describe.each(['footnote', 'endnote'] as const)('a picture in a %s', (kind) => {
  it('is written with a relationship of its own', async () => {
    const part = `word/${kind}s.xml`;
    const files = unzipSync(await buildDocx(doc(kind)));
    const rels = strFromU8(files[`word/_rels/${kind}s.xml.rels`] ?? new Uint8Array());
    const id = /r:embed="([^"]+)"/.exec(strFromU8(files[part]))?.[1] ?? '';
    expect(id).toMatch(/^rId\d+$/);
    expect(rels).toContain(`Id="${id}"`);
    expect(rels).toContain('media/');
  });

  it('reads back as the picture, not the placeholder', async () => {
    const bytes = await buildDocx(doc(kind));
    const back = JSON.stringify(importDocx(bytes).content);
    expect(back).toContain('data:image/png');
  });
});
