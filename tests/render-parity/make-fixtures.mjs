// Authors the baseline .docx corpus with the `docx` lib directly (not via
// src/lib/export/docx.ts, so the corpus doesn't test our exporter against itself).
// It is committed (tests/corpus/) and CI reads it; real-world files stay local,
// in render-parity/fixtures/.
import { writeFileSync, mkdirSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LevelFormat,
  Table, TableRow, TableCell, WidthType, convertMillimetersToTwip,
  Header, Footer, PageNumber, TabStopType, PageOrientation,
  FootnoteReferenceRun, ImageRun, ExternalHyperlink, UnderlineType,
  Math as DocxMath, MathRun, MathFraction, MathRadical, TableOfContents,
} from 'docx';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'corpus');
mkdirSync(OUT, { recursive: true });

// An optional regex argument regenerates matching files only (and converts only
// their ODT twins), so extending the corpus leaves the committed rest untouched.
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const written = [];

const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

const page = { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } }; // 2cm
const para = (text, o = {}) => new Paragraph({ children: [new TextRun({ text, ...o.run })], ...o.p });

// Spacing, font and outline level are declared: LibreOffice fills a built-in style's
// gaps from its own defaults where Word uses only what the file declares, and without
// the level it converts a heading to a <text:p> merely carrying the heading's style.
const heading = (id, name, halfPt, before, after, level, numbering) => ({
  id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true,
  run: { font: 'Arial', size: halfPt, bold: true },
  paragraph: { spacing: { before, after }, outlineLevel: level, ...(numbering ? { numbering } : {}) },
});

// `chapters` names a numbering the heading styles carry: chapter numbering lives on the
// style in both products, never on the paragraph. `extra.styles` adds the document's own
// styles beside the built-ins rather than replacing the whole block.
async function write(name, sections, defaultRun = { font: 'Times New Roman', size: 24 }, extra = {}, chapters = null) {
  if (only && !only.test(name)) return;
  const { styles: ownStyles, ...rest } = extra;
  const h1 = heading('Heading1', 'Heading 1', 36, 240, 120, 0, chapters && { reference: chapters, level: 0 });
  const h2 = heading('Heading2', 'Heading 2', 32, 200, 100, 1, chapters && { reference: chapters, level: 1 });
  // The package writes its own Heading1-6 regardless, so a second definition under the
  // same id leaves two — and LibreOffice reads the first, dropping everything declared
  // here. A numbered heading therefore rides the factory slot instead (see FACTORY_SLOTS
  // in src/lib/export/CLAUDE.md); the plain fixtures keep the shape they were built with.
  const doc = new Document({
    styles: {
      default: { document: { run: defaultRun }, ...(chapters ? { heading1: h1, heading2: h2 } : {}) },
      paragraphStyles: [
        // Word always writes an explicit Normal; the docx lib would emit docDefaults only.
        { id: 'Normal', name: 'Normal', run: defaultRun, paragraph: { spacing: { after: 0 } } },
        ...(chapters ? [] : [h1, h2]),
        ...(ownStyles?.paragraphStyles ?? []),
      ],
    },
    ...rest,
    sections,
  });
  writeFileSync(join(OUT, name), await Packer.toBuffer(doc));
  written.push(name);
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

// 11. Run formatting beyond bold/italic, plus a link — the marks the import maps.
await write('11-marks.docx', [{
  properties: { page },
  children: [
    new Paragraph({ children: [
      new TextRun({ text: 'underlined ', underline: { type: UnderlineType.SINGLE } }),
      new TextRun({ text: 'struck ', strike: true }),
      new TextRun({ text: 'highlighted ', highlight: 'yellow' }),
      new TextRun({ text: 'colored ', color: 'C00000' }),
      new TextRun({ text: 'super', superScript: true }),
      new TextRun({ text: ' and ' }),
      new TextRun({ text: 'sub', subScript: true }),
    ] }),
    new Paragraph({ children: [
      new TextRun('A '),
      new ExternalHyperlink({ link: 'https://example.org/', children: [
        new TextRun({ text: 'link to example.org', style: 'Hyperlink' }),
      ] }),
      new TextRun(' in running text.'),
    ] }),
    para(LOREM),
  ],
}]);

// 12. Footnotes: two anchors in flowing text, each with its own body.
await write('12-notes.docx', [{
  properties: { page },
  children: [
    new Paragraph({ children: [
      new TextRun('A claim'), new FootnoteReferenceRun(1),
      new TextRun(' and another'), new FootnoteReferenceRun(2),
      new TextRun(' in one paragraph.'),
    ] }),
    para(LOREM),
  ],
}], undefined, {
  footnotes: {
    1: { children: [para('The first footnote body.')] },
    2: { children: [para('The second footnote body.')] },
  },
});

// 13. Images: an inline picture in the line, sized in EMU by the lib.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC',
  'base64');
