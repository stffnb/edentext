// The cell-formula language and number recognition: the pure half (parse, evaluate,
// translate to and from LibreOffice's own syntax) plus the two commands that read a
// real table — evaluation over a ProseMirror doc, and the row sort.
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Table, TableHeader, TableCell } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { TableFormula, evaluateTable } from '../../src/lib/editor/extensions/tableFormula';
import { sortedRows, canSortTable, sortCollators, type SortType } from '../../src/lib/editor/extensions/tableSort';
import {
  numberLocale, parseCellNumber, formatCellNumber, evalFormula,
  toWriterFormula, fromWriterFormula, colName, parseRef,
} from '../../src/lib/utils/tableFormula';

type N = any;

const EN = numberLocale('en');
const DE = numberLocale('de');

const schema = getSchema([Document, Paragraph, Text, Table, ResizableTableRow, TableCell, TableHeader, TableFormula]);

const cell = (text: string, formula: string | null = null): N => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: null, formula },
  content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
});
const table = (...rows: N[][]): N =>
  schema.nodeFromJSON({ type: 'table', content: rows.map((cells) => ({ type: 'tableRow', content: cells })) });

// The grid of a one-column table, as a formula reads it.
const column = (...texts: string[]): N[][] => texts.map((t) => [cell(t)]);

describe('number recognition', () => {
  it('reads a number in the document\'s own language', () => {
    expect(parseCellNumber('1234.5', EN)).toBe(1234.5);
    expect(parseCellNumber('1,234.5', EN)).toBe(1234.5);
    expect(parseCellNumber('1.234,5', DE)).toBe(1234.5);
    expect(parseCellNumber('-7', EN)).toBe(-7);
    expect(parseCellNumber(' 42 ', EN)).toBe(42);
  });

  it('leaves text alone', () => {
    for (const text of ['', 'alpha', '12 apples', '1.2.3', '5%', '€5']) {
      expect(parseCellNumber(text, EN), text).toBeNull();
    }
  });

  it('writes it back in the general number format', () => {
    expect(formatCellNumber(19.5, EN)).toBe('19.5');
    expect(formatCellNumber(19.5, DE)).toBe('19,5');
    // The float noise of a sum, rounded off rather than printed.
    expect(formatCellNumber(0.1 + 0.2, EN)).toBe('0.3');
  });
});

describe('evalFormula', () => {
  const grid = [[10, null], [2.5, null], [7, null], [null, null]];
  const ctx = {
    rows: 4, cols: 2, self: { row: 3, col: 0 },
    valueAt: ({ row, col }: { row: number; col: number }) => grid[row]?.[col] ?? null,
  };

  it('sums the run above the cell', () => {
    expect(evalFormula('SUM(ABOVE)', ctx)).toBe(19.5);
    expect(evalFormula('AVERAGE(A1:A3)', ctx)).toBe(6.5);
    expect(evalFormula('MAX(A1:A3)', ctx)).toBe(10);
    expect(evalFormula('COUNT(A1:A3)', ctx)).toBe(3);
  });

  it('stops a direction at the first cell holding no number', () => {
    const gap = { ...ctx, self: { row: 3, col: 0 }, valueAt: (r: { row: number; col: number }) => (r.row === 1 ? null : grid[r.row]?.[r.col] ?? null) };
    expect(evalFormula('SUM(ABOVE)', gap)).toBe(7);
    // A range spans the gap; only a directional walk stops at it.
    expect(evalFormula('SUM(A1:A3)', gap)).toBe(17);
  });

  it('does arithmetic, with the usual precedence', () => {
    expect(evalFormula('A1*2', ctx)).toBe(20);
    expect(evalFormula('A1+A2*2', ctx)).toBe(15);
    expect(evalFormula('(A1+A2)*2', ctx)).toBe(25);
    expect(evalFormula('=SUM(A1:A3)/3', ctx)).toBe(6.5);
  });

  it('reports a formula it cannot read', () => {
    for (const bad of ['', 'SUM(', 'A1+', 'NOPE(A1)', 'A1/0', '#$%']) {
      expect(evalFormula(bad, ctx), bad).toBeNull();
    }
  });
});

describe('translating to and from LibreOffice', () => {
  const ctx = {
    rows: 4, cols: 1, self: { row: 3, col: 0 },
    valueAt: ({ row }: { row: number; col: number }) => (row < 3 ? 1 : null),
  };

  it('resolves a direction, which LibreOffice has no word for', () => {
    expect(toWriterFormula('SUM(ABOVE)', ctx)).toBe('sum <A1:A3>');
    expect(toWriterFormula('AVERAGE(A1:A3)', ctx)).toBe('mean <A1:A3>');
    expect(toWriterFormula('A1*2', ctx)).toBe('<A1>*2');
    expect(toWriterFormula('SUM(A1,A2)', ctx)).toBe('sum <A1>|<A2>');
    expect(toWriterFormula('SUM((A1+A2)*2)', ctx)).toBe('sum (<A1>+<A2>)*2');
  });

  it('reads back what either word processor wrote', () => {
    expect(fromWriterFormula('ooow:sum <A1:A3>')).toBe('SUM(A1:A3)');
    expect(fromWriterFormula('ooow:mean <A1:A3>')).toBe('AVERAGE(A1:A3)');
    expect(fromWriterFormula('ooow:<A1>*2')).toBe('A1*2');
    // Word's own field, and the one LibreOffice's DOCX export writes.
    expect(fromWriterFormula(' =SUM(ABOVE) ')).toBe('SUM(ABOVE)');
    expect(fromWriterFormula(' =sum (A1:A3)')).toBe('SUM(A1:A3)');
  });

  it('names a cell the way a formula refers to it', () => {
    expect(colName(0)).toBe('A');
    expect(colName(26)).toBe('AA');
    expect(parseRef('B3')).toEqual({ row: 2, col: 1 });
    expect(parseRef('nope')).toBeNull();
  });
});

