// AGPL-3.0-only with an additional term under section 7(b): see NOTICE.md.
// Serves the editor under `base` in the dev server and copies it into the build output.
import { createReadStream, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { copyEditor, configText, resolveFile } from './copy.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.ts': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.aff': 'text/plain; charset=utf-8',
};

/**
 * @param {{ base?: string, languages?: string[], origins?: string[] }} [options]
 * @returns {import('vite').Plugin}
 */
export default function edentext({ base = '/edentext/', ...options } = {}) {
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}/`;
  let outDir;
  return {
    name: 'edentext',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      const origins = options.origins ?? ['self'];
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://x');
        if (url.pathname === prefix.slice(0, -1)) return void res.writeHead(302, { location: prefix + url.search }).end();
        if (!url.pathname.startsWith(prefix)) return next();
        let rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
        if (rel === 'embed.config.json') return void res.writeHead(200, { 'content-type': TYPES['.json'] }).end(configText(origins));
        let file = resolveFile(rel, options);
        if (file && statSync(file, { throwIfNoEntry: false })?.isDirectory()) file = join(file, 'index.html');
        // Never the host's SPA fallback: a missing file under the editor is a 404.
        if (!file || !statSync(file, { throwIfNoEntry: false })?.isFile()) return void res.writeHead(404).end();
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
      });
    },
    writeBundle() {
      if (this.environment && this.environment.config.consumer !== 'client') return;
      copyEditor(join(outDir, prefix), options);
    },
  };
}
