# Render parity

Opens the same document in **LibreOffice** and in **the editor**, then compares the
resulting text layout. Everything else in `tests/` compares documents at the model
level (JSON → export → import); this leg is the only one that checks what a page
actually looks like.

```bash
npm run test:parity:fixtures   # (re)generate the baseline .docx corpus
npm run test:parity            # whole corpus
npm run test:parity -- path/to/file.docx --json report.json
npm run test:parity -- '04-table|13-images'  # regex over the corpus' file names
npm run test:parity -- --quick # skip what last measured over 50 pages
```

Exit code 1 when any document differs. `--json` also dumps both sides' lines
(`y`, `x`, `x2` in mm, per page) and each document's `summary` — diagnose from that dump.

Every run prints each document's **cause** count against the previous run's (see *Causes,
not symptoms* below) and updates `render-parity-baseline.json` in the checkout's git
directory (`git rev-parse --git-dir`, so each worktree keeps its own even where they share
one `node_modules`; `PARITY_BASELINE` names another file), so an
A/B measurement reads `218 (was 220, −2)` without comparing two reports by hand, followed
by the causes that are `new:` and `gone:` since then. The run ends with the totals, the
causes per kind and the documents with the most causes, each with its causes per ten
pages. A run of one file leaves the other files' recorded counts alone. `--no-baseline`
neither reads nor writes it — use it when measuring a deliberately broken tree. A document
whose render times out is retried once; one that still fails is listed as FAILED and is in
no total, so read that line before reading a drop.

Four documents render at a time (`PARITY_JOBS`, 1 for a serial run): a page is its own
browser context and the reference is the file's alone. Each document's lines are written
in one call, so the console reads in completion order while `--json` keeps the corpus'.
Measured on 15 fixtures, 1:15 serial against 0:27. A run of a few long documents gains
little, since the longest document sets its time.

**The LibreOffice side is cached** in `node_modules/.cache/render-parity` (`PARITY_CACHE`),
which parallel worktrees may share, keyed by the file's hash and
the export arguments: the reference never depends on our code, so only the first run of
a document converts it — the whole corpus measured **9:00 cold against 5:41 cached**,
and one fixture 15s against 10s. `--no-cache` after installing or removing a font,
which does change what LibreOffice renders.

**A PDF beside a fixture replaces LibreOffice as its reference**: `name.docx` with a
`name.pdf` next to it is compared against that PDF, the way the file's own word processor
laid it out. Use it where that layout is the right one and LibreOffice's is not — the
console line then reads `PDF 2p` in place of `LO 2p`.

## How it compares

| | reference | editor |
|---|---|---|
| render | `soffice --convert-to pdf` | Playwright Chromium, real app, real file input |
| read | `pdftotext -bbox-layout` (word boxes, pt) | `Range.getClientRects()` (word boxes, px) |
| pictures | `pdftohtml -xml` (image boxes, pt) | each `img`'s bounding rect (px) |

The PDF is exported with `IsSkipEmptyPages=false`: LibreOffice drops its own
auto-inserted blank pages by default — a chapter forced onto a right page — and the
reference then has fewer sheets than the document LibreOffice lays out (the
458-page guide 456 against 468, one fixture 28 against 32).

Both sides are normalized to mm from the top-left of each page and grouped into lines
(`compare.mjs`, the pure half of the harness — `tests/unit/parity-compare.test.ts`
covers it without a browser). Comparison is whitespace-insensitive, because the
spell-check decorations split text nodes mid-word and the two engines needn't agree on
word boundaries — only on what sits on a line; the invisible joiners a note anchor
leaves behind are ignored for the same reason.

The two documents are then **aligned as a whole**, not compared line index against line
index: after a divergence the harness searches up to `SYNC_WINDOW` lines on both sides
for the nearest pair of skips that makes two consecutive lines match again. One dropped
line therefore costs one report, not every line after it, and a page-level slip shows up
as a `pageBreak` naming the line the page starts at instead of a wall of noise.

