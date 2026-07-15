import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';

// The editor renders no paragraph spacing (editor.css), like LibreOffice and Word. odf-kit's
// Standard style carries 0.212cm, which every paragraph and list item inherits — so the
// export must zero it, or LibreOffice shows ~6pt per block that the preview never had.
describe('exported Standard style', () => {
  it('has no bottom margin, so the export matches the preview', async () => {
    const json = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }] }],
        },
      ],
    };
    const bytes = await buildOdt(json as never, DEFAULT_MARGINS, 'portrait');
    const styles = strFromU8(unzipSync(bytes)['styles.xml']);

    const standard = styles.match(/<style:style style:name="Standard"[\s\S]*?<\/style:style>/)![0];
    expect(standard).toContain('fo:margin-bottom="0cm"');
    expect(standard).not.toContain('0.212cm');
  });
});
