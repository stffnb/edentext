# @edentext/app

The built [EdenText](https://github.com/stffnb/edentext) editor, a word processor that
saves `.odt` and `.docx`, to serve from your own server and drive with
[`@edentext/embed`](https://www.npmjs.com/package/@edentext/embed).

```sh
npm install @edentext/app @edentext/embed
```

## Copy it into your static files

```sh
npx edentext-copy public/edentext --languages en,de
```

The editor is static files: any server serves it. As a `prebuild` script this works with
Next, Astro and anything else that has a static folder:

```json
{ "scripts": { "prebuild": "edentext-copy public/edentext --languages en,de" } }
```

- `--languages` keeps those spell-check languages (all by default, about 98 MB; with
  none, about 32 MB). A document in another language simply goes unchecked.
- `--origins self,https://app.example.com` lists the pages that may drive the editor.
  The default `self` is the editor's own origin. The list goes to `embed.config.json`.
- An existing earlier copy is replaced; any other non-empty folder is left alone.

## Or let Vite do it

```js
// vite.config.js
import edentext from '@edentext/app/vite';
export default { plugins: [edentext({ languages: ['en', 'de'] })] };
```

The dev server serves the editor under `/edentext/`, and the build copies it there. The
options are the same, plus `base` for another path.

## Same origin or a subdomain

Under `/edentext/` of your application the editor shares its origin, so the browser does
not separate the two: a flaw in the editor would reach your cookies and storage. The
editor's own Content-Security-Policy guards against that, but for strict cases serve it
from a subdomain of its own and name your application with `--origins`. The editor's
storage keys all begin with `edentext-`. A service worker of yours whose scope covers
`/edentext/` must pass those requests through, and a Content-Security-Policy header you
send for them must allow what the editor's own `<meta>` policy does (`'wasm-unsafe-eval'`,
its inline script hashes, `blob:` workers).

Who may frame the editor is set by the serving side, e.g. in nginx:

```nginx
location /edentext/ { add_header Content-Security-Policy "frame-ancestors 'self' https://app.example.com"; }
```

## AI assistant

The assistant is on by default and sends document text to a provider the reader enters.
For confidential documents, pass `ai: false` to the helper.

## License

AGPL-3.0-only with an additional term under section 7(b), see `NOTICE.md`: in embed mode
the "Powered by EdenText" notice and the logo stay visible. A commercial license without
this term is available; see the repository.
