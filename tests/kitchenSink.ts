// One deterministic document using every authorable feature, in labeled sections —
// the fixture behind the schema-validation leg and the manual Word/LO smoke files.
import {
  DEFAULT_TABLE_LOOK, builtinTableStyles, resolveTableCell, tableLookAttr,
} from '../src/lib/styles/tableStyles';
import { builtinStyleSheet, type StyleSheet } from '../src/lib/styles/styleSheet';
import type { HfExport } from '../src/lib/export/odt';
import { DEFAULT_NOTE_SETTINGS, type NoteSettings } from '../src/lib/storage/noteSettings';
import type { DocProperties } from '../src/lib/storage/docProperties';
import type { PageNumbering } from '../src/lib/storage/pageNumbering';
import type { PageDecor } from '../src/lib/storage/pageDecor';
import type { LineNumbering } from '../src/lib/storage/lineNumbering';

type N = any;

// A tiny PNG with correct CRCs — this file is also opened by real word processors.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNwaDgAAAKEAYEml6crAAAAAElFTkSuQmCC';

const t = (text: string, ...marks: N[]): N =>
  ({ type: 'text', text, ...(marks.length ? { marks } : {}) });
const p = (content: N[], attrs?: N): N =>
  ({ type: 'paragraph', ...(attrs ? { attrs } : {}), content });
const h = (level: number, text: string): N =>
  ({ type: 'heading', attrs: { level }, content: [t(text)] });
const li = (...c: N[]): N => ({ type: 'listItem', content: c });

function styledTable(): N {
  const name = 'Box List Blue';
  const style = builtinTableStyles()[name];
  const look = { ...DEFAULT_TABLE_LOOK, ...(style.look ?? {}) };
  const cols = 2, nRows = 3;
  const rows = Array.from({ length: nRows }, (_, ri) => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, (_, ci) => {
      const paint = resolveTableCell(style, { row: ri, col: ci, rows: nRows, cols }, look);
      const attrs: N = { colspan: 1, rowspan: 1, colwidth: null };
      if (paint.fill) attrs.backgroundColor = paint.fill;
      for (const [k, v] of Object.entries(paint.borders)) if (v !== null) attrs[k] = v;
      if (paint.regions.length) attrs.region = paint.regions.join(' ');
      return { type: 'tableCell', attrs,
        content: [p([t(`Zelle ${ri + 1}.${ci + 1}`)])] };
    }),
  }));
  return { type: 'table', attrs: { tableStyle: name, tableLook: tableLookAttr(look) }, content: rows };
}

