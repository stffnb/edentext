# Two reverted layout rules, to be redone

Both rules match LibreOffice in isolation and pass the committed corpus, but each moved a private document away
from LibreOffice. They are out of the tree until refined. Delete this file once both are back.

## How to work on them

- The private documents live outside the repository; `tests/localDocs.mjs` finds them and `LAYOUT_LOCAL=core|all`
  selects the tier. Copy the folder to the machine that investigates; nothing in it may be changed.
- Restore a rule with `git revert <revert commit>` and run `npm run test:layout -- <regex>` on the document.
- A fix has to hold the general rule: probe the shape in LibreOffice (for DOCX, Word is the reference where
  LibreOffice differs) and add a small synthetic fixture; never fit the one document.
- No real-world document name goes into the repository or a commit message.

## 1. Lines in the room above or between band frames

- Commit `48abdfd8`, reverted by `c3897257`. Its browser-test expectation `90f6c096` is reverted by `5b318f72`,
  and the fixture `tests/corpus/30-band-gap.odt` with its baseline entry went with the revert.
- Rule: a block whose frames are all full-width no-wrap bands does not clear them. A sunk band takes its gap as
  `shape-outside: inset(...)` (`data-wrap-band="open"`), so a line goes where its height fits; its space below may
  overlap the band. Probed in LibreOffice on ODT.
- Regression: the 48-page DOCX of the core local set became 49 pages (LibreOffice 48).
- Not found: which band lets a line in that the reference keeps out. Suspects, unverified: DOCX top-and-bottom
  frames whose anchor paragraph is empty, and the space below a line, which the rule lets overlap the band.

## 2. ODT shape text padding from named sides, a box ends at its last line

- Commit `866e20ce`, reverted by `30dbd8f6`.
- Rule: a shape takes padding as a frame does: none where its styles name none, and a side's own `fo:padding-*`
  beats a shorthand inherited from a common style. The export writes each side. A box's last block adds no space
  below. Measured on a caption shape 44px tall where LibreOffice's ends at its 20px line.
- Regression: in the 63-page ODT formula guide of the long local tier, page 24 starts one block earlier than the
  recorded page start (63 pages before and after). A bisect names this commit as the first bad one.
- The revert alone does not bring page 24 back: the bundled fonts' line gap below the baseline (`97e19f84`,
  kept) moves the same page start. Measured on the reverted tree: still off with the three page-split fixes taken
  out, right once `97e19f84` is taken out as well.
- Not found: which box the padding rule makes shorter on pages 1-23, and which lines the font rule makes taller or
  shorter there. The recorded page start is the editor's own earlier state, so compare page 23/24 against
  LibreOffice first to see which of the two starts is the right one before changing either rule.

## What the reverts cost

The caption-shape height and the band-gap page starts are off again in the document that motivated both rules,
a long ODT manual (645 pages against LibreOffice's 632).

## Other open items from the same session (page splits)

- A text box as character at a page split: in one of 16 positions the line still reaches 0.7px into the footer
  zone. `topWithin` adds up rounded `offsetTop` values, so the pass places the paragraph about 1.35px higher than
  it renders; this is not specific to boxes.
- An inline fraction: in one layout a denominator glyph sits 3.6-5px past the footer zone top. Not decided whether
  the line box overflows or only the ink.
- Page splits in documents with a header were not probed.
- `tests/corpus/32-box-split.odt` has 5 pages in LibreOffice and 4 in the editor; not looked into.

## Not layout: a browser test that depends on real time

`npm run test:dom` in Chromium feeds a fake microphone a recording of three voiced bursts, played once in real
time, and expects three phrases at the speech server. On a busy machine it failed twice with one or two phrases
and passed on the next run of the same tree (load average about 2 to 3.5); the dictation code was unchanged.
Not decided whether the recording starts before the session listens or the pause detector drops a burst under
load; a real fault in the pause detector is not ruled out.
