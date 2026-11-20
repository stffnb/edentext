// Hyperlinks through import and export: which ones survive, and as what.
import { describe, it, expect } from 'vitest';
import { importDocx } from '../../src/lib/import/docx';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';

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
    // Absent is the attribute's default: not plain, the same as an explicit false.
    expect(link?.attrs.plain).toBeFalsy();
  });
  it('leaves a plain link its own underline and colour, through DOCX', async () => {
    const own = [{ type: 'underline' }, { type: 'textStyle', attrs: { color: '#0000FF' } }];
    const doc: N = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'see', marks: [{ type: 'link', attrs: { href: '#top', plain: true } }, ...own] },
    ] }] };
    const run = texts(importDocx(await buildDocx(doc as any)).content as unknown as N)[0];
    expect(run.marks?.find((m: any) => m.type === 'link')?.attrs.plain).toBe(true);
    expect(run.marks?.some((m: any) => m.type === 'underline')).toBe(true);
    expect(run.marks?.find((m: any) => m.type === 'textStyle')?.attrs.color).toBe('#0000FF');
  });
});

// A file can carry any href; one with a scheme the editor would never open is read as
// plain text, so the boundary is the import and not a render-time guard.

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
