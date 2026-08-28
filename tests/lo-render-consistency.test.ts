// Cross-format render consistency: the same document exported as .odt and .docx,
// both rendered by LibreOffice, must paginate alike and stay visually close — one
// document, two formats, one renderer, so every diff is an export bug in one of them.
// Requires soffice + pdftoppm (poppler-utils); self-skips without either.
import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { buildDocx } from '../src/lib/export/docx';
import { buildOdt } from '../src/lib/export/odt';
import { kitchenSinkDoc, kitchenSinkSheet, kitchenSinkOptions } from './kitchenSink';

function has(cmd: string): boolean {
  try { execSync(`command -v ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

const DIR = '/tmp/lo-render-consistency';

function pgm(path: string): { w: number; h: number; pixels: Uint8Array } {
  const bytes = readFileSync(path);
  const m = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(bytes.subarray(0, 64).toString('latin1'));
  if (!m) throw new Error(`not a P5 PGM: ${path}`);
  return { w: Number(m[1]), h: Number(m[2]), pixels: new Uint8Array(bytes.subarray(m[0].length)) };
}

function renderPages(file: string, prefix: string): string[] {
  // Own user profile: a parallel lo-roundtrip soffice would otherwise hold the lock.
  execSync(`soffice -env:UserInstallation=file://${DIR}/profile --headless --convert-to pdf --outdir ${DIR}/${prefix} ${DIR}/${file}`, { stdio: 'pipe', timeout: 120000 });
  const pdf = `${DIR}/${prefix}/${file.replace(/\.\w+$/, '.pdf')}`;
  execSync(`pdftoppm -gray -r 60 ${pdf} ${DIR}/${prefix}/page`, { stdio: 'pipe', timeout: 120000 });
  return readdirSync(`${DIR}/${prefix}`).filter((f) => f.endsWith('.pgm')).sort()
    .map((f) => `${DIR}/${prefix}/${f}`);
}

describe.skipIf(!has('soffice') || !has('pdftoppm'))('ODT and DOCX render alike in LibreOffice', () => {
  it('paginates identically and stays within the diff budget', { timeout: 300000 }, async () => {
    const doc = kitchenSinkDoc();
    const sheet = kitchenSinkSheet();
    const opts = kitchenSinkOptions();
    // Neutral page options: decor and line numbering ride LibreOffice's DOCX import
    // differently and would drown the content comparison. Spacing model 'max' — the
    // one both formats express; 'add' is ODF-only and drifts every DOCX page.
    const args = [doc, undefined, 'portrait', undefined, opts.language, 'A4',
      sheet, undefined, 'max', false, opts.notesSettings, opts.props, true,
      opts.pageNumbering] as const;
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${DIR}/doc.odt`, await buildOdt(...(args as any)));
    writeFileSync(`${DIR}/doc.docx`, await buildDocx(...(args as any)));

    const odtPages = renderPages('doc.odt', 'odt');
    const docxPages = renderPages('doc.docx', 'docx');
    expect(docxPages.length, 'both formats paginate to the same page count').toBe(odtPages.length);

    // Ratchet thresholds over the measured status quo (7.6/10.8/4.4/0.3/0.2% on
    // 2026-08-28; the page-2 cluster is floating frames + the styled table's row
    // split) — tighten them as the cross-format deviations get fixed.
    const perPage: number[] = [];
    for (let i = 0; i < odtPages.length; i++) {
      const a = pgm(odtPages[i]);
      const b = pgm(docxPages[i]);
      expect([b.w, b.h], `page ${i + 1} geometry`).toEqual([a.w, a.h]);
      let differing = 0;
      for (let p = 0; p < a.pixels.length; p++) if (Math.abs(a.pixels[p] - b.pixels[p]) > 48) differing++;
      perPage.push((100 * differing) / a.pixels.length);
    }
    console.log('  [cross-format diff %]', perPage.map((d) => d.toFixed(2)).join(' '));
    for (let i = 0; i < perPage.length; i++) expect(perPage[i], `page ${i + 1} diff %`).toBeLessThan(12);
    const mean = perPage.reduce((s, d) => s + d, 0) / perPage.length;
    expect(mean, 'mean diff %').toBeLessThan(6);
  });
});
