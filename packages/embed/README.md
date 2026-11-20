# @edentext/embed

Puts the [EdenText](https://github.com/stffnb/edentext) editor into your page and drives
it: load a document, export `.odt`, `.docx` or `.pdf`, react to Save. Serve the editor
itself from your own server with [`@edentext/app`](https://www.npmjs.com/package/@edentext/app).

```sh
npm install @edentext/app @edentext/embed
npx edentext-copy public/edentext
```

```js
import { EdenTextFrame } from '@edentext/embed';

const ed = new EdenTextFrame(document.getElementById('editor'), { user: 'Jane Doe', ai: false });
await ed.ready;
await ed.load(await (await fetch('/files/42')).blob(), 'letter.docx');
ed.on('saveRequest', async () => {
  await fetch('/files/42', { method: 'PUT', body: await ed.export('docx') });
  await ed.markSaved();
});
```

The container needs a height. `url` points at the editor, `/edentext/` by default; the
other options are `user`, `locale`, `theme`, `chrome`, `name`, `accent` and `ai`
(`false` keeps document text away from AI providers). The full protocol is in
[docs/architecture/embed.md](https://github.com/stffnb/edentext/blob/main/docs/architecture/embed.md).

## Custom element (Vue, Svelte, Angular, plain HTML)

```html
<script type="module">import '@edentext/embed/element';</script>
<eden-text user="Jane Doe" ai="false" style="height: 80vh"></eden-text>
```

Methods (`load`, `export`, `markSaved`, …) are on the element; `dirty`, `saveRequest`,
`warning`, `ready` and `error` arrive as DOM events with the message in `detail`.

Vue and Angular need to be told that `<eden-text>` is not one of their own components.
In Vue that is a compiler option; a template `ref` then reaches the methods, and
`@ready` or `@saveRequest` the events:

```js
// vite.config.js
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'eden-text' } } })
```

In Angular, add `CUSTOM_ELEMENTS_SCHEMA` to the `schemas` of the component that uses it.

## React

```jsx
import { EdenText } from '@edentext/embed/react';

const ref = useRef(null);
<EdenText ref={ref} user="Jane Doe" ai={false} style={{ height: '80vh' }}
  onSaveRequest={async () => { await upload(await ref.current.export('docx')); await ref.current.markSaved(); }} />
```

## License

MIT, see `LICENSE`: use it in an application under any license. The editor it drives is
a separate program under the AGPL-3.0-only with an additional term; showing it in your
page does not put your own code under the AGPL. See the license section of
[`@edentext/app`](https://www.npmjs.com/package/@edentext/app).
