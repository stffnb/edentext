# Open layout items

Items found while redoing two reverted layout rules (band-gap lines, ODT box padding), both back in the tree.
Delete an item once it is fixed, and this file once it is empty.

## How to work on them

- The private documents live outside the repository; `tests/localDocs.mjs` finds them and `LAYOUT_LOCAL=core|all`
  selects the tier. Copy the folder to the machine that investigates; nothing in it may be changed.
- A fix has to hold the general rule: probe the shape in LibreOffice (for DOCX, Word is the reference where
  LibreOffice differs) and add a small synthetic fixture; never fit the one document.
- No real-world document name goes into the repository or a commit message.

## Fonts the machine lacks

- A missing **complex-script** face (a Hebrew ODT naming fonts the test machine lacks) falls back to the Hebrew of
  the generic tail here, while LibreOffice takes fontconfig's best face for the script (Noto Sans Hebrew), which
  sets fewer lines: editor 2 pages, LibreOffice 3. Not probed against a machine that has the faces, nor whether the
  tail should prefer a script face. A small Chinese DOCX shows the same with CJK faces, and there Word's own PDF
  agrees with the editor (2 pages, LibreOffice 3).

## Not layout: a browser test that depends on real time

`npm run test:dom` in Chromium feeds a fake microphone a recording of three voiced bursts, played once in real
time, and expects three phrases at the speech server. On a busy machine it failed twice with one or two phrases
and passed on the next run of the same tree (load average about 2 to 3.5); the dictation code was unchanged.
Not decided whether the recording starts before the session listens or the pause detector drops a burst under
load; a real fault in the pause detector is not ruled out.
