# `src/lib/i18n/`

The UI language. Distinct from the per-document spell-check language
(`storage/documentLanguage.ts`), which has its own list and its own dictionaries.

`locales/en.ts` is the source of truth: `type Messages = typeof en` is the contract every
other catalog satisfies, so a missing key is a `npm run check` error, not a runtime blank.
Interpolated and counted entries are functions. English is in the app's module; every other
catalog is a chunk of its own, named in `loaders` (`i18n.svelte.ts`), a
`Record<Exclude<Locale, 'en'>, …>`, so a new locale cannot be half-added. `main.ts` mounts
once the picked catalog is in, `setLocale()` switches once its catalog is (English stands in
where the fetch fails), `index.html` preloads the picked one from the names the build writes
into it (`localeChunks` in `vite.config.ts`), and the service worker keeps them all.

**Adding one** — a file in `locales/`, its code in `LOCALES` and its endonym in
`LOCALE_LABELS` (`config.ts`), its `loaders` entry, and a tag in
`LOCALE_TAG` (`utils/dateTime.ts`) so `Intl` gets a region for date fields and the status
bar, and the desktop app's dialog and menu texts (`TEXT` in `desktop/main.mjs`). `tests/unit/templates.test.ts` iterates `LOCALES` and covers the new catalog on its
own; the `templates:` block is what the built-in templates read at call time.

**Direction** — `RTL_LOCALES` (`config.ts`) names the languages written right to left;
`reflectLocale` puts `lang` and `dir` on `<html>` at start and on `setLocale`, and `index.html`
sets `dir` for the first frame. The page is not the interface: `.paper` is `direction: ltr`,
and the body host and every header/footer zone state the document's own direction (`pageDir`:
`ltr` or `rtl`, never absent). What reads left to right in any language is an island:
`withShortcut` and `ltrIsland` (`shortcut.ts`) wrap a key combination, file name or version in
Unicode isolates under a right-to-left UI only; markup takes `dir="ltr"` (document name, ruler,
font, size, address, code and formula fields, previews of document formatting), and
`global.css` turns number, decimal, address and password fields.
Script-placed parts ask `uiRtl()` (`i18n.svelte.ts`): a panel starts at its anchor's start edge
(`startEdge`, the ribbon's `pinInline`), a menu and its submenus open towards the end side and the
arrow key pointing there opens them, and the island's toolbar offset runs from the start. A glyph
that shows reading direction or sequence mirrors (`MIRRORED` in `ribbon/icons.ts`, `.icon-flip` on
an inline one, digits kept by `.icon-keep`); one naming a physical side (alignment, borders, wrap,
table columns, the direction buttons) does not. Undo and redo mirror as Microsoft Office's do
(its Fluent `arrow_undo`/`arrow_redo` assets are flagged flippable); LibreOffice keeps them.
A sample that must not reorder or mirror takes its own `dir`: numbering formats (`sampleDir`),
symbol and formula palette cells, autocorrect examples. The page area stays physical: `.paper-scaler` is
`direction: ltr`, an interface part inside it takes `.ui-dir`, and a label quoting document text
takes `dir="auto"` with `.doc-quote` (font and file names sit in `<bdi>`). A pane's dock side is a
physical choice; unset, it is the interface's end side (`dockSide`, `storage/panes.svelte.ts`).

**Codes are full BCP-47 tags, not always two letters.** Chinese ships as `zh-Hans` and
`zh-Hant`: the written standard is one language, the scripts are two, and the terminology
goes with the script (檔案/文件, 列印/打印, and a table row is 列 in Taiwan but 行 on the
mainland). `resolveBrowserLocale` therefore maps `navigator.language` by hand for `zh*`
rather than slicing two characters off it.

A UI locale is **not** automatically a spell-check language. `loadDocumentLanguage`
falls back to the UI locale on first run and must keep checking `isValid`: Chinese has no
Hunspell dictionary — none is meaningful, there are no word delimiters and no inflection —
so it leaves checking off rather than fetching a 404 or writing a language the document
cannot express.

**Terminology** — a catalog uses the terms word processors already use in that language
(Microsoft Terminology, LibreOffice's translation) rather than a literal rendering of `en.ts`;
a regional variant follows the catalog's region (`pt.ts` is European Portuguese).

**Style names** — `styleLabel` shows a built-in style's name from `styleNames` (tables:
`table.styleNames`); the sheet, comparisons and files always keep the stored English name.
`number.ts`: a measurement field shows its number with the UI language's decimal separator (`formatDecimal`, `Intl` on `localeTag`) and reads either separator (`parseDecimal`); unit names (`cm`, `pt`) are not translated, as in no catalog yet.
