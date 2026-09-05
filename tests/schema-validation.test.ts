// The kitchen-sink exports (every feature at once) against the format schemas —
// tests/schemaValidate.ts does the work; the fuzz leg runs the same check over seeds.
import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync } from 'fflate';
import { buildOdt } from '../src/lib/export/odt';
import { buildDocx } from '../src/lib/export/docx';
import { kitchenSinkDoc, kitchenSinkSheet, kitchenSinkOptions } from './kitchenSink';
import { hasXmllint, validateOdt, validateDocx } from './schemaValidate';

describe.skipIf(!hasXmllint)('exported XML validates against the format schemas', () => {
  const opts = kitchenSinkOptions();
  let odt: Record<string, Uint8Array>;
  let docx: Record<string, Uint8Array>;

  beforeAll(async () => {
    const doc = kitchenSinkDoc();
    const sheet = kitchenSinkSheet();
    odt = unzipSync(await buildOdt(doc, undefined, 'portrait', opts.hf, opts.language, 'A4',
      sheet, undefined, 'add', false, opts.notesSettings, opts.props, true,
      opts.pageNumbering, opts.decor, opts.lineNumbering, true, true));
    docx = unzipSync(await buildDocx(doc, undefined, 'portrait', opts.hf, opts.language, 'A4',
      sheet, undefined, 'add', false, opts.notesSettings, opts.props, true,
      opts.pageNumbering, opts.decor, opts.lineNumbering, true, true));
  });

  it('every ODF part is schema-valid (foreign namespaces stripped, as extended conformance allows)', () => {
    expect(Object.keys(odt)).toContain('content.xml');
    expect(validateOdt(odt).join('\n\n')).toBe('');
  });

  it('every DOCX part is schema-valid after MCE resolution, as Word reads it', () => {
    expect(Object.keys(docx)).toContain('word/document.xml');
    expect(validateDocx(docx).join('\n\n')).toBe('');
  });
});
