# CLAUDE.md

Serverless, fully client-side rich-text editor that saves `.odt` and `.docx`; state lives in browser localStorage.
**Stack:** Svelte 5 (runes), TypeScript, Vite, TipTap 3 (ProseMirror), `odf-kit` and `fflate` for ODF export.

## Commands

```bash
npm run dev      # Vite dev server (hot-reload, --host)
npm run build    # production build -> dist/; npm run preview serves it
npm run check    # svelte-check type-check
npm test         # Vitest once (tests/**/*.test.ts)
npm run test:lo      # LibreOffice round trip, fuzz re-read, ODT/DOCX consistency (needs soffice)
npm run test:smoke   # headless dist boot; BROWSER=firefox|webkit
npm run test:dom     # browser pagination and editing; same BROWSER
npm run test:layout  # LibreOffice page counts, layout invariants and page starts
npm run test:monkey  # random editing, undo/redo and save-read invariants
npm run test:tabs    # two documents across reloads
npm run test:coverage  # Vitest V8 coverage -> coverage/index.html
npm run test:parity  # render parity; see tests/render-parity/README.md
node scripts/make-thesaurus.mjs; node scripts/make-shape-presets.mjs; node scripts/collect-licenses.mjs  # re-vendor thesaurus, shape presets, licenses
node scripts/showcase/run.mjs  # rebuild docs/showcase/; optional [regex] limits it
```

Tests are jsdom Vitest files outside `src/`; `npm test` covers round trips, corpus/fuzz exports, schemas and unit helpers. Browser legs share `tests/browser.mjs`; test tooling stays a `devDependency`, and CI runs `check` plus `test`.

## Rules

**Workflow**

- Read the existing code and relevant local `CLAUDE.md` before changing files.
- Follow the established architecture, naming and surrounding code style.
- Prefer the smallest correct change; do not rewrite unrelated code or add dependencies without need.
- Fix root causes rather than symptoms: when a document renders, imports or exports wrongly, fix the general rule it exposes so any document is handled correctly, never that one document's shape at the risk of others. Then look for related bugs: the same rule in the other format, direction (import/export) or per-section/per-page variant.
- Preserve persisted or externally consumed behaviour; add compatibility code only for a concrete need.
- Run the test legs that the final change can affect.
- Do not push unless requested.

**Comments**

- Never exceed three lines or describe/compare to an older implementation; explain only current behaviour and why.
- Do not use Word as a placeholder for a word processor; name products only for a format or product-specific quirk.

**Commit messages** — subject plus at most about eight lines. Include a short, precise bullet-point body that describes the change; put probes, measurements and rationale in architecture docs or the nearest `CLAUDE.md`.

**Document names** — never put a real-world document name in the repository or a commit message; describe the fix and measurement instead. See `tests/render-parity/README.md`.

**Defaults** — never introduce one only this editor has: importers suppress default values, so it would become direct formatting. Follow LibreOffice defaults:

- Paragraph spacing **0**; blank lines come from empty document paragraphs.
- Body **Liberation Serif 12pt**, single spacing, **2cm** margins and **1.25cm** tab/indent step.
- Headings use Arial/Liberation Sans and `HEADING_STYLE_OVERRIDES` in `styles/headings.ts`; see `docs/architecture/export.md`.
- Bundled Liberation Serif matches Times New Roman metrics; `utils/fontDetect.ts` filters picker fonts by installation.

**Layout constants** — keep `pageBreaks.ts`, `Editor.svelte` and `editor.css` aligned (`PAGE_HEIGHT` 1123px, `PAGE_GAP` 20px and `--user-page-*`/`--user-margin-*`); see `docs/architecture/pagination.md`.

**Browser testing** — use `playwright-core`, never `puppeteer`; see `docs/headless-testing.md`. Only the live app verifies rendering and NodeViews. **Test selection** — run each relevant leg once after its input is final: unit/Vitest for logic, LibreOffice for I/O, browser legs for rendering, parity for layout. **Unit tests** — keep Vitest tests few and generic: test behaviour through public entry points (round trip, export/import result, command outcome), not internal helpers, call order or exact XML/DOM strings. Assert the invariant a change must keep, so refactors and extensions do not break the test; extend an existing test or table-driven case before adding a file, and never add one that only pins a single bug's document shape.

**Naming** — components are `PascalCase.svelte`; `.ts` modules are `camelCase`; extensions are feature names such as `image.ts`.

**Documentation** — document behavioural features where they load: one line in the nearest directory `CLAUDE.md` or a section in `docs/architecture/`. This file only gains commands, hard rules and top-level directories. A `README.md` change goes into every `docs/readme/README.<lang>.md` in the same commit.

## Source layout

```
src/
  App.svelte                - app shell and app-level state
  lib/components/           - UI, including ribbon/
  lib/editor/               - registry and extensions/
  lib/{utils,math}/         - framework-free helpers and formula AST
  lib/{export,import,i18n,spell,storage,styles,crypto,templates}/ - I/O, localization, persistence, styles, protection, templates
  lib/ai/                   - AI assistant client, document serialization and tools
  styles/                   - global and editor CSS
charts/edentext/            - community-maintained Helm chart; test with bash scripts/test-helm-chart.sh
desktop/                    - Electron shell around dist/ with its own npm commands; see desktop/CLAUDE.md
```

## Where the detail lives

Read directory-level `CLAUDE.md` files when touching that directory; read architecture docs on demand.

| Topic | File |
|---|---|
| Components, data flow, zoom, header/footer, debug dump | `src/lib/components/CLAUDE.md`, `docs/architecture/components.md` |
| Extensions, shortcuts, context menu, recorded changes | `src/lib/editor/CLAUDE.md`, `src/lib/editor/extensions/CLAUDE.md`, `docs/architecture/review.md` |
| ODF/DOCX export and sentinels | `src/lib/export/CLAUDE.md`, `docs/architecture/export.md` |
| ODF/DOCX import and images | `src/lib/import/CLAUDE.md`, `docs/architecture/import.md` |
| Styles | `src/lib/styles/CLAUDE.md`, `docs/architecture/styles.md` |
| localStorage, margins, themes | `src/lib/storage/CLAUDE.md` |
| UI languages and catalogs | `src/lib/i18n/CLAUDE.md` |
| Ribbon, floating island | `docs/architecture/ribbon.md`, `docs/architecture/island.md` |
| AI assistant, kill switch, tracked tool edits | `docs/architecture/ai.md` |
| Pagination, columns | `docs/architecture/pagination.md` |
| Images, text boxes, wrap | `docs/architecture/frames.md` |
| Tables and table styles | `docs/architecture/tables.md` |
| Formatting | `docs/architecture/formatting.md` |
| Formulas | `docs/architecture/formulas.md` |
| Footnotes and endnotes | `docs/architecture/notes.md` |
| Password protection | `docs/architecture/encryption.md` |
| Headless testing | `docs/headless-testing.md` |
