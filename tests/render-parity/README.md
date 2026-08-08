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
metafile figures and a German TOC) — still report:

- **A frame's vertical anchor offset is ignored.** A `wp:anchor` carries a y offset from
  its paragraph; the editor floats it at the anchor itself, so a top-and-bottom wrapped
  figure sits where its caption paragraph is instead of where Word puts it (the thesis'
  page 15, 131mm out). The horizontal offset round-trips (`wrapOffset`); the vertical one
  has no CSS equivalent while the frame stays in flow.
- **One header/footer set for the whole document.** Word gives every *section* its own,
  including its own first page; the contract's second section repeats the letterhead on
  page 10 and the body starts 25mm lower there than here.
- **Dot leaders.** LibreOffice fills a TOC entry to its page number with dots; the
  editor's index lays the number out with flex and leaves the gap empty.
- **A block ending in a hard break renders one line too many.** ProseMirror appends a
  trailing-break `<br>` so the empty last line stays caret-reachable, but under
  `white-space: pre-wrap` that line already exists. Hiding the hack node fixes the height
  and costs the caret that line, so it is hidden only after an inline atom, where there
  is no such line (`editor.css`). Reproduces natively with Shift+Enter, no import needed.
- **Chromium does not break after a slash**, LibreOffice does — "Sensor/Messinstrument"
  stays one word in a narrow table cell and wraps a line later.
- **Line height follows the paragraph, not the line.** The block's CSS strut applies to
  every line; a word processor takes each line's own runs and the paragraph mark only on
  the last. The mark's font rides the block (`blockFontSize.ts`), and a paragraph whose
  runs all agree takes theirs — which covers everything the corpus has. A paragraph of
  *mixed* sizes still struts at the block's.
- **Charts and metafiles are placeholders.** No renderer exists for either, so an
  undrawable frame keeps its box and its label but not its picture (`imageFormats.ts`).
  Exporting writes the placeholder back out — the original is gone from the moment it
  is imported.
- **Tabs that wrap lose their advance.** Six consecutive tabs at a line end stay on that
  line in Chromium and the continuation starts at the margin; LibreOffice carries the
  tab positions onto it (91mm apart in the contract).
- **A run of dots is one unbreakable word** to Chromium, while LibreOffice breaks inside
  it — a dotted fill-in line wraps at a different place.
- **A trailing space counts toward a right-aligned line** under `white-space: pre-wrap`,
  pushing the text ~1.2mm left of where LibreOffice puts it.
- Lines whose natural width lands within ~0.2mm of the right margin may take one word
  more or fewer than LibreOffice. Sub-0.1mm engine rounding, not a layout rule.

What tab stops (`tabStops.ts`) deliberately left out, none of it exercised by a fixture:

- **Leader characters** (`w:tab w:leader`, `style:leader-text`) are dropped — the dotted
  run before a TOC page number. odf-kit can't emit them either.
- **The default tab interval is fixed at 1.25cm**, so a file's own `w:defaultTabStop` /
  `style:tab-stop-distance` is ignored. It is the CSS `tab-size`, which the measuring
  pass leaves to handle every tab past the last custom stop.
- **Header/footer zones** get no stops: an inactive zone is static HTML from
  `generateHTML`, which no ProseMirror plugin reaches.

## Known ceilings

- Lines are grouped by vertical band, so **multi-column** text on one page merges
  columns into single lines. Columns fixtures need per-block grouping first.
- Only text is compared — no images, rules, fills or borders.
- LibreOffice is the reference, not Word. They agree on the layout rules exercised
  here, but not on everything (e.g. Word's own line-height rounding).
