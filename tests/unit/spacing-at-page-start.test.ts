// LibreOffice's "add spacing at the beginning of pages" (ODF AddParaTableSpacingAtStart,
// Word's w:suppressSpBfAfterPgBrk): off, the block opening a page loses its space above.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';

type N = any;
const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const args = [margins, 'portrait' as const, undefined, null, 'A4' as const] as const;

describe('spacing at the start of a page', () => {
  it('is on unless the file turns it off', async () => {
    const on = await buildOdt(doc, ...args);
    expect(strFromU8(unzipSync(on)['settings.xml'] ?? new Uint8Array())).not.toContain('AddParaTableSpacingAtStart');
    expect(importOdt(on).spacingAtPageStart).toBe(true);
    expect(importDocx(await buildDocx(doc, ...args)).spacingAtPageStart).toBe(true);
  });

  it('rides both formats when it is off', async () => {
    const rest = [undefined, undefined, 'add' as const, false, undefined, undefined, false,
      undefined, undefined, undefined, false, false, false] as const;
    const odt = await buildOdt(doc, ...args, ...rest);
    expect(strFromU8(unzipSync(odt)['settings.xml'])).toContain('AddParaTableSpacingAtStart');
    expect(importOdt(odt).spacingAtPageStart).toBe(false);

    const docx = await buildDocx(doc, ...args, ...rest);
    expect(strFromU8(unzipSync(docx)['word/settings.xml'])).toContain('<w:suppressSpBfAfterPgBrk/>');
    expect(importDocx(docx).spacingAtPageStart).toBe(false);
  });
});
