// Recording revisions is a property of the document, not of the editor: ODF keeps it on
// the change registry (text:track-changes), Word in settings.xml (w:trackRevisions) —
// both probed against soffice, which writes and reads exactly these two.
import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';
import { DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';

type N = any;

const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ein Satz.' }] }] };
const m = DEFAULT_MARGINS;
// Everything up to the flag is the exporters' own default, so only the last one varies.
const args = (on: boolean) =>
  [m, 'portrait', undefined, null, 'A4', undefined, undefined, 'add', false, undefined, undefined,
    false, undefined, undefined, undefined, on] as const;

describe('recording revisions survives both round trips', () => {
  it('ODT: the registry carries the flag, with no change in it', async () => {
    const on = await buildOdt(doc, ...args(true));
    const content = strFromU8(unzipSync(on)['content.xml']);
    expect(content).toContain('<text:tracked-changes text:track-changes="true">');
    expect(importOdt(on).recordChanges).toBe(true);

    const off = await buildOdt(doc, ...args(false));
    expect(strFromU8(unzipSync(off)['content.xml'])).not.toContain('text:tracked-changes');
    expect(importOdt(off).recordChanges).toBe(false);
  });

  it('DOCX: w:trackRevisions in settings.xml', async () => {
    const on = await buildDocx(doc, ...args(true));
    expect(strFromU8(unzipSync(on)['word/settings.xml'])).toContain('<w:trackRevisions');
    expect(importDocx(on).recordChanges).toBe(true);

    const off = await buildDocx(doc, ...args(false));
    expect(strFromU8(unzipSync(off)['word/settings.xml'])).not.toContain('<w:trackRevisions');
    expect(importDocx(off).recordChanges).toBe(false);
  });

  it('a registry with no flag records, as ODF defaults it to true', async () => {
    // What another producer may write: the element is there, the attribute is not.
    const files = unzipSync(await buildOdt(doc, ...args(true)));
    files['content.xml'] = strToU8(strFromU8(files['content.xml']).replace(' text:track-changes="true"', ''));
    expect(importOdt(zipSync(files)).recordChanges).toBe(true);
  });
});
