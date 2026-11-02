// What recording promises, for every kind of edit: accepting all gives what the same edit
// gives unrecorded, rejecting all gives the document back.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { zoneExtensions } from '../../src/lib/editor/extensions';
import { BLOCK_FORMAT_CASES, CASES, FORMAT_CASES, LIST_CASES, MOVE_CASES, REBUILD_CASES, REPLACE_CASES, TABLE_CASES, THREE, cells, del, edit, enter, open, select } from '../trackChangesCases';
import { revisions, settledDoc, shownRange } from '../../src/lib/editor/extensions/trackChanges';
import { commentDraft, comments } from '../../src/lib/editor/extensions/comment';
import { deriveFilename } from '../../src/lib/storage/documentName';
import { setRecordChanges } from '../../src/lib/storage/trackChanges.svelte';
import { searchKey } from '../../src/lib/editor/extensions/searchReplace';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { importOdt } from '../../src/lib/import/odt';
import { DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';

// A file always states column widths; what a removed column leaves of them is the same
// edit. A new note or box draws its own id.
const shape = (e: Editor) => JSON.parse(JSON.stringify(e.getJSON(), (k, v) => (k === 'colwidth' || k === 'id' ? undefined : v)));

const FORMATS: [string, (doc: any) => Promise<unknown>][] = [
  ['DOCX', async (doc) => importDocx(await buildDocx(doc, DEFAULT_MARGINS)).content],
  ['ODT', async (doc) => importOdt(await buildOdt(doc, DEFAULT_MARGINS)).content],
];

const TABLE = '<table><tbody><tr><td><p>a1</p></td><td><p>b1</p></td></tr><tr><td><p>a2</p></td><td><p>b2</p></td></tr></tbody></table><p>tail</p>';
const GRID = '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr><tr><td><p>d</p></td><td><p>e</p></td><td><p>f</p></td></tr></tbody></table><p>tail</p>';
type Act = (e: Editor) => unknown;

afterEach(() => setRecordChanges(false));

describe('a comment being written', () => {
  // "one two three", with "two" selected.
  const writing = () => {
    const e = open('<p>one two three</p>');
    e.commands.setTextSelection({ from: 5, to: 8 });
    e.commands.startCommentDraft();
    return e;
  };

  it.each<[string, (e: Editor) => void, string | null]>([
    ['stands where it was opened', () => {}, 'two'],
    ['follows an edit before it', (e) => { e.commands.insertContentAt(1, 'zero '); }, 'two'],
    ['survives the caret moving away', (e) => { e.commands.setTextSelection(1); }, 'two'],
    ['ends with its text', (e) => { e.commands.deleteRange({ from: 4, to: 9 }); }, null],
    ['ends when cancelled', (e) => { e.commands.cancelCommentDraft(); }, null],
  ])('%s', (_name, step, quote) => {
    const e = writing();
    step(e);
    expect(commentDraft(e.state)?.quote ?? null).toBe(quote);
    expect(comments(e.state.doc)).toEqual([]);
    expect(e.commands.submitCommentDraft({ author: 'A', text: 'first\nsecond' })).toBe(quote !== null);
    expect(comments(e.state.doc).map((c) => [c.quote, c.text])).toEqual(quote ? [[quote, 'first\nsecond']] : []);
    expect(commentDraft(e.state)).toBeNull();
  });

  it('leaves the history alone until it is added, then is one step', () => {
    const e = writing();
    const before = e.getJSON();
    e.commands.cancelCommentDraft();
    expect(e.can().undo()).toBe(false);
    e.commands.startCommentDraft();
    e.commands.submitCommentDraft({ author: 'A', text: 'x' });
    e.commands.undo();
    expect(e.getJSON()).toEqual(before);
    expect(e.can().undo()).toBe(false);
  });
});

describe('recording keeps its promise', () => {
  it.each(CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    const start = open(html).getJSON();

    setRecordChanges(true);
    const accepted = open(html);
    await edit(accepted, steps);
    const recorded = accepted.getJSON();
    expect(revisions(accepted.state.doc).length).toBeGreaterThan(0);
    setRecordChanges(false);

    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(start);
    for (const [format, through] of FORMATS) {
      // ODF has no mark across a change of list level: LibreOffice's form loses the list side.
      if (format === 'ODT' && /from a list|sub-list$/.test(_name) && !_name.startsWith('Enter')) continue;
      const reread = open(await through(recorded));
      reread.commands.rejectRevisions(true);
      expect(reread.getJSON(), `${format}, rejected`).toEqual(open(await through(start)).getJSON());
      const rereadAccepted = open(await through(recorded));
      rereadAccepted.commands.acceptRevisions(true);
      expect(rereadAccepted.getJSON(), `${format}, accepted`).toEqual(open(await through(plain.getJSON())).getJSON());
    }

    accepted.commands.acceptRevisions(true);
    expect(accepted.getJSON()).toEqual(plain.getJSON());
  });

  it.each(FORMAT_CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    expect(revisions(e.state.doc).map((r) => r.kind)).toEqual(['formatChange']);
    setRecordChanges(false);
    const recorded = e.getJSON(), start = open(html).getJSON();
    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(start);
    for (const [format, through] of FORMATS) {
      const reread = open(await through(recorded));
      expect(revisions(reread.state.doc).map((r) => r.kind), format).toContain('formatChange');
      reread.commands.rejectRevisions(true);
      // ODF holds no old values: rejecting there drops the run's direct formatting.
      if (format === 'DOCX') expect(reread.getJSON(), `${format}, rejected`).toEqual(open(await through(start)).getJSON());
      else expect(revisions(reread.state.doc)).toEqual([]);
      const taken = open(await through(recorded));
      taken.commands.acceptRevisions(true);
      expect(taken.getJSON(), `${format}, accepted`).toEqual(open(await through(plain.getJSON())).getJSON());
    }
    e.commands.acceptRevisions(true);
    expect(e.getJSON()).toEqual(plain.getJSON());
  });

  it.each(BLOCK_FORMAT_CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    expect(revisions(e.state.doc).map((r) => r.kind)).toEqual(['formatChange']);
    setRecordChanges(false);
    const recorded = e.getJSON(), start = open(html).getJSON();
    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(start);
    const [[, docx], [, odt]] = FORMATS;
    const reread = open(await docx(recorded));
    expect(revisions(reread.state.doc).map((r) => r.kind)).toEqual(['formatChange']);
    reread.commands.rejectRevisions(true);
    expect(reread.getJSON(), 'DOCX, rejected').toEqual(open(await docx(start)).getJSON());
    const taken = open(await docx(recorded));
    taken.commands.acceptRevisions(true);
    expect(taken.getJSON(), 'DOCX, accepted').toEqual(open(await docx(plain.getJSON())).getJSON());
    // ODF has no form for it that LibreOffice reads back: the format stays, the record goes.
    expect(open(await odt(recorded)).getJSON()).toEqual(open(await odt(plain.getJSON())).getJSON());
    e.commands.acceptRevisions(true);
    expect(e.getJSON()).toEqual(plain.getJSON());
  });

  it.each(LIST_CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    expect(revisions(e.state.doc).map((r) => r.kind)).toContain('formatChange');
    expect(revisions(e.state.doc).every((r) => r.kind === 'formatChange')).toBe(true);
    setRecordChanges(false);
    const recorded = e.getJSON();
    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(open(html).getJSON());
    const [[, docx]] = FORMATS;
    const reread = open(await docx(recorded));
    expect(revisions(reread.state.doc).length > 0).toBe(/made a list/.test(_name));
    if (/made a list/.test(_name)) {
      reread.commands.rejectRevisions(true);
      expect(reread.getJSON(), 'DOCX, rejected').toEqual(open(await docx(open(html).getJSON())).getJSON());
    }
    e.commands.acceptRevisions(true);
    expect(e.getJSON()).toEqual(plain.getJSON());
  });

  it.each(MOVE_CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    setRecordChanges(false);
    const moved = revisions(e.state.doc);
    expect(moved.map((r) => r.moved)).toEqual([true, true]);
    expect(moved[0].moveId).toBe(moved[1].moveId);
    const recorded = e.getJSON();
    // One half settles the pair.
    const rejected = open(recorded);
    rejected.commands.rejectRevision(moved[1].id);
    expect(rejected.getJSON()).toEqual(open(html).getJSON());
    for (const [format, through] of FORMATS) {
      const reread = open(await through(recorded));
      const halves = revisions(reread.state.doc);
      expect(halves.every((r) => r.moved), format).toBe(true);
      expect(new Set(halves.map((r) => r.moveId)).size, format).toBe(1);
      reread.commands.acceptRevision(halves[0].id);
      expect(reread.getJSON(), `${format}, accepted`).toEqual(open(await through(plain.getJSON())).getJSON());
      const back = open(await through(recorded));
      back.commands.rejectRevision(halves[0].id);
      expect(back.getJSON(), `${format}, rejected`).toEqual(open(await through(open(html).getJSON())).getJSON());
    }
    e.commands.acceptRevision(moved[0].id);
    expect(e.getJSON()).toEqual(plain.getJSON());
  });

  it.each([...CASES, ...FORMAT_CASES, ...MOVE_CASES])('a comment stays on the change through ODT: %s', async (_name, html, steps) => {
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    setRecordChanges(false);
    const start = revisions(e.state.doc);
    for (const r of start) e.commands.commentRevision(r.id, 'first\nsecond');
    const pending = e.getJSON();
    expect(revisions(e.state.doc).map((r) => r.comment)).toEqual(start.map(() => 'first\nsecond'));
    expect(revisions(open(await FORMATS[1][1](pending)).state.doc).every((r) => r.comment === 'first\nsecond')).toBe(true);
    // Taken off, nothing but the change is left.
    for (const r of start) e.commands.commentRevision(r.id, '');
    expect(revisions(e.state.doc).map((r) => [r.id, r.comment])).toEqual(start.map((r) => [r.id, undefined]));
  });

  // A header goes through both files by its own path: the same promise, there.
  // A zone has no chapters, so the navigator's cases stay in the body.
  it.each(CASES.filter(([name]) => !name.includes('navigator')))('in a header: %s', async (_name, html, steps) => {
    const zone = (content: unknown, live = false) => {
      const element = document.body.appendChild(document.createElement('div'));
      return new Editor({ element, extensions: zoneExtensions('', live), content: content as string });
    };
    const plain = zone(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = zone(html, true);
    await edit(e, steps);
    expect(revisions(e.state.doc).length).toBeGreaterThan(0);
    setRecordChanges(false);
    const recorded = e.getJSON(), start = zone(html).getJSON();
    const body = open('<p>body</p>').getJSON() as any;
    const hf = (header: unknown) => ({ header, footer: null, pageCount: 1 }) as any;
    const files: [string, (doc: unknown) => Promise<unknown>][] = [
      ['DOCX', async (doc) => importDocx(await buildDocx(body, DEFAULT_MARGINS, 'portrait', hf(doc))).header],
      ['ODT', async (doc) => importOdt(await buildOdt(body, DEFAULT_MARGINS, 'portrait', hf(doc))).header],
    ];
    for (const [format, through] of files) {
      if (format === 'ODT' && /from a list|sub-list$/.test(_name) && !_name.startsWith('Enter')) continue;
      const rejected = zone(await through(recorded));
      expect(revisions(rejected.state.doc).length, format).toBeGreaterThan(0);
      rejected.commands.rejectRevisions(true);
      expect(rejected.getJSON(), `${format}, rejected`).toEqual(zone(await through(start)).getJSON());
      const accepted = zone(await through(recorded));
      accepted.commands.acceptRevisions(true);
      expect(accepted.getJSON(), `${format}, accepted`).toEqual(zone(await through(plain.getJSON())).getJSON());
    }
  });

  it('a format put back leaves no change, and the first record stands', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, [(ed) => select(ed, 2, 4), (ed) => ed.commands.setBold(), (ed) => ed.commands.unsetBold()]);
    expect(revisions(e.state.doc)).toEqual([]);
    await edit(e, [(ed) => ed.commands.setBold(), (ed) => ed.commands.setItalic()]);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(THREE).getJSON());
  });

  it('formatting the own insertion is no change of its own', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, [(ed) => select(ed, 3), (ed) => ed.commands.insertContent('new'), (ed) => select(ed, 3, 6), (ed) => ed.commands.setBold()]);
    expect(revisions(e.state.doc).map((r) => r.kind)).toEqual(['insertion']);
  });

  it.each(TABLE_CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    const recorded = e.getJSON();
    expect(revisions(e.state.doc)).toHaveLength(1);
    setRecordChanges(false);
    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(open(html).getJSON());
    for (const [format, through] of FORMATS) {
      const reread = open(await through(recorded));
      expect(revisions(reread.state.doc), `${format}, read`).toHaveLength(1);
      reread.commands.rejectRevisions(true);
      expect(shape(reread), `${format}, rejected`).toEqual(shape(open(await through(open(html).getJSON()))));
      const rereadAccepted = open(await through(recorded));
      rereadAccepted.commands.acceptRevisions(true);
      expect(shape(rereadAccepted), `${format}, accepted`).toEqual(shape(open(await through(plain.getJSON()))));
    }
    e.commands.acceptRevisions(true);
    expect(shape(e)).toEqual(shape(plain));
  });

  it.each<[string, boolean, (e: Editor) => unknown, number]>([
    ['Enter at a heading start', true, (e) => e.commands.splitBlock(), 2],
    ['clearing the block type', true, (e) => e.commands.clearNodes(), 1],
    ['clearing the block type, not recording', false, (e) => e.commands.clearNodes(), 1],
  ])('a block keeps what is recorded on it: %s', async (_name, recording, act, marks) => {
    const rev = { id: 'x', author: 'Other', date: '2026-05-06T07:08:00Z' };
    const e = open({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, revMark: { insertion: rev } }, content: [{ type: 'text', text: 'head' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'tail' }] }] });
    setRecordChanges(recording);
    await edit(e, [(ed) => select(ed, 1), act]);
    setRecordChanges(false);
    expect(e.getJSON().content!.filter((b) => b.attrs?.revMark)).toHaveLength(marks);
    e.commands.rejectRevisions(true);
    expect(e.getJSON().content!.map((b) => b.content?.[0].text)).toEqual(['headtail']);
  });

  it('a page break left behind by Enter is no change of the second half', async () => {
    const e = open('<h1>Head</h1><p>tail</p>');
    e.commands.setPageBreakBefore();
    const start = e.getJSON();
    setRecordChanges(true);
    await edit(e, [(ed) => select(ed, 3), (ed) => ed.commands.splitBlock()]);
    setRecordChanges(false);
    expect(revisions(e.state.doc).map((r) => r.kind)).toEqual(['insertion']);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(start);
  });

  it('a row gathers its own text, not what the same author did elsewhere at that moment', () => {
    const rev = (id: string) => ({ id, author: 'A', date: '2026-05-06T07:08:00Z' });
    const ins = (id: string, text: string) => ({ type: 'text', text, marks: [{ type: 'insertion', attrs: rev(id) }] });
    const para = (...content: object[]) => ({ type: 'paragraph', content });
    const table = (id: string, text: string) => ({ type: 'table', content: [{ type: 'tableRow', attrs: { revMark: { insertion: rev(id) } },
      content: [{ type: 'tableCell', content: [para(ins(`${id}t`, text))] }] }] });
    const e = open({ type: 'doc', content: [para(ins('a', 'far')), para({ type: 'text', text: 'between' }), table('b', 'x'), para({ type: 'text', text: 'between' }), table('c', 'y'), para(ins('d', 'far'))] });
    expect(revisions(e.state.doc).map((r) => r.text)).toEqual(['far', 'x', 'y', 'far']);
    e.commands.acceptRevision(revisions(e.state.doc)[1].id);
    expect(revisions(e.state.doc)).toHaveLength(3);
  });

  it('typing over a selection through a table takes no column along', async () => {
    const html = '<table><tbody><tr><td><p>a1</p></td><td><p>b1</p></td></tr><tr><td><p>a2</p></td><td><p>b2</p></td></tr></tbody></table><p>t</p>';
    setRecordChanges(true);
    const e = open(html);
    await edit(e, [(ed) => select(ed, 5, 19), (ed) => ed.view.dispatch(ed.state.tr.insertText('z'))]);
    setRecordChanges(false);
    const rejected = open(e.getJSON());
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(open(html).getJSON());
    e.commands.acceptRevisions(true);
    expect(e.state.doc.textContent).toContain('b2');
  });

  it('a struck row someone typed into stays', async () => {
    setRecordChanges(true);
    const e = open('<table><tbody><tr><td><p>a1</p></td></tr><tr><td><p>a2</p></td></tr></tbody></table><p>t</p>');
    await edit(e, [(ed) => select(ed, 5), (ed) => ed.commands.deleteRow(), (ed) => select(ed, 5), (ed) => ed.commands.insertContent('new')]);
    setRecordChanges(false);
    e.commands.acceptRevisions(true);
    expect(e.state.doc.textContent).toContain('new');
    expect(revisions(e.state.doc)).toEqual([]);
  });

  it.each(REPLACE_CASES)('%s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    const recorded = e.getJSON();
    setRecordChanges(false);
    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(open(html).getJSON());
    e.commands.acceptRevisions(true);
    expect(revisions(e.state.doc)).toEqual([]);
    expect(shape(e)).toEqual(shape(plain));
  });

  it('records a note put over a selection into a table', async () => {
    const lost = vi.spyOn(console, 'error');
    const html = '<p>head</p><table><tbody><tr><td><p>a1</p></td></tr><tr><td><p>a2long</p></td></tr></tbody></table><p>tail</p>';
    setRecordChanges(true);
    const e = open(html);
    await edit(e, [(ed) => select(ed, 3, 21), (ed) => ed.commands.insertNote('footnote')]);
    const recorded = e.getJSON();
    setRecordChanges(false);
    expect(lost.mock.calls.filter(([m]) => String(m).startsWith('Recording would lose'))).toEqual([]);
    lost.mockRestore();
    const rejected = open(recorded);
    rejected.commands.rejectRevisions(true);
    expect(rejected.getJSON()).toEqual(open(html).getJSON());
  });

  it.each<[string, (e: Editor) => unknown]>([
    ['note', (e) => e.commands.insertNote('footnote')],
    ['text box', (e) => e.commands.insertTextBox()],
  ])('a deleted %s comes back and goes', async (_name, insert) => {
    const e = open(THREE);
    await edit(e, [(ed) => select(ed, 3), insert]);
    const start = e.getJSON();
    const end = 3 + e.state.doc.child(0).child(1).nodeSize;
    setRecordChanges(true);
    await edit(e, del(2, end + 1));
    const recorded = e.getJSON();
    setRecordChanges(false);
    for (const [, through] of [['here', async (d: unknown) => d], ...FORMATS] as typeof FORMATS) {
      const rejected = open(await through(recorded));
      rejected.commands.rejectRevisions(true);
      expect(shape(rejected)).toEqual(shape(open(await through(start))));
      const accepted = open(await through(recorded));
      accepted.commands.acceptRevisions(true);
      expect(accepted.getJSON().content?.[0].content?.map((n) => n.type)).toEqual(['text']);
    }
  });

  // No file holds a paragraph mark in front of a table: the split itself survives only here.
  it('a table splitting a paragraph goes with the split', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, [(ed) => select(ed, 9), (ed) => ed.commands.insertTable({ rows: 1, cols: 1, withHeaderRow: false })]);
    expect(revisions(e.state.doc)).toHaveLength(1);
    setRecordChanges(false);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(THREE).getJSON());
  });

  it('one typed passage over a paragraph break is one change', async () => {
    setRecordChanges(true);
    const e = open('<p>x</p>');
    await edit(e, [(ed) => select(ed, 2), (ed) => ed.commands.insertContent('one'), (ed) => ed.commands.splitBlock(), (ed) => ed.commands.insertContent('two')]);
    expect(revisions(e.state.doc).map((r) => r.text)).toEqual(['one\ntwo']);
  });

  it('taking back the own paragraph break leaves nothing recorded', async () => {
    setRecordChanges(true);
    const e = open('<p>abcd</p>');
    await edit(e, [(ed) => select(ed, 3), (ed) => ed.commands.splitBlock(), (ed) => ed.commands.joinBackward()]);
    expect(revisions(e.state.doc)).toEqual([]);
    expect(e.getJSON()).toEqual(open('<p>abcd</p>').getJSON());
  });

  it('a paragraph style leaves the recorded mark alone', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, [...del(5, 7), (ed) => select(ed, 2), (ed) => ed.commands.setParagraphStyle('Heading 1')]);
    expect(e.state.doc.firstChild!.attrs.revMark?.deletion).toBeTruthy();
    expect(e.state.doc.firstChild!.attrs.styleName).toBe('Heading 1');
  });

  it('a settled copy is what accepting or rejecting gives', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, del(3, 9));
    const [doc, accepted] = [e.state.doc, open(e.getJSON())];
    setRecordChanges(false);
    accepted.commands.acceptRevisions(true);
    expect(settledDoc(doc, true).toJSON()).toEqual(accepted.getJSON());
    expect(settledDoc(doc, false).toJSON()).toEqual(open(THREE).getJSON());
  });

  it.each(REBUILD_CASES)('nothing to record: %s', async (_name, html, steps) => {
    const plain = open(html);
    await edit(plain, steps);
    setRecordChanges(true);
    const e = open(html);
    await edit(e, steps);
    expect(revisions(e.state.doc)).toEqual([]);
    expect(shape(e)).toEqual(shape(plain));
  });

  // What the merge took in goes with its change; all else stays, however the cells lay.
  it.each<[string, string, Act[], boolean, string]>([
    ['a struck row', TABLE, [(x) => select(x, 19), (x) => x.commands.deleteRow(), cells(0, 2)], true, 'a1b1'],
    ['a struck row above', TABLE, [(x) => select(x, 5), (x) => x.commands.deleteRow(), cells(0, 2)], true, 'a2b2'],
    ['a struck column on the right', TABLE, [(x) => select(x, 10), (x) => x.commands.deleteColumn(), cells(0, 1)], true, 'a1a2'],
    ['a struck column on the left', TABLE, [(x) => select(x, 5), (x) => x.commands.deleteColumn(), cells(0, 1)], true, 'b1b2'],
    ['two struck columns', GRID, [cells(0, 1), (x) => x.commands.deleteColumn(), cells(0, 1)], true, 'cf'],
    ['a cell of struck text', TABLE, [(x) => select(x, 4, 6), (x) => x.commands.deleteSelection(), cells(0, 1)], true, 'b1a2b2'],
    ['a new column on the left', TABLE, [(x) => select(x, 5), (x) => x.commands.addColumnBefore(), cells(0, 1)], false, 'a1b1a2b2'],
    ['a new column on the right', TABLE, [(x) => select(x, 5), (x) => x.commands.addColumnAfter(), cells(0, 1)], false, 'a1b1a2b2'],
    ['a new row', TABLE, [(x) => select(x, 5), (x) => x.commands.addRowBefore(), cells(0, 2)], false, 'a1b1a2b2'],
    ['a cell of new text', TABLE, [(x) => select(x, 6), (x) => x.commands.insertContent('n'), cells(0, 1)], false, 'a1b1a2b2'],
  ])('merging cells with %s', async (_name, html, steps, accepting, left) => {
    setRecordChanges(true);
    const e = open(html);
    await edit(e, [...steps, (x) => x.commands.mergeCells()]);
    const recorded = e.getJSON();
    setRecordChanges(false);
    const inTable = (x: Editor) => x.state.doc.firstChild!.type.name === 'table' ? x.state.doc.firstChild! : null;
    const letters = (x: Editor) => [...(inTable(x)?.textContent ?? '')].sort();
    const emptyBeside = (x: Editor) => {
      let extra = 0;
      inTable(x)!.descendants((n) => { if (n.type.spec.tableRole === 'cell' && n.childCount > 1) n.forEach((b) => { if (!b.textContent) extra++; }); });
      return extra;
    };
    for (const [format, through] of [['here', async (doc: unknown) => doc], ...FORMATS] as typeof FORMATS) {
      const settled = open(await through(recorded));
      if (accepting) settled.commands.acceptRevisions(true); else settled.commands.rejectRevisions(true);
      expect(letters(settled), format).toEqual([...left].sort());
      expect(emptyBeside(settled), format).toBe(0);
      expect(revisions(settled.state.doc), format).toEqual([]);
    }
  });

  it.each([['an item with text', 12], ['an empty item', 7]])('Backspace at the start of %s', async (_name, at) => {
    setRecordChanges(true);
    const html = at === 7 ? '<ul><li><p>a</p></li><li><p></p></li></ul><p>t</p>' : '<ul><li><p>one</p></li><li><p>two</p></li></ul><p>t</p>';
    const e = open(html);
    await edit(e, [(x) => select(x, at === 7 ? 8 : at), (x) => x.commands.joinItemBackward()]);
    expect(revisions(e.state.doc)).toHaveLength(1);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(html).getJSON());
  });

  it.each([
    ['struck text', '<p>1. text</p>', (e: Editor) => { select(e, 1, 3); e.commands.deleteSelection(); }, 3],
    ['text that was there', '<p>1.</p>', () => {}, 3],
  ])('an input rule leaves alone %s', async (_name, html, before, at) => {
    setRecordChanges(true);
    const e = open(html);
    await edit(e, [before, (x) => select(x, at), (x) => x.view.someProp('handleTextInput', (f) => f(x.view, at, at, ' '))]);
    expect(e.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(e.getText()).toContain(' ');
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(html).getJSON());
  });

  it('rejecting brings a lifted item back to its sub-list', async () => {
    setRecordChanges(true);
    const html = '<p>x</p><ul><li><p>one</p><ul><li><p>sub</p></li></ul></li></ul><p>t</p>';
    const e = open(html);
    await edit(e, [(x) => select(x, 6), (x) => x.commands.liftListItem('listItem')]);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(html).getJSON());
  });

  it('typing over a paragraph and an item with a sub-list rejects whole', async () => {
    setRecordChanges(true);
    const html = '<p>aa</p><ul><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ul><p>t</p>';
    const e = open(html);
    await edit(e, [(x) => select(x, 2, 9), (x) => x.commands.insertContent('n')]);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(html).getJSON());
  });

  it('a block coming in whole leaves the next one its mark', async () => {
    setRecordChanges(true);
    const e = open('<p>aa</p><p>bb</p>');
    const rev = { insertion: { id: 'x', author: 'Other', date: '2026-05-06T07:08:00Z' } };
    const block = e.schema.nodes.paragraph.create({ revMark: rev }, e.schema.text('new'));
    await edit(e, [(x) => x.view.dispatch(x.state.tr.insert(4, block))]);
    expect(e.state.doc.child(2).attrs.revMark).toBeNull();
  });

  it('typing over blocks and a browser rebuilding a list item is text', async () => {
    setRecordChanges(true);
    const html = '<p>head</p><ul><li><p>one</p><ul><li><p>sub</p></li></ul></li></ul><p>t</p>';
    const e = open(html);
    select(e, 1, 9);
    await edit(e, [(x) => x.view.dispatch(x.state.tr.replace(0, 9, new Slice(Fragment.from(e.schema.nodes.bulletList.create(null, e.schema.nodes.listItem.create(null, e.schema.nodes.paragraph.create(null, e.schema.text('x'))))), 0, 3)))]);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(html).getJSON());
  });

  it('Delete at a struck paragraph mark leaves it struck', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, [(x) => select(x, 7), (x) => x.commands.joinBackward()]);
    const marks = revisions(e.state.doc).length;
    const error = console.error;
    const errors: unknown[] = [];
    console.error = (m) => errors.push(m);
    await edit(e, [(x) => select(x, 5), (x) => x.commands.joinForward()]);
    console.error = error;
    expect(errors).toEqual([]);
    expect(revisions(e.state.doc)).toHaveLength(marks);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(THREE).getJSON());
  });

  it('striking one\'s own Enter keeps a page break', async () => {
    setRecordChanges(true);
    const html = '<p>aa</p><h1 data-page-break-before="page">Head</h1><p>tail</p>';
    const e = open(html);
    await edit(e, [(x) => select(x, 5), (x) => x.commands.insertContent('new'), (x) => x.commands.splitBlock(), (x) => select(x, 2, 15), (x) => x.commands.deleteSelection()]);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(html).getJSON());
  });

  it('a paragraph before an empty one can become a list', () => {
    for (const [html, at] of [['<p>a</p><p></p>', 1], ['<p></p><p>c</p>', 1]] as const) {
      const e = open(html);
      select(e, at);
      expect(e.commands.toggleBulletList()).toBe(true);
      expect(e.state.doc.firstChild!.type.name).toBe('bulletList');
    }
  });

  it('a list a paragraph joins stays what it was', () => {
    const e = open('<p>more</p><ul data-list-style-name="Named"><li><p>one</p></li></ul>');
    select(e, 2);
    e.commands.toggleBulletList();
    expect(e.state.doc.firstChild!.attrs.listStyleName).toBe('Named');
    expect(e.state.doc.firstChild!.childCount).toBe(2);
  });

  it('a block split in two hands its mark to the second half', async () => {
    setRecordChanges(true);
    const e = open(THREE);
    await edit(e, [...del(5, 7), ...enter(3)]);
    setRecordChanges(false);
    e.commands.rejectRevisions(true);
    expect(e.getJSON()).toEqual(open(THREE).getJSON());
  });
});

