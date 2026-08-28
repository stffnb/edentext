// Validates the kitchen-sink exports against the vendored OOXML XSDs and the ODF 1.2
// RelaxNG (tests/schemas/) — the structural half of what Word's strict reader enforces
// and LibreOffice silently forgives. Self-skips without xmllint on PATH.
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { buildOdt } from '../src/lib/export/odt';
import { buildDocx } from '../src/lib/export/docx';
import { kitchenSinkDoc, kitchenSinkSheet, kitchenSinkOptions } from './kitchenSink';

const hasXmllint = spawnSync('xmllint', ['--version']).status === 0;
const SCHEMAS = resolve(__dirname, 'schemas');
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
// A DrawingML text box (wps:wsp inside a:graphicData) is post-ECMA-376 Microsoft
// markup Word accepts natively; no ECMA schema covers it, so it is stripped like an
// ignorable — its inner w:p content is exercised by the body paragraphs instead.
const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';

// The namespaces the ODF 1.2 schema defines. Anything else (loext, …) is a foreign
// element/attribute an "extended conforming" consumer removes before validating.
const ODF_NS = new Set([
  'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:chart:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:dr3d:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:form:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:script:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:config:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:database:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:animation:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0',
  'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  'http://purl.org/dc/elements/1.1/',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2002/xforms',
  'http://www.w3.org/2003/g/data-view#',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
]);

// Removes foreign elements and attributes: keep what `keep(ns)` allows, drop the rest.
// For OOXML `keep` is "not declared mc:Ignorable"; for ODF it is the ODF_NS whitelist.
function stripForeign(xml: string, keep: (ns: string | null) => boolean): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const prune = (el: Element): void => {
    for (const child of [...el.children]) {
      if (child.namespaceURI === MC_NS && child.localName === 'AlternateContent') {
        // An ECMA-376-only consumer takes the Fallback branch.
        const fb = [...child.children].find(
          (c) => c.namespaceURI === MC_NS && c.localName === 'Fallback');
        for (const inner of fb ? [...fb.children] : []) el.insertBefore(inner, child);
        el.removeChild(child);
        continue;
      }
      if (!keep(child.namespaceURI)) { el.removeChild(child); continue; }
      prune(child);
    }
    for (const attr of [...el.attributes]) {
      if (attr.namespaceURI === MC_NS
        || (attr.namespaceURI && !keep(attr.namespaceURI))) el.removeAttributeNode(attr);
    }
  };
  prune(doc.documentElement);
  return new XMLSerializer().serializeToString(doc);
}

// The namespace URIs a part's root declares mc:Ignorable — an MCE consumer removes
// their elements and attributes before schema validation, exactly as Word reads them.
function mceIgnorable(xml: string): Set<string> {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.documentElement;
  const out = new Set<string>([MC_NS]);
  const ig = root.getAttributeNS(MC_NS, 'Ignorable') ?? '';
  for (const prefix of ig.trim().split(/\s+/).filter(Boolean)) {
    const uri = root.getAttribute(`xmlns:${prefix}`);
    if (uri) out.add(uri);
  }
  out.add(WPS_NS);
  return out;
}

let tmp: string;
function validate(schema: string, kind: 'xsd' | 'rng', xml: string, label: string): string | null {
  const file = join(tmp, `${label.replace(/[^\w.-]+/g, '_')}.xml`);
  writeFileSync(file, xml);
  const flag = kind === 'xsd' ? '--schema' : '--relaxng';
  const r = spawnSync('xmllint', ['--noout', '--nonet', flag, join(SCHEMAS, schema), file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return null;
  return `${label} (${schema}):\n${(r.stderr || r.stdout || `exit ${r.status}`).slice(0, 4000)}`;
}

describe.skipIf(!hasXmllint)('exported XML validates against the format schemas', () => {
  const opts = kitchenSinkOptions();
  let odt: Record<string, Uint8Array>;
  let docx: Record<string, Uint8Array>;

  beforeAll(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'edentext-schema-'));
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
    const failures: string[] = [];
    const keepOdf = (ns: string | null) => ns == null || ODF_NS.has(ns);
    for (const [name, bytes] of Object.entries(odt)) {
      const isDoc = /^(content|styles|meta|settings)\.xml$/.test(name);
      const isManifest = name === 'META-INF/manifest.xml';
      // Formula sub-documents root math:math, which the schema's start pattern
      // excludes; mimetype and Pictures/ are not XML.
      if (!isDoc && !isManifest) continue;
      const schema = isManifest
        ? 'odf/OpenDocument-v1.3-manifest-schema.rng' : 'odf/OpenDocument-v1.3-schema.rng';
      const fail = validate(schema, 'rng', stripForeign(strFromU8(bytes), keepOdf), `odt ${name}`);
      if (fail) failures.push(fail);
    }
    expect(Object.keys(odt)).toContain('content.xml');
    expect(failures.join('\n\n')).toBe('');
  });

  it('every DOCX part is schema-valid after MCE resolution, as Word reads it', () => {
    const partSchema = (name: string): string | null => {
      if (/^word\/(document|styles|numbering|settings|fontTable|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$/.test(name)) return 'ooxml/wml.xsd';
      if (name === 'docProps/core.xml') return 'opc/opc-coreProperties.xsd';
      if (name === 'docProps/app.xml') return 'ooxml/shared-documentPropertiesExtended.xsd';
      if (name === 'docProps/custom.xml') return 'ooxml/shared-documentPropertiesCustom.xsd';
      // commentsExtended is a Microsoft w15 part with no ECMA-376 schema.
      if (name === 'word/commentsExtended.xml') return null;
      if (name === '[Content_Types].xml') return 'opc/opc-contentTypes.xsd';
      if (/(^|\/)_rels\/[^/]+$/.test(name)) return 'opc/opc-relationships.xsd';
      if (/^customXml\/itemProps\d+\.xml$/.test(name)) return 'ooxml/shared-customXmlDataProperties.xsd';
      if (/^customXml\/item\d+\.xml$/.test(name)) return 'ooxml/shared-bibliography.xsd';
      if (/^word\/(media|fonts)\//.test(name)) return null; // binary
      return `UNMAPPED:${name}`; // a new part must be mapped or listed here
    };
    const failures: string[] = [];
    for (const [name, bytes] of Object.entries(docx)) {
      if (name.endsWith('/')) continue; // zip directory entry
      const schema = partSchema(name);
      if (schema == null) continue;
      if (schema.startsWith('UNMAPPED:')) { failures.push(schema); continue; }
      const xml = strFromU8(bytes);
      const ignorable = mceIgnorable(xml);
      const fail = validate(schema, 'xsd', stripForeign(xml, (ns) => !ns || !ignorable.has(ns)), `docx ${name}`);
      if (fail) failures.push(fail);
    }
    expect(Object.keys(docx)).toContain('word/document.xml');
    expect(failures.join('\n\n')).toBe('');
  });
});
