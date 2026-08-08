// Authors the baseline .docx corpus with the `docx` lib directly (not via
// src/lib/export/docx.ts, so the fixtures don't test our exporter against itself).
// Drop real-world files into fixtures/ alongside them.
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
  Table, TableRow, TableCell, WidthType, convertMillimetersToTwip,
  Header, Footer, PageNumber, TabStopType,
} from 'docx';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
mkdirSync(OUT, { recursive: true });

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

const page = { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } }; // 2cm
const para = (text, o = {}) => new Paragraph({ children: [new TextRun({ text, ...o.run })], ...o.p });

// Heading styles declare spacing and font explicitly: LibreOffice fills the gaps of
// a built-in style it knows by name from its own defaults, where Word uses only what
// the file declares — an omitted property makes the reference disagree with Word.
const heading = (id, name, halfPt, before, after) => ({
  id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
  run: { font: 'Arial', size: halfPt, bold: true },
  paragraph: { spacing: { before, after } },
});

async function write(name, sections, defaultRun = { font: 'Times New Roman', size: 24 }, extra = {}) {
  const doc = new Document({
    styles: {
      default: { document: { run: defaultRun } },
      paragraphStyles: [
        // Word always writes an explicit Normal; the docx lib would emit docDefaults only.
        { id: 'Normal', name: 'Normal', run: defaultRun, paragraph: { spacing: { after: 0 } } },
        heading('Heading1', 'Heading 1', 36, 240, 120),
        heading('Heading2', 'Heading 2', 32, 200, 100),
      ],
    },
    ...extra,
    sections,
  });
  writeFileSync(join(OUT, name), await Packer.toBuffer(doc));
  console.log('wrote', name);
}

// 1. Line breaking + pagination over three pages of plain body text.
await write('01-flow.docx', [{
  properties: { page },
  children: Array.from({ length: 24 }, (_, i) => para(`${i + 1}. ${LOREM}`)),
}]);

// 2. Headings, alignment, indents, spacing.
await write('02-blocks.docx', [{
  properties: { page },
  children: [
    para('Document Title', { p: { heading: HeadingLevel.HEADING_1 } }),
    para(LOREM),
    para('Section', { p: { heading: HeadingLevel.HEADING_2 } }),
    para(LOREM, { p: { alignment: AlignmentType.JUSTIFIED } }),
    para(LOREM, { p: { indent: { left: convertMillimetersToTwip(20) } } }),
    para(LOREM, { p: { spacing: { before: 240, after: 240 } } }),
    para('Centred line', { p: { alignment: AlignmentType.CENTER } }),
    para('Right line', { p: { alignment: AlignmentType.RIGHT } }),
  ],
}]);

// 3. Mixed fonts and sizes — catches metric/substitution drift first.
await write('03-fonts.docx', [{
  properties: { page },
  children: [
    para(LOREM, { run: { font: 'Times New Roman', size: 24 } }),
    para(LOREM, { run: { font: 'Arial', size: 22 } }),
    para(LOREM, { run: { font: 'Calibri', size: 22 } }),
    para(LOREM, { run: { font: 'Courier New', size: 20 } }),
    para(LOREM, { run: { font: 'Times New Roman', size: 36 } }),
    para(LOREM, { run: { font: 'Times New Roman', size: 24, bold: true } }),
    para(LOREM, { run: { font: 'Times New Roman', size: 24, italics: true } }),
  ],
}]);

// 5. Page-break edge cases: a paragraph taller than a page slot (widow-orphan
// control is unsatisfiable there), and short paragraphs walking the boundary.
await write('05-breaks.docx', [{
  properties: { page },
  children: [
    ...Array.from({ length: 12 }, (_, i) => para(`${i + 1}. ${LOREM}`)),
    para(new Array(14).fill(LOREM).join(' ')),   // ~40 lines, taller than one page
    para('one'), para('two'), para('three'),
    ...Array.from({ length: 6 }, (_, i) => para(`${i + 1}. ${LOREM}`)),
  ],
}]);

// 6. Word's own default body font. Carlito's natural line height is not Liberation
// Serif's, so a wrong single-spacing ratio shows up as drift over the page.
await write('06-calibri.docx', [{
  properties: { page },
  children: Array.from({ length: 20 }, (_, i) =>
    para(`${i + 1}. ${LOREM}`, { run: { font: 'Calibri', size: 22 } })),
}], { font: 'Calibri', size: 22 });

