// File System Access API helpers for saving/opening .odt files. Falls back to a
// plain browser download / no-op where the API is unavailable (Firefox/Safari).

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PICKER_TYPES = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } },
];

const DOCX_PICKER_TYPES = [
  { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'] } },
];

// showSaveFilePicker/showOpenFilePicker are not in lib.dom yet; reach them via casts.
type WinFs = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
};

export function supportsFsAccess(): boolean {
  return typeof (window as WinFs).showSaveFilePicker === 'function';
}

function download(bytes: Uint8Array, name: string, mime: string = ODT_MIME): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

// Save to the given handle if we have one; otherwise prompt for a location (i.e.
// the first save acts as Save As). Returns the handle written to, or null when
// falling back to a plain download. Throws AbortError if the user cancels.
export async function saveOdt(
  bytes: Uint8Array,
  suggestedName: string,
  handle: FileSystemFileHandle | null,
): Promise<FileSystemFileHandle | null> {
  if (!supportsFsAccess()) {
    download(bytes, suggestedName);
    return null;
  }
  const target = handle ?? (await (window as WinFs).showSaveFilePicker!({ suggestedName, types: PICKER_TYPES }));
  await writeHandle(target, bytes);
  return target;
}

// Always prompt for a location. Returns the new handle, or null on fallback.
export async function saveAsOdt(
  bytes: Uint8Array,
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  if (!supportsFsAccess()) {
    download(bytes, suggestedName);
    return null;
  }
  const handle = await (window as WinFs).showSaveFilePicker!({ suggestedName, types: PICKER_TYPES });
  await writeHandle(handle, bytes);
  return handle;
}

// Export a .docx: always prompt for a location (no handle is tracked — .docx is an
// export target, like PDF, while DOCX import doesn't exist yet). Falls back to a
// plain download. Returns null. Throws AbortError if the user cancels.
export async function saveAsDocx(bytes: Uint8Array, suggestedName: string): Promise<void> {
  if (!supportsFsAccess()) {
    download(bytes, suggestedName, DOCX_MIME);
    return;
  }
  const handle = await (window as WinFs).showSaveFilePicker!({ suggestedName, types: DOCX_PICKER_TYPES });
  await writeHandle(handle, bytes);
}

// Prompt for an .odt to open, capturing its handle so a later save can overwrite
// the same file. Returns null if cancelled. Only call when supportsFsAccess().
export async function openOdt(): Promise<{ bytes: Uint8Array; handle: FileSystemFileHandle; name: string } | null> {
  const [handle] = await (window as WinFs).showOpenFilePicker!({ types: PICKER_TYPES, multiple: false });
  if (!handle) return null;
  const file = await handle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), handle, name: file.name };
}
