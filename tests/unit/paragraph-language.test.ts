// The suppression rule for a paragraph's and a run's language: what matches the level
// above it is no formatting, so a monolingual document carries no language at all — and
// Word's language-on-every-run comes back as one block attribute.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importOdt } from '../../src/lib/import/odt';
import { importDocx } from '../../src/lib/import/docx';

type N = any;

const T = (text: string, lang?: string): N =>
  ({ type: 'text', text, ...(lang ? { marks: [{ type: 'textStyle', attrs: { lang } }] } : {}) });
const P = (attrs: N | null, ...content: N[]): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content });

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const de = { language: 'de', country: 'DE' };
const langOf = (d: N, i: number) => d.content[i].attrs?.lang ?? null;
const runLangs = (d: N, i: number) =>
  d.content[i].content.map((n: N) => n.marks?.find((m: N) => m.type === 'textStyle')?.attrs?.lang ?? null);

describe('a paragraph and a run language', () => {
  it('writes nothing where it matches the document', async () => {
    const doc: N = { type: 'doc', content: [P(null, T('nur Deutsch')), P({ lang: 'de-DE' }, T('auch Deutsch'))] };
    const odt = strFromU8(unzipSync(await buildOdt(doc, margins, 'portrait', undefined, de))['content.xml']);
    const back = importOdt(await buildOdt(doc, margins, 'portrait', undefined, de)).content as N;
    // The paragraph that spells the document's own language out still writes it — that is
    // what both word processors do with an explicit setting — but it reads back as none.
    expect(odt).toContain('fo:language="de"');
    expect([langOf(back, 0), langOf(back, 1)]).toEqual([null, null]);
  });

  it('drops a run language that matches its paragraph', async () => {
    const doc: N = { type: 'doc', content: [P({ lang: 'en-US' }, T('all '), T('English', 'en-US'))] };
    for (const back of [
      importOdt(await buildOdt(doc, margins, 'portrait', undefined, de)).content as N,
      importDocx(await buildDocx(doc, margins, 'portrait', undefined, de)).content as N,
    ]) {
      expect(langOf(back, 0)).toBe('en-US');
      expect(runLangs(back, 0).filter(Boolean)).toEqual([]);
    }
  });

  it('reads the paragraph mark\'s own language, which is where Word keeps it', async () => {
    const doc: N = { type: 'doc', content: [P({ lang: 'en-US' }, T('all '), T('English'))] };
    const xml = strFromU8(unzipSync(await buildDocx(doc, margins, 'portrait', undefined, de))['word/document.xml']);
    // Once in w:pPr/w:rPr for the mark, and once per run — Word reads a run's language
    // from its own properties alone.
    expect((xml.match(/<w:lang w:val="en-US"\/>/g) ?? []).length).toBe(3);

    const back = importDocx(await buildDocx(doc, margins, 'portrait', undefined, de)).content as N;
    expect(langOf(back, 0)).toBe('en-US');
    expect(runLangs(back, 0).filter(Boolean)).toEqual([]);
  });

  it('keeps a run that really differs from its paragraph', async () => {
    const doc: N = { type: 'doc', content: [P({ lang: 'en-US' }, T('one '), T('deux', 'fr-FR'))] };
    for (const back of [
      importOdt(await buildOdt(doc, margins, 'portrait', undefined, de)).content as N,
      importDocx(await buildDocx(doc, margins, 'portrait', undefined, de)).content as N,
    ]) {
      expect(langOf(back, 0)).toBe('en-US');
      expect(runLangs(back, 0).filter(Boolean)).toEqual(['fr-FR']);
    }
  });
});
