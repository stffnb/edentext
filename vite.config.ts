/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
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

export default defineConfig({
  // Relative asset URLs, so the same build works at the domain root and under a
  // subpath (GitHub Pages project site). sw.js and the manifest are relative too.
  base: './',
  plugins: [svelte()],
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
