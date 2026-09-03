import { describe, it, expect } from 'vitest';
import { importDocx } from '../../src/lib/import/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { buildOdt } from '../../src/lib/export/odt';

// A file can carry any href; one with a scheme the editor would never open is read as
// plain text, so the boundary is the import and not a render-time guard.
type N = { type: string; attrs?: any; content?: N[]; marks?: any[]; text?: string };

function links(node: N, out: string[] = []): string[] {
  for (const m of node.marks ?? []) if (m.type === 'link') out.push(m.attrs.href);
  for (const c of node.content ?? []) links(c, out);
  return out;
}

const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'run', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
  { type: 'text', text: ' site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
  { type: 'text', text: ' here', marks: [{ type: 'link', attrs: { href: '#top' } }] },
] }] };
const margins = { top: 2, bottom: 2, left: 2, right: 2 };

describe('a link with a scheme the editor never opens is dropped on import', () => {
  it('through ODT', async () => {
    const back = importOdt(await buildOdt(doc as any, margins, 'portrait')).content as unknown as N;
    expect(links(back)).toEqual(['https://example.com', '#top']);
  });
  it('through DOCX', async () => {
    const back = importDocx(await buildDocx(doc as any, margins, 'portrait')).content as unknown as N;
    expect(links(back)).toEqual(['https://example.com', '#top']);
  });
});
