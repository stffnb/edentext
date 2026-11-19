# Embed mode

Another web application can show EdenText in an iframe and keep the document itself;
`?embed=1` (`src/lib/embed/mode.ts`) opens the normal app with these changes:

- **Nothing is stored.** `embedded` makes `docScope.ts`'s `volatile` true, so the
  document, its pictures, snapshots, embedded fonts and recent files stay in memory.
  `main.ts` starts no tab presence, prune or service worker, and `resolve()` claims no
  `sessionStorage` slot. What the host sets in `init`/`configure` and the AI settings
  typed inside the frame (provider, endpoint, key) last for the page only, so a page
  framing the editor leaves no name or key behind. Preferences the reader picks (theme,
  language, user name, zoom) still go to `localStorage`, which a browser partitions per
  embedding site. Settings ▸ Privacy, whose choices are about the browser copy, is hidden.
- **The host owns the file.** Both chromes and the command search drop New, From
  template, Open, Browser documents, Save As and Save as template
  (`HOST_FILE_COMMANDS` in `ribbon/commands.ts`). Save, its button and Ctrl+S send
  `saveRequest` to the host. The name field is read-only, and there is no unload warning
  and no `launchQueue`. Print, PDF, protection and document properties stay.
- **Attribution.** The status bar shows `PoweredBy.svelte`, a link to the homepage;
  [`NOTICE.md`](../../NOTICE.md) makes keeping it and the chrome's logo an AGPL §7(b)
  condition. Only a build with `VITE_EDENTEXT_ATTRIBUTION=off` (commercial license) drops
  both (`whiteLabel`; the island's save menu gains About instead). No runtime switch.

## Protocol (`src/lib/embed/bridge.ts`)

Every message is an object `{ edentext: 1, type, id?, … }`. The editor accepts messages
only from `window.parent`, pins the host's origin at the first `init` and sends
everything after that to that origin alone. `ready` goes out to `*` before `init`, since
it carries no document data. An opaque host origin (`null`) is answered with `*`.

Within protocol 1, messages and fields are only ever added; an existing one keeps its
name and meaning. A change that breaks this raises the protocol number in `ready`.

| Host → editor | Fields | Reply (`response`, same `id`) |
|---|---|---|
| `init` | `user?`, `locale?`, `theme?`, `chrome?`, `name?`, `accent?`, `ai?`, `dictation?` | `ok` |
| `configure` | the same, at any later time | `ok` |
| `load` | `bytes` (ArrayBuffer), `name` | `ok: false` if the reader backed out (password) |
| `new` | `name?` | `ok` |
| `export` | `format`: `odt`, `docx` or `pdf` | `bytes` (transferred), `mime`, `name` |
| `markSaved` | – | `ok` |

A failure is answered with `error: message`.

- **`load`** goes through `applyImport` with a `host` argument. It replaces the document
  without asking, sends import warnings as a `warning` event (`warnings: string[]`) and
  throws instead of alerting. The name's extension picks the reader, as a file's does.
- **`export`** builds the same bytes as Save (`buildBytes`), encrypted when the document
  has a password. The PDF is the raster PDF (`exportPdf` with `toBytes`).
- **Clean state.** Exporting does not make the document clean. The host calls
  `markSaved` once it has stored the file, so `dirty` follows what the host holds.
- **`name`** in `init`/`configure` is the host's file name. It does not count as an edit.
- **`accent`** is one of the presets in Settings ▸ General (`ACCENTS` in
  `storage/theme.ts`) or a `#rrggbb` colour. Like `user`, `locale`, `theme` and `chrome`
  it holds for the page and is not stored, so the host sends it with every `init`.
- **`ai: false`** switches the assistant off above the user's own setting: every AI
  surface, the context menu's AI submenu and the Settings ▸ AI section go (`setEmbedHostConfig`, `storage/hostConfig.svelte.ts`). It is
  never stored, so the host sends it with every `init`; `ai: true` hands the choice back.
  An object presets the provider with the fields of `edentext.config.json` (`ai.md`) and
  overrides that file field by field. **`dictation`** works alike (`false` or `{ server,
  model, locked, webSpeech }`, `dictation-local.md`); the iframe gets `allow="microphone"` unless the
  constructor's options say `dictation: false`.
  The assistant is **on by default**, and a reader can enter any provider in the frame,
  which then receives document text: a host that must keep documents in-house sends
  `ai: false`.
- **`new`** replaces the document with an empty, unchanged one without asking, as New
  does; `name` is the host's file name for it.

| Editor → host | Fields |
|---|---|
| `ready` | `protocol`, `version` |
| `refused` | – (an `init` from a page `embed.config.json` does not name; sent to `*`) |
| `dirty` | `dirty` |
| `saveRequest` | – |
| `warning` | `warnings` |

## Host side (`public/embed.js`)

Every instance serves the helper next to the app:

```html
<div id="editor" style="height: 80vh"></div>
<script type="module">
  import { EdenTextFrame } from 'https://edentext.example.org/embed.js';
  const ed = new EdenTextFrame(document.getElementById('editor'), {
    user: 'Jane Doe', locale: 'de', accent: '#0b6e4f', ai: false,
  });
  await ed.ready;
  await ed.load(await (await fetch('/files/42')).blob(), 'letter.docx');
  ed.on('saveRequest', async () => {
    const file = await ed.export('docx'); // a File with name and type
    await fetch('/files/42', { method: 'PUT', body: file });
    await ed.markSaved();
  });
</script>
```

`embed.d.ts` beside it carries the TypeScript types: a project that copies both files
gets them without further setup.

| Option (constructor and `configure`) | Values |
|---|---|
| `url` | the EdenText instance (constructor only); by default the one serving `embed.js`, `/edentext/` in `@edentext/embed` |
| `user` | the name on comments and recorded changes |
| `locale` | a UI language: `en`, `de`, `es`, `fr`, `it`, `pt`, `el`, `ru`, `uk`, `id`, `ar`, `ja`, `zh-Hans` or `zh-Hant` |
| `theme` | `light`, `dark`, `allBlack` or `auto` (follows the system) |
| `chrome` | `ribbon` or `modern` (the floating toolbar) |
| `name` | the host's file name, shown in the title field |
| `accent` | `slate`, `blue`, `teal`, `green`, `violet`, `berry`, `graphite` or a `#rrggbb` colour |
| `ai` | `false` removes the AI assistant and its settings; `true` leaves it to the reader; `{ provider, endpoint, model, contextTokens, locked }` presets it, never with a key |
| `dictation` | `false` removes dictation; `{ server, model, locked, webSpeech }` presets its speech server and whether the browser's recognition stays on offer |

An unknown value is ignored, so the setting keeps what it had.

| Method | Does |
|---|---|
| `ready` | a promise that resolves once the editor has taken the options; `version` is then set. It rejects when the editor turns the page away or speaks another protocol |
| `configure(options)` | changes any option above at a later time |
| `load(data, name?)` | opens a `Blob`, `ArrayBuffer` or `Uint8Array`; the name's extension (`.odt`, `.ott`, `.docx`, `.dotx`) picks the reader. Resolves `false` if the reader cancelled a password prompt |
| `newDocument(name?)` | starts an empty document |
| `export(format)` | the document as a `File`: `odt`, `docx` or `pdf` |
| `markSaved()` | tells the editor the exported file is stored, which clears `dirty` |
| `on(event, fn)` | `dirty` (`{ dirty }`), `saveRequest` (the reader pressed Save or Ctrl+S), `warning` (`{ warnings }`, what an import could not keep); returns an unsubscribe function |
| `destroy()` | removes the iframe |

## npm packages

`scripts/pack-npm.mjs` assembles `dist-npm/` from `dist/`, `public/embed.*` and
`packages/`; all three packages carry the app's version, `npm run test:npm` installs
them into a fresh Vite project, and the release workflow publishes them once the
repository variable `NPM_PUBLISH` is `true`.

- **`@edentext/app`** is `dist/` without the pages only edentext.app needs (sitemap,
  robots, preview image, verification file, counter), with `LICENSE` and `NOTICE.md`
  inside so every served copy carries them. `edentext-copy` (`copy.mjs`, Node built-ins
  only) copies it to `public/edentext`, drops dictionaries and thesauri of languages
  `--languages` leaves out (`en`'s thesaurus serves `en-GB` too), always writes
  `embed.config.json` (`["self"]` without `--origins`) and replaces only a folder holding
  `index.html`, `embed.js` and `licenses.txt`. The Vite plugin (`@edentext/app/vite`)
  serves them under `/edentext/` in the dev server, with a 404 rather than the host's
  SPA fallback past them, and copies them into the client build.
- **`@edentext/embed`** is `public/embed.js` with `defaultUrl` set to `/edentext/`, so
  the entry has no `import.meta.url` (checked with Vite, webpack and esbuild);
  `element.js` defines `<eden-text>`, `react.js` `<EdenText>`, both importable without a
  DOM for server-side rendering. **`edentext`** re-exports it under the plain name.

**Licenses.** What runs in a host's page or build (helper, element, React component,
copy tool, Vite plugin) is MIT (`packages/LICENSE`), so a host under any license can
import it. The editor stays AGPL with the attribution term; `NOTICE.md` states that
showing and driving it over messages leaves the host's code outside the AGPL. Each
helper file opens with a `/*!` notice, which esbuild and terser keep and Vite 8 drops,
so a host shipping third-party notices lists the helper with its MIT dependencies.
`@edentext/app` declares AGPL-3.0-only and carries the MIT text as `LICENSE.MIT`.

A copy without a language works: a dictionary or thesaurus answered with a 404 or HTML
counts as not shipped (`NotServed`, `utils/loadFailure.ts`) and goes unchecked quietly.

**Same origin.** Under the host's `/edentext/` the editor shares its storage (all
`localStorage` keys begin with `edentext-`; embed mode writes only preferences, no
IndexedDB). A host service worker scoped to `/` must pass the editor's requests through
(measured: the editor starts). A host CSP header for `/edentext/` applies on top of the
editor's `<meta>` policy, so it must allow `'wasm-unsafe-eval'`, the inline script
hashes, `style-src 'unsafe-inline'` and `blob:` workers. Same origin means no isolation:
an editor flaw would reach the host's cookies and storage, so for strict cases the
package README recommends a subdomain with the application in `--origins`.

