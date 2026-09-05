// LibreOffice as the fuzz's second reader: each seed's ODT re-saved by soffice, and its
// DOCX converted to ODT, both read back and held against what went out. Where LibreOffice
// understands a file differently from our importer, one of the two is wrong.
import { describe, it, expect } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOdt } from '../src/lib/export/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importOdt } from '../src/lib/import/odt';
import { normalize, stripFontHoist, unhoist } from './normalize';
import { mulberry32 } from './fuzzDoc';
import { genCase, exportArgs, expectedOptions, importedOptions, diffLoose, omit, DOCX_LOSSY, docWideOddEven, type FuzzOptions } from './fuzzOptions';

type N = any;
type Fmt = 'odt' | 'docx';

const SEEDS = Number(process.env.LO_SEEDS ?? 10); // LO_SEEDS=100 for a wide sweep
const DUMP = process.env.LO_DUMP; // a path: every diff of every seed, for triage
const SOFFICE = (() => { try { execSync('command -v soffice', { stdio: 'ignore' }); return true; } catch { return false; } })();

// What LibreOffice's DOCX reader has no place for beyond Word's own list: fold marks are
// our construct, and heading numbering comes back as list styles on the heading styles.
const LOSSY: Record<Fmt, string[]> = { odt: [], docx: [...DOCX_LOSSY, 'foldMarks', 'outline', 'spacingAtPageStart'] };

// One soffice call per batch: a cold start costs seconds, a document milliseconds. Its
// own profile, so a LibreOffice the user has open does not swallow the call.
function convertAll(files: string[], outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  execFileSync('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${join(outDir, '..', 'profile')}`,
    '--convert-to', 'odt', '--outdir', outDir, ...files], { stdio: 'pipe', timeout: 900_000 });
}

