# Embed mode

Another web application can show EdenText in an iframe and keep the document itself.
The page opened with `?embed=1` (`src/lib/embed/mode.ts`) is the normal app with these
changes:

- **Nothing is stored.** `embedded` makes `docScope.ts`'s `volatile` true, so the
  document, its pictures, snapshots, embedded fonts and recent files stay in memory.
  `main.ts` starts no tab presence, prune or service worker, and `resolve()` claims no
  `sessionStorage` slot. App-wide preferences (theme, language, user name, zoom) still go
  to `localStorage`, which a browser partitions per embedding site.
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

| Host → editor | Fields | Reply (`response`, same `id`) |
|---|---|---|
| `init` | `user?`, `locale?`, `theme?`, `chrome?`, `name?` | `ok` |
| `configure` | the same, at any later time | `ok` |
| `load` | `bytes` (ArrayBuffer), `name` | `ok: false` if the reader backed out (password) |
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
  const ed = new EdenTextFrame(document.getElementById('editor'), { user: 'Jane Doe', locale: 'de' });
  await ed.ready;
  await ed.load(await (await fetch('/files/42')).blob(), 'letter.docx');
  ed.on('saveRequest', async () => {
    const file = await ed.export('docx'); // a File with name and type
    await fetch('/files/42', { method: 'PUT', body: file });
    await ed.markSaved();
  });
</script>
```

`url` in the options points at another instance. By default it is the one serving
`embed.js`.

## Hosting notes

- **iframe `sandbox`.** A host that sets it needs `allow-scripts allow-same-origin
  allow-modals allow-popups`, and `allow-downloads` for the print path's fallbacks.
  Without same-origin the app has no storage at all.
- **No file pickers.** The File System Access pickers are unavailable in a cross-origin
  iframe. Nothing in embed mode needs them.
- **Local network.** Chromium blocks a page on a public address from framing a loopback
  or private address, so the host and EdenText have to be on the same kind of network.
  The smoke leg serves its host page from a second loopback server for this reason.
