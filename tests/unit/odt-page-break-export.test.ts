import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';

// A document odf-kit mints no automatic style for carries `<office:automatic-styles/>`,
// self-closed — replacing the closing tag silently dropped every minted style there,
// so a manual page break exported as a plain paragraph.
const doc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
    { type: 'paragraph', attrs: { breakBefore: 'page' }, content: [{ type: 'text', text: 'two' }] },
  ],
};

describe('ODF page break export', () => {
  it('mints the break style even with no automatic styles section', async () => {
    const bytes = await buildOdt(doc as never, undefined, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    const name = /style:name="(PB\d+)"[^>]*>\s*<style:paragraph-properties fo:break-before="page"/.exec(content)?.[1];
    expect(name).toBeTruthy();
    expect(content).toContain(`<text:p text:style-name="${name}">two`);
  });
});
