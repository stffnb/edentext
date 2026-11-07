// The assistant's coverage matrix: every schema node, mark and attribute and every ribbon
// command names the tool call that reaches it, or why the assistant leaves it alone. A new
// feature fails here until it is classified; each check also proves the model reads it back.
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor, getSchema } from '@tiptap/core';
import { Mapping } from '@tiptap/pm/transform';
import type { Node as PMNode } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { RIBBON_COMMANDS } from '../../src/lib/components/ribbon/commands';
import { blockTexts, serializeDoc } from '../../src/lib/ai/doc';
import { runTool, type AiHost, type TurnContext } from '../../src/lib/ai/tools';
import { EMPTY_HF_SET, loadExtraHfSections, saveDifferentFirstPage, saveDifferentOddEven, saveExtraHfSections, saveHfDoc } from '../../src/lib/storage/headerFooter';
import { savePageFormat } from '../../src/lib/storage/pageFormat';
import { saveOrientation } from '../../src/lib/storage/pageOrientation';
import { loadPageMargins, savePageMargins } from '../../src/lib/storage/pageMargins';
import { loadPageNumbering, savePageNumbering } from '../../src/lib/storage/pageNumbering';
import { saveDocumentLanguage } from '../../src/lib/storage/documentLanguage';
import { loadDocProperties, saveDocProperties } from '../../src/lib/storage/docProperties';
import { loadHyphenation, saveHyphenation } from '../../src/lib/storage/hyphenation';
import { loadLineNumbering, saveLineNumbering } from '../../src/lib/storage/lineNumbering';
import { loadPageDecor, savePageDecor } from '../../src/lib/storage/pageDecor';
import { loadFoldMarks, saveFoldMarks } from '../../src/lib/storage/foldMarks';
import { noteSettings } from '../../src/lib/storage/notes.svelte';
import { TOOLS, chatSystemPrompt } from '../../src/lib/ai/tools';
import { putListStyle } from '../../src/lib/styles/sheet.svelte';

type Call = [string, Record<string, unknown>];
/** A doc (default one paragraph), the calls, and what must hold afterwards. */
type Check = { doc?: string; calls: Call[]; ok: (doc: PMNode) => boolean };
type Entry = Check | { na: string } | { same: string } | { todo: string } | { browser: string };

const na = (why: string): Entry => ({ na: why });
const same = (key: string): Entry => ({ same: key });
const todo = (what: string): Entry => ({ todo: what });
// Reached, but only a browser parses the CSS that carries it.
const browser = (how: string): Entry => ({ browser: how });
const check = (calls: Call | Call[], ok: Check['ok'], doc?: string): Entry => ({ calls: Array.isArray(calls[0]) ? calls as Call[] : [calls as Call], ok, doc });

const UI = na('an app action or view setting, not document content');
const IMPORT = na('kept from imported files; the editor offers no control for it');
const ASIAN = na('Asian layout, kept from imported files');

// The first node of a type, its attrs, the marks on the first text.
function first(doc: PMNode, type: string): PMNode | null {
  let hit: PMNode | null = null;
  doc.descendants((n) => { hit ??= n.type.name === type ? n : null; return !hit; });
  return hit;
}
const attr = (type: string, key: string, want: unknown) => (doc: PMNode) => first(doc, type)?.attrs[key] === want;
const para = (key: string, want: unknown) => attr('paragraph', key, want);
const hasMark = (name: string, test: (attrs: Record<string, unknown>) => boolean = () => true) => (doc: PMNode) => {
  let found = false;
  doc.descendants((n) => { found ||= n.marks.some((m) => m.type.name === name && test(m.attrs)); });
  return found;
};
const fmt = (args: Record<string, unknown>): Call => ['format', { from: 1, ...args }];
const css = (value: string): Call => fmt({ css: value });
const insert = (html: string): Call => ['insert_paragraphs', { after: 1, html }];
const TABLE = '<table><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></table>';
const FRAME = '<p>x</p><p><img src="data:image/png;base64,AA==" width="100" height="100" data-wrap="right"> text</p>';
const LIST = '<p>x</p><ul><li><p>one</p></li><li><p>two</p></li></ul>';
const frame = (args: Record<string, unknown>): Call => ['frame', { paragraph: 2, ...args }];
const table = (action: string, args: Record<string, unknown> = {}): Call => ['table', { paragraph: 1, action, ...args }];
const box = (style: string): Call[] => [['insert_frame', { paragraph: 1, kind: 'text_box' }], ['frame', { paragraph: 1, css: style }]];
const page = (args: Record<string, unknown>): Call => ['set_page', args];

