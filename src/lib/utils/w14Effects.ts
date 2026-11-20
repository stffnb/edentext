// Word 2010's text effects (w14 run properties) as the editor's attrs and back. The units
// and the element order come from [MS-DOCX]; what still wants checking against Word is
// listed in docs/architecture/formatting.md.
import {
  normalizeTextFxRaw, normalizeTextGlow, normalizeTextOutline, normalizeTextShadow,
  type TextEffectAttrs, type TextGlow, type TextOutline, type TextShadow, type W14El,
} from '../editor/extensions/textEffects';

export const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

export const W14_UNITS = {
  emuPerPt: 12700, // w14:w, w14:rad, w14:blurRad, w14:dist
  perDegree: 60000, // w14:dir, clockwise from the x axis, y pointing down
  percent: 100000, // w14:alpha is transparency in thousandths of a percent
};

// The w14 elements' place at the end of w:rPr, in the schema's sequence.
export const W14_ORDER = ['glow', 'shadow', 'reflection', 'textOutline', 'textFill', 'scene3d', 'props3d',
  'ligatures', 'numForm', 'numSpacing', 'stylisticSets', 'cntxtAlts'];

export type W14Effects = { textOutline?: TextOutline; textShadow?: TextShadow; textGlow?: TextGlow; textFxRaw?: W14El[] };

const COLOR_ELS = new Set(['srgbClr', 'schemeClr', 'prstClr', 'sysClr', 'scrgbClr', 'hslClr']);
const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (v: string | null) => (v != null && Number.isFinite(Number(v)) ? Number(v) / W14_UNITS.emuPerPt : null);
const w14Kids = (el: Element) => Array.from(el.children).filter((c) => c.namespaceURI === W14);
const attr = (el: Element, name: string) => el.getAttributeNS(W14, name);

function tree(el: Element): W14El {
  const out: W14El = { n: el.localName };
  const a = Array.from(el.attributes).filter((x) => x.namespaceURI === W14);
  if (a.length) out.a = Object.fromEntries(a.map((x) => [x.localName, x.value]));
  const c = w14Kids(el).map(tree);
  if (c.length) out.c = c;
  return out;
}

// The colour a holder (glow, shadow, solidFill) names and its opacity; the hex comes from
// `colorOf`, which resolves a theme slot and its shifts as the importer does elsewhere.
function colorIn(holder: Element, colorOf: (holder: Element) => string | undefined): { color: string; alpha: number; plain: boolean } | null {
  const kids = w14Kids(holder);
  const c = kids.find((k) => COLOR_ELS.has(k.localName));
  const color = c ? colorOf(holder) : undefined;
  if (!c || !color) return null;
  const a = w14Kids(c).find((k) => k.localName === 'alpha');
  const alpha = a ? 1 - Number(attr(a, 'val') ?? 0) / W14_UNITS.percent : 1;
  return { color, alpha: Number.isFinite(alpha) ? r2(Math.min(1, Math.max(0, alpha))) : 1, plain: kids.length === 1 };
}

const isAbsentOr = (el: Element, name: string, ...ok: string[]) => { const v = attr(el, name); return v == null || ok.includes(v); };

/** The w14 children of a w:rPr: what the editor draws as attrs, the rest (and any effect
 *  it can only approximate) kept as trees for the export. */
