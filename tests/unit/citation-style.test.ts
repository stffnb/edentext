// The four common citation shapes, plus LibreOffice's own "cite by short name". A field
// the source has not got takes its separator with it, so no row ends in a stray comma.
import { describe, it, expect } from 'vitest';
import { formatBibRow, citationLabel, citationStyleFromTemplate, rowTemplate } from '../../src/lib/utils/citationStyle';

const book = {
  identifier: 'knuth74',
  fields: { author: 'Knuth, Donald E.', title: 'Structured Programming', year: '1974', publisher: 'ACM', address: 'New York' },
};

describe('citation styles', () => {
  it('prints a row per style', () => {
    expect(formatBibRow(book, 'key')).toBe('knuth74: Knuth, Donald E., Structured Programming, 1974');
    expect(formatBibRow(book, 'apa')).toBe('Knuth, Donald E. (1974). Structured Programming. ACM.');
    expect(formatBibRow(book, 'mla')).toBe('Knuth, Donald E.. Structured Programming. ACM, 1974.');
    expect(formatBibRow(book, 'chicago')).toBe('Knuth, Donald E.. Structured Programming. New York: ACM, 1974.');
    expect(formatBibRow(book, 'numbered', 3)).toBe('[3] Knuth, Donald E., Structured Programming, 1974');
  });

  it('drops a missing field with its separator', () => {
    const noAuthor = { identifier: 'X', fields: { title: 'Just a title' } };
    expect(formatBibRow(noAuthor, 'key')).toBe('X: Just a title');
    const noYear = { identifier: 'Y', fields: { author: 'Ada', title: 'T', publisher: 'P' } };
    expect(formatBibRow(noYear, 'apa')).toBe('Ada. T. P.');
    expect(formatBibRow({ identifier: 'Z', fields: {} }, 'apa')).toBe('Z');
  });

  it('names the source the way each style cites it', () => {
    expect(citationLabel(book, 'key')).toBe('[knuth74]');
    expect(citationLabel(book, 'numbered', 2)).toBe('[2]');
    expect(citationLabel(book, 'apa')).toBe('(Knuth, 1974)');
    expect(citationLabel(book, 'mla')).toBe('(Knuth)');
    expect(citationLabel(book, 'chicago')).toBe('(Knuth 1974)');
    // Several authors are cited by the first plus et al., as all three styles do.
    expect(citationLabel({ identifier: 'q', fields: { author: 'Ada Lovelace; Alan Turing', year: '1936' } }, 'apa'))
      .toBe('(Lovelace et al., 1936)');
  });

  it('reads a style back off its ODF entry template', () => {
    for (const style of ['key', 'apa', 'mla', 'chicago'] as const) {
      const fields = rowTemplate(style).filter((t) => 'field' in t).map((t) => (t as { field: string }).field);
      expect(citationStyleFromTemplate(fields)).toBe(style);
    }
    expect(citationStyleFromTemplate(['title'])).toBe(null);
  });
});

// The style rides the bibliography index, which is where both formats keep it: ODF as
// the entry template it regenerates its rows from, Word as the sources part's StyleName.
describe('citation style round trip', () => {
  it('survives ODF and DOCX', async () => {
    const { buildOdt } = await import('../../src/lib/export/odt');
    const { buildDocx } = await import('../../src/lib/export/docx');
    const { importOdt } = await import('../../src/lib/import/odt');
    const { importDocx } = await import('../../src/lib/import/docx');
    const { unzipSync, strFromU8 } = await import('fflate');

    const cite = (id: string): any => ({
      type: 'bibliographyEntry',
      attrs: { identifier: id, type: 'book', fields: { author: 'Ada Lovelace', title: 'Notes', year: '1843' }, text: '(Lovelace, 1843)' },
    });
    const doc: any = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'As shown ' }, cite('lovelace43')] },
        { type: 'tableOfContents', attrs: { index: 'bibliography', citationStyle: 'apa', title: 'Bibliography', entries: [] } },
      ],
    };
    const margins = { top: 2, bottom: 2, left: 2, right: 2 };

    const odt = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(odt)['content.xml']);
    expect(xml).toContain('text:bibliography-data-field="publisher"');
    const backOdt = importOdt(odt).content as any;
    expect(backOdt.content.at(-1).attrs.citationStyle).toBe('apa');

    const docx = await buildDocx(doc, margins, 'portrait');
    expect(strFromU8(unzipSync(docx)['customXml/item1.xml'])).toContain('StyleName="APA"');
    const backDocx = importDocx(docx).content as any;
    expect(backDocx.content.at(-1).attrs.citationStyle).toBe('apa');
  });
});
