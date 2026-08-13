# Third-Party Notices

EdenText as a whole is licensed under the GNU Affero General Public License
v3.0 (see [`LICENSE`](./LICENSE)), with a separate commercial license available
(see [`LICENSE.commercial.md`](./LICENSE.commercial.md)).

It bundles and depends on third-party components that remain under **their own**
licenses, listed below. All of these licenses are permissive and compatible with
both the AGPL distribution and a commercial distribution of this project.

## Bundled fonts — retain their own license

The **Liberation** fonts (`src/assets/fonts/LiberationSerif-*.ttf`) are **not**
covered by this project's license. They are licensed under the **SIL Open Font
License, Version 1.1 (OFL-1.1)** and remain so regardless of how this project is
licensed.

- Copyright (c) 2010 Google Corporation (with Reserved Font Name Arimo, Tinos and Cousine)
- Copyright (c) 2012 Red Hat, Inc. (with Reserved Font Name "Liberation")
- Full license text: [`src/assets/fonts/LICENSE-LiberationFonts.txt`](./src/assets/fonts/LICENSE-LiberationFonts.txt)

> OFL-1.1 permits bundling the fonts in any software, **including commercial and
> proprietary software**, provided the license file is retained and the fonts are
> not sold by themselves. The fonts must not be redistributed under their Reserved
> Font Names if modified.

## Runtime / build dependencies

| Component | License |
|-----------|---------|
| Svelte | MIT |
| TipTap (`@tiptap/*`) and ProseMirror (`@tiptap/pm`) | MIT |
| `fflate` | MIT |
| `odf-kit` | Apache-2.0 |
| Vite, TypeScript, `@sveltejs/vite-plugin-svelte`, `@tsconfig/svelte` (dev) | MIT / Apache-2.0 |

The authoritative license for each dependency is the one shipped in its package
inside `node_modules/<pkg>/`. This table is a convenience summary and may need
updating when dependencies change.

## Regenerating this list

When dependencies change, you can regenerate an up-to-date overview with a tool
such as [`license-checker`](https://www.npmjs.com/package/license-checker):

```bash
npx license-checker --summary
```
