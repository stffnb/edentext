import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';

// A style carries western, asian and complex-script fonts side by side; text in a
// complex script is set from the -complex ones. Probed against LibreOffice: a Hebrew
// paragraph whose style declares only style:font-size-complex="16pt" is set at 16pt.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

const HEBREW = 'אֵ֣לֶּה הַדְּבָרִ֗ים';

function odt(): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}>
   <office:font-face-decls>
    <style:font-face style:name="Taamey D" svg:font-family="'Taamey D'"/>
   </office:font-face-decls><office:styles>
   <style:default-style style:family="paragraph">
    <style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"
     style:font-size-complex="12pt"/>
   </style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Chapter" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties style:font-size-complex="16pt" style:font-name-complex="Taamey D"/>
   </style:style>
  </office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
   <text:p text:style-name="Chapter">${HEBREW}<text:span>verse 2</text:span></text:p>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

type Run = { text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
const runs = (doc: { content?: { content?: Run[] }[] }) => doc.content?.[0].content ?? [];
const textStyle = (r: Run) => r.marks?.find((m) => m.type === 'textStyle')?.attrs ?? {};

describe('complex-script run properties', () => {
  it('sets a Hebrew run from the -complex font and size, a Latin one from the western', () => {
    const [hebrew, latin] = runs(importOdt(odt()).content);
    expect(textStyle(hebrew)).toMatchObject({ fontSize: '16pt', fontFamily: 'Taamey D' });
    // The style leaves the western pair at the default, so the Latin run takes no mark.
    expect(latin.text).toBe('verse 2');
    expect(textStyle(latin).fontSize).toBeUndefined();
    expect(textStyle(latin).fontFamily).toBeUndefined();
  });

  it('keeps the size through an export and back', async () => {
    const doc = importOdt(odt()).content;
    const again = importOdt(await buildOdt(doc as never));
    expect(textStyle(runs(again.content)[0])).toMatchObject({ fontSize: '16pt', fontFamily: 'Taamey D' });
  });
});
