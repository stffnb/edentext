// File System Access API helpers for saving/opening .odt files. Falls back to a
// plain browser download / no-op where the API is unavailable (Firefox/Safari).

import { t } from '../i18n/i18n.svelte';

// Shown once per browser, at the first save that goes the download route — the
// moment the missing save dialog is actually felt.
const HINT_KEY = 'edentext-download-hint';

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PICKER_TYPES = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } },
];

const DOCX_PICKER_TYPES = [
  { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'] } },
];

// Both document formats in one picker: the chosen extension decides which is written.
const DOCUMENT_PICKER_TYPES = [...PICKER_TYPES, ...DOCX_PICKER_TYPES];

const DOTX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template';

// Both template formats in one picker: the chosen extension decides which is written.
const TEMPLATE_PICKER_TYPES = [
  { description: 'OpenDocument Text Template', accept: { [OTT_MIME]: ['.ott'] } },
  { description: 'Word Template', accept: { [DOTX_MIME]: ['.dotx'] } },
];

// The open picker also accepts templates; opening one never binds it as the file.
const OPEN_PICKER_TYPES = [
  { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'], [OTT_MIME]: ['.ott'] } },
  { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'], [DOTX_MIME]: ['.dotx'] } },
];

// showSaveFilePicker/showOpenFilePicker are not in lib.dom yet; reach them via casts.
type WinFs = Window & {
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle[]>;
};

export function supportsFsAccess(): boolean {
  return typeof (window as WinFs).showSaveFilePicker === 'function';
}

// Where the browser saves is the browser's business (its download folder, or its own
// dialog where that is switched on). Gecko needs the anchor in the document and the
// blob URL alive past the click.
function download(bytes: Uint8Array, name: string, mime: string = ODT_MIME): void {
  // Before the click: the browser's own save dialog would open on top of it.
  if (!localStorage.getItem(HINT_KEY)) {
    localStorage.setItem(HINT_KEY, '1');
    alert(t().ribbon.saveAsHint);
  }
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function writeHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

// Password protection is the last thing that happens to the bytes, after every
// post-processing pass and after the template conversion. The crypto module loads
// only when a password is actually set.
async function protect(bytes: Uint8Array, password: string | null): Promise<Uint8Array> {
  if (!password) return bytes;
  const { encryptPackage } = await import('../crypto/protect');
  return encryptPackage(bytes, password);
}

// Save to the given handle if we have one; otherwise prompt for a location (i.e.
// the first save acts as Save As). Returns the handle written to, or null when
// falling back to a plain download. Throws AbortError if the user cancels.
export async function saveOdt(
  bytes: Uint8Array,
  suggestedName: string,
  handle: FileSystemFileHandle | null,
  password: string | null = null,
): Promise<FileSystemFileHandle | null> {
  const out = await protect(bytes, password);
  if (!supportsFsAccess()) {
    download(out, suggestedName);
    return null;
  }
  const target = handle ?? (await (window as WinFs).showSaveFilePicker!({ suggestedName, types: PICKER_TYPES }));
  await writeHandle(target, out);
  return target;
}

// Always prompt for a location, in either document format. Which exporter runs is
// only known once a name is picked, so `build` is called with the chosen extension.
// Without a picker the document keeps the format it already has.
export async function saveAsDocument(
  build: (kind: 'odt' | 'docx') => Promise<Uint8Array>,
  suggestedName: string,
  fallback: 'odt' | 'docx',
  password: string | null = null,
): Promise<{ handle: FileSystemFileHandle | null; kind: 'odt' | 'docx' }> {
  if (!supportsFsAccess()) {
    download(await protect(await build(fallback), password), suggestedName, fallback === 'docx' ? DOCX_MIME : ODT_MIME);
    return { handle: null, kind: fallback };
  }
  const handle = await (window as WinFs).showSaveFilePicker!({ suggestedName, types: DOCUMENT_PICKER_TYPES });
  const kind = handle.name.toLowerCase().endsWith('.docx') ? 'docx' : 'odt';
  await writeHandle(handle, await protect(await build(kind), password));
  return { handle, kind };
}

// Save to the given handle if we have one; otherwise prompt for a location. Mirrors
// saveOdt, for a document that was opened as .docx and must round-trip as .docx.
export async function saveDocx(
  bytes: Uint8Array,
  suggestedName: string,
  handle: FileSystemFileHandle | null,
  password: string | null = null,
): Promise<FileSystemFileHandle | null> {
  const out = await protect(bytes, password);
  if (!supportsFsAccess()) {
    download(out, suggestedName, DOCX_MIME);
    return null;
  }
  const target = handle ?? (await (window as WinFs).showSaveFilePicker!({ suggestedName, types: DOCX_PICKER_TYPES }));
  await writeHandle(target, out);
  return target;
}

// Export a .docx: always prompt for a location (no handle is tracked — this is the
// explicit "Export" action, like PDF). Returns null. Throws AbortError if cancelled.
export async function saveAsDocx(
  bytes: Uint8Array,
  suggestedName: string,
  password: string | null = null,
): Promise<void> {
  await saveDocx(bytes, suggestedName, null, password);
}

// Save a template. The picker offers both formats, so the bytes can only be built
// once the user has picked one: `build` is called with the chosen extension. Falls
// back to a plain .ott download where there is no picker.
export async function saveAsTemplate(
  build: (kind: 'ott' | 'dotx') => Promise<Uint8Array>,
  baseName: string,
  password: string | null = null,
): Promise<void> {
  if (!supportsFsAccess()) {
    download(await protect(await build('ott'), password), `${baseName}.ott`, OTT_MIME);
    return;
  }
  const handle = await (window as WinFs).showSaveFilePicker!({
    suggestedName: `${baseName}.ott`, types: TEMPLATE_PICKER_TYPES,
  });
  const kind = handle.name.toLowerCase().endsWith('.dotx') ? 'dotx' : 'ott';
  await writeHandle(handle, await protect(await build(kind), password));
}

// Prompt for an .odt/.ott/.docx to open, capturing its handle so a later save can
// overwrite the same file. Returns null if cancelled. Only call when supportsFsAccess().
export async function openOdt(): Promise<{ bytes: Uint8Array; handle: FileSystemFileHandle; name: string } | null> {
  const [handle] = await (window as WinFs).showOpenFilePicker!({ types: OPEN_PICKER_TYPES, multiple: false });
  if (!handle) return null;
  const file = await handle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), handle, name: file.name };
}