// LibreOffice's own reading: pictures re-encoded, sizes rounded through cm, a width on
// every column, a hyperlink in its Internet Link style, a comment dated by its own clock;
// from DOCX an index mark is dropped, a list style "WWNum", a lone operator quoted text.
function loNoise(node: N, fmt: Fmt): N {
  const a = node.attrs ?? {};
  for (const [k, v] of Object.entries(a)) {
    if (k === 'src') a.src = 'IMG';
    else if ((k === 'width' || k === 'height' || k === 'rowHeight') && typeof v === 'number') a[k] = Math.round(v / 3) * 3;
    else if (k === 'colwidth' || (k === 'wrapOffsetY' && v === 0)) delete a[k];
    else if ((k === 'marginLeft' || k === 'marginRight') && typeof v === 'number') { if (Math.abs(v) < 0.05) delete a[k]; else a[k] = Math.round(v * 10) / 10; }
    else if ((k === 'bulletChar' || k === 'textVertical' || k === 'alt') && fmt === 'docx') delete a[k];
    else if (k === 'textPosition' && typeof v === 'number') a[k] = Math.round(v * 2) / 2;
    else if (k.startsWith('border') && typeof v === 'string') a[k] = v.replace(/^([\d.]+)pt/, (_m, w) => `${Math.round(Number(w) * 4) / 4}pt`);
    else if (k === 'latex' && fmt === 'docx') a.latex = String(v).replace(/\\text\{(.)\}/g, '$1');
    else if ((k === 'listStyleName' || k === 'listStyleType') && fmt === 'docx') delete a[k];
    else if ((k === 'styleName' || k === 'name') && typeof v === 'string') a[k] = v.replace(/ \(WW\)$/, '');
  }
  // A note's label and a citation's fields are recomputed on its side; a table style is
  // its look baked into the cells there, so a styled table compares by its text alone.
  if (node.type === 'noteRef' || node.type === 'note') delete a.text;
  // A note's text opens with the tab LibreOffice's DOCX reader puts after the number; a
  // figure or table index is a paragraph to it.
  if (node.type === 'note' && fmt === 'docx') {
    // A custom mark comes back as the note's first run, in the symbol style.
    if (node.content?.[0]?.marks?.some((m: N) => /Symbol$/.test(m.attrs?.name ?? ''))) node.content.shift();
    if (node.content?.[0]?.text) node.content[0].text = node.content[0].text.replace(/^\t/, '');
  }
  // Its DOCX reader spells a heading paragraph's zero spacing out.
  if (fmt === 'docx' && node.type === 'paragraph') { if (a.spaceAfter === 0) delete a.spaceAfter; if (a.spaceBefore === 0) delete a.spaceBefore; }
  if (node.type === 'tableOfContents' && fmt === 'docx' && ['tables', 'figures'].includes(a.index)) { node.attrs = undefined; delete node.content; node.type = 'paragraph'; }
  if (node.type === 'bibliographyEntry' && fmt === 'docx') node.attrs = {};
  // Word centres a display formula's paragraph; LibreOffice reads that as its alignment.
  if (fmt === 'docx' && node.type === 'paragraph' && node.content?.length === 1 && node.content[0].type === 'formula' && node.content[0].attrs?.display && a.textAlign === 'center') delete a.textAlign;
  if (node.attrs && !Object.keys(a).length) delete node.attrs;
  // A comment's date comes back in LibreOffice's local time; a tracked deletion wears
  // its review look (strike, underline) as formatting; a run in a character style has
  // that style's font written out beside it.
  for (const m of node.marks ?? []) {
    if (m.type === 'comment' && m.attrs) delete m.attrs.date;
    // A style name LibreOffice's DOCX reader reserves for a Word name comes back "… (WW)".
    if (m.type === 'charStyle' && m.attrs?.name) m.attrs.name = m.attrs.name.replace(/ \(WW\)$/, '');
  }
  // A tracked deletion comes back in the look of the run beside it; a raised run's
  // percentage is rounded on the way.
  if (node.marks?.some((m: N) => m.type === 'deletion' || m.type === 'insertion')) {
    node.marks = node.marks.filter((m: N) => ['deletion', 'insertion', 'link'].includes(m.type));
  }
  for (const m of node.marks ?? []) if (typeof m.attrs?.textPosition === 'number') m.attrs.textPosition = Math.round(m.attrs.textPosition * 2) / 2;
  if (node.marks?.some((m: N) => m.type === 'charStyle')) for (const m of node.marks) if (m.type === 'textStyle' && m.attrs) delete m.attrs.fontFamily;
  if (node.marks) {
    node.marks = node.marks.filter((m: N) => m.type !== 'textStyle' || Object.keys(m.attrs ?? {}).length);
    if (!node.marks.length) delete node.marks;
  }
  if (node.marks?.some((m: N) => m.type === 'link')) {
    node.marks = node.marks.filter((m: N) => m.type !== 'underline');
    for (const m of node.marks) if (m.type === 'textStyle' && m.attrs) delete m.attrs.color;
    node.marks = node.marks.filter((m: N) => m.type !== 'textStyle' || Object.keys(m.attrs ?? {}).length);
    if (!node.marks.length) delete node.marks;
  }
  // A paragraph in a text box loses its own field and rule lines on the way.
  if (node.type === 'textBox') for (const p of node.content ?? []) for (const k of Object.keys(p.attrs ?? {})) if (k === 'backgroundColor' || k.startsWith('border')) delete p.attrs[k];
  if (node.content) {
    // Its DOCX reader drops an index mark; beside a ruby it moves one and flattens the
    // ruby to its base text, so both compare as that.
    const ruby = node.content.some((c: N) => c.type === 'ruby'), mark = node.content.some((c: N) => c.type === 'indexEntry');
    node.content = node.content.filter((c: N) => !((fmt === 'docx' || ruby) && c.type === 'indexEntry'))
      .map((c: N) => (fmt === 'odt' && ruby && mark && c.type === 'ruby' ? { type: 'text', text: c.attrs.base } : loNoise(c, fmt)));
    // A document may not end on a table in Writer, so one gets a paragraph after it
    // (ahead of the notes, which the model keeps last).
    const end = node.content.length - (node.content[node.content.length - 1]?.type === 'noteSection' ? 2 : 1);
    const last = node.content[end], prev = node.content[end - 1];
    if (node.type === 'doc' && last?.type === 'paragraph' && !last.content && !last.attrs && prev?.type === 'table') node.content.splice(end, 1);
    if (!node.content.length) delete node.content;
  }
  return node;
}
// A table style is its look baked into the cells on LibreOffice's side, and a formula
// cell shows the value it recomputes in its locale's format: the authored document's
// styled tables compare by their text alone, its formula cells by nothing.
type Marked = { styled: Set<number>; formulas: Set<string> };
function markedTables(doc: N): Marked {
  const styled = new Set<number>(), formulas = new Set<string>();
  (doc.content ?? []).forEach((b: N, i: number) => {
    if (b.type !== 'table') return;
    if (b.attrs?.tableStyle) styled.add(i);
    b.content?.forEach((row: N, r: number) => row.content?.forEach((cell: N, c: number) => { if (cell.attrs?.formula) formulas.add(`${i}/${r}/${c}`); }));
  });
  return { styled, formulas };
}
function bareTables(doc: N, marked: Marked, fmt: Fmt): N {
  doc.content?.forEach((b: N, i: number) => {
    if (b.type !== 'table') return;
    if (marked.styled.has(i)) {
      delete b.attrs?.tableStyle; delete b.attrs?.tableLook;
      (function bare(n: N) { delete n.marks; if (n.attrs) { delete n.attrs.region; if (!Object.keys(n.attrs).length) delete n.attrs; } for (const c of n.content ?? []) bare(c); })(b);
    }
    b.content?.forEach((row: N, r: number) => row.content?.forEach((cell: N, c: number) => {
      if (!marked.formulas.has(`${i}/${r}/${c}`)) return;
      delete cell.content;
      if (fmt === 'docx' && cell.attrs) { delete cell.attrs.formula; delete cell.attrs.cellFormat; if (!Object.keys(cell.attrs).length) delete cell.attrs; }
    }));
  });
  return doc;
}
const loContent = (doc: N, fmt: Fmt, marked: Marked) => bareTables(loNoise(stripFontHoist(normalize(unhoist(structuredClone(doc)))), fmt), marked, fmt);

