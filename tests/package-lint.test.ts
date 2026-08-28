// Semantic lint over both exported packages: invariants the schemas cannot express
// (unique ids, no dangling references, balanced ranges, complete manifests). This is
// the layer that catches what a consumer resolves differently than we meant.
import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../src/lib/export/docx';
import { buildOdt } from '../src/lib/export/odt';
import { kitchenSinkDoc, kitchenSinkSheet, kitchenSinkOptions } from './kitchenSink';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  return doc;
}

function walk(el: Element, fn: (el: Element) => void) {
  fn(el);
  for (const child of Array.from(el.children)) walk(child, fn);
}

describe('exported packages hold their semantic invariants', () => {
  const opts = kitchenSinkOptions();
  let docx: Record<string, Uint8Array>;
  let odt: Record<string, Uint8Array>;

  beforeAll(async () => {
    const doc = kitchenSinkDoc();
    const sheet = kitchenSinkSheet();
    const args = [doc, undefined, 'portrait', opts.hf, opts.language, 'A4',
      sheet, undefined, 'add', false, opts.notesSettings, opts.props, true,
      opts.pageNumbering, opts.decor, opts.lineNumbering, true, true] as const;
    docx = unzipSync(await buildDocx(...(args as any)));
    odt = unzipSync(await buildOdt(...(args as any)));
  });

  const partXml = (files: Record<string, Uint8Array>, name: string) => strFromU8(files[name]);
  const contentParts = () => Object.keys(docx).filter((n) =>
    /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(n));

  it('DOCX: styles.xml defines every id and name exactly once', () => {
    const styles = parse(partXml(docx, 'word/styles.xml'));
    const ids: string[] = [];
    const names: string[] = [];
    walk(styles.documentElement, (el) => {
      if (el.tagName !== 'w:style') return;
      ids.push(`${el.getAttribute('w:type')}/${el.getAttribute('w:styleId')}`);
      const name = el.getElementsByTagName('w:name')[0]?.getAttribute('w:val');
      if (name) names.push(name);
    });
    // Word resolves duplicates by silently dropping pieces of one definition —
    // this is how exported headings once lost their sans font and bold.
    expect(ids).toEqual([...new Set(ids)]);
    expect(names).toEqual([...new Set(names)]);
    // The ids must also be unique across types: consumers key styles by id alone.
    const bare = ids.map((i) => i.split('/')[1]);
    expect(bare).toEqual([...new Set(bare)]);
    expect(styles.getElementsByTagName('w:docDefaults').length).toBe(1);
  });

  it('DOCX: every style reference names a defined style', () => {
    const styles = parse(partXml(docx, 'word/styles.xml'));
    const defined = new Set<string>();
    walk(styles.documentElement, (el) => {
      if (el.tagName === 'w:style') defined.add(el.getAttribute('w:styleId')!);
    });
    // Word's default table and character styles exist implicitly in every document.
    defined.add('TableNormal');
    defined.add('DefaultParagraphFont');
    const missing: string[] = [];
    const refEls = ['w:pStyle', 'w:rStyle', 'w:tblStyle', 'w:basedOn', 'w:next', 'w:link'];
    for (const part of [...contentParts(), 'word/styles.xml']) {
      walk(parse(partXml(docx, part)).documentElement, (el) => {
        if (!refEls.includes(el.tagName)) return;
        const val = el.getAttribute('w:val');
        if (val && !defined.has(val)) missing.push(`${part}: ${el.tagName}=${val}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it('DOCX: every numbering reference resolves', () => {
    const numbering = parse(partXml(docx, 'word/numbering.xml'));
    const abstracts = new Set<string>();
    const nums = new Set<string>();
    const usedAbstracts = new Set<string>();
    walk(numbering.documentElement, (el) => {
      if (el.tagName === 'w:abstractNum') abstracts.add(el.getAttribute('w:abstractNumId')!);
      if (el.tagName === 'w:num') {
        nums.add(el.getAttribute('w:numId')!);
        const abs = el.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val');
        expect(abs && abstracts.has(abs), `w:num ${el.getAttribute('w:numId')} → abstract ${abs}`).toBe(true);
        usedAbstracts.add(abs!);
      }
    });
    expect([...abstracts].filter((a) => !usedAbstracts.has(a))).toEqual([]);
    const missing: string[] = [];
    for (const part of [...contentParts(), 'word/styles.xml']) {
      walk(parse(partXml(docx, part)).documentElement, (el) => {
        if (el.tagName !== 'w:numId') return;
        const val = el.getAttribute('w:val');
        // val 0 means "no numbering" (it unlinks an inherited reference).
        if (val && val !== '0' && !nums.has(val)) missing.push(`${part}: numId=${val}`);
      });
    }
    expect(missing).toEqual([]);
  });

  it('DOCX: every relationship id and target resolves, every part is typed', () => {
    const problems: string[] = [];
    for (const part of Object.keys(docx)) {
      if (!part.endsWith('.xml') || part.includes('_rels')) continue;
      const dir = part.includes('/') ? part.slice(0, part.lastIndexOf('/')) : '';
      const relsName = `${dir ? dir + '/' : ''}_rels/${part.split('/').pop()}.rels`;
      const rels = docx[relsName] ? parse(strFromU8(docx[relsName])) : null;
      const relIds = new Set<string>();
      if (rels) walk(rels.documentElement, (el) => {
        if (el.tagName !== 'Relationship') return;
        relIds.add(el.getAttribute('Id')!);
        if (el.getAttribute('TargetMode') === 'External') return;
        const target = el.getAttribute('Target')!.replace(/^\//, '');
        const resolved = target.startsWith('..')
          ? target.replace(/^\.\.\//, '') : `${dir ? dir + '/' : ''}${target}`;
        if (!docx[resolved]) problems.push(`${relsName}: target ${target} missing`);
      });
      walk(parse(partXml(docx, part)).documentElement, (el) => {
        for (const attr of Array.from(el.attributes)) {
          if (attr.namespaceURI !== R_NS) continue;
          if (!relIds.has(attr.value)) problems.push(`${part}: ${attr.name}=${attr.value} has no relationship`);
        }
      });
    }
    const types = parse(partXml(docx, '[Content_Types].xml'));
    const defaults = new Set<string>();
    const overrides = new Set<string>();
    walk(types.documentElement, (el) => {
      if (el.tagName === 'Default') defaults.add(el.getAttribute('Extension')!.toLowerCase());
      if (el.tagName === 'Override') overrides.add(el.getAttribute('PartName')!);
    });
    for (const part of Object.keys(docx)) {
      if (part === '[Content_Types].xml' || part.endsWith('/')) continue;
      const ext = part.split('.').pop()!.toLowerCase();
      if (!defaults.has(ext) && !overrides.has(`/${part}`)) problems.push(`untyped part ${part}`);
    }
    expect(problems).toEqual([]);
  });

  it('DOCX: bookmark ranges balance in every part', () => {
    for (const part of contentParts()) {
      const starts = new Set<string>();
      const ends = new Set<string>();
      walk(parse(partXml(docx, part)).documentElement, (el) => {
        if (el.tagName === 'w:bookmarkStart') starts.add(el.getAttribute('w:id')!);
        if (el.tagName === 'w:bookmarkEnd') ends.add(el.getAttribute('w:id')!);
      });
      expect([...starts].sort(), part).toEqual([...ends].sort());
    }
  });

  it('ODT: every style reference names a defined style', () => {
    const content = parse(partXml(odt, 'content.xml'));
    const styles = parse(partXml(odt, 'styles.xml'));
    const defined = new Set<string>();
    for (const root of [content.documentElement, styles.documentElement]) {
      walk(root, (el) => {
        const name = el.getAttribute('style:name');
        if (name) defined.add(name);
      });
    }
    const refAttrs = new Set([
      'text:style-name', 'table:style-name', 'draw:style-name', 'draw:text-style-name',
      'style:parent-style-name', 'style:next-style-name', 'style:list-style-name',
      'style:master-page-name', 'style:page-layout-name', 'style:data-style-name',
      'text:visited-style-name', 'text:citation-style-name', 'text:citation-body-style-name',
      'text:default-style-name',
    ]);
    const missing: string[] = [];
    for (const [part, root] of [['content.xml', content], ['styles.xml', styles]] as const) {
      walk(root.documentElement, (el) => {
        for (const attr of Array.from(el.attributes)) {
          if (!refAttrs.has(attr.name) || !attr.value) continue;
          if (!defined.has(attr.value)) missing.push(`${part}: <${el.tagName} ${attr.name}="${attr.value}">`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it('ODT: the manifest and the package agree', () => {
    const manifest = parse(partXml(odt, 'META-INF/manifest.xml'));
    const listed = new Set<string>();
    walk(manifest.documentElement, (el) => {
      if (el.tagName === 'manifest:file-entry') listed.add(el.getAttribute('manifest:full-path')!);
    });
    const problems: string[] = [];
    for (const name of Object.keys(odt)) {
      if (name === 'mimetype' || name.startsWith('META-INF/')) continue;
      // A sub-document (Formula1/) is listed as its directory entry.
      if (!listed.has(name) && !listed.has(name.split('/')[0] + '/')) problems.push(`unlisted ${name}`);
    }
    for (const entry of listed) {
      if (entry === '/' || entry.endsWith('/')) continue;
      if (!odt[entry]) problems.push(`listed but missing ${entry}`);
    }
    expect(problems).toEqual([]);
  });

  it('ODT: internal targets, ranges and change ids resolve', () => {
    const content = parse(partXml(odt, 'content.xml'));
    const problems: string[] = [];
    const bkStarts = new Set<string>();
    const bkEnds = new Set<string>();
    const annStarts = new Set<string>();
    const annEnds = new Set<string>();
    const changeRegions = new Set<string>();
    const changeRefs = new Set<string>();
    walk(content.documentElement, (el) => {
      const href = el.getAttribute('xlink:href');
      if (href && !/^[a-z]+:|^#/.test(href)) {
        // A formula object's href names its sub-document directory.
        const path = href.replace(/^\.\//, '');
        if (!odt[path] && !odt[`${path}/content.xml`]) problems.push(`dangling xlink:href ${href}`);
      }
      if (el.tagName === 'text:bookmark-start') bkStarts.add(el.getAttribute('text:name')!);
      if (el.tagName === 'text:bookmark-end') bkEnds.add(el.getAttribute('text:name')!);
      if (el.tagName === 'office:annotation') annStarts.add(el.getAttribute('office:name') ?? '');
      if (el.tagName === 'office:annotation-end') annEnds.add(el.getAttribute('office:name')!);
      if (el.tagName === 'text:changed-region') changeRegions.add(el.getAttribute('xml:id') ?? el.getAttribute('text:id')!);
      const chId = el.getAttribute('text:change-id');
      if (chId) changeRefs.add(chId);
    });
    expect([...bkStarts].sort()).toEqual([...bkEnds].sort());
    // A point annotation has no end; every end must name a start.
    expect([...annEnds].filter((n) => !annStarts.has(n))).toEqual([]);
    expect([...changeRefs].filter((id) => !changeRegions.has(id))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
