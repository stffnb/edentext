// The edits every recording leg runs, unit and LibreOffice alike.
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, deleteCellSelection } from '@tiptap/pm/tables';
import { extensions } from '../src/lib/editor/extensions';

// jsdom has none, and a text box's view observes its size.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

type Act = (e: Editor) => unknown;

const settled = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

export function open(content: unknown) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, extensions, content: content as string });
}

export const select = (e: Editor, from: number, to = from) =>
  e.view.dispatch(e.state.tr.setSelection(TextSelection.create(e.state.doc, from, to)));

export async function edit(e: Editor, steps: Act[]) {
  for (const step of steps) { step(e); await settled(); }
}

export const THREE = '<p>aaaa</p><p>bbbb</p><p>cccc</p>';
const NESTED = '<ul><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ul>';
const LIST = '<ul><li><p>one</p></li><li><p>two</p></li></ul><p>tail</p>';

export const del = (from: number, to: number): Act[] => [(e) => select(e, from, to), (e) => e.commands.deleteSelection()];
export const enter = (at: number): Act[] => [(e) => select(e, at), (e) => e.commands.splitBlock()];

const TABLE = '<table><tbody><tr><td><p>a1</p></td><td><p>b1</p></td></tr><tr><td><p>a2</p></td><td><p>b2</p></td></tr></tbody></table><p>tail</p>';
const TALL = '<table><tbody><tr><td colspan="2"><p>a</p></td></tr><tr><td><p>b</p></td><td><p>c</p></td></tr></tbody></table><p>t</p>';
const inCell = (at: number): Act => (e) => select(e, at);
const grid = (...rows: string[][]) => `<table><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td><p>${c}</p></td>`).join('')}</tr>`).join('')}</tbody></table><p>tail</p>`;
// The cells from the `from`-th to the `to`-th in document order.
export const cells = (from: number, to: number): Act => (e) => {
  const at: number[] = [];
  e.state.doc.descendants((n, pos) => { if (n.type.spec.tableRole === 'cell') at.push(pos); });
  e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, at[from], at[to])));
};
const merge: Act[] = [(e) => e.commands.mergeCells()];

const field: Act = (e) => e.commands.insertContent({ type: 'pageNumber' });
const table: Act = (e) => e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
const BLANK = '<p>aaaa</p><p></p><p>cccc</p>';

/** Edits of a table's structure; `at` is inside its second row's first cell. */
export const TABLE_CASES: [string, string, Act[]][] = [
  ['a row deleted', TABLE, [inCell(14), (e) => e.commands.deleteRow()]],
  ['a column deleted', TABLE, [inCell(14), (e) => e.commands.deleteColumn()]],
  ['the table deleted', TABLE, [inCell(14), (e) => e.commands.deleteTable()]],
  ['two columns deleted', grid(['a', 'b', 'c'], ['d', 'e', 'f']), [cells(0, 1), (e) => e.commands.deleteColumn()]],
  ['two empty columns deleted', grid(['', '', 'c'], ['', '', 'f']), [cells(0, 1), (e) => e.commands.deleteColumn()]],
  ['a row inserted', TABLE, [inCell(14), (e) => e.commands.addRowAfter()]],
  ['a column inserted', TABLE, [inCell(14), (e) => e.commands.addColumnBefore()]],
  ['a note inserted', THREE, [(e) => select(e, 3), (e) => e.commands.insertNote('footnote')]],
  ['a text box inserted', THREE, [(e) => select(e, 3), (e) => e.commands.insertTextBox()]],
  ['a field put over one just inserted', THREE, [(e) => select(e, 3), field, (e) => e.commands.setNodeSelection(3), field]],
  ['Enter in a cell', TABLE, [inCell(5), (e) => e.commands.splitBlock()]],
  ['a table inserted', THREE, [(e) => select(e, 7), (e) => e.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false })]],
  ['a table in an empty document', '<p></p>', [(e) => select(e, 1), table]],
  ['a table cutting a list', LIST, [(e) => select(e, 3), table]],
  ['a table cutting a nested list', NESTED, [(e) => select(e, 10), table]],
];

// As a drop that ProseMirror fits across lists.
const fittedDrop = (from: number, to: number, at: number): Act => (e) => {
  const { tr, doc } = e.state, slice = doc.slice(from, to);
  tr.setSelection(TextSelection.create(doc, from, to)).deleteSelection();
  e.view.dispatch(tr.replaceRange(tr.mapping.map(at), tr.mapping.map(at), slice).setMeta('uiEvent', 'drop'));
};

