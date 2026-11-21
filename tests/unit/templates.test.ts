// Every built-in template must build schema-valid content in every locale.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { TEMPLATES, SHELVED } from '../../src/lib/templates/registry';
import { setLocale } from '../../src/lib/i18n/i18n.svelte';
import { LOCALES } from '../../src/lib/i18n/config';
import { loadHostConfig, pickText, setEmbedHostConfig, templateOffer } from '../../src/lib/storage/hostConfig.svelte';

const schema = getSchema(extensions);
// Shelved drafts stay validated so they still work when they enter the gallery.
const ALL = [...TEMPLATES, ...SHELVED];

describe('built-in templates', () => {
  it('has unique ids', async () => {
    expect(new Set(ALL.map((e) => e.id)).size).toBe(ALL.length);
  });

  for (const loc of LOCALES) {
    it(`builds valid documents (${loc})`, async () => {
      await setLocale(loc);
      for (const entry of ALL) {
        expect(entry.name(), entry.id).toBeTruthy();
        expect(entry.description(), entry.id).toBeTruthy();
        const data = entry.build();
        const doc = PMNode.fromJSON(schema, data.content);
        expect(() => doc.check(), entry.id).not.toThrow();
        // A template's point is its placeholder fields; an empty one is a build bug.
        let fields = 0;
        doc.descendants((n) => { if (n.type.name === 'placeholderField') fields++; });
        expect(fields, entry.id).toBeGreaterThan(0);
      }
    });
  }
});

describe('installation templates', () => {
  const serve = (config: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(config))));
  afterEach(async () => { setEmbedHostConfig('templates', true); serve({}); await loadHostConfig(); vi.unstubAllGlobals(); });

  it('keeps the valid entries of a partly broken or hostile section', async () => {
    serve({ templates: { builtIn: false, save: 'no', extra: 1, items: [
      { id: 'letter', name: { de: 'Brief', en: 'Letter', 'x y': 'bad' }, description: 'With logo', url: 'tpl/letter.ott', preview: 'tpl/letter.png', evil: 1 },
      { url: 'https://cdn.example.org/a/Report%20A.dotx' },
      { url: 'javascript:alert(1)//x.ott' }, { url: 'file:///etc/x.ott' }, { url: 'tpl/notes.txt' }, { name: 'no file' },
      { id: 'letter', url: 'tpl/again.ott' }, { url: 'tpl/x.odt', bytes: new ArrayBuffer(1) }, { fileName: 'b.ott', bytes: [1] }, 'junk', null,
    ] } });
    await loadHostConfig();
    const offer = templateOffer(false);
    expect(offer).toMatchObject({ gallery: true, builtIn: false, save: true });
    expect(offer.items).toEqual([
      { id: 'letter', name: { de: 'Brief', en: 'Letter' }, description: 'With logo', fileName: 'letter.ott',
        url: new URL('tpl/letter.ott', document.baseURI).href, preview: new URL('tpl/letter.png', document.baseURI).href },
      { id: 'https://cdn.example.org/a/Report%20A.dotx', name: 'Report A', fileName: 'Report A.dotx', url: 'https://cdn.example.org/a/Report%20A.dotx' },
      { id: new URL('tpl/x.odt', document.baseURI).href, name: 'x', fileName: 'x.odt', url: new URL('tpl/x.odt', document.baseURI).href },
    ]);
    serve({ templates: { items: Array.from({ length: 80 }, (_, i) => ({ url: `t${i}.ott` })) } });
    await loadHostConfig();
    expect(templateOffer(false).items).toHaveLength(50);
  });

  it('switches the commands as the installation and an embedding host say', async () => {
    serve({ templates: { save: false, builtIn: false } });
    await loadHostConfig();
    expect(templateOffer(false)).toMatchObject({ gallery: false, save: false });
    serve({ templates: { enabled: false, items: [{ url: 'a.ott' }] } });
    await loadHostConfig();
    expect(templateOffer(false)).toMatchObject({ gallery: false, save: false });
    serve({ templates: { items: [{ url: 'a.ott' }] } });
    await loadHostConfig();
    // Embedded: nothing without the host's own option, never Save as Template.
    expect(templateOffer(true)).toMatchObject({ gallery: false, save: false });
    setEmbedHostConfig('templates', { builtIn: true });
    expect(templateOffer(true)).toMatchObject({ gallery: true, builtIn: true, save: false, items: [{ fileName: 'a.ott' }] });
    setEmbedHostConfig('templates', { items: [{ id: 'own', fileName: 'own.dotx', bytes: new Uint8Array([1, 2]) }] });
    expect(templateOffer(true)).toMatchObject({ gallery: true, builtIn: false, items: [{ id: 'own', name: 'own' }] });
    expect(templateOffer(false).items.map((e) => e.id)).toEqual(['own']);
    setEmbedHostConfig('templates', false);
    expect(templateOffer(false).gallery).toBe(false);
  });

  it.each([
    ['de-AT', 'Brief'], ['pt-BR', 'Carta (BR)'], ['pt-PT', 'Carta'], ['fr', 'Letter'], ['zh-Hant', 'Letter'],
  ])('names an entry for %s', (locale, name) => {
    expect(pickText({ de: 'Brief', 'pt-BR': 'Carta (BR)', 'pt-PT': 'Carta', en: 'Letter' }, locale)).toBe(name);
    expect(pickText({ ja: '手紙' }, locale)).toBe('手紙');
  });
});
