import type { TabAlign, TabStop } from '../editor/extensions/tabStops';
import type { CapsMode } from '../editor/extensions/textEffects';
import { lengthToPt } from './styleResolver';

// Resolves OOXML style indirection for the DOCX importer: Word/LibreOffice spread run
// formatting across w:docDefaults and named styles linked by w:basedOn, and store list
// numbering in numbering.xml. This flattens both so import/docx.ts reads effective values.

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
export const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
export const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
// Text boxes / shapes: DrawingML shape container, markup-compatibility wrapper
// (Word wraps every shape in mc:AlternateContent), and legacy VML.
export const WPS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const VML = 'urn:schemas-microsoft-com:vml';

// A run's resolved character properties; only set keys are present so layers merge cleanly.
export type RunProps = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: 'superscript' | 'subscript';
  color?: string; // raw w:val hex (no #) or 'auto'
  sizeHalfPt?: number; // w:sz (half-points)
  spacingTwip?: number; // w:spacing (character spacing, twentieths of a point)
  font?: string; // explicit w:rFonts w:ascii/hAnsi
  fontTheme?: 'minor' | 'major'; // w:rFonts w:asciiTheme/hAnsiTheme → theme1.xml font
  highlightFill?: string; // text highlight: w:shd w:fill, or w:highlight's palette colour
  caps?: CapsMode | false; // w:caps / w:smallCaps; false = a run switching the style's off
  underlineVal?: string;   // w:u w:val, the line's style ('single' | 'double' | 'wave' | …)
  underlineColor?: string; // w:u w:color (raw hex)
  doubleStrike?: boolean;  // w:dstrike
  positionPt?: number;     // w:position: pt above the baseline (negative = below)
};

// A numbering level definition (numbering.xml w:lvl). bulletFont is the level's
// w:rPr/w:rFonts (Wingdings/Symbol give the bullet glyph its meaning).
export type LevelDef = { numFmt?: string; lvlText?: string; leftTwip?: number; start?: number; bulletFont?: string };

// Paragraph spacing from a w:pPr/w:spacing (only the attributes actually present, so
// omitted ones inherit up the style chain). before/after in twips, line per w:line.
export type ParaSpacing = { before?: number; after?: number; line?: number; lineRule?: string };

export function wVal(el: Element): string | null {
  return el.getAttributeNS(W, 'val');
}

// <w:tabs> → stops in cm from the left text margin, w:pos's origin (which the editor's
// attr shares). 'clear' removes an inherited stop and 'bar' is a rule, not a stop.
// w:leader → the fill character. "heavy" is a bold underscore, which we can only
// render as the plain one.
const DOCX_LEADER: Record<string, string> = {
  dot: '.', hyphen: '-', underscore: '_', heavy: '_', middleDot: '·',
};

export function readTabStops(tabs: Element): TabStop[] {
  const out: TabStop[] = [];
  for (const tab of Array.from(tabs.getElementsByTagNameNS(W, 'tab'))) {
    const val = wVal(tab);
    if (val === 'clear' || val === 'bar') continue;
    const pos = parseInt(tab.getAttributeNS(W, 'pos') ?? '', 10);
    if (!Number.isFinite(pos)) continue;
    const align: TabAlign = val === 'center' ? 'center'
      : val === 'right' || val === 'end' ? 'right'
      : val === 'decimal' ? 'decimal' : 'left';
    out.push({ pos: Math.round((pos / 1440) * 2.54 * 100) / 100, align, leader: DOCX_LEADER[tab.getAttributeNS(W, 'leader') ?? ''] ?? null });
  }
  return out;
}

// A toggle property (w:b, w:i, …): present with no/true val = on; val false/0/off = off.
export function toggle(el: Element): boolean {
  const v = wVal(el);
  return v == null || !(v === 'false' || v === '0' || v === 'off');
}

// ST_SignedHpsMeasure: a bare number counts half-points, anything else carries its unit.
function signedHalfPointsPt(v: string | null): number | null {
  if (!v) return null;
  if (/^-?[\d.]+$/.test(v)) { const n = parseFloat(v); return Number.isFinite(n) ? n / 2 : null; }
  return lengthToPt(v) ?? null;
}

