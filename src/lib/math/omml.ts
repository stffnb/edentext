// OMML face of the formula AST — Word's math markup (`m:oMath`). Same contract as
// mathml.ts: parse foreign OMML into the AST, never pass it through.

import { type MathNode, row, txt, classify, naryIsUnder, FUNCS } from './latex';

export const OMML_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

// `m:e` and friends take element content only, so every slot is serialized whole.
const slot = (tag: string, n: MathNode) => `<${tag}>${astToOmml(n)}</${tag}>`;

export function astToOmml(n: MathNode): string {
  switch (n.k) {
    case 'row': return n.xs.map(astToOmml).join('');
    // m:sty="p" is Word's upright run; without it a function name comes back italic.
    case 'txt': return `<m:r>${n.kind === 'f' ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<m:t xml:space="preserve">${esc(n.s)}</m:t></m:r>`;
    case 'frac': return `<m:f><m:fPr><m:ctrlPr/></m:fPr>${slot('m:num', n.num)}${slot('m:den', n.den)}</m:f>`;
    case 'script': {
      if (n.sub && n.sup) return `<m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr>${slot('m:e', n.base)}${slot('m:sub', n.sub)}${slot('m:sup', n.sup)}</m:sSubSup>`;
      if (n.sub) return `<m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr>${slot('m:e', n.base)}${slot('m:sub', n.sub)}</m:sSub>`;
      return `<m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr>${slot('m:e', n.base)}${slot('m:sup', n.sup ?? row([]))}</m:sSup>`;
    }
    case 'sqrt':
      return n.index
        ? `<m:rad><m:radPr><m:degHide m:val="0"/><m:ctrlPr/></m:radPr>${slot('m:deg', n.index)}${slot('m:e', n.x)}</m:rad>`
        : `<m:rad><m:radPr><m:degHide m:val="1"/><m:ctrlPr/></m:radPr><m:deg/>${slot('m:e', n.x)}</m:rad>`;
    case 'fence':
      return `<m:d><m:dPr><m:begChr m:val="${attr(n.open)}"/><m:endChr m:val="${attr(n.close)}"/><m:ctrlPr/></m:dPr>${slot('m:e', n.x)}</m:d>`;
    case 'nary': {
      const pr =
        `<m:naryPr><m:chr m:val="${attr(n.op)}"/><m:limLoc m:val="${n.under ? 'undOvr' : 'subSup'}"/>` +
        `<m:subHide m:val="${n.lo ? 0 : 1}"/><m:supHide m:val="${n.hi ? 0 : 1}"/><m:ctrlPr/></m:naryPr>`;
      return `<m:nary>${pr}${slot('m:sub', n.lo ?? row([]))}${slot('m:sup', n.hi ?? row([]))}${slot('m:e', n.x)}</m:nary>`;
    }
    case 'acc': return `<m:acc><m:accPr><m:chr m:val="${attr(n.ch)}"/><m:ctrlPr/></m:accPr>${slot('m:e', n.x)}</m:acc>`;
    case 'matrix': {
      const cols = Math.max(1, ...n.rows.map(r => r.length));
      const props = `<m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${cols}"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs><m:ctrlPr/></m:mPr>`;
      const body = n.rows.map(r => `<m:mr>${r.map(c => slot('m:e', c)).join('')}</m:mr>`).join('');
      const table = `<m:m>${props}${body}</m:m>`;
      if (!n.open && !n.close) return table;
      return `<m:d><m:dPr><m:begChr m:val="${attr(n.open)}"/><m:endChr m:val="${attr(n.close)}"/><m:ctrlPr/></m:dPr><m:e>${table}</m:e></m:d>`;
    }
    // OMML has no measured space; a run of blanks is the closest Word equivalent.
    case 'space': return `<m:r><m:t xml:space="preserve">${n.em >= 1 ? '  ' : ' '}</m:t></m:r>`;
  }
}

// One `<m:oMath>` element, namespace declared inline so the output never depends on
// what the docx library put on the document root.
export const ommlDocument = (ast: MathNode): string =>
  `<m:oMath xmlns:m="${OMML_NS}">${astToOmml(ast)}</m:oMath>`;

// ---- parsing ---------------------------------------------------------------

const mChild = (el: Element, name: string): Element | null => {
  for (const c of Array.from(el.children)) if (c.namespaceURI === OMML_NS && c.localName === name) return c;
  return null;
};
const mVal = (el: Element | null, name: string): string | null => {
  const c = el && mChild(el, name);
  return c ? c.getAttributeNS(OMML_NS, 'val') : null;
};
const part = (el: Element, name: string): MathNode => {
  const c = mChild(el, name);
  return c ? parseOmmlNode(c) : row([]);
};
// Element children, minus the property/control blocks that carry no content.
const kids = (el: Element): Element[] =>
  Array.from(el.children).filter(c => c.namespaceURI === OMML_NS && !/Pr$/.test(c.localName));

