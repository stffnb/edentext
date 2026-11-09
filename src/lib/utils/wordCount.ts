import type { Node as PmNode } from 'prosemirror-model';

export interface TextStats {
  words: number;
  charsWithSpaces: number;
  charsNoSpaces: number;
  paragraphs: number;
}

// hardBreak → newline (a word/line boundary); other leaf nodes (images, page
// fields) contribute no text.
function leafText(node: PmNode): string {
  return node.type.name === 'hardBreak' ? '\n' : '';
}

// CJK text is not spaced between words, so a whole Chinese paragraph would count as one.
// Both word processors count each Han character, kana or Hangul syllable as a word of its
// own, the Latin words among them as words, and the CJK punctuation as neither — it
// separates, as a space does. A run of non-space must stop at a CJK character, or it
// would swallow the sentence that follows a comma.
const CJK_CHARS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const CJK_PUNCT = '\\u3001-\\u303f\\uff01-\\uff65';
const CJK = new RegExp(`[${CJK_CHARS}]`, 'u');
const WORDS = new RegExp(`[${CJK_CHARS}]|[^\\s${CJK_CHARS}${CJK_PUNCT}]+`, 'gu');

function countWords(text: string): number {
  if (!CJK.test(text)) return text.match(/\S+/g)?.length ?? 0;
  return text.match(WORDS)?.length ?? 0;
}

// Count words/characters/paragraphs over a document range. Block boundaries become
// newlines so words never merge across paragraphs; newlines aren't counted as
// characters (they stand in for paragraph/line marks).
export function countText(doc: PmNode, from: number, to: number): TextStats {
  return from === 0 && to === doc.content.size ? wholeText(doc) : rangeText(doc, from, to);
}

function rangeText(doc: PmNode, from: number, to: number): TextStats {
  const text = doc.textBetween(from, to, '\n', leafText);
  let paragraphs = 0;
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') paragraphs++;
  });
  return {
    words: countWords(text),
    charsWithSpaces: text.replace(/\n/g, '').length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    paragraphs,
  };
}

// The whole document as the sum of its top-level blocks, each kept per node: a block
// boundary is a word boundary, so the counts add up, and an edit recounts one block.
const blockStats = new WeakMap<PmNode, TextStats>();
function wholeText(doc: PmNode): TextStats {
  const sum: TextStats = { words: 0, charsWithSpaces: 0, charsNoSpaces: 0, paragraphs: 0 };
  doc.forEach((block, offset) => {
    let s = blockStats.get(block);
    if (!s) blockStats.set(block, (s = rangeText(doc, offset, offset + block.nodeSize)));
    sum.words += s.words;
    sum.charsWithSpaces += s.charsWithSpaces;
    sum.charsNoSpaces += s.charsNoSpaces;
    sum.paragraphs += s.paragraphs;
  });
  return sum;
}
