// MathML face of the formula AST: what the browser renders on screen and what goes
// into the .odt's embedded formula object. Foreign MathML is parsed back into the AST
// (never re-emitted verbatim), so nothing untrusted reaches the NodeView's innerHTML.

import {
  type MathNode, type TxtKind, row, txt, classify, naryIsUnder, FUNCS,
} from './latex';

export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TAG_BY_KIND: Record<TxtKind, string> = { i: 'mi', n: 'mn', o: 'mo', f: 'mi' };

// A row that MathML needs as a single element (mfrac, msup, … each take exactly one
// child per slot), so a multi-node row is wrapped in <mrow>.
function slot(n: MathNode): string {
  const xml = astToMathml(n);
  return n.k === 'row' && n.xs.length !== 1 ? `<mrow>${xml}</mrow>` : xml;
}

export function astToMathml(n: MathNode): string {
  switch (n.k) {
    case 'row': return n.xs.map(astToMathml).join('');
    case 'txt': {
      if (n.kind === 'f') return `<mi mathvariant="normal">${esc(n.s)}</mi>`;
      // Multi-letter identifiers stay upright in MathML unless split, and a number
      // like 3.14 is one token — so emit the run whole and let the class pick the tag.
      return `<${TAG_BY_KIND[n.kind]}>${esc(n.s)}</${TAG_BY_KIND[n.kind]}>`;
    }
    case 'frac': return `<mfrac>${slot(n.num)}${slot(n.den)}</mfrac>`;
    case 'script': {
      const base = slot(n.base);
      if (n.sub && n.sup) return `<msubsup>${base}${slot(n.sub)}${slot(n.sup)}</msubsup>`;
      if (n.sub) return `<msub>${base}${slot(n.sub)}</msub>`;
      return `<msup>${base}${slot(n.sup ?? row([]))}</msup>`;
    }
    case 'sqrt':
      return n.index
        ? `<mroot>${slot(n.x)}${slot(n.index)}</mroot>`
        : `<msqrt>${astToMathml(n.x)}</msqrt>`;
    case 'fence': {
      const open = n.open ? `<mo stretchy="true">${esc(n.open)}</mo>` : '';
      const close = n.close ? `<mo stretchy="true">${esc(n.close)}</mo>` : '';
      return `<mrow>${open}${astToMathml(n.x)}${close}</mrow>`;
    }
    case 'nary': {
      const op = `<mo>${esc(n.op)}</mo>`;
      const under = n.under;
      let sign = op;
      if (n.lo && n.hi) sign = `<${under ? 'munderover' : 'msubsup'}>${op}${slot(n.lo)}${slot(n.hi)}</${under ? 'munderover' : 'msubsup'}>`;
      else if (n.lo) sign = `<${under ? 'munder' : 'msub'}>${op}${slot(n.lo)}</${under ? 'munder' : 'msub'}>`;
      else if (n.hi) sign = `<${under ? 'mover' : 'msup'}>${op}${slot(n.hi)}</${under ? 'mover' : 'msup'}>`;
      return `<mrow>${sign}${astToMathml(n.x)}</mrow>`;
    }
    case 'acc':
      return `<mover accent="true">${slot(n.x)}<mo stretchy="true">${esc(n.ch)}</mo></mover>`;
    case 'matrix': {
      const body = n.rows
        .map(r => `<mtr>${r.map(c => `<mtd>${astToMathml(c)}</mtd>`).join('')}</mtr>`)
        .join('');
      const open = n.open ? `<mo stretchy="true">${esc(n.open)}</mo>` : '';
      const close = n.close ? `<mo stretchy="true">${esc(n.close)}</mo>` : '';
      return `<mrow>${open}<mtable>${body}</mtable>${close}</mrow>`;
    }
    case 'space': return `<mspace width="${n.em}em"/>`;
  }
}

// The full <math> element for one formula.
export function mathmlDocument(latexAst: MathNode, display: boolean, latex?: string): string {
  const body = `<mrow>${astToMathml(latexAst)}</mrow>`;
  // The LaTeX source rides along so our own documents re-import losslessly; a foreign
  // reader ignores the annotation and renders the presentation markup.
  const annotated = latex != null
    ? `<semantics>${body}<annotation encoding="application/x-tex">${esc(latex)}</annotation></semantics>`
    : body;
  return `<math xmlns="${MATHML_NS}" display="${display ? 'block' : 'inline'}">${annotated}</math>`;
}

// ---- parsing ---------------------------------------------------------------

const kids = (el: Element): Element[] =>
  Array.from(el.children).filter(c => c.localName !== 'annotation' && c.localName !== 'annotation-xml');

const one = (el: Element, i: number): MathNode => {
  const c = kids(el)[i];
  return c ? parseMathmlNode(c) : row([]);
};

