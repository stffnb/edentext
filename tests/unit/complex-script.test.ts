import { describe, it, expect } from 'vitest';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { importOdt } from '../../src/lib/import/odt';
import { buildOdt } from '../../src/lib/export/odt';
import { buildDocx } from '../../src/lib/export/docx';
import { importDocx } from '../../src/lib/import/docx';
import { parseRunProps, W } from '../../src/lib/import/docxStyles';
import { builtinStyleSheet, DEFAULT_STYLE } from '../../src/lib/styles/styleSheet';
import { docxOf } from '../docxFixture';

// A style carries western, asian and complex-script fonts side by side; text is set from
// the set its own script belongs to — the asian font as the pair's second half. Probed against LibreOffice: a Hebrew paragraph whose
// style declares only style:font-size-complex="16pt" is set at 16pt, and CJK likewise.
const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"';

const HEBREW = 'אֵ֣לֶּה הַדְּבָרִ֗ים';
const CHINESE = '这是中文文本';

// One style declaring both sets, so each run has to pick the one its script belongs to.
function odt(): Uint8Array {
  const styles = `<?xml version="1.0"?><office:document-styles ${NS}>
   <office:font-face-decls>
    <style:font-face style:name="Taamey D" svg:font-family="'Taamey D'"/>
    <style:font-face style:name="Noto Sans CJK SC" svg:font-family="'Noto Sans CJK SC'"/>
   </office:font-face-decls><office:styles>
   <style:default-style style:family="paragraph">
    <style:text-properties fo:font-size="12pt" fo:font-family="Liberation Serif"
     style:font-size-complex="12pt" style:font-size-asian="12pt"/>
   </style:default-style>
   <style:style style:name="Standard" style:family="paragraph"/>
   <style:style style:name="Chapter" style:family="paragraph" style:parent-style-name="Standard">
    <style:text-properties style:font-size-complex="16pt" style:font-name-complex="Taamey D"
     style:font-size-asian="14pt" style:font-name-asian="Noto Sans CJK SC"/>
   </style:style>
  </office:styles></office:document-styles>`;
  const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
   <text:p text:style-name="Chapter">${HEBREW}<text:span>verse 2</text:span></text:p>
   <text:p text:style-name="Chapter">${CHINESE}<text:span>latin tail</text:span></text:p>
  </office:text></office:body></office:document-content>`;
  return zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) });
}

type Run = { text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
type Doc = { content?: { content?: Run[] }[] };
const runs = (doc: Doc, block = 0) => doc.content?.[block].content ?? [];
const textStyle = (r: Run) => r.marks?.find((m) => m.type === 'textStyle')?.attrs ?? {};

describe('script-dependent run properties', () => {
  it('sets a Hebrew run from the -complex font and size, a Latin one from the western', () => {
    const [hebrew, latin] = runs(importOdt(odt()).content);
    expect(textStyle(hebrew)).toMatchObject({ fontSize: '16pt', fontFamily: 'Taamey D' });
    // The style leaves the western pair at the default, so the Latin run takes no mark.
    expect(latin.text).toBe('verse 2');
    expect(textStyle(latin).fontSize).toBeUndefined();
    expect(textStyle(latin).fontFamily).toBeUndefined();
  });

  it('sets a CJK run from the -asian size and leaves its font to the style', () => {
    const imported = importOdt(odt());
    const [chinese, latin] = runs(imported.content, 1);
    expect(textStyle(chinese)).toMatchObject({ fontSize: '14pt' });
    expect(textStyle(chinese).fontFamily).toBeUndefined();
    expect(textStyle(chinese).fontFamilyAsian).toBeUndefined();
    expect(imported.styles.paragraph.Chapter.text.fontFamilyAsian).toBe('Noto Sans CJK SC');
    expect(latin.text).toBe('latin tail');
    expect(textStyle(latin).fontSize).toBeUndefined();
    expect(textStyle(latin).fontFamily).toBeUndefined();
  });

  it('keeps both sizes and the asian style font through an export and back', async () => {
    const imported = importOdt(odt());
    const again = importOdt(await buildOdt(imported.content as never, undefined, undefined, undefined, null, 'A4', imported.styles));
    expect(textStyle(runs(again.content)[0])).toMatchObject({ fontSize: '16pt', fontFamily: 'Taamey D' });
    expect(textStyle(runs(again.content, 1)[0])).toMatchObject({ fontSize: '14pt' });
    expect(again.styles.paragraph.Chapter.text.fontFamilyAsian).toBe('Noto Sans CJK SC');
  });
});

// Bold and italic have the three slots too. A style whose slots disagree is read per run;
// the editor keeps one value, so what it writes says the same in all three.
describe('script-dependent weight and slant', () => {
  const slotted = (props: string) => {
    const styles = `<?xml version="1.0"?><office:document-styles ${NS}><office:styles>
     <style:style style:name="Standard" style:family="paragraph"/>
     <style:style style:name="Chapter" style:family="paragraph" style:parent-style-name="Standard">
      <style:text-properties ${props}/></style:style>
    </office:styles></office:document-styles>`;
    const content = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text>
     <text:p text:style-name="Chapter">${HEBREW}<text:span>latin</text:span></text:p>
    </office:text></office:body></office:document-content>`;
    return runs(importOdt(zipSync({ 'content.xml': strToU8(content), 'styles.xml': strToU8(styles) })).content);
  };
  const has = (r: Run, type: string) => !!r.marks?.some((m) => m.type === type);

  it('reads a style bold in the western slot only as upright Hebrew', () => {
    const [hebrew, latin] = slotted('fo:font-weight="bold" style:font-weight-complex="normal" fo:font-style="italic" style:font-style-complex="normal"');
    expect(textStyle(hebrew)).toMatchObject({ fontWeight: 'normal', fontStyle: 'normal' });
    expect(latin.marks).toBeUndefined();
  });

  it('reads a style bold in the complex slot only as bold Hebrew', () => {
    const [hebrew, latin] = slotted('style:font-weight-complex="bold" style:font-style-complex="italic"');
    expect(has(hebrew, 'bold') && has(hebrew, 'italic')).toBe(true);
    expect(latin.marks).toBeUndefined();
  });

  it('writes every size, weight and slant into all three slots', async () => {
    const para = (text: string, marks?: unknown[]) => ({ type: 'paragraph', attrs: {}, content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] });
    const doc = { type: 'doc', content: [
      { type: 'tableOfContents', attrs: {} },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: HEBREW }] },
      { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: CHINESE }] },
      para(HEBREW, [{ type: 'bold' }, { type: 'italic' }, { type: 'textStyle', attrs: { fontSize: '15pt' } }]),
      { type: 'orderedList', attrs: {}, content: [{ type: 'listItem', content: [para(HEBREW, [{ type: 'bold' }])] }] },
    ] };
    const files = unzipSync(await buildOdt(doc as never));
    const blocks = ['styles.xml', 'content.xml'].flatMap((name) => strFromU8(files[name]).match(/<style:text-properties\b[^>]*>/g) ?? []);
    const value = (block: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(block)?.[1];
    const uneven = blocks.filter((block) => ['size', 'weight', 'style'].some((prop) => {
      const western = value(block, `fo:font-${prop}`);
      return western != null && ['asian', 'complex'].some((slot) => value(block, `style:font-${prop}-${slot}`) !== western);
    }));
    expect(blocks.some((block) => value(block, 'fo:font-weight') === 'bold')).toBe(true);
    expect(uneven).toEqual([]);
  });
});

