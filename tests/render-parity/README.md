# Render parity

Opens the same document in **LibreOffice** and in **the editor**, then compares the
resulting text layout. Everything else in `tests/` compares documents at the model
level (JSON → export → import); this leg is the only one that checks what a page
actually looks like.

```bash
npm run test:parity:fixtures   # (re)generate the baseline .docx corpus
npm run test:parity            # whole corpus
npm run test:parity -- path/to/file.docx --json report.json
npm run test:parity -- --quick # skip what last measured over 50 pages
```

Exit code 1 when any document differs. `--json` also dumps both sides' lines
(`y`, `x`, `x2` in mm, per page) — that dump is what you diagnose from.

Every run prints each document's issue count against the previous run's and updates
`node_modules/.cache/render-parity/baseline.json`, so an A/B measurement reads
`218 (was 220, −2)` instead of being arithmetic over two reports. A run of one file
leaves the other files' recorded counts alone. `--no-baseline` neither reads nor
writes it — use it when measuring a deliberately broken tree.

**The LibreOffice side is cached** in the same directory, keyed by the file's hash and
the export arguments: the reference never depends on our code, so only the first run of
a document pays for it — the whole corpus measured **9:00 cold against 5:41 cached**,
and one fixture 15s against 10s. `--no-cache` after installing or removing a font,
which does change what LibreOffice renders.

## How it compares

| | reference | editor |
|---|---|---|
| render | `soffice --convert-to pdf` | Playwright Chromium, real app, real file input |
| read | `pdftotext -bbox-layout` (word boxes, pt) | `Range.getClientRects()` (word boxes, px) |

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
as one `pageShift` naming the line it starts at instead of a wall of noise.

Where no resync is in reach it steps both sides by one and keeps comparing. A contents
block whose numbers are all off by one has no two consecutive matching rows anywhere in
it, and declaring the documents parted there hid 465 of the 458-page guide's pages
behind a single report. Contiguous divergent lines are merged into one report carrying
how many lines each side spent, so the region still reads as one difference.

Reported differences are `pageCount`, `pageShift` (from here on the editor runs ±n pages
off), `lineCount`, `lineBreak` (same place, different words) and `position` / `lineEnd`
(same words, off by more than `POS_TOL_MM`). Consecutive lines off by the *same* amount
are one report with a `×n` count, since that is one cause — a strut, a spacing, a band
height — and not n of them. Counts recorded before 2026-09-03 came from the index-wise
comparison, which stopped at the first divergence per page: they are not comparable to
what a run prints now.

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

Where the LibreOffice build ships those families itself (the macOS app bundle does:
`Contents/Resources/fonts/truetype/`), it resolves them without fontconfig and the step
is only about what it does *not* ship — `fc-list` showing neither Liberation nor Carlito
is then not a reason to distrust a run.

**But install only what LibreOffice does not already ship.** A second copy of a
family it bundles makes its render *non-deterministic*: it picks between the two
files per run — measured as `Carlito` against `Carlito-Regular` in the PDF's font
list — and their vertical metrics differ, so a page carrying a large-font heading
lands 1.85mm lower on some runs and a fixture's issue count swings by 40. The
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
that corpus *and* `fixtures/`, which stays gitignored — keep whatever real-world
files you test against there and local.

## Names stay local

A real-world document's name goes in no file, and a commit message names no document at
all — write the rule that changed and what it measured. `FINDINGS.md` is gitignored for
that reason.

Only this harness reads `fixtures/`. The directory is gitignored, so a `tests/unit/` test
reading it fails with `ENOENT` on a fresh clone; it zips its own document instead
(`docx-onoff.test.ts` — both importers take a `Uint8Array`, not a path), or reads
`tests/corpus/`, which is committed. CI greps for the read.

## Probing with a purpose-built document

The fastest probe is an `.odt` of your own run through the harness: both engines lay the
same file out and the report *is* the measurement, in the units the corpus uses. Build it
with `fflate` (`zipSync`), keep it in the scratchpad, and mind two traps — `mimetype` has
to be stored uncompressed (`{ level: 0 }`) or LibreOffice produces no PDF at all, and a
`style:font-name` with **no `<style:font-face>` declaration** is not resolved: LibreOffice
falls back (Calibri → Liberation Sans) where the editor honours the name, which invents a
line-height difference that is not there in any real document.

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

## What a `lineBreak` run usually is

Both word processors **shrink** the spaces of a justified line to pull one more word
onto it; CSS `text-align: justify` only stretches. Probed on one paragraph: justified,
LibreOffice keeps a word the browser drops, and the same paragraph left-aligned breaks
in both engines at the same word. So a long justified document reports a `lineBreak`
every dozen pages with no defect behind it — the browser simply fits marginally less
per line, worth about a quarter page over fifty. Left-align a passage before believing
a break difference is ours.

## What the harness cannot see

`extractLayout` walks **text nodes**, so anything drawn by CSS is invisible to it: a
list marker and a chapter number both ride `hN::before`, and a numbered heading is
therefore always reported as if it carried no number. Check those against the contents
rows instead, which hold the same label as real text, or against a screenshot
(`docs/headless-testing.md`). A `text-transform` is the case the harness *does* handle
— it reads the case the style paints, not the node's.