const SCHEMA: Record<string, Entry> = {
  doc: na('the document itself'),
  text: check(insert('<p>New</p>'), (d) => d.textContent.includes('New')),
  paragraph: same('text'),
  'paragraph.indent': check(css('margin-left: 1cm'), para('indent', 1)),
  'paragraph.indentChars': ASIAN,
  'paragraph.indentRightChars': ASIAN,
  'paragraph.indentFirstChars': ASIAN,
  'paragraph.indentRight': check(css('margin-right: 2cm'), para('indentRight', 2)),
  'paragraph.indentFirst': check(css('text-indent: 1cm'), para('indentFirst', 1)),
  'paragraph.joinPrev': IMPORT,
  'paragraph.revMark': same('mark:insertion'),
  'paragraph.revFormat': check(fmt({ align: 'center' }), (doc) => !!doc.firstChild?.attrs.revFormat),
  'table.joinPrev': IMPORT,
  'paragraph.lineHeight': check(css('line-height: 1.5'), para('lineHeight', '1.5')),
  'paragraph.snapToGrid': ASIAN,
  'paragraph.spaceBefore': check(css('margin-top: 6pt'), para('spaceBefore', 6)),
  'paragraph.spaceAfter': check(css('margin-bottom: 6pt'), para('spaceAfter', 6)),
  'paragraph.backgroundColor': check(css('background: #EEEEEE'), para('backgroundColor', '#EEEEEE')),
  'paragraph.borderTop': check(css('border: 1pt solid #000000'), para('borderTop', '1pt solid #000000')),
  'paragraph.borderRight': same('paragraph.borderTop'),
  'paragraph.borderBottom': same('paragraph.borderTop'),
  'paragraph.borderLeft': same('paragraph.borderTop'),
  'paragraph.fontSize': na('the paragraph mark\'s own font, which follows its text'),
  'paragraph.fontFamily': same('paragraph.fontSize'),
  'paragraph.fontFamilyAsian': ASIAN,
  'paragraph.styleName': check(fmt({ style: 'Quote' }), para('styleName', 'Quotations')),
  'paragraph.breakBefore': check(css('break-before: page'), para('breakBefore', 'page')),
  'paragraph.widowControl': check(css('widows: 1'), para('widowControl', false)),
  'paragraph.keepNext': check(css('break-after: avoid'), para('keepNext', true)),
  'paragraph.keepLines': check(css('break-inside: avoid'), para('keepLines', true)),
  'paragraph.noHyphenation': check(css('hyphens: none'), para('noHyphenation', true)),
  'paragraph.sectionBreak': check([['format', { from: 2, css: 'page: next' }], ['set_header_footer', { zone: 'header', section: 2, html: '<p>Two</p>' }]],
    (d) => d.child(1).attrs.sectionBreak === true && JSON.stringify(loadExtraHfSections()[0]?.header).includes('Two'), '<p>x</p><p>y</p>'),
  'paragraph.dir': check(css('direction: rtl'), para('dir', 'rtl')),
  'paragraph.lang': check(['set_language', { language: 'de-DE', from: 1 }], para('lang', 'de-DE')),
  'paragraph.langAsian': ASIAN,
  'paragraph.tabStops': check(css('tab-stops: 8cm center, 16cm right dotted'), para('tabStops', '8c;16r.')),
  'paragraph.textAlign': check(fmt({ align: 'center' }), para('textAlign', 'center')),
  heading: check(fmt({ style: 'Heading 2' }), attr('heading', 'level', 2)),
  'heading.level': same('heading'),
  hardBreak: check(insert('<p>a<br>b</p>'), (d) => !!first(d, 'hardBreak')),
  placeholderField: check(insert('<p><input placeholder="Name"></p>'), (d) => !!first(d, 'placeholderField')),
  'placeholderField.text': same('placeholderField'),
  dateTimeField: check(insert('<p><time></time></p>'), (d) => !!first(d, 'dateTimeField')),
  'dateTimeField.kind': same('dateTimeField'),
  'dateTimeField.format': check(insert('<p><time format="d MMMM yyyy"></time></p>'), attr('dateTimeField', 'format', 'd MMMM yyyy')),
  'dateTimeField.fixed': check(insert('<p><time datetime="2026-01-31"></time></p>'), attr('dateTimeField', 'fixed', true)),
  'dateTimeField.value': same('dateTimeField.fixed'),
  image: check(insert('<p><img alt="Logo" width="2cm" height="2cm"></p>'), (d) => !!first(d, 'image')),
  'image.src': na('the picture itself; the assistant inserts only placeholders'),
  'image.alt': check(frame({ alt: 'A red logo' }), attr('image', 'alt', 'A red logo'), FRAME),
  'image.width': check(frame({ width_cm: 3 }), (d) => first(d, 'image')!.attrs.width === 113, FRAME),
  'image.height': same('image.width'),
  'image.rotation': check(frame({ rotation: 90 }), attr('image', 'rotation', 90), FRAME),
  'image.wrap': check(frame({ wrap: 'top_bottom' }), attr('image', 'wrap', 'topBottom'), FRAME),
  'image.wrapOffset': check(frame({ x_cm: 2 }), attr('image', 'wrapOffset', 2), FRAME),
  'image.wrapOffsetY': check(frame({ y_cm: 1 }), attr('image', 'wrapOffsetY', 1), FRAME),
  'image.wrapDist': check(frame({ gap_cm: 1 }), (d) => !!first(d, 'image')!.attrs.wrapDist, FRAME),
  'image.anchorPage': na('set by the layout when a frame is placed on its page'),
  'image.wrapAlign': na('set where two imported frames share one band'),
  'image.crop': na('needs the picture, which the model does not see'),
  'image.colorMode': na('a picture effect from imported files'),
  'image.vAlign': na('an in-line picture\'s place against the line, from imported files'),
  'image.wrapFromPage': check(frame({ y_cm: 1, y_from: 'page' }), attr('image', 'wrapFromPage', true), FRAME),
  'image.wrapFromBody': check(frame({ y_cm: 1, y_from: 'margin' }), attr('image', 'wrapFromBody', true), FRAME),
  'image.zIndex': check([frame({ wrap: 'in_front' }), frame({ stack: 'back' })], (d) => first(d, 'image')!.attrs.zIndex != null, FRAME),
  'image.inFront': check(frame({ wrap: 'in_front' }), attr('image', 'inFront', true), FRAME),
  textBox: check(['insert_frame', { paragraph: 1, kind: 'text_box', html: '<p>Box</p>' }], (d) => !!first(d, 'textBox')),
  'textBox.width': check([['insert_frame', { paragraph: 1, kind: 'text_box' }], ['frame', { paragraph: 1, width_cm: 3 }]], (d) => first(d, 'textBox')!.attrs.width === 113),
  'textBox.height': same('textBox.width'),
  'textBox.rotation': check([['insert_frame', { paragraph: 1, kind: 'text_box' }], ['frame', { paragraph: 1, rotation: 90 }]], attr('textBox', 'rotation', 90)),
  'textBox.wrap': same('image.wrap'),
  'textBox.wrapOffset': same('image.wrapOffset'),
  'textBox.wrapOffsetY': same('image.wrapOffsetY'),
  'textBox.inFront': same('image.inFront'),
  'textBox.zIndex': same('image.zIndex'),
  'textBox.wrapFromPage': same('image.wrapFromPage'),
  'textBox.wrapFromBody': same('image.wrapFromBody'),
  'textBox.wrapDist': same('image.wrapDist'),
  'textBox.wrapAlign': same('image.wrapAlign'),
  'textBox.paddingCm': check(box('padding: 0.5cm'), attr('textBox', 'paddingCm', 0.5)),
  'textBox.paddingTopCm': same('textBox.paddingCm'),
  'textBox.paddingBottomCm': same('textBox.paddingCm'),
  'textBox.shapeKind': check(box('border-radius: 50%'), attr('textBox', 'shapeKind', 'ellipse')),
  'textBox.shapePath': same('textBox.shapeKind'),
  'textBox.shapeTextArea': same('textBox.shapeKind'),
  'textBox.shapePreset': same('textBox.shapeKind'),
  'textBox.arrowHeads': IMPORT,
  'textBox.flipV': IMPORT,
  'textBox.flipH': IMPORT,
  'textBox.textVertical': check(box('writing-mode: vertical-rl'), attr('textBox', 'textVertical', true)),
  'textBox.fixedHeight': IMPORT,
  'textBox.textVAlign': check(box('vertical-align: middle'), attr('textBox', 'textVAlign', 'middle')),
  'textBox.fillColor': check(box('background: #FFEEDD'), attr('textBox', 'fillColor', '#FFEEDD')),
  'textBox.strokeColor': check(box('border: 2pt solid #FF0000'), attr('textBox', 'strokeColor', '#FF0000')),
  'textBox.strokeWidthPt': same('textBox.strokeColor'),
  sequenceField: check(insert('<p class="Caption">Figure {figure}: A chart</p>'), attr('sequenceField', 'category', 'figure')),
  'sequenceField.category': same('sequenceField'),
  'sequenceField.format': same('sequenceField'),
  'sequenceField.number': same('sequenceField'),
  indexEntry: check(insert('<p>An <dfn>apple</dfn> a day</p>'), attr('indexEntry', 'term', 'apple')),
  'indexEntry.term': same('indexEntry'),
  'indexEntry.key1': same('indexEntry'),
  bibliographyEntry: check(insert('<p>As shown <cite author="Ada" title="Notes" year="1843">Ada1843</cite>.</p>'), attr('bibliographyEntry', 'identifier', 'Ada1843')),
  'bibliographyEntry.identifier': same('bibliographyEntry'),
  'bibliographyEntry.type': same('bibliographyEntry'),
  'bibliographyEntry.fields': same('bibliographyEntry'),
  'bibliographyEntry.text': same('bibliographyEntry'),
  crossRef: check([fmt({ bookmark: 'intro' }), insert('<p>See page <a href="#intro" class="page"></a>.</p>')], attr('crossRef', 'format', 'page')),
  'crossRef.name': same('crossRef'),
  'crossRef.format': same('crossRef'),
  'crossRef.kind': same('crossRef'),
  'crossRef.link': same('crossRef'),
  'crossRef.sep': same('crossRef'),
  'crossRef.text': same('crossRef'),
  ruby: check(insert('<p><ruby>漢<rt>かん</rt></ruby></p>'), (d) => !!first(d, 'ruby')),
  'ruby.base': same('ruby'),
  'ruby.text': same('ruby'),
  formula: check(insert('<p>So \\(e^{i\\pi}+1=0\\).</p>'), attr('formula', 'latex', 'e^{i\\pi}+1=0')),
  'formula.latex': same('formula'),
  'formula.display': same('formula'),
  columns: check(['set_columns', { from: 1, count: 2 }], attr('columns', 'count', 2)),
  'columns.count': same('columns'),
  'columns.gapCm': IMPORT,
  tableOfContents: check(insert('<nav></nav>'), (d) => !!first(d, 'tableOfContents')),
  'tableOfContents.index': check(insert('<nav class="figures"></nav>'), attr('tableOfContents', 'index', 'figures')),
  'tableOfContents.title': check(insert('<nav title="Inhalt" levels="2"></nav>'), attr('tableOfContents', 'title', 'Inhalt')),
  'tableOfContents.maxLevel': check(insert('<nav levels="2"></nav>'), attr('tableOfContents', 'maxLevel', 2)),
  'tableOfContents.breakBefore': same('paragraph.breakBefore'),
  'tableOfContents.sectionBreak': same('paragraph.sectionBreak'),
  'tableOfContents.leader': IMPORT,
  'tableOfContents.tabPosCm': IMPORT,
  'tableOfContents.columns': IMPORT,
  'tableOfContents.columnGapCm': IMPORT,
  'tableOfContents.pageNumbers': IMPORT,
  'tableOfContents.levelStyles': IMPORT,
  'tableOfContents.citationStyle': same('bibliographyEntry'),
  'tableOfContents.entries': na('built from the headings'),
  noteRef: check(['rewrite_paragraph', { paragraph: 1, html: 'Text<sup class="footnote">Note</sup>' }], (d) => !!first(d, 'noteRef')),
  'noteRef.id': same('noteRef'),
  'noteRef.kind': check(['rewrite_paragraph', { paragraph: 1, html: 'Text<sup class="endnote">Note</sup>' }], attr('noteRef', 'kind', 'endnote')),
  'noteRef.text': same('noteRef'),
  note: same('noteRef'),
  'note.id': same('noteRef'),
  'note.kind': same('noteRef.kind'),
  'note.label': IMPORT,
  'note.text': same('noteRef'),
  'note.styleName': IMPORT,
  noteSection: na('the container of the notes'),
  bulletList: check(fmt({ list: 'bullet' }), (d) => !!first(d, 'bulletList')),
  orderedList: check(fmt({ list: 'number' }), (d) => !!first(d, 'orderedList')),
  listItem: same('bulletList'),
  'bulletList.indent': same('paragraph.indent'),
  'bulletList.indentChars': ASIAN,
  'bulletList.indentRightChars': ASIAN,
  'bulletList.indentRight': IMPORT,
  'bulletList.indentFirst': IMPORT,
  'bulletList.indentFirstChars': ASIAN,
  'bulletList.markerAlign': IMPORT,
  'bulletList.hanging': IMPORT,
  'bulletList.markerFormat': IMPORT,
  'bulletList.markerSuffix': IMPORT,
  'bulletList.listStyleName': check(['format', { from: 2, style: 'Dashes' }], attr('bulletList', 'listStyleName', 'Dashes'), LIST),
  'bulletList.bulletChar': check(fmt({ from: 2, css: 'list-style-type: "–"' }), attr('bulletList', 'bulletChar', '–'), LIST),
  'orderedList.start': check([fmt({ from: 2, to: 3, list: 'number' }), fmt({ from: 2, css: 'start: 4' })], attr('orderedList', 'start', 4), LIST),
  'orderedList.type': same('orderedList.listStyleType'),
  'orderedList.continueNumbering': na('set where a table splits a list, which counts on past it'),
  'orderedList.listStyleType': check([fmt({ from: 2, to: 3, list: 'number' }), fmt({ from: 2, css: 'list-style-type: lower-roman' })], attr('orderedList', 'listStyleType', 'lower-roman'), LIST),
  table: check(insert(TABLE), (d) => !!first(d, 'table')),
  'table.breakBefore': same('paragraph.breakBefore'),
  'table.sectionBreak': same('paragraph.sectionBreak'),
  'table.keepRows': IMPORT,
  'table.repeatHeader': check(table('repeat_header', { value: 'on' }), attr('table', 'repeatHeader', true), TABLE),
  'table.marginLeft': IMPORT,
  'table.marginRight': IMPORT,
  'table.marginTop': IMPORT,
  'table.marginBottom': IMPORT,
  'table.cellPadding': check(table('css', { value: 'padding: 0.3cm' }), (d) => JSON.stringify(first(d, 'tableCell')!.attrs.cellPadding) === '[0.3,0.3,0.3,0.3]', TABLE),
  'table.tableStyle': check(table('style', { style: 'Simple Grid' }), (d) => !!first(d, 'table')!.attrs.tableStyle, TABLE),
  'table.tableLook': check(table('header_row', { value: 'on' }), (d) => first(d, 'tableCell')!.attrs.backgroundColor != null, TABLE),
  tableRow: check(table('row_below', { cells: ['x', 'y'] }), (d) => first(d, 'table')!.childCount === 3, TABLE),
  'tableRow.rowHeight': check(table('css', { value: 'height: 1cm' }), (d) => !!first(d, 'tableRow')!.attrs.rowHeight, TABLE),
  'tableRow.cantSplit': IMPORT,
  'tableRow.revMark': same('mark:insertion'),
  'tableCell.revMark': same('mark:insertion'),
  tableCell: same('table'),
  tableHeader: check(insert('<table><tr><th>h</th></tr><tr><td>c</td></tr></table>'), (d) => !!first(d, 'tableHeader')),
  'tableCell.formula': check(table('formula', { value: '=SUM(<A1:B1>)' }), (d) => !!first(d, 'tableCell')!.attrs.formula, TABLE),
  'tableCell.cellFormat': IMPORT,
  'tableCell.backgroundColor': check(table('shade', { color: '#EEEEEE' }), attr('tableCell', 'backgroundColor', '#EEEEEE'), TABLE),
  'tableCell.verticalAlign': check(table('css', { value: 'vertical-align: middle' }), attr('tableCell', 'verticalAlign', 'middle'), TABLE),
  'tableCell.borderTop': check(table('borders', { borders: 'none' }), (d) => first(d, 'tableCell')!.attrs.borderTop != null, TABLE),
  'tableCell.borderRight': same('tableCell.borderTop'),
  'tableCell.borderBottom': same('tableCell.borderTop'),
  'tableCell.borderLeft': same('tableCell.borderTop'),
  'tableCell.cellPadding': same('table.cellPadding'),
  'tableCell.region': na('set by the table style'),
  'tableCell.colspan': check(table('merge_right'), attr('tableCell', 'colspan', 2), TABLE),
  'tableCell.rowspan': check(table('merge_down'), attr('tableCell', 'rowspan', 2), TABLE),
  'tableCell.colwidth': check(table('widths', { widths: [30, 70] }), (d) => JSON.stringify(first(d, 'tableCell')!.attrs.colwidth) === '[30]', TABLE),
  'tableCell.align': IMPORT,
  'mark:link': check(['rewrite_paragraph', { paragraph: 1, html: '<a href="https://example.org">site</a>' }], hasMark('link')),
  'mark:link.href': check(fmt({ find: 'world', link: 'https://example.org' }), hasMark('link', (a) => a.href === 'https://example.org')),
  'mark:link.target': IMPORT,
  'mark:link.rel': IMPORT,
  'mark:link.class': IMPORT,
  'mark:link.title': IMPORT,
  'mark:link.plain': IMPORT,
  'mark:charStyle': check(fmt({ find: 'world', style: 'Emphasis' }), hasMark('charStyle')),
  'mark:charStyle.name': same('mark:charStyle'),
  'mark:textStyle': same('mark:textStyle.fontFamily'),
  'mark:textStyle.fontFamily': check(fmt({ font: 'Arial' }), hasMark('textStyle', (a) => a.fontFamily === 'Arial')),
  'mark:textStyle.fontFamilyAsian': ASIAN,
  'mark:textStyle.fontSize': check(fmt({ size_pt: 14 }), hasMark('textStyle', (a) => a.fontSize === '14pt')),
  'mark:textStyle.fontWeight': IMPORT,
  'mark:textStyle.color': check(fmt({ color: '#C00000' }), hasMark('textStyle', (a) => !!a.color)),
  'mark:textStyle.caps': check(css('font-variant: small-caps'), hasMark('textStyle', (a) => a.caps === 'smallCaps')),
  'mark:textStyle.textPosition': check(css('vertical-align: 3pt'), hasMark('textStyle', (a) => a.textPosition === 3)),
  'mark:textStyle.emphasis': check(css('text-emphasis: filled dot'), hasMark('textStyle', (a) => a.emphasis === 'dot above')),
  'mark:textStyle.lang': same('paragraph.lang'),
  'mark:textStyle.langAsian': ASIAN,
  'mark:bold': check(fmt({ bold: true }), hasMark('bold')),
  'mark:italic': check(fmt({ italic: true }), hasMark('italic')),
  'mark:underline': check(fmt({ underline: true }), hasMark('underline')),
  'mark:underline.lineStyle': browser('format css text-decoration-style, which jsdom does not parse'),
  'mark:underline.lineColor': same('mark:underline.lineStyle'),
  'mark:strike': check(css('text-decoration: line-through'), hasMark('strike')),
  'mark:strike.lineStyle': IMPORT,
  'mark:bookmark': check(fmt({ find: 'world', bookmark: 'here' }), hasMark('bookmark', (a) => a.name === 'here')),
  'mark:bookmark.name': same('mark:bookmark'),
  'mark:comment': check(['add_comment', { paragraph: 1, text: 'Why?' }], hasMark('comment')),
  'mark:comment.id': same('mark:comment'),
  'mark:comment.author': same('mark:comment'),
  'mark:comment.date': same('mark:comment'),
  'mark:comment.text': same('mark:comment'),
  'mark:comment.replies': check([['add_comment', { paragraph: 1, text: 'Why?' }], ['reply_comment', { comment: 1, text: 'Because' }]], hasMark('comment', (a) => (a.replies as unknown[]).length === 1)),
  'mark:comment.resolved': check([['add_comment', { paragraph: 1, text: 'Why?' }], ['resolve_comment', { comment: 1 }]], hasMark('comment', (a) => a.resolved === true)),
  'mark:subscript': check(css('vertical-align: sub'), hasMark('subscript')),
  'mark:superscript': check(css('vertical-align: super'), hasMark('superscript')),
  'mark:highlight': check(fmt({ highlight: '#FFFF00' }), hasMark('highlight')),
  'mark:highlight.color': same('mark:highlight'),
  'mark:insertion': check(['replace_text', { paragraph: 1, find: 'world', replace: 'there' }], hasMark('insertion')),
  'mark:insertion.id': same('mark:insertion'),
  'mark:insertion.author': same('mark:insertion'),
  'mark:insertion.date': same('mark:insertion'),
  'mark:insertion.moveId': na('a move is the user\'s: the assistant replaces text, it does not carry it over'),
  'mark:deletion.moveId': same('mark:insertion.moveId'),
  'mark:formatChange.moveId': same('mark:insertion.moveId'),
  'mark:insertion.comment': na('a reviewer\'s note beside the change, written in the card'),
  'mark:deletion.comment': same('mark:insertion.comment'),
  'mark:formatChange.comment': same('mark:insertion.comment'),
  'mark:deletion': same('mark:insertion'),
  'mark:deletion.id': same('mark:insertion'),
  'mark:deletion.author': same('mark:insertion'),
  'mark:deletion.date': same('mark:insertion'),
  'mark:formatChange': check(fmt({ bold: true }), hasMark('formatChange')),
  'mark:formatChange.id': same('mark:formatChange'),
  'mark:formatChange.author': same('mark:formatChange'),
  'mark:formatChange.date': same('mark:formatChange'),
  'mark:formatChange.old': same('mark:formatChange'),
};

