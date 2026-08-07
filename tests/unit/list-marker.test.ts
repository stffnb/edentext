import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { getSchema } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import ListItem from '@tiptap/extension-list-item';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { listMarkerDecos, listMarkerFormat } from '../../src/lib/editor/extensions/listMarker';
import { builtinStyleSheet, styleCss } from '../../src/lib/styles/styleSheet';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';

const schema = getSchema([Document, Paragraph, Text, Bold, Italic, ListItem, OrderedList]);

const bold = (t: string) => schema.text(t, [schema.marks.bold.create()]);
const italic = (t: string) => schema.text(t, [schema.marks.italic.create()]);
const item = (...inline: PmNode[]) =>
  schema.nodes.listItem.create(null, schema.nodes.paragraph.create(null, inline));
const doc = (...items: PmNode[]) =>
  schema.nodes.doc.create(null, schema.nodes.orderedList.create(null, items));

// The marker custom properties the plugin puts on each <li>, in document order.
function markerStyles(d: PmNode): string[] {
  const set = listMarkerDecos(d);
  const out: string[] = [];
  d.descendants((node, pos) => {
    if (node.type.name !== 'listItem') return;
    const deco = set.find(pos, pos + 1).find((x) => x.from === pos) as { type?: { attrs?: Record<string, string> } } | undefined;
    out.push(deco?.type?.attrs?.style ?? '');
  });
  return out;
}

// JSON list nodes for the export legs.
const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const jsonList = (...inline: unknown[]) => ({
  type: 'orderedList',
  content: [{ type: 'listItem', content: [{ type: 'paragraph', content: inline }] }],
});

describe('list marker formatting', () => {
  // The four cases LibreOffice renders as I. bold, II. plain, III. bold, IV. plain.
  it('follows the first text portion, not the rest of the line', () => {
    const d = doc(
      item(bold('all bold')),
      item(schema.text('all plain')),
      item(bold('bold'), schema.text(' then plain')),
      item(schema.text('plain then '), bold('bold')),
    );
    expect(markerStyles(d).map((s) => s.includes('--marker-weight:bold'))).toEqual([true, false, true, false]);
  });

  it('carries slant, and resets every property on an unformatted item', () => {
    const [slanted, plain] = markerStyles(doc(item(italic('slanted')), item(schema.text('plain'))));
    expect(slanted).toContain('--marker-style:italic');
    // Reset, not absent: the properties inherit, so a nested item would take its parent's.
    expect(plain).toBe('--marker-family:initial;--marker-weight:initial;--marker-style:initial;'
      + '--marker-size:initial;--marker-color:initial');
  });

  it('reads family, size and color off the run, falling back to the block size', () => {
    expect(listMarkerFormat(jsonList(text('x', [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '18pt', color: '#FF0000' } }]))))
      .toMatchObject({ fontFamily: 'Arial', fontSize: '18pt', color: '#FF0000' });
    expect(listMarkerFormat({
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { fontSize: '9pt' }, content: [text('x')] }] }],
    })).toMatchObject({ fontSize: '9pt' });
    expect(listMarkerFormat(jsonList(text('x')))).toBeNull();
  });

  // A level definition covers every item, so a list whose items disagree gets none
  // and both engines fall back to their own per-item rule.
  it('has no list-wide format unless every item agrees', () => {
    const bolded = { type: 'listItem', content: [{ type: 'paragraph', content: [text('a', [{ type: 'bold' }])] }] };
    const plain = { type: 'listItem', content: [{ type: 'paragraph', content: [text('b')] }] };
    expect(listMarkerFormat({ type: 'orderedList', content: [bolded, bolded] })).toMatchObject({ fontWeight: 'bold' });
    expect(listMarkerFormat({ type: 'orderedList', content: [bolded, plain] })).toBeNull();
  });

  // The marker inherits the item's font, so the style rule has to reach the item and
  // not only its paragraph — else an imported document's numbers keep the editor default.
  it('gives the list item its paragraph style\'s text half', () => {
    const css = styleCss(builtinStyleSheet());
    expect(css).toContain('.paper .tiptap li:has(> p:not([data-style]))');
    expect(css).toContain('.paper .tiptap li:has(> [data-style="Heading 1"])');
  });

  // Both formats carry marker formatting on the level definition, not on the item.
  describe('export', () => {
    const fixture = {
      type: 'doc',
      content: [jsonList(text('heading', [{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '18pt', color: '#FF0000' } }]))],
    } as never;
    let numbering: string;
    let content: string;

    beforeAll(async () => {
      numbering = strFromU8(unzipSync(await buildDocx(fixture))['word/numbering.xml']);
      content = strFromU8(unzipSync(await buildOdt(fixture))['content.xml']);
    });

    it('writes the DOCX level run properties (w:lvl/w:rPr)', () => {
      const lvl = (numbering.match(/<w:lvl [\s\S]*?<\/w:lvl>/g) ?? []).find((l) => l.includes('<w:rPr>')) ?? '';
      expect(lvl).toContain('<w:b/>');
      expect(lvl).toContain('<w:i/>');
      expect(lvl).toContain('<w:sz w:val="36"/>'); // 18pt in half-points
      expect(lvl).toContain('<w:color w:val="FF0000"/>');
      expect(lvl).toMatch(/<w:rFonts[^>]*w:ascii="Arial"/);
    });

    it('points the ODF level definition at a minted character style', () => {
      expect(content).toMatch(/<text:list-level-style-number text:level="1" text:style-name="MK1"/);
      expect(content).toContain('<style:style style:name="MK1" style:family="text">');
      expect(content).toContain('<style:text-properties fo:font-family="Arial" fo:font-weight="bold"'
        + ' fo:font-style="italic" fo:font-size="18pt" fo:color="#FF0000"/>');
    });
  });
});
