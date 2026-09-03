import { describe, it, expect, vi } from 'vitest';
import { saveAsDocument } from '../../src/lib/export/saveFile';

// A handle that records what was written to it, like the picker hands back.
function handleFor(name: string) {
  const written: Uint8Array[] = [];
  return {
    handle: { name, createWritable: async () => ({ write: (b: Uint8Array) => { written.push(b); }, close: async () => {} }) },
    written,
  };
}

async function saveAs(pickerName: string | null, fallback: 'odt' | 'docx') {
  const picked = pickerName ? handleFor(pickerName) : null;
  const win = window as unknown as Record<string, unknown>;
  if (picked) win.showSaveFilePicker = async () => picked.handle;
  else delete win.showSaveFilePicker;
  const built: string[] = [];
  const res = await saveAsDocument(async (kind) => { built.push(kind); return new Uint8Array([1, 2]); },
    `doc.${fallback}`, fallback);
  return { built, kind: res.kind, handle: res.handle, written: picked?.written };
}

describe('Save As builds the format the picker chose', () => {
  it('writes .docx when the chosen name says so', async () => {
    const r = await saveAs('report.docx', 'odt');
    expect(r.built).toEqual(['docx']);
    expect(r.kind).toBe('docx');
    expect(r.written?.[0]).toEqual(new Uint8Array([1, 2]));
  });

  it('writes .odt for a document that came in as .docx', async () => {
    const r = await saveAs('report.odt', 'docx');
    expect(r.built).toEqual(['odt']);
    expect(r.kind).toBe('odt');
  });

  it('keeps the document format where there is no picker', async () => {
    vi.stubGlobal('alert', () => {});
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => {};
    const r = await saveAs(null, 'docx');
    expect(r.built).toEqual(['docx']);
    expect(r.kind).toBe('docx');
    expect(r.handle).toBeNull();
  });
});