// Presentation MathML → AST. Unknown elements recurse into their children, so a
// construct we don't model still contributes its text instead of disappearing.
export function parseMathmlNode(el: Element): MathNode {
  const cs = kids(el);
  switch (el.localName) {
    case 'math':
    case 'semantics':
    case 'mrow':
    case 'mstyle':
    case 'mpadded':
    case 'mtd':
      return fence(cs.map(parseMathmlNode));
    case 'mi': {
      const s = el.textContent ?? '';
      const upright = el.getAttribute('mathvariant') === 'normal';
      return { k: 'txt', s, kind: upright && (s.length > 1 || FUNCS.includes(s)) ? 'f' : classify(s[0] ?? 'x') };
    }
    case 'mn': return txt(el.textContent ?? '', 'n');
    case 'mo': return txt(el.textContent ?? '', 'o');
    case 'mtext': return { k: 'txt', s: el.textContent ?? '', kind: 'f' };
    case 'mfrac': return { k: 'frac', num: one(el, 0), den: one(el, 1) };
    case 'msqrt': return { k: 'sqrt', x: fence(cs.map(parseMathmlNode)) };
    case 'mroot': return { k: 'sqrt', x: one(el, 0), index: one(el, 1) };
    case 'msub': return { k: 'script', base: one(el, 0), sub: one(el, 1) };
    case 'msup': return { k: 'script', base: one(el, 0), sup: one(el, 1) };
    case 'msubsup': return { k: 'script', base: one(el, 0), sub: one(el, 1), sup: one(el, 2) };
    case 'munder': return limits(one(el, 0), one(el, 1), undefined);
    case 'mover': return over(el, cs);
    case 'munderover': return limits(one(el, 0), one(el, 1), one(el, 2));
    case 'mtable':
      return {
        k: 'matrix',
        rows: cs.map(r => kids(r).map(parseMathmlNode)),
        open: '', close: '',
      };
    case 'mspace': {
      const w = parseFloat(el.getAttribute('width') ?? '0');
      return { k: 'space', em: Number.isFinite(w) ? w : 0.167 };
    }
    default:
      return cs.length ? fence(cs.map(parseMathmlNode)) : txt(el.textContent ?? '', 'o');
  }
}

// mover is either an accent (\bar x) or an n-ary upper limit, told apart by @accent.
function over(el: Element, cs: Element[]): MathNode {
  const base = one(el, 0);
  const mark = cs[1];
  if (el.getAttribute('accent') === 'true' || ACCENT_MARKS.test(mark?.textContent ?? '')) {
    return { k: 'acc', ch: mark?.textContent ?? '^', x: base };
  }
  return limits(base, undefined, one(el, 1));
}

const ACCENT_MARKS = /^[\^ˆ~˜‾¯⃗˙¨ˇ˘´`]$/;

// A script on an operator is that operator's limit; on anything else it stays a script.
function limits(base: MathNode, lo: MathNode | undefined, hi: MathNode | undefined): MathNode {
  if (base.k === 'txt' && base.kind === 'o') {
    return { k: 'nary', op: base.s, lo, hi, x: row([]), under: naryIsUnder(base.s) };
  }
  return { k: 'script', base, sub: lo, sup: hi };
}

// An mrow whose first/last child is a stretchy bracket is a fence — recovering it keeps
// the LaTeX readable (\left( … \right)) and lets the OMML side emit an m:d.
function fence(xs: MathNode[]): MathNode {
  const isBracket = (n: MathNode | undefined) => n?.k === 'txt' && n.kind === 'o' && /^[([{|‖⟨⌊⌈]$/.test(n.s);
  const isClose = (n: MathNode | undefined) => n?.k === 'txt' && n.kind === 'o' && /^[)\]}|‖⟩⌋⌉]$/.test(n.s);
  if (xs.length >= 2 && isBracket(xs[0]) && isClose(xs[xs.length - 1])) {
    const open = (xs[0] as { s: string }).s;
    const close = (xs[xs.length - 1] as { s: string }).s;
    return { k: 'fence', open, close, x: row(xs.slice(1, -1)) };
  }
  return row(xs);
}

// The <math> root of an ODF formula → AST. Prefers our own LaTeX annotation when the
// document is one we wrote, so a round trip is exact rather than merely equivalent.
export function parseMathml(mathEl: Element): { latex: string | null; ast: MathNode; display: boolean } {
  const ann = Array.from(mathEl.getElementsByTagName('*'))
    .find(e => e.localName === 'annotation' && e.getAttribute('encoding') === 'application/x-tex');
  return {
    latex: ann?.textContent?.trim() || null,
    ast: parseMathmlNode(mathEl),
    display: mathEl.getAttribute('display') === 'block',
  };
}
