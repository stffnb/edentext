import type { TabAlign, TabStop } from '../editor/extensions/tabStops';
import { emphasisFromWord, RAW_OF, type CapsMode, type Emphasis, type Relief, type TextGlow, type TextOutline, type TextShadow, type W14El } from '../editor/extensions/textEffects';
import { readW14Effects, W14 } from '../utils/w14Effects';
import { lengthToPt } from './styleResolver';
import { boundedInt } from './importLimits';

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
export const WPG = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup';
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
export const VML = 'urn:schemas-microsoft-com:vml';
// VML's Office extensions (o:hr, o:hralign, …).
export const O = 'urn:schemas-microsoft-com:office:office';
// VML's Word extensions (w10:wrap, the wrap of a shape placed out of the line).
export const W10 = 'urn:schemas-microsoft-com:office:word';
// The bibliography sources Word keeps in a custom-XML part.
export const B = 'http://schemas.openxmlformats.org/officeDocument/2006/bibliography';

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
  bdr?: Element; // w:bdr, the box round the run
  kernHalfPt?: number; // w:kern: the smallest size pair kerning applies to (0/absent = never)
  font?: string; // explicit w:rFonts w:ascii/hAnsi
  fontEastAsia?: string; // explicit w:rFonts w:eastAsia, the font CJK text is set in
  fontTheme?: 'minor' | 'major'; // w:rFonts w:asciiTheme/hAnsiTheme → theme1.xml font
  highlightFill?: string; // text highlight: w:shd w:fill, or w:highlight's palette colour
  caps?: CapsMode | false; // w:caps / w:smallCaps; false = a run switching the style's off
  underlineVal?: string;   // w:u w:val, the line's style ('single' | 'double' | 'wave' | …)
  underlineColor?: string; // w:u w:color (raw hex)
  doubleStrike?: boolean;  // w:dstrike
  positionPt?: number;     // w:position: pt above the baseline (negative = below)
  emphasis?: Emphasis | false; // w:em; false = a run switching the style's off
  outline?: boolean;       // w:outline
  shadow?: boolean;        // w:shadow
  relief?: Relief | 'none'; // w:emboss / w:imprint; 'none' = a run switching the style's off
  textOutline?: TextOutline; // w14:textOutline
  textShadow?: TextShadow;   // w14:shadow
  textGlow?: TextGlow;       // w14:glow
  textFxRaw?: W14El[];       // the w14 elements the editor does not draw, one per name
  lang?: string;           // w:lang w:val, the run's western language tag
  langEastAsia?: string;   // w:lang w:eastAsia, its asian one
  // The complex-script set, which Hebrew, Arabic, Indic and Thai text is set from.
  boldCs?: boolean;        // w:bCs
  italicCs?: boolean;      // w:iCs
  sizeCsHalfPt?: number;   // w:szCs
  fontCs?: string;         // w:rFonts w:cs
  langBidi?: string;       // w:lang w:bidi
  complex?: boolean;       // w:rtl / w:cs: the run is complex script whatever its characters
};

// A numbering level definition (numbering.xml w:lvl). bulletFont is the level's
// w:rPr/w:rFonts (Wingdings/Symbol give the bullet glyph its meaning).
export type LevelDef = {
  numFmt?: string; lvlText?: string; leftTwip?: number; hangingTwip?: number; start?: number;
  bulletFont?: string; rightAligned?: boolean; suffix?: string; run?: RunProps;
  pStyle?: string; // the paragraph style the level belongs to (w:lvl/w:pStyle)
};

// Paragraph spacing from a w:pPr/w:spacing (only the attributes actually present, so
// omitted ones inherit up the style chain). before/after in twips, line per w:line.
export type ParaSpacing = { before?: number; after?: number; line?: number; lineRule?: string };

export function wVal(el: Element): string | null {
  return el.getAttributeNS(W, 'val');
}

// <w:tabs> → stops in cm from the left text margin, w:pos's origin (which the editor's
// attr shares). 'clear' removes an inherited stop and 'bar' is a rule, not a stop.
// w:leader → the fill character; "heavy" is a bold underscore we can only draw plain.
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
  // An explicit off switches an inherited all-caps off too, not only this layer's.
  else if (p.caps !== 'smallCaps') p.caps = false;
}

