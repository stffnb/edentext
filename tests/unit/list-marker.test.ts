import { describe, it, expect, beforeAll } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { Editor, getSchema } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import ListItem from '@tiptap/extension-list-item';
import { OrderedList } from '../../src/lib/editor/extensions/orderedList';
import { ListMarker, charStyleProps, listMarkerDecos, listMarkerFormat, touchesList } from '../../src/lib/editor/extensions/listMarker';
import { extensions } from '../../src/lib/editor/extensions';
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

  // A charStyle mark carries only a name, so the registry has to resolve it — the
  // caller hands in the lookup (the plugin from its option, the exporters from the sheet).
  it('resolves a character style on the portion', () => {
    const list = jsonList(text('x', [{ type: 'charStyle', attrs: { name: 'Strong Emphasis' } }]));
    expect(listMarkerFormat(list)).toBeNull();
    expect(listMarkerFormat(list, charStyleProps(builtinStyleSheet()))).toMatchObject({ fontWeight: 'bold' });
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
    let styles: string;

    beforeAll(async () => {
      numbering = strFromU8(unzipSync(await buildDocx(fixture))['word/numbering.xml']);
      const odt = unzipSync(await buildOdt(fixture));
      content = strFromU8(odt['content.xml']);
      styles = strFromU8(odt['styles.xml']);
    });

    it('writes the DOCX level run properties (w:lvl/w:rPr)', () => {
      const lvl = (numbering.match(/<w:lvl [\s\S]*?<\/w:lvl>/g) ?? []).find((l) => l.includes('<w:rPr>')) ?? '';
      expect(lvl).toContain('<w:b/>');
      expect(lvl).toContain('<w:i/>');
      expect(lvl).toContain('<w:sz w:val="36"/>'); // 18pt in half-points
      expect(lvl).toContain('<w:color w:val="FF0000"/>');
      expect(lvl).toMatch(/<w:rFonts[^>]*w:ascii="Arial"/);
    });

    // odf-kit's list builder ignores charStyle, so the style is baked into the run's
    // marks and its name rides the CST sentinel — else the number would be bold and
    // the text it labels plain.
    it('carries a character style into a list item, formatting and name', async () => {
      const styled = { type: 'doc', content: [jsonList(text('x', [{ type: 'charStyle', attrs: { name: 'Strong Emphasis' } }]))] } as never;
      const xml = strFromU8(unzipSync(await buildOdt(styled))['content.xml']);
      const span = /<text:list-item>[\s\S]*?<text:span text:style-name="(\w+)"/.exec(xml);
      expect(span, 'the run must carry formatting').not.toBeNull();
      const style = new RegExp(`<style:style style:name="${span![1]}"[\\s\\S]*?</style:style>`).exec(xml)?.[0] ?? '';
      expect(style).toContain('fo:font-weight="bold"');
      // The CST sentinel is gone and the clone carries the named style as its parent.
      expect(xml).not.toContain('\ue00e');
      expect(style).toContain('style:parent-style-name="Strong_20_Emphasis"');
    });

    // The style has to land in styles.xml: LibreOffice ignores the level's reference
    // when it resolves to an automatic style (probed).
    it('points the ODF level definition at a named character style', () => {
      expect(content).toMatch(/<text:list-level-style-number text:level="1" text:style-name="MK1"/);
      expect(styles).toContain('<style:style style:name="MK1" style:family="text">');
      expect(styles).toContain('<style:text-properties fo:font-family="Arial" fo:font-weight="bold"'
        + ' fo:font-style="italic" fo:font-size="18pt" fo:color="#FF0000"/>');
      expect(content).not.toContain('style:name="MK1"');
    });
  });
});

// A level's own label size raises the item's first line (the marker joins the line), so
// only such an item is marked for it; a coloured one keeps the floated label.
describe('a list level sized apart from its text', () => {
  const sized = getSchema([Document, Paragraph, Text, ListItem, OrderedList, ListMarker]);
  const classOf = (markerFormat: unknown): string => {
    const d = sized.nodes.doc.create(null, sized.nodes.orderedList.create({ markerFormat },
      sized.nodes.listItem.create(null, sized.nodes.paragraph.create(null, sized.text('one')))));
    const deco = listMarkerDecos(d).find(1, 2)[0] as unknown as { type: { attrs: Record<string, string> } };
    return deco?.type?.attrs?.class ?? '';
  };
  it('puts its label in the line', () => expect(classOf({ fontSize: '12pt' })).toBe('marker-sized'));
  it('leaves a merely coloured one floated', () => expect(classOf({ color: '#006465' })).toBe(''));
  it('puts a label in its own font in the line', () => expect(classOf({ fontFamily: 'Symbol' })).toBe('marker-font'));
});

// The decorations are rebuilt for an edit inside an item, since a marker takes its format
// from the item's first text portion; a mark step counts by its own range.
describe('touchesList', () => {
  const p = (t: string) => ({ type: 'paragraph', content: [text(t)] });
  const li = (t: string) => ({ type: 'listItem', content: [p(t)] });
  // "outside" fills 1..8; the list starts at 9, its first item's text at 12.
  const makeEditor = () => new Editor({ element: document.body.appendChild(document.createElement('div')), extensions,
    content: { type: 'doc', content: [p('outside'), { type: 'bulletList', content: [li('alpha'), li('beta')] }, p('tail')] } });
  const LIST = 9;
  const IN_ITEM = LIST + 3;

  it('sees an edit in a list item and ignores one outside every list', () => {
    const editor = makeEditor();
    expect(touchesList(editor.state.tr.insertText('x', IN_ITEM))).toBe(true);
    expect(touchesList(editor.state.tr.insertText('x', 2))).toBe(false);
    editor.destroy();
  });
  it('sees a mark applied inside an item, whose position map is empty', () => {
    const editor = makeEditor();
    const bold = editor.state.schema.marks.bold;
    const marked = editor.state.tr.addMark(IN_ITEM, IN_ITEM + 4, bold.create());
    expect(marked.steps[0].getMap().ranges.length).toBe(0);
    expect(touchesList(marked)).toBe(true);
    expect(touchesList(editor.state.tr.addMark(2, 6, bold.create()))).toBe(false);
    editor.destroy();
  });
  it('sees the list node itself change, and a list inserted where there was none', () => {
    const editor = makeEditor();
    expect(touchesList(editor.state.tr.setNodeAttribute(LIST, 'markerAlign', 'right'))).toBe(true);
    expect(touchesList(editor.state.tr.insert(1, editor.state.schema.nodeFromJSON({ type: 'bulletList', content: [li('new')] })))).toBe(true);
    editor.destroy();
  });
});
