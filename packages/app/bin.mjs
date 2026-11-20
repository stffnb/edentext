#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Steffen Becker
import { parseArgs } from 'node:util';
import { copyEditor, LANGUAGES } from './copy.mjs';

const usage = `Usage: edentext-copy [target] [--languages en,de] [--origins self,https://app.example.com]

Copies the EdenText editor into target (default public/edentext), for your server to
serve as static files. Without --languages every spell-check language is copied
(${LANGUAGES.join(', ')}). --origins lists the pages allowed to drive the editor;
"self" is the editor's own origin, the default.`;

let args;
try {
  args = parseArgs({ allowPositionals: true, options: {
    languages: { type: 'string' }, origins: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
} catch (err) {
  console.error(`${err.message}\n\n${usage}`);
  process.exit(2);
}
if (args.values.help) {
  console.log(usage);
  process.exit(0);
}
const list = (s) => s?.split(',').map((x) => x.trim()).filter(Boolean);
const target = args.positionals[0] ?? 'public/edentext';
try {
  const done = copyEditor(target, { languages: list(args.values.languages), origins: list(args.values.origins) });
  console.log(`EdenText copied to ${target} (languages: ${done.languages.join(', ')}; hosts: ${done.origins.join(', ')})`);
} catch (err) {
  console.error(`edentext-copy: ${err.message}`);
  process.exit(1);
}
