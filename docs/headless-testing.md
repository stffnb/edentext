# Headless browser testing

With no test suite, the way to verify rendering, layout, or interaction is to drive the live app in a headless browser. **This container is linux arm64 (`uname -m` → `aarch64`)** — the one gotcha. Use it for any check: pagination, list-marker/float layout, table sizing, header/footer, theme colors, image drag/resize, ODF round-trips, etc. PDF export is just one example.

- **Don't** use `puppeteer` / `npx @puppeteer/browsers install chrome-headless-shell`: they fetch an x86-64 Chrome that can't run here (`rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2`). No arm64 chrome-headless-shell build exists.
- **Use Playwright's Chromium** (native arm64): `npm install --no-save playwright-core && npx playwright-core install chromium` → binary at `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`. Playwright's `install-deps` host check errors out, but the libs install via apt: `apt-get install -y libdbus-1-3 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libatspi2.0-0 libpango-1.0-0 libcairo2`. Launch with playwright-core, `executablePath` at that binary, `args: ['--no-sandbox']`.

Then load `npm run dev`, inject a document into `localStorage['edentext-doc']`, reload, and read live DOM geometry (`getBoundingClientRect`, `Range.getClientRects`) or screenshot. This is the only way to exercise the editor's live ProseMirror NodeViews (e.g. the image node), which `generateHTML` can't reproduce. The `debug/pagebreak-debug-*.json` snapshots carry the live `doc` JSON, handy to inject.

For PDF-export repros specifically: replicate `pdf.ts`'s clone + `html2canvas(...)` inside `page.evaluate` and read the canvas back as a PNG — capturing the real jsPDF `doc.save()` download tends to hang in headless. Inspect output PDFs with poppler-utils (`apt-get install -y poppler-utils`: `pdftoppm`, `pdfimages`, `pdftotext`).

## Hunting for bugs the suite cannot see

`npm run test:coverage` says where to look: the logic modules are dense with tests,
`src/lib/components/**` and `App.svelte` are at **0%** — every bug found this way so far
lived there. Give each probe a `pageerror` + `console.error` collector; that alone reports
faults nobody predicted (two of six were found by clicking controls and reading the console).

Four passes, cheapest first:

1. **Edges** — junk in every `edentext-*` key, truncated/renamed/empty archives, a full localStorage, no IndexedDB, page-tall images, 400-section documents.
2. **Breadth** — click every control of every tab, watch only for uncaught errors.
3. **Semantics** — not "does it crash" but "is the answer right": reject a tracked change and compare against the original, TOC page numbers against the measured page of each heading, a numeric sort against 3/10/25. The worst bug found (a reject that ate the original text) crashes nothing.
4. **Invariants** — snapshot → act → undo → compare; page count stable over reloads; save → reopen; `.docx` and `.odt` of one corpus fixture giving identical counts.

Then repro minimally and take a stack trace off the **dev** server (sourcemaps) with
`Error.stackTraceLimit = 300` — the default ten frames stop above the cause.

**Budget for false alarms.** Three of four striking signals were the probe's own fault:
`Range.getClientRects` also returns container rects (a layout checker built on it is noise),
a stale button index reads as a dead control, and clicking `.tiptap > p` by index hits a
different block once an edit has reflowed the document. Reproduce deterministically before
touching any code.