export function kitchenSinkDoc(): N {
  return { type: 'doc', content: [
    p([t('Alle Funktionen')], { styleName: 'Title' }),
    p([t('Das Grenzdokument')], { styleName: 'Subtitle' }),

    h(1, 'Zeichenformatierung'),
    p([
      t('fett', { type: 'bold' }), t(' '),
      t('kursiv', { type: 'italic' }), t(' '),
      t('unterstrichen', { type: 'underline' }), t(' '),
      t('doppelt', { type: 'underline', attrs: { lineStyle: 'double', lineColor: '#FF0000' } }), t(' '),
      t('gestrichen', { type: 'strike' }), t(' '),
      t('hoch', { type: 'superscript' }), t('tief', { type: 'subscript' }), t(' '),
      t('markiert', { type: 'highlight', attrs: { color: '#FFFF00' } }), t(' '),
      t('farbig', { type: 'textStyle', attrs: { color: '#C00000' } }), t(' '),
      t('Arial 14', { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '14pt' } }), t(' '),
      t('Kapitälchen', { type: 'textStyle', attrs: { caps: 'smallCaps' } }), t(' '),
      t('versal', { type: 'textStyle', attrs: { caps: 'uppercase' } }), t(' '),
      t('gehoben', { type: 'textStyle', attrs: { textPosition: 3 } }), t(' '),
      t('betont', { type: 'charStyle', attrs: { name: 'Emphasis' } }), t(' '),
      t('Quelltext', { type: 'charStyle', attrs: { name: 'Source Text' } }), t(' '),
      t('Link', { type: 'link', attrs: { href: 'https://example.com/x?a=1&b=2' } }),
    ]),

    h(1, 'Absatzformatierung'),
    p([t('zentriert, anderthalbzeilig')], { textAlign: 'center', lineHeight: '1.5' }),
    p([t('Blocksatz mit Einzügen und Abständen')],
      { textAlign: 'justify', indent: 1.25, indentFirst: -0.75, indentRight: 1.5, spaceBefore: 6, spaceAfter: 12 }),
    p([t('Absatzbox mit Schattierung und Linien')],
      { backgroundColor: '#CCFFFF', borderBottom: '2pt solid #FF0000', borderTop: '1pt solid #00B050' }),
    p([t('Tabulatoren'), { type: 'hardBreak' }, t('mit\tFüllzeichen\tund harter Zeile')],
      { tabStops: '3c.;9r_' }),
    p([t('Zusammenhalten, Zeilen halten, ohne Schusterjungen')],
      { keepNext: true, keepLines: true, widowControl: false }),
    p([t('نص من اليمين إلى اليسار')], { dir: 'rtl' }),
    p([t('Ein Zitat mit eigenem Einzug.')], { styleName: 'Quotations' }),
    p([t('Ein Merksatz im eigenen Stil.')], { styleName: 'Merksatz' }),

    h(1, 'Listen'),
    { type: 'bulletList', content: [
      li(p([t('Aufzählung Ebene 1')]),
        { type: 'bulletList', content: [
          li(p([t('Ebene 2')]),
            { type: 'bulletList', attrs: { bulletChar: '❖' }, content: [li(p([t('Ebene 3, eigenes Zeichen')]))] }),
        ] }),
      li(p([t('rot und groß', { type: 'textStyle', attrs: { color: '#FF0000', fontSize: '18pt' } })])),
    ] },
    p([]),
    { type: 'orderedList', attrs: { start: 3, listStyleType: 'upper-roman' }, content: [
      li(p([t('Nummerierung ab III')]),
        { type: 'orderedList', attrs: { listStyleType: 'lower-alpha-paren' }, content: [li(p([t('a) darunter')]))] }),
      li(p([t('weiter')])),
    ] },
    p([]),
    { type: 'orderedList', attrs: { listStyleName: 'Outline I.A.1' }, content: [
      li(p([t('Gliederung I.')]),
        { type: 'orderedList', content: [li(p([t('Gliederung A.')]),
          { type: 'orderedList', content: [li(p([t('Gliederung 1.')]))] })] }),
    ] },
    p([]),
    { type: 'orderedList', attrs: { listStyleName: 'Prüfliste' }, content: [
      li(p([t('eigene Listenvorlage')]), { type: 'bulletList', content: [li(p([t('Haken darunter')]))] }),
    ] },

    h(1, 'Tabellen'),
    { type: 'table', attrs: { marginLeft: 1.5, cellPadding: [0.1, 0.3, 0.1, 0.3] }, content: [
      { type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: null, backgroundColor: '#DDEEFF' },
          content: [p([t('verbunden über zwei Spalten')])] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 2, colwidth: null, verticalAlign: 'middle' },
          content: [p([t('über zwei Zeilen')])] },
      ] },
      { type: 'tableRow', attrs: { rowHeight: 64 }, content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, borderBottom: '2pt solid #FF0000' },
          content: [p([t('42')])] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, formula: 'A2*2', cellFormat: 'dec2' },
          content: [p([t('84')])] },
      ] },
    ] },
    p([]),
    styledTable(),

    h(1, 'Bilder'),
    p([{ type: 'image', attrs: { src: PNG, width: 96, height: 48, alt: 'inline' } },
      t(' im Lauftext, gedreht daneben: '),
      { type: 'image', attrs: { src: PNG, width: 48, height: 48, rotation: 90 } }]),
    p([{ type: 'image', attrs: { src: PNG, width: 144, height: 96, wrap: 'left', wrapOffset: 1.5, wrapDist: 0.5 } },
      t('Text umfließt das links gesetzte Bild.')]),
    p([{ type: 'image', attrs: { src: PNG, width: 144, height: 48, wrap: 'topBottom', wrapOffsetY: 1.5 } },
      t('Bild über dem Text.')]),

    h(1, 'Textrahmen und Formen'),
    { type: 'textBox', attrs: { width: 240, height: 96, fillColor: '#FFE0A0', strokeColor: '#0070C0', strokeWidthPt: 2 }, content: [
      p([t('Ein Rahmen mit Liste und Bild:')]),
      { type: 'bulletList', content: [li(p([t('Punkt im Rahmen')]))] },
      p([{ type: 'image', attrs: { src: PNG, width: 48, height: 24 } }]),
    ] },
    { type: 'textBox', attrs: { width: 192, height: 96, shapeKind: 'roundRect', fillColor: '#DDEEFF', wrap: 'right', wrapOffset: 1.5 }, content: [
      p([t('Form mit Text')]),
    ] },
    { type: 'textBox', attrs: { width: 96, height: 144, textVertical: true }, content: [
      p([t('senkrecht')]),
    ] },

    h(1, 'Formeln'),
    p([t('Inline: '), { type: 'formula', attrs: { latex: 'x^{2}+1', display: false } }, t(' im Satz.')]),
    p([{ type: 'formula', attrs: { latex: '\\frac{a}{b}+\\sqrt{x+1}', display: true } }]),

    h(1, 'Noten und Anmerkungen'),
    p([t('Eine Fußnote'), { type: 'noteRef', attrs: { id: 'f1', kind: 'footnote', text: '1' } },
      t(' und eine Endnote'), { type: 'noteRef', attrs: { id: 'e1', kind: 'endnote', text: 'i' } },
      t(' und ein Stern'), { type: 'noteRef', attrs: { id: 'f2', kind: 'footnote', text: '*' } }, t('.')]),
    p([t('kommentiert', { type: 'comment', attrs: { id: 'c1', author: 'Test Autor',
      date: '2026-03-04T05:06:07', text: 'Check & <this> "here"', resolved: false } }),
      t(' und erledigt', { type: 'comment', attrs: { id: 'c2', author: 'Test Autor',
        date: '2026-03-04T05:06:08', text: 'done', resolved: true } })]),
    p([t('eingefügt', { type: 'insertion', attrs: { id: 'rv1', author: 'Rev Autor', date: '2026-05-06T07:08:09' } }),
      t(' und '),
      t('gestrichen', { type: 'deletion', attrs: { id: 'rv2', author: 'Rev Autor', date: '2026-05-06T07:08:10' } })]),

    h(1, 'Verweise und Felder'),
    p([t('Ziel mit Lesezeichen', { type: 'bookmark', attrs: { name: 'ziel1' } })]),
    p([t('Siehe '), { type: 'crossRef', attrs: { name: 'ziel1', format: 'text', text: 'Ziel mit Lesezeichen' } },
      t(' auf Seite '), { type: 'crossRef', attrs: { name: 'ziel1', format: 'page', text: '1' } }, t('.')]),
    p([t('Abbildung '), { type: 'sequenceField', attrs: { category: 'figure', format: '1', number: 1 } },
      t(' und Tabelle '), { type: 'sequenceField', attrs: { category: 'table', format: 'a', number: 1 } }, t('.')]),
    p([t('Stichwort'), { type: 'indexEntry', attrs: { term: 'Größe & <term>', key1: 'Key "1"' } },
      t(' im Text, zitiert nach '),
      { type: 'bibliographyEntry', attrs: { identifier: 'src1', type: 'book',
        fields: { author: 'Knuth, Donald', title: 'Art & <of> "CS"', year: '1986' }, text: '' } }, t('.')]),
    p([t('Heute: '), { type: 'dateTimeField', attrs: { kind: 'date', format: 'dmy_dots', fixed: false, value: '2026-08-16T10:30:00' } },
      t(' um '), { type: 'dateTimeField', attrs: { kind: 'time', format: 'hm24', fixed: false, value: '2026-08-16T10:30:00' } }]),
    p([t('An '), { type: 'placeholderField', attrs: { text: 'Empfängername' } }, t(', '),
      { type: 'ruby', attrs: { base: '漢字', text: 'かんじ' } }]),
    { type: 'tableOfContents', attrs: { entries: [], title: '', index: 'toc',
      leader: '.', tabPosCm: null, maxLevel: 3 } },
    { type: 'tableOfContents', attrs: { entries: [], title: '', index: 'alphabetical',
      leader: '.', tabPosCm: null, maxLevel: 10 } },
    { type: 'tableOfContents', attrs: { entries: [], title: '', index: 'bibliography',
      leader: '.', tabPosCm: null, maxLevel: 10, citationStyle: 'apa' } },

    h(1, 'Layout'),
    { type: 'columns', attrs: { count: 2, gapCm: 1 }, content: [
      p([t('Erste Spalte mit etwas Text, der umbricht.')]),
      p([t('Und noch ein Absatz im Spaltensatz.')]),
    ] },
    p([t('Nach einem Seitenumbruch.')], { breakBefore: 'page' }),
    p([t('Nach einem Abschnittswechsel.')], { sectionBreak: true }),
    h(2, 'Unterkapitel'),
    h(3, 'Tiefer'),

    { type: 'noteSection', content: [
      { type: 'note', attrs: { id: 'f1', kind: 'footnote', label: null, text: '1' },
        content: [t('Der Fußnotentext.')] },
      { type: 'note', attrs: { id: 'f2', kind: 'footnote', label: '*', text: '*' },
        content: [t('Die Sternnote.')] },
      { type: 'note', attrs: { id: 'e1', kind: 'endnote', label: null, text: 'i' },
        content: [t('Der Endnotentext.')] },
    ] },
  ] };
}

