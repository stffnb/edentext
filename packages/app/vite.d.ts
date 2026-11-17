// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Steffen Becker
import type { Plugin } from 'vite';

export interface EdenTextPluginOptions {
  /** Where the editor is served, '/edentext/' by default; set the helper's `url` to match. */
  base?: string;
  /** Spell-check languages to ship, e.g. ['en', 'de']; all by default. */
  languages?: string[];
  /** Pages allowed to drive the editor: 'self' (the default) or origins such as 'https://app.example.com'. */
  origins?: string[];
}

export default function edentext(options?: EdenTextPluginOptions): Plugin;
