// ODF style:may-break-between-rows="false": the table moves whole rather than break.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';

type N = any;

const cell = (text: string): N => ({
  type: 'tableCell',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const table = (attrs: N): N => ({
  type: 'table',
  attrs,
  content: [0, 1].map((r) => ({ type: 'tableRow', content: [cell(`a${r}`), cell(`b${r}`)] })),
});

describe('table keep-rows', () => {
  it('round-trips style:may-break-between-rows', async () => {
    const doc: N = { type: 'doc', content: [table({ keepRows: true })] };
    const bytes = await buildOdt(doc, undefined, 'portrait');
    expect(strFromU8(unzipSync(bytes)['content.xml'])).toContain('style:may-break-between-rows="false"');
    expect(importOdt(bytes).content.content?.[0]?.attrs?.keepRows).toBe(true);
  });

  it('leaves a table that may break without the attribute', async () => {
    const doc: N = { type: 'doc', content: [table({})] };
    const bytes = await buildOdt(doc, undefined, 'portrait');
    expect(strFromU8(unzipSync(bytes)['content.xml'])).not.toContain('may-break-between-rows');
    expect(importOdt(bytes).content.content?.[0]?.attrs?.keepRows ?? null).toBe(null);
  });
});
