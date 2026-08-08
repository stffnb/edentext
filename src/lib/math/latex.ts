// The formula AST and its LaTeX face. A formula node stores only its LaTeX source;
// every other representation (MathML on screen and in .odt, OMML in .docx) is derived
// from the tree this module parses. See docs/architecture/formulas.md.

export type TxtKind = 'i' | 'n' | 'o' | 'f'; // identifier, number, operator, upright name

export type MathNode =
  | { k: 'row'; xs: MathNode[] }
  | { k: 'txt'; s: string; kind: TxtKind }
  | { k: 'frac'; num: MathNode; den: MathNode }
  | { k: 'script'; base: MathNode; sub?: MathNode; sup?: MathNode }
  | { k: 'sqrt'; x: MathNode; index?: MathNode }
  | { k: 'fence'; open: string; close: string; x: MathNode }
  | { k: 'nary'; op: string; lo?: MathNode; hi?: MathNode; x: MathNode; under: boolean }
  | { k: 'acc'; ch: string; x: MathNode }
  | { k: 'matrix'; rows: MathNode[][]; open: string; close: string }
  | { k: 'space'; em: number };

export const row = (xs: MathNode[]): MathNode => (xs.length === 1 ? xs[0] : { k: 'row', xs });
export const txt = (s: string, kind: TxtKind): MathNode => ({ k: 'txt', s, kind });
const EMPTY: MathNode = { k: 'row', xs: [] };

// ---- symbols ---------------------------------------------------------------
// One table drives both directions, so an imported α is written back as \alpha.
export const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', ast: '∗', star: '⋆',
  circ: '∘', bullet: '∙', oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', equiv: '≡',
  approx: '≈', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', in: '∈', notin: '∉',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', forall: '∀', exists: '∃',
  neg: '¬', wedge: '∧', vee: '∨', angle: '∠', perp: '⊥', parallel: '∥',
  infty: '∞', partial: '∂', nabla: '∇', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ',
  aleph: 'ℵ', prime: '′', degree: '°', dots: '…', ldots: '…', cdots: '⋯',
  vdots: '⋮', ddots: '⋱',
  rightarrow: '→', to: '→', leftarrow: '←', gets: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  uparrow: '↑', downarrow: '↓',
};

// n-ary operators: the ones whose limits sit under/over the sign in display style.
export const NARY: Record<string, string> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
  bigwedge: '⋀', bigvee: '⋁', lim: 'lim',
};
const UNDER_LIMITS = new Set(['sum', 'prod', 'coprod', 'bigcup', 'bigcap', 'bigoplus', 'bigotimes', 'bigwedge', 'bigvee', 'lim']);

// Upright function names (LaTeX writes \sin, Word an m:func with m:sty="p").
export const FUNCS = [
  'arccos', 'arcsin', 'arctan', 'arg', 'cosh', 'coth', 'cos', 'cot', 'csc',
  'deg', 'det', 'dim', 'exp', 'gcd', 'hom', 'inf', 'ker', 'lg', 'ln', 'log',
  'max', 'min', 'Pr', 'sec', 'sinh', 'sin', 'sup', 'tanh', 'tan',
];

const ACCENTS: Record<string, string> = {
  bar: '‾', overline: '‾', hat: '^', widehat: '^', tilde: '~', widetilde: '~',
  vec: '⃗', dot: '˙', ddot: '¨', check: 'ˇ', breve: '˘', acute: '´', grave: '`',
};
const ACCENT_BY_CHAR: Record<string, string> = {
  '‾': 'bar', '¯': 'bar', '^': 'hat', 'ˆ': 'hat', '~': 'tilde', '˜': 'tilde',
  '⃗': 'vec', '→': 'vec', '˙': 'dot', '¨': 'ddot', 'ˇ': 'check', '˘': 'breve',
  '´': 'acute', '`': 'grave',
};
export const accentName = (ch: string): string => ACCENT_BY_CHAR[ch] ?? 'hat';

