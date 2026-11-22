# Open layout items

Items found while redoing two reverted layout rules (band-gap lines, ODT box padding), both back in the tree.
Delete an item once it is fixed, and this file once it is empty.

## How to work on them

- The private documents live outside the repository; `tests/localDocs.mjs` finds them and `LAYOUT_LOCAL=core|all`
  selects the tier. Copy the folder to the machine that investigates; nothing in it may be changed.
- A fix has to hold the general rule: probe the shape in LibreOffice (for DOCX, Word is the reference where
  LibreOffice differs) and add a small synthetic fixture; never fit the one document.
- No real-world document name goes into the repository or a commit message.

## Page splits

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
