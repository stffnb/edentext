import type { PageMargins } from '../storage/pageMargins';
import type { Orientation } from '../storage/pageOrientation';
import { formatFromCm, type PageFormat } from '../storage/pageFormat';

// Resolves ODF style indirection for the importer: producers (our export, LibreOffice,
// Word) spread formatting across named/automatic styles and parent-style-name chains.
// This flattens those into per-style property maps so import/odt.ts reads effective values.

export const NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
  number: 'urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0',
  loext: 'urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0',
} as const;

// One embedded-font binary referenced from a <style:font-face>: the CSS family runs use,
// the package href of the font file, and the face's weight/style.
export interface EmbeddedFontSource {
  family: string;
  href: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
}

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
  collectProps(el, 'graphic-properties', entry.misc);
  return entry;
}

export class StyleResolver {
  // (family + '\0' + name) → entry; later registrations win (content.xml
  // automatic styles override styles.xml ones on name collision).
  private styles = new Map<string, StyleEntry>();
  private defaults = new Map<string, StyleEntry>(); // family → style:default-style
  private fontFaces = new Map<string, string>();    // style:name → first font-family
  private fontSources: EmbeddedFontSource[] = [];   // embedded font binaries
  private listStyles = new Map<string, Element>();  // style:name → text:list-style
  private numberStyles = new Map<string, Element>(); // style:name → number:date/time-style
  // Section styles kept as raw elements: <style:columns> is a child element of
  // <style:section-properties>, which the attribute-only StyleEntry drops.
  private sectionStyleEls = new Map<string, Element>();
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
      if (!name) continue;
      // svg:font-family may be a quoted list: 'Liberation Serif', 'Times New Roman'
      const family = el.getAttributeNS(NS.svg, 'font-family');
      const first = family ? family.split(',')[0].trim().replace(/^['"]|['"]$/g, '') : '';
      if (first) this.fontFaces.set(name, first);
      const cssFamily = first || name;
      for (const uri of Array.from(el.getElementsByTagNameNS(NS.svg, 'font-face-uri'))) {
        const href = uri.getAttributeNS(NS.xlink, 'href');
        if (!href) continue;
        const weight = uri.getAttributeNS(NS.loext, 'font-weight') === 'bold' ? 'bold' : 'normal';
        const style = uri.getAttributeNS(NS.loext, 'font-style') === 'italic' ? 'italic' : 'normal';
        this.fontSources.push({ family: cssFamily, href, weight, style });
      }
    }
  }

  // Embedded font binaries (one per <svg:font-face-uri>); importOdt maps href → bytes.
  embeddedFontSources(): readonly EmbeddedFontSource[] {
    return this.fontSources;
  }

