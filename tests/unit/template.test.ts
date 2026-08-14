import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { odtToOtt, docxToDotx } from '../../src/lib/export/template';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const doc: any = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Vorlage' }] }] };

describe('saving as a template', () => {
  it('.ott relabels the package and keeps the mimetype entry first', async () => {
    const ott = odtToOtt(await buildOdt(doc, margins as any, 'portrait'));
    const files = unzipSync(ott);
    expect(strFromU8(files['mimetype'])).toBe('application/vnd.oasis.opendocument.text-template');
    expect(Object.keys(files)[0]).toBe('mimetype');
    expect(strFromU8(files['META-INF/manifest.xml'])).toContain(
      'manifest:media-type="application/vnd.oasis.opendocument.text-template"');
    // The mimetype entry must be stored, not deflated: the local header's
    // compression-method field sits at offset 8.
    expect(ott[8] | (ott[9] << 8)).toBe(0);
    expect(importOdt(ott).content.content?.[0].content?.[0].text).toBe('Vorlage');
  });

  it('.dotx relabels the document part', async () => {
    const dotx = docxToDotx(await buildDocx(doc, margins as any, 'portrait'));
    const ct = strFromU8(unzipSync(dotx)['[Content_Types].xml']);
    expect(ct).toContain('wordprocessingml.template.main+xml');
    expect(ct).not.toContain('wordprocessingml.document.main+xml');
    expect(importDocx(dotx).content.content?.[0].content?.[0].text).toBe('Vorlage');
  });
});