// Word writes the two case toggles separately; small caps wins where both are on.
function readCaps(p: RunProps, child: Element): void {
  const on = toggle(child);
  if (child.localName === 'smallCaps') p.caps = on ? 'smallCaps' : false;
  else if (on) { if (p.caps !== 'smallCaps') p.caps = 'uppercase'; }
  else if (p.caps === 'uppercase') p.caps = false;
}

// The highlighter pen's fixed palette (w:highlight names a colour where w:shd gives a
// hex). 'none' maps to the same sentinel as an empty w:shd, so it cancels an inherited pen.
const HIGHLIGHT_HEX: Record<string, string> = {
  black: '000000', blue: '0000FF', cyan: '00FFFF', darkBlue: '000080', darkCyan: '008080',
  darkGray: '808080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000',
  darkYellow: '808000', green: '00FF00', lightGray: 'C0C0C0', magenta: 'FF00FF',
  red: 'FF0000', white: 'FFFFFF', yellow: 'FFFF00', none: 'auto',
};

// w:rPr element → RunProps (later layers override earlier; absent keys inherit).
export function parseRunProps(rPr: Element | null | undefined): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  for (const child of Array.from(rPr.children)) {
    if (child.namespaceURI !== W) continue;
    switch (child.localName) {
      case 'b': p.bold = toggle(child); break;
      case 'i': p.italic = toggle(child); break;
      case 'strike': p.strike = toggle(child); break;
      case 'u': {
        const v = wVal(child);
        p.underline = v !== 'none';
        if (v) p.underlineVal = v;
        const c = child.getAttributeNS(W, 'color');
        if (c && c !== 'auto') p.underlineColor = c;
        break;
      }
      case 'dstrike': { const on = toggle(child); p.doubleStrike = on; if (on) p.strike = true; break; }
      case 'caps': case 'smallCaps': readCaps(p, child); break;
      case 'position': { const pt = signedHalfPointsPt(wVal(child)); if (pt != null) p.positionPt = pt; break; }
      case 'vertAlign': {
        const v = wVal(child);
        if (v === 'superscript' || v === 'subscript') p.vertAlign = v;
        break;
      }
      case 'color': { const v = wVal(child); if (v) p.color = v; break; }
      case 'sz': { const n = parseInt(wVal(child) ?? '', 10); if (Number.isFinite(n)) p.sizeHalfPt = n; break; }
      case 'spacing': { const n = parseInt(wVal(child) ?? '', 10); if (Number.isFinite(n)) p.spacingTwip = n; break; }
      case 'rFonts': {
        const f = child.getAttributeNS(W, 'ascii') ?? child.getAttributeNS(W, 'hAnsi');
        if (f) { p.font = f; break; }
        // Word's default fonts are theme references (minorHAnsi = body, majorHAnsi = headings).
        const theme = child.getAttributeNS(W, 'asciiTheme') ?? child.getAttributeNS(W, 'hAnsiTheme');
        if (theme) p.fontTheme = theme.startsWith('major') ? 'major' : 'minor';
        break;
      }
      case 'shd': { const f = child.getAttributeNS(W, 'fill'); if (f && f !== 'auto') p.highlightFill = f; break; }
      case 'highlight': { const c = HIGHLIGHT_HEX[wVal(child) ?? '']; if (c) p.highlightFill = c; break; }
    }
  }
  return p;
}

export function mergeRunProps(base: RunProps, over: RunProps): RunProps {
  const out = { ...base, ...over };
  // A run's font is one logical choice (explicit name or theme ref): the nearer
  // level's choice shadows both inherited forms.
  if ('font' in over || 'fontTheme' in over) {
    if (!('font' in over)) delete out.font;
    if (!('fontTheme' in over)) delete out.fontTheme;
  }
  return out;
}