## Hosting notes

- **iframe `sandbox`** needs `allow-scripts allow-same-origin allow-modals allow-popups`,
  plus `allow-downloads` for the print fallbacks; without same-origin there is no storage.
- **No file pickers:** File System Access is unavailable in a cross-origin iframe; embed
  mode needs none.
- **Local network:** Chromium blocks a public page from framing a loopback or private
  address, so host and EdenText share a kind of network (the smoke leg serves its host
  from a second loopback server).
- **iframe `allow`:** `embed.js` grants `clipboard-read` (Paste), `clipboard-write` and
  `local-fonts`; a host that drops one loses only that feature.

## Security

- **Content-Security-Policy.** The build writes a `<meta>` policy into `index.html`
  (`contentSecurityPolicy()` in `vite.config.ts`): scripts only from the app itself, the
  inline ones by hash, plus wasm; no plugins, no `<base>`, no form posts. A document, a
  paste or a model answer therefore cannot run script even past a sanitizer bug.
  `connect-src` stays open because the AI endpoint is the reader's choice. The browser
  legs fail on any violation.
- **Who may frame it.** A `<meta>` policy cannot carry `frame-ancestors`, so the
  serving side sends it: the Helm chart's `frameAncestors` value, or the same header
  from any other server. Without it any page may frame the instance.
- **Who may drive it.** `embed.config.json` beside `index.html`, `{ "origins": [...] }`
  with `"self"` for the editor's own origin, pins the host to one of those; any other
  page's `init` is ignored. The bridge reads it before `ready`, past the service
  worker's cache. A build with `VITE_EMBED_ORIGINS` (origins separated by spaces or
  commas) takes precedence and skips the file. With neither, or when the file does not
  arrive, the first page to send `init` is the host; a file that arrives malformed
  admits none. A host should run its own instance on its own origin, with both settings.
- **`embed.js`** loaded from another origin makes the host trust that origin; copying
  `embed.js` and `embed.d.ts` into its own assets, or Subresource Integrity, avoids it.
- **What the host gets.** The editor accepts messages only from `window.parent` and,
  after `init`, only from the pinned origin, and sends document data only there.
