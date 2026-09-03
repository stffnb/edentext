// The committed corpus (`tests/corpus/`: documents the `docx` lib writes, plus the ODT
// twins LibreOffice converts them into) read as documents rather than as renderer
// fixtures — a file this editor did not write has to import, survive our own export,
// and read back the same.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';

type N = any;

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'corpus');
// `make-fixtures.mjs` writes them; a real-world document stays out of the repo, in the
// gitignored parity fixture directory, and out of this run.
const files = existsSync(FIX)
  ? readdirSync(FIX).filter((f) => /^\d\d-.+\.(docx|odt)$/.test(f)).sort()
  : [];

const load = (f: string) => new Uint8Array(readFileSync(join(FIX, f)));
const readAny = (f: string, bytes: Uint8Array) =>
  f.endsWith('.odt') ? importOdt(bytes) : importDocx(bytes);
const importAny = (f: string, bytes: Uint8Array): N => readAny(f, bytes).content;

// A block's type and its text, flattened depth-first: the shape a round trip must keep.
// The heading attrs ride along: a chapter that loses its level, its own style or the
// break in front of it still says the same words, and reflows the document anyway.
function outline(node: N, out: string[] = []): string[] {
  for (const child of node.content ?? []) {
    if (child.type === 'text') continue;
    const a = child.type === 'heading' ? child.attrs ?? {} : null;
    const head = a ? `heading${a.level}${a.styleName ? `[${a.styleName}]` : ''}${a.breakBefore ? '+brk' : ''}` : child.type;
    out.push(`${head}:${textOf(child).replace(/\s+/g, ' ').trim()}`);
    outline(child, out);
  }
  return out;
}

// Every attribute a node carries, key order made stable. Dropped: note ids, minted per
// export; a table's widths, proportional in ODF and absolute in OOXML; a formula's
// `display`, which ODF has no flag for and reads back off the paragraph.
function attrs(o: Record<string, N>, skip: (k: string) => boolean = () => false): string {
  const keep = Object.keys(o).filter((k) => k !== 'colwidth' && k !== 'display' && !skip(k)).sort();
  return JSON.stringify(Object.fromEntries(keep.map((k) =>
    [k, /^(ftn|edn|footnote|endnote)\d+$/.test(String(o[k])) ? 'ID' : o[k]])));
}

// What outline() cannot see: the look each block carries. A round trip that keeps every
// word can still drop a header row, a box's ring or a note's own style. A run value the
// paragraph already states is redundant, and each importer is free to suppress it.
function look(node: N, out: string[] = [], d = 0, from: Record<string, N> = {}): string[] {
  for (const c of node.content ?? []) {
    const same = (k: string) => from[k] !== undefined && from[k] === c.attrs?.[k];
    const marks = (c.marks ?? []).map((m: N) => `${m.type}${attrs(m.attrs ?? {}, (k) => from[k] === m.attrs?.[k])}`)
      .filter((m: string) => !m.endsWith(':{}') && !m.endsWith('{}')).join(',');
    out.push(`${' '.repeat(d)}${c.type}:${c.type === 'text' ? marks : attrs(c.attrs ?? {}, same)}`);
    look(c, out, d + 1, c.type === 'text' ? from : { ...from, ...(c.attrs ?? {}) });
  }
  return out;
}

function textOf(node: N): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

