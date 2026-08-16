// Property leg: seeded random documents (fuzzDoc.ts) -> buildOdt -> importOdt must
// come back unchanged (normalized). A failure names the seed, so it reproduces.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { normalize, firstDiff } from './normalize';
import { genDoc, mulberry32 } from './fuzzDoc';

const margins = { top: 2, bottom: 2, left: 2, right: 2 };
const SEEDS = Number(process.env.FUZZ_SEEDS ?? 50); // FUZZ_SEEDS=500 for a wide sweep

// A paragraph whose runs share one font legitimately comes back with that font also
// on its attrs (the empty-line-height feature hoists it); ignore it on both sides.
function stripFontHoist(node: any): any {
  if (node.content?.length && node.attrs) {
    const { fontSize, fontFamily, ...rest } = node.attrs;
    node.attrs = Object.keys(rest).length ? rest : undefined;
    if (!node.attrs) delete node.attrs;
  }
  for (const c of node.content ?? []) stripFontHoist(c);
  return node;
}

describe('fuzz round-trip: editor → buildOdt → importOdt', () => {
  it(`${SEEDS} seeded random documents come back identical`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const doc = genDoc(mulberry32(seed));
      const res = importOdt(await buildOdt(doc, margins, 'portrait'));
      expect.soft(res.warnings, `seed ${seed}: warnings`).toEqual([]);
      const diff = firstDiff(stripFontHoist(normalize(doc)), stripFontHoist(normalize(res.content)));
      expect.soft(diff, `seed ${seed} (re-run genDoc(mulberry32(${seed})) to reproduce)`).toBeNull();
    }
  }, 600_000);

  // ODT leaves default column widths implicit where DOCX always writes w:tcW; ignore
  // them in the cross-format comparison (each format's own leg still covers widths).
  function stripColwidth(node: any): any {
    if (node.attrs?.colwidth) {
      delete node.attrs.colwidth;
      if (!Object.keys(node.attrs).length) delete node.attrs;
    }
    for (const c of node.content ?? []) stripColwidth(c);
    return node;
  }

  // Cross-format: the same document through both pipelines must import identically —
  // catches one exporter silently losing what the other keeps.
  it(`${SEEDS} seeded documents agree between the ODT and DOCX round-trips`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const doc = genDoc(mulberry32(seed));
      const viaOdt = importOdt(await buildOdt(doc, margins, 'portrait')).content;
      const viaDocx = importDocx(await buildDocx(doc, margins, 'portrait')).content;
      const diff = firstDiff(stripColwidth(stripFontHoist(normalize(viaOdt))),
        stripColwidth(stripFontHoist(normalize(viaDocx))));
      expect.soft(diff, `seed ${seed}: ODT vs DOCX import (genDoc(mulberry32(${seed})))`).toBeNull();
    }
  }, 600_000);
});