describe('evaluateTable', () => {
  const ERR = '!';

  it('fills every formula cell from the cells it reads', () => {
    const t = table(...column('10', '2.5', '7'), [cell('', 'SUM(ABOVE)')]);
    expect([...evaluateTable(t, EN, ERR).values()]).toEqual(['19.5']);
  });

  it('resolves a formula that reads another formula', () => {
    const t = table([cell('4')], [cell('', 'SUM(ABOVE)')], [cell('', 'A2*3')]);
    expect([...evaluateTable(t, EN, ERR).values()]).toEqual(['4', '12']);
  });

  it('does not loop on a formula that reads itself', () => {
    const t = table([cell('', 'A2')], [cell('', 'A1')]);
    expect([...evaluateTable(t, EN, ERR).values()]).toEqual(['0', '0']);
  });

  it('reports a formula it cannot read', () => {
    const t = table([cell('', 'SUM(')]);
    expect([...evaluateTable(t, EN, ERR).values()]).toEqual([ERR]);
  });
});

describe('sortedRows', () => {
  const coll = sortCollators('en');
  const texts = (rows: N[]): string[] => rows.map((r) => r.textContent);
  const by = (column: number, descending = false, type: SortType = 'auto'): N =>
    ({ keys: [{ column, descending, type }], headerRow: false });

  it('orders a column of numbers numerically, not as text', () => {
    const t = table(...column('10', '2', '7'));
    expect(texts(sortedRows(t, by(0), EN, coll))).toEqual(['2', '7', '10']);
    expect(texts(sortedRows(t, by(0, true), EN, coll))).toEqual(['10', '7', '2']);
    // Alphanumerically the same column reads as text, so "10" comes before "2".
    expect(texts(sortedRows(t, by(0, false, 'text'), EN, coll))).toEqual(['10', '2', '7']);
  });

  it('orders text by the document\'s collation', () => {
    const t = table(...column('Zebra', 'ähnlich', 'Apfel'));
    expect(texts(sortedRows(t, by(0), EN, coll))).toEqual(['ähnlich', 'Apfel', 'Zebra']);
  });

  it('keeps a header row where it is', () => {
    const t = table(...column('Name', 'Zebra', 'Apfel'));
    const opts = { keys: [{ column: 0, descending: false, type: 'auto' }], headerRow: true };
    expect(texts(sortedRows(t, opts as N, EN, coll))).toEqual(['Name', 'Apfel', 'Zebra']);
  });

  it('sorts on the column it is given', () => {
    const t = table(
      [cell('b'), cell('2')],
      [cell('a'), cell('1')],
    );
    const bySecond = sortedRows(t, by(1), EN, coll);
    expect(texts(bySecond)).toEqual(['a1', 'b2']);
  });

  it('decides a tie on the second key, and that one on the third', () => {
    const t = table(
      [cell('b'), cell('1'), cell('y')],
      [cell('a'), cell('2'), cell('x')],
      [cell('a'), cell('1'), cell('z')],
      [cell('a'), cell('1'), cell('x')],
    );
    const keys = [0, 1, 2].map((column) => ({ column, descending: false, type: 'auto' as SortType }));
    expect(texts(sortedRows(t, { keys, headerRow: false }, EN, coll))).toEqual(['a1x', 'a1z', 'a2x', 'b1y']);
  });

  it('sorts numerically past the cells that are no number', () => {
    const t = table(...column('7', 'n/a', '10', '2'));
    expect(texts(sortedRows(t, by(0, false, 'number'), EN, coll))).toEqual(['2', '7', '10', 'n/a']);
    // Descending reverses the numbers, not the cells that have none.
    expect(texts(sortedRows(t, by(0, true, 'number'), EN, coll))).toEqual(['10', '7', '2', 'n/a']);
  });

  it('refuses a table whose cells span rows', () => {
    const spanned = table(
      [{ ...cell('a'), attrs: { colspan: 1, rowspan: 2, colwidth: null, formula: null } }, cell('b')],
      [cell('c')],
    );
    expect(canSortTable(spanned)).toBe(false);
    expect(canSortTable(table(...column('a', 'b')))).toBe(true);
    // A single row has nothing to reorder.
    expect(canSortTable(table(...column('a')))).toBe(false);
  });
});
