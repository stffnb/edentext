// File System Access API helpers for saving/opening documents. Falls back to a
// plain browser download / no-op where the API is unavailable (Firefox/Safari).

import { t } from '../i18n/i18n.svelte';

// Shown once per browser, at the first save that goes the download route — the
// moment the missing save dialog is actually felt.
const HINT_KEY = 'edentext-download-hint';

const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const OTT_MIME = 'application/vnd.oasis.opendocument.text-template';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DOTX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template';

type Kind = 'odt' | 'docx' | 'ott' | 'dotx';

// One picker type per format, and the format is settled before the bytes are built: the
// download route cannot read a changed name back from the browser's dialog, and Chrome's
// macOS panel has no format popup, so a second type in one picker is unreachable anyway.
const FORMATS: Record<Kind, { mime: string; type: { description: string; accept: Record<string, string[]> } }> = {
  odt: { mime: ODT_MIME, type: { description: 'OpenDocument Text', accept: { [ODT_MIME]: ['.odt'] } } },
  docx: { mime: DOCX_MIME, type: { description: 'Word Document', accept: { [DOCX_MIME]: ['.docx'] } } },
  ott: { mime: OTT_MIME, type: { description: 'OpenDocument Text Template', accept: { [OTT_MIME]: ['.ott'] } } },
  dotx: { mime: DOTX_MIME, type: { description: 'Word Template', accept: { [DOTX_MIME]: ['.dotx'] } } },
};

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
function download(bytes: Uint8Array, name: string, mime: string): void {
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

// Save in the given format: into the handle where there is one, else to a location asked
// for in that format alone, or a download where there is no picker. Returns the handle
// written to (null for a download). Throws AbortError if the user cancels.
export async function saveDocument(
  bytes: Uint8Array,
  suggestedName: string,
  kind: Kind,
  handle: FileSystemFileHandle | null = null,
  password: string | null = null,
): Promise<FileSystemFileHandle | null> {
  const out = await protect(bytes, password);
  if (!supportsFsAccess()) {
    download(out, suggestedName, FORMATS[kind].mime);
    return null;
  }
  const target = handle ?? (await (window as WinFs).showSaveFilePicker!({ suggestedName, types: [FORMATS[kind].type] }));
  await writeHandle(target, out);
  return target;
}

// Prompt for an .odt/.ott/.docx to open, capturing its handle so a later save can
// overwrite the same file. Returns null if cancelled. Only call when supportsFsAccess().
export async function openOdt(): Promise<{ bytes: Uint8Array; handle: FileSystemFileHandle; name: string } | null> {
  const [handle] = await (window as WinFs).showOpenFilePicker!({ types: OPEN_PICKER_TYPES, multiple: false });
  if (!handle) return null;
  const file = await handle.getFile();
  return { bytes: new Uint8Array(await file.arrayBuffer()), handle, name: file.name };
}
