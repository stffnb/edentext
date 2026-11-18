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