  private scanContainer(container: Element): void {
    for (const el of Array.from(container.children)) {
      if (el.namespaceURI === NS.style && el.localName === 'style') {
        const name = el.getAttributeNS(NS.style, 'name');
        const family = el.getAttributeNS(NS.style, 'family');
        if (name && family) this.styles.set(`${family}\0${name}`, entryFromStyleElement(el));
        if (name && family === 'section') this.sectionStyleEls.set(name, el);
      } else if (el.namespaceURI === NS.style && el.localName === 'default-style') {
        const family = el.getAttributeNS(NS.style, 'family');
        if (family) this.defaults.set(family, entryFromStyleElement(el));
      } else if (el.namespaceURI === NS.text && el.localName === 'list-style') {
        const name = el.getAttributeNS(NS.style, 'name');
        if (name) this.listStyles.set(name, el);
      } else if (el.namespaceURI === NS.number && (el.localName === 'date-style' || el.localName === 'time-style')) {
        const name = el.getAttributeNS(NS.style, 'name');
        if (name) this.numberStyles.set(name, el);
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

  // Graphic-properties of a draw:frame's style (style:wrap, positioning, …).
  graphicProps(styleName: string | null): PropMap {
    return styleName ? this.merged('graphic', styleName).misc : {};
  }

  // The document's default spell-check language, read from the base Standard
  // paragraph style (falls back to the paragraph default-style). null when unset.
  documentLanguage(): { language: string; country: string } | null {
    const props = this.merged('paragraph', 'Standard').text;
    const language = props['fo:language'];
    if (!language || language === 'none') return null;
    return { language, country: props['fo:country'] ?? '' };
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

  // A cell style's fo:background-color (cell shading). null when none/transparent.
  cellBackgroundColor(styleName: string | null): string | null {
    if (!styleName) return null;
    const c = this.merged('table-cell', styleName).misc['fo:background-color'];
    return c && c !== 'transparent' && c !== 'none' ? c : null;
  }

  // A cell style's raw fo:border-* values (per-side overriding the fo:border
  // shorthand). Sides the style doesn't declare stay undefined (= no border in ODF).
  cellBorders(styleName: string | null): Partial<Record<'top' | 'right' | 'bottom' | 'left', string>> {
    if (!styleName) return {};
    const misc = this.merged('table-cell', styleName).misc;
    const all = misc['fo:border'];
    const pick = (side: string) => misc[`fo:border-${side}`] ?? all;
    const out: Partial<Record<'top' | 'right' | 'bottom' | 'left', string>> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const v = pick(side);
      if (v != null) out[side] = v;
    }
    return out;
  }

  listStyle(name: string | null): Element | null {
    return name ? this.listStyles.get(name) ?? null : null;
  }

  // The <number:date-style>/<number:time-style> element a date/time field references.
  numberStyle(name: string | null): Element | null {
    return name ? this.numberStyles.get(name) ?? null : null;
  }

  // A section style's column layout: { count, gapCm } when it declares more than one
  // column, else null.
  sectionColumns(name: string | null): { count: number; gapCm: number } | null {
    const el = name ? this.sectionStyleEls.get(name) : null;
    const props = el?.getElementsByTagNameNS(NS.style, 'section-properties')[0];
    return this.columnsFrom(props ?? null);
  }

  // Column layout of the master page's page layout — Word-produced files put
  // whole-document columns here instead of in a text:section.
  pageColumns(): { count: number; gapCm: number } | null {
    return this.columnsFrom(this.pageLayoutEl()?.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0] ?? null);
  }

  // <style:columns> under a properties element: { count, gapCm } when it declares more
  // than one column, else null. The gap falls back to LibreOffice's per-column indent
  // form (first column's fo:end-indent + second's fo:start-indent).
  private columnsFrom(props: Element | null): { count: number; gapCm: number } | null {
    const cols = props?.getElementsByTagNameNS(NS.style, 'columns')[0];
    if (!cols) return null;
    const count = parseInt(cols.getAttributeNS(NS.fo, 'column-count') ?? '', 10);
    if (!Number.isFinite(count) || count <= 1) return null;
    let gap = lengthToCm(cols.getAttributeNS(NS.fo, 'column-gap'));
    if (gap == null) {
      const colEls = Array.from(cols.getElementsByTagNameNS(NS.style, 'column'));
      if (colEls.length >= 2) {
        const end = lengthToCm(colEls[0].getAttributeNS(NS.fo, 'end-indent')) ?? 0;
        const start = lengthToCm(colEls[1].getAttributeNS(NS.fo, 'start-indent')) ?? 0;
        if (end + start > 0) gap = end + start;
      }
    }
    const gapCm = Math.min(5, Math.max(0, gap ?? 0.5));
    return { count, gapCm: Math.round(gapCm * 100) / 100 };
  }

  // The master page governing the document (prefer "Standard", else the first).
  private masterPageEl(): Element | null {
    const doc = this.stylesDoc;
    if (!doc) return null;
    const pages = Array.from(doc.getElementsByTagNameNS(NS.style, 'master-page'));
    return pages.find(p => p.getAttributeNS(NS.style, 'name') === 'Standard') ?? pages[0] ?? null;
  }

  private pageLayoutEl(): Element | null {
    const doc = this.stylesDoc;
    const layoutName = this.masterPageEl()?.getAttributeNS(NS.style, 'page-layout-name');
    if (!doc || !layoutName) return null;
    for (const layout of Array.from(doc.getElementsByTagNameNS(NS.style, 'page-layout'))) {
      if (layout.getAttributeNS(NS.style, 'name') === layoutName) return layout;
    }
    return null;
  }

  // Header/footer of the master page: the content elements, the vertical space the
  // zone occupies below/above the page margin (height + body-side spacing, for the
  // Word-style body-margin reconstruction), and whether per-page variants exist.
  masterPageHF(): {
    header: Element | null;
    footer: Element | null;
    headerFirst: Element | null;
    footerFirst: Element | null;
    headerExtraCm: number;
    footerExtraCm: number;
    hasVariants: boolean;
  } {
    const mp = this.masterPageEl();
    const layout = this.pageLayoutEl();

    const zone = (local: string): Element | null => {
      if (!mp) return null;
      for (const child of Array.from(mp.children)) {
        if (child.namespaceURI === NS.style && child.localName === local) return child;
      }
      return null;
    };
    // header-first/footer-first (ODF 1.3 style: or older LibreOffice loext:) — match
    // by local name in either namespace so both producers round-trip.
    const firstZone = (local: string): Element | null => {
      if (!mp) return null;
      for (const child of Array.from(mp.children)) {
        if (child.localName === local && (child.namespaceURI === NS.style || child.namespaceURI === NS.loext)) return child;
      }
      return null;
    };
    const extraCm = (local: 'header-style' | 'footer-style', spacingAttr: 'margin-bottom' | 'margin-top'): number => {
      if (!layout) return 0;
      let props: Element | null = null;
      for (const child of Array.from(layout.children)) {
        if (child.namespaceURI === NS.style && child.localName === local) {
          props = child.getElementsByTagNameNS(NS.style, 'header-footer-properties')[0] ?? null;
          break;
        }
      }
      if (!props) return 0;
      const height = lengthToCm(props.getAttributeNS(NS.svg, 'height'))
        ?? lengthToCm(props.getAttributeNS(NS.fo, 'min-height'))
        ?? 0;
      const spacing = lengthToCm(props.getAttributeNS(NS.fo, spacingAttr)) ?? 0;
      return height + spacing;
    };

    return {
      header: zone('header'),
      footer: zone('footer'),
      headerFirst: firstZone('header-first'),
      footerFirst: firstZone('footer-first'),
      headerExtraCm: extraCm('header-style', 'margin-bottom'),
      footerExtraCm: extraCm('footer-style', 'margin-top'),
      // Only the left/right (even) variant stays unsupported; -first is handled below.
      hasVariants: ['header-left', 'footer-left'].some(l => zone(l) != null),
    };
  }

  // Page margins + orientation + format from the master page's layout. With a
  // header/footer the body margin is page margin + zone height + spacing (inverse of
  // the export mapping). Format is matched from fo:page-width/height (fallback A4).
  pageGeometry(): { margins: PageMargins; orientation: Orientation; format: PageFormat } | null {
    const props = this.pageLayoutEl()?.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0] ?? null;
    if (!props) return null;

    const hf = this.masterPageHF();
    const cm = (attr: string, fallback: number, extra = 0) => {
      const v = lengthToCm(props.getAttributeNS(NS.fo, attr));
      if (v == null) return fallback;
      return Math.min(10, Math.max(0, Math.round((v + extra) * 100) / 100));
    };
    const margins: PageMargins = {
      top: cm('margin-top', 2.54, hf.header ? hf.headerExtraCm : 0),
      bottom: cm('margin-bottom', 2.54, hf.footer ? hf.footerExtraCm : 0),
      left: cm('margin-left', 2.12),
      right: cm('margin-right', 2.12),
    };
    const w = lengthToCm(props.getAttributeNS(NS.fo, 'page-width'));
    const h = lengthToCm(props.getAttributeNS(NS.fo, 'page-height'));
    const orientation: Orientation = w != null && h != null && w > h ? 'landscape' : 'portrait';
    const format: PageFormat = w != null && h != null ? (formatFromCm(w, h) ?? 'A4') : 'A4';
    return { margins, orientation, format };
  }

  // Raw page margins (cm) = ODF's edge→zone distance, i.e. the header distance from
  // the top and footer distance from the bottom when a header/footer is present.
  edgeDistancesCm(): { top: number; bottom: number } | null {
    const props = this.pageLayoutEl()?.getElementsByTagNameNS(NS.style, 'page-layout-properties')[0] ?? null;
    if (!props) return null;
    const cm = (attr: string) => {
      const v = lengthToCm(props.getAttributeNS(NS.fo, attr));
      return v == null ? null : Math.min(10, Math.max(0, Math.round(v * 100) / 100));
    };
    return { top: cm('margin-top') ?? 1.25, bottom: cm('margin-bottom') ?? 1.25 };
  }
}