export function readW14Effects(rPr: Element, colorOf: (holder: Element) => string | undefined): W14Effects {
  const out: W14Effects = {};
  const raw: W14El[] = [];
  for (const el of w14Kids(rPr)) {
    let exact = false;
    if (el.localName === 'glow') {
      const c = colorIn(el, colorOf), rad = pt(attr(el, 'rad'));
      const g = c && rad != null ? normalizeTextGlow({ color: c.color, alpha: c.alpha, radiusPt: rad }) : null;
      if (g) { out.textGlow = g; exact = c!.plain; }
    } else if (el.localName === 'shadow') {
      const c = colorIn(el, colorOf);
      const dist = pt(attr(el, 'dist')) ?? 0, blur = pt(attr(el, 'blurRad')) ?? 0;
      const dir = ((Number(attr(el, 'dir')) || 0) / W14_UNITS.perDegree) * (Math.PI / 180);
      const s = c ? normalizeTextShadow({ color: c.color, alpha: c.alpha, dxPt: dist * Math.cos(dir), dyPt: dist * Math.sin(dir), blurPt: blur }) : null;
      // A scaled or skewed shadow is drawn as the plain one nearest to it.
      if (s) {
        out.textShadow = s;
        exact = c!.plain && isAbsentOr(el, 'sx', '100000') && isAbsentOr(el, 'sy', '100000') && isAbsentOr(el, 'kx', '0') && isAbsentOr(el, 'ky', '0');
      }
    } else if (el.localName === 'textOutline') {
      const kids = w14Kids(el);
      const fill = kids.find((k) => k.localName === 'solidFill');
      const c = fill ? colorIn(fill, colorOf) : null;
      const o = c ? normalizeTextOutline({ color: c.color, widthPt: pt(attr(el, 'w')) ?? 0.75 }) : null;
      if (o) {
        out.textOutline = o;
        const dash = kids.find((k) => k.localName === 'prstDash');
        exact = c!.plain && c!.alpha === 1 && isAbsentOr(el, 'cmpd', 'sng') && isAbsentOr(el, 'algn', 'ctr')
          && (!dash || attr(dash, 'val') === 'solid')
          && kids.every((k) => ['solidFill', 'prstDash', 'round', 'bevel', 'miter'].includes(k.localName));
      }
    } else if (el.localName === 'textFill') {
      // A solid fill repeats w:color, which the run already carries.
      const kids = w14Kids(el);
      const c = kids.length === 1 && kids[0].localName === 'solidFill' ? colorIn(kids[0], colorOf) : null;
      exact = !!c && c.plain && c.alpha === 1;
    }
    if (!exact) raw.push(tree(el));
  }
  const kept = normalizeTextFxRaw(raw);
  if (kept) out.textFxRaw = kept;
  return out;
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function serialize(e: W14El): string {
  const attrs = Object.entries(e.a ?? {}).map(([k, v]) => ` w14:${k}="${esc(v)}"`).join('');
  const kids = (e.c ?? []).map(serialize).join('');
  return kids ? `<w14:${e.n}${attrs}>${kids}</w14:${e.n}>` : `<w14:${e.n}${attrs}/>`;
}

const emu = (p: number) => Math.round(p * W14_UNITS.emuPerPt);
const srgb = (hex: string, alpha = 1) => {
  const a = alpha < 1 ? `<w14:alpha w14:val="${Math.round((1 - alpha) * W14_UNITS.percent)}"/>` : '';
  return `<w14:srgbClr w14:val="${hex.slice(1).toUpperCase()}"${a ? `>${a}</w14:srgbClr>` : '/>'}`;
};

/** The run's w14 elements in schema order: each kept tree as it came, the drawn effects
 *  written the way Word writes an outer shadow, a glow and a solid outline. */
export function w14EffectsXml(a: TextEffectAttrs): string {
  const els = new Map<string, string>();
  for (const e of normalizeTextFxRaw(a.textFxRaw) ?? []) if (!els.has(e.n)) els.set(e.n, serialize(e));
  const glow = normalizeTextGlow(a.textGlow), shadow = normalizeTextShadow(a.textShadow), outline = normalizeTextOutline(a.textOutline);
  if (glow && !els.has('glow')) els.set('glow', `<w14:glow w14:rad="${emu(glow.radiusPt)}">${srgb(glow.color, glow.alpha)}</w14:glow>`);
  if (shadow && !els.has('shadow')) {
    const dist = Math.hypot(shadow.dxPt, shadow.dyPt);
    const deg = ((Math.atan2(shadow.dyPt, shadow.dxPt) * 180) / Math.PI + 360) % 360;
    els.set('shadow', `<w14:shadow w14:blurRad="${emu(shadow.blurPt)}" w14:dist="${emu(dist)}" w14:dir="${Math.round(deg * W14_UNITS.perDegree) % (360 * W14_UNITS.perDegree)}"`
      + ` w14:sx="100000" w14:sy="100000" w14:kx="0" w14:ky="0" w14:algn="tl">${srgb(shadow.color, shadow.alpha)}</w14:shadow>`);
  }
  if (outline && !els.has('textOutline')) {
    els.set('textOutline', `<w14:textOutline w14:w="${emu(outline.widthPt)}" w14:cap="flat" w14:cmpd="sng" w14:algn="ctr">`
      + `<w14:solidFill>${srgb(outline.color)}</w14:solidFill><w14:prstDash w14:val="solid"/><w14:round/></w14:textOutline>`);
  }
  const rank = (n: string) => { const i = W14_ORDER.indexOf(n); return i < 0 ? W14_ORDER.length : i; };
  return [...els.keys()].sort((x, y) => rank(x) - rank(y)).map((k) => els.get(k)).join('');
}