// The canonical options as LibreOffice hands them back: a chapter field's cached name is
// recomputed (and via DOCX, a STYLEREF field is not read at all); a watermark rides a
// header band it floors at 0.499cm, so a section without a header of its own grows by it.
function loOptions(canon: N, fmt: Fmt, opts: FuzzOptions, authored: boolean): N {
  // Via DOCX a zone's runs come back in the look LibreOffice gives fields and headings,
  // so there a zone compares by its text and fields alone.
  const zoneFix = (zone: N): void => {
    for (const p of zone?.content ?? []) {
      if (fmt === 'docx') p.content = p.content?.filter((c: N) => c.type !== 'chapterField').map((c: N) => (c.type === 'text' ? { type: 'text', text: c.text } : { type: c.type }));
      for (const c of p.content ?? []) if (c.type === 'chapterField') delete c.attrs.text;
      if (p.content && !p.content.length) delete p.content;
    }
  };
  // A style naming itself as next names the default; a rule's width is rounded through cm.
  for (const [name, st] of Object.entries(canon.styles ?? {}) as [string, N][]) {
    if (!st) continue;
    if (st.next === name) st.next = null;
    for (const [k, v] of Object.entries(st.para ?? {})) if (k.startsWith('border') && typeof v === 'string') st.para[k] = (v as string).replace(/^([\d.]+)pt/, (_m, w) => `${Math.round(Number(w) * 4) / 4}pt`);
  }
  for (const s of canon.sections) {
    for (const k of ['header', 'footer', 'headerFirst', 'footerFirst', 'headerEven', 'footerEven']) zoneFix(s[k]);
    if (authored && fmt === 'odt' && (opts.decor.watermark || opts.foldMarks) && !s.header && !s.headerFirst && !s.headerEven && s.margins) {
      s.margins.top = Math.round((s.margins.top + 0.499) * 1000) / 1000;
    }
  }
  return fmt === 'docx' && authored ? docWideOddEven(canon) : canon;
}

// Every leaf that differs, for the LO_DUMP triage file (firstDiff stops at the first).
function allDiffs(a: N, b: N, path = '$', out: string[] = []): string[] {
  if (out.length >= 12 || (a == null && b == null)) return out;
  if (typeof a === 'number' && typeof b === 'number') { if (Math.abs(a - b) > 0.02) out.push(`${path}: ${a} vs ${b}`); return out; }
  if (typeof a !== typeof b || a == null || b == null || typeof a !== 'object') {
    if (!Object.is(a, b)) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 300)} vs ${JSON.stringify(b)?.slice(0, 300)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) allDiffs(a[k], b[k], `${path}.${k}`, out);
  return out;
}