Where no resync is in reach it steps both sides by one and keeps comparing. A contents
block whose numbers are all off by one has no two consecutive matching rows anywhere in
it, and declaring the documents parted there hid 465 of the 458-page guide's pages
behind a single report. Contiguous divergent lines are merged into one report carrying
how many lines each side spent, so the region still reads as one difference.

Reported differences are `pageCount`, `pageBreak` (a page starts `carry` lines later or
earlier in the editor, or `only` on one side), `lineCount`, `lineBreak` (same place,
different words) and `position` / `lineEnd` (same words, off by more than `POS_TOL_MM`).
Consecutive lines off by the *same* amount are one report with a `×n` count, since that is
one cause — a strut, a spacing, a band height — and not n of them.

## Causes, not symptoms

One line too many early in a document used to move every later line: each became a
`position` report, every page start a pair of page shifts, so the 63-page guide reported
1205 differences of which 457 were lines more than 10mm off on a page the editor had
already broken differently. `compare` still reports every symptom, but marks the ones an
earlier difference explains as `follows`, and `summarize` counts what is left — **the
causes**, the number a run is judged by:

- **Vertically a line is measured against the line before it.** A `position` whose offset
  the previous line already had `follows`; one that adds more than `POS_TOL_MM` is a
  `vertical: 'step'`, and offsets that creep up line by line past it are a `'drift'`
  (`byMm` is what the line adds). A page top is measured against the page; after a page
  only one side starts, or lines one side spent more of, the count starts again there.
- **A page start** pairs with the other side's nearest one; a page that starts as many
  lines off as the page before it only carries that on and `follows`.
- **A text region** whose lines are the same on both sides in another order (a body line
  and a running foot swapping places at a page end) `follows` that page break.
