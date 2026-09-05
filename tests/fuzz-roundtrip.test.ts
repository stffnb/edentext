// Property leg: seeded random documents under random export options (fuzzDoc.ts,
// fuzzOptions.ts) -> buildOdt/buildDocx -> import come back unchanged (normalized), and every
// export validates against the schemas. A failure names the seed: genCase(mulberry32(seed)).
import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { buildOdt } from '../src/lib/export/odt';
import { importOdt } from '../src/lib/import/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importDocx } from '../src/lib/import/docx';
import { normalize, firstDiff, stripFontHoist } from './normalize';
import { mulberry32 } from './fuzzDoc';
import { genCase, exportArgs, expectedOptions, importedOptions, diffLoose, omit } from './fuzzOptions';
import { hasXmllint, validateOdt, validateDocx } from './schemaValidate';

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 50); // FUZZ_SEEDS=500 for a wide sweep
// The schema leg pays ~0.7s of xmllint per seed, so it takes fewer by default.
const SCHEMA_SEEDS = Number(process.env.SCHEMA_SEEDS ?? Math.min(SEEDS, 20));

// What each format has no place for (see the importers' CLAUDE.md); dropped from both
// sides of its comparison. Word spaces paragraphs by the larger of the two values and
// draws its note separator its own way; it has no note prefix/suffix and counts every line.
const ODT_LOSSY: string[] = [];
const DOCX_LOSSY: string[] = ['spacingModel', 'notes.separator', 'notes.footnote.prefix', 'notes.footnote.suffix',
  'notes.endnote.prefix', 'notes.endnote.suffix', 'lineNumbering.countEmpty'];

describe('fuzz round-trip: editor → buildOdt → importOdt', () => {
  it(`${SEEDS} seeded random documents come back identical`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { doc, opts } = genCase(mulberry32(seed));
      const res = importOdt(await buildOdt(doc, ...exportArgs(opts)));
      expect.soft(res.warnings, `seed ${seed}: warnings`).toEqual([]);
      const diff = firstDiff(stripFontHoist(normalize(doc)), stripFontHoist(normalize(res.content)));
      expect.soft(diff, `seed ${seed}: content`).toBeNull();
      const optDiff = diffLoose(omit(expectedOptions(opts), ODT_LOSSY), omit(importedOptions(res, opts), ODT_LOSSY));
      expect.soft(optDiff, `seed ${seed}: options`).toBeNull();
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

  // Odd/even pages are a document setting in Word (w:evenAndOddHeaders): once any
  // section asks for it, every section has it, repeating its running zones.
  function docWideOddEven(canon: any): any {
    if (!canon.sections.some((s: any) => s.differentOddEven)) return canon;
    for (const s of canon.sections) {
      if (s.differentOddEven) continue;
      Object.assign(s, { differentOddEven: true, headerEven: s.header, footerEven: s.footer });
    }
    return canon;
  }

  // The DOCX leg: its options against what went out, and its content against the ODT
  // reading — catches one exporter silently losing what the other keeps.
  it(`${SEEDS} seeded documents survive DOCX and agree with the ODT round-trip`, async () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const { doc, opts } = genCase(mulberry32(seed));
      const viaOdt = importOdt(await buildOdt(doc, ...exportArgs(opts))).content;
      const res = importDocx(await buildDocx(doc, ...exportArgs(opts)));
      const diff = firstDiff(stripColwidth(stripFontHoist(normalize(viaOdt))),
        stripColwidth(stripFontHoist(normalize(res.content))));
      expect.soft(diff, `seed ${seed}: ODT vs DOCX import`).toBeNull();
      const optDiff = diffLoose(docWideOddEven(omit(expectedOptions(opts), DOCX_LOSSY)),
        omit(importedOptions(res, opts), DOCX_LOSSY));
      expect.soft(optDiff, `seed ${seed}: DOCX options`).toBeNull();
    }
  }, 600_000);
});

describe.skipIf(!hasXmllint)('fuzz: every export validates against the format schemas', () => {
  it(`${SCHEMA_SEEDS} seeded documents are schema-valid as ODT and as DOCX`, async () => {
    for (let seed = 1; seed <= SCHEMA_SEEDS; seed++) {
      const { doc, opts } = genCase(mulberry32(seed));
      const failures = [
        ...validateOdt(unzipSync(await buildOdt(doc, ...exportArgs(opts)))),
        ...validateDocx(unzipSync(await buildDocx(doc, ...exportArgs(opts)))),
      ];
      expect.soft(failures.join('\n\n'), `seed ${seed}`).toBe('');
    }
  }, 1_800_000);
});
