# Render parity

Opens the same document in **LibreOffice** and in **the editor**, then compares the
resulting text layout. Everything else in `tests/` compares documents at the model
level (JSON → export → import); this leg is the only one that checks what a page
actually looks like.

```bash
npm run test:parity:fixtures   # (re)generate the baseline .docx corpus
npm run test:parity            # whole corpus
npm run test:parity -- path/to/file.docx --json report.json
```

Exit code 1 when any document differs. `--json` also dumps both sides' lines
(`y`, `x`, `x2` in mm, per page) — that dump is what you diagnose from.

## How it compares

| | reference | editor |
|---|---|---|
| render | `soffice --convert-to pdf` | Playwright Chromium, real app, real file input |
| read | `pdftotext -bbox-layout` (word boxes, pt) | `Range.getClientRects()` (word boxes, px) |

Both sides are normalized to mm from the top-left of each page, grouped into lines,
and compared as: page count → line count → line text → line position. Comparison is
whitespace-insensitive, because the spell-check decorations split text nodes
mid-word and the two engines needn't agree on word boundaries — only on what sits
on a line.

Reported differences are `pageCount`, `lineCount`, `lineBreak` (same line, different
words) and `position` (same words, off by more than `POS_TOL_MM`). Comparison of a
page stops at the first line-level divergence, since everything after it is noise.

## Prerequisites

```bash
apt-get install -y --no-install-recommends libreoffice-writer poppler-utils
npm install --no-save playwright-core && npx playwright-core install chromium
cp src/assets/fonts/*.ttf /usr/local/share/fonts/ && fc-cache -f
```

**The font step is not optional.** LibreOffice renders with system fonts; without
the repo's own TTFs installed it substitutes DejaVu for Liberation Serif and every
line breaks differently for a reason that is not a bug. With them, both engines
resolve Times New Roman → Liberation Serif, Arial → Liberation Sans, Calibri →
Carlito, Cambria → Caladea — the same files the editor bundles.

The runner starts `npm run dev` on port 5199 itself if nothing answers there.

## Fixtures

`make-fixtures.mjs` authors the baseline corpus with the `docx` lib **directly**,
not through `src/lib/export/docx.ts` — otherwise the corpus would test our exporter
against itself. Real-world `.docx`/`.odt` files dropped into `fixtures/` are picked
up too. The directory is gitignored: run the generator once, and keep whatever
real-world files you test against local.

## Differences that are not editor bugs

- **Justified text.** LibreOffice *compresses* inter-word spaces (measured: 0.864mm
  against a natural 1.058mm) to pull one more word onto a line. CSS justification
  only stretches, and Chromium exposes no minimum-word-spacing control, so a
  justified line may end one word short. `02-blocks` reports this permanently.
- **Omitted properties of built-in styles.** For a style it recognizes by name,
  LibreOffice fills what the file leaves out from its own defaults (a Heading with
  no spacing gets 0.42cm before). Word uses only what the file declares, and so do
  we — so fixtures must declare heading spacing and font explicitly, or the
  reference disagrees with Word rather than with us.

## Prerequisites, part two: Calibri Light

Word's default theme heading font. LibreOffice's substitution table knows Calibri but
not Calibri Light, so without an alias it falls to fontconfig's generic — DejaVu Serif,
a serif heading nothing else renders. Word substitutes plain Calibri, and so does the
editor (`global.css`), so give LibreOffice the same answer:

```xml
<!-- /etc/fonts/conf.d/30-calibri-light.conf, then fc-cache -f -->
<match target="pattern">
  <test name="family"><string>Calibri Light</string></test>
  <edit name="family" mode="prepend" binding="strong"><string>Carlito</string></edit>
</match>
```

## Open findings

What the three real-world fixtures — the contract (an IHK
contract form), the summary (a student summary: bullets,
wrapped pictures, one table) and the thesis (a 48-page thesis with charts,
metafile figures and a German TOC) — still report. The thesis matches LibreOffice's 49 pages,
with 51 line-level differences — most of them the two engine rules below, not layout:

- **A hoisted text box loses the vertical offset it was anchored by.** A frame's own
  offsets are drawn now (`docs/architecture/frames.md`), but a text box anchored inside a
  paragraph is a block node here, so the importer lifts it out and it simply follows that
  paragraph. On the thesis' figure page that leaves its caption 4.7mm high — LibreOffice
  places the box by its own 19.52cm, we place it after the picture.
  Attempted and **reverted**: a top margin of the offset minus the previous block's
  measured height overshot by 4.5mm (231.2 against 227.7, from 223.0) and improved
  nothing in the corpus. The anchor paragraph's box is not the right basis — the frame
  it holds is a float, so its height is the text's alone.
- **Page geometry is document-wide.** Headers and footers are per section (each is
  editable in place), but margins, orientation and format are not — a file whose sections
  disagree on them keeps the last one's.