// Ribbon commands: the document features the schema covers point there; the rest says why not.
const RIBBON: Record<string, Entry> = {
  newDocument: UI, newFromTemplate: UI, open: UI, browserDocuments: UI, save: UI, saveAsOdt: UI, saveAsDocx: UI,
  rasterPdf: UI, vectorPdf: UI, saveTemplate: UI, print: UI, about: UI,
  protect: na('a password is the user\'s to choose; the assistant never sees or sets it'),
  docProperties: check(page({ title: 'Report', keywords: 'a, b' }), () => loadDocProperties().title === 'Report'),
  paste: same('text'), cut: same('mark:deletion'), copy: UI, pastePlain: same('text'),
  growFont: same('mark:textStyle.fontSize'), shrinkFont: same('mark:textStyle.fontSize'),
  fontFamily: same('mark:textStyle.fontFamily'), fontSize: same('mark:textStyle.fontSize'),
  changeCase: same('mark:textStyle.caps'), 'case-none': same('mark:textStyle.caps'), 'case-uppercase': same('mark:textStyle.caps'),
  'case-lowercase': same('mark:textStyle.caps'), 'case-capitalize': same('mark:textStyle.caps'), 'case-smallCaps': same('mark:textStyle.caps'),
  bold: same('mark:bold'), italic: same('mark:italic'), underline: same('mark:underline'), strike: same('mark:strike'),
  subscript: same('mark:subscript'), superscript: same('mark:superscript'), emphasis: same('mark:textStyle.emphasis'),
  highlight: same('mark:highlight'), fontColor: same('mark:textStyle.color'),
  clearFormatting: check([fmt({ bold: true }), fmt({ clear: true })], (d) => !hasMark('bold')(d)),
  bulletList: same('bulletList'), orderedList: same('orderedList'),
  indentMore: check(fmt({ from: 3, list: 'deeper' }), (d) => !!first(first(d, 'listItem')!, 'bulletList'), LIST), indentLess: check([fmt({ from: 3, list: 'deeper' }), fmt({ from: 3, list: 'shallower' })], (d) => !first(first(d, 'listItem')!, 'bulletList'), LIST),
  formattingMarks: UI, lineSpacing: same('paragraph.lineHeight'),
  'align-left': same('paragraph.textAlign'), 'align-center': same('paragraph.textAlign'), 'align-right': same('paragraph.textAlign'), 'align-justify': same('paragraph.textAlign'),
  paragraphShading: same('paragraph.backgroundColor'), paragraphBorders: same('paragraph.borderTop'),
  find: na('the model reads the whole document'), replace: same('mark:insertion'),
  aiPane: UI,
  pageBreak: same('paragraph.breakBefore'), table: same('table'), picture: same('image'), textBox: same('textBox'),
  link: same('mark:link.href'), bookmark: same('mark:bookmark'), crossRef: same('crossRef'),
  header: check(['set_header_footer', { zone: 'header', html: '<p>Head</p>' }], () => true),
  footer: check(['set_header_footer', { zone: 'footer', html: '<p>Foot</p>' }], () => true),
  pageNumber: check(['set_header_footer', { zone: 'footer', html: '<p>{page} / {pages}</p>' }], () => true),
  hfOptions: check(['set_header_footer', { zone: 'header', pages: 'first', html: '<p>Title page</p>' }], () => true),
  autoText: na('the user\'s saved snippets; the model writes text itself'),
  ruby: same('ruby'), dateTime: same('dateTimeField'), symbol: same('text'), equation: same('formula'),
  margins: check(['set_page', { margins_cm: 3 }], () => loadPageMargins().top === 3),
  'margins-normal': same('margins'), 'margins-narrow': same('margins'), 'margins-wide': same('margins'),
  orientation: check(['set_page', { orientation: 'landscape' }], () => true),
  'orientation-portrait': same('orientation'), 'orientation-landscape': same('orientation'),
  pageSize: check(['set_page', { size: 'A5' }], () => true),
  columns: same('columns'), 'columns-1': same('columns'), 'columns-2': same('columns'), 'columns-3': same('columns'),
  breaks: same('paragraph.breakBefore'), sectionBreak: same('paragraph.sectionBreak'),
  hyphenation: check(page({ hyphenation: true }), () => loadHyphenation()),
  pageNumberFormat: check(page({ page_numbers: 'i' }), () => loadPageNumbering().format === 'i'),
  lineNumbers: check(page({ line_numbers: true }), () => loadLineNumbering().on),
  pageDecor: check(page({ border: '1pt solid #333333', background: '#FFFFEE', watermark: 'DRAFT' }), () => { const d = loadPageDecor(); return !!d.border && d.background?.toUpperCase() === '#FFFFEE' && d.watermark?.text === 'DRAFT'; }),
  foldMarks: check(page({ fold_marks: true }), () => loadFoldMarks()),
  indentLeft: same('paragraph.indent'), indentRight: same('paragraph.indentRight'),
  spaceBefore: same('paragraph.spaceBefore'), spaceAfter: same('paragraph.spaceAfter'),
  toc: same('tableOfContents'), 'toc-toc': same('tableOfContents'), 'toc-figures': same('tableOfContents.index'), 'toc-tables': same('tableOfContents.index'),
  'toc-alphabetical': same('tableOfContents.index'), 'toc-bibliography': same('tableOfContents.index'),
  tocOptions: same('tableOfContents.title'), tocUpdate: na('indexes update with the document'),
  headingNumbering: check(['set_style', { name: 'Heading 1', heading_numbers: '1.1' }], () => true, '<h1>Title</h1>'),
  footnote: same('noteRef'), endnote: same('noteRef.kind'), noteOptions: check(page({ footnote_numbers: 'a' }), () => noteSettings().footnote.numFormat === 'a'),
  citation: same('bibliographyEntry'), citationStyle: same('bibliographyEntry'),
  caption: same('sequenceField'), indexEntry: same('indexEntry'),
  thesaurus: na('the model knows synonyms itself'), wordCount: na('the model reads the text and the page count'),
  autoCorrect: UI, newComment: same('mark:comment'), commentPlace: UI, prevComment: UI, nextComment: UI,
  changePlace: UI, prevChange: UI, nextChange: UI,
  trackChanges: na('recording is the user\'s; the assistant\'s own edits are tracked always'), markupDisplay: UI,
  protectChanges: same('protect'),
  compareDocument: UI, mergeDocument: UI,
  accept: check(['review', { accept: true, author: 'Ada' }], (d) => d.textContent === 'Hello Ada world', '<p>Hello <span data-insertion="r1" data-rev-author="Ada">Ada </span>world</p>'), acceptAll: same('accept'), reject: same('accept'), rejectAll: same('accept'),
  printMarkup: UI, reviewSettings: UI, spellLanguage: same('paragraph.lang'),
  navigator: UI, ruler: UI, fieldShadings: UI, splitView: UI, pagesAcross: UI, zoomOut: UI, zoomIn: UI, zoomReset: UI,
  tableStyle: same('table.tableStyle'), cellShading: same('tableCell.backgroundColor'), tableBorders: same('tableCell.borderTop'),
  headerRow: same('table.tableLook'), firstColumn: same('table.tableLook'), repeatHeaderRow: same('table.repeatHeader'),
  tableDelete: same('tableDelete-deleteRow'),
  'tableDelete-deleteRow': check(table('delete_row'), (d) => first(d, 'table')!.childCount === 1, TABLE),
  'tableDelete-deleteColumn': check(table('delete_column'), (d) => first(d, 'tableRow')!.childCount === 1, TABLE),
  'tableDelete-deleteTable': check(['table', { paragraph: 2, action: 'delete_table' }], (d) => !first(d, 'table'), `<p>x</p>${TABLE}`),
  insertAbove: same('tableRow'), insertBelow: same('tableRow'),
  insertLeft: check(table('column_left', { cells: ['x', 'y'] }), (d) => first(d, 'tableRow')!.childCount === 3, TABLE), insertRight: same('insertLeft'),
  mergeCells: same('tableCell.colspan'), splitCells: check([table('merge_right'), table('split')], (d) => first(d, 'tableRow')!.childCount === 2, TABLE),
  'cellAlign-Top': same('tableCell.verticalAlign'), 'cellAlign-Middle': same('tableCell.verticalAlign'), 'cellAlign-Bottom': same('tableCell.verticalAlign'),
  cellMargins: same('table.cellPadding'), sort: check(table('sort', { value: 'desc' }), (d) => first(d, 'tableCell')!.textContent === 'c', TABLE), tableFormula: same('tableCell.formula'),
  numberRecognition: UI,
  'wrap-inline': same('image.wrap'), 'wrap-left': same('image.wrap'), 'wrap-right': same('image.wrap'), 'wrap-topBottom': same('image.wrap'),
  'wrap-behind': same('image.inFront'), 'wrap-front': same('image.inFront'),
  'order-forward': same('image.zIndex'), 'order-backward': same('image.zIndex'), 'order-front': same('image.zIndex'), 'order-back': same('image.zIndex'),
  altText: same('image.alt'), shape: same('textBox.shapeKind'), fillColor: same('textBox.fillColor'), borderColor: same('textBox.strokeColor'),
  borderWidth: same('textBox.strokeColor'), verticalText: same('textBox.textVertical'),
  'textAlign-Top': same('textBox.textVAlign'), 'textAlign-Middle': same('textBox.textVAlign'), 'textAlign-Bottom': same('textBox.textVAlign'),
  hfPageCount: same('pageNumber'), hfChapter: check(['set_header_footer', { zone: 'header', html: '<p>{chapter}</p>' }], () => true),
  differentFirstPage: same('hfOptions'), differentOddEven: check(['set_header_footer', { zone: 'footer', pages: 'even', html: '<p>Even</p>' }], () => true),
  hfTabs: na('tabs in a header are typed as tabs'), closeHf: UI,
  ...Object.fromEntries(RIBBON_COMMANDS.filter((c) => c.id.startsWith('pageSize-')).map((c) => [c.id, same('pageSize')])),
};