- **A picture** that moved with the line nearest to it `follows` that line.
- `summarize` then folds neighbouring lines of one kind on a page into one cause (a
  font's width shows on every line it touches), one drift per page, and the same text on
  another page — page numbers aside — into its first occurrence: a running head or foot
  off on every page is one cause.

Each cause has a root kind, printed in front of it and totalled at the end of a run:
`pages`, `pageBreak`, `content` (lines only one side has), `wrap` (lines broken
differently), `vertical`, `horizontal` (indent, alignment), `width` (where a line ends:
font width, tabs, justification) and `image`. `first:` names where a document starts to
differ — the place to look first, since everything after it may be its consequence.
Issues stay in the `--json` dump with their `follows` mark for diagnosis; the issue count
printed beside the causes includes them.

Pictures are compared apart from the text: each reference picture pairs with the
editor's nearest one of about its size, page first; a picture left over pairs with one of
another size only on its own page and within half its size again either way.
A pair off by more than `POS_TOL_MM`, sized differently by more than 1.5mm or on another
page is an `image` report; a picture left unpaired is an `imageCount` one. A picture that
moves with drifting text is reported beside that text. pdftohtml sees only raster images:
a vector drawing is a picture only on the editor's side. A cropped picture counts on both
sides with its uncropped box, the one its clip cuts from. Counts recorded before
2026-09-28 leave pictures out. Counts recorded before 2026-09-03 came from the index-wise
comparison, which stopped at the first divergence per page: they are not comparable to
what a run prints now.

## Prerequisites

```bash
apt-get install -y --no-install-recommends libreoffice-writer poppler-utils
npm install --no-save playwright-core && npx playwright-core install chromium
cp $(ls src/assets/fonts/*.ttf | grep -v Gelasio) /usr/local/share/fonts/ && fc-cache -f
```

**The font step is required.** LibreOffice renders with system fonts; without
the repo's own TTFs installed it substitutes DejaVu for Liberation Serif and every
line breaks differently for a reason that is not a bug. With them, both engines
resolve Times New Roman → Liberation Serif, Arial → Liberation Sans, Calibri →
Carlito, Cambria → Caladea — the same files the editor bundles. Georgia → Gelasio is the
editor's alone: its face takes Georgia's line, shorter than Gelasio's own, so the install leaves Gelasio
out; installed, it makes LibreOffice set fewer lines per page than the file's font does.

Where the LibreOffice build ships those families itself (the macOS app bundle does:
`Contents/Resources/fonts/truetype/`), it resolves them without fontconfig and the step
is only about what it does *not* ship — `fc-list` showing neither Liberation nor Carlito
does not invalidate a run there.

**Install only what LibreOffice does not already ship.** A second copy of a
family it bundles makes its render *non-deterministic*: it picks between the two
files per run — measured as `Carlito` against `Carlito-Regular` in the PDF's font
list — and their vertical metrics differ, so a page carrying a large-font heading
lands 1.85mm lower on some runs and a fixture's issue count varies by 40. The
browser side never needs the install: the app `@font-face`s its own copies. On a
macOS install `/Applications/LibreOffice.app/Contents/Resources/fonts/truetype/`
already holds Carlito, Caladea and Liberation, so **skip the `cp` there entirely**;
check any other platform with `fc-list | grep -ci carlito` before copying.

The runner starts `npm run dev` on port 5199 itself if nothing answers there.

## Fixtures

`make-fixtures.mjs` authors the baseline corpus with the `docx` lib **directly**,
not through `src/lib/export/docx.ts` — otherwise the corpus would test our exporter
against itself — and converts each document to its ODT twin with LibreOffice. It
writes them to **`tests/corpus/`, which is committed**: `tests/corpus.test.ts` reads
them at the model level (import → our own export → import) on every `npm test`, so
CI runs against documents this editor did not write. A run with no argument compares
that corpus *and* the local documents: `edentext-testdocs/` beside the main checkout
(`tests/localDocs.mjs`; `EDENTEXT_TESTDOCS` names another folder), which every worktree
finds and no commit can pick up — keep whatever real-world files you test against there.
Its `long_documents/` subfolder runs only when a path or a pattern names its files.

## Names stay local

A real-world document's name goes in no file, and a commit message names no document at
all — write the rule that changed and what it measured. `FINDINGS.md` is gitignored for
that reason.

Only this harness and the layout run read the local documents. No clone has them, so a `tests/unit/` test
reading them fails with `ENOENT` on a fresh clone; it zips its own document instead
(`docx-onoff.test.ts` — both importers take a `Uint8Array`, not a path), or reads
`tests/corpus/`, which is committed. CI greps for the read.

## Probing with a purpose-built document

The fastest probe is an `.odt` of your own run through the harness: both engines lay the
same file out and the report is the measurement, in the units the corpus uses. Build it
with `fflate` (`zipSync`), keep it in the scratchpad. Two pitfalls: `mimetype` has
to be stored uncompressed (`{ level: 0 }`) or LibreOffice produces no PDF at all, and a
`style:font-name` with **no `<style:font-face>` declaration** is not resolved: LibreOffice
falls back (Calibri → Liberation Sans) where the editor honours the name, which invents a
line-height difference that is not there in any real document.

## Calibri Light alias

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

## What a `lineBreak` run usually is

Both word processors **shrink** the spaces of a justified line to pull one more word
onto it; CSS `text-align: justify` only stretches. Probed on one paragraph: justified,
LibreOffice keeps a word the browser drops, and the same paragraph left-aligned breaks
in both engines at the same word. So a long justified document reports a `lineBreak`
every dozen pages without a defect: the browser fits slightly less per line, about a
quarter page over fifty. Left-align a passage before attributing a break difference to
the editor.

## What the harness cannot see

`extractLayout` walks **text nodes**, so anything drawn by CSS is invisible to it: a
list marker and a chapter number both ride `hN::before`, and a numbered heading is
therefore always reported as if it carried no number. Check those against the contents
rows instead, which hold the same label as real text, or against a screenshot
(`docs/headless-testing.md`). A `text-transform` is the case the harness *does* handle
— it reads the case the style paints, not the node's.
