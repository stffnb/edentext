import type { Editor } from '@tiptap/core';
import { tiptapToOdt } from 'odf-kit';

export async function exportToOdt(editor: Editor): Promise<void> {
  const json = editor.getJSON();
  const odt = await tiptapToOdt(json);

  const blob = new Blob([odt], {
    type: 'application/vnd.oasis.opendocument.text',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getFilename(editor);
  a.click();
  URL.revokeObjectURL(url);
}

function getFilename(editor: Editor): string {
  // Try to derive filename from first heading
  const json = editor.getJSON();
  const heading = json.content?.find(
    (node) => node.type === 'heading' && node.content?.length
  );
  if (heading?.content?.[0]?.text) {
    const name = heading.content[0].text
      .slice(0, 50)
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    if (name) return `${name}.odt`;
  }
  return 'document.odt';
}