const OPEN_CLOSE: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']', '\\{': '{', '\\}': '}', '|': '|',
  '\\|': '‖', '\\langle': '⟨', '\\rangle': '⟩', '\\lfloor': '⌊', '\\rfloor': '⌋',
  '\\lceil': '⌈', '\\rceil': '⌉', '.': '',
};

const MATRIX_FENCES: Record<string, [string, string]> = {
  matrix: ['', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'],
  Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'],
  cases: ['{', ''],
};

const SPACES: Record<string, number> = { ',': 0.167, ':': 0.222, ';': 0.278, '!': -0.167, quad: 1, qquad: 2 };

// Reverse symbol lookup, first name wins so \le beats \leq when writing back.
const NAME_BY_CHAR = new Map<string, string>();
for (const [name, ch] of Object.entries(SYMBOLS)) if (!NAME_BY_CHAR.has(ch)) NAME_BY_CHAR.set(ch, name);
const NARY_BY_CHAR = new Map<string, string>();
for (const [name, ch] of Object.entries(NARY)) if (!NARY_BY_CHAR.has(ch)) NARY_BY_CHAR.set(ch, name);

export const naryIsUnder = (op: string): boolean => {
  const name = NARY_BY_CHAR.get(op);
  return !!name && UNDER_LIMITS.has(name);
};

// The character class decides the MathML element (mi/mn/mo) and OMML styling.
export function classify(ch: string): TxtKind {
  if (/[0-9.]/.test(ch)) return 'n';
  if (/[A-Za-z]/.test(ch)) return 'i';
  if (/[Ͱ-Ͽἀ-῿℀-⅏]/.test(ch)) return 'i'; // greek, letterlike
  return 'o';
}

// ---- parser ----------------------------------------------------------------

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): MathNode {
    const xs = this.parseUntil(null);
    return row(xs);
  }

  // Reads nodes until `stop` (a control word like `right` or `end`) or the input ends.
  // The terminator is consumed by the caller's dedicated reader, not here.
  private parseUntil(stop: string | null): MathNode[] {
    const out: MathNode[] = [];
    while (this.i < this.src.length) {
      const c = this.src[this.i];
      if (c === '}') break;
      if (stop && this.peekCmd() === stop) break;
      if (c === '&' || (c === '\\' && this.src.startsWith('\\\\', this.i))) break;
      const n = this.atom();
      if (!n) break;
      out.push(this.scripts(n, stop));
    }
    return out;
  }

  // A trailing _/^ binds to the atom just read; both orders and a bare `\limits` are
  // accepted, and an n-ary's scripts become its limits rather than a script pair.
  private scripts(base: MathNode, stop: string | null): MathNode {
    let sub: MathNode | undefined;
    let sup: MathNode | undefined;
    for (;;) {
      this.ws();
      const c = this.src[this.i];
      if (c === '_' && sub === undefined) { this.i++; sub = this.group(); }
      else if (c === '^' && sup === undefined) { this.i++; sup = this.group(); }
      else if (this.peekCmd() === 'limits' || this.peekCmd() === 'nolimits') { this.readCmd(); }
      else break;
    }
    if (sub === undefined && sup === undefined) return base;
    if (base.k === 'nary' && base.x.k === 'row' && base.x.xs.length === 0) {
      // \sum_{i=1}^n f — the limits attach to the operator, the body is the rest of
      // the enclosing group, so it has to stop where that group does (\right, \end).
      const body = this.parseUntil(stop);
      // Only the immediately following atoms belong to the operator; the parse loop
      // owns the rest, so put them back by returning a row.
      return { ...base, lo: sub, hi: sup, x: row(body) };
    }
    return { k: 'script', base, sub, sup };
  }

  // A `{…}` group, a single character, or one command.
  private group(): MathNode {
    this.ws();
    if (this.src[this.i] === '{') {
      this.i++;
      const xs = this.parseUntil(null);
      if (this.src[this.i] === '}') this.i++;
      return row(xs);
    }
    return this.atom() ?? EMPTY;
  }

  private ws() { while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i++; }

  private peekCmd(): string | null {
    let j = this.i;
    while (j < this.src.length && /\s/.test(this.src[j])) j++;
    if (this.src[j] !== '\\') return null;
    const m = /^\\([A-Za-z]+)/.exec(this.src.slice(j));
    return m ? m[1] : null;
  }

  private readCmd(): string {
    this.ws();
    this.i++; // backslash
    const m = /^[A-Za-z]+/.exec(this.src.slice(this.i));
    if (!m) { const c = this.src[this.i] ?? ''; this.i++; return c; }
    this.i += m[0].length;
    return m[0];
  }

  private atom(): MathNode | null {
    this.ws();
    if (this.i >= this.src.length) return null;
    const c = this.src[this.i];
    if (c === '}' || c === '&') return null;
    if (c === '\\') return this.command();
    if (c === '_' || c === '^') return null; // handled by scripts()
    if (c === '{') return this.group();
    this.i++;
    return txt(c, classify(c));
  }

  private command(): MathNode | null {
    if (this.src.startsWith('\\\\', this.i)) return null;
    const name = this.readCmd();

    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
      return { k: 'frac', num: this.group(), den: this.group() };
    }
    if (name === 'sqrt') {
      let index: MathNode | undefined;
      this.ws();
      if (this.src[this.i] === '[') {
        const end = this.src.indexOf(']', this.i);
        const inner = end < 0 ? '' : this.src.slice(this.i + 1, end);
        this.i = end < 0 ? this.src.length : end + 1;
        index = parseLatex(inner);
      }
      return { k: 'sqrt', x: this.group(), index };
    }
    if (name === 'left') return this.fence();
    if (name === 'begin') return this.environment();
    if (name === 'text' || name === 'mathrm' || name === 'mathit' || name === 'operatorname') {
      const g = this.group();
      return { k: 'txt', s: flatText(g), kind: name === 'mathit' ? 'i' : 'f' };
    }
    if (name in ACCENTS) return { k: 'acc', ch: ACCENTS[name], x: this.group() };
    if (name in NARY) return { k: 'nary', op: NARY[name], x: EMPTY, under: UNDER_LIMITS.has(name) };
    if (FUNCS.includes(name)) return { k: 'txt', s: name, kind: 'f' };
    if (name in SYMBOLS) return txt(SYMBOLS[name], classify(SYMBOLS[name]));
    if (name in SPACES) return { k: 'space', em: SPACES[name] };
    if (name === '{' || name === '}' || name === '|') return txt(name === '|' ? '‖' : name, 'o');
    if (/^[^A-Za-z]$/.test(name)) return txt(name, classify(name)); // \$, \%, \&, …
    // An unknown macro degrades to its own name rather than vanishing.
    return { k: 'txt', s: name, kind: 'f' };
  }

  private fence(): MathNode {
    const open = this.delimiter();
    const xs = this.parseUntil('right');
    let close = '';
    if (this.peekCmd() === 'right') { this.readCmd(); close = this.delimiter(); }
    return { k: 'fence', open, close, x: row(xs) };
  }

  private delimiter(): string {
    this.ws();
    if (this.src[this.i] === '\\') {
      const name = this.readCmd();
      const key = `\\${name}`;
      return key in OPEN_CLOSE ? OPEN_CLOSE[key] : (SYMBOLS[name] ?? name);
    }
    const c = this.src[this.i] ?? '';
    this.i++;
    return OPEN_CLOSE[c] ?? c;
  }

  private environment(): MathNode {
    const name = flatText(this.group());
    const fences = MATRIX_FENCES[name] ?? ['', ''];
    const rows: MathNode[][] = [];
    let cells: MathNode[] = [];
    for (;;) {
      if (this.peekCmd() === 'end') { this.readCmd(); this.group(); break; }
      if (this.i >= this.src.length) break;
      cells.push(row(this.parseUntil('end')));
      this.ws();
      if (this.src[this.i] === '&') { this.i++; continue; }
      if (this.src.startsWith('\\\\', this.i)) { this.i += 2; rows.push(cells); cells = []; continue; }
      if (this.peekCmd() === 'end') { this.readCmd(); this.group(); break; }
      break;
    }
    if (cells.length) rows.push(cells);
    return { k: 'matrix', rows, open: fences[0], close: fences[1] };
  }
}

