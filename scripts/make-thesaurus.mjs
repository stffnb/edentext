// Regenerates public/thesaurus/<code>/ from LibreOffice's own MyThes data: one
// synonym group per line, ';'-separated, usage notes like "(ugs.)" dropped.
// MyThes repeats every group once per member — 10x the bytes for the same content.
import { mkdir, writeFile } from 'node:fs/promises';

const REPO = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master';
const SOURCES = [
  { code: 'de', dat: 'de/th_de_DE_v2.dat', license: 'de/README_thesaurus.txt' },
  { code: 'en', dat: 'en/th_en_US_v2.dat', license: 'en/WordNet_license.txt' },
];

// "(noun)", "(ugs.)", "(generic term)" — a label to read, not a word to insert.
const clean = (word) => word.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

// MyThes: a "headword|senseCount" line, then that many "(pos)|syn|syn|…" lines.
function groups(dat) {
  const lines = dat.split('\n');
  const out = new Set();
  for (let i = 1; i < lines.length; i++) {
    const head = lines[i].split('|');
    const senses = Number(head.at(-1));
    if (head.length < 2 || !Number.isInteger(senses) || senses < 1) continue;
    for (let s = 0; s < senses; s++) {
      const words = [...new Set((lines[++i] ?? '').split('|').slice(1).map(clean).filter(Boolean))];
      if (words.length > 1) out.add(words.join(';'));
    }
  }
  return [...out].sort();
}

const text = async (path) => {
  const res = await fetch(`${REPO}/${path}`);
  if (!res.ok) throw new Error(`${res.status} for ${path}`);
  return res.text();
};

for (const source of SOURCES) {
  const [dat, license] = await Promise.all([text(source.dat), text(source.license)]);
  const dir = new URL(`../public/thesaurus/${source.code}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const lines = groups(dat);
  await writeFile(new URL(`${source.code}.txt`, dir), lines.join('\n') + '\n');
  await writeFile(new URL('LICENSE', dir), license);
  console.log(`${source.code}: ${lines.length} groups`);
}
