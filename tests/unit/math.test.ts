import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseLatex, astToLatex } from '../../src/lib/math/latex';
import { astToMathml, mathmlDocument, parseMathml } from '../../src/lib/math/mathml';
import { astToOmml, ommlDocument, parseOmml } from '../../src/lib/math/omml';

const parseXml = (xml: string): Element => {
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  return doc.documentElement;
};

// LaTeX is the formula node's only stored form, so every other direction has to land
// back on it unchanged — otherwise editing an imported formula rewrites it.
const roundTrip = (src: string) => astToLatex(parseLatex(src));

describe('LaTeX parse ↔ serialize', () => {
  it('is idempotent over the constructs the editor offers', () => {
    for (const src of [
      'a+b',
      '\\frac{1}{2}',
      '\\frac{a+1}{2\\pi }',
      'x^{2}',
      'x_{i}^{2}',
      '\\phi _{ref}',
      '\\sqrt{x+y}',
      '\\sqrt[3]{x}',
      '\\left(\\frac{1}{2}\\right)',
      '\\left|\\gamma \\right|',
      '\\sum_{i=1}^{n} x_{i}',
      '\\int_{0}^{\\infty } f',
      '\\bar{x}',
      '\\vec{v}',
      '\\sin \\left(x\\right)',
      '\\begin{pmatrix}a & b \\\\ c & d\\end{pmatrix}',
    ]) {
      expect(roundTrip(src), src).toBe(src);
      // A second pass must not drift either.
      expect(roundTrip(roundTrip(src)), src).toBe(src);
    }
  });

  it('keeps an unknown macro as readable text instead of dropping it', () => {
    expect(roundTrip('\\wibble')).toBe('\\text{wibble}');
  });
});

describe('MathML', () => {
  it('emits the elements the browser needs to typeset', () => {
    expect(astToMathml(parseLatex('\\frac{1}{2}'))).toBe('<mfrac><mn>1</mn><mn>2</mn></mfrac>');
    expect(astToMathml(parseLatex('x^2'))).toBe('<msup><mi>x</mi><mn>2</mn></msup>');
    expect(astToMathml(parseLatex('\\sqrt{x}'))).toBe('<msqrt><mi>x</mi></msqrt>');
    // A sum's limits sit under/over the sign, an integral's beside it.
    expect(astToMathml(parseLatex('\\sum_{i}^{n} x'))).toContain('<munderover>');
    expect(astToMathml(parseLatex('\\int_{0}^{1} x'))).toContain('<msubsup>');
    // Brackets must be stretchy or they stay glyph-height next to a fraction.
    expect(astToMathml(parseLatex('\\left(x\\right)'))).toContain('<mo stretchy="true">(</mo>');
  });

  it('round-trips through the document element', () => {
    const src = '\\frac{a+1}{2\\pi }';
    const el = parseXml(mathmlDocument(parseLatex(src), false, src));
    const got = parseMathml(el);
    expect(got.latex).toBe(src);          // our own annotation is preferred verbatim
    expect(astToLatex(got.ast)).toBe(src); // and the presentation markup agrees
    expect(got.display).toBe(false);
  });

  it('reads foreign MathML that carries no annotation', () => {
    const el = parseXml(
      '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>' +
      '<msub><mi>&#x3D5;</mi><mi mathvariant="normal">ref</mi></msub>' +
      '<mo>=</mo><mfrac><mn>1</mn><mi>&#x3C0;</mi></mfrac></mrow></math>',
    );
    const got = parseMathml(el);
    expect(got.latex).toBeNull();
    expect(astToLatex(got.ast)).toBe('\\phi _{\\text{ref}}=\\frac{1}{\\pi }');
    expect(got.display).toBe(true);
  });
});

describe('OMML', () => {
  it('emits Word\'s elements', () => {
    expect(astToOmml(parseLatex('\\frac{1}{2}'))).toContain('<m:f>');
    expect(astToOmml(parseLatex('x_i'))).toContain('<m:sSub>');
    expect(astToOmml(parseLatex('\\sqrt{x}'))).toContain('<m:rad>');
    expect(astToOmml(parseLatex('\\left[x\\right]'))).toContain('<m:begChr m:val="["/>');
    expect(astToOmml(parseLatex('\\sum_{i}^{n} x'))).toContain('<m:limLoc m:val="undOvr"/>');
    // A function name has to be marked upright or Word renders "sin" italic.
    expect(astToOmml(parseLatex('\\sin x'))).toContain('<m:sty m:val="p"/>');
  });

  it('round-trips our own output', () => {
    for (const src of ['\\frac{a}{b}', 'x_{i}^{2}', '\\sqrt[3]{x}', '\\sum_{i=1}^{n} x', '\\left(a+b\\right)']) {
      const el = parseXml(ommlDocument(parseLatex(src)));
      expect(astToLatex(parseOmml(el).ast), src).toBe(src);
    }
  });

  // Lifted verbatim from a real Word document; markup of this shape was dropped on
  // import before this feature existed.
  it('reads Word\'s own markup', () => {
    const NS = ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"' +
      ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const sub = parseXml(
      `<m:oMath${NS}><m:sSub><m:sSubPr><m:ctrlPr><w:rPr><w:i/></w:rPr></m:ctrlPr></m:sSubPr>` +
      '<m:e><m:r><m:t>\u03D5</m:t></m:r></m:e><m:sub><m:r><m:t>ref</m:t></m:r></m:sub></m:sSub></m:oMath>',
    );
    expect(astToLatex(parseOmml(sub).ast)).toBe('\\phi _{ref}');

    const frac = parseXml(
      `<m:oMathPara${NS}><m:oMath><m:f><m:fPr><m:ctrlPr/></m:fPr>` +
      '<m:num><m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr><m:e><m:d><m:dPr><m:begChr m:val="|"/><m:endChr m:val="|"/><m:ctrlPr/></m:dPr>' +
      '<m:e><m:r><m:t>\u03B3</m:t></m:r></m:e></m:d></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:num>' +
      '<m:den><m:r><m:t>2\u03C0</m:t></m:r></m:den></m:f>' +
      '<m:func><m:funcPr><m:ctrlPr/></m:funcPr><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>arcsin</m:t></m:r></m:fName>' +
      '<m:e><m:d><m:dPr><m:ctrlPr/></m:dPr><m:e><m:r><m:t>\u03B2</m:t></m:r></m:e></m:d></m:e></m:func></m:oMath></m:oMathPara>',
    );
    const got = parseOmml(frac);
    expect(got.display).toBe(true);
    expect(astToLatex(got.ast)).toBe(
      '\\frac{\\left|\\gamma \\right|^{2}}{2\\pi }\\arcsin \\left(\\beta \\right)',
    );
  });

  it('splits a run that holds a whole expression into typed tokens', () => {
    const NS = ' xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
    const el = parseXml(`<m:oMath${NS}><m:r><m:t>2*L-1</m:t></m:r></m:oMath>`);
    expect(astToMathml(parseOmml(el).ast))
      .toBe('<mn>2</mn><mo>*</mo><mi>L</mi><mo>-</mo><mn>1</mn>');
  });
});