// DOCX carries the asian font alone (w:rFonts w:eastAsia); the format has no asian size
// or weight, and the choice is per w:r rather than per text node.
const WNS = `xmlns:w="${W}"`;
const RFONTS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/>';
const run = (text: string) => `<w:r><w:rPr>${RFONTS}</w:rPr><w:t>${text}</w:t></w:r>`;

const docx = () => docxOf(`<w:p>${run(CHINESE)}${run('latin tail')}</w:p>`);

const rPr = (inner: string) =>
  new DOMParser().parseFromString(`<w:rPr ${WNS}>${inner}</w:rPr>`, 'application/xml').documentElement;

describe('DOCX east-asian run font', () => {
  it('keeps w:eastAsia alongside the ascii font', () => {
    expect(parseRunProps(rPr(RFONTS))).toMatchObject({ font: 'Times New Roman', fontEastAsia: 'SimSun' });
  });

  // Both runs carry the same pair, so they come back as one.
  it('keeps it as the asian half of every run, whatever its script', () => {
    const [run] = runs(importDocx(docx()).content as Doc);
    expect(run.text).toBe(`${CHINESE}latin tail`);
    expect(textStyle(run).fontFamilyAsian).toBe('SimSun');
    expect(textStyle(run).fontFamily).not.toBe('SimSun');
  });
});

