// Assembles the npm packages in dist-npm/ from dist/ (npm run build first),
// public/embed.{js,d.ts} and packages/: @edentext/app, @edentext/embed and the
// unscoped edentext, which points at the latter. All carry the app's version.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist-npm');
const at = (...p) => join(ROOT, ...p);
const root = JSON.parse(readFileSync(at('package.json'), 'utf8'));
// The helper's license waits on a legal answer; until then it is the editor's.
const EMBED_LICENSE = 'AGPL-3.0-only';

if (!existsSync(at('dist/index.html'))) throw new Error('no dist/: run npm run build first');
const index = readFileSync(at('dist/index.html'), 'utf8');
if (/goatcounter/.test(index)) throw new Error('dist/ was built with GOATCOUNTER; rebuild without it');
const bundle = readFileSync(at('dist/assets', index.match(/assets\/(index-[^"]+\.js)/)[1]), 'utf8');
if (!bundle.includes('Powered by')) throw new Error('dist/ was built without the attribution (VITE_EDENTEXT_ATTRIBUTION=off)');
// The commit the build names (AGPL §13), from the version string the build stamped in.
const commit = bundle.match(new RegExp(`${root.version.replaceAll('.', '\\.')} \\(([0-9a-f]+)\\)`))?.[1];

const common = {
  version: root.version,
  author: root.author,
  homepage: root.homepage,
  repository: root.repository,
  bugs: { url: 'https://github.com/stffnb/edentext/issues' },
  type: 'module',
};
const legal = ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md'];
const write = (dir, name, data) => writeFileSync(join(dir, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);

rmSync(OUT, { recursive: true, force: true });

// @edentext/app: the built editor. Pages that only edentext.app needs stay out.
const app = join(OUT, 'app');
const skip = new Set(['sitemap.xml', 'robots.txt', 'og-image.png', 'count.js', 'favicon-old.svg']);
cpSync(at('dist'), join(app, 'dist'), {
  recursive: true,
  filter: (src) => {
    const name = src.slice(at('dist').length + 1);
    return !skip.has(name) && !/^google[0-9a-f]+\.html$/.test(name) && !name.endsWith('.map');
  },
});
// The served copy carries its license, too.
for (const f of ['LICENSE', 'NOTICE.md']) cpSync(at(f), join(app, 'dist', f));
for (const f of ['copy.mjs', 'bin.mjs', 'vite.js', 'vite.d.ts', 'README.md']) cpSync(at('packages/app', f), join(app, f));
for (const f of legal) cpSync(at(f), join(app, f));
write(app, 'package.json', {
  name: '@edentext/app',
  ...common,
  description: 'The EdenText editor, built: a word processor for .odt and .docx to serve from your own server',
  license: root.license,
  keywords: ['editor', 'word-processor', 'odt', 'docx', 'embed'],
  bin: { 'edentext-copy': './bin.mjs' },
  exports: {
    '.': './copy.mjs',
    './vite': { types: './vite.d.ts', default: './vite.js' },
    './package.json': './package.json',
  },
  peerDependencies: { vite: '>=5' },
  peerDependenciesMeta: { vite: { optional: true } },
  engines: { node: '>=20.12' },
  ...(commit && { gitHead: commit }),
});

// @edentext/embed: the helper as every instance serves it, defaulting to /edentext/.
const embed = join(OUT, 'embed');
mkdirSync(embed, { recursive: true });
const helper = readFileSync(at('public/embed.js'), 'utf8');
const DEFAULT = "const defaultUrl = () => new URL('./', import.meta.url);";
if (!helper.includes(DEFAULT)) throw new Error('public/embed.js: the defaultUrl line changed; update pack-npm.mjs');
const packed = helper
  .replace(DEFAULT, "const defaultUrl = () => '/edentext/';")
  .replace(/^\/\/ The instance serving this file.*\n/m, '// The editor, where edentext-copy and the Vite plugin put it by default.\n')
  .replace(/^\/\/ Usage and messages:[\s\S]*?\n(?=const PROTOCOL)/m, '// Usage and messages: docs/architecture/embed.md in the EdenText repository.\n');
if (packed.includes('import.meta')) throw new Error('the packaged helper still reads import.meta');
write(embed, 'index.js', packed);
const types = readFileSync(at('public/embed.d.ts'), 'utf8');
const URL_DOC = '/** The EdenText instance, by default the one serving embed.js. */';
if (!types.includes(URL_DOC)) throw new Error('public/embed.d.ts: the url comment changed; update pack-npm.mjs');
write(embed, 'index.d.ts', types.replace(URL_DOC, "/** The EdenText instance, '/edentext/' by default. */"));
for (const f of ['element.js', 'element.d.ts', 'react.js', 'react.d.ts', 'README.md']) cpSync(at('packages/embed', f), join(embed, f));
for (const f of legal) cpSync(at(f), join(embed, f));
write(embed, 'package.json', {
  name: '@edentext/embed',
  ...common,
  description: 'Embed the EdenText editor in a page and drive it: load, export .odt/.docx/.pdf, save',
  license: EMBED_LICENSE,
  keywords: ['editor', 'word-processor', 'odt', 'docx', 'embed', 'iframe', 'react', 'web-component'],
  sideEffects: ['./element.js'],
  exports: {
    '.': { types: './index.d.ts', default: './index.js' },
    './element': { types: './element.d.ts', default: './element.js' },
    './react': { types: './react.d.ts', default: './react.js' },
    './package.json': './package.json',
  },
  peerDependencies: { react: '>=17' },
  peerDependenciesMeta: { react: { optional: true } },
});

// edentext: holds the plain name for the helper.
const plain = join(OUT, 'edentext');
mkdirSync(plain, { recursive: true });
write(plain, 'index.js', "export * from '@edentext/embed';\n");
write(plain, 'index.d.ts', "export * from '@edentext/embed';\n");
write(plain, 'README.md', '# edentext\n\nUse [`@edentext/embed`](https://www.npmjs.com/package/@edentext/embed) and '
  + '[`@edentext/app`](https://www.npmjs.com/package/@edentext/app); this package only re-exports the former.\n');
cpSync(at('LICENSE'), join(plain, 'LICENSE'));
write(plain, 'package.json', {
  name: 'edentext',
  ...common,
  description: 'EdenText: use @edentext/embed and @edentext/app',
  license: EMBED_LICENSE,
  exports: { '.': { types: './index.d.ts', default: './index.js' } },
  dependencies: { '@edentext/embed': root.version },
});

console.log(`dist-npm/: @edentext/app, @edentext/embed, edentext ${root.version}`);
