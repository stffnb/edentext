# Third-Party Notices

EdenText as a whole is licensed under the GNU Affero General Public License
v3.0 (see [`LICENSE`](./LICENSE)), with a separate commercial license available
(see [`LICENSE.commercial.md`](./LICENSE.commercial.md)).

It bundles and depends on third-party components that remain under **their own**
licenses, listed below. The code dependencies and the fonts are permissive and
compatible with both the AGPL distribution and a commercial distribution of this
project; the bundled **language data** is a separate question — some of it is
copyleft, see its section.

## Bundled fonts — retain their own license

The fonts in `src/assets/fonts/` are **not** covered by this project's license and
remain under their own regardless of how this project is licensed. Their license
texts live in [`public/font-licenses/`](./public/font-licenses/) — that folder is
copied verbatim into the build, so the licenses ship wherever the fonts do.

| Font | License | Copyright |
|------|---------|-----------|
| Liberation Mono/Sans/Serif | OFL-1.1 | (c) 2010 Google Corporation; (c) 2012 Red Hat, Inc. (Reserved Font Name "Liberation") |
| Carlito | OFL-1.1 | (c) 2013 The Carlito Project Authors (Reserved Font Name "Carlito") |
| Caladea | OFL-1.1 | (c) 2012 The Caladea Project Authors |
| STIX Two Math | OFL-1.1 | (c) 2001–2021 The STIX Fonts Project Authors |
| `EdenSymbols.woff2` — bullet glyphs subset from DejaVu Sans | Bitstream Vera | (c) 2003 Bitstream, Inc. |

> OFL-1.1 permits bundling the fonts in any software, **including commercial and
> proprietary software**, provided the license file is retained and the fonts are
> not sold by themselves. The fonts must not be redistributed under their Reserved
> Font Names if modified. The Bitstream Vera license likewise permits bundling and
> requires the notice to travel with the font; the subset is renamed accordingly,
> as that license requires of a derivative.

## Bundled language data — retains its own license

Vendored under `public/`, each with its upstream license file beside it. None of
it is part of this project's code: a distribution that cannot carry a copyleft
data set may drop that folder, and the app then simply offers no dictionary or
thesaurus for the language.

| Data | License |
|------|---------|
| `public/dictionaries/de` — Hunspell, igerman98 | GPL-2.0 or GPL-3.0 |
| `public/dictionaries/en` — Hunspell, from SCOWL | permissive (BSD-style) |
| `public/thesaurus/de` — OpenThesaurus | LGPL-2.1-or-later |
| `public/thesaurus/en` — WordNet 2.1, Princeton University | WordNet license (permissive) |

Both thesaurus files are generated from LibreOffice's own MyThes data by
`scripts/make-thesaurus.mjs`, which also fetches the license files above.

## Runtime / build dependencies

| Component | License |
|-----------|---------|
| Svelte | MIT |
| TipTap (`@tiptap/*`) and ProseMirror (`@tiptap/pm`) | MIT |
| `fflate` | MIT |
| `docx` — DOCX export | MIT |
| `jspdf` and `html2canvas` — PDF export | MIT |
| `hunspell-asm` — spell checker | MIT |
| `utif2` — TIFF decoding | MIT |
| `odf-kit` | Apache-2.0 |
| Vite, TypeScript, `@sveltejs/vite-plugin-svelte`, `@tsconfig/svelte` (dev) | MIT / Apache-2.0 |

The table above is a convenience summary of the direct dependencies. The
authoritative text — every bundled package including transitive ones, quoted in
full — is [`public/licenses.txt`](./public/licenses.txt), which ships with the
build and is what MIT and Apache-2.0 require to reach a recipient: the minifier
strips the license comments the source files carry.

## Regenerating this list

Regenerate `public/licenses.txt` after any dependency change:

```bash
node scripts/collect-licenses.mjs
```

For an overview of the license *kinds* in the tree, a tool such as
[`license-checker`](https://www.npmjs.com/package/license-checker) works:

```bash
npx license-checker --summary
```