export function parseLatex(src: string): MathNode {
  return new Parser(src ?? '').parse();
}

// The plain text of a subtree — used for \text{…} bodies and environment names.
function flatText(n: MathNode): string {
  switch (n.k) {
    case 'txt': return n.s;
    case 'row': return n.xs.map(flatText).join('');
    default: return '';
  }
}

// ---- serializer ------------------------------------------------------------

const FENCE_CMD: Record<string, string> = {
  '{': '\\{', '}': '\\}', '‖': '\\|', '⟨': '\\langle', '⟩': '\\rangle',
  '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '': '.',
};
const SPACE_CMD: Record<string, string> = { '0.167': '\\,', '0.222': '\\:', '0.278': '\\;', '-0.167': '\\!', '1': '\\quad', '2': '\\qquad' };

// A subtree needs braces wherever LaTeX takes a single token (fraction parts, scripts).
const braced = (n: MathNode): string => `{${astToLatex(n)}}`;

export function astToLatex(n: MathNode): string {
  switch (n.k) {
    case 'row': return n.xs.map(astToLatex).join('');
    case 'txt': return n.kind === 'f' ? funcLatex(n.s) : n.s.split('').map(charLatex).join('');
    case 'frac': return `\\frac${braced(n.num)}${braced(n.den)}`;
    case 'script': {
      const base = needsBrace(n.base) ? braced(n.base) : astToLatex(n.base);
      return base + (n.sub ? `_${braced(n.sub)}` : '') + (n.sup ? `^${braced(n.sup)}` : '');
    }
    case 'sqrt': return `\\sqrt${n.index ? `[${astToLatex(n.index)}]` : ''}${braced(n.x)}`;
    case 'fence': return `\\left${fenceCmd(n.open)}${astToLatex(n.x)}\\right${fenceCmd(n.close)}`;
    case 'nary': {
      const op = NARY_BY_CHAR.get(n.op) ? `\\${NARY_BY_CHAR.get(n.op)}` : n.op;
      const lo = n.lo ? `_${braced(n.lo)}` : '';
      const hi = n.hi ? `^${braced(n.hi)}` : '';
      return `${op}${lo}${hi} ${astToLatex(n.x)}`;
    }
    case 'acc': return `\\${accentName(n.ch)}${braced(n.x)}`;
    case 'matrix': {
      const env = matrixEnv(n.open, n.close);
      const body = n.rows.map(r => r.map(astToLatex).join(' & ')).join(' \\\\ ');
      return `\\begin{${env}}${body}\\end{${env}}`;
    }
    case 'space': return SPACE_CMD[String(n.em)] ?? '\\,';
  }
}

// A multi-character or structural base must be braced or `_`/`^` would bind to its last token.
function needsBrace(n: MathNode): boolean {
  return !(n.k === 'txt' && n.s.length === 1) && n.k !== 'fence' && n.k !== 'sqrt' && n.k !== 'frac';
}

// A literal ^ or _ from an imported formula's text must be escaped, or re-parsing
// would read it as a script marker (Word documents do contain typed-in code).
function charLatex(ch: string): string {
  const name = NAME_BY_CHAR.get(ch);
  if (name) return `\\${name} `;
  return /[#$%&_{}^]/.test(ch) ? `\\${ch}` : ch;
}

function funcLatex(s: string): string {
  if (FUNCS.includes(s)) return `\\${s} `;
  return `\\text{${s}}`;
}

function fenceCmd(ch: string): string {
  return FENCE_CMD[ch] ?? (ch || '.');
}

function matrixEnv(open: string, close: string): string {
  for (const [name, [o, c]] of Object.entries(MATRIX_FENCES)) {
    if (name !== 'matrix' && o === open && c === close) return name;
  }
  return 'matrix';
}
