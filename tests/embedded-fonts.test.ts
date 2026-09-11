import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../src/lib/export/odt';
import { buildDocx } from '../src/lib/export/docx';
import { importOdt } from '../src/lib/import/odt';
import { importDocx } from '../src/lib/import/docx';
import type { EmbeddedFont } from '../src/lib/fonts/embeddedFonts';

const ttf = (name: string) => new Uint8Array(readFileSync(`src/assets/fonts/${name}`));
const fonts = (): EmbeddedFont[] => [
  { family: 'Probe & Co', weight: 'normal', style: 'normal', data: ttf('LiberationSans-Regular.ttf') },
  { family: 'Probe & Co', weight: 'bold', style: 'italic', data: ttf('LiberationSans-BoldItalic.ttf') },
  { family: 'Zweite', weight: 'normal', style: 'italic', data: ttf('LiberationSerif-Italic.ttf') },
];

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] } as any;
// The fonts ride the last positional argument, after the 18 the two builders share.
const args = (list: EmbeddedFont[]) => [...new Array(18).fill(undefined), list] as any;

const same = (got: EmbeddedFont[], want: EmbeddedFont[]) => {
  expect(got.map((f) => `${f.family}|${f.weight}|${f.style}|${f.data.length}`))
    .toEqual(want.map((f) => `${f.family}|${f.weight}|${f.style}|${f.data.length}`));
  for (let i = 0; i < want.length; i++) expect(Array.from(got[i].data.slice(0, 64))).toEqual(Array.from(want[i].data.slice(0, 64)));
};

describe('embedded fonts survive a save', () => {
  it('round-trips through .odt', async () => {
    const want = fonts();
    const bytes = await buildOdt(doc, ...args(fonts()));
    same(importOdt(bytes).fonts, want);

    // Our own importer reads the package by path; LibreOffice needs the manifest entry.
    const manifest = strFromU8(unzipSync(bytes)['META-INF/manifest.xml']);
    for (let i = 1; i <= want.length; i++) expect(manifest).toContain(`manifest:full-path="Fonts/font${i}.ttf"`);
  });

  it('round-trips through .docx', async () => {
    const want = fonts();
    const bytes = await buildDocx(doc, ...args(fonts()));
    same(importDocx(bytes).fonts, want);

    const files = unzipSync(bytes);
    // Word obfuscates a font part, so the stored bytes are not the font's own header.
    expect(Array.from(files['word/fonts/font1.odttf'].slice(0, 4))).not.toEqual(Array.from(want[0].data.slice(0, 4)));
    expect(strFromU8(files['[Content_Types].xml'])).toContain('Extension="odttf"');
  });

  it('carries a document opened as .docx into an .odt', async () => {
    const want = fonts();
    const read = importDocx(await buildDocx(doc, ...args(fonts())));
    same(importOdt(await buildOdt(read.content as any, ...args(read.fonts))).fonts, want);
  });
});
