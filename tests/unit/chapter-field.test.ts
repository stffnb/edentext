// The running head's chapter field: ODF <text:chapter>, Word STYLEREF. Both keep the
// outline level; the shown name is resolved per page by utils/chapterField.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { chapterOn, type ChapterStart } from '../../src/lib/utils/chapterField';

type N = any;

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const footer: N = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'chapterField', attrs: { level: 1, text: 'Cached chapter' } },
  { type: 'text', text: ' — ' },
  { type: 'pageNumber' },
] }] };
const doc: N = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Cached chapter' }] },
] };
const hf = {
  header: null, footer, headerFirst: null, footerFirst: null, differentFirstPage: false,
  headerEven: null, footerEven: null, differentOddEven: false, sections: [], pageCount: 1,
};
const fieldOf = (d: any) => d?.content?.[0]?.content?.find((n: any) => n.type === 'chapterField');

describe('chapter field', () => {
  it('round-trips through ODF as text:chapter', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait', hf);
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);
    expect(styles).toContain('<text:chapter text:display="name" text:outline-level="1">Cached chapter</text:chapter>');

    const back = await importOdt(bytes);
    expect(fieldOf(back.footer)).toEqual({ type: 'chapterField', attrs: { level: 1, text: 'Cached chapter' } });
  });

  it('round-trips through DOCX as a STYLEREF field', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait', hf);
    // The numeric form (outline level) — Word resolves a quoted style name against the
    // localized name, so "Heading 1" errors in any non-English Word.
    const ftr = strFromU8(unzipSync(bytes)['word/footer1.xml']);
    expect(ftr).toContain('w:instr="STYLEREF 1 \\* MERGEFORMAT"');
    const back = importDocx(bytes);
    // Word caches the shown name in the field result, which the import drops — the
    // level is what the live field needs.
    expect(fieldOf(back.footer)?.attrs?.level).toBe(1);
  });
});

const CS = (page: number, level: number, text: string, atTop = false): ChapterStart =>
  ({ page, level, text, atTop });

// LibreOffice's text:chapter, probed: the header reads the page top, the footer the
// last chapter begun on the page; a heading only tops a page it opens itself.
describe('chapter field resolution', () => {
  const starts = [CS(1, 1, 'Intro', true), CS(2, 1, 'Tables'), CS(2, 1, 'Frames'), CS(4, 1, 'Notes', true)];

  it('header shows the chapter in force at the page top', () => {
    expect(chapterOn(starts, 2, 1, 'header')).toBe('Intro');
    expect(chapterOn(starts, 3, 1, 'header')).toBe('Frames');
    expect(chapterOn(starts, 4, 1, 'header')).toBe('Notes');
  });

  it('footer shows the last chapter begun on the page', () => {
    expect(chapterOn(starts, 1, 1, 'footer')).toBe('Intro');
    expect(chapterOn(starts, 2, 1, 'footer')).toBe('Frames');
    expect(chapterOn(starts, 3, 1, 'footer')).toBe('Frames');
  });

  it('is empty on pages before the first chapter', () => {
    expect(chapterOn([CS(2, 1, 'Late')], 1, 1, 'footer')).toBe('');
    expect(chapterOn([CS(2, 1, 'Late')], 2, 1, 'header')).toBe('');
  });

  it('a level-N field follows headings of level N and above only', () => {
    const mixed = [CS(1, 1, 'Part', true), CS(1, 2, 'Section'), CS(1, 3, 'Sub')];
    expect(chapterOn(mixed, 1, 1, 'footer')).toBe('Part');
    expect(chapterOn(mixed, 1, 2, 'footer')).toBe('Section');
    expect(chapterOn(mixed, 1, 3, 'footer')).toBe('Sub');
    expect(chapterOn(mixed, 2, 1, 'header')).toBe('Part');
  });
});
