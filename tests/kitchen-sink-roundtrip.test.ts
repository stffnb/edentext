// The one document carrying every feature at once (kitchenSink.ts) had only ever been
// written — schema-checked and rendered, never read back. Here it makes the trip.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { normalize, firstDiff, stripFontHoist } from './normalize';
import { kitchenSinkDoc, kitchenSinkSheet, kitchenSinkOptions } from './kitchenSink';

type N = any;

// A floating frame is placed by its wrap, not by where its anchor sits among the runs,
// so either format may hand it back at the head of the paragraph.
const floats = (c: N) => (c.type === 'image' || c.type === 'textBox') && c.attrs?.wrap && c.attrs.wrap !== 'inline';
function hoistFloats(node: N): N {
  if (node.content?.some(floats)) node.content = [...node.content.filter(floats), ...node.content.filter((c: N) => !floats(c))];
  for (const c of node.content ?? []) hoistFloats(c);
  return node;
}

// ODF leaves a default column width implicit where DOCX always writes w:tcW.
function stripColwidth(node: N): N {
  if (node.attrs?.colwidth) {
    delete node.attrs.colwidth;
    if (!Object.keys(node.attrs).length) delete node.attrs;
  }
  for (const c of node.content ?? []) stripColwidth(c);
  return node;
}

// ODF has no section that leaves the page: naming a master page is a break (probed),
// so a section start always reads back as one.
function stripSectionBreak(node: N): N {
  if (node.attrs?.sectionBreak) delete node.attrs.breakBefore;
  for (const c of node.content ?? []) stripSectionBreak(c);
  return node;
}

const clean = (n: N) => stripSectionBreak(hoistFloats(stripColwidth(stripFontHoist(normalize(structuredClone(n))))));

const o = kitchenSinkOptions();
const args = [{ top: 2, bottom: 2, left: 2, right: 2 }, 'portrait', o.hf, o.language, 'A4',
  kitchenSinkSheet(), 1.25, 'add', false, o.notesSettings, o.props, false, o.pageNumbering,
  o.decor, o.lineNumbering, false, false, true] as const;

describe.each([['ODT', buildOdt, importOdt], ['DOCX', buildDocx, importDocx]] as const)(
  'the kitchen sink survives a %s round trip', (_name, build, read) => {
    it('comes back identical, with no warnings', async () => {
      const doc = kitchenSinkDoc() as N;
      const res = read(await (build as N)(doc, ...args)) as N;
      expect(res.warnings ?? []).toEqual([]);
      expect(firstDiff(clean(doc), clean(res.content))).toBeNull();
    });

    // The zones are documents of their own, and hold what only they can: the running
    // head, the page number and count.
    it('brings its header and footer back as they went out', async () => {
      const res = read(await (build as N)(kitchenSinkDoc() as N, ...args)) as N;
      for (const zone of ['header', 'footer'] as const) {
        expect(firstDiff(clean((o.hf as N)[zone]), clean(res[zone])), zone).toBeNull();
      }
    });
  },
);
