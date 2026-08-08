# Headless browser testing

With no test suite, the way to verify rendering, layout, or interaction is to drive the live app in a headless browser. **This container is linux arm64 (`uname -m` → `aarch64`)** — the one gotcha. Use it for any check: pagination, list-marker/float layout, table sizing, header/footer, theme colors, image drag/resize, ODF round-trips, etc. PDF export is just one example.

- **Don't** use `puppeteer` / `npx @puppeteer/browsers install chrome-headless-shell`: they fetch an x86-64 Chrome that can't run here (`rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2`). No arm64 chrome-headless-shell build exists.
- **Use Playwright's Chromium** (native arm64): `npm install --no-save playwright-core && npx playwright-core install chromium` → binary at `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`. Playwright's `install-deps` host check errors out, but the libs install via apt: `apt-get install -y libdbus-1-3 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libatspi2.0-0 libpango-1.0-0 libcairo2`. Launch with playwright-core, `executablePath` at that binary, `args: ['--no-sandbox']`.

Then load `npm run dev`, inject a document into `localStorage['odf-editor-doc']`, reload, and read live DOM geometry (`getBoundingClientRect`, `Range.getClientRects`) or screenshot. This is the only way to exercise the editor's live ProseMirror NodeViews (e.g. the image node), which `generateHTML` can't reproduce. The `debug/pagebreak-debug-*.json` snapshots carry the live `doc` JSON, handy to inject.

For PDF-export repros specifically: replicate `pdf.ts`'s clone + `html2canvas(...)` inside `page.evaluate` and read the canvas back as a PNG — capturing the real jsPDF `doc.save()` download tends to hang in headless. Inspect output PDFs with poppler-utils (`apt-get install -y poppler-utils`: `pdftoppm`, `pdfimages`, `pdftotext`).
