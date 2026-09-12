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

EdenText is a web-based, powerful word processor for everything from quick notes to full-length books. No server, no account — processing runs locally and your documents never leave your computer. Just one URL away, or completely offline as a slim browser app — under 2 MB on first load[^1]. The interface comes in English and German.

> [!NOTE]
> EdenText is young, in **beta** and actively developed — more features are on
> the way. It is tested — the full suite plus LibreOffice round-trip checks run
> on every commit — but expect occasional bugs, and keep backups of documents
> you care about. The browser copy also keeps the last three versions of the open
> document, and offers them if it ever fails to load one. What is still missing is
> listed under [Not yet implemented](CHANGELOG.md#not-yet-implemented) and
> [Known limitations](CHANGELOG.md#known-limitations).

<a href="https://edentext.app"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/showcase/thesis-dark.png">
  <img src="docs/showcase/thesis.png" alt="EdenText editing a thesis: numbered chapters, formulas and a running header">
</picture></a>

## Features

- **Real page layout** — A4/Letter pages, margins, headers & footers, footnotes,
  columns, page and line numbering, watermarks; mirrored margins and chapters
  opening on a right-hand page for books
- **Opens and saves `.odt` and `.docx`**, exports PDF; templates (`.ott`/`.dotx`)
  and a letter gallery (DIN 5008); password-protected files in both formats
- **Plays well with Word and LibreOffice** — documents keep their layout across
  all three, backed by a sophisticated test pipeline
- **Styles** — paragraph, character, table and list styles with inheritance,
  chapter numbering
- **Tables** with styles, sorting and spreadsheet-style formulas
- **Everything a thesis needs** — table of contents, captions, cross-references,
  citations & bibliography, alphabetical index, formulas (LaTeX)
- **Review tools** — track changes and threaded comments with margin balloons,
  printable markup, spell check (English & German), grammar check (English),
  synonyms
- **Private by design** — your documents never leave your computer, all
  processing runs locally; works offline as an installable app. The site counts
  anonymous visits (GoatCounter, EU-hosted, no cookies); the editor sends nothing
- **Any current browser** — in Chrome and Edge, Save writes back to the opened
  file; other browsers receive each save as a download, so turn on "Always ask
  where to save" in their settings to pick the location

## Gallery

The documents behind these pictures are in [`docs/showcase/`](docs/showcase/) as `.odt`
and `.docx`, ready to open in EdenText, LibreOffice or Word. They are built by
`scripts/showcase/run.mjs`; the photographs are NASA's and the book is Lewis Carroll's,
both public domain.

| | |
|---|---|
| [![Tracked changes and comments](docs/showcase/thesis-review.png)](docs/showcase/thesis-review.png) **Review** — tracked changes, threaded comments in the margin, a draft watermark | [![A book on facing pages](docs/showcase/book-spread.png)](docs/showcase/book-spread.png) **Book** — A5, mirrored margins, chapters opening on a right-hand page, running heads; the numbering restarts after the front matter, so page 11 prints the folio 9 |
| [![A newsletter in two columns](docs/showcase/newsletter.png)](docs/showcase/newsletter.png) **Newsletter** — columns, pictures with captions, a sidebar box | [![Tables with formulas](docs/showcase/newsletter-tables.png)](docs/showcase/newsletter-tables.png) **Tables** — table styles and spreadsheet-style formulas |

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

- Patrick R. — alpha and beta tester
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

[^1]: Over the wire, compressed: ~0.4 MB of app code, the rest the bundled fonts a
    page shows and the spell checker with its dictionary. Further fonts, the second
    dictionary and the thesaurus load on demand; the complete offline install is ~25 MB,
    or ~33 MB with the English grammar check switched on.