export class DocxStyles {
  private defaultsRun: RunProps = {};
  private ownRun = new Map<string, RunProps>(); // styleId → own w:rPr
  private basedOn = new Map<string, string | null>();
  private memoOwn = new Map<string, RunProps>();
  private styleNum = new Map<string, { numId: number; ilvl: number }>();
  private ownOutline = new Map<string, number>(); // style's own w:outlineLvl (heading marker)
  private ownAlign = new Map<string, string>(); // style's own w:pPr/w:jc
  private ownSpacing = new Map<string, ParaSpacing>(); // style's own w:pPr/w:spacing
  private ownIndentTwip = new Map<string, number>(); // style's own w:pPr/w:ind left
  private paraStyleNames = new Map<string, string>(); // paragraph styleId → w:name
  private charStyleNames = new Map<string, string>(); // character styleId → w:name
  private tableStyleNames = new Map<string, string>(); // table styleId → w:name
  private defaultParaStyle: string | null = null; // the w:default="1" paragraph style
  private defaultsAlign: string | null = null; // docDefaults w:pPrDefault/w:jc
  private defaultsSpacing: ParaSpacing = {}; // docDefaults w:pPrDefault/w:spacing
  private ownWidow = new Map<string, boolean>(); // style's own w:pPr/w:widowControl
  private ownContextual = new Map<string, boolean>(); // style's own w:pPr/w:contextualSpacing
  private ownKeepNext = new Map<string, boolean>(); // style's own w:pPr/w:keepNext
  private ownKeepLines = new Map<string, boolean>(); // style's own w:pPr/w:keepLines
  private ownTabs = new Map<string, TabStop[]>(); // style's own w:pPr/w:tabs
  private ownCellMar = new Map<string, Element>(); // table style's own w:tblPr/w:tblCellMar
  private defaultsWidow: boolean | null = null; // docDefaults w:pPrDefault/w:widowControl
  private numToAbstract = new Map<string, string>();
  private abstractLevels = new Map<string, Map<number, LevelDef>>();
  private minorFont?: string; // theme1.xml body font (e.g. Calibri)
  private majorFont?: string; // theme1.xml heading font (e.g. Calibri Light)

  constructor(stylesDoc: Document | null, numberingDoc: Document | null, themeDoc: Document | null = null) {
    if (stylesDoc) this.parseStyles(stylesDoc);
    if (numberingDoc) this.parseNumbering(numberingDoc);
    if (themeDoc) this.parseTheme(themeDoc);
  }

  private parseTheme(doc: Document): void {
    const latin = (scheme: string) => {
      const font = doc.getElementsByTagNameNS(A, scheme)[0];
      const typeface = font?.getElementsByTagNameNS(A, 'latin')[0]?.getAttribute('typeface');
      return typeface || undefined;
    };
    this.minorFont = latin('minorFont');
    this.majorFont = latin('majorFont');
  }

  themeFont(kind: 'minor' | 'major'): string | undefined {
    return kind === 'major' ? this.majorFont : this.minorFont;
  }

  private parseStyles(doc: Document): void {
    const defs = doc.getElementsByTagNameNS(W, 'docDefaults')[0];
    if (defs) {
      const rPr = defs.getElementsByTagNameNS(W, 'rPrDefault')[0]?.getElementsByTagNameNS(W, 'rPr')[0];
      this.defaultsRun = parseRunProps(rPr);
      const pPr = defs.getElementsByTagNameNS(W, 'pPrDefault')[0]?.getElementsByTagNameNS(W, 'pPr')[0];
      const ddJc = pPr ? firstChild(pPr, 'jc') : null;
      if (ddJc) this.defaultsAlign = wVal(ddJc);
      const ddSp = pPr ? firstChild(pPr, 'spacing') : null;
      if (ddSp) this.defaultsSpacing = readSpacing(ddSp);
      const ddWc = pPr ? firstChild(pPr, 'widowControl') : null;
      if (ddWc) this.defaultsWidow = toggle(ddWc);
    }
    for (const style of Array.from(doc.getElementsByTagNameNS(W, 'style'))) {
      const id = style.getAttributeNS(W, 'styleId');
      if (!id) continue;
      this.basedOn.set(id, firstChild(style, 'basedOn') ? wVal(firstChild(style, 'basedOn')!) : null);
      this.ownRun.set(id, parseRunProps(firstChild(style, 'rPr')));
      if (style.getAttributeNS(W, 'type') === 'paragraph' && (style.getAttributeNS(W, 'default') === '1' || style.getAttributeNS(W, 'default') === 'true')) {
        this.defaultParaStyle = id;
      }
      const ppr = firstChild(style, 'pPr');
      const numPr = ppr && firstChild(ppr, 'numPr');
      if (numPr) {
        const np = readNumPr(numPr);
        if (np) this.styleNum.set(id, np);
      }
      const ol = ppr && firstChild(ppr, 'outlineLvl');
      if (ol) { const n = parseInt(wVal(ol) ?? '', 10); if (Number.isFinite(n)) this.ownOutline.set(id, n); }
      const jc = ppr && firstChild(ppr, 'jc');
      if (jc) { const v = wVal(jc); if (v) this.ownAlign.set(id, v); }
      const sp = ppr && firstChild(ppr, 'spacing');
      if (sp) this.ownSpacing.set(id, readSpacing(sp));
      const wc = ppr && firstChild(ppr, 'widowControl');
      if (wc) this.ownWidow.set(id, toggle(wc));
      const cs = ppr && firstChild(ppr, 'contextualSpacing');
      if (cs) this.ownContextual.set(id, toggle(cs));
      const kn = ppr && firstChild(ppr, 'keepNext');
      if (kn) this.ownKeepNext.set(id, toggle(kn));
      const kl = ppr && firstChild(ppr, 'keepLines');
      if (kl) this.ownKeepLines.set(id, toggle(kl));
      const tabs = ppr && firstChild(ppr, 'tabs');
      if (tabs) this.ownTabs.set(id, readTabStops(tabs));
      const ind = ppr && firstChild(ppr, 'ind');
      if (ind) {
        const left = parseInt(ind.getAttributeNS(W, 'left') ?? ind.getAttributeNS(W, 'start') ?? '', 10);
        if (Number.isFinite(left)) this.ownIndentTwip.set(id, left);
      }
      const cellMar = firstChild(style, 'tblPr') && firstChild(firstChild(style, 'tblPr')!, 'tblCellMar');
      if (cellMar) this.ownCellMar.set(id, cellMar);
      const kind = style.getAttributeNS(W, 'type');
      if (kind === 'paragraph' || kind === 'character' || kind === 'table') {
        const nameEl = firstChild(style, 'name');
        const name = (nameEl && wVal(nameEl)) || id;
        if (kind === 'paragraph') this.paraStyleNames.set(id, name);
        else if (kind === 'table') this.tableStyleNames.set(id, name);
        else this.charStyleNames.set(id, name);
      }
    }
  }

