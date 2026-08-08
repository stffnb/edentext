# Formulas

Insert/edit a mathematical formula (`editor/extensions/formula.ts`, `components/FormulaDialog.svelte`),
round-tripping to an embedded ODF formula object and to Word's OMML.

## One LaTeX string is the model

The `formula` node stores **`latex`** and a `display` flag — nothing else. Everything is derived:

```
latex ──parse──▶ AST ──▶ MathML   (screen + .odt)
                     └──▶ OMML     (.docx)
OMML  ──parse──▶ AST ──▶ latex     (.docx import)
MathML──parse──▶ AST ──▶ latex     (.odt import)
```

Foreign markup is parsed into the AST and re-serialized, never passed through. That is why the
node view may set `innerHTML` — the MathML it renders is always our own output, so a foreign
`annotation-xml` can't smuggle in HTML. It also means an imported formula is always editable;
there is no read-only state to fall back to.

The price: a construct outside the AST degrades. Unknown OMML/MathML elements recurse into
their `m:e`/child rows, so content survives even where structure doesn't — the same trade
LibreOffice makes routing OMML through StarMath.

`src/lib/math/`: `latex.ts` (AST types, parser, serializer, symbol table), `mathml.ts`,
`omml.ts`. AST kinds: `row`, `txt` (`i`/`n`/`o`/`f` = identifier/number/operator/upright name),
`frac`, `script`, `sqrt`, `fence`, `nary`, `acc`, `matrix`, `space`.

## The LaTeX subset

`\frac`, `_`/`^`, `\sqrt[n]{}`, `\left…\right`, the n-ary operators with limits, the accents,
`matrix`/`pmatrix`/`bmatrix`/`Bmatrix`/`vmatrix`/`cases`, the upright function names, `\text{}`
/`\mathrm{}`, greek + the common operators and relations, `{}` grouping, `&` / `\\`, and the
spacing macros. **Not** supported, deliberately: `align` environments, `\substack`, user macros,
color. An unknown macro degrades to `\text{name}` rather than vanishing.

Two invariants the tests pin (`tests/unit/math.test.ts`, `tests/unit/docx-formula.test.ts`):

- `astToLatex(parseLatex(x)) === x` for every stored source. Without it, opening an imported
  formula in the dialog and pressing Apply would silently rewrite it.
- A literal `^` or `_` in an imported run's **text** is escaped on the way out (Word documents
  contain typed-in code like `corr.^2`), or re-parsing would read it as a script marker.
- Whitespace inside an OMML run is dropped (`omml.ts` `tokenize`): math layout ignores it, and
  keeping it breaks the invariant above.

## STIX Two Math is required, not decoration

MathML is typeset by the browser natively — no KaTeX/MathJax. But Chromium needs a font with
an **OpenType MATH table**: measured in this container with only the bundled Liberation/Carlito
faces installed, `∑` and `ϕ` render as *nothing* and `(` `)` stay glyph-height beside a
fraction. `src/assets/fonts/STIXTwoMath-Regular.woff2` (OFL, the Fontsource latin subset —
the MATH table and the operators survive it) is bundled and wired in `global.css`;
`editor.css` puts it first in the `math` font stack. Word uses Cambria Math for the same job.

## ODF

Export (`export/odt.ts`, sentinel `MTH` U+E012, pass `applyFormulas` right after `applyImages`):
a `<draw:frame text:anchor-type="as-char" draw:style-name="MthFr">` holding
`<draw:object xlink:href="./Formula{n}"/>`, plus `Formula{n}/content.xml` — an ODF formula
sub-document whose root *is* the MathML — and two manifest entries (`Formula{n}/` as
`application/vnd.oasis.opendocument.formula`, its `content.xml` as `text/xml`).

- **No `svg:width`/`svg:height` on the frame, on purpose.** With a size LibreOffice scales the
  object to fill it (a frame measured at the dialog's preview font size magnified the formula
  ~1.5×); without one it typesets at the natural size, matched to the body text. Verified by
  rendering through `soffice`.
- `MthFr` carries `style:vertical-pos="middle" style:vertical-rel="text"`, what LibreOffice
  writes for its own formula frames. `bottom`/`baseline` was tried and drops the formula below
  the line.
- The LaTeX rides in `<annotation encoding="application/x-tex">` so our own files re-import
  exactly. **LibreOffice strips it** and substitutes a StarMath annotation, so the fallback
  path (parse its MathML back to LaTeX) is the one that actually runs after a LO re-save — and
  it reproduces the source exactly (`tests/lo-roundtrip.test.ts`).
- **`display` is read off the paragraph, not the object** (`import/odt.ts` `aloneInParagraph`):
  ODF has no inline/display flag, and LibreOffice writes `display="block"` on every formula it
  re-saves, so trusting the attribute turned every inline formula into a displayed one.

## DOCX

Export (`export/docx.ts`, sentinel `MTH`, post-pack pass `applyFormulasDocx` beside
`applyTextBoxesDocx`): the run holding the sentinel is replaced by `<m:oMath>`, or by
`<m:oMathPara>` when `display` — which is what centers it on its own line. The namespace is
declared inline on the `m:` element, like the `wps`/`a` namespaces in the text-box XML.

Import: `m:oMath`/`m:oMathPara` sit **beside** the `w:r` runs in their own namespace, so
`convertInline` picks them up before its `namespaceURI !== W` guard — that guard is why every
formula in a Word document was silently dropped before this feature. `m:oMathPara` →
`display: true`. Word stores no size for a formula, and neither do we.

## A pasted formula is a picture, not a formula

Real documents mix both: a thesis will carry OMML formulas *and* equations its author pasted
as raster images. Those import as `image` nodes and offer the image toolbar's wrap options on
click — in Word and LibreOffice too. Nothing short of OCR changes that, so a click that offers
wrap options instead of the formula dialog is the document's doing, not a broken import.

## Testing note

`npm run test:lo`'s formula leg needs the **`libreoffice-math`** package — LibreOffice is
modular and Writer alone cannot hold a formula object, so without it every formula is dropped
on load without a word (measured: converting a formula-bearing `.docx` with a Writer-only
install yields an `.odt` with zero formulas). The leg then fails on "both objects survive", which
looks like a broken export but is the missing component. Check `dpkg -l | grep
libreoffice-math` before believing that failure. A desktop LibreOffice ships Math; only
stripped-down server/container installs don't.