// The text box serializes its runs by hand, so it has to split the pair over the rFonts
// slots the way the library does for the body.
const MARGINS = { top: 2, bottom: 2, left: 2, right: 2 } as never;
const boxDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    attrs: {},
    content: [{
      type: 'textBox',
      attrs: { width: 300, height: 200 },
      content: [{
        type: 'paragraph',
        attrs: {},
        content: [{
          type: 'text',
          text: CHINESE,
          marks: [{ type: 'textStyle', attrs: { fontFamilyAsian: 'SimSun' } }],
        }],
      }],
    }],
  }],
};

describe('DOCX text box run font', () => {
  it('writes the asian font into w:eastAsia alone', async () => {
    const files = unzipSync(await buildDocx(boxDoc as never, MARGINS, 'portrait'));
    const xml = strFromU8(files['word/document.xml']);
    const inBox = xml.slice(xml.indexOf('<w:txbxContent>'));
    expect(inBox).toContain('<w:rFonts w:eastAsia="SimSun"/>');
  });

  it('round-trips the font of its CJK run', async () => {
    const back = importDocx(await buildDocx(boxDoc as never, MARGINS, 'portrait'));
    const box = (back.content as Doc).content?.[0].content?.[0] as unknown as Doc;
    expect(textStyle(runs(box)[0])).toMatchObject({ fontFamilyAsian: 'SimSun' });
  });
});

// Both formats keep language three ways (western / asian / complex), and both word
// processors read Chinese, Japanese and Korean text from the asian one alone. A document
// that says "zh-CN" in the western slot says it where nobody looks.
const ZH = { language: 'zh', country: 'CN' };
const zhDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: CHINESE }] }],
};

describe('East Asian document language', () => {
  it('writes the DOCX document default into w:eastAsia, with a Han default font', async () => {
    const files = unzipSync(await buildDocx(zhDoc as never, MARGINS, 'portrait', undefined, ZH));
    const xml = strFromU8(files['word/styles.xml']);
    expect(xml).toContain('w:eastAsia="zh-CN"');
    expect(xml).not.toContain('<w:lang w:val="zh-CN"');
    expect(xml).toMatch(/<w:rFonts[^>]*w:eastAsia="SimSun"/);
  });

  it('writes the ODT document default into the asian slot', async () => {
    const files = unzipSync(await buildOdt(zhDoc as never, MARGINS, 'portrait', undefined, ZH));
    const xml = strFromU8(files['styles.xml']);
    expect(xml).toContain('style:language-asian="zh"');
    expect(xml).toContain('style:country-asian="CN"');
    expect(xml).not.toContain('fo:language="zh"');
    expect(xml).toContain('style:font-name-asian="SimSun"');
  });

  // LibreOffice lists 游明朝 first among the Japanese fonts either platform ships.
  it('gives a Japanese document Yu Mincho as its asian default', async () => {
    const JA = { language: 'ja', country: 'JP' };
    const docx = strFromU8(unzipSync(await buildDocx(zhDoc as never, MARGINS, 'portrait', undefined, JA))['word/styles.xml']);
    expect(docx).toMatch(/<w:rFonts[^>]*w:eastAsia="Yu Mincho"/);
    expect(docx).toContain('w:eastAsia="ja-JP"');
    const odt = strFromU8(unzipSync(await buildOdt(zhDoc as never, MARGINS, 'portrait', undefined, JA))['styles.xml']);
    expect(odt).toContain('style:font-name-asian="Yu Mincho"');
  });

  it('reads the asian slot back in both formats', async () => {
    expect((await importOdt(await buildOdt(zhDoc as never, MARGINS, 'portrait', undefined, ZH))).language).toBe('zh-CN');
    expect(importDocx(await buildDocx(zhDoc as never, MARGINS, 'portrait', undefined, ZH)).language).toBe('zh-CN');
  });

  // A run's own language travels the same way, and a western one is untouched by it.
  it('keeps a run language in the slot its script belongs to', async () => {
    const mixed = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        attrs: {},
        content: [
          { type: 'text', text: CHINESE, marks: [{ type: 'textStyle', attrs: { langAsian: 'zh-TW' } }] },
          { type: 'text', text: 'english', marks: [{ type: 'textStyle', attrs: { lang: 'en-GB' } }] },
        ],
      }],
    };
    const xml = strFromU8(unzipSync(await buildDocx(mixed as never, MARGINS, 'portrait'))['word/document.xml']);
    expect(xml).toContain('w:eastAsia="zh-TW"');
    expect(xml).toContain('w:val="en-GB"');

    const back = await importOdt(await buildOdt(mixed as never, MARGINS, 'portrait'));
    expect(textStyle(runs(back.content as Doc)[0])).toMatchObject({ langAsian: 'zh-TW' });
    expect(textStyle(runs(back.content as Doc)[1])).toMatchObject({ lang: 'en-GB' });
  });
});