// 7. The same flow with widow-orphan control off: LibreOffice then fills the page to
// the last line, so the editor must stop guarding page breaks too.
await write('07-nowidow.docx', [{
  properties: { page },
  children: Array.from({ length: 24 }, (_, i) =>
    new Paragraph({ widowControl: false, children: [new TextRun(`${i + 1}. ${LOREM}`)] })),
}]);

// 8. Lists: three bullet levels, three numbered levels, and numbering continued
// across an intervening paragraph. Level indents drive the text column, so they
// show up as position differences.
const NUM_REF = 'nums';
const listLevels = (format) => [0, 1, 2].map((level) => ({
  level, format, text: format === LevelFormat.BULLET ? '•' : `%${level + 1}.`,
  alignment: AlignmentType.LEFT,
  style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
}));
const li = (text, level, reference) =>
  new Paragraph({ numbering: { reference, level }, children: [new TextRun(text)] });

await write('08-lists.docx', [{
  properties: { page },
  children: [
    para('Bullets'),
    li('first bullet', 0, 'bullets'), li('nested bullet', 1, 'bullets'),
    li('deeper bullet', 2, 'bullets'), li('back to first', 0, 'bullets'),
    para('Numbers'),
    li('one', 0, NUM_REF), li('one point one', 1, NUM_REF),
    li('one point one point one', 2, NUM_REF), li('two', 0, NUM_REF),
    para('An interrupting paragraph.'),
    li('three continues the numbering', 0, NUM_REF),
    li(`a long item that has to wrap: ${LOREM}`, 0, NUM_REF),
  ],
}], undefined, {
  numbering: { config: [
    { reference: 'bullets', levels: listLevels(LevelFormat.BULLET) },
    { reference: NUM_REF, levels: listLevels(LevelFormat.DECIMAL) },
  ] },
});

// 9. Header and footer with a page-number field, repeated over three pages. Both
// engines place them from the page edge, so a wrong zone distance shifts them.
await write('09-headerfooter.docx', [{
  properties: { page },
  headers: { default: new Header({ children: [
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Parity Report')] }),
  ] }) },
  footers: { default: new Footer({ children: [
    new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES] })] }),
  ] }) },
  children: Array.from({ length: 30 }, (_, i) => para(`${i + 1}. ${LOREM}`)),
}]);

// 10. Tab stops: left, centre, right and decimal, plus a hanging indent. Tabs place
// text at absolute positions, so a wrong default tab width is immediately visible.
await write('10-tabs.docx', [{
  properties: { page },
  children: [
    para('Default tabs follow:'),
    new Paragraph({ children: [new TextRun('a\tb\tc\td')] }),
    new Paragraph({
      tabStops: [
        { type: TabStopType.CENTER, position: convertMillimetersToTwip(60) },
        { type: TabStopType.RIGHT, position: convertMillimetersToTwip(120) },
        { type: TabStopType.DECIMAL, position: convertMillimetersToTwip(160) },
      ],
      children: [new TextRun('left\tcentred\tright\t12.34')],
    }),
    new Paragraph({
      indent: { left: convertMillimetersToTwip(25), hanging: convertMillimetersToTwip(25) },
      children: [new TextRun(`Term\t${LOREM}`)],
    }),
  ],
}]);

// 4. Table geometry: column widths, spans, a long cell that wraps.
const cell = (text, o = {}) => new TableCell({ children: [para(text)], ...o });
await write('04-table.docx', [{
  properties: { page },
  children: [
    para('Before the table'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [cell('Header A'), cell('Header B'), cell('Header C')] }),
        new TableRow({ children: [cell(LOREM), cell('short'), cell('short')] }),
        new TableRow({ children: [cell('spans two', { columnSpan: 2 }), cell('C3')] }),
      ],
    }),
    para('After the table'),
  ],
}]);

// ODT twins, written by LibreOffice itself — the dominant ODT producer, so they carry
// its own conventions (percentage font sizes, Text Body, list styles) and exercise the
// foreign-document path our own exporter never produces.
const docxFiles = readdirSync(OUT).filter((f) => f.endsWith('.docx'));
try {
  execFileSync('soffice', [
    '--headless', '--norestore', `-env:UserInstallation=file://${OUT}/.loprofile`,
    '--convert-to', 'odt', '--outdir', OUT, ...docxFiles.map((f) => join(OUT, f)),
  ], { stdio: 'pipe', timeout: 300_000 });
  console.log(`converted ${docxFiles.length} ODT twins`);
} catch {
  console.log('soffice missing — skipped the ODT twins');
}