// A run's text: `m:sty="p"` (or a Word `w:rPr` without italics on a word) means upright.
function runNode(el: Element): MathNode {
  const text = Array.from(el.children)
    .filter(c => c.namespaceURI === OMML_NS && c.localName === 't')
    .map(c => c.textContent ?? '')
    .join('');
  if (!text) return row([]);
  const upright = mVal(mChild(el, 'rPr'), 'sty') === 'p';
  if (upright && (text.length > 1 || FUNCS.includes(text))) return { k: 'txt', s: text, kind: 'f' };
  // A run holds a whole expression ("2*L-1"), so split it into per-class tokens —
  // otherwise every digit and operator would inherit the first character's class.
  return row(tokenize(text));
}

// Split a run's text into maximal same-class tokens (letters, digits, operators).
// Whitespace is dropped: math layout ignores it (explicit gaps are \, and \quad), and
// keeping it would make the LaTeX stop round-tripping through its own parser.
function tokenize(text: string): MathNode[] {
  const out: MathNode[] = [];
  let buf = '';
  let kind = classify(text[0]);
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    const k = classify(ch);
    // Letters stay one token per character: `ab` is a·b in math, not the word "ab".
    if (k === kind && buf && k !== 'i' && k !== 'o') { buf += ch; continue; }
    if (buf) out.push(txt(buf, kind));
    buf = ch;
    kind = k;
  }
  if (buf) out.push(txt(buf, kind));
  return out;
}

// OMML → AST. An element we don't model falls through to its `m:e` children, so its
// content survives even when its structure doesn't.
export function parseOmmlNode(el: Element): MathNode {
  switch (el.localName) {
    case 'oMath':
    case 'oMathPara':
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'fName':
      return row(kids(el).map(parseOmmlNode));
    case 'r': return runNode(el);
    case 'f': return { k: 'frac', num: part(el, 'num'), den: part(el, 'den') };
    case 'sSub': return { k: 'script', base: part(el, 'e'), sub: part(el, 'sub') };
    case 'sSup': return { k: 'script', base: part(el, 'e'), sup: part(el, 'sup') };
    case 'sSubSup': return { k: 'script', base: part(el, 'e'), sub: part(el, 'sub'), sup: part(el, 'sup') };
    case 'rad': {
      const hidden = mVal(mChild(el, 'radPr'), 'degHide') !== '0';
      const deg = mChild(el, 'deg');
      const index = hidden || !deg || !deg.children.length ? undefined : parseOmmlNode(deg);
      return { k: 'sqrt', x: part(el, 'e'), index };
    }
    case 'd': {
      const pr = mChild(el, 'dPr');
      // Word omits begChr/endChr for the default round brackets.
      const open = mVal(pr, 'begChr') ?? '(';
      const close = mVal(pr, 'endChr') ?? ')';
      const inner = Array.from(el.children).filter(c => c.namespaceURI === OMML_NS && c.localName === 'e');
      const body = inner.length > 1
        // A multi-slot delimiter (m:sepChr) is a matrix-like list; keep it as a row.
        ? row(inner.map(parseOmmlNode))
        : part(el, 'e');
      if (body.k === 'matrix') return { ...body, open, close };
      return { k: 'fence', open, close, x: body };
    }
    case 'nary': {
      const pr = mChild(el, 'naryPr');
      const op = mVal(pr, 'chr') ?? '∫';
      const under = (mVal(pr, 'limLoc') ?? (naryIsUnder(op) ? 'undOvr' : 'subSup')) === 'undOvr';
      const lo = mVal(pr, 'subHide') === '1' ? undefined : part(el, 'sub');
      const hi = mVal(pr, 'supHide') === '1' ? undefined : part(el, 'sup');
      return { k: 'nary', op, lo: nonEmpty(lo), hi: nonEmpty(hi), x: part(el, 'e'), under };
    }
    case 'func': return row([part(el, 'fName'), part(el, 'e')]);
    case 'acc': return { k: 'acc', ch: mVal(mChild(el, 'accPr'), 'chr') ?? '̂', x: part(el, 'e') };
    case 'bar': return { k: 'acc', ch: '‾', x: part(el, 'e') };
    case 'm': {
      const rows = Array.from(el.children)
        .filter(c => c.namespaceURI === OMML_NS && c.localName === 'mr')
        .map(r => kids(r).map(parseOmmlNode));
      return { k: 'matrix', rows, open: '', close: '' };
    }
    case 'limLow': return { k: 'nary', op: opOf(part(el, 'e')), lo: part(el, 'lim'), x: row([]), under: true };
    case 'limUpp': return { k: 'nary', op: opOf(part(el, 'e')), hi: part(el, 'lim'), x: row([]), under: true };
    default: return row(kids(el).map(parseOmmlNode));
  }
}

const nonEmpty = (n: MathNode | undefined): MathNode | undefined =>
  n && n.k === 'row' && n.xs.length === 0 ? undefined : n;

const opOf = (n: MathNode): string => (n.k === 'txt' ? n.s : 'lim');

// `m:oMath` / `m:oMathPara` → the formula's LaTeX-ready AST plus its display flag.
export function parseOmml(el: Element): { ast: MathNode; display: boolean } {
  return { ast: parseOmmlNode(el), display: el.localName === 'oMathPara' };
}
