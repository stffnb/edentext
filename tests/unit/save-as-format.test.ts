import { describe, it, expect, vi } from 'vitest';
import { saveDocument } from '../../src/lib/export/saveFile';

// A handle that records what was written to it, like the picker hands back.
function handleFor(name: string) {
  const written: Uint8Array[] = [];
  return {
    handle: { name, createWritable: async () => ({ write: (b: Uint8Array) => { written.push(b); }, close: async () => {} }) },
    written,
  };
}
const win = window as unknown as Record<string, unknown>;
const bytes = new Uint8Array([1, 2]);

describe('saveDocument', () => {
  it('asks for a location in the chosen format alone', async () => {
    const picked = handleFor('report.docx');
    let types: { accept: Record<string, string[]> }[] = [];
    win.showSaveFilePicker = async (o: { types: typeof types }) => { types = o.types; return picked.handle; };
    const handle = await saveDocument(bytes, 'report.docx', 'docx');
    expect(types.flatMap((t) => Object.values(t.accept).flat())).toEqual(['.docx']);
    expect(handle).toBe(picked.handle);
    expect(picked.written[0]).toEqual(bytes);
  });

  it('writes into the handle it is given without asking', async () => {
    const own = handleFor('mine.odt');
    win.showSaveFilePicker = async () => { throw new Error('asked'); };
    await saveDocument(bytes, 'mine.odt', 'odt', own.handle as unknown as FileSystemFileHandle);
    expect(own.written[0]).toEqual(bytes);
  });

  // Brave ships without the File System Access API: a download in the format's own MIME
  // type, since the browser's dialog cannot hand a changed name back.
  it('downloads in the chosen format where there is no picker', async () => {
    delete win.showSaveFilePicker;
    vi.stubGlobal('alert', () => {});
    let blob: Blob | undefined;
    URL.createObjectURL = (b: Blob) => { blob = b; return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    expect(await saveDocument(bytes, 'report.docx', 'docx')).toBeNull();
    expect(blob?.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
});