- **Line height follows the paragraph, not the line.** The block's CSS strut applies to
  every line; a word processor takes each line's own runs and the paragraph mark only on
  the last. The mark's font rides the block (`blockFontSize.ts`), and a paragraph whose
  runs all agree takes theirs — which covers everything the corpus has. A paragraph of
  *mixed* sizes still struts at the block's.
  Attempted and **reverted**: `line-height: 0` on the block with the content's line-height
  restored by an inline decoration does drop the strut, and measured right on a purpose-built
  fixture (a 24pt run over 10pt text came to 62.1pt against LibreOffice's 61.8, from 69.0).
  It cost the contract 22 issues all the same. Two things the strut was quietly holding up:
  a line of no runs at all — two breaks in a row — collapses to nothing, and the reserved
  paragraph mark is an `::after` on the block, so the same rule takes the *last* line's
  height away with it. An empty widget span at the block's end gets that line back but not
  to the same value. Whatever replaces the strut has to carry both.
- **Metafiles are placeholders, and a re-export keeps the placeholder.** EMF/WMF/SVM have
  no JS decoder, so such a frame keeps its box and its label but not its picture
  (`imageFormats.ts`) — and what is exported is that placeholder. **Charts** are drawn
  now (`import/chart.ts`), but as a *picture*: a re-export carries the drawing, not a
  chart object, since the editor has none.
- **A list level's own hanging indent is not read**, only the 0.635cm both exports
  write (`LIST_HANGING_CM`). A **left**-set label wider than that overflows into the text,
  where Word moves the text to the next list tab — reading `w:lvl/w:pPr/w:ind w:hanging`
  would settle it. Deliberate for now: in flow, a wide marker pushed the text and cost
  the thesis fixture a page. (The level's *left* indent is read at every depth, and a
  **right**-set label — `markerAlign`, which is what the built-in Roman numberings use —
  grows into the margin, so the case that actually collided is gone.)
  What a probe of the ODF side turned up, before anything is built on it: LibreOffice
  honours a nested level's `fo:text-indent` linearly (−0.300 → label at 2.243cm, −1.000
  → 1.543, −1.200 → 1.344, against `fo:margin-left="2.540cm"`) — **except** at −1.270,
  the value odf-kit writes for level 2, where it draws its own flat 0.635cm hanging
  (1.909cm) instead. So reading the attribute back naively moves the markers of our own
  exports. Whatever rule that is has to be understood before the value is trusted.
- Lines take one word more or fewer than LibreOffice, which is most of the thesis'
  remaining `lineBreak` reports. Two causes, both measured on that fixture:
  - **LibreOffice compresses inter-word spaces to fit a line**, CSS justification only
    expands. Of 349 full-width justified lines, **91** are narrower in LibreOffice than
    their natural width here — up to **0.83px per space** at 12pt (p99 0.68px).
    Attempted and **reverted**: `word-spacing: -0.05em` on justified blocks. It does fix
    the break decision (the thesis' page 6 paragraph goes 7 lines → LibreOffice's 6), but
    the corpus got *worse* — `lineBreak` 45 → 43 while `lineEnd` went 2 → 16, because the
    tighter spacing also shortens every paragraph's unjustified last line by 1–3mm.
  - Sub-0.1mm engine rounding, which **accumulates**: matching word widths (11.86mm for
    `haben,` on both sides) had drifted 0.45mm apart by the 150th mm of the line.
    LibreOffice quantizes each glyph advance where Chromium keeps it fractional, and
    nothing in CSS exposes that.

## Findings that did not survive measurement

Kept here so they are not re-derived. Each was checked against `soffice` on a purpose-built
one-page fixture.

- **A trailing space on a right-aligned line.** LibreOffice counts it exactly as we do
  (its last glyph lands at 189.0mm, ours at 188.9mm). Hanging it — which is what Word
  does — moved us 1.0mm *away* from the reference, so it was reverted.
- **Breaking after a slash, and inside a run of dots.** Neither engine does either:
  `Sensor/Messinstrument` and a 50-dot leader stay one word in both. What LibreOffice
  really does that we did not is break a word *wider than its line*; that is fixed
  (`overflow-wrap: break-word`).
- **A block ending in a hard break.** Real — the next paragraph sat 4.7mm too low — but
  the cause was not the trailing-break `<br>`: under `pre-wrap` that adds no line. It was
  the always-reserved paragraph mark, which is inline content *past* the break and so
  opened a line of its own. Fixed in `editor.css`.

## Known ceilings

- **A stop's leader is drawn, but the harness can't see it.** The fill is CSS generated
  content, so `Range.getClientRects()` reads the gap as empty while LibreOffice's PDF has
  the dots in its text. The contract's `Zwischen ......` line reports a `lineBreak` for
  that reason alone — compare it by eye, not by this harness.
- Lines are grouped by vertical band, so **multi-column** text on one page merges
  columns into single lines. Columns fixtures need per-block grouping first.
- **Only where text sits is compared** — not what it looks like. A dropped colour,
  highlight, fill, border or image changes nothing this harness can see, so a green
  run does not mean the page matches. Word's highlighter pen went unread through
  several rounds of green reports. Check that by eye: `pdftoppm -r 96 -png` the
  LibreOffice PDF beside a Playwright screenshot of the same page. Two traps there —
  the app's toolbar and ruler cover the top ~85px of a page in the viewport, and
  LibreOffice caches font matching per user profile, so a reused profile keeps
  substituting the font it resolved before `30-calibri-light.conf` existed.
- LibreOffice is the reference, not Word. They agree on the layout rules exercised
  here, but not on everything (e.g. Word's own line-height rounding).
