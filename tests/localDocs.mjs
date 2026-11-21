// Real-world documents that may not be committed live in one folder beside the main
// checkout, which every worktree finds; EDENTEXT_TESTDOCS names another. Their names and
// what a run records about them stay in that folder, never in the repository.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const beside = () => {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return join(dirname(resolve(ROOT, common)), '..', 'edentext-testdocs');
  } catch { return join(ROOT, '..', 'edentext-testdocs'); }
};
export const LOCAL_DOCS = resolve(process.env.EDENTEXT_TESTDOCS ?? beside());

export const localDocs = () => (existsSync(LOCAL_DOCS)
  ? readdirSync(LOCAL_DOCS).filter((f) => /\.(odt|docx)$/i.test(f) && !f.startsWith('~$')).sort().map((f) => join(LOCAL_DOCS, f))
  : []);

// The cheapest documents that between them still show every trait any of them has: each
// pick is the one bringing the most uncovered traits for its load time.
export function coreSet(entries) {
  const left = new Set(entries.flatMap((e) => e.traits));
  const pool = [...entries];
  const picked = [];
  while (left.size && pool.length) {
    const gain = (e) => e.traits.filter((t) => left.has(t)).length / Math.max(e.ms, 500);
    pool.sort((a, b) => gain(b) - gain(a) || a.name.localeCompare(b.name));
    const best = pool.shift();
    const adds = best.traits.filter((t) => left.has(t));
    if (!adds.length) break;
    adds.forEach((t) => left.delete(t));
    picked.push({ ...best, adds });
  }
  return picked;
}
