import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { parseLatex, astToLatex } from '../../src/lib/math/latex';

const formula = (latex: string, display = false) =>
  ({ type: 'formula', attrs: { latex, display } });
const text = (t: string) => ({ type: 'text', text: t });

const docXml = async (doc: any) =>
  strFromU8(unzipSync(await buildDocx(doc as any))['word/document.xml']);

// Formulas walk their own namespace beside the w:r runs; the docx library has no OMML,
// so they ride a sentinel run that a post-pack pass swaps out.
describe('DOCX formulas', () => {
  it('writes OMML for an inline formula and oMathPara for a display one', async () => {
    const xml = await docXml({ type: 'doc', content: [
      { type: 'paragraph', content: [text('Es gilt '), formula('E=mc^{2}'), text(' immer.')] },
      { type: 'paragraph', content: [formula('\\frac{a}{b}', true)] },
    ] });
    expect(xml).toContain('<m:oMath');
    expect(xml).toContain('<m:sSup>');
    expect(xml).toContain('<m:oMathPara');
    expect(xml).toContain('<m:f>');
    // The sentinel run must be gone, not merely wrapped.
    expect(xml).not.toContain('');
    expect(xml).toContain('Es gilt ');
  });

  it('round-trips both through import', async () => {
    const bytes = await buildDocx({ type: 'doc', content: [
      { type: 'paragraph', content: [text('x '), formula('\\sum_{i=1}^{n} x_{i}')] },
      { type: 'paragraph', content: [formula('\\sqrt{a+b}', true)] },
    ] } as any);
    const res = importDocx(bytes);
    const found: any[] = [];
    (function walk(n: any) { if (n.type === 'formula') found.push(n); for (const c of n.content ?? []) walk(c); })(res.content);
    expect(found.map((f) => f.attrs.latex)).toEqual(['\\sum_{i=1}^{n} x_{i}', '\\sqrt{a+b}']);
    expect(found.map((f) => f.attrs.display)).toEqual([false, true]);
  });

  // Sources harvested from a real Word document (the fixtures directory is gitignored, so
  // they live here as literals). Each one broke the parser once: the n-ary swallowing the
  // enclosing \right, a literal ^ from typed-in code, a run's trailing space.
  it('re-serializes messy real-world sources unchanged', () => {
    const REAL = [
      '\\sigma ^{2}=\\int_{-pi}^{pi} [\\phi -{E\\left\\{\\phi \\right\\}]}^{2}pdf(\\phi )d\\phi ',
      'res=1./sqrt(2*L).*sqrt(1-corr.\\^2)./corr',
      '\\phi _{inf}=\\phi _{ref}+\\phi _{top}+\\phi _{atm}',
      'C\\left(r\\right)=\\sigma ^{2}-S(r)/2',
      '\\frac{1}{2*\\left(L-1\\right)}*\\left\\{\\sum_{r=0}^{L-2} \\frac{\\Gamma *\\left(L-\\frac{1}{2}\\right)}{\\Gamma *\\left(L-1\\right)}\\right\\}',
    ];
    // Editing an imported formula must not rewrite it: the dialog round-trips the source
    // through the parser on every Apply.
    for (const src of REAL) expect(astToLatex(parseLatex(src)), src).toBe(src);
  });
});