await write('13-images.docx', [{
  properties: { page },
  children: [
    new Paragraph({ children: [
      new TextRun('Before '),
      new ImageRun({ type: 'png', data: PNG, transformation: { width: 96, height: 48 } }),
      new TextRun(' after.'),
    ] }),
    para(LOREM),
  ],
}]);

// 14. OMML formulas: one inline in the sentence, one alone on its line.
// numerator/denominator take the runs directly — the lib mints m:num/m:den itself,
// and a hand-wrapped MathNumerator doubles the element, which Word refuses to open.
const frac = () => new MathFraction({
  numerator: [new MathRun('a')],
  denominator: [new MathRun('b')],
});
await write('14-formulas.docx', [{
  properties: { page },
  children: [
    new Paragraph({ children: [
      new TextRun('Inline '),
      new DocxMath({ children: [frac()] }),
      new TextRun(' in the sentence.'),
    ] }),
    new Paragraph({ children: [new DocxMath({ children: [
      new MathRadical({ children: [new MathRun('x')], degree: [new MathRun('3')] }), new MathRun('+1'),
    ] })] }),
    para(LOREM),
  ],
}]);

// 15. Chapter numbering on the heading styles, plus heading styles of the document's
// own ("Appendix 1"/"2", named nothing like "Heading n"). Both live in the stylesheet
// and nowhere in the document tree, so only a leg carrying it exercises them.
await write('15-chapters.docx', [{
  properties: { page },
  children: [
    para('Introduction', { p: { style: 'Heading1', pageBreakBefore: true } }),
    para(LOREM),
    para('Motivation', { p: { style: 'Heading2' } }),
    para(LOREM),
    para('Results', { p: { style: 'Heading1', pageBreakBefore: true } }),
    para(LOREM),
    para('Method', { p: { style: 'Heading2' } }),
    para(LOREM),
    para('Appendix', { p: { style: 'Appendix1', pageBreakBefore: true } }),
    para(LOREM),
    para('List of Tables', { p: { style: 'Appendix2' } }),
    para(LOREM),
  ],
}], undefined, {
  styles: {
    paragraphStyles: [
      { id: 'Appendix1', name: 'Appendix 1', basedOn: 'Heading1', next: 'Normal', quickFormat: true,
        paragraph: { outlineLevel: 0 } },
      { id: 'Appendix2', name: 'Appendix 2', basedOn: 'Heading2', next: 'Normal', quickFormat: true,
        paragraph: { outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'chapter-numbering',
      levels: [
        // The level names the style it numbers and the style points back at the level:
        // both halves, or LibreOffice reads the pair as an ordinary list.
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 0, hanging: 360 } }, style: 'Heading1' } },
        { level: 1, format: LevelFormat.DECIMAL, text: '%1.%2', alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 0, hanging: 432 } }, style: 'Heading2' } },
      ],
    }],
  },
}, 'chapter-numbering');

