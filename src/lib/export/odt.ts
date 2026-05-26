import type { Editor } from '@tiptap/core';
import { tiptapToOdt, type TiptapNode, type TextFormatting, type OdtDocument, type ParagraphBuilder } from 'odf-kit';

// tiptapToOdt ignores paragraph/heading node attrs (including lineHeight).
// We rename nodes that carry lineHeight to custom types and handle them via
// unknownNodeHandler, which has access to the full OdtDocument API.

const LH_P = '__lh_p__';
const LH_H = '__lh_h__';

function injectLineHeightTypes(node: TiptapNode, inList = false): TiptapNode {
  // Don't rename paragraphs inside list items — tiptapToOdt walks them by
  // type === "paragraph" to build list content; renaming breaks that.
  if (!inList && node.attrs?.lineHeight) {
    if (node.type === 'paragraph') return { ...node, type: LH_P };
    if (node.type === 'heading')   return { ...node, type: LH_H };
  }
  if (node.content?.length) {
    const childInList = inList
      || node.type === 'bulletList'
      || node.type === 'orderedList'
      || node.type === 'listItem';
    return { ...node, content: node.content.map(c => injectLineHeightTypes(c, childInList)) };
  }
  return node;
}

function applyRuns(p: ParagraphBuilder, content: TiptapNode[] = []) {
  for (const node of content) {
    if (node.type !== 'text' || !node.text) continue;
    const marks = node.marks ?? [];
    const tsm = marks.find(m => m.type === 'textStyle');
    const fmt: TextFormatting = {};
    if (marks.some(m => m.type === 'bold'))      fmt.bold = true;
    if (marks.some(m => m.type === 'italic'))     fmt.italic = true;
    if (marks.some(m => m.type === 'underline'))  fmt.underline = true;
    if (tsm?.attrs?.fontFamily) fmt.fontFamily = String(tsm.attrs.fontFamily);
    if (tsm?.attrs?.fontSize)   fmt.fontSize   = String(tsm.attrs.fontSize);
    if (tsm?.attrs?.color)      fmt.color      = String(tsm.attrs.color);
    p.addText(node.text, Object.keys(fmt).length ? fmt : undefined);
  }
}

export async function exportToOdt(editor: Editor): Promise<void> {
  const raw = editor.getJSON() as TiptapNode;
  const json = injectLineHeightTypes(raw);

  const odt = await tiptapToOdt(json, {
    unknownNodeHandler(node: TiptapNode, doc: OdtDocument) {
      const lhRaw = String(node.attrs?.lineHeight ?? '1.5');
      const lhNum = parseFloat(lhRaw);
      const lineHeight = isNaN(lhNum) ? lhRaw : lhNum;
      const opts = { lineHeight };
      const content = node.content ?? [];

      if (node.type === LH_P) {
        if (content.length === 0) {
          doc.addParagraph('', opts);
        } else {
          doc.addParagraph((p: ParagraphBuilder) => applyRuns(p, content), opts);
        }
      } else if (node.type === LH_H) {
        const level = (node.attrs?.level as number) ?? 1;
        doc.addHeading((p: ParagraphBuilder) => applyRuns(p, content), level, opts);
      }
    },
  });

  const blob = new Blob([odt as Uint8Array<ArrayBuffer>], { type: 'application/vnd.oasis.opendocument.text' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getFilename(editor);
  a.click();
  URL.revokeObjectURL(url);
}

function getFilename(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = editor.getJSON() as any;
  const heading = json.content?.find(
    (node: any) => node.type === 'heading' && node.content?.length
  );
  const firstText: string | undefined = heading?.content?.[0]?.text;
  if (firstText) {
    const name = firstText
      .slice(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (name) return `${name}.odt`;
  }
  return 'document.odt';
}
