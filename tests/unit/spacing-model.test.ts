import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';

// LibreOffice adds the space below a block to the space above the next one, but takes
// only the larger of the two for a Word document — probed against soffice, and carried
// per document in settings.xml (AddParaTableSpacing).
const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };

describe('paragraph spacing model', () => {
  it('round-trips the model through the ODF export', async () => {
    const max = await buildOdt(doc as never, undefined, 'portrait', undefined, null, 'A4', undefined, undefined, 'max');
    expect(strFromU8(unzipSync(max)['settings.xml'])).toContain('"AddParaTableSpacing" config:type="boolean">false<');
    expect(importOdt(max).spacingModel).toBe('max');

    // A file that says nothing gets LibreOffice's own default, which is to add them.
    const add = await buildOdt(doc as never, undefined, 'portrait');
    expect(strFromU8(unzipSync(add)['settings.xml'])).not.toContain('AddParaTableSpacing');
    expect(importOdt(add).spacingModel).toBe('add');
  });
});
