# CLAUDE.md

Serverless, fully client-side rich-text editor that saves `.odt` (and `.docx`). No backend; all
state lives in the browser (localStorage).

**Stack:** Svelte 5 (runes) + TypeScript + Vite. Editor engine TipTap 3 (ProseMirror). ODF export
via `odf-kit` + `fflate` for re-zipping during post-processing.

## Commands

```bash
npm run dev      # dev server (Vite, hot-reload, --host)
npm run build    # production build → dist/
npm run preview  # serve the dist/ build locally
npm run check    # svelte-check type-check (svelte + ts)
npm test         # Vitest suite once (tests/**/*.test.ts)
npm run test:watch   # Vitest in watch mode
npm run test:lo      # LibreOffice round-trip leg only (needs `soffice` on PATH)
npm run test:parity  # render parity vs LibreOffice (tests/render-parity/README.md)
```

Tests live in `tests/` (outside `src/`, so `svelte-check` ignores them), jsdom via Vitest.
`roundtrip.test.ts` covers the ODF export↔import round trip + a foreign-doc/style-resolver leg;
`lo-roundtrip.test.ts` re-saves through LibreOffice and **self-skips** without `soffice`, so
`npm test`/CI stay green; `tests/unit/` holds fast helper tests. All test tooling stays a
`devDependency`. No linter/formatter. CI (`.github/workflows/ci.yml`) runs `check` + `test`.

## Rules

**Comments** — keep them precise and short:

- **Never longer than three lines.** No exceptions — file-header comments, tests and config included. A comment that needs a fourth line is explaining what the code already says; cut it back to what the code can't say.
- **Never describe how the current code differs from an older version** (no "previously…", "this used to…", "changed from…"). Comment only what the current code does and why — git history covers the rest.
- **Don't use Word as a placeholder for "a word processor".** Where LibreOffice does the same thing, describe the behaviour itself ("the caret moves", "the zone auto-grows") instead of "Word-style" / "like Word" / "as in Word". Name a product only where the statement really is about that product: its file format (`w:tblLook`, DOCX), or a quirk only it has — then name both if both apply.

**Commit messages** — a clear description, never an essay: a subject line plus **at most ~8
lines**, however large the change. Probed behaviour, measurements and rationale lists belong
in `docs/architecture/` or the nearest `CLAUDE.md`, not repeated in the history.

**IMPORTANT: no real-world document's name anywhere in the repo, and a commit message
names no document at all** — not even "the thesis": describe the fix and its measurement,
never the file it helped. Detail in `tests/render-parity/README.md`.

**IMPORTANT: never introduce a default only this editor has.** Both importers suppress values equal
to the defaults, so an editor-only default is indistinguishable from a failed style resolution and
silently lands in every imported document as direct formatting. The defaults follow **LibreOffice**
(we save `.odt`, so LO wins the ties against Word's Calibri 11pt / 8pt after / 2.54cm):

- Paragraph spacing **0** — no `margin-top`/`-bottom` on `p`, `ul`/`ol` or the table wrapper. Blank lines come from the document's own empty paragraphs.
- Body **Liberation Serif 12pt**, single line spacing; page margins **2cm**; tab/indent step **1.25cm**.
- Headings sans (`HEADING_FONT` = Arial, bundled `@font-face` maps it to metric-identical Liberation Sans), sizes/margins in `HEADING_STYLE_OVERRIDES` (`export/odt.ts` — see `src/lib/export/CLAUDE.md`).
- Liberation Serif TTFs are bundled (`src/assets/fonts/`) and metric-identical to Times New Roman, so editor, LibreOffice and Word share the same metrics. `utils/fontDetect.ts` filters `CANDIDATE_FONTS` to what's installed for the font picker.

**IMPORTANT: keep the layout constants in sync** between `editor/extensions/pageBreaks.ts`,
`components/Editor.svelte` and `styles/editor.css` (`PAGE_HEIGHT` 1123px, `PAGE_GAP` 20px, the
`--user-page-*`/`--user-margin-*` custom properties) — details in `docs/architecture/pagination.md`.

**Headless browser testing** — this container is linux **arm64**. Never `puppeteer` /
`@puppeteer/browsers`: they fetch an x86-64 Chrome that cannot run here. Use `playwright-core` +
its Chromium; full recipe in `docs/headless-testing.md`. Driving the live app is the only way to
verify rendering, layout or NodeView behaviour — there is no DOM test suite for it.

**Naming** — components `PascalCase.svelte`, every `.ts` module `camelCase`; extension files are
named by feature (`image.ts`, `indent.ts`), not `XyzExtension.ts`.

**Documenting a change** — a feature that changes how this codebase behaves gets documented where
it loads on demand, not here. **This file** only grows for a new command, a new hard rule, or a new
top-level directory; everything else is one line in the nearest directory `CLAUDE.md`, or a section
in its `docs/architecture/` file. Write only what the code can't say — probed Word/LibreOffice
behaviour, sentinel order, constants that must agree across files. Keep this file under 120 lines:
a section growing past ~5 lines belongs somewhere else.

## Source layout

```
src/
  App.svelte                – app shell + app-level state
  lib/
    components/             – all Svelte UI (toolbars, pickers, dialogs, Editor, HeaderFooterLayer)
    editor/
      extensions.ts         – the TipTap extension registry
      extensions/           – the custom TipTap/ProseMirror extensions, one file per feature
    utils/                  – framework-free helpers (fontDetect, specialChars, wordCount,
                              orderedListTypes, historyLog, colorDebug)
    math/                   – formula AST: LaTeX parser/serializer, MathML, OMML
    export/ import/ spell/ storage/ styles/  – ODF+DOCX I/O, spell-check, persistence, named styles
  styles/                   – global.css + editor.css
```

## Where the detail lives

Directory-level `CLAUDE.md` files load automatically when you touch that directory; the
`docs/` files are read on demand.

| Topic | File |
|---|---|
| Components, data flow, zoom, header/footer layer, debug dump | `src/lib/components/CLAUDE.md` |
| Extension registry index, shortcuts, context menu | `src/lib/editor/CLAUDE.md`, `src/lib/editor/extensions/CLAUDE.md` |
| ODF/DOCX export, post-processing passes, sentinels | `src/lib/export/CLAUDE.md` |
| ODF/DOCX import, style resolver, image formats | `src/lib/import/CLAUDE.md` |
| Paragraph + character styles, style manager | `src/lib/styles/CLAUDE.md` |
| localStorage keys, page margins/orientation, themes | `src/lib/storage/CLAUDE.md` |
| Pagination, widow/orphan, columns flow | `docs/architecture/pagination.md` |
| Images, text boxes, wrap modes | `docs/architecture/frames.md` |
| Table extensions + table styles | `docs/architecture/tables.md` |
| Text effects, indents, tab stops, list markers, date fields | `docs/architecture/formatting.md` |
| Formulas (LaTeX model, MathML, OMML, the math font) | `docs/architecture/formulas.md` |
| Headless browser + PDF-export debugging | `docs/headless-testing.md` |
