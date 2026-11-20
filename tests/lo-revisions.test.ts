// Recorded changes against LibreOffice: it opens what we write, accepts and rejects all
// of it, and must arrive at the paragraphs we arrive at. Self-skips without soffice.
import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { Editor } from '@tiptap/core';
import { BLOCK_FORMAT_CASES, CASES, FORMAT_CASES, MOVE_CASES, TABLE_CASES, edit, open } from './trackChangesCases';
import { revisions } from '../src/lib/editor/extensions/trackChanges';
import { setRecordChanges } from '../src/lib/storage/trackChanges.svelte';
import { buildOdt } from '../src/lib/export/odt';
import { buildDocx } from '../src/lib/export/docx';
import { DEFAULT_MARGINS } from '../src/lib/storage/pageMargins';
import { Editor as Zone } from '@tiptap/core';
import { zoneExtensions } from '../src/lib/editor/extensions';

const SOFFICE = (() => {
  try { execSync('command -v soffice', { stdio: 'ignore' }); return true; } catch { return false; }
})();
// A fresh directory per run, so two checkouts can run this leg at once.
const DIR = mkdtempSync(join(tmpdir(), 'lo-revisions-'));
const PROFILE = `${DIR}/profile`;
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const soffice = (args: string, env: Record<string, string> = {}) => execSync(
  `soffice -env:UserInstallation=file://${PROFILE} --headless --norestore --nologo ${args}`,
  { stdio: 'ignore', timeout: 300000, env: { ...process.env, ...env } },
);

const paragraphs = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.descendants((n) => { if (n.isTextblock) out.push(n.textContent); return !n.isTextblock; });
  return out;
};

const NOTE = 'a reviewer wrote this';

afterEach(() => setRecordChanges(false));