// Struck text waits to go: whatever reads the document reads it as gone.
describe('struck text is not there', () => {
  const NUMS = '<table><tbody><tr><td><p>10</p></td></tr><tr><td><p>20</p></td></tr><tr><td><p></p></td></tr></tbody></table><p>tail</p>';
  const struck = async (html: string, from: number, to: number) => {
    setRecordChanges(true);
    const e = open(html);
    await edit(e, del(from, to));
    setRecordChanges(false);
    return e;
  };
  const texts = (e: Editor) => { const o: string[] = []; e.state.doc.descendants((n) => { if (n.isTextblock) o.push(n.textContent); return !n.isTextblock; }); return o; };
  const find = (e: Editor, term: string) => {
    e.commands.setSearch({ term, matchCase: false, wholeWord: false, useRegex: false });
    return searchKey.getState(e.state)!.matches.length;
  };

  it('a formula does not count it', async () => {
    const e = await struck(NUMS, 4, 5);
    await edit(e, [(ed) => select(ed, 20), (ed) => ed.commands.setCellFormula('=SUM(A1:A2)')]);
    await new Promise((r) => setTimeout(r));
    expect(texts(e)[2]).toBe('20');
  });

  it('a selection and a file name do not read it', async () => {
    const e = await struck('<h1>old new</h1><p>t</p>', 1, 5);
    expect(shownRange(e.state.doc, 1, 8)).toBe('new');
    expect(shownRange(e.state.doc, 1, 5)).toBe('old ');
    expect(deriveFilename(e.getJSON())).toBe('new.odt');
  });

  it('typing does not read it', async () => {
    const e = await struck('<p>foo bar. now</p><p>t</p>', 5, 9);
    select(e, 13);
    e.view.someProp('handleTextInput', (f) => f(e.view, 13, 13, ' ', () => e.state.tr));
    expect(e.state.doc.firstChild!.textContent).not.toContain('Now');
  });

  it('a sort does not read it', async () => {
    const e = await struck('<table><tbody><tr><td><p>xb</p></td></tr><tr><td><p>a</p></td></tr></tbody></table><p>t</p>', 4, 5);
    await edit(e, [(ed) => select(ed, 4), (ed) => ed.commands.sortTable({ keys: [{ column: 0, type: 'text', descending: true }], headerRow: false })]);
    expect(texts(e)[0]).toBe('xb');
  });

  it('a search reads past it and leaves it', async () => {
    const e = await struck('<p>aXXb foo</p><p>t</p>', 2, 4);
    expect(find(e, 'xx')).toBe(0);
    expect(find(e, 'ab')).toBe(1);
    setRecordChanges(true);
    await edit(e, [(ed) => ed.commands.replaceAll('q')]);
    setRecordChanges(false);
    const rejected = open(e.getJSON()), accepted = open(e.getJSON());
    rejected.commands.rejectRevisions(true);
    accepted.commands.acceptRevisions(true);
    expect(texts(rejected)[0]).toBe('aXXb foo');
    expect(texts(accepted)[0]).toBe('q foo');
  });

  it.each([
    ['part of a selection', 1, 5, 'ab'],
    ['all of a selection', 2, 4, 'XX'],
  ])('a copy leaves it out: %s', async (_name, from, to, text) => {
    const e = await struck('<p>aXXb</p><p>t</p>', 2, 4);
    const { dom } = e.view.serializeForClipboard(e.state.doc.slice(from, to));
    const pasted = open('<p></p>');
    pasted.view.pasteHTML(dom.innerHTML, new Event('paste') as ClipboardEvent);
    expect(texts(pasted)[0]).toBe(text);
    expect(revisions(pasted.state.doc)).toEqual([]);
  });
});
