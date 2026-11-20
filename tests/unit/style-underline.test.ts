// A run looking different from the style it sits under: both importers suppress a run
// that only repeats its style, and what differs rides along with it.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import { docxOf, roundTrips } from '../docxFixture';

const sheet = builtinStyleSheet();
sheet.paragraph['Unterstrichen'] = {
  name: 'Unterstrichen', parent: 'Standard', next: 'Standard', para: {}, text: { underline: true },
};

const doc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: { styleName: 'Unterstrichen' },
    content: [
      { type: 'text', text: 'rot', marks: [{ type: 'underline', attrs: { lineColor: '#FF0000' } }] },
      { type: 'text', text: 'wellig', marks: [{ type: 'underline', attrs: { lineStyle: 'wavy' } }] },
      { type: 'text', text: 'wie der Stil', marks: [{ type: 'underline' }] },
    ],
  }],
} as any;

const runs = (n: any) => n.content[0].content.map((c: any) => c.marks?.find((m: any) => m.type === 'underline')?.attrs ?? null);

describe.each([
  ['odt', async () => importOdt(await buildOdt(doc, undefined, undefined, undefined, undefined, undefined, sheet)).content],
  ['docx', async () => importDocx(await buildDocx(doc, undefined, undefined, undefined, undefined, undefined, sheet)).content],
] as const)('a run under an underlining style (%s)', (_fmt, read) => {
  it('keeps its own colour and shape, and drops what the style already draws', async () => {
    expect(runs(await read())).toEqual([{ lineColor: '#FF0000' }, { lineStyle: 'wavy' }, null]);
  });
});

// A run opting out of its style's colour or italic (w:color auto, w:i 0; ODF
// use-window-font-color, fo:font-style normal) stays out through both formats.
describe('a run opting out of its style', () => {
  const styles = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Lilac"><w:name w:val="Lilac"/><w:basedOn w:val="Normal"/>'
    + '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:i/><w:color w:val="592C82"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="Plain"><w:name w:val="Plain"/><w:rPr><w:color w:val="auto"/></w:rPr></w:style>'
    + '<w:style w:type="character" w:styleId="Code"><w:name w:val="Code"/><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/></w:rPr></w:style>';
  const font = (f: string) => `<w:rFonts w:ascii="${f}" w:hAnsi="${f}"/>`;
  const run = (rPr: string, text: string) => `<w:r><w:rPr>${rPr}</w:rPr><w:t>${text}</w:t></w:r>`;
  const src = importDocx(docxOf(`<w:p><w:pPr><w:pStyle w:val="Lilac"/></w:pPr>${run('<w:color w:val="auto"/><w:i w:val="0"/>', 'a')}`
    + `${run('', 'b')}${run('<w:rStyle w:val="Plain"/>', 'c')}`
    + `${run(`<w:rStyle w:val="Code"/>${font('Arial')}`, 'd')}${run(font('Times New Roman'), 'e')}</w:p>`, { styles }));
  const looks = (doc: any) => doc.content[0].content.map((c: any) => {
    const ts = c.marks?.find((m: any) => m.type === 'textStyle')?.attrs ?? {};
    return [ts.color ?? null, ts.fontStyle ?? null, c.marks?.find((m: any) => m.type === 'charStyle')?.attrs.name ?? null, ts.fontFamily ?? null];
  });
  // d leaves its character style's font for the paragraph's, e the paragraph's for the default.
  const want = [['auto', 'normal', null, null], [null, null, null, null], [null, null, 'Plain', null],
    [null, null, 'Code', 'Arial'], [null, null, null, 'Times New Roman']];

  it('reads it, and the character style keeps the automatic colour', () => {
    expect(looks(src.content)).toEqual(want);
    expect(src.styles.character.Plain.text.color).toBe('auto');
  });

  it('writes it back out in both formats', async () => {
    for (const back of await roundTrips(src.content, src.styles)) expect(looks(back)).toEqual(want);
  });
});