// The language pair: a document keeps both defaults and leads with the asian one only
// where its text is East Asian; a run keeps both of its own.
describe('western/asian language pair', () => {
  const ZH_EN = { ...ZH, other: 'en-US' };
  const DE_ZH = { language: 'de', country: 'DE', other: 'zh-CN' };
  const german = { type: 'doc', content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: 'Ein deutscher Satz mit 中文' }] }] };

  it('reads an East Asian document with a western default as East Asian', async () => {
    for (const back of [
      await importOdt(await buildOdt(zhDoc as never, MARGINS, 'portrait', undefined, ZH_EN)),
      importDocx(await buildDocx(zhDoc as never, MARGINS, 'portrait', undefined, ZH_EN)),
    ]) expect([back.language, back.languageOther]).toEqual(['zh-CN', 'en-US']);
  });

  it('keeps a western document western beside its asian default', async () => {
    for (const back of [
      await importOdt(await buildOdt(german as never, MARGINS, 'portrait', undefined, DE_ZH)),
      importDocx(await buildDocx(german as never, MARGINS, 'portrait', undefined, DE_ZH)),
    ]) expect([back.language, back.languageOther]).toEqual(['de', 'zh-CN']);
  });

  it('keeps both languages of a run', async () => {
    const both = { type: 'doc', content: [{ type: 'paragraph', attrs: {}, content: [
      { type: 'text', text: 'word 漢字', marks: [{ type: 'textStyle', attrs: { lang: 'en-GB', langAsian: 'ja-JP' } }] },
    ] }] };
    for (const back of [
      await importOdt(await buildOdt(both as never, MARGINS, 'portrait', undefined, DE_ZH)),
      importDocx(await buildDocx(both as never, MARGINS, 'portrait', undefined, DE_ZH)),
    ]) expect(textStyle(runs(back.content as Doc)[0])).toMatchObject({ lang: 'en-GB', langAsian: 'ja-JP' });
  });

  // Word writes the asian language alone onto the runs of a Chinese document; the
  // western default still reaches their Latin words.
  it('does not let a run\'s w:eastAsia shadow the inherited w:val', async () => {
    const files = unzipSync(await buildDocx(zhDoc as never, MARGINS, 'portrait', undefined, ZH_EN));
    const xml = strFromU8(files['word/document.xml']).replace(/<w:r>/g, '<w:r><w:rPr><w:lang w:eastAsia="zh-CN"/></w:rPr>');
    expect(xml).toContain('<w:r><w:rPr><w:lang w:eastAsia="zh-CN"/></w:rPr>');
    const back = importDocx(zipSync({ ...files, 'word/document.xml': strToU8(xml) }));
    expect(back.language).toBe('zh-CN');
    expect(runs(back.content as Doc).map(textStyle).filter((t) => t?.lang || t?.langAsian)).toEqual([]);
  });
});

