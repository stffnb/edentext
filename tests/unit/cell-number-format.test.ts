// A formula cell's own number format. ODF keeps it on the cell's style as a reference
// to a data style; Word on the field, as its `\#` switch.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { CELL_FORMATS, cellFormatCode, cellFormatFromCode, formatCellValue } from '../../src/lib/utils/cellFormat';
import en from '../../src/lib/i18n/locales/en';
import de from '../../src/lib/i18n/locales/de';

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
    expect(xml).toContain('<number:number-style style:name="Ncell1" number:language="en">');
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

// The currency and the date are the document language's own: the symbol where the
// locale puts it, the short date in the locale's order and padding.
describe('the currency and date formats', () => {
  const DE = { language: 'de', country: 'DE' };
  const cellDoc = (format: string): N => ({
    type: 'doc',
    content: [{
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('1234.5')] },
        { type: 'tableRow', content: [cell('x', { formula: 'SUM(ABOVE)', cellFormat: format })] },
      ],
    }],
  });

  it('prints the value in the locale that names the format', () => {
    expect(formatCellValue(1234.5, 'currency', EN, 'en-US')).toBe('$1,234.50');
    expect(formatCellValue(1234.5, 'currency', EN, 'de-DE')).toMatch(/^1\.234,50.€$/);
    // LibreOffice's day 0 is 1899-12-30, so 45000 is 15 March 2023 (probed).
    expect(formatCellValue(45000, 'date', EN, 'en-US')).toBe('3/15/23');
    expect(formatCellValue(45000, 'date', EN, 'de-DE')).toBe('15.03.23');
    // A number no calendar reaches stays a number.
    expect(formatCellValue(1e12, 'date', EN, 'en-US')).toBe('1000000000000');
  });

  it('shows a sample of every format in both UI languages', () => {
    for (const l of [en, de]) for (const f of CELL_FORMATS) expect(l.table.numberFormats[f]).toBeTruthy();
  });

  it('writes the picture switch each locale spells', () => {
    expect(cellFormatCode('currency', 'en-US')).toBe('$#,##0.00');
    expect(cellFormatCode('currency', 'de-DE')).toMatch(/^#,##0\.00.€$/);
    expect(cellFormatCode('date', 'en-US')).toBe('M/d/yy');
    expect(cellFormatCode('date', 'de-DE')).toBe('dd.MM.yy');
    expect(cellFormatFromCode('$#,##0.00')).toBe('currency');
    expect(cellFormatFromCode('dd.MM.yy')).toBe('date');
  });

  it('round-trips a currency through both formats', async () => {
    const odt = await buildOdt(cellDoc('currency'), margins, 'portrait', undefined, { language: 'en', country: 'US' });
    const xml = strFromU8(unzipSync(odt)['content.xml']);
    // The style names the document's language, so LibreOffice prints the same
    // separators and symbol the editor does (probed).
    expect(xml).toContain('<number:currency-style style:name="Ncell1" number:language="en" number:country="US">');
    expect(xml).toContain('<number:currency-symbol number:language="en" number:country="US">$</number:currency-symbol>');
    expect(formulaCell(importOdt(odt)).attrs.cellFormat).toBe('currency');

    const docx = await buildDocx(cellDoc('currency'), margins, 'portrait');
    expect(strFromU8(unzipSync(docx)['word/document.xml'])).toContain('\\# &quot;$#,##0.00&quot;');
    expect(formulaCell(importDocx(docx)).attrs.cellFormat).toBe('currency');
  });

  it('round-trips a date through both formats', async () => {
    const odt = await buildOdt(cellDoc('date'), margins, 'portrait', undefined, DE);
    const xml = strFromU8(unzipSync(odt)['content.xml']);
    expect(xml).toContain('<number:date-style style:name="Ncell1" number:language="de" number:country="DE">'
      + '<number:day number:style="long"/><number:text>.</number:text>'
      + '<number:month number:style="long"/><number:text>.</number:text>'
      + '<number:year/></number:date-style>');
    expect(formulaCell(importOdt(odt)).attrs.cellFormat).toBe('date');

    const docx = await buildDocx(cellDoc('date'), margins, 'portrait', undefined, DE);
    expect(strFromU8(unzipSync(docx)['word/document.xml'])).toContain('\\@ &quot;dd.MM.yy&quot;');
    expect(formulaCell(importDocx(docx)).attrs.cellFormat).toBe('date');
  });
});
