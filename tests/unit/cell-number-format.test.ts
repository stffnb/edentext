// A formula cell's own number format. ODF keeps it on the cell's style as a reference
// to a data style; Word on the field, as its `\#` switch.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { formatCellValue } from '../../src/lib/utils/cellFormat';

type N = any;

const EN = { decimal: '.', group: ',' };
const cell = (text: string, attrs: N = {}): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const doc: N = {
  type: 'doc',
  content: [{
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('1234.5')] },
      { type: 'tableRow', content: [cell('1,234.50', { formula: 'SUM(ABOVE)', cellFormat: 'group2' })] },
    ],
  }],
};
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

const formulaCell = (r: N): N => {
  const table = (r.content as N).content.find((n: N) => n.type === 'table');
  return table.content[1].content[0];
};

describe('a cell number format', () => {
  it('prints the value the way the format says', () => {
    expect(formatCellValue(1234.5, 'general', EN, 'en')).toBe('1234.5');
    expect(formatCellValue(1234.5, 'int', EN, 'en')).toBe('1235');
    expect(formatCellValue(1234.5, 'dec2', EN, 'en')).toBe('1234.50');
    expect(formatCellValue(1234.5, 'group2', EN, 'en')).toBe('1,234.50');
    expect(formatCellValue(0.125, 'percent', EN, 'en')).toBe('13%');
    expect(formatCellValue(0.125, 'percent2', EN, 'en')).toBe('12.50%');
  });

  it('round-trips through ODF', async () => {
    const bytes = await buildOdt(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['content.xml']);
    expect(xml).toContain('<number:number-style style:name="Ncell1">');
    expect(xml).toContain('number:decimal-places="2"');
    expect(xml).toContain('number:grouping="true"');
    expect(xml).toContain('style:data-style-name="Ncell1"');
    const back = formulaCell(importOdt(bytes));
    // ODF has no ABOVE: the export resolves it to the range it covers.
    expect(back.attrs.formula).toBe('SUM(A1)');
    expect(back.attrs.cellFormat).toBe('group2');
  });

  it('round-trips through DOCX', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('=SUM(ABOVE) \\# &quot;#,##0.00&quot;');
    const back = formulaCell(importDocx(bytes));
    expect(back.attrs.formula).toBe('SUM(ABOVE)');
    expect(back.attrs.cellFormat).toBe('group2');
  });

  it('leaves a cell in the general format alone', async () => {
    const plain: N = { ...doc, content: [{ ...doc.content[0], content: [
      doc.content[0].content[0],
      { type: 'tableRow', content: [cell('1234.5', { formula: 'SUM(ABOVE)' })] },
    ] }] };
    const xml = strFromU8(unzipSync(await buildOdt(plain, margins, 'portrait'))['content.xml']);
    expect(xml).not.toContain('style:data-style-name');
    const docxXml = strFromU8(unzipSync(await buildDocx(plain, margins, 'portrait'))['word/document.xml']);
    expect(docxXml).toContain('=SUM(ABOVE)');
    expect(docxXml).not.toContain('\\#');
  });
});
