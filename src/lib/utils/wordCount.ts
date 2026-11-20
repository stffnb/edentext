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

// Chinese and Japanese are not spaced between words: both word processors count each Han
// character or kana as a word, the Latin words among them as words, and the CJK punctuation
// as neither — it separates, as a space does. Korean is spaced, so Hangul counts as Latin does.
// A run of non-space must stop at a CJK character, or it would swallow the next sentence.
const CJK_CHARS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
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