describe.skipIf(!SOFFICE)('recorded changes in LibreOffice (needs soffice)', () => {
  it('accepts and rejects to our result', { timeout: 300000 }, async () => {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const want = new Map<string, string[]>();
    const cases = [...CASES, ...TABLE_CASES, ...FORMAT_CASES, ...BLOCK_FORMAT_CASES, ...MOVE_CASES];
    for (const [i, [name, html, steps]] of cases.entries()) {
      const plain = open(html);
      await edit(plain, steps);
      setRecordChanges(true);
      const recorded = open(html);
      await edit(recorded, steps);
      setRecordChanges(false);
      for (const r of revisions(recorded.state.doc)) recorded.commands.commentRevision(r.id, NOTE);
      const json = recorded.getJSON() as any;
      writeFileSync(`${DIR}/c${i}.odt`, await buildOdt(json, DEFAULT_MARGINS));
      writeFileSync(`${DIR}/c${i}.docx`, await buildDocx(json, DEFAULT_MARGINS));
      for (const ext of ['odt', 'docx']) {
        // Our notes are blocks at the end, LibreOffice's text shows the anchor's number.
        if (!name.includes('note')) want.set(`c${i}.${ext} .uno:AcceptAllTrackedChanges`, paragraphs(plain));
        want.set(`c${i}.${ext} .uno:RejectAllTrackedChanges`, paragraphs(open(html)));
      }
    }

    // The same edits in a header, every other one shared by the running and the even pages.
    const body = open('<p>body</p>').getJSON() as any;
    const zone = (content: string, live = false) =>
      new Zone({ element: document.body.appendChild(document.createElement('div')), extensions: zoneExtensions('', live), content });
    const headerCases = [...CASES, ...FORMAT_CASES].filter(([, html]) => html.startsWith('<p>'));
    for (const [j, [, html, steps]] of headerCases.entries()) {
      const plain = zone(html);
      await edit(plain, steps);
      setRecordChanges(true);
      const recorded = zone(html, true);
      await edit(recorded, steps);
      setRecordChanges(false);
      const doc = recorded.getJSON() as any, i = cases.length + j;
      const hf = { header: doc, footer: null, pageCount: 1, ...(j % 2 ? { headerEven: doc, differentOddEven: true } : {}) };
      writeFileSync(`${DIR}/c${i}.odt`, await buildOdt(body, DEFAULT_MARGINS, 'portrait', hf));
      writeFileSync(`${DIR}/c${i}.docx`, await buildDocx(body, DEFAULT_MARGINS, 'portrait', hf));
      for (const ext of ['odt', 'docx']) {
        want.set(`c${i}.${ext} .uno:AcceptAllTrackedChanges#header`, paragraphs(plain));
        want.set(`c${i}.${ext} .uno:RejectAllTrackedChanges#header`, paragraphs(zone(html)));
      }
    }
    cases.push(...headerCases);

    soffice('--terminate_after_init');
    const lib = `${PROFILE}/user/basic/Standard`;
    writeFileSync(`${lib}/script.xlb`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE library:library PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "library.dtd">
<library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false"><library:element library:name="Module1"/></library:library>`);
    writeFileSync(`${lib}/Module1.xba`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE script:module PUBLIC "-//OpenOffice.org//DTD OfficeDocument 1.0//EN" "module.dtd">
<script:module xmlns:script="http://openoffice.org/2000/script" script:name="Module1" script:language="StarBasic" script:moduleType="normal">${xml(readFileSync('tests/lo/revisions.bas', 'utf8'))}</script:module>`);
    soffice('macro:///Standard.Module1.Main', { LO_REV_DIR: DIR, LO_REV_COUNT: String(cases.length) });

    const got = new Map(readFileSync(`${DIR}/out.txt`, 'utf8').trim().split('\n').map((line) => {
      const [name, cmd, ...rest] = line.split(' ');
      return [`${name} ${cmd}`, rest.join(' ').split('|').slice(1)] as const;
    }));
    const wrong = [...want].filter(([key, paras]) => JSON.stringify(got.get(key)) !== JSON.stringify(paras))
      .map(([key, paras]) => `${cases[+key.match(/c(\d+)/)![1]][0]} — ${key}: LibreOffice ${JSON.stringify(got.get(key))}, ours ${JSON.stringify(paras)}`);
    expect(wrong).toEqual([]);
    const bodyCases = cases.length - headerCases.length;
    const unread = FORMAT_CASES.flatMap(([name], i) => ['odt', 'docx'].flatMap((ext) => {
      const kinds = got.get(`c${CASES.length + TABLE_CASES.length + i}.${ext} Kinds`) ?? [];
      return kinds.length && kinds.every((k) => k === 'Format') ? [] : [`${name}, ${ext}: ${kinds}`];
    }));
    expect(unread).toEqual([]);
    const blocks = BLOCK_FORMAT_CASES.flatMap(([name], i) => {
      const kinds = got.get(`c${bodyCases - MOVE_CASES.length - BLOCK_FORMAT_CASES.length + i}.docx Kinds`) ?? [];
      return kinds.length && kinds.every((k) => k === 'ParagraphFormat') ? [] : [`${name}: ${kinds}`];
    });
    expect(blocks).toEqual([]);
    // LibreOffice read a move as one: saved again, its two halves name one number.
    const unpaired = MOVE_CASES.flatMap(([name], i) => ['odt', 'docx'].flatMap((ext) => {
      const saved = unzipSync(readFileSync(`${DIR}/c${bodyCases - MOVE_CASES.length + i}.${ext}.resaved.odt`));
      const ids = [...strFromU8(saved['content.xml']).matchAll(/<loext:move-id>(\d+)</g)].map((m) => m[1]);
      return ids.length >= 2 && ids.every((id) => ids.filter((o) => o === id).length >= 2) ? [] : [`${name}, ${ext}: ${ids}`];
    }));
    expect(unpaired).toEqual([]);
    // LibreOffice read a comment on a change: saved again, the file holds it.
    const silent = CASES.flatMap(([name], i) => {
      const saved = strFromU8(unzipSync(readFileSync(`${DIR}/c${i}.odt.resaved.odt`))['content.xml']);
      return saved.includes(`</dc:date><text:p>${NOTE}</text:p>`) ? [] : [name];
    });
    expect(silent).toEqual([]);
  });
});
