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
    words: text.match(/\S+/g)?.length ?? 0,
    charsWithSpaces: text.replace(/\n/g, '').length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    paragraphs,
  };
}
