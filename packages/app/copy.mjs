// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Steffen Becker
// Copies the built editor into a host's static files, minus the languages left out, and
// writes embed.config.json, the list of pages allowed to drive it.
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDITOR = fileURLToPath(new URL('./dist/', import.meta.url));

/** The spell-check languages the package ships, e.g. en, en-GB, de. */
export const LANGUAGES = readdirSync(join(EDITOR, 'dictionaries')).sort();

function check({ languages, origins = ['self'] } = {}) {
  const unknown = languages?.filter((l) => !LANGUAGES.includes(l)) ?? [];
  if (unknown.length) throw new Error(`unknown language ${unknown.join(', ')}; available: ${LANGUAGES.join(', ')}`);
  return {
    languages,
    origins: origins.map((o) => {
      if (o === 'self') return o;
      const url = URL.canParse(o) ? new URL(o) : null;
      if (!url || url.origin === 'null' || url.origin !== o.replace(/\/$/, '')) throw new Error(`"${o}" is not an origin such as https://app.example.com or self`);
      return url.origin;
    }),
  };
}

// Whether a file of the editor (a path relative to it) belongs in the copy. The en
// thesaurus also serves en-GB.
function keeper(languages) {
  return (rel) => {
    const [dir, code] = rel.split(sep);
    if (!languages || !code) return true;
    if (dir === 'dictionaries') return languages.includes(code);
    if (dir === 'thesaurus') return languages.includes(code) || (code === 'en' && languages.includes('en-GB'));
    return true;
  };
}

export const configText = (origins) => `${JSON.stringify({ origins }, null, 2)}\n`;

/** For a dev server: the editor file a path under the base names, if the copy has it. */
export function resolveFile(rel, options) {
  const { languages } = check(options);
  const file = join(EDITOR, rel);
  if (relative(EDITOR, file).startsWith('..') || !keeper(languages)(relative(EDITOR, file))) return null;
  return file;
}

// A folder the tool wrote before, or the release archive, may be replaced as a whole.
const isEditor = (dir) => ['index.html', 'embed.js', 'licenses.txt'].every((f) => existsSync(join(dir, f)));

/**
 * Copy the editor to `target`. A non-empty target that is not an earlier copy is refused.
 * @param {string} target
 * @param {{ languages?: string[], origins?: string[] }} [options]
 */
export function copyEditor(target, options) {
  const { languages, origins } = check(options);
  if (existsSync(target) && readdirSync(target).length) {
    if (!isEditor(target)) throw new Error(`${target} is not empty and holds no earlier EdenText copy; refusing to overwrite it`);
    rmSync(target, { recursive: true });
  }
  const keep = keeper(languages);
  cpSync(EDITOR, target, { recursive: true, filter: (src) => keep(relative(EDITOR, src)) });
  writeFileSync(join(target, 'embed.config.json'), configText(origins));
  return { languages: languages ?? LANGUAGES, origins };
}
