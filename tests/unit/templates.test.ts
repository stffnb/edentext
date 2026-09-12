// Every built-in template must build schema-valid content in both locales.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { TEMPLATES, SHELVED } from '../../src/lib/templates/registry';
import { setLocale } from '../../src/lib/i18n/i18n.svelte';
import { LOCALES } from '../../src/lib/i18n/config';

const schema = getSchema(extensions);
// Shelved drafts stay validated so they still work when they enter the gallery.
const ALL = [...TEMPLATES, ...SHELVED];

describe('built-in templates', () => {
  it('has unique ids', () => {
    expect(new Set(ALL.map((e) => e.id)).size).toBe(ALL.length);
  });

  for (const loc of LOCALES) {
    it(`builds valid documents (${loc})`, () => {
      setLocale(loc);
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
