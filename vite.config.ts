/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