/** Blocks taking the place of what was there: its removal is a change of its own. */
export const REPLACE_CASES: [string, string, Act[]][] = [
  ['a picture put over a picture', '<p>aa<img src="a.png">bb</p>', [(e) => e.commands.setNodeSelection(3), (e) => e.commands.insertContent({ type: 'image', attrs: { src: 'b.png' } })]],
  ['a table in an empty paragraph', BLANK, [(e) => select(e, 7), table]],
  ['a table over a selected paragraph', THREE, [(e) => select(e, 7, 11), table]],
  ['a table over part of a paragraph', THREE, [(e) => select(e, 8, 10), table]],
  ['a table over two paragraphs', THREE, [(e) => select(e, 2, 9), table]],
  ['Enter over a heading up to the next paragraph', '<h1>Head</h1><p>body</p><p>t</p>', [(e) => select(e, 1, 7), (e) => e.commands.splitBlock()]],
  ['the same after an Enter in the heading', '<h1>Head</h1><p>body</p><p>t</p>', [(e) => select(e, 2), (e) => e.commands.splitBlock(), (e) => select(e, 4, 9), (e) => e.commands.splitBlock()]],
  ['typing over one\'s own heading\'s mark', THREE, [...enter(7), (e) => select(e, 7), (e) => e.commands.insertContent('xy'), (e) => e.commands.setParagraphStyle('Heading 1'), (e) => select(e, 8, 12), (e) => e.commands.insertContent('z')]],
  ['typing over one\'s own list item\'s mark', LIST, [...enter(17), (e) => select(e, 17), (e) => e.commands.insertContent('xy'), (e) => e.commands.toggleBulletList(), (e) => select(e, 18, 24), (e) => e.commands.insertContent('z')]],
  ['words of two lists dropped behind a paragraph', '<p>head</p><ul><li><p>one</p></li></ul><p>nn</p><ol><li><p>two</p></li></ol><p>end</p>', [(e) => select(e, 10, 23), fittedDrop(10, 23, 5)]],
  ['a column through a merged cell', TALL, [inCell(11), (e) => e.commands.addColumnAfter()]],
  ['blocks in an empty paragraph', BLANK, [(e) => select(e, 7), (e) => e.commands.insertContent('<p>x</p><p>y</p>')]],
  ['a list taken off again by a selection into a table', `<p>head</p>${TABLE}`, [(e) => select(e, 2), (e) => e.commands.toggleBulletList(), (e) => select(e, 3, 15), (e) => e.commands.toggleOrderedList()]],
  ['a chapter moved under a styled Enter', '<h1>One</h1><p>a</p><h2>Two</h2><p>b</p>', [(e) => select(e, 1), (e) => e.commands.insertContent('x'), (e) => e.commands.setParagraphStyle('Heading 2'), (e) => e.commands.splitBlock(), (e) => e.commands.moveChapter(0, 1)]],
  ['a format, then Enter at the block\'s start', THREE, [(e) => select(e, 1), (e) => e.commands.setTextAlign('center'), (e) => e.commands.splitBlock()]],
  ['a format inside a new text box', THREE, [(e) => select(e, 2), (e) => e.commands.insertTextBox(), (e) => e.commands.setTextAlign('center')]],
  ['a text box in front of a selection', THREE, [(e) => select(e, 2, 4), (e) => e.commands.insertTextBox()]],
  ['a text box in front of a selection into a table', `<p>head</p>${TABLE}`, [(e) => select(e, 3, 28), (e) => e.commands.insertTextBox()]],
];

const ranged = (from: number, to: number, act: Act): Act[] => [(e) => select(e, from, to), act];
const STYLED = '<p>a<strong>bb</strong>c <em>dd</em></p><p>tail</p>';

/** Edits of a run's format. */
export const FORMAT_CASES: [string, string, Act[]][] = [
  ['bold set', THREE, ranged(2, 4, (e) => e.commands.setBold())],
  ['bold across paragraphs', THREE, ranged(3, 9, (e) => e.commands.setBold())],
  ['bold taken off', STYLED, ranged(2, 4, (e) => e.commands.unsetBold())],
  ['bold over mixed runs', STYLED, ranged(1, 8, (e) => e.commands.toggleBold())],
  ['a font size changed', STYLED, ranged(2, 8, (e) => e.commands.setMark('textStyle', { fontSize: '20pt' }))],
  ['formatting cleared', STYLED, ranged(1, 8, (e) => e.commands.clearDirectFormatting())],
  ['two formats, one after the other', STYLED, [...ranged(2, 4, (e) => e.commands.setItalic()), (e) => e.commands.setUnderline()]],
];