const schema = getSchema(extensions);
// Heading and ordered-list attributes shared with the paragraph and the bullet list, and
// header cells' with body cells', are one feature each.
const sharedAttr = (type: string, key: string) =>
  (type === 'heading' && key !== 'level') || (type === 'orderedList' && key in schema.nodes.bulletList.spec.attrs!) || type === 'tableHeader';
const schemaKeys = [
  ...Object.entries(schema.nodes).flatMap(([n, t]) => [n, ...Object.keys(t.spec.attrs ?? {}).filter((k) => !sharedAttr(n, k)).map((k) => `${n}.${k}`)]),
  ...Object.entries(schema.marks).flatMap(([n, t]) => [`mark:${n}`, ...Object.keys(t.spec.attrs ?? {}).map((k) => `mark:${n}.${k}`)]),
];

const host: AiHost = {
  setZone: (zone, variant, doc, section = 1) => {
    if (section > 1) {
      const sets = loadExtraHfSections();
      while (sets.length < section - 1) sets.push({ ...EMPTY_HF_SET });
      sets[section - 2] = { ...sets[section - 2], [zone]: doc };
      return saveExtraHfSections(sets);
    }
    if (variant === 'first') saveDifferentFirstPage(true);
    if (variant === 'even') saveDifferentOddEven(true);
    saveHfDoc(zone, doc, variant);
  },
  setPage: ({ format, orientation, margins, start, numberFormat, lineNumbers, hyphenation, foldMarks, decor, properties }) => {
    if (format) savePageFormat(format);
    if (orientation) saveOrientation(orientation);
    if (margins) savePageMargins({ ...loadPageMargins(), ...margins });
    if (start != null) savePageNumbering({ ...loadPageNumbering(), start });
    if (numberFormat) savePageNumbering({ ...loadPageNumbering(), format: numberFormat });
    if (lineNumbers != null) saveLineNumbering({ ...loadLineNumbering(), on: lineNumbers });
    if (hyphenation != null) saveHyphenation(hyphenation);
    if (foldMarks != null) saveFoldMarks(foldMarks);
    if (decor) savePageDecor({ ...loadPageDecor(), ...decor });
    if (properties) saveDocProperties({ ...loadDocProperties(), ...properties });
  },
  setLanguage: saveDocumentLanguage,
};

