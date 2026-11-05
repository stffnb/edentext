/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json' with { type: 'json' };

// The commit the build came from, so a user of the hosted app can identify the
// corresponding source (AGPL §13). Absent when building outside a git checkout.
const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
})();

// Anonymous visit counting, only in a build with GOATCOUNTER set to the count endpoint
// (edentext.app); every other build ships neither the tag nor count.js.
function goatcounter(): Plugin {
  const endpoint = process.env.GOATCOUNTER;
  return {
    name: 'goatcounter',
    apply: 'build',
    transformIndexHtml: () =>
      endpoint
        ? [{ tag: 'script', attrs: { 'data-goatcounter': endpoint, async: true, src: './count.js' }, injectTo: 'head' }]
        : [],
    generateBundle() {
      if (!endpoint) return;
      const source = readFileSync(new URL('./scripts/goatcounter/count.js', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'count.js', source });
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so the same build works at the domain root and under a
  // subpath (GitHub Pages project site). sw.js and the manifest are relative too.
  base: './',
  plugins: [svelte(), goatcounter()],
  // The browsers the bundle promises to parse in; the CI browser matrix runs the
  // engines behind them (docs/headless-testing.md).
  build: { target: 'baseline-widely-available' },
  define: {
    __APP_VERSION__: JSON.stringify(commit ? `${pkg.version} (${commit})` : pkg.version),
  },
  // hunspell-asm's ESM chain calls CJS/UMD deps as functions that a bundler
  // yields as non-callable namespaces (glue → "runtimeModule is not a function";
  // nanoid → CANNOT_CALL_NAMESPACE). The CJS builds' require-interop fixes both.
  resolve: {
    alias: {
      'hunspell-asm': 'hunspell-asm/dist/cjs/index.js',
      'emscripten-wasm-loader': 'emscripten-wasm-loader/dist/cjs/index.js',
    },
  },
  // harper.js/binary resolves its wasm through new URL('…', import.meta.url); the
  // dep optimizer rewrites that and loses the asset.
  optimizeDeps: { exclude: ['harper.js'] },
  // flatpak-builder output is a whole rootfs with symlink loops (var/run → /run).
  server: { watch: { ignored: ['**/desktop/flatpak/**'] } },
  // Test-only config; never enters the production bundle (vitest is dev-only).
  // jsdom supplies a global DOMParser, so the export/import specs need no setup.
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    globals: false,
    // A build+re-import leg runs ~10s when the whole suite competes for the CPU,
    // well past vitest's 5s default.
    testTimeout: 60000,
    // `npm run test:coverage` — untested src files appear at 0%, which is the point.
    coverage: {
      include: ['src/**/*.ts', 'src/**/*.svelte'],
      reporter: ['text-summary', 'html'],
    },
  },
});