/** Edits of a block's own format. */
export const BLOCK_FORMAT_CASES: [string, string, Act[]][] = [
  ['alignment set', THREE, ranged(2, 2, (e) => e.commands.setTextAlign('center'))],
  ['alignment over two paragraphs', THREE, ranged(3, 9, (e) => e.commands.setTextAlign('right'))],
  ['a paragraph style', THREE, ranged(2, 2, (e) => e.commands.setParagraphStyle('Heading 1'))],
  ['a heading made a paragraph', '<h2>head</h2><p>body</p>', ranged(2, 2, (e) => e.commands.setParagraph())],
  ['an indent and a line height', THREE, [...ranged(2, 2, (e) => e.commands.updateAttributes('paragraph', { indent: 1.25 })), (e) => e.commands.updateAttributes('paragraph', { lineHeight: '1.5' })]],
];

const ITEMS = '<ul><li><p>one</p></li><li><p>two</p></li><li><p>three</p></li></ul><p>tail</p>';
const LEVELS = '<ul><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ul>';

/** Edits of what lists a block is in. */
export const LIST_CASES: [string, string, Act[]][] = [
  ['a paragraph made a list', THREE, ranged(2, 2, (e) => e.commands.toggleBulletList())],
  ['paragraphs made a list', THREE, ranged(2, 8, (e) => e.commands.toggleOrderedList())],
  ['a paragraph joining the list before it', ITEMS.replace('<p>tail</p>', '<p>more</p>'), ranged(24, 24, (e) => e.commands.toggleBulletList())],
  ['the middle item out of its list', ITEMS, ranged(9, 9, (e) => e.commands.toggleBulletList())],
  ['the first item out of its list', ITEMS, ranged(4, 4, (e) => e.commands.toggleBulletList())],
  ['the whole list off', ITEMS, ranged(4, 17, (e) => e.commands.toggleBulletList())],
  ['a list of the other type', ITEMS, ranged(4, 4, (e) => e.commands.toggleOrderedList())],
  ['an item one level down', ITEMS, ranged(11, 11, (e) => e.commands.sinkListItem('listItem'))],
  ['a nested list off', LEVELS, ranged(4, 20, (e) => e.commands.toggleBulletList())],
  ['an item one level up', LEVELS, ranged(11, 11, (e) => e.commands.liftListItem('listItem'))],
  ['a paragraph made a list, joining the one after it', '<p>more</p><ul data-list-style-name="Named"><li><p>one</p></li><li><p>two</p></li></ul>', ranged(2, 2, (e) => e.commands.toggleBulletList())],
  ['another bullet', ITEMS, ranged(4, 4, (e) => e.commands.setBulletChar('*'))],
  ['another numbering', ITEMS.replace(/ul>/g, 'ol>'), ranged(4, 4, (e) => e.commands.setOrderedListType('lower-alpha'))],
];

const CHAPTERS = '<h1>A</h1><p>aa</p><h1>B</h1><p>bb</p><h1>C</h1><p>cc</p>';
// A drop deletes the selection and puts it down elsewhere, as ProseMirror does.
const drop = (from: number, to: number, at: number): Act => (e) => {
  const { tr, doc } = e.state, slice = doc.slice(from, to);
  tr.delete(from, to).insert(tr.mapping.map(at), slice.content);
  e.view.dispatch(tr.setMeta('uiEvent', 'drop'));
};

/** Edits that carry content elsewhere: a deletion and an insertion that are one change. */
export const MOVE_CASES: [string, string, Act[]][] = [
  ['a chapter moved down', CHAPTERS, [(e) => e.commands.moveChapter(0, 1)]],
  ['a chapter moved up', CHAPTERS, [(e) => e.commands.moveChapter(7, -1)]],
  ['the last chapter moved up', CHAPTERS, [(e) => e.commands.moveChapter(14, -1)]],
  ['words dropped elsewhere', THREE, [drop(2, 4, 9)]],
  ['words dropped into another paragraph, across a mark', THREE, [drop(4, 9, 14)]],
];

