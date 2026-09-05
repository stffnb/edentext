// A document whose first master page carries no header at all: the watermark and the fold
// marks mint one, and a section break puts a second master page after it.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { EMPTY_PAGE_DECOR, DEFAULT_WATERMARK } from '../../src/lib/storage/pageDecor';

const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
    { type: 'paragraph', attrs: { sectionBreak: true, breakBefore: 'page' }, content: [{ type: 'text', text: 'two' }] },
  ],
} as any;

// The first section has no zone of its own and the second does, so the first master page
// is written self-closing while the second carries a header.
const hf = {
  header: null, footer: null, pageCount: 2,
  sections: [{ header: null, footer: null },
    { header: { type: 'paragraph', content: [{ type: 'text', text: 'zwei' }] }, footer: null }],
} as never;

const build = (decor: unknown, foldMarks = false) => buildOdt(doc, undefined, undefined, hf, undefined,
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  decor as never, undefined, undefined, foldMarks);

describe('page decor across a section break', () => {
  const watermark = { ...DEFAULT_WATERMARK, text: 'DRAFT', angle: 135 };

  it('reads the watermark back off the first page', async () => {
    const res = importOdt(await build({ ...EMPTY_PAGE_DECOR, watermark }));
    expect(res.decor.watermark).toEqual(watermark);
  });

  it('gives every master page the shape', async () => {
    const res = importOdt(await build({ ...EMPTY_PAGE_DECOR, watermark }, true));
    expect(res.decor.watermark?.text).toBe('DRAFT');
    expect(res.foldMarks).toBe(true);
  });
});
