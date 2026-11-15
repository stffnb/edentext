// Documents the desktop app receives from the system (a double-click, Open With) arrive
// as paths, not FileSystemFileHandles. A path handle answers the part of the handle API
// the app uses, so open, save, the recent list and the reload binding treat it alike.

type Bridge = {
  takeOpenedFile(): Promise<string | null>;
  readFile(path: string): Promise<{ bytes: Uint8Array; modified: number }>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  printToPdf(html: string): Promise<Uint8Array>;
};

const bridge = (globalThis as { edentextDesktop?: Bridge }).edentextDesktop;

// A missing file reads as NotFoundError and a refused path as NotAllowedError, the
// errors on which the recent list drops an entry and Save falls back to Save As.
function fail(err: unknown): never {
  throw new DOMException(String(err), /ENOENT/.test(String(err)) ? 'NotFoundError' : 'NotAllowedError');
}

/** Whether this is the desktop app. */
export const inDesktopApp = !!bridge;

export function pathHandle(path: string): FileSystemFileHandle {
  const name = path.split(/[\\/]/).pop() ?? path;
  return {
    kind: 'file',
    name,
    path,
    async getFile() {
      const { bytes, modified } = await bridge!.readFile(path).catch(fail);
      return new File([bytes as Uint8Array<ArrayBuffer>], name, { lastModified: modified });
    },
    async createWritable() {
      let data: Uint8Array = new Uint8Array();
      return {
        write: async (bytes: Uint8Array) => { data = bytes; },
        close: () => bridge!.writeFile(path, data).catch(fail),
      };
    },
    isSameEntry: async (other: FileSystemHandle) => pathOf(other) === path,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
  } as unknown as FileSystemFileHandle;
}

export function pathOf(handle: FileSystemHandle): string | null {
  return (handle as { path?: string }).path ?? null;
}

// The document this window was opened for, once.
export async function takeOpenedFile(): Promise<FileSystemFileHandle | null> {
  const path = await bridge?.takeOpenedFile();
  return path ? pathHandle(path) : null;
}

// The print page rendered to PDF by the desktop app, without a print dialog; absent in a browser.
export const desktopPrintToPdf = bridge?.printToPdf;
