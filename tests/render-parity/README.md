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

## Names stay local

A real-world document's name goes in no file, and a commit message names no document at
all — write the rule that changed and what it measured. `FINDINGS.md` is gitignored for
that reason.

Only this harness reads `fixtures/`. The directory is gitignored, so a `tests/unit/` test
reading it fails with `ENOENT` on a fresh clone; it zips its own document instead
(`docx-onoff.test.ts` — both importers take a `Uint8Array`, not a path). CI greps for the
read.

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