// Arabic and Hebrew are the third slot of both formats: language, weight, slant and size
// of such text are read from it alone, by Word and by LibreOffice.
describe('complex-script language and run formatting', () => {
  const ARABIC = 'هذا نص عربي طويل';
  const AR_EN = { language: 'ar', country: 'SA', other: 'en-US' };
  const EN_AR = { language: 'en', country: 'US', other: 'ar-SA' };
  const para = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: {}, content }] });
  const arDoc = para({ type: 'text', text: ARABIC }, { type: 'text', text: ' ok', marks: [{ type: 'italic' }] });
  const both = async (doc: unknown, lang?: unknown) => [
    await importOdt(await buildOdt(doc as never, MARGINS, 'portrait', undefined, lang as never)),
    importDocx(await buildDocx(doc as never, MARGINS, 'portrait', undefined, lang as never)),
  ];

  it('writes an Arabic document default into the complex slot, the western beside it', async () => {
    const docx = strFromU8(unzipSync(await buildDocx(arDoc as never, MARGINS, 'portrait', undefined, AR_EN))['word/styles.xml']);
    expect(docx).toMatch(/<w:lang w:val="en-US"[^>]*w:bidi="ar-SA"/);
    const odt = strFromU8(unzipSync(await buildOdt(arDoc as never, MARGINS, 'portrait', undefined, AR_EN))['styles.xml']);
    expect(odt).toContain('style:language-complex="ar"');
    expect(odt).toContain('fo:language="en"');
  });

  it('reads the document back as Arabic, its runs without a language of their own', async () => {
    for (const back of await both(arDoc, AR_EN)) {
      expect([back.language, back.languageOther]).toEqual(['ar', 'en-US']);
      expect(runs(back.content as Doc).map(textStyle).filter((t) => t.lang)).toEqual([]);
    }
  });

  it('keeps a western document western beside the complex default of its Arabic passage', async () => {
    const quote = para({ type: 'text', text: `An English sentence that quotes ${ARABIC.slice(0, 6)}` });
    for (const back of await both(quote, EN_AR)) expect([back.language, back.languageOther]).toEqual(['en', 'ar-SA']);
  });

  it('keeps the language of a complex-script run', async () => {
    const persian = para({ type: 'text', text: 'word ' }, { type: 'text', text: ARABIC, marks: [{ type: 'textStyle', attrs: { lang: 'fa-IR' } }] });
    for (const back of await both(persian, EN_AR)) {
      expect(runs(back.content as Doc).map((r) => textStyle(r).lang)).toEqual([undefined, 'fa-IR']);
    }
  });

  it('keeps bold and size of Arabic text through both formats', async () => {
    const bold = para({ type: 'text', text: ARABIC, marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '18pt' } }] });
    for (const back of await both(bold, AR_EN)) {
      const [run] = runs(back.content as Doc);
      expect(run.marks?.some((m) => m.type === 'bold')).toBe(true);
      expect(textStyle(run).fontSize).toBe('18pt');
    }
  });

  // Word sets Arabic text from w:bCs and w:szCs: the western pair beside them is unread.
  it('reads a DOCX run of Arabic text from its complex set alone', async () => {
    const bold = para({ type: 'text', text: ARABIC, marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '18pt' } }] });
    const files = unzipSync(await buildDocx(bold as never, MARGINS, 'portrait', undefined, AR_EN));
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('<w:bCs/>');
    const western = xml.replace('<w:bCs/>', '').replace(/<w:szCs w:val="36"\/>/, '<w:szCs w:val="28"/>');
    const [run] = runs(importDocx(zipSync({ ...files, 'word/document.xml': strToU8(western) })).content as Doc);
    expect(run.marks?.some((m) => m.type === 'bold')).toBe(false);
    expect(textStyle(run).fontSize).toBe('14pt');
  });

  // Word orders a paragraph by its runs' w:rtl, so the export cuts runs where the direction
  // the editor shows turns; the import joins them again.
  const RTL_PAGE = [MARGINS, 'portrait', undefined, AR_EN, 'A4', undefined, undefined, undefined, true] as const;
  const runFlags = (xml: string) => [...xml.matchAll(/<w:r>(?:<w:rPr>(.*?)<\/w:rPr>)?<w:t[^>]*>(.*?)<\/w:t><\/w:r>/g)]
    .map((m) => [m[2], /<w:rtl\/>/.test(m[1] ?? '')] as const);
  const mixed = para(
    { type: 'text', text: '12a نستخدم EdenText منذ عام 2026 و ١٢٣ (مقدمة) ' },
    { type: 'text', text: 'عريض bold', marks: [{ type: 'bold' }, { type: 'italic' }] },
    { type: 'text', text: ' ثم ' },
    { type: 'text', text: 'To jest', marks: [{ type: 'textStyle', attrs: { lang: 'pl-PL' } }] },
    { type: 'text', text: '.' });

  it('flags the right-to-left stretches of a mixed paragraph and reads them back as written', async () => {
    const bytes = await buildDocx(mixed as never, ...RTL_PAGE);
    const flags = runFlags(strFromU8(unzipSync(bytes)['word/document.xml']));
    expect(flags.filter(([, rtl]) => !rtl).map(([text]) => text)).toEqual(['12a', 'EdenText', '2026', '١٢٣', 'bold', 'To jest']);
    expect(flags.map(([text]) => text).join('')).toBe(runs(mixed as Doc).map((r) => r.text).join(''));
    const back = runs(importDocx(bytes).content as Doc);
    expect(back.map((r) => [r.text, (r.marks ?? []).map((m) => m.type).sort().join()]))
      .toEqual(runs(mixed as Doc).map((r) => [r.text, (r.marks ?? []).map((m) => m.type).sort().join()]));
    expect(back.map((r) => textStyle(r).lang)).toEqual([undefined, undefined, undefined, 'pl-PL', undefined]);
  });

  it('flags an Arabic phrase with its number in a left-to-right paragraph, and nothing without one', async () => {
    const xml = async (text: string) => strFromU8(unzipSync(await buildDocx(para({ type: 'text', text }) as never, MARGINS, 'portrait', undefined, EN_AR))['word/document.xml']);
    expect(runFlags(await xml('The phrase مرحبا 15 بكم (see p. 3) ends.')).filter(([, rtl]) => rtl).map(([text]) => text)).toEqual(['مرحبا 15 بكم']);
    expect(await xml('Plain text, 15 (see p. 3).')).not.toContain('w:rtl');
  });

  // Word numbers Arabic-Indic digits as a decimal label set right-to-left; its hindiNumbers
  // are Devanagari, read as before.
  it('writes an Arabic-Indic list as a right-to-left decimal level', async () => {
    const list = { type: 'doc', content: [{ type: 'orderedList', attrs: { listStyleType: 'arabic-indic' }, content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: ARABIC }] }] }] }] };
    const files = unzipSync(await buildDocx(list as never, ...RTL_PAGE));
    const numbering = strFromU8(files['word/numbering.xml']);
    expect(numbering).not.toContain('hindiNumbers');
    expect(numbering).toMatch(/<w:numFmt w:val="decimal"\/>(?:(?!<\/w:lvl>).)*<w:rPr><w:rtl\/>/);
    const typeOf = (bytes: Uint8Array) => (importDocx(bytes).content as Doc).content?.[0].attrs?.listStyleType;
    expect(typeOf(zipSync(files))).toBe('arabic-indic');
    const hindi = numbering.replace(/<w:numFmt w:val="decimal"\/>((?:(?!<\/w:lvl>).)*)<w:rPr><w:rtl\/><\/w:rPr>/, '<w:numFmt w:val="hindiNumbers"/>$1');
    expect(typeOf(zipSync({ ...files, 'word/numbering.xml': strToU8(hindi) }))).toBe('arabic-indic');
  });
});

