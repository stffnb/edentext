<p align="center">
  <img src="public/favicon.svg" width="80" alt="">
</p>

<h1 align="center">
  <img src="public/EdenText.png" height="40" alt="EdenText">
</h1>

<p align="center">
  <strong>Powerful word processor — just one URL away.</strong><br>
  Free · Open Source · Private by Design
</p>

<p align="center">
  <a href="https://github.com/stffnb/edentext/actions/workflows/ci.yml"><img src="https://github.com/stffnb/edentext/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License: AGPL-3.0"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/github/package-json/v/stffnb/edentext" alt="Version"></a>
  <img src="https://img.shields.io/badge/status-beta-orange" alt="Status: beta">
</p>

<p align="center">
  <a href="https://edentext.app"><strong>▶ Open EdenText</strong></a>
</p>

---

EdenText is a web-based, powerful word processor for everything from quick notes to full-length books. No server, no account — processing runs locally and your documents never leave your computer. Just one URL away, or completely offline as a slim browser app — only ~1 MB[^1].

> [!NOTE]
> EdenText is young, in **beta** and actively developed — more features are on
> the way. It is tested — the full suite plus LibreOffice round-trip checks run
> on every commit — but expect occasional bugs, and keep backups of documents
> you care about.

## Features

- **Real page layout** — A4/Letter pages, margins, headers & footers, footnotes,
  columns, page numbering, watermarks, ...
- **Opens and saves `.odt` and `.docx`**, exports PDF; templates (`.ott`/`.dotx`)
- **Styles** — paragraph, character and table styles with inheritance
- **Tables** with styles, sorting and spreadsheet-style formulas
- **Everything a thesis needs** — table of contents, captions, cross-references,
  citations & bibliography, alphabetical index, formulas (LaTeX)
- **Review tools** — track changes, comments, spell check (English & German),
  synonyms
- **Private by design** — your documents never leave your computer, all
  processing runs locally; works offline as an installable app

## Development

```bash
npm install
npm run dev      # dev server with hot-reload
npm test         # test suite
npm run build    # production build → dist/
```

Built with Svelte 5, TypeScript, Vite and TipTap 3 (ProseMirror).

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Merging
requires a signed [CLA](CLA.md), checked automatically on every pull request.

### Contributors

Thanks to everyone who helped — with ideas, bug reports, testing
and feedback:

- Patrick R. — alpha tester
- [@Deleh](https://github.com/Deleh) — beta tester

<!-- Add a line per person: name or [@handle](https://github.com/handle), then
     " — " and what they contributed. -->


## License

Copyright © 2026 Steffen Becker.

[AGPL-3.0](LICENSE). A [commercial license](LICENSE.commercial.md) is available
for use cases the AGPL does not fit. Bundled fonts and language data keep their
own licenses — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

*EdenText is an independent project, not affiliated with Microsoft or The
Document Foundation. `.docx` and `.odt` are supported for interoperability.*

[^1]: First load, compressed. Further fonts, spell-check dictionaries and the
    thesaurus load on demand; the complete offline install is ~25 MB.