// Writer joins two tables that touch, as its DOCX reader finds ours; that reader also
// swallows the blocks after an index field with no entries, and restructures a list in a
// table cell, a floating picture in a list item and a list three deep: nothing to compare.
const adjacentTables = (doc: N) => (doc.content ?? []).some((b: N, i: number) => b.type === 'table' && doc.content[i + 1]?.type === 'table');
const emptyIndex = (doc: N) => (doc.content ?? []).some((b: N) => b.type === 'tableOfContents' && !(b.attrs?.entries ?? []).length);
const has = (n: N, test: (x: N) => boolean): boolean => test(n) || (n.content ?? []).some((c: N) => has(c, test));
const listInCell = (doc: N) => has(doc, (n) => n.type === 'tableCell' && has(n, (x) => /List$/.test(x.type)));
const floating = (n: N) => has(n, (x) => x.type === 'image' && x.attrs?.wrap && x.attrs.wrap !== 'inline');
const floatInList = (doc: N) => has(doc, (n) => n.type === 'listItem' && floating(n))
  || (doc.content ?? []).some((b: N, i: number) => isList(b) && doc.content[i + 1] && floating(doc.content[i + 1]));
const isList = (n: N) => /List$/.test(n.type);
const deepList = (doc: N) => has(doc, (n) => isList(n) && (n.content ?? []).some((li: N) => (li.content ?? []).some((x: N) => isList(x) && (x.content ?? []).some((li2: N) => (li2.content ?? []).some(isList)))));
const hardForDocx = (doc: N) => adjacentTables(doc) || emptyIndex(doc) || listInCell(doc) || floatInList(doc) || deepList(doc);

describe.skipIf(!SOFFICE)('fuzz through LibreOffice (needs soffice on PATH)', () => {
  const work = mkdtempSync(join(tmpdir(), 'lo-fuzz-'));
  const cases = Array.from({ length: SEEDS }, (_, i) => ({ seed: i + 1, ...genCase(mulberry32(i + 1)) }));
  const dump: string[] = [];

  for (const [fmt, build] of [['odt', buildOdt], ['docx', buildDocx]] as const) {
    it(`${SEEDS} seeds as ${fmt.toUpperCase()}: LibreOffice reads them as they were written`, async () => {
      const dir = join(work, fmt);
      mkdirSync(dir, { recursive: true });
      const files: string[] = [];
      for (const c of cases) {
        const f = join(dir, `seed-${c.seed}.${fmt}`);
        writeFileSync(f, await build(c.doc, ...exportArgs(c.opts)));
        files.push(f);
      }
      convertAll(files, join(dir, 'out'));
      for (const c of cases) {
        const f = join(dir, 'out', `seed-${c.seed}.odt`);
        if (!existsSync(f)) { expect.soft(f, `seed ${c.seed}: LibreOffice wrote no file`).toBe(''); continue; }
        const res = importOdt(new Uint8Array(readFileSync(f)));
        const marked = markedTables(c.doc);
        const [want, got] = [loContent(c.doc, fmt, marked), loContent(res.content, fmt, marked)];
        const skipContent = fmt === 'docx' && hardForDocx(c.doc);
        // Loose on numbers: a size or padding comes back a thousandth off through cm.
        const diff = skipContent ? null : diffLoose(want, got);
        expect.soft(diff, `seed ${c.seed}: content via ${fmt}`).toBeNull();
        const exp = omit(loOptions(expectedOptions(c.opts), fmt, c.opts, true), LOSSY[fmt]);
        const imp = omit(loOptions(importedOptions(res, c.opts), fmt, c.opts, false), LOSSY[fmt]);
        // A file naming no language gets LibreOffice's own; via DOCX a page-number start
        // needs a leading paragraph to ride on.
        if (exp.language == null) { delete exp.language; delete imp.language; }
        if (fmt === 'docx' && !['paragraph', 'heading'].includes(c.doc.content?.[0]?.type)) { delete exp.pageNumberStart; delete imp.pageNumberStart; }
        const optDiff = diffLoose(exp, imp);
        expect.soft(optDiff, `seed ${c.seed}: options via ${fmt}`).toBeNull();
        if (DUMP) dump.push(`## seed ${c.seed} ${fmt}: warnings=${JSON.stringify(res.warnings)}`,
          ...(skipContent ? ['  C (not compared)'] : allDiffs(want, got).map((d) => `  C ${d}`)), ...allDiffs(exp, imp).map((d) => `  O ${d}`));
      }
      if (DUMP) writeFileSync(DUMP, dump.join('\n') + '\n');
    }, 900_000);
  }
});