export const CASES: [string, string, Act[]][] = [
  ['a selection across two paragraphs', THREE, del(3, 9)],
  ['a whole paragraph with its mark', THREE, del(7, 13)],
  ['only a paragraph mark', THREE, del(5, 7)],
  ['a chapter deleted in the navigator', CHAPTERS, [(e) => e.commands.deleteChapter(7)]],
  ['the last chapter deleted in the navigator', CHAPTERS, [(e) => e.commands.deleteChapter(14)]],
  ['three paragraphs', THREE, del(2, 15)],
  ['Backspace at a block start', THREE, [(e) => select(e, 7), (e) => e.commands.joinBackward()]],
  ['Delete at a block end', THREE, [(e) => select(e, 5), (e) => e.commands.joinForward()]],
  ['Enter inside a paragraph', THREE, enter(3)],
  ['Enter at a paragraph start', THREE, enter(7)],
  ['Enter in an empty heading', '<h1></h1><p>body</p>', enter(1)],
  ['Enter ahead of a page break', '<p>aa</p><h1 data-page-break-before="page">Head</h1>', [(e) => select(e, 5), (e) => e.commands.splitBlock()]],
  ['typing, Enter and Backspace ahead of a page break', '<p>aa</p><h1 data-page-break-before="page">Head</h1>', [(e) => select(e, 5), (e) => e.commands.insertContent('new'), (e) => e.commands.splitBlock(), (e) => e.commands.joinBackward()]],
  ['typing and Enter ahead of a page break', '<p>aa</p><h1 data-page-break-before="page">Head</h1>', [(e) => select(e, 5), (e) => e.commands.insertContent('new'), (e) => e.commands.splitBlock()]],
  ['cells cleared, one of them empty', grid(['a', ''], ['c', 'd']), [cells(0, 1), (e) => deleteCellSelection(e.state, (tr) => e.view.dispatch(tr))]],
  ['Enter at a paragraph end, then text', THREE, [...enter(5), (e) => e.commands.insertContent('new')]],
  ['two Enters', THREE, [...enter(3), ...enter(4)]],
  ['Enter over one\'s own empty paragraph', THREE, [...enter(7), (e) => select(e, 7, 9), (e) => e.commands.splitBlock()]],
  ['text over one\'s own empty paragraph', THREE, [...enter(7), (e) => select(e, 7, 9), (e) => e.commands.insertContent('new')]],
  ['Enter over one\'s own paragraph and the next text', THREE, [...enter(7), (e) => select(e, 7, 10), (e) => e.commands.splitBlock()]],
  ['paragraphs over one\'s own empty paragraph', THREE, [...enter(7), (e) => select(e, 7, 9), (e) => e.commands.insertContent('<p>x</p><p>y</p>')]],
  ['several paragraphs inserted', THREE, [(e) => e.commands.insertContentAt(3, '<p>xx</p><p>yy</p>')]],
  ['typing over two paragraphs', THREE, [(e) => select(e, 3, 9), (e) => e.commands.insertContent('z')]],
  ['Enter in a list item', LIST, enter(5)],
  ['a selection across list items', LIST, del(5, 11)],
  ['a new paragraph in a cell made a list', TABLE, [inCell(6), (e) => e.commands.keyboardShortcut('Enter'), (e) => e.commands.insertContent('b'), (e) => e.commands.toggleBulletList()]],
  ['Delete on an empty list item', LIST, [(e) => select(e, 6), (e) => e.commands.keyboardShortcut('Enter'), (e) => e.commands.keyboardShortcut('Delete')]],
  ['a whole list item', LIST, del(3, 10)],
  ['from a list into the text after it', LIST, del(10, 17)],
  ['from an item into its sub-list', NESTED, del(5, 12)],
  ['Enter before a sub-list', NESTED, enter(6)],
];

/** Commands that regroup what is there: unrecorded, and no change left behind. */
export const REBUILD_CASES: [string, string, Act[]][] = [
  ['columns over the document', THREE, [(e) => select(e, 2), (e) => e.commands.setColumns(2)]],
  ['columns over a selection', THREE, [(e) => select(e, 2, 9), (e) => e.commands.setColumns(2)]],
  ['columns taken off', '<div data-columns="2" data-column-gap="0.5"><p>aa</p><p>bb</p></div><p>t</p>', [(e) => select(e, 3), (e) => e.commands.setColumns(1)]],
  ['a merged cell split', TALL, [(e) => select(e, 4), (e) => e.commands.splitCell()]],
  ['cells with text merged', TABLE, [cells(0, 1), ...merge]],
  ['empty cells merged', grid(['', ''], ['', '']), [cells(0, 1), ...merge]],
  ['a cell merged with an empty one', grid(['a', ''], ['', 'b']), [cells(0, 1), ...merge]],
  ['an empty cell merged with one holding text', grid(['', 'a'], ['b', '']), [cells(0, 1), ...merge]],
  ['empty cells merged down', grid(['', ''], ['', '']), [cells(0, 2), ...merge]],
  ['all empty cells merged', grid(['', ''], ['', '']), [cells(0, 3), ...merge]],
  ['a cell split into two', TALL, [(e) => select(e, 4), (e) => e.commands.splitCellInto(2, 1)]],
  ['an index at a heading start', '<h1>Head</h1><p>x</p>', [(e) => select(e, 1), (e) => e.commands.setTableOfContents()]],
  ['an index in a paragraph', THREE, [(e) => select(e, 7), (e) => e.commands.setTableOfContents()]],
];
