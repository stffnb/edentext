// Page breaks: which blocks carry one, how the editor splits at one, and how files write it.
import { describe, it, expect } from 'vitest';
import { getSchema, Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { BulletList, ListItem } from '@tiptap/extension-list';
import { Table, TableCell, TableHeader } from '@tiptap/extension-table';
import { ResizableTableRow } from '../../src/lib/editor/extensions/tableRow';
import { PageBreak } from '../../src/lib/editor/extensions/pageBreak';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { importDocx } from '../../src/lib/import/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';
import { docxOf } from '../docxFixture';

// The break attr survives only where a file can hold it: a body block or a list item.
type N = any;
const exts = [Document, Paragraph, Text, BulletList, ListItem, Table, ResizableTableRow, TableCell, TableHeader, PageBreak];
const schema = getSchema(exts);
const P = (text: string): N => ({ type: 'paragraph', attrs: { breakBefore: 'page' }, content: [{ type: 'text', text }] });

const doc = schema.nodeFromJSON({
  type: 'doc',
  content: [
    P('body'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [P('item')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [
      { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [P('cell')] }] }] },
  ],
});

describe('page break carriers', () => {
  it('clears the break in a table cell and keeps the body ones', () => {
    const plugins = (PageBreak as N).config.addProseMirrorPlugins.call({ options: { types: [] } });
    const state = EditorState.create({ schema, plugins });
    // The sweep reads what an edit brought in, as loading a file brings in everything.
    const after = state.apply(state.tr.replaceWith(0, state.doc.content.size, doc.content));
    const kept: string[] = [];
    after.doc.descendants((n) => { if (n.attrs.breakBefore === 'page') kept.push(n.textContent); });
    expect(kept).toEqual(['body', 'item']);
    // A break set in place on a cell's block goes the same way.
    let cell = -1;
    after.doc.descendants((n, pos) => { if (n.type.name === 'paragraph' && n.textContent === 'cell') cell = pos; });
    const again = after.apply(after.tr.setNodeAttribute(cell, 'breakBefore', 'page'));
    expect(again.doc.nodeAt(cell)?.attrs.breakBefore).toBeNull();
  });
});

// Enter in a block that forces a page must not give the new block the break as well:
// the attr is the break itself, not paragraph formatting that a successor inherits.
function makeEditor() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [Document, Paragraph, Text, PageBreak],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'lead' }] },
        { type: 'paragraph', attrs: { breakBefore: 'page' }, content: [{ type: 'text', text: 'page two' }] },
      ],
    },
  });
}
const breaks = (editor: Editor) => (editor.getJSON().content as N[]).map((n) => n.attrs?.breakBefore ?? null);

describe('page break before is not inherited on split', () => {
  it('leaves the block Enter opens at the end of the page-break block without one', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    editor.commands.splitBlock();
    expect(breaks(editor)).toEqual([null, 'page', null]);
    editor.destroy();
  });

  it('leaves the second half of a split page-break block without one', () => {
    const editor = makeEditor();
    editor.commands.setTextSelection(11); // between "page" and " two"
    editor.commands.splitBlock();
    expect(breaks(editor)).toEqual([null, 'page', null]);
    editor.destroy();
  });

  it('still marks the block Ctrl+Enter opens', () => {
    const editor = makeEditor();
    editor.commands.focus('end');
    editor.commands.insertPageBreak();
    expect(breaks(editor)).toEqual([null, 'page', 'page']);
    editor.destroy();
  });
});

// Where a block opening a page keeps its space above (all probed in LibreOffice): Word's
// 2013 layout drops it after a paragraph's own page break, an older file keeps it, a
// section start always does, and a page break character never leaves it.
const spaced = '<w:spacing w:before="480"/>';
const sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>';
const body = `<w:p><w:r><w:t>first</w:t></w:r></w:p>`
  + `<w:p><w:pPr><w:pageBreakBefore/>${spaced}</w:pPr><w:r><w:t>own break</w:t></w:r></w:p>`
  + `<w:p><w:pPr>${sect}</w:pPr><w:r><w:t>ends section</w:t></w:r></w:p>`
  + `<w:p><w:pPr><w:pageBreakBefore/>${spaced}</w:pPr><w:r><w:t>opens section</w:t></w:r></w:p>`
  + `<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p><w:pPr>${spaced}</w:pPr><w:r><w:t>after a break character</w:t></w:r></w:p>`;
const docx = (mode: string | null) => docxOf(body + sect, mode ? {
  settings: `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="${mode}"/></w:compat>`,
} : {});
const spaces = (doc: any): Record<string, unknown> => Object.fromEntries((doc.content as any[])
  .filter((n) => n.content?.[0]?.text && n.content[0].text !== 'first' && n.content[0].text !== 'ends section')
  .map((n) => [n.content[0].text, n.attrs?.spaceBefore]));

describe('the space above a block opening a page', () => {
  it('goes after its own break in Word 2013 layout, but not at a section start', () => {
    expect(spaces(importDocx(docx('15')).content)).toEqual({ 'own break': 0, 'opens section': 24, 'after a break character': 0 });
  });
  it('stays after its own break in an older file', () => {
    expect(spaces(importDocx(docx('14')).content)).toEqual({ 'own break': 24, 'opens section': 24, 'after a break character': 0 });
  });
  it('goes in a LibreOffice file that stores the 2013 layout as TabOverSpacing', async () => {
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'first' }] },
      { type: 'paragraph', attrs: { breakBefore: 'page', spaceBefore: 24 }, content: [{ type: 'text', text: 'own break' }] },
    ] };
    const files = unzipSync(await buildOdt(doc as any));
    expect(spaces(importOdt(zipSync(files)).content)).toEqual({ 'own break': 24 });
    const settings = strFromU8(files['settings.xml']).replace('</config:config-item-set>',
      '<config:config-item config:name="TabOverSpacing" config:type="boolean">true</config:config-item></config:config-item-set>');
    expect(spaces(importOdt(zipSync({ ...files, 'settings.xml': strToU8(settings) })).content)).toEqual({ 'own break': 0 });
  });
});

// A document odf-kit mints no automatic style for carries `<office:automatic-styles/>`,
// self-closed — replacing the closing tag silently dropped every minted style there,
// so a manual page break exported as a plain paragraph.
describe('ODF page break export', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      { type: 'paragraph', attrs: { breakBefore: 'page' }, content: [{ type: 'text', text: 'two' }] },
    ],
  };
  it('mints the break style even with no automatic styles section', async () => {
    const bytes = await buildOdt(doc as never, undefined, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    const name = /style:name="(PBK\d+)"[^>]*>\s*<style:paragraph-properties fo:break-before="page"/.exec(content)?.[1];
    expect(name).toBeTruthy();
    expect(content).toContain(`<text:p text:style-name="${name}">two`);
  });
});