// The pair itself: each half goes to its own slot and comes back as itself, and a run
// naming one half leaves the other to its paragraph.
const pairDoc = (attrs: Record<string, string>) => ({
  type: 'doc',
  content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: `Word ${CHINESE}`, marks: [{ type: 'textStyle', attrs }] }] }],
});

describe('western/asian font pair', () => {
  it('writes each half of a run to its own ODT slot, with a font face for both', async () => {
    const content = strFromU8(unzipSync(await buildOdt(pairDoc({ fontFamily: 'Arial', fontFamilyAsian: 'SimHei' }) as never))['content.xml']);
    const span = /text:span text:style-name="([^"]+)">Word/.exec(content)![1];
    const props = new RegExp(`style:name="${span}"[^>]*>\\s*<style:text-properties([^>]*)`).exec(content)![1];
    expect(props).toContain('style:font-name="Arial"');
    expect(props).toContain('style:font-name-asian="SimHei"');
    expect(content).toContain('<style:font-face style:name="SimHei"');
  });

  it('leaves the asian ODT slot to the paragraph where a run names only the western font', async () => {
    const content = strFromU8(unzipSync(await buildOdt(pairDoc({ fontFamily: 'Arial' }) as never))['content.xml']);
    const span = /text:span text:style-name="([^"]+)">Word/.exec(content)![1];
    const props = new RegExp(`style:name="${span}"[^>]*>\\s*<style:text-properties([^>]*)`).exec(content)![1];
    expect(props).toContain('style:font-name="Arial"');
    expect(props).not.toContain('font-name-asian');
  });

  it('splits the DOCX w:rFonts slots the same way', async () => {
    const both = strFromU8(unzipSync(await buildDocx(pairDoc({ fontFamily: 'Arial', fontFamilyAsian: 'SimHei' }) as never, MARGINS, 'portrait'))['word/document.xml']);
    expect(both).toMatch(/<w:rFonts w:ascii="Arial" w:cs="Arial" w:eastAsia="SimHei" w:hAnsi="Arial"\/>/);
    const west = strFromU8(unzipSync(await buildDocx(pairDoc({ fontFamily: 'Arial' }) as never, MARGINS, 'portrait'))['word/document.xml']);
    expect(west).toMatch(/<w:rFonts w:ascii="Arial" w:cs="Arial" w:hAnsi="Arial"\/>/);
  });

  it('brings a mixed run back with both halves from either format', async () => {
    const doc = pairDoc({ fontFamily: 'Arial', fontFamilyAsian: 'SimHei' });
    const odt = await importOdt(await buildOdt(doc as never));
    expect(textStyle(runs(odt.content as Doc)[0])).toMatchObject({ fontFamily: 'Arial', fontFamilyAsian: 'SimHei' });
    const docx = importDocx(await buildDocx(doc as never, MARGINS, 'portrait'));
    expect(textStyle(runs(docx.content as Doc)[0])).toMatchObject({ fontFamily: 'Arial', fontFamilyAsian: 'SimHei' });
  });

  it('keeps a style\'s asian font in both formats', async () => {
    const sheet = builtinStyleSheet();
    sheet.paragraph.Poem = { name: 'Poem', parent: DEFAULT_STYLE, next: null, para: {}, text: { fontFamilyAsian: 'KaiTi' } };
    const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { styleName: 'Poem' }, content: [{ type: 'text', text: CHINESE }] }] };
    const odt = await importOdt(await buildOdt(doc as never, MARGINS, 'portrait', undefined, null, 'A4', sheet));
    expect(odt.styles.paragraph.Poem.text.fontFamilyAsian).toBe('KaiTi');
    expect(textStyle(runs(odt.content as Doc)[0]).fontFamilyAsian).toBeUndefined();
    const docx = importDocx(await buildDocx(doc as never, MARGINS, 'portrait', undefined, null, 'A4', sheet));
    expect(docx.styles.paragraph.Poem.text.fontFamilyAsian).toBe('KaiTi');
    expect(textStyle(runs(docx.content as Doc)[0]).fontFamilyAsian).toBeUndefined();
  });

  it('reads an East Asian document default as a default, not as run formatting', async () => {
    const odt = importOdt(await buildOdt(zhDoc as never, MARGINS, 'portrait', undefined, ZH));
    const docx = importDocx(await buildDocx(zhDoc as never, MARGINS, 'portrait', undefined, ZH));
    for (const back of [odt, docx]) {
      expect(textStyle(runs(back.content as Doc)[0]).fontFamilyAsian).toBeUndefined();
      expect(back.styles.paragraph[DEFAULT_STYLE].text.fontFamilyAsian).toBeUndefined();
    }
  });
});