// 16. All six header/footer zones at once: a title page of its own and separate even
// pages, both riding on a running zone. Four pages, so each variant renders at least once.
await write('16-hf-variants.docx', [{
  properties: { page, titlePage: true },
  headers: {
    default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun('Odd Header')] })] }),
    first: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Title Page Header')] })] }),
    even: new Header({ children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun('Even Header')] })] }),
  },
  footers: {
    default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT,
      children: [new TextRun({ children: ['Odd page ', PageNumber.CURRENT] })] })] }),
    first: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('Title Page Footer')] })] }),
    even: new Footer({ children: [new Paragraph({ alignment: AlignmentType.LEFT,
      children: [new TextRun({ children: ['Even page ', PageNumber.CURRENT] })] })] }),
  },
  children: Array.from({ length: 40 }, (_, i) => para(`${i + 1}. ${LOREM}`)),
}], undefined, { evenAndOddHeaderAndFooters: true });

// 17. Sections on different paper: a landscape one between two portrait ones. .paper
// reserves the widest section's sheet, so each portrait page is centred in a sheet wider
// than itself — and every block kind (heading, body, list, table) has to sit on the page
// it belongs to rather than at that sheet's edge.
const row = (n, cols) => new TableRow({ children: Array.from({ length: cols }, (_, i) => cell(`R${n}C${i + 1}`)) });
const grid = (cols) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [row(1, cols), row(2, cols), row(3, cols)],
});
const bullet = (text) => para(text, { p: { numbering: { reference: 'section-bullets', level: 0 } } });
await write('17-sections.docx', [
  {
    properties: { page },
    children: [para('Portrait first', { p: { style: 'Heading1' } }), para(LOREM),
      bullet('first point'), bullet('second point'), para(LOREM)],
  },
  {
    properties: { page: { ...page, size: { orientation: PageOrientation.LANDSCAPE } } },
    children: [para('Landscape middle', { p: { style: 'Heading1' } }), para(LOREM), grid(6)],
  },
  {
    properties: { page },
    children: [para('Portrait last', { p: { style: 'Heading2' } }), para(LOREM), grid(3)],
  },
], undefined, {
  numbering: { config: [{ reference: 'section-bullets', levels: [
    { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 360, hanging: 360 } } } },
  ] }] },
});

// 18. Sections that open with a table, which only a paragraph could do before: the
// marker and the page break in front of it ride the table itself. Section 2 also
// changes the paper, so a dropped marker draws it on the section before it.
await write('18-table-sections.docx', [
  {
    properties: { page },
    children: [para('Before the tables', { p: { style: 'Heading1' } }), para(LOREM)],
  },
  {
    properties: { page: { ...page, size: { orientation: PageOrientation.LANDSCAPE } } },
    children: [grid(6), para(LOREM)],
  },
  {
    properties: { page },
    children: [grid(3), para(LOREM), para('After the tables', { p: { style: 'Heading2' } })],
  },
]);

// 19. A section that opens with a generated index, the other block kind a document
// starts a chapter with. Section 2 is landscape, so a dropped marker shows at once.
await write('19-index-sections.docx', [
  {
    properties: { page },
    children: [para('Chapter One', { p: { style: 'Heading1' } }), para(LOREM),
      para('Chapter Two', { p: { style: 'Heading1' } }), para(LOREM)],
  },
  {
    properties: { page: { ...page, size: { orientation: PageOrientation.LANDSCAPE } } },
    children: [new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }), para(LOREM)],
  },
  {
    properties: { page },
    children: [para('Chapter Three', { p: { style: 'Heading1' } }), para(LOREM)],
  },
], undefined, { features: { updateFields: true } });

// 20. A section whose footer reaches above its own bottom margin, where the document's
// first section has no footer at all: its text area ends higher than the document's, and
// the index crossing the page break inside it is what has to respect that.
await write('20-index-footer.docx', [
  {
    properties: { page },
    children: Array.from({ length: 60 }, (_, i) => [
      para(`Chapter ${i + 1}`, { p: { style: 'Heading1' } }), para('Opening note for the chapter.'),
    ]).flat(),
  },
  {
    // The footer's own edge distance is the page margin, so its three lines stand in the
    // text area — both word processors end the body above them.
    properties: { page: { margin: { ...page.margin, footer: 1134 } } },
    footers: { default: new Footer({ children: [
      para('Annual report'), para('Financial year'),
      new Paragraph({ children: [new TextRun({ children: ['Page ', PageNumber.CURRENT] })] }),
    ] }) },
    children: [new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }), para(LOREM)],
  },
], undefined, { features: { updateFields: true } });

