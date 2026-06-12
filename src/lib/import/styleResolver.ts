import type { PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';

// Resolves ODF style indirection for the importer: every producer (our export,
// LibreOffice re-saves, Word) spreads formatting across named styles, automatic
// styles, and parent-style-name chains. This module flattens those chains into
// per-style property maps so import/odt.ts can read effective values directly.

export const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
} as const;

// Property keys are stored as "alias:localName" for the namespaces we care
// about; attributes from other namespaces are dropped.
const ALIAS_BY_URI = new Map<string, string>(Object.entries(NS).map(([alias, uri]) => [uri, alias]));

export type PropMap = Record<string, string>;

type StyleEntry = {
  parent: string | null;
  text: PropMap; // style:text-properties
  para: PropMap; // style:paragraph-properties
  misc: PropMap; // table-column / table-row / table-cell properties
};

// ---- length units -----------------------------------------------------------

const PT_PER_UNIT: Record<string, number> = {
  pt: 1,
  cm: 72 / 2.54,
  mm: 72 / 25.4,
  in: 72,
  px: 72 / 96,
  pc: 12,
};

export function lengthToPt(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(-?[\d.]+)\s*(pt|cm|mm|in|px|pc)?$/.exec(s.trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  return v * PT_PER_UNIT[m[2] ?? 'pt'];
}

export function lengthToCm(s: string | null | undefined): number | null {
  const pt = lengthToPt(s);
  return pt == null ? null : (pt / 72) * 2.54;
}

// Layer text props, treating the two font attrs (fo:font-family /
// style:font-name) as one logical property: whichever form the nearer style
// uses must shadow both inherited forms.
export function layerTextProps(base: PropMap, over: PropMap): PropMap {
  const out = { ...base };
  if ('fo:font-family' in over || 'style:font-name' in over) {
    delete out['fo:font-family'];
    delete out['style:font-name'];
  }
  return Object.assign(out, over);
}

// ---- resolver ----------------------------------------------------------------

function collectProps(el: Element, propsLocalName: string, into: PropMap): void {
  for (const child of Array.from(el.children)) {
    if (child.namespaceURI !== NS.style || child.localName !== propsLocalName) continue;
    for (const attr of Array.from(child.attributes)) {
      const alias = attr.namespaceURI ? ALIAS_BY_URI.get(attr.namespaceURI) : undefined;
      if (alias) into[`${alias}:${attr.localName}`] = attr.value;
    }
  }
}

function entryFromStyleElement(el: Element): StyleEntry {
  const entry: StyleEntry = {
    parent: el.getAttributeNS(NS.style, 'parent-style-name'),
    text: {},
    para: {},
    misc: {},
  };
  collectProps(el, 'text-properties', entry.text);
  collectProps(el, 'paragraph-properties', entry.para);
  collectProps(el, 'table-column-properties', entry.misc);
  collectProps(el, 'table-row-properties', entry.misc);
  collectProps(el, 'table-cell-properties', entry.misc);
  return entry;
}

export class StyleResolver {
  // (family + '\0' + name) → entry; later registrations win (content.xml
  // automatic styles override styles.xml ones on name collision).
  private styles = new Map<string, StyleEntry>();
  private defaults = new Map<string, StyleEntry>(); // family → style:default-style
  private fontFaces = new Map<string, string>();    // style:name → first font-family
  private listStyles = new Map<string, Element>();  // style:name → text:list-style
  private mergedCache = new Map<string, { text: PropMap; para: PropMap; misc: PropMap }>();
  private stylesDoc: Document | null;

  constructor(contentDoc: Document, stylesDoc: Document | null) {
    this.stylesDoc = stylesDoc;
    // Scan order (later wins): styles.xml named → styles.xml automatic →
    // content.xml named → content.xml automatic.
    const containers: Element[] = [];
    for (const doc of [stylesDoc, contentDoc]) {
      if (!doc) continue;
      for (const local of ['styles', 'automatic-styles']) {
        const el = doc.getElementsByTagNameNS(NS.office, local)[0];
        if (el) containers.push(el);
      }
      const fontDecls = doc.getElementsByTagNameNS(NS.office, 'font-face-decls')[0];
      if (fontDecls) this.scanFontFaces(fontDecls);
    }
    for (const c of containers) this.scanContainer(c);
  }

  private scanFontFaces(container: Element): void {
    for (const el of Array.from(container.children)) {
      if (el.namespaceURI !== NS.style || el.localName !== 'font-face') continue;
      const name = el.getAttributeNS(NS.style, 'name');
      const family = el.getAttributeNS(NS.svg, 'font-family');
      if (name && family) {
        // svg:font-family may be a quoted list: 'Liberation Serif', 'Times New Roman'
        const first = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        if (first) this.fontFaces.set(name, first);
      }
    }
  }

  private scanContainer(container: Element): void {
    for (const el of Array.from(container.children)) {
      if (el.namespaceURI === NS.style && el.localName === 'style') {
        const name = el.getAttributeNS(NS.style, 'name');
        const family = el.getAttributeNS(NS.style, 'family');
        if (name && family) this.styles.set(`${family}\0${name}`, entryFromStyleElement(el));
      } else if (el.namespaceURI === NS.style && el.localName === 'default-style') {
        const family = el.getAttributeNS(NS.style, 'family');
        if (family) this.defaults.set(family, entryFromStyleElement(el));
      } else if (el.namespaceURI === NS.text && el.localName === 'list-style') {
        const name = el.getAttributeNS(NS.style, 'name');
        if (name) this.listStyles.set(name, el);
      }
    }
  }

  // Flattened props along the parent chain (nearest wins), rooted in the
  // family's default style.
  private merged(family: string, name: string): { text: PropMap; para: PropMap; misc: PropMap } {
    const cacheKey = `${family}\0${name}`;
    const hit = this.mergedCache.get(cacheKey);
    if (hit) return hit;

    const chain: StyleEntry[] = [];
    const seen = new Set<string>();
    let cur: string | null = name;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const entry = this.styles.get(`${family}\0${cur}`);
      if (!entry) break;
      chain.push(entry);
      cur = entry.parent;
    }
    const def = this.defaults.get(family);
    if (def) chain.push(def);

    const result = { text: {} as PropMap, para: {} as PropMap, misc: {} as PropMap };
    // Apply root-first so nearer definitions overwrite.
    for (const entry of chain.reverse()) {
      result.text = layerTextProps(result.text, entry.text);
      Object.assign(result.para, entry.para);
      Object.assign(result.misc, entry.misc);
    }
    this.mergedCache.set(cacheKey, result);
    return result;
  }

  // Effective text props of a paragraph/heading style (runs without character
  // styles inherit these).
  paraTextProps(styleName: string | null): PropMap {
    return styleName ? this.merged('paragraph', styleName).text : (this.defaults.get('paragraph')?.text ?? {});
  }

  // Effective paragraph-layout props (alignment, margins, line-height).
  paraProps(styleName: string | null): PropMap {
    return styleName ? this.merged('paragraph', styleName).para : (this.defaults.get('paragraph')?.para ?? {});
  }

  // Explicitly-set text props of a character (text:span) style chain; layered
  // over the paragraph's by the importer.
  spanTextProps(styleName: string | null): PropMap {
    return styleName ? this.merged('text', styleName).text : {};
  }

  // Resolve a text-props map's font: fo:font-family wins, else style:font-name
  // through the font-face declarations.
  fontFamilyOf(props: PropMap): string | null {
    const fam = props['fo:font-family'];
    if (fam) return fam.split(',')[0].trim().replace(/^['"]|['"]$/g, '') || null;
    const name = props['style:font-name'];
    if (name) return this.fontFaces.get(name) ?? name;
    return null;
  }

  columnWidthCm(styleName: string | null): number | null {
    if (!styleName) return null;
    return lengthToCm(this.merged('table-column', styleName).misc['style:column-width']);
  }

  // style:rel-column-width="21846*" — LibreOffice's proportional column form.
  columnRelWidth(styleName: string | null): number | null {
    if (!styleName) return null;
    const raw = this.merged('table-column', styleName).misc['style:rel-column-width'];
    if (!raw) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  rowMinHeightCm(styleName: string | null): number | null {
    if (!styleName) return null;
    return lengthToCm(this.merged('table-row', styleName).misc['style:min-row-height']);
  }

  listStyle(name: string | null): Element | null {
    return name ? this.listStyles.get(name) ?? null : null;
  }

  // Page margins + orientation from the first master page's page layout.
  // Page *size* is intentionally ignored — the editor is A4-only.
  pageGeometry(): { margins: PageMargins; orientation: Orientation } | null {
    const doc = this.stylesDoc;
    if (!doc) return null;
    const masterPage = doc.getElementsByTagNameNS(NS.style, 'master-page')[0];
    const layoutName = masterPage?.getAttributeNS(NS.style, 'page-layout-name');
    if (!layoutName) return null;
    let props: Element | null = null;
    for (const layout of Array.from(doc.getElementsByTagNameNS(NS.style, 'page-layout'))) {
      if (layout.getAttributeNS(NS.style, 'name') === layoutName) {
        props = layout.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0] ?? null;
        break;
      }
    }
    if (!props) return null;

    const cm = (attr: string, fallback: number) => {
      const v = lengthToCm(props.getAttributeNS(NS.fo, attr));
      if (v == null) return fallback;
      return Math.min(10, Math.max(0, Math.round(v * 100) / 100));
    };
    const margins: PageMargins = {
      top: cm('margin-top', 2.54),
      bottom: cm('margin-bottom', 2.54),
      left: cm('margin-left', 2.12),
      right: cm('margin-right', 2.12),
    };
    const w = lengthToCm(props.getAttributeNS(NS.fo, 'page-width'));
    const h = lengthToCm(props.getAttributeNS(NS.fo, 'page-height'));
    const orientation: Orientation = w != null && h != null && w > h ? 'landscape' : 'portrait';
    return { margins, orientation };
  }
}
