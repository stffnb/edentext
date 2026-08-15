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
const importAny = (f: string, bytes: Uint8Array): N =>
  (f.endsWith('.odt') ? importOdt(bytes) : importDocx(bytes)).content;

// A block's type and its text, flattened depth-first: the shape a round trip must keep.
function outline(node: N, out: string[] = []): string[] {
  for (const child of node.content ?? []) {
    if (child.type === 'text') continue;
    out.push(`${child.type}:${textOf(child).replace(/\s+/g, ' ').trim()}`);
    outline(child, out);
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
      const doc = importAny(f, load(f));
      expect(outline(doc).length).toBeGreaterThan(0);
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      const again = f.endsWith('.odt')
        ? importOdt(await buildOdt(doc, margins, 'portrait'))
        : importDocx(await buildDocx(doc, margins, 'portrait'));
      expect(outline(again.content)).toEqual(outline(doc));
    });
  }

  // The same document in both formats, and each one exported as the other: the four
  // legs a document takes through this editor have to agree on what it says.
  for (const name of files.filter((f) => f.endsWith('.docx')).map((f) => f.slice(0, -5))) {
    it(`${name} reads the same out of either format`, async () => {
      const fromDocx = importAny(`${name}.docx`, load(`${name}.docx`));
      const fromOdt = importAny(`${name}.odt`, load(`${name}.odt`));
      expect(outline(fromOdt)).toEqual(outline(fromDocx));
      const margins = { top: 2, bottom: 2, left: 2, right: 2 };
      expect(outline(importOdt(await buildOdt(fromDocx, margins, 'portrait')).content))
        .toEqual(outline(fromDocx));
      expect(outline(importDocx(await buildDocx(fromOdt, margins, 'portrait')).content))
        .toEqual(outline(fromOdt));
    });
  }
});