// A custom style in every family, over the built-ins.
export function kitchenSinkSheet(): StyleSheet {
  const sheet = builtinStyleSheet();
  sheet.paragraph['Merksatz'] = { name: 'Merksatz', parent: 'Standard',
    para: { spaceBeforePt: 6, spaceAfterPt: 6, indentCm: 1 },
    text: { bold: true, color: '#004080' } } as N;
  sheet.list['Prüfliste'] = { name: 'Prüfliste', levels: [
    { kind: 'number', numType: 'upper-roman-paren', markerAlign: 'right', indentCm: 0.5 },
    { kind: 'bullet', bulletChar: '✓' },
    { kind: 'number', numType: 'lower-alpha', startAt: 3 },
  ] };
  return sheet;
}

export function kitchenSinkOptions(): {
  hf: HfExport; language: { language: string; country: string };
  notesSettings: NoteSettings; props: DocProperties; pageNumbering: PageNumbering;
  decor: PageDecor; lineNumbering: LineNumbering;
} {
  const hfDoc = (kind: 'header' | 'footer'): N => ({ type: 'doc', content: [p([
    { type: 'chapterField', attrs: { level: 1, text: 'Zeichenformatierung' } },
    t('\t'), t(kind === 'header' ? 'Kopfzeile' : 'Fußzeile'), t('\tSeite '),
    { type: 'pageNumber' }, t(' von '), { type: 'pageCount' },
  ])] });
  return {
    hf: { header: hfDoc('header'), footer: hfDoc('footer'),
      headerFirst: null, footerFirst: null, differentFirstPage: true,
      headerEven: null, footerEven: null, differentOddEven: false,
      sections: [], pageCount: 3, headerDistanceCm: 1, footerDistanceCm: 1 },
    language: { language: 'de', country: 'DE' },
    notesSettings: (() => {
      const s = structuredClone(DEFAULT_NOTE_SETTINGS);
      s.footnote.suffix = ')';
      return s;
    })(),
    props: { title: 'Grenzdokument', subject: 'Exportprüfung', author: 'Test Autor',
      keywords: 'Test, Export, Schema', description: 'Ein Dokument mit allen Funktionen.' },
    pageNumbering: { format: '1', start: 1 },
    decor: { background: '#FFFDF5',
      border: { widthPt: 0.5, color: '#000000', paddingCm: 0.2 },
      watermark: { text: 'ENTWURF', font: 'Liberation Sans', color: '#C0C0C0', angle: 45, transparency: 50 } },
    lineNumbering: { on: true, interval: 5, distanceCm: 0.5, restart: 'page', countEmpty: true },
  };
}
