// Regenerates public/thesaurus/<code>/ from LibreOffice's own MyThes data: one
// synonym group per line, ';'-separated, usage notes like "(ugs.)" dropped.
// MyThes repeats every group once per member — 10x the bytes for the same content.
import { mkdir, writeFile } from 'node:fs/promises';

const REPO = 'https://raw.githubusercontent.com/LibreOffice/dictionaries/master';
const SOURCES = [
  { code: 'de', dat: 'de/th_de_DE_v2.dat', license: 'de/README_thesaurus.txt' },
  { code: 'en', dat: 'en/th_en_US_v2.dat', license: 'en/WordNet_license.txt' },
  { code: 'es', dat: 'es/th_es_v2.dat', license: 'es/README_th_es.txt' },
  { code: 'fr', dat: 'fr_FR/dictionaries/thes_fr.dat', license: 'fr_FR/dictionaries/README_thes_fr.txt' },
  { code: 'it', dat: 'it_IT/th_it_IT_v2.dat', license: 'it_IT/README_th_it_IT.txt' },
  { code: 'pt', dat: 'pt_PT/th_pt_PT.dat', license: 'pt_PT/README_th_pt_PT.txt' },
  { code: 'ru', dat: 'ru_RU/th_ru_RU_M_aot_and_v2.dat', license: 'ru_RU/README_thes_ru_RU_M_aot_and_v2.txt' },
  { code: 'uk', dat: 'uk_UA/th_uk_UA.dat', license: 'uk_UA/README_th_uk_UA.txt' },
  { code: 'id', dat: 'id/th_id_ID_v2.dat', license: 'id/README-thes' },
  { code: 'ar', dat: 'ar/th_ar.dat', license: 'ar/COPYING.txt' },
  { code: 'pl', dat: 'pl_PL/th_pl_PL_v2.dat', license: 'pl_PL/README_en.txt' },
];

// "(noun)", "(ugs.)", "(generic term)" — a label to read, not a word to insert. Arabic
// vowel marks go too: running text is written without them, and so is the word looked up.
const clean = (word) => word.replace(/\([^)]*\)/g, ' ').replace(/[\u064B-\u0652\u0670]/g, '').replace(/\s+/g, ' ').trim();

// An antonym, as a sense line's tag (id "[ant]", ru) or a word's label (en, es): not a synonym.
const ANTONYM = /\((antonym|антоним|ant[oó]nimo)\)|^\[ant\]/i;

// MyThes: a "headword|senseCount" line, then that many "(pos)|syn|syn|…" lines. Most
// sources leave the headword out of its own senses, so it leads the group here; the
// same members under another headword are one group.
function groups(dat) {
  const lines = dat.split('\n');
  const out = new Map();
  for (let i = 1; i < lines.length; i++) {
    const head = lines[i].split('|');
    const senses = Number(head.at(-1));
    if (head.length < 2 || !Number.isInteger(senses) || senses < 1) continue;
    const headword = clean(head[0]);
    for (let s = 0; s < senses; s++) {
      const [tag, ...fields] = (lines[++i] ?? '').split('|');
      if (ANTONYM.test(tag)) continue;
      const words = [...new Set(fields.filter((w) => !ANTONYM.test(w)).map(clean).filter(Boolean))];
      if (headword && !words.some((w) => w.toLowerCase() === headword.toLowerCase())) words.unshift(headword);
      const key = words.map((w) => w.toLowerCase()).sort().join(';');
      if (words.length > 1 && !out.has(key)) out.set(key, words.join(';'));
    }
  }
  return [...out.values()].sort();
}

const bytes = async (path) => {
  const res = await fetch(`${REPO}/${path}`);
  if (!res.ok) throw new Error(`${res.status} for ${path}`);
  return new Uint8Array(await res.arrayBuffer());
};

const text = async (path) => new TextDecoder().decode(await bytes(path));

// MyThes names its charset on the first line — es ships ISO8859-1, the rest UTF-8.
// Decoding that line as UTF-8 drops ru's byte-order mark; the name itself is ASCII.
const datText = async (path) => {
  const buf = await bytes(path);
  const charset = new TextDecoder('utf-8').decode(buf.subarray(0, 20)).split('\n')[0].trim();
  return new TextDecoder(charset).decode(buf);
};

for (const source of SOURCES) {
  const [dat, license] = await Promise.all([datText(source.dat), text(source.license)]);
  const dir = new URL(`../public/thesaurus/${source.code}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const lines = groups(dat);
  await writeFile(new URL(`${source.code}.txt`, dir), lines.join('\n') + '\n');
  await writeFile(new URL('LICENSE', dir), license);
  console.log(`${source.code}: ${lines.length} groups`);
}
