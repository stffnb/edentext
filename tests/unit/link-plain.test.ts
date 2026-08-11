import { describe, it, expect } from 'vitest';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';

// Word paints a hyperlink through its Hyperlink character style, so a run carrying none
// is drawn like the text around it. `plain` carries that; ODF links are never plain
// (LibreOffice paints every text:a — probed).
type N = { type: string; attrs?: any; content?: N[]; marks?: any[]; text?: string };

function texts(node: N, out: N[] = []): N[] {
  if (node.type === 'text') out.push(node);
  for (const c of node.content ?? []) texts(c, out);
  return out;
}

describe('an editor link round-trips as an editor link', () => {
  it('keeps its blue through DOCX', async () => {
    const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
    ] }] };
    const bytes = await buildDocx(doc as any, { top: 2, bottom: 2, left: 2, right: 2 }, 'portrait');
    const back = importDocx(bytes).content as unknown as N;
    const link = texts(back)[0]?.marks?.find((m: any) => m.type === 'link');
    expect(link?.attrs.href).toBe('https://example.com');
    expect(link?.attrs.plain).toBe(false);
  });
});