// The highlighter pen's fixed palette (w:highlight names a colour where w:shd gives a
// hex). 'none' maps to the same sentinel as an empty w:shd, so it cancels an inherited pen.
const HIGHLIGHT_HEX: Record<string, string> = {
  black: '000000', blue: '0000FF', cyan: '00FFFF', darkBlue: '000080', darkCyan: '008080',
  darkGray: '808080', darkGreen: '008000', darkMagenta: '800080', darkRed: '800000',
  darkYellow: '808000', green: '00FF00', lightGray: 'C0C0C0', magenta: 'FF00FF',
  red: 'FF0000', white: 'FFFFFF', yellow: 'FFFF00', none: 'auto',
};

// w:rPr element → RunProps (later layers override earlier; absent keys inherit). `colorOf`
// resolves a w14 effect's colour; without it only effects in plain sRGB are drawn.
export function parseRunProps(rPr: Element | null | undefined, colorOf?: (holder: Element) => string | undefined): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  Object.assign(p, readW14Effects(rPr, colorOf ?? srgbOnly));
  for (const child of Array.from(rPr.children)) {
    if (child.namespaceURI !== W) continue;
    switch (child.localName) {
      case 'b': p.bold = toggle(child); break;
      case 'i': p.italic = toggle(child); break;
      case 'bCs': p.boldCs = toggle(child); break;
      case 'iCs': p.italicCs = toggle(child); break;
      case 'szCs': { const n = parseInt(wVal(child) ?? '', 10); if (Number.isFinite(n)) p.sizeCsHalfPt = n; break; }
      case 'rtl': case 'cs': p.complex = toggle(child) || !!p.complex; break;
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
      case 'outline': p.outline = toggle(child); break;
      case 'shadow': p.shadow = toggle(child); break;
      // Both on is engraved, as LibreOffice reads it; an off toggle switches a style's off.
      case 'emboss': if (p.relief !== 'engraved') p.relief = toggle(child) ? 'embossed' : 'none'; break;
      case 'imprint': if (toggle(child)) p.relief = 'engraved'; else if (p.relief !== 'embossed') p.relief = 'none'; break;
      case 'em': p.emphasis = emphasisFromWord(wVal(child)) ?? false; break;
      case 'position': { const pt = signedHalfPointsPt(wVal(child)); if (pt != null) p.positionPt = pt; break; }
      case 'vertAlign': {
        const v = wVal(child);
        if (v === 'superscript' || v === 'subscript') p.vertAlign = v;
        break;
      }
      case 'color': { const v = wVal(child); if (v) p.color = v; break; }
      // Each slot on its own, so a nearer level naming one inherits the other.
      case 'lang': {
        const v = wVal(child);
        const ea = child.getAttributeNS(W, 'eastAsia');
        const bidi = child.getAttributeNS(W, 'bidi');
        if (v) p.lang = v;
        if (ea) p.langEastAsia = ea;
        if (bidi) p.langBidi = bidi;
        break;
      }
      case 'sz': { const n = parseInt(wVal(child) ?? '', 10); if (Number.isFinite(n)) p.sizeHalfPt = n; break; }
      case 'spacing': { const n = parseInt(wVal(child) ?? '', 10); if (Number.isFinite(n)) p.spacingTwip = n; break; }
      case 'bdr': p.bdr = child; break;
      case 'kern': { const n = parseInt(wVal(child) ?? '', 10); if (Number.isFinite(n)) p.kernHalfPt = n; break; }
      case 'rFonts': {
        const ea = child.getAttributeNS(W, 'eastAsia');
        if (ea) p.fontEastAsia = ea;
        const cs = child.getAttributeNS(W, 'cs');
        if (cs) p.fontCs = cs;
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
  // w14 elements override one by one; a drawn effect replaces the kept tree of its kind.
  if (base.textFxRaw && (over.textFxRaw || over.textOutline || over.textShadow || over.textGlow)) {
    const replaced = new Set([...(over.textFxRaw ?? []).map((e) => e.n),
      ...(['textOutline', 'textShadow', 'textGlow'] as const).filter((k) => over[k]).map((k) => RAW_OF[k])]);
    const raw = [...base.textFxRaw.filter((e) => !replaced.has(e.n)), ...(over.textFxRaw ?? [])];
    if (raw.length) out.textFxRaw = raw; else delete out.textFxRaw;
  }
  return out;
}

// A w14 colour without the theme: only a plain sRGB value.
function srgbOnly(holder: Element): string | undefined {
  const c = Array.from(holder.children).find((k) => k.namespaceURI === W14 && k.localName === 'srgbClr');
  const v = c?.getAttributeNS(W14, 'val');
  return v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : undefined;
}

export class DocxStyles {
  private defaultsRun: RunProps = { sizeHalfPt: 20 }; // Word's size where no w:sz is set: 10pt
  private ownRun = new Map<string, RunProps>(); // styleId → own w:rPr
  private basedOn = new Map<string, string | null>();
  private next = new Map<string, string | null>(); // w:next
  private memoOwn = new Map<string, RunProps>();
  private styleNum = new Map<string, { numId: number; ilvl: number }>();
  private ownNumId = new Map<string, number>(); // style's own w:numPr/w:numId
  private startOverrides = new Map<string, number>(); // `numId:ilvl` → w:startOverride
  private ownIlvl = new Map<string, number>(); // style's own w:numPr/w:ilvl
  private ownOutline = new Map<string, number>(); // style's own w:outlineLvl (heading marker)
  private ownAlign = new Map<string, string>(); // style's own w:pPr/w:jc
  private ownSpacing = new Map<string, ParaSpacing>(); // style's own w:pPr/w:spacing
  private ownIndentTwip = new Map<string, number>(); // style's own w:pPr/w:ind left
  private ownFirstTwip = new Map<string, number>(); // w:ind firstLine, or minus w:hanging
  private ownHangingTwip = new Map<string, number>(); // style's own w:pPr/w:ind hanging
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
  private ownBreakBefore = new Map<string, boolean>(); // style's own w:pPr/w:pageBreakBefore
  private ownBidi = new Map<string, boolean>(); // style's own w:pPr/w:bidi
  private defaultsBidi: boolean | null = null; // docDefaults w:pPrDefault/w:bidi
  private ownTabs = new Map<string, TabStop[]>(); // style's own w:pPr/w:tabs
  private ownCellMar = new Map<string, Element>(); // table style's own w:tblPr/w:tblCellMar
  private ownTblBorders = new Map<string, Element>(); // table style's own w:tblPr/w:tblBorders
  private ownPBdr = new Map<string, Element>(); // style's own w:pPr/w:pBdr (rule lines)
  private ownParaShd = new Map<string, Element>(); // style's own w:pPr/w:shd (colored field)
  private ownCond = new Map<string, Map<string, Element>>(); // table styleId → w:type → w:tblStylePr
  private ownTcShd = new Map<string, Element>(); // table style's own w:tcPr/w:shd (whole table)
  private ownBandSize = new Map<string, { row: number; col: number }>(); // w:tblStyle*BandSize
  private defaultsWidow: boolean | null = null; // docDefaults w:pPrDefault/w:widowControl
  private numToAbstract = new Map<string, string>();
  private abstractLevels = new Map<string, Map<number, LevelDef>>();
  private numStyleNames = new Map<string, string>(); // numbering styleId → display name
  private abstractStyleLink = new Map<string, string>();    // abstract → its own numbering style (w:styleLink)
  private abstractNumStyleLink = new Map<string, string>(); // abstract → the style it defers to (w:numStyleLink)
  private minorFont?: string; // theme1.xml body font (e.g. Calibri)
  private majorFont?: string; // theme1.xml heading font (e.g. Calibri Light)

  // Resolves a w14 effect's colour against the theme (parseRunProps).
  readonly colorOf?: (holder: Element) => string | undefined;

  constructor(stylesDoc: Document | null, numberingDoc: Document | null, themeDoc: Document | null = null, colorOf?: (holder: Element) => string | undefined) {
    this.colorOf = colorOf;
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
      this.defaultsRun = { sizeHalfPt: 20, ...parseRunProps(rPr, this.colorOf) };
      const pPr = defs.getElementsByTagNameNS(W, 'pPrDefault')[0]?.getElementsByTagNameNS(W, 'pPr')[0];
      const ddJc = pPr ? firstChild(pPr, 'jc') : null;
      if (ddJc) this.defaultsAlign = wVal(ddJc);
      const ddBidi = pPr?.getElementsByTagNameNS(W, 'bidi')[0];
      if (ddBidi) this.defaultsBidi = toggle(ddBidi);
      const ddSp = pPr ? firstChild(pPr, 'spacing') : null;
      if (ddSp) this.defaultsSpacing = readSpacing(ddSp);
      const ddWc = pPr ? firstChild(pPr, 'widowControl') : null;
      if (ddWc) this.defaultsWidow = toggle(ddWc);
    }
    for (const style of Array.from(doc.getElementsByTagNameNS(W, 'style'))) {
      const id = style.getAttributeNS(W, 'styleId');
      if (!id) continue;
      this.basedOn.set(id, firstChild(style, 'basedOn') ? wVal(firstChild(style, 'basedOn')!) : null);
      this.next.set(id, firstChild(style, 'next') ? wVal(firstChild(style, 'next')!) : null);
      this.ownRun.set(id, parseRunProps(firstChild(style, 'rPr'), this.colorOf));
      if (style.getAttributeNS(W, 'type') === 'paragraph' && (style.getAttributeNS(W, 'default') === '1' || style.getAttributeNS(W, 'default') === 'true')) {
        this.defaultParaStyle = id;
      }
      const ppr = firstChild(style, 'pPr');
      const numPr = ppr && firstChild(ppr, 'numPr');
      if (numPr) {
        const np = readNumPr(numPr);
        if (np) this.styleNum.set(id, np);
        const n = firstChild(numPr, 'numId'), l = firstChild(numPr, 'ilvl');
        const numId = n ? parseInt(wVal(n) ?? '', 10) : NaN, ilvl = l ? parseInt(wVal(l) ?? '', 10) : NaN;
        if (Number.isFinite(numId)) this.ownNumId.set(id, numId);
        if (Number.isFinite(ilvl)) this.ownIlvl.set(id, ilvl);
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
      const pb = ppr && firstChild(ppr, 'pageBreakBefore');
      if (pb) this.ownBreakBefore.set(id, toggle(pb));
      const bd = ppr && firstChild(ppr, 'bidi');
      if (bd) this.ownBidi.set(id, toggle(bd));
      const tabs = ppr && firstChild(ppr, 'tabs');
      if (tabs) this.ownTabs.set(id, readTabStops(tabs));
      const ind = ppr && firstChild(ppr, 'ind');
      if (ind) {
        const left = parseInt(ind.getAttributeNS(W, 'left') ?? ind.getAttributeNS(W, 'start') ?? '', 10);
        if (Number.isFinite(left)) this.ownIndentTwip.set(id, left);
        const hanging = parseInt(ind.getAttributeNS(W, 'hanging') ?? '', 10);
        if (Number.isFinite(hanging)) this.ownHangingTwip.set(id, hanging);
        const firstLine = parseInt(ind.getAttributeNS(W, 'firstLine') ?? '', 10);
        if (Number.isFinite(hanging)) this.ownFirstTwip.set(id, -hanging);
        else if (Number.isFinite(firstLine)) this.ownFirstTwip.set(id, firstLine);
      }
      const pBdr = ppr && firstChild(ppr, 'pBdr');
      if (pBdr) this.ownPBdr.set(id, pBdr);
      const paraShd = ppr && firstChild(ppr, 'shd');
      if (paraShd) this.ownParaShd.set(id, paraShd);
      const tblPr = firstChild(style, 'tblPr');
      const cellMar = tblPr && firstChild(tblPr, 'tblCellMar');
      if (cellMar) this.ownCellMar.set(id, cellMar);
      const tblBorders = tblPr && firstChild(tblPr, 'tblBorders');
      if (tblBorders) this.ownTblBorders.set(id, tblBorders);
      const tcShd = firstChild(style, 'tcPr') && firstChild(firstChild(style, 'tcPr')!, 'shd');
      if (tcShd) this.ownTcShd.set(id, tcShd);
      const conds = Array.from(style.children).filter((c) => c.namespaceURI === W && c.localName === 'tblStylePr');
      if (conds.length) {
        const m = new Map<string, Element>();
        for (const c of conds) { const t = c.getAttributeNS(W, 'type'); if (t) m.set(t, c); }
        this.ownCond.set(id, m);
      }
      const bandSize = (name: string) => {
        const el = tblPr && firstChild(tblPr, name);
        const n = parseInt((el && wVal(el)) ?? '', 10);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      const rowBand = bandSize('tblStyleRowBandSize'), colBand = bandSize('tblStyleColBandSize');
      if (rowBand || colBand) this.ownBandSize.set(id, { row: rowBand, col: colBand });
      const kind = style.getAttributeNS(W, 'type');
      if (kind === 'paragraph' || kind === 'character' || kind === 'table' || kind === 'numbering') {
        const nameEl = firstChild(style, 'name');
        const name = (nameEl && wVal(nameEl)) || id;
        if (kind === 'paragraph') this.paraStyleNames.set(id, name);
        else if (kind === 'table') this.tableStyleNames.set(id, name);
        else if (kind === 'numbering') this.numStyleNames.set(id, name);
        else this.charStyleNames.set(id, name);
      }
    }
    // A file flagging no default style means the one Word names "Normal".
    if (!this.defaultParaStyle && this.ownRun.has('Normal')) this.defaultParaStyle = 'Normal';
  }

  // Paragraph styles defined in the file: display name and parent, for the style registry.
  namedParagraphStyles(): Map<string, { name: string; basedOn: string | null; next: string | null }> {
    const out = new Map<string, { name: string; basedOn: string | null; next: string | null }>();
    for (const [id, name] of this.paraStyleNames) out.set(id, { name, basedOn: this.basedOn.get(id) ?? null, next: this.next.get(id) ?? null });
    return out;
  }

  // The style's own w:basedOn, i.e. the parent the registry gives it in place of the
  // built-in's (collectStyleSheet). Null where the file declares neither.
  styleBasedOn(styleId: string | null): string | null {
    return (styleId && this.basedOn.get(styleId)) ?? null;
  }

  // Character styles defined in the file (w:type="character"), for the style registry.
  // Word's "Strong" is the registry's Strong Emphasis (the export writes it so too).
  namedCharacterStyles(): Map<string, string> {
    return new Map([...this.charStyleNames].map(([id, name]) => [id, name === 'Strong' ? 'Strong Emphasis' : name]));
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

  // The style's first-line offset (twips, negative = hanging) along the basedOn chain.
  styleFirstLineTwip(styleId: string | null | undefined, seen = new Set<string>()): number | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    const own = this.ownFirstTwip.get(styleId);
    if (own != null) return own;
    return this.styleFirstLineTwip(this.basedOn.get(styleId) ?? null, seen);
  }

  // The indent the style chain gives a paragraph it numbers: only the styles from this
  // one down to the one that brings the numbering outrank the level (probed in LibreOffice).
  numberedStyleIndent(styleId: string | null | undefined): { left: number | null; first: number | null } {
    let left: number | undefined, first: number | undefined;
    const seen = new Set<string>();
    for (let s = styleId ?? null; s && !seen.has(s); s = this.basedOn.get(s) ?? null) {
      seen.add(s);
      left ??= this.ownIndentTwip.get(s);
      first ??= this.ownFirstTwip.get(s);
      if (this.ownNumId.has(s)) break;
    }
    return { left: left ?? null, first: first ?? null };
  }

  styleHangingTwip(styleId: string | null | undefined, seen = new Set<string>()): number | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    const own = this.ownHangingTwip.get(styleId);
    if (own != null) return own;
    return this.styleHangingTwip(this.basedOn.get(styleId) ?? null, seen);
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
        const ilvl = boundedInt(lvl.getAttributeNS(W, 'ilvl'), 0, 8);
        if (ilvl == null) continue;
        const def: LevelDef = {};
        const fmt = firstChild(lvl, 'numFmt'); if (fmt) def.numFmt = wVal(fmt) ?? undefined;
        const txt = firstChild(lvl, 'lvlText'); if (txt) def.lvlText = wVal(txt) ?? undefined;
        // An absent w:start is 0: LibreOffice numbers such a level from 0 (probed).
        const start = firstChild(lvl, 'start'); const n = start ? parseInt(wVal(start) ?? '', 10) : 0; if (Number.isFinite(n)) def.start = n;
        const ind = firstChild(lvl, 'pPr') && firstChild(firstChild(lvl, 'pPr')!, 'ind');
        if (ind) {
          const l = parseInt(ind.getAttributeNS(W, 'left') ?? ind.getAttributeNS(W, 'start') ?? '', 10);
          if (Number.isFinite(l)) def.leftTwip = l;
          // A first line past the indent is a negative hang, which is how Word writes a
          // label sitting right of the text it labels.
          const h = parseInt(ind.getAttributeNS(W, 'hanging') ?? '', 10);
          const f = parseInt(ind.getAttributeNS(W, 'firstLine') ?? '', 10);
          if (Number.isFinite(h)) def.hangingTwip = h;
          else if (Number.isFinite(f)) def.hangingTwip = -f;
        }
        const suff = firstChild(lvl, 'suff'); if (suff) def.suffix = wVal(suff) ?? undefined;
        const ps = firstChild(lvl, 'pStyle'); if (ps) def.pStyle = wVal(ps) ?? undefined;
        const rPr = firstChild(lvl, 'rPr'); if (rPr) def.run = parseRunProps(rPr);
        const jc = firstChild(lvl, 'lvlJc');
        if (jc && (wVal(jc) === 'right' || wVal(jc) === 'end')) def.rightAligned = true;
        const rf = firstChild(lvl, 'rPr') && firstChild(firstChild(lvl, 'rPr')!, 'rFonts');
        if (rf) { const f = rf.getAttributeNS(W, 'ascii') ?? rf.getAttributeNS(W, 'hAnsi'); if (f) def.bulletFont = f; }
        levels.set(ilvl, def);
      }
      this.abstractLevels.set(id, levels);
      const sl = firstChild(abs, 'styleLink');
      if (sl) { const v = wVal(sl); if (v) this.abstractStyleLink.set(id, v); }
      const nsl = firstChild(abs, 'numStyleLink');
      if (nsl) { const v = wVal(nsl); if (v) this.abstractNumStyleLink.set(id, v); }
    }
    for (const num of Array.from(doc.getElementsByTagNameNS(W, 'num'))) {
      const numId = num.getAttributeNS(W, 'numId');
      const absId = firstChild(num, 'abstractNumId');
      if (numId && absId) this.numToAbstract.set(numId, wVal(absId) ?? '');
      for (const o of Array.from(num.children).filter((c) => c.localName === 'lvlOverride')) {
        const so = firstChild(o, 'startOverride');
        const v = so ? parseInt(wVal(so) ?? '', 10) : NaN;
        if (numId && Number.isFinite(v)) this.startOverrides.set(`${numId}:${o.getAttributeNS(W, 'ilvl') || 0}`, v);
      }
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

  // w:numId and w:ilvl each inherit along the w:basedOn chain on their own; a level the
  // chain leaves open is the one whose w:pStyle names the style, else level 0.
  styleNumPr(styleId: string | null | undefined): { numId: number; ilvl: number } | null {
    let numId: number | undefined, ilvl: number | undefined;
    const seen = new Set<string>();
    for (let s = styleId ?? null; s && !seen.has(s); s = this.basedOn.get(s) ?? null) {
      seen.add(s);
      numId ??= this.ownNumId.get(s);
      ilvl ??= this.ownIlvl.get(s);
    }
    if (numId == null) return null;
    if (ilvl == null) {
      const abs = this.resolvedAbstract(numId);
      for (const [l, def] of (abs ? this.abstractLevels.get(abs) : null) ?? []) if (styleId && def.pStyle === styleId) ilvl = l;
    }
    return { numId, ilvl: ilvl ?? 0 };
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

  definesParagraphStyle(styleId: string): boolean {
    return this.paraStyleNames.has(styleId);
  }

  // w:keepNext along the w:basedOn chain — Word's heading styles all carry it.
  paragraphKeepNext(styleId: string | null | undefined, seen = new Set<string>()): boolean {
    if (!styleId || seen.has(styleId)) return false;
    seen.add(styleId);
    const own = this.ownKeepNext.get(styleId);
    if (own != null) return own;
    return this.paragraphKeepNext(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:pageBreakBefore along the w:basedOn chain: a chapter style often inherits it.
  paragraphPageBreakBefore(styleId: string | null | undefined, seen = new Set<string>()): boolean {
    if (!styleId || seen.has(styleId)) return false;
    seen.add(styleId);
    const own = this.ownBreakBefore.get(styleId);
    if (own != null) return own;
    return this.paragraphPageBreakBefore(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:keepLines along the same chain (Word's heading styles carry this one too).
  paragraphKeepLines(styleId: string | null | undefined, seen = new Set<string>()): boolean {
    if (!styleId || seen.has(styleId)) return false;
    seen.add(styleId);
    const own = this.ownKeepLines.get(styleId);
    if (own != null) return own;
    return this.paragraphKeepLines(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:bidi — the style's base direction, the document defaults' where its chain has none.
  // null = nothing declares one, so the section's holds.
  paragraphBidi(styleId: string | null | undefined, seen = new Set<string>()): boolean | null {
    if (!styleId || seen.has(styleId)) return this.defaultsBidi;
    seen.add(styleId);
    const own = this.ownBidi.get(styleId);
    if (own != null) return own;
    return this.paragraphBidi(this.basedOn.get(styleId) ?? null, seen);
  }

  // w:jc as the physical edge the editor stores. In a w:bidi paragraph Word reads left
  // and start as the leading edge, the right one, and right and end as the left one.
  static physicalJc(jc: string | null, bidi: boolean): string | null {
    const edge = jc === 'right' || jc === 'end' ? 'right' : jc === 'left' || jc === 'start' ? 'left' : jc;
    if (!bidi || (edge !== 'left' && edge !== 'right')) return edge;
    return edge === 'left' ? 'right' : 'left';
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
  // docDefaults ← `under` ← the pStyle's basedOn chain, or the default paragraph style when
  // there is no w:pStyle. An attribute no layer sets is Word's implied 0 (blockAttrs).
  paragraphSpacing(pStyleId: string | null | undefined, under: ParaSpacing = {}): ParaSpacing {
    return { ...this.defaultsSpacing, ...under, ...this.styleSpacing(pStyleId ?? this.defaultParaStyle) };
  }

  // A table style's own w:pPr/w:spacing along its w:basedOn chain. Word ranks it under
  // the paragraph style, so it goes in as `under` above, never on top.
  tableSpacing(styleId: string | null | undefined): ParaSpacing {
    return this.styleSpacing(styleId);
  }

  // The table style's own w:tblCellMar along the w:basedOn chain (leaf wins). The
  // element itself, so the caller reads whichever sides it declares.
  tableCellMar(styleId: string | null | undefined, seen = new Set<string>()): Element | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    return this.ownCellMar.get(styleId) ?? this.tableCellMar(this.basedOn.get(styleId) ?? null, seen);
  }

  // Every w:tblBorders along the w:basedOn chain, leaf first. The sides merge one by one,
  // so the caller takes each from the nearest style that declares it.
  tableBorders(styleId: string | null | undefined, seen = new Set<string>()): Element[] {
    if (!styleId || seen.has(styleId)) return [];
    seen.add(styleId);
    const own = this.ownTblBorders.get(styleId);
    const rest = this.tableBorders(this.basedOn.get(styleId) ?? null, seen);
    return own ? [own, ...rest] : rest;
  }

  // Every w:pPr/w:pBdr along the w:basedOn chain, leaf first — a paragraph style's rule
  // lines, which the registry renders like any other style property.
  paragraphBorders(styleId: string | null | undefined, seen = new Set<string>()): Element[] {
    if (!styleId || seen.has(styleId)) return [];
    seen.add(styleId);
    const own = this.ownPBdr.get(styleId);
    const rest = this.paragraphBorders(this.basedOn.get(styleId) ?? null, seen);
    return own ? [own, ...rest] : rest;
  }

  // The nearest w:pPr/w:shd along the chain (the paragraph's own background).
  paragraphShading(styleId: string | null | undefined, seen = new Set<string>()): Element | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    return this.ownParaShd.get(styleId) ?? this.paragraphShading(this.basedOn.get(styleId) ?? null, seen);
  }

  // The nearest whole-table cell shading (the style's own w:tcPr/w:shd), under every area.
  tableCellShading(styleId: string | null | undefined, seen = new Set<string>()): Element | null {
    if (!styleId || seen.has(styleId)) return null;
    seen.add(styleId);
    return this.ownTcShd.get(styleId) ?? this.tableCellShading(this.basedOn.get(styleId) ?? null, seen);
  }

  // The table style's conditional areas (w:tblStylePr) along the w:basedOn chain: Word's
  // "first row", "banded row 1", … each carrying the w:tcPr and w:rPr it paints. Leaf wins
  // per area, so a derived style replaces the whole area rather than merging into it.
  tableConditional(styleId: string | null | undefined, seen = new Set<string>()): Map<string, Element> {
    if (!styleId || seen.has(styleId)) return new Map();
    seen.add(styleId);
    const base = this.tableConditional(this.basedOn.get(styleId) ?? null, seen);
    for (const [type, el] of this.ownCond.get(styleId) ?? []) base.set(type, el);
    return base;
  }

  // How many rows/columns one band spans (w:tblStyleRowBandSize), 1 where none is declared.
  tableBandSize(styleId: string | null | undefined, seen = new Set<string>()): { row: number; col: number } {
    if (!styleId || seen.has(styleId)) return { row: 1, col: 1 };
    seen.add(styleId);
    const base = this.tableBandSize(this.basedOn.get(styleId) ?? null, seen);
    const own = this.ownBandSize.get(styleId);
    return { row: own?.row || base.row, col: own?.col || base.col };
  }

  // The abstract a numId's levels really live in: a w:numStyleLink abstract carries no
  // levels itself — it defers to the linked numbering style's own numbering.
  private resolvedAbstract(numId: number, seen = new Set<string>()): string | null {
    const abs = this.numToAbstract.get(String(numId)) ?? null;
    if (!abs || seen.has(abs)) return abs;
    seen.add(abs);
    const linked = this.abstractNumStyleLink.get(abs);
    const np = linked ? this.styleNum.get(linked) : null;
    if (!np) return abs;
    return this.resolvedAbstract(np.numId, seen) ?? abs;
  }

  // Numbers count per abstract: numIds sharing one count on from each other (probed).
  counterKey(numId: number): string {
    return this.resolvedAbstract(numId) ?? `num:${numId}`;
  }

  startOverride(numId: number, ilvl: number): number | null {
    return this.startOverrides.get(`${numId}:${ilvl}`) ?? null;
  }

  level(numId: number, ilvl: number): LevelDef {
    const abs = this.resolvedAbstract(numId);
    if (!abs) return {};
    return this.abstractLevels.get(abs)?.get(ilvl) ?? {};
  }

  // The named numbering style a numId's abstract belongs to (its own w:styleLink, or
  // the one it defers to via w:numStyleLink); null for a private numbering.
  numberingStyleOf(numId: number): string | null {
    const abs = this.numToAbstract.get(String(numId));
    if (!abs) return null;
    const styleId = this.abstractNumStyleLink.get(abs) ?? this.abstractStyleLink.get(abs);
    return styleId ? this.numStyleNames.get(styleId) ?? styleId : null;
  }
}

function firstChild(el: Element, localName: string): Element | null {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.namespaceURI === W && c.localName === localName) return c;
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
  // A nonzero *Lines count (hundredths of a line) wins over the twips, as in Word; a line
  // is 12pt, as LibreOffice converts it.
  const lines = (name: string) => { const n = num(name + 'Lines'); return n ? n * 240 / 100 : num(name); };
  const out: ParaSpacing = {};
  const before = lines('before'); if (before != null) out.before = before;
  const after = lines('after'); if (after != null) out.after = after;
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
  // w:ilvl ends at 8; a file's deeper one is numbered there.
  const ilvl = ilvlEl ? parseInt(wVal(ilvlEl) ?? '0', 10) : 0;
  return { numId, ilvl: Number.isFinite(ilvl) ? Math.min(8, Math.max(0, ilvl)) : 0 };
}
