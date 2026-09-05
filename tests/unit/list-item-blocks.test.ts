// A list item may hold more than one block. odf-kit writes only its first paragraph, so
// the export merges the rest into it (SEG) and splits them out again — this is the guard.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { hasXmllint, validateOdt } from '../schemaValidate';

type N = any;
const p = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const list = (item: N[]) => ({ type: 'bulletList', content: [{ type: 'listItem', content: item }] });
const doc = (content: N[]) => ({ type: 'doc', content }) as N;
const shape = (n: N): string => n.type + (n.content ? `(${n.content.map(shape).join(',')})` : '');
const nested = list([p('sub')]);

describe('a list item holding more than one block', () => {
  it('round-trips a second paragraph', async () => {
    const odt = await buildOdt(doc([list([p('one'), p('two')])]));
    if (hasXmllint) expect(validateOdt(unzipSync(odt))).toEqual([]);
    expect(shape(importOdt(odt).content)).toBe('doc(bulletList(listItem(paragraph(text),paragraph(text))))');
  });

  it('keeps a paragraph that follows a nested list, in its place', async () => {
    const odt = await buildOdt(doc([list([p('one'), nested, p('after')])]));
    if (hasXmllint) expect(validateOdt(unzipSync(odt))).toEqual([]);
    expect(shape(importOdt(odt).content))
      .toBe('doc(bulletList(listItem(paragraph(text),bulletList(listItem(paragraph(text))),paragraph(text))))');
  });

  it('writes the further blocks to DOCX too', async () => {
    const docx = await buildDocx(doc([list([p('one'), p('two')])]));
    expect(strFromU8(unzipSync(docx)['word/document.xml'])).toContain('two');
  });
});