// A ribbon command named like a schema feature points to that feature.
function resolve(key: string, seen: string[] = []): Entry {
  const e = SCHEMA[key] ?? RIBBON[key];
  if (!e) throw new Error(`${seen.at(-1) ?? key} points to unknown "${key}"`);
  if (!('same' in e)) return e;
  if (seen.includes(key)) throw new Error(`cycle at ${key}`);
  return resolve(e.same, [...seen, key]);
}

function runCheck(c: Check): void {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions, content: c.doc ?? '<p>Hello world</p>' });
  try {
    const before = serializeDoc(editor.state);
    for (const [name, args] of c.calls) {
      const ctx: TurnContext = { editor, blocks: blockTexts(editor.state.doc), mapping: new Mapping(), author: 'AI', host, confirm: () => true };
      editor.on('transaction', ({ transaction }) => ctx.mapping.appendMapping(transaction.mapping));
      expect(runTool(ctx, { id: name, name, args: JSON.stringify(args) }).result, `${name} ${JSON.stringify(args)}`).toMatch(/^ok/);
    }
    expect(c.ok(editor.state.doc)).toBe(true);
    // What the assistant can set, it must also be able to read.
    expect(serializeDoc(editor.state)).not.toBe(before);
  } finally {
    editor.destroy();
  }
}

