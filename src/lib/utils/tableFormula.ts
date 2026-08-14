// Table cell formulas and number recognition. The stored language is Word's
// (`SUM(ABOVE)`, `A1*2`, no leading `=`), the wider of the two; the two translations
// below cover the ODF leg, where LibreOffice writes `ooow:sum <A1:A3>`.

export type NumberLocale = { decimal: string; group: string };

// The separators the document's language uses, from Intl rather than a table.
export function numberLocale(lang: string): NumberLocale {
  const parts = new Intl.NumberFormat(lang || 'en').formatToParts(1234.5);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

// A cell's text as a number, or null when it is text. Spaces (incl. NBSP and the
// narrow one Intl groups with) and the group separator are noise; anything else
// beyond one sign and one decimal separator makes it text, as in LibreOffice.
export function parseCellNumber(text: string, loc: NumberLocale): number | null {
  let s = text.replace(/[\s  ]/g, '');
  if (loc.group) s = s.split(loc.group).join('');
  if (!s) return null;
  if (loc.decimal !== '.') s = s.split(loc.decimal).join('.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// General number format: no grouping, the locale's decimal separator, and the
// float noise of a sum rounded off.
export function formatCellNumber(n: number, loc: NumberLocale): string {
  if (!Number.isFinite(n)) return '';
  const s = String(Math.round(n * 1e10) / 1e10);
  return loc.decimal === '.' ? s : s.replace('.', loc.decimal);
}

export type CellRef = { row: number; col: number };

export type FormulaCtx = {
  rows: number;
  cols: number;
  self: CellRef;
  // null = the cell holds no number, which stops a directional walk.
  valueAt: (ref: CellRef) => number | null;
};

export function colName(col: number): string {
  let s = '';
  for (let n = col; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

export function parseRef(s: string): CellRef | null {
  const m = /^([A-Z]+)(\d+)$/.exec(s.toUpperCase());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

export const refName = (r: CellRef): string => `${colName(r.col)}${r.row + 1}`;

const DIRECTIONS = ['ABOVE', 'BELOW', 'LEFT', 'RIGHT'] as const;
type Direction = (typeof DIRECTIONS)[number];

const FUNCS: Record<string, (v: number[]) => number> = {
  SUM: (v) => v.reduce((a, b) => a + b, 0),
  PRODUCT: (v) => v.reduce((a, b) => a * b, 1),
  AVERAGE: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
  MIN: (v) => (v.length ? Math.min(...v) : 0),
  MAX: (v) => (v.length ? Math.max(...v) : 0),
  COUNT: (v) => v.length,
  ABS: (v) => Math.abs(v[0] ?? 0),
  INT: (v) => Math.trunc(v[0] ?? 0),
  SIGN: (v) => Math.sign(v[0] ?? 0),
  MOD: (v) => (v[1] ? (v[0] ?? 0) % v[1] : 0),
  ROUND: (v) => {
    const f = 10 ** Math.trunc(v[1] ?? 0);
    return Math.round((v[0] ?? 0) * f) / f;
  },
};

export const FORMULA_FUNCTIONS = Object.keys(FUNCS);

// LibreOffice's own names for the ones it spells differently.
const WRITER_FUNC: Record<string, string> = { AVERAGE: 'mean' };
const FROM_WRITER_FUNC: Record<string, string> = { MEAN: 'AVERAGE' };

type Token = { kind: 'num'; value: number } | { kind: 'name'; value: string } | { kind: 'ref'; value: string } | { kind: 'op'; value: string };

// One tokenizer for both evaluation and the two translations, so a formula the
// evaluator accepts is exactly one an export can rewrite.
function tokenize(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+/.exec(src.slice(i));
      if (!m) return null;
      out.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z]/.test(c)) {
      const m = /^[A-Za-z]+\d*/.exec(src.slice(i))!;
      const word = m[0].toUpperCase();
      out.push(/\d/.test(word) ? { kind: 'ref', value: word } : { kind: 'name', value: word });
      i += m[0].length;
    } else if ('+-*/(),;:%|'.includes(c)) {
      out.push({ kind: 'op', value: c === ';' || c === '|' ? ',' : c });
      i++;
    } else return null;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[], private readonly ctx: FormulaCtx) {}

  parse(): number {
    const v = this.expr();
    if (this.i < this.toks.length) throw new Error('trailing');
    return v;
  }

  private at(value: string): boolean {
    const t = this.toks[this.i];
    return !!t && t.kind === 'op' && t.value === value;
  }

  private expr(): number {
    let v = this.term();
    for (;;) {
      if (this.at('+')) { this.i++; v += this.term(); }
      else if (this.at('-')) { this.i++; v -= this.term(); }
      else return v;
    }
  }

  private term(): number {
    let v = this.unary();
    for (;;) {
      if (this.at('*')) { this.i++; v *= this.unary(); }
      else if (this.at('/')) {
        this.i++;
        const d = this.unary();
        if (d === 0) throw new Error('div0');
        v /= d;
      } else return v;
    }
  }

  private unary(): number {
    if (this.at('-')) { this.i++; return -this.unary(); }
    if (this.at('+')) { this.i++; return this.unary(); }
    let v = this.primary();
    while (this.at('%')) { this.i++; v /= 100; }
    return v;
  }

  private primary(): number {
    const t = this.toks[this.i];
    if (!t) throw new Error('eof');
    if (t.kind === 'num') { this.i++; return t.value; }
    if (this.at('(')) {
      this.i++;
      const v = this.expr();
      if (!this.at(')')) throw new Error('paren');
      this.i++;
      return v;
    }
    if (t.kind === 'ref') { this.i++; return this.cells(t.value).reduce((a, b) => a + b, 0); }
    if (t.kind === 'name') {
      this.i++;
      const fn = FUNCS[t.value];
      if (!fn) return this.direction(t.value).reduce((a, b) => a + b, 0);
      // Both `SUM(A1:A3)` and LibreOffice's parenthesis-free `sum <A1:A3>` arrive
      // here as the same tokens, so the brackets are optional.
      const braced = this.at('(');
      if (braced) this.i++;
      const args: number[] = [];
      for (;;) {
        const a = this.toks[this.i];
        if (!a || (a.kind === 'op' && a.value === ')')) break;
        if (a.kind === 'ref' || (a.kind === 'name' && !FUNCS[a.value])) {
          this.i++;
          args.push(...(a.kind === 'ref' ? this.cells(a.value) : this.direction(a.value)));
        } else args.push(this.expr());
        if (this.at(',')) this.i++;
        else break;
      }
      if (braced) {
        if (!this.at(')')) throw new Error('paren');
        this.i++;
      }
      return fn(args);
    }
    throw new Error('token');
  }

  // A reference or, with a `:` behind it, a rectangular range. A cell holding no
  // number counts as nothing, which is what makes AVERAGE ignore empty cells.
  private cells(name: string): number[] {
    const from = parseRef(name);
    if (!from) throw new Error('ref');
    let to = from;
    if (this.at(':')) {
      this.i++;
      const t = this.toks[this.i];
      if (!t || t.kind !== 'ref') throw new Error('range');
      this.i++;
      const end = parseRef(t.value);
      if (!end) throw new Error('range');
      to = end;
    }
    const out: number[] = [];
    for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) {
      for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) {
        const v = this.ctx.valueAt({ row: r, col: c });
        if (v != null) out.push(v);
      }
    }
    return out;
  }

  // Word's ABOVE/LEFT/BELOW/RIGHT: the run of numbers next to the formula cell,
  // stopping at the first cell that holds none.
  private direction(name: string): number[] {
    if (!(DIRECTIONS as readonly string[]).includes(name)) throw new Error('name');
    const out: number[] = [];
    for (const ref of walk(name as Direction, this.ctx)) {
      const v = this.ctx.valueAt(ref);
      if (v == null) break;
      out.push(v);
    }
    return out;
  }
}

function walk(dir: Direction, ctx: FormulaCtx): CellRef[] {
  const { row, col } = ctx.self;
  const out: CellRef[] = [];
  if (dir === 'ABOVE') for (let r = row - 1; r >= 0; r--) out.push({ row: r, col });
  else if (dir === 'BELOW') for (let r = row + 1; r < ctx.rows; r++) out.push({ row: r, col });
  else if (dir === 'LEFT') for (let c = col - 1; c >= 0; c--) out.push({ row, col: c });
  else for (let c = col + 1; c < ctx.cols; c++) out.push({ row, col: c });
  return out;
}

// null = the formula does not parse, which both word processors print as an error.
export function evalFormula(formula: string, ctx: FormulaCtx): number | null {
  const toks = tokenize(formula.replace(/^=/, '').replace(/[<>]/g, ''));
  if (!toks || toks.length === 0) return null;
  try {
    return new Parser(toks, ctx).parse();
  } catch {
    return null;
  }
}

// The range a direction stands for, so the ODF leg can name cells: LibreOffice's
// formula language has no ABOVE. An empty run collapses to the cell itself.
function resolveDirection(name: string, ctx: FormulaCtx): string {
  if (!(DIRECTIONS as readonly string[]).includes(name)) return name;
  const run: CellRef[] = [];
  for (const ref of walk(name as Direction, ctx)) {
    if (ctx.valueAt(ref) == null) break;
    run.push(ref);
  }
  if (run.length === 0) return refName(ctx.self);
  const [a, b] = [refName(run[run.length - 1]), refName(run[0])];
  return a === b ? a : `${a}:${b}`;
}

const opAt = (toks: Token[], i: number, value: string): boolean => {
  const t = toks[i];
  return !!t && t.kind === 'op' && t.value === value;
};

// `SUM(ABOVE)` → `sum <A1:A3>`: LibreOffice brackets every reference, separates a
// list with `|` and writes a function's argument without parentheses.
export function toWriterFormula(formula: string, ctx: FormulaCtx): string {
  const toks = tokenize(formula.replace(/^=/, '').replace(/[<>]/g, ''));
  if (!toks) return formula;
  // One entry per open bracket: true = a call's, which LibreOffice does not write.
  const swallowed: boolean[] = [];
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'num') out += String(t.value);
    else if (t.kind === 'ref') {
      const range = opAt(toks, i + 1, ':') && toks[i + 2]?.kind === 'ref';
      out += range ? `<${t.value}:${toks[i + 2].value}>` : `<${t.value}>`;
      if (range) i += 2;
    } else if (t.kind === 'name') {
      if (!FUNCS[t.value]) { out += `<${resolveDirection(t.value, ctx)}>`; continue; }
      out += `${WRITER_FUNC[t.value] ?? t.value.toLowerCase()} `;
      if (opAt(toks, i + 1, '(')) { i++; swallowed.push(true); }
    } else if (t.value === '(') { swallowed.push(false); out += '('; }
    else if (t.value === ')') { if (!swallowed.pop()) out += ')'; }
    else out += t.value === ',' ? '|' : t.value;
  }
  return out.trim();
}

// The reverse, for both foreign legs: LibreOffice's `ooow:sum <A1:A3>` and Word's
// `=SUM(A1:A3)` both land back on the stored form.
export function fromWriterFormula(raw: string): string {
  const body = raw.replace(/^\s*(ooow:|of:)+/, '').replace(/^\s*=/, '').trim();
  const toks = tokenize(body.replace(/[<>]/g, ''));
  if (!toks) return body;
  let open = 0;
  let out = '';
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'num') out += String(t.value);
    else if (t.kind === 'ref') out += t.value;
    else if (t.kind === 'name') {
      const name = FROM_WRITER_FUNC[t.value] ?? t.value;
      if (!FUNCS[name]) { out += name; continue; }
      out += `${name}(`;
      // Only a call LibreOffice wrote without brackets still needs one closed.
      if (opAt(toks, i + 1, '(')) i++;
      else open++;
    } else out += t.value;
  }
  return out + ')'.repeat(open);
}