describe.skipIf(!files.length)('the authored corpus', () => {
  it('has both formats of every document', () => {
    const docx = files.filter((f) => f.endsWith('.docx')).map((f) => f.slice(0, -5));
    const odt = files.filter((f) => f.endsWith('.odt')).map((f) => f.slice(0, -4));
    expect(odt).toEqual(docx);
  });

  for (const f of files) {
    it(`${f} imports and survives its own round trip`, async () => {
      const read = readAny(f, load(f));
      const doc = read.content;
      expect(outline(doc).length).toBeGreaterThan(0);
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      // The file's own stylesheet goes back out with it, as it does when the app saves:
      // a style the document names but builtinStyleSheet() has never heard of can only
      // be written from there.
      const again = f.endsWith('.odt')
        ? importOdt(await buildOdt(doc, margins, 'portrait', undefined, undefined, undefined, read.styles))
        : importDocx(await buildDocx(doc, margins, 'portrait', undefined, undefined, undefined, read.styles));
      expect(outline(again.content)).toEqual(outline(doc));
    });
  }

  // What the legs above cannot see: both sides of a round trip go through the same
  // importer, so a file read wrongly but consistently still compares equal. 15-chapters
  // carries chapter numbering on its heading styles and two heading styles of its own —
  // read as a list, or as body text, either would round-trip happily.
  const CHAPTERS = ['heading1+brk:Introduction', 'heading2:Motivation',
    'heading1+brk:Results', 'heading2:Method',
    'heading1[Appendix 1]+brk:Appendix', 'heading2[Appendix 2]:List of Tables'];
  for (const f of files.filter((n) => n.startsWith('15-chapters'))) {
    it(`${f} reads its numbered chapters as headings`, () => {
      const doc = importAny(f, load(f));
      expect(outline(doc).filter((l) => l.startsWith('heading'))).toEqual(CHAPTERS);
      expect(outline(doc).filter((l) => /^(ordered|bullet)List|^listItem/.test(l))).toEqual([]);
    });
  }

  // A second save is the one that drifts: an importer storing as direct formatting what
  // it read from a style writes that back out, and the file grows a little each pass.
  for (const f of files) {
    it(`${f} does not drift on a second save`, async () => {
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      const build = f.endsWith('.odt') ? buildOdt : buildDocx;
      const read = f.endsWith('.odt') ? importOdt : importDocx;
      const once = read(await build(readAny(f, load(f)).content, margins, 'portrait', undefined, undefined, undefined, readAny(f, load(f)).styles));
      const twice = read(await build(once.content, margins, 'portrait', undefined, undefined, undefined, once.styles));
      expect(look(twice.content)).toEqual(look(once.content));
    });
  }

  // Word re-saves of the same documents (tests/corpus/word/): Word rewrites the file
  // in its own dialect — rsids, proofErr, separator notes, theme docDefaults — which
  // neither the docx lib nor LibreOffice produce, so this is the third author here.
  const WORD = join(FIX, 'word');
  const wordFiles = existsSync(WORD)
    ? readdirSync(WORD).filter((f) => /^\d\d-.+\.docx$/.test(f)).sort()
    : [];
  for (const f of wordFiles) {
    it(`word/${f} reads like the original and survives the round trip`, async () => {
      const doc = importDocx(new Uint8Array(readFileSync(join(WORD, f)))).content as N;
      expect(outline(doc), 'matches the docx-lib original').toEqual(outline(importAny(f, load(f))));
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      const again = importDocx(await buildDocx(doc, margins, 'portrait'));
      expect(outline(again.content)).toEqual(outline(doc));
    });

    it(`word/${f} keeps its look on the way out as ODT`, async () => {
      const read = importDocx(new Uint8Array(readFileSync(join(WORD, f))));
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      const asOdt = await buildOdt(read.content as N, margins, 'portrait', undefined, undefined, undefined, read.styles);
      expect(look(importOdt(asOdt).content)).toEqual(look(read.content as N));
    });
  }

  // The same document in both formats, and each one exported as the other: the four
  // legs a document takes through this editor have to agree on what it says. The file's
  // **own stylesheet** rides the cross legs, as it does when the app saves — chapter
  // numbering and a heading's own style live there and nowhere in the document tree, so
  // an export handed builtinStyleSheet() never carries either.
  for (const name of files.filter((f) => f.endsWith('.docx')).map((f) => f.slice(0, -5))) {
    it(`${name} reads the same out of either format`, async () => {
      const docx = readAny(`${name}.docx`, load(`${name}.docx`));
      const odt = readAny(`${name}.odt`, load(`${name}.odt`));
      expect(outline(odt.content)).toEqual(outline(docx.content));
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      const asOdt = await buildOdt(docx.content, margins, 'portrait', undefined, undefined, undefined, docx.styles);
      expect(look(importOdt(asOdt).content)).toEqual(look(docx.content));
      const asDocx = await buildDocx(odt.content, margins, 'portrait', undefined, undefined, undefined, odt.styles);
      expect(look(importDocx(asDocx).content)).toEqual(look(odt.content));
    });
  }
});