  // Paragraph styles defined in the file: display name and parent, for the style registry.
  namedParagraphStyles(): Map<string, { name: string; basedOn: string | null }> {
    const out = new Map<string, { name: string; basedOn: string | null }>();
    for (const [id, name] of this.paraStyleNames) out.set(id, { name, basedOn: this.basedOn.get(id) ?? null });
    return out;
  }

  // Character styles defined in the file (w:type="character"), for the style registry.
  namedCharacterStyles(): Map<string, string> {
    return new Map(this.charStyleNames);
  }

  // A w:tblStyle id → the style's display name (the id itself when it declares none).
  tableStyleName(id: string | null | undefined): string | null {
    if (!id) return null;
    return this.tableStyleNames.get(id) ?? id;
  }

  // The style's effective left indent (twips) along the basedOn chain.
  styleIndentTwip(styleId: string | null | undefined, seen = new Set<string>()): number | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    const own = this.ownIndentTwip.get(styleId);
    if (own != null) return own;
    return this.styleIndentTwip(this.basedOn.get(styleId) ?? null, seen);
  }

  // The style Word applies when a paragraph names none.
  defaultParagraphStyle(): string | null {
    return this.defaultParaStyle;
  }

  private parseNumbering(doc: Document): void {
    for (const abs of Array.from(doc.getElementsByTagNameNS(W, 'abstractNum'))) {
      const id = abs.getAttributeNS(W, 'abstractNumId');
      if (!id) continue;
      const levels = new Map<number, LevelDef>();
      for (const lvl of Array.from(abs.getElementsByTagNameNS(W, 'lvl'))) {
        const ilvl = parseInt(lvl.getAttributeNS(W, 'ilvl') ?? '', 10);
        if (!Number.isFinite(ilvl)) continue;
        const def: LevelDef = {};
        const fmt = firstChild(lvl, 'numFmt'); if (fmt) def.numFmt = wVal(fmt) ?? undefined;
        const txt = firstChild(lvl, 'lvlText'); if (txt) def.lvlText = wVal(txt) ?? undefined;
        const start = firstChild(lvl, 'start'); if (start) { const n = parseInt(wVal(start) ?? '', 10); if (Number.isFinite(n)) def.start = n; }
        const ind = firstChild(lvl, 'pPr') && firstChild(firstChild(lvl, 'pPr')!, 'ind');
        if (ind) { const l = parseInt(ind.getAttributeNS(W, 'left') ?? ind.getAttributeNS(W, 'start') ?? '', 10); if (Number.isFinite(l)) def.leftTwip = l; }
        const rf = firstChild(lvl, 'rPr') && firstChild(firstChild(lvl, 'rPr')!, 'rFonts');
        if (rf) { const f = rf.getAttributeNS(W, 'ascii') ?? rf.getAttributeNS(W, 'hAnsi'); if (f) def.bulletFont = f; }
        levels.set(ilvl, def);
      }
      this.abstractLevels.set(id, levels);
    }
    for (const num of Array.from(doc.getElementsByTagNameNS(W, 'num'))) {
      const numId = num.getAttributeNS(W, 'numId');
      const absId = firstChild(num, 'abstractNumId');
      if (numId && absId) this.numToAbstract.set(numId, wVal(absId) ?? '');
    }
  }

  // Chain-resolved own run props (basedOn root → leaf), without the docDefaults baseline.
  styleOwn(styleId: string | null | undefined): RunProps {
    if (!styleId) return {};
    const memo = this.memoOwn.get(styleId);
    if (memo) return memo;
    this.memoOwn.set(styleId, {}); // break basedOn cycles
    const parent = this.basedOn.get(styleId) ?? null;
    const base = parent ? this.styleOwn(parent) : {};
    const merged = mergeRunProps(base, this.ownRun.get(styleId) ?? {});
    this.memoOwn.set(styleId, merged);
    return merged;
  }

  // A paragraph's run baseline: docDefaults ← its paragraph style's basedOn chain. With no
  // w:pStyle the w:default="1" paragraph style (Word's "Normal") applies — it usually
  // carries the document's real body font, which docDefaults alone gets wrong.
  paragraphRun(pStyleId: string | null | undefined): RunProps {
    return mergeRunProps(this.defaultsRun, this.styleOwn(pStyleId ?? this.defaultParaStyle));
  }

  styleNumPr(styleId: string | null | undefined): { numId: number; ilvl: number } | null {
    return styleId ? this.styleNum.get(styleId) ?? null : null;
  }

  // The style's effective outline level (w:outlineLvl) along the w:basedOn chain. 0–8
  // marks a heading (Heading1 = 0); the standard, locale-independent heading signal.
  styleOutlineLvl(styleId: string | null | undefined, seen = new Set<string>()): number | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    const own = this.ownOutline.get(styleId);
    if (own != null) return own;
    return this.styleOutlineLvl(this.basedOn.get(styleId) ?? null, seen);
  }

  // The style's own w:jc, nearest along the w:basedOn chain (null if none in the chain).
  private styleAlign(styleId: string | null | undefined, seen = new Set<string>()): string | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    const own = this.ownAlign.get(styleId);
    if (own != null) return own;
    return this.styleAlign(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:widowControl along the w:basedOn chain, then the default style, then docDefaults.
  // Absent everywhere is OOXML's implied "on".
  paragraphWidowControl(pStyleId: string | null | undefined): boolean {
    const own = this.styleWidow(pStyleId);
    if (own != null) return own;
    if (this.defaultParaStyle && this.defaultParaStyle !== pStyleId) {
      const def = this.styleWidow(this.defaultParaStyle);
      if (def != null) return def;
    }
    return this.defaultsWidow ?? true;
  }

  // w:tabs along the w:basedOn chain (direct w:pPr/w:tabs is read and wins in the
  // caller). The nearest declaration is taken whole — Word merges a style's stops with
  // the paragraph's, which no document here has needed.
  paragraphTabs(styleId: string | null | undefined, seen = new Set<string>()): TabStop[] {
    if (!styleId || seen.has(styleId)) return [];
    seen.add(styleId);
    const own = this.ownTabs.get(styleId);
    if (own) return own;
    return this.paragraphTabs(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:contextualSpacing along the w:basedOn chain: the style drops its own spacing
  // between neighbouring paragraphs that share it (Word's List Paragraph does).
  paragraphContextualSpacing(styleId: string | null | undefined, seen = new Set<string>()): boolean {
    if (!styleId || seen.has(styleId)) return false;
    seen.add(styleId);
    const own = this.ownContextual.get(styleId);
    if (own != null) return own;
    return this.paragraphContextualSpacing(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:keepNext along the w:basedOn chain — Word's heading styles all carry it.
  paragraphKeepNext(styleId: string | null | undefined, seen = new Set<string>()): boolean {
    if (!styleId || seen.has(styleId)) return false;
    seen.add(styleId);
    const own = this.ownKeepNext.get(styleId);
    if (own != null) return own;
    return this.paragraphKeepNext(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:keepLines along the same chain (Word's heading styles carry this one too).
  paragraphKeepLines(styleId: string | null | undefined, seen = new Set<string>()): boolean {
    if (!styleId || seen.has(styleId)) return false;
    seen.add(styleId);
    const own = this.ownKeepLines.get(styleId);
    if (own != null) return own;
    return this.paragraphKeepLines(this.basedOn.get(styleId) ?? null, seen);
  }

  private styleWidow(styleId: string | null | undefined, seen = new Set<string>()): boolean | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    const own = this.ownWidow.get(styleId);
    if (own != null) return own;
    return this.styleWidow(this.basedOn.get(styleId) ?? null, seen);
  }

  // Effective paragraph alignment from styles only (direct w:pPr/w:jc is read and wins in
  // the caller): the pStyle's basedOn chain, else the default paragraph style, else
  // docDefaults. Lets a paragraph inheriting justify from its style keep it. null = unset.
  paragraphAlign(pStyleId: string | null | undefined): string | null {
    const own = this.styleAlign(pStyleId);
    if (own != null) return own;
    if (this.defaultParaStyle && this.defaultParaStyle !== pStyleId) {
      const def = this.styleAlign(this.defaultParaStyle);
      if (def != null) return def;
    }
    return this.defaultsAlign;
  }

  // The style's effective spacing along the w:basedOn chain (root → leaf, leaf wins per
  // attribute).
  private styleSpacing(styleId: string | null | undefined, seen = new Set<string>()): ParaSpacing {
    if (!styleId || seen.has(styleId)) return {};
    seen.add(styleId);
    const base = this.styleSpacing(this.basedOn.get(styleId) ?? null, seen);
    return { ...base, ...(this.ownSpacing.get(styleId) ?? {}) };
  }

  // Effective paragraph spacing from styles only (direct w:pPr/w:spacing wins in the caller):
  // docDefaults ← the pStyle's basedOn chain, or the default paragraph style when there is no
  // w:pStyle. An attribute no layer sets is Word's implied 0 (applied in blockAttrs).
  paragraphSpacing(pStyleId: string | null | undefined): ParaSpacing {
    return { ...this.defaultsSpacing, ...this.styleSpacing(pStyleId ?? this.defaultParaStyle) };
  }

  // The table style's own w:tblCellMar along the w:basedOn chain (leaf wins). The
  // element itself, so the caller reads whichever sides it declares.
  tableCellMar(styleId: string | null | undefined, seen = new Set<string>()): Element | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    return this.ownCellMar.get(styleId) ?? this.tableCellMar(this.basedOn.get(styleId) ?? null, seen);
  }

  level(numId: number, ilvl: number): LevelDef {
    const abs = this.numToAbstract.get(String(numId));
    if (!abs) return {};
    return this.abstractLevels.get(abs)?.get(ilvl) ?? {};
  }
}

function firstChild(el: Element, localName: string): Element | null {
  for (const c of Array.from(el.children)) if (c.namespaceURI === W && c.localName === localName) return c;
  return null;
}

// A w:spacing element's present attributes only (omitted ones inherit up the chain).
export function readSpacing(sp: Element): ParaSpacing {
  const num = (name: string) => {
    const v = sp.getAttributeNS(W, name);
    if (v == null) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const out: ParaSpacing = {};
  const before = num('before'); if (before != null) out.before = before;
  const after = num('after'); if (after != null) out.after = after;
  const line = num('line'); if (line != null) out.line = line;
  const rule = sp.getAttributeNS(W, 'lineRule'); if (rule) out.lineRule = rule;
  return out;
}

export function readNumPr(numPr: Element): { numId: number; ilvl: number } | null {
  const idEl = firstChild(numPr, 'numId');
  if (!idEl) return null;
  const numId = parseInt(wVal(idEl) ?? '', 10);
  if (!Number.isFinite(numId)) return null;
  const ilvlEl = firstChild(numPr, 'ilvl');
  const ilvl = ilvlEl ? parseInt(wVal(ilvlEl) ?? '0', 10) : 0;
  return { numId, ilvl: Number.isFinite(ilvl) ? ilvl : 0 };
}
