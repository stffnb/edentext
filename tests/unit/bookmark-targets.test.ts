// A cross-reference is only as good as its target: both formats nest bookmark ranges and
// set them on a point, and LibreOffice writes its own cross-references against reference
// marks. Each of those has to come back as a target the editor can jump to.
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { Editor, getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import { Bookmark, bookmarks, findTarget } from '../../src/lib/editor/extensions/bookmark';
import { extensions } from '../../src/lib/editor/extensions';
import { adoptableBookmark } from '../../src/lib/editor/extensions/crossReference';
import { importDocx } from '../../src/lib/import/docx';
import { importOdt } from '../../src/lib/import/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { buildOdt } from '../../src/lib/export/odt';
import { DEFAULT_MARGINS } from '../../src/lib/storage/pageMargins';

type N = { type: string; attrs?: any; content?: N[]; marks?: any[]; text?: string };

const docxOf = (body: string) => zipSync({
  'word/document.xml': strToU8(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`),
});

const odtOf = (body: string) => zipSync({
  mimetype: strToU8('application/vnd.oasis.opendocument.text'),
  'content.xml': strToU8(`<?xml version="1.0"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink">
  <office:body><office:text>${body}</office:text></office:body>
</office:document-content>`),
}, { level: 0 });

function walk(node: N, type: string, out: N[] = []): N[] {
  if (node.type === type) out.push(node);
  for (const c of node.content ?? []) walk(c, type, out);
  return out;
}
const named = (doc: N, text: string): string[] =>
  walk(doc, 'text').filter((t) => t.text === text)
    .flatMap((t) => (t.marks ?? []).filter((m: any) => m.type === 'bookmark').map((m: any) => m.attrs.name));

describe('DOCX bookmark targets', () => {
  it('keeps every bookmark a run sits in, not only the outermost', () => {
    const back = importDocx(docxOf(
      '<w:p><w:bookmarkStart w:id="1" w:name="outer"/><w:bookmarkStart w:id="2" w:name="inner"/>'
      + '<w:r><w:t>Target</w:t></w:r>'
      + '<w:bookmarkEnd w:id="2"/><w:bookmarkEnd w:id="1"/></w:p>',
    )).content as unknown as N;
    expect(named(back, 'Target').sort()).toEqual(['inner', 'outer']);
  });

  it('carries a bookmark set on a point onto the next run', () => {
    const back = importDocx(docxOf(
      '<w:p><w:bookmarkStart w:id="3" w:name="_Ref1"/><w:bookmarkEnd w:id="3"/>'
      + '<w:r><w:t>Heading</w:t></w:r></w:p>',
    )).content as unknown as N;
    expect(named(back, 'Heading')).toEqual(['_Ref1']);
  });
});

describe('ODF bookmark and reference-mark targets', () => {
  it('reads point bookmarks, empty ranges and reference marks as targets', () => {
    const back = importOdt(odtOf(
      '<text:p><text:bookmark text:name="point"/>'
      + '<text:bookmark-start text:name="empty"/><text:bookmark-end text:name="empty"/>'
      + '<text:reference-mark-start text:name="ref"/>One<text:reference-mark-end text:name="ref"/></text:p>'
      + '<text:p><text:reference-mark text:name="mark"/>Two</text:p>',
    )).content as unknown as N;
    expect(named(back, 'One').sort()).toEqual(['empty', 'point', 'ref']);
    expect(named(back, 'Two')).toEqual(['mark']);
  });

  it('reads a reference-ref as a cross-reference, like a bookmark-ref', () => {
    const back = importOdt(odtOf(
      '<text:p><text:reference-mark-start text:name="ref"/>One<text:reference-mark-end text:name="ref"/></text:p>'
      + '<text:p>See <text:reference-ref text:reference-format="text" text:ref-name="ref">One</text:reference-ref>'
      + ' on page <text:reference-ref text:reference-format="page" text:ref-name="ref">1</text:reference-ref></text:p>',
    )).content as unknown as N;
    expect(walk(back, 'crossRef').map((r) => [r.attrs.name, r.attrs.format])).toEqual([['ref', 'text'], ['ref', 'page']]);
  });
});

describe('overlapping bookmarks survive a round trip', () => {
  const doc: N = {
    type: 'doc',
    content: [{
      type: 'paragraph',
      attrs: {},
      content: [
        { type: 'text', text: 'Key ', marks: [{ type: 'bookmark', attrs: { name: 'outer' } }] },
        {
          type: 'text',
          text: 'figures',
          marks: [{ type: 'bookmark', attrs: { name: 'outer' } }, { type: 'bookmark', attrs: { name: 'inner' } }],
        },
      ],
    }],
  };

  it('through DOCX', async () => {
    const bytes = await buildDocx(doc as any, DEFAULT_MARGINS, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('w:name="outer"');
    expect(xml).toContain('w:name="inner"');
    const back = importDocx(bytes).content as unknown as N;
    expect(named(back, 'figures').sort()).toEqual(['inner', 'outer']);
  });

  it('through ODF', async () => {
    const bytes = await buildOdt(doc as any, DEFAULT_MARGINS, 'portrait');
    const content = strFromU8(unzipSync(bytes)['content.xml']);
    expect(content).toContain('<text:bookmark-start text:name="inner"/>');
    expect(content).toContain('<text:bookmark-end text:name="inner"/>');
    const back = importOdt(bytes).content as unknown as N;
    expect(named(back, 'figures').sort()).toEqual(['inner', 'outer']);
  });
});

describe('a name Word would not take', () => {
  it('maps target and reference to the same legal one', async () => {
    const doc: N = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'Here', marks: [{ type: 'bookmark', attrs: { name: 'Moving toolbars' } }] }] },
        { type: 'paragraph', attrs: {}, content: [{ type: 'crossRef', attrs: { name: 'Moving toolbars', format: 'text', text: 'Here' } }] },
      ],
    };
    const bytes = await buildDocx(doc as any, DEFAULT_MARGINS, 'portrait');
    const xml = strFromU8(unzipSync(bytes)['word/document.xml']);
    expect(xml).toContain('w:name="Moving_toolbars"');
    expect(xml).toMatch(/REF Moving_toolbars \\h/);

    const back = importDocx(bytes).content as unknown as N;
    expect(named(back, 'Here')).toEqual(['Moving_toolbars']);
    expect(walk(back, 'crossRef')[0].attrs.name).toBe('Moving_toolbars');
  });
});

// Word ends a TOC bookmark inside the *next* heading, so one name covers dozens of
// blocks — and a reference stores nothing but the name.
describe('adopting a bookmark for a reference', () => {
  const schema = getSchema([Document, Paragraph, Text, Heading, Bookmark]);
  const mark = (name: string) => schema.marks.bookmark.create({ name });
  const doc = (...names: string[][]) => schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, schema.text('Acknowledgement', names[0].map(mark))),
    schema.nodes.heading.create({ level: 1 }, schema.text('Overview', names[1].map(mark))),
  ]);
  // The heading's own content, which is what the dialog offers as the target.
  const heading = { from: 18, to: 26 };

  it('takes the name that covers the heading alone', () => {
    const found = adoptableBookmark(doc(['wide'], ['wide', 'tight']), heading);
    expect([found?.name, found?.text]).toEqual(['tight', 'Overview']);
  });

  it('takes none where every name reaches beyond it', () => {
    expect(adoptableBookmark(doc(['wide'], ['wide']), heading)).toBeNull();
  });
});

describe('finding a target', () => {
  const schema = getSchema([Document, Paragraph, Text, Heading, Bookmark]);
  const mark = (name: string) => schema.marks.bookmark.create({ name });
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 1 }, schema.text('Key performance indicators')),
    schema.nodes.paragraph.create(null, [
      schema.text('Key ', [mark('outer')]),
      schema.text('figures', [mark('outer'), mark('inner')]),
    ]),
  ]);

  it('reports a range per name, the inner one included', () => {
    expect(bookmarks(doc).map((b) => [b.name, b.text])).toEqual([
      ['outer', 'Key figures'],
      ['inner', 'figures'],
    ]);
  });

  it('reaches a bookmark inside a text box, whose blocks hold the text', () => {
    const boxSchema = getSchema(extensions);
    const boxed = boxSchema.nodes.doc.create(null, [
      boxSchema.nodes.paragraph.create(null, boxSchema.nodes.textBox.create(null, [
        boxSchema.nodes.paragraph.create(null, boxSchema.text('Figure 1: a dialog', [boxSchema.marks.bookmark.create({ name: 'cap' })])),
      ])),
    ]);
    expect(bookmarks(boxed).map((b) => [b.name, b.text])).toEqual([['cap', 'Figure 1: a dialog']]);
  });

  it('resolves a bookmark by name and a heading by ODF\'s "|outline" form', () => {
    expect(findTarget(doc, '#inner')?.text).toBe('figures');
    expect(findTarget(doc, '#Key performance indicators|outline')?.from).toBe(1);
    expect(findTarget(doc, '#nothing')).toBeNull();
  });
});

// A name is one bookmark: renaming takes the references along, setting it again moves it.
describe('editing a bookmark', () => {
  const bmText = (text: string, name: string) => ({ type: 'text', text, marks: [{ type: 'bookmark', attrs: { name } }] });
  const make = () => new Editor({ element: document.createElement('div'), extensions, content: { type: 'doc', content: [
    { type: 'paragraph', content: [bmText('first', 'Old')] },
    { type: 'paragraph', content: [bmText('second', 'Old'), { type: 'text', text: ' rest' }] },
    { type: 'paragraph', content: [
      { type: 'crossRef', attrs: { name: 'Old', format: 'text', text: 'first second' } },
      { type: 'text', text: ' jump', marks: [{ type: 'link', attrs: { href: '#Old' } }] },
    ] },
  ] } });
  const refsAndLinks = (editor: Editor) => {
    const out: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'crossRef') out.push(`ref:${node.attrs.name}`);
      for (const m of node.marks) if (m.type.name === 'link') out.push(`link:${m.attrs.href}`);
      return true;
    });
    return out;
  };

  it('renames the range across paragraphs and every reference to it', () => {
    const editor = make();
    expect(editor.commands.renameBookmark('Old', 'New name')).toBe(true);
    expect(bookmarks(editor.state.doc).map((b) => [b.name, b.text])).toEqual([['New_name', 'first second']]);
    expect(refsAndLinks(editor)).toEqual(['ref:New_name', 'link:#New_name']);
    const rest = bookmarks(editor.state.doc)[0].to + 1;
    editor.chain().setTextSelection({ from: rest, to: rest + 4 }).setBookmark('Other').run();
    expect(editor.commands.renameBookmark('New_name', 'Other')).toBe(false);
  });

  it('moves a name set again instead of keeping two ranges', () => {
    const editor = make();
    const rest = bookmarks(editor.state.doc)[0].to + 1;
    editor.chain().setTextSelection({ from: rest, to: rest + 4 }).setBookmark('Old').run();
    expect(bookmarks(editor.state.doc).map((b) => [b.name, b.text])).toEqual([['Old', 'rest']]);
  });
});