beforeEach(() => localStorage.clear());
// The built-in sheet has no named list style to assign.
putListStyle({ name: 'Dashes', levels: [{ kind: 'bullet', bulletChar: '–' }] });
// A text box's view measures itself.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

describe('assistant coverage', () => {
  it('classifies every schema node, mark and attribute', () => {
    expect(schemaKeys.filter((k) => !(k in SCHEMA))).toEqual([]);
    expect(Object.keys(SCHEMA).filter((k) => !schemaKeys.includes(k))).toEqual([]);
  });

  it('classifies every ribbon command', () => {
    const ids = RIBBON_COMMANDS.map((c) => c.id);
    expect(ids.filter((k) => !(k in RIBBON))).toEqual([]);
    expect(Object.keys(RIBBON).filter((k) => !ids.includes(k))).toEqual([]);
  });

  for (const [group, table] of [['schema', SCHEMA], ['ribbon', RIBBON]] as const) {
    for (const [key, entry] of Object.entries(table)) {
      if ('na' in entry) continue;
      if ('browser' in entry) { it.skip(`${group} ${key}: ${entry.browser}`); continue; }
      if ('todo' in entry) { it.todo(`${group} ${key}: ${entry.todo}`); continue; }
      if ('same' in entry) { it(`${group} ${key} → ${entry.same}`, () => void resolve(entry.same, [key])); continue; }
      it(`${group} ${key}`, () => runCheck(entry));
    }
  }
});

// Every feature reached through CSS and HTML a model already knows, so the request stays
// small enough for a small local model: tool schemas and system prompt share one budget.
describe('assistant prompt size', () => {
  it('keeps the tools and the system prompt within budget', () => {
    const size = JSON.stringify(TOOLS).length + chatSystemPrompt('edit').length;
    expect(size).toBeLessThanOrEqual(15_500);
  });
});
