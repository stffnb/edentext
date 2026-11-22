# A reverted layout rule, to be redone

The rule matches LibreOffice in isolation and passes the committed corpus, but moved a private document away
from LibreOffice. It is out of the tree until refined. Delete this file once it is back.

## How to work on it

- The private documents live outside the repository; `tests/localDocs.mjs` finds them and `LAYOUT_LOCAL=core|all`
  selects the tier. Copy the folder to the machine that investigates; nothing in it may be changed.
- Restore a rule with `git revert <revert commit>` and run `npm run test:layout -- <regex>` on the document.
- A fix has to hold the general rule: probe the shape in LibreOffice (for DOCX, Word is the reference where
  LibreOffice differs) and add a small synthetic fixture; never fit the one document.
- No real-world document name goes into the repository or a commit message.

## ODT shape text padding from named sides, a box ends at its last line

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

## What the revert costs

The caption-shape height is off again in the document that motivated the rule, a long ODT manual (645 pages
against LibreOffice's 632 with the band rule also out; not re-measured since it is back).

## Other open items from the same session (page splits)

- A text box as character at a page split: in one of 16 positions the line still reaches 0.7px into the footer
  zone. `topWithin` adds up rounded `offsetTop` values, so the pass places the paragraph about 1.35px higher than
  it renders; this is not specific to boxes.
- An inline fraction: in one layout a denominator glyph sits 3.6-5px past the footer zone top. Not decided whether
  the line box overflows or only the ink.
- Page splits in documents with a header were not probed.
- `tests/corpus/32-box-split.odt` has 5 pages in LibreOffice and 4 in the editor; not looked into.
- `tests/corpus/33-band-keep.odt`: the editor fits one line more than LibreOffice under the captioned band on page
  1 (page 2 starts at "After line 6.", LibreOffice "After line 5."); dev showed the same with a three-line caption.

## Not layout: a browser test that depends on real time

`npm run test:dom` in Chromium feeds a fake microphone a recording of three voiced bursts, played once in real
time, and expects three phrases at the speech server. On a busy machine it failed twice with one or two phrases
and passed on the next run of the same tree (load average about 2 to 3.5); the dictation code was unchanged.
Not decided whether the recording starts before the session listens or the pause detector drops a burst under
load; a real fault in the pause detector is not ruled out.
