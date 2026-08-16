// Word's horizontal line is a VML rect (o:hr) in a paragraph of its own; the editor
// draws it as that paragraph's bottom rule instead of dropping it as a shape.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';

const doc = (body: string) => zipSync({
  'word/document.xml': strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:o="urn:schemas-microsoft-com:office:office">
  <w:body>${body}</w:body>
</w:document>`),
});

const HR = '<w:p><w:r><w:pict><v:rect id="_x0000_i1025" style="width:0;height:1.5pt"'
  + ' o:hralign="center" o:hr="t" fillcolor="#a0a0a0" stroked="f"/></w:pict></w:r></w:p>';

describe('DOCX horizontal line', () => {
  it('becomes the paragraph bottom rule, with no warning', () => {
    const res = importDocx(doc(`<w:p><w:r><w:t>Text</w:t></w:r></w:p>${HR}`));
    const rule = res.content.content[1];
    expect(rule.attrs.borderBottom).toBe('1.5pt solid #A0A0A0');
    expect([...res.warnings]).not.toContain('Drawings were removed');
  });

  it('leaves a real w:pBdr bottom border alone', () => {
    const bdr = '<w:pPr><w:pBdr><w:bottom w:val="single" w:sz="24" w:color="FF0000"/></w:pBdr></w:pPr>';
    const res = importDocx(doc(HR.replace('<w:r>', `${bdr}<w:r>`)));
    expect(res.content.content[0].attrs.borderBottom).toBe('3pt solid #FF0000');
  });
});