// 21. Spacing above single with space above: a paragraph split across a page break
// carries lines that must start at the next page's text area, and one moved whole
// loses its space above there — neither may ride up into the top margin.
await write('21-spacing-split.docx', [{
  properties: { page },
  children: Array.from({ length: 30 }, (_, i) => [
    para(`Section ${i + 1}`, { run: { bold: true }, p: { spacing: { before: 200 }, keepNext: true } }),
    para(new Array(1 + (i % 3)).fill(LOREM).join(' '), { p: { spacing: { before: 200, line: 360 } } }),
  ]).flat(),
}]);

// 22. Frames in a header and a footer, in the shapes that have no x of their own: set
// against an edge or the middle of the margins beside an aligned or tabbed paragraph,
// one above its anchor, and a paragraph ending in line breaks under it.
const hfPic = (width, x, type, y = 0) => new ImageRun({ type: 'png', data: PNG, transformation: { width, height: 30 },
  floating: { horizontalPosition: { relative: 'margin', align: x }, verticalPosition: { relative: 'paragraph', offset: y },
    wrap: { type, side: 'bothSides' }, allowOverlap: true } });
await write('22-hf-frames.docx', [{
  properties: { page },
  headers: { default: new Header({ children: [
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [hfPic(60, 'left', 2, -57150), new TextRun('Running head')] }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
      children: [new TextRun({ children: ['\t'] }), new TextRun({ break: 1 }), new TextRun({ break: 1 })] }),
  ] }) },
  footers: { default: new Footer({ children: [
    new Paragraph({ alignment: AlignmentType.CENTER, tabStops: [{ type: TabStopType.RIGHT, position: 9638 }],
      children: [new TextRun('Left'), hfPic(40, 'right', 1), hfPic(50, 'center', 3), new TextRun({ children: ['\tPage ', PageNumber.CURRENT] })] }),
  ] }) },
  children: Array.from({ length: 14 }, (_, i) => para(`${i + 1}. ${LOREM}`)),
}]);

// 23. A table under a heading whose rows each hold a formula alone in its cell: a
// formula owning its paragraph makes one line, so the row is as tall as a text row.
const formulaRow = (i) => new TableRow({ children: [
  new TableCell({ children: [para(`Row ${i + 1}`)] }),
  new TableCell({ children: [new Paragraph({ children: [new DocxMath({ children: [
    new MathRun(`${i + 1}x`),
  ] })] })] }),
] });
await write('23-formula-rows.docx', [{
  properties: { page },
  children: [
    para(LOREM),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Formulas')] }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: Array.from({ length: 70 }, (_, i) => formulaRow(i)) }),
    para(LOREM),
  ],
}]);

// ODT twins, written by LibreOffice itself — the dominant ODT producer, so they carry
// its own conventions (percentage font sizes, Text Body, list styles) and exercise the
// foreign-document path our own exporter never produces.
const docxFiles = written;
// Its own profile, in a temp dir: LibreOffice writes a whole user installation into
// it, and this one's parent is committed.
const profile = mkdtempSync(join(tmpdir(), 'corpus-lo-'));
try {
  execFileSync('soffice', [
    '--headless', '--norestore', `-env:UserInstallation=file://${profile}`,
    '--convert-to', 'odt', '--outdir', OUT, ...docxFiles.map((f) => join(OUT, f)),
  ], { stdio: 'pipe', timeout: 300_000 });
  console.log(`converted ${docxFiles.length} ODT twins`);
} catch {
  console.log('soffice missing — skipped the ODT twins');
} finally {
  rmSync(profile, { recursive: true, force: true });
}
