// A book: Alice's Adventures in Wonderland (Lewis Carroll, 1865, public domain), A5 with
// mirrored margins, every chapter opening on a right-hand page, running heads that
// differ between left and right pages, and a contents page. Text from alice.txt.
import { builtinStyleSheet } from '../../src/lib/styles/styleSheet';
import { EMPTY_HF_SET, type HfSet } from '../../src/lib/storage/headerFooter';
import { T, P, BR, INDEX, HF, PAGE_NUMBER, ITALIC, type N, type Showcase } from './lib';

// `_like this_` is the plain-text edition's italic.
function runs(text: string): N[] {
  return text.split('_').map((part, i) => part && T(part, ...(i % 2 ? [ITALIC] : []))).filter(Boolean) as N[];
}

function body(raw: string): N[] {
  const out: N[] = [];
  let first = true; // the paragraph after a heading takes no first-line indent
  for (const block of raw.split(/\n\s*\n/)) {
    const chapter = /^CHAPTER ([IVX]+)\.\n(.+)$/.exec(block.trim());
    if (chapter) {
      out.push(P({ styleName: 'Chapter Number', sectionBreak: true }, T(`Chapter ${chapter[1]}`)));
      out.push({ type: 'heading', attrs: { level: 1 }, content: [T(chapter[2].trim())] });
      first = true;
    } else if (/^[*\s]+$/.test(block)) {
      out.push(P({ textAlign: 'center', spaceBefore: 8, spaceAfter: 8 }, T('*        *        *')));
    } else if (block.split('\n').every((l) => /^\s/.test(l))) {
      const lines = block.split('\n').map((l) => l.trim());
      out.push(P({ styleName: 'Verse' }, ...lines.flatMap((l, i) => [...(i ? [BR] : []), ...runs(l)])));
    } else {
      const text = block.split('\n').map((l) => l.trim()).join(' ');
      out.push(P(first ? null : { indentFirst: 0.6 }, ...runs(text)));
      first = false;
    }
  }
  return out;
}

export async function build(): Promise<Showcase> {
  const raw = await (await fetch('/scripts/showcase/alice.txt')).text();

  const styles = builtinStyleSheet();
  styles.paragraph['Standard'].text = { fontFamily: 'Liberation Serif', fontSizePt: 11 };
  styles.paragraph['Standard'].para = { textAlign: 'justify', lineHeight: '1.25', spaceAfter: 0 };
  styles.paragraph['Heading 1'].text = { fontFamily: 'Liberation Serif', fontSizePt: 20, bold: false, italic: true };
  styles.paragraph['Heading 1'].para = { textAlign: 'center', spaceBefore: 0, spaceAfter: 30 };
  styles.paragraph['Chapter Number'] = { name: 'Chapter Number', parent: 'Standard', next: 'Heading 1',
    para: { textAlign: 'center', spaceBefore: 84, spaceAfter: 4 },
    text: { caps: 'smallCaps', letterSpacingPt: 1.5 } };
  styles.paragraph['Verse'] = { name: 'Verse', parent: 'Standard', next: 'Standard',
    para: { textAlign: 'left', indent: 1.5, spaceBefore: 6, spaceAfter: 6 }, text: {} };
  styles.paragraph['Front Matter Heading'] = { name: 'Front Matter Heading', parent: 'Heading 1', next: 'Standard',
    para: { spaceBefore: 84, spaceAfter: 24 }, text: {} };
  styles.paragraph['Title'].text = { fontFamily: 'Liberation Serif', fontSizePt: 26, bold: false };
  styles.paragraph['Subtitle'].text = { fontFamily: 'Liberation Serif', fontSizePt: 14, bold: false, italic: true };

  const doc: N = { type: 'doc', content: [
    P({ styleName: 'Title', spaceBefore: 180, spaceAfter: 24 }, T('Alice’s Adventures in Wonderland')),
    P({ styleName: 'Subtitle' }, T('by Lewis Carroll')),
    P({ styleName: 'Front Matter Heading', breakBefore: 'page' }, T('Contents')),
    INDEX('toc', '', { maxLevel: 1 }),
    ...body(raw),
  ] };

  // Running heads name the chapter on right-hand pages, the book on left-hand ones, each
  // towards the outer edge; the page number sits centred at the foot of every page.
  const right = HF({ textAlign: 'right' }, { type: 'chapterField', attrs: { level: 1, text: 'Down the Rabbit-Hole' } });
  const left = HF(null, T('Alice’s Adventures in Wonderland', ITALIC));
  const folio = () => HF({ textAlign: 'center' }, PAGE_NUMBER);
  // A chapter opens on a right-hand page with no running head, its number at the foot.
  const chapterSet: HfSet = { ...EMPTY_HF_SET, header: right, headerEven: left, differentOddEven: true, startsOn: 'odd',
    footer: folio(), footerEven: folio(),
    differentFirstPage: true, headerFirst: null, footerFirst: folio() };
  const front: HfSet = { ...EMPTY_HF_SET };
  const sections = [front, ...Array.from({ length: 12 }, () => chapterSet)];
  sections[1] = { ...chapterSet, pageNumberStart: 1 };

  return {
    name: 'book', doc, styles,
    pageFormat: 'A5',
    margins: { top: 2, bottom: 2.2, left: 2.2, right: 1.6, mirrored: true },
    hf: { header: null, footer: null, sections, pageCount: 120, headerDistanceCm: 1.2, footerDistanceCm: 1.2 },
    language: { language: 'en', country: 'GB' },
    hyphenate: true,
    props: { title: 'Alice’s Adventures in Wonderland', subject: '', author: 'Lewis Carroll', keywords: '', description: '' },
    shots: [
      { file: 'book', page: 3 },
      { file: 'book-spread', page: 3, columns: 2, tab: 'layout' },
    ],
  };
}
