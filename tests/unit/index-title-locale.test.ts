// A freshly inserted index is headed in the language the app speaks — and that heading is
// written onto the node, so the exports carry it too rather than the English literal.
import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { indexTitle } from '../../src/lib/editor/extensions/tableOfContents';
import { setLocale } from '../../src/lib/i18n/i18n.svelte';
import { buildOdt } from '../../src/lib/export/odt';

const MARGINS = { top: 2, bottom: 2, left: 2, right: 2 } as never;

describe('index titles', () => {
  it('names each kind in the current language', async () => {
    await setLocale('zh-Hant');
    expect(indexTitle('toc')).toBe('目錄');
    expect(indexTitle('figures')).toBe('圖表目錄');
    await setLocale('de');
    expect(indexTitle('toc')).toBe('Inhaltsverzeichnis');
    await setLocale('en');
    expect(indexTitle('toc')).toBe('Table of contents');
  });

  // The title travels on the node, so an exporter never has to know the UI language.
  it('exports the title the node carries', async () => {
    const doc = { type: 'doc', content: [{ type: 'tableOfContents', attrs: { index: 'toc', title: '目錄' } }] };
    const xml = strFromU8(unzipSync(await buildOdt(doc as never, MARGINS, 'portrait'))['content.xml']);
    // The visible heading, not ODF's own section name (which stays "Table of Contents1").
    expect(xml).toContain('>目錄<');
    expect(xml).not.toContain('>Table of Contents<');
  });
});
