# Embed mode

Another web application can show EdenText in an iframe and keep the document itself.
The page opened with `?embed=1` (`src/lib/embed/mode.ts`) is the normal app with these
changes:

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
- **Attribution.** The status bar shows `PoweredBy.svelte`, a link to the homepage.
  [`NOTICE.md`](../../NOTICE.md) makes keeping it and the chrome's logo a condition of
  the AGPL under §7(b).
  Only a build with `VITE_EDENTEXT_ATTRIBUTION=off`, allowed under the commercial
  license, leaves it out. That build also drops the logo from both chromes
  (`whiteLabel`), and the island's save menu gains an About entry in its place. There
  is deliberately no runtime switch.

## Protocol (`src/lib/embed/bridge.ts`)

Every message is an object `{ edentext: 1, type, id?, … }`. The editor accepts messages
only from `window.parent`, pins the host's origin at the first `init` and sends
everything after that to that origin alone. `ready` goes out to `*` before `init`, since
it carries no document data. An opaque host origin (`null`) is answered with `*`.

Within protocol 1, messages and fields are only ever added; an existing one keeps its
name and meaning. A change that breaks this raises the protocol number in `ready`.

| Host → editor | Fields | Reply (`response`, same `id`) |
|---|---|---|
| `init` | `user?`, `locale?`, `theme?`, `chrome?`, `name?`, `accent?`, `ai?` | `ok` |
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
  surface, the context menu's AI submenu and the Settings ▸ AI section go (`setAiHostOff`, `storage/ai.svelte.ts`). It is
  never stored, so the host sends it with every `init`; `ai: true` hands the choice back.
  The assistant is **on by default**, and a reader can enter any provider in the frame,
  which then receives document text: a host that must keep documents in-house sends
  `ai: false`.
- **`new`** replaces the document with an empty, unchanged one without asking, as New
  does; `name` is the host's file name for it.

| Editor → host | Fields |
|---|---|
| `ready` | `protocol`, `version` |
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
| `url` | the EdenText instance (constructor only); by default the one serving `embed.js` |
| `user` | the name on comments and recorded changes |
| `locale` | a UI language: `en`, `de`, `es`, `fr`, `it`, `pt`, `el`, `ru`, `uk`, `ja`, `zh-Hans` or `zh-Hant` |
| `theme` | `light`, `dark`, `allBlack` or `auto` (follows the system) |
| `chrome` | `ribbon` or `modern` (the floating toolbar) |
| `name` | the host's file name, shown in the title field |
| `accent` | `slate`, `blue`, `teal`, `green`, `violet`, `berry`, `graphite` or a `#rrggbb` colour |
| `ai` | `false` removes the AI assistant and its settings; `true` leaves it to the reader |

An unknown value is ignored, so the setting keeps what it had.

| Method | Does |
|---|---|
| `ready` | a promise that resolves once the editor has taken the options; `version` is then set |
| `configure(options)` | changes any option above at a later time |
| `load(data, name?)` | opens a `Blob`, `ArrayBuffer` or `Uint8Array`; the name's extension (`.odt`, `.ott`, `.docx`, `.dotx`) picks the reader. Resolves `false` if the reader cancelled a password prompt |
| `newDocument(name?)` | starts an empty document |
| `export(format)` | the document as a `File`: `odt`, `docx` or `pdf` |
| `markSaved()` | tells the editor the exported file is stored, which clears `dirty` |
| `on(event, fn)` | `dirty` (`{ dirty }`), `saveRequest` (the reader pressed Save or Ctrl+S), `warning` (`{ warnings }`, what an import could not keep); returns an unsubscribe function |
| `destroy()` | removes the iframe |

## Hosting notes

- **iframe `sandbox`.** A host that sets it needs `allow-scripts allow-same-origin
  allow-modals allow-popups`, and `allow-downloads` for the print path's fallbacks.
  Without same-origin the app has no storage at all.
- **No file pickers.** The File System Access pickers are unavailable in a cross-origin
  iframe. Nothing in embed mode needs them.
- **Local network.** Chromium blocks a page on a public address from framing a loopback
  or private address, so the host and EdenText have to be on the same kind of network.
  The smoke leg serves its host page from a second loopback server for this reason.
