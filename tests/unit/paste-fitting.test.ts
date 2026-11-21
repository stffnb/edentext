import { describe, it, expect, vi } from 'vitest';
import { getSchema } from '@tiptap/core';
import { DOMParser as PMDOMParser, Fragment, Slice } from '@tiptap/pm/model';
import { extensions } from '../../src/lib/editor/extensions';
import { dropRemoteImages, localPastedHtml, PASTE_NOTICE_EVENT, withoutPictureSquares, unwrapPastedBoxes, flattenToInline, plainPastedSpaces } from '../../src/lib/editor/paste';

const schema = getSchema(extensions);
const para = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
const box = (attrs: Record<string, unknown>, blocks = [para('one'), para('two')]) =>
  schema.nodes.textBox.create(attrs, blocks);
const slice = (...nodes: ReturnType<typeof para>[]) => Slice.maxOpen(Fragment.fromArray(nodes), true);

describe('unwrapPastedBoxes', () => {
  it('spills the blocks of every box the paste invented', () => {
    // A paste of text plus a table gets one wrapper box per block that did not fit.
    const out = unwrapPastedBoxes(slice(box({}), box({}, [para('three')])));
    expect(out.content.childCount).toBe(3);
    expect(out.content.child(0).type.name).toBe('paragraph');
  });

  it('keeps a box that carries a size, which every real one does', () => {
    const pasted = slice(box({ width: 280, height: 120 }));
    expect(unwrapPastedBoxes(pasted)).toBe(pasted);
  });
});

describe('flattenToInline', () => {
  it('joins blocks with line breaks, boxes walked into', () => {
    const out = flattenToInline(slice(para('a'), box({ width: 280 }, [para('b')])), schema);
    expect(out.content.content.map(n => (n.isText ? n.text : n.type.name)))
      .toEqual(['a', 'hardBreak', 'b']);
  });
});

describe('dropRemoteImages', () => {
  const image = (src: string) => schema.nodes.image.create({ src });

  it('removes remote URLs while preserving local image schemes', () => {
    const pasted = slice(schema.nodes.paragraph.create(null, [
      image('https://tracker.invalid/pixel.png'), image('data:image/png;base64,AA=='), image('idb:image-1'),
    ]));
    const out = dropRemoteImages(pasted);
    expect(out.content.firstChild!.childCount).toBe(2);
    expect(out.content.firstChild!.child(0).attrs.src).toMatch(/^data:/);
    expect(out.content.firstChild!.child(1).attrs.src).toMatch(/^idb:/);
  });
});

describe('localPastedHtml', () => {
  const blocks = (html: string) => {
    const body = new DOMParser().parseFromString(localPastedHtml(html), 'text/html').body;
    const out: string[] = [];
    PMDOMParser.fromSchema(schema).parse(body).forEach(n => {
      let image = '';
      n.descendants(d => { if (d.type.name === 'image') image = 'image'; });
      out.push(`${n.type.name}:${n.textContent}${image}`);
    });
    return out;
  };
  const web = 'https://tracker.invalid';
  const data = 'data:image/png;base64,AA==';

  it('leaves the alt text of a web picture and no block it emptied, and reports the count', () => {
    let reported = 0;
    const note = (e: Event) => { reported += (e as CustomEvent).detail.images; };
    window.addEventListener(PASTE_NOTICE_EVENT, note);
    const out = blocks(`<p align="center"><a href="${web}"><picture><source srcset="${web}/a.webp"><img src="${web}/a.png" alt="Logo"></picture></a></p>`
      + `<h1><img src="${web}/b.svg" alt="Title"></h1><p><img src="/relative.png"></p><div><p><a href="${web}"><img src="//tracker.invalid/c.png"></a></p></div>`
      + `<ul><li><img src="blob:${web}/1"></li><li>item</li></ul><table><tr><td><img src="${web}/d.png"></td><td>x</td></tr></table><p>text</p>`);
    window.removeEventListener(PASTE_NOTICE_EVENT, note);
    expect(out).toEqual(['paragraph:Logo', 'heading:Title', 'bulletList:item', 'table:x', 'paragraph:text']);
    expect(reported).toBe(6);
  });

  it('keeps a picture carried as data wherever it stands, and HTML without one untouched', () => {
    const html = `<h1><img src="${data}"></h1><p><a href="${web}"><picture><source srcset="${web}/a.webp"><img src="${data}"></picture></a></p><ul><li><img src="${data}"></li></ul>`;
    expect(localPastedHtml(html)).toBe(html);
    expect(blocks(html)).toEqual(['heading:image', 'paragraph:image', 'bulletList:image']);
  });

  it('carries a fetch as a square with id and alt text only; no file and no load keeps one nobody fills', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const html = localPastedHtml(`<p><img src="${web}/a.png" alt="Logo"></p><ul><li><p><img src="${web}/b.png"></p></li><li>item</li></ul>`, { view: () => null });
    vi.unstubAllGlobals();
    expect(html).not.toContain('tracker');
    const doc = PMDOMParser.fromSchema(schema).parse(new DOMParser().parseFromString(html, 'text/html').body);
    const json = doc.toJSON();
    const text = (j: unknown) => schema.nodeFromJSON(j).textContent;
    const images = (j: unknown) => JSON.stringify(j).split('"image"').length - 1;
    // Still being fetched here, so a load keeps both; a file shows alt text and drops the bare one's item.
    expect(images(withoutPictureSquares(json, schema, true))).toBe(2);
    const file = withoutPictureSquares({ args: [json] }, schema).args[0];
    expect([images(file), text(file), schema.nodeFromJSON(file).child(1).childCount]).toEqual([0, 'Logoitem', 1]);
    // A square whose fetch went with an earlier page settles on loading.
    const orphan = JSON.parse(JSON.stringify(json).replace(/id=%22p[0-9a-z]+/g, 'id=%22pgone0000x'));
    expect(text(withoutPictureSquares(orphan, schema, true))).toBe('Logoitem');
  });
});

describe('plainPastedSpaces', () => {
  it('gives a block joined only by no-break spaces plain ones', () => {
    const out = plainPastedSpaces(slice(para('the\u00a0the\u00a0end'), para('10\u00a0ms and more')));
    expect(out.content.child(0).textContent).toBe('the the end');
    // Ordinary spaces beside it: the no-break one was meant.
    expect(out.content.child(1).textContent).toBe('10\u00a0ms and more');
  });
});

describe('a pasted or browser-styled size', () => {
  it('reads a px size as the pt the model and both formats count in', async () => {
    const { DOMParser } = await import('@tiptap/pm/model');
    const html = new window.DOMParser().parseFromString('<p><span style="font-size: 18.6667px">a</span><span style="font-size: 11pt">b</span></p>', 'text/html');
    const doc = DOMParser.fromSchema(schema).parse(html.body);
    const sizes: unknown[] = [];
    doc.descendants((n) => { if (n.isText) sizes.push(n.marks.find((m) => m.type.name === 'textStyle')?.attrs.fontSize); });
    expect(sizes).toEqual(['14pt', '11pt']);
  });
});
