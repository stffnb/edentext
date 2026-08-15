// Property leg: seeded random documents (fuzzDoc.ts) -> buildOdt -> importOdt must
// come back unchanged (normalized). A failure names the seed, so it reproduces.
import { describe, it, expect } from 'vitest';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { normalize, firstDiff } from './normalize';
import { genDoc, mulberry32 } from './fuzzDoc';

const margins = { top: 2, bottom: 2, left: 2, right: 2 };

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
  it('50 seeded random documents come back identical', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      const doc = genDoc(mulberry32(seed));
      const res = importOdt(await buildOdt(doc, margins, 'portrait'));
      expect.soft(res.warnings, `seed ${seed}: warnings`).toEqual([]);
      const diff = firstDiff(stripFontHoist(normalize(doc)), stripFontHoist(normalize(res.content)));
      expect.soft(diff, `seed ${seed} (re-run genDoc(mulberry32(${seed})) to reproduce)`).toBeNull();
    }
  }, 120_000);
});
