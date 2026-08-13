// A cell paragraph that names no style takes LibreOffice's Table Contents spacing (zero),
// not the default style's — else the space fills the cell and vertical alignment has no
// slack. Word documents ('max') keep the inheritance, as Word itself does.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { builtinStyleSheet, DEFAULT_STYLE } from '../../src/lib/styles/styleSheet';

type N = any;

const doc: N = {
  type: 'doc',
  content: [
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200] },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] },
    ] }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
  ],
};

function sheetWithSpacing(pt: number) {
  const sheet = builtinStyleSheet();
  sheet.paragraph[DEFAULT_STYLE].para = { spaceBefore: 0, spaceAfter: pt };
  return sheet;
}

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const cellPara = (odt: Uint8Array) => {
  const content = strFromU8(unzipSync(odt)['content.xml']);
  const name = /<table:table-cell\b[^>]*>\s*<text:p text:style-name="([^"]+)"/.exec(content)?.[1] ?? '';
  return { name, style: new RegExp(`<style:style style:name="${name}"[^>]*>.*?</style:style>`).exec(content)?.[0] ?? '' };
};

describe('paragraph spacing inside a table cell', () => {
  it('ODF: the default style\'s space-after is zeroed on the cell paragraph', async () => {
    const { style } = cellPara(await buildOdt(doc, margins, 'portrait', undefined, null, 'A4', sheetWithSpacing(12)));
    expect(style).toContain('fo:margin-bottom="0pt"');
    expect(style).toContain('fo:margin-top="0pt"');
  });

  it('ODF: a document without default spacing keeps the cell paragraph bare', async () => {
    const { name, style } = cellPara(await buildOdt(doc, margins, 'portrait', undefined, null, 'A4', builtinStyleSheet()));
    expect(name).toBe('Standard');
    expect(style).toBe('');
  });

  it('ODF: a Word document zeroes the space below only', async () => {
    const { style } = cellPara(await buildOdt(doc, margins, 'portrait', undefined, null, 'A4', sheetWithSpacing(12), 1.25, 'max'));
    expect(style).toContain('fo:margin-bottom="0pt"');
    expect(style).not.toContain('fo:margin-top');
  });

  it('DOCX: the cell paragraph carries w:spacing 0, the body paragraph does not', async () => {
    const bytes = await buildDocx(doc, margins, 'portrait', undefined, null, 'A4', sheetWithSpacing(12), 1.25, 'max');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    const cellP = /<w:tc>.*?<w:p>(.*?)<\/w:p>/.exec(xml)?.[1] ?? '';
    expect(cellP).toContain('w:after="0"');
    expect(xml.slice(xml.indexOf('</w:tbl>'))).not.toContain('w:after="0"');
  });
});
