// The postMessage protocol between an embedded editor and its host page; the host side
// is public/embed.js, the messages are listed in docs/architecture/embed.md.
export const PROTOCOL = 1;

export type ExportFormat = 'odt' | 'docx' | 'pdf';

export interface EmbedSettings {
  user?: string;
  locale?: string;
  theme?: string;
  chrome?: string;
  name?: string;
  accent?: string;
  ai?: boolean;
}

export interface EmbedApi {
  configure(settings: EmbedSettings): void;
  /** False when the reader backed out (a password not given). */
  load(bytes: Uint8Array, name: string): Promise<boolean>;
  newDocument(name?: string): void;
  exportAs(format: ExportFormat): Promise<{ bytes: Uint8Array; mime: string; name: string }>;
  markSaved(): void;
}

// Pinned by the first `init`: nothing about the document goes anywhere before it. An
// opaque origin ("null", a sandboxed or file:// host) can only be answered with '*'.
let hostOrigin: string | null = null;

// A build with VITE_EMBED_ORIGINS (space- or comma-separated origins) answers only those
// hosts; without it any page may frame and drive the editor.
const allowedHosts = import.meta.env.VITE_EMBED_ORIGINS?.split(/[\s,]+/).filter(Boolean);

/** Tell the host something; dropped until it has introduced itself. */
export function notify(type: string, data: Record<string, unknown> = {}, transfer: Transferable[] = []): void {
  if (hostOrigin === null) return;
  window.parent.postMessage({ edentext: PROTOCOL, type, ...data }, hostOrigin === 'null' ? '*' : hostOrigin, transfer);
}

export function startBridge(api: EmbedApi): void {
  addEventListener('message', async (e: MessageEvent) => {
    const msg = e.data as { edentext?: number; type?: string; id?: unknown } | null;
    if (e.source !== window.parent || msg?.edentext !== PROTOCOL) return;
    if (msg.type === 'init' && (!allowedHosts?.length || allowedHosts.includes(e.origin))) hostOrigin ??= e.origin;
    if (e.origin !== hostOrigin) return;
    const reply = (data: Record<string, unknown>, transfer: Transferable[] = []) => notify('response', { id: msg.id, ...data }, transfer);
    try {
      const m = msg as Record<string, unknown>;
      switch (msg.type) {
        case 'init':
        case 'configure':
          api.configure(m as EmbedSettings);
          return reply({ ok: true });
        case 'load': {
          if (!(m.bytes instanceof ArrayBuffer || ArrayBuffer.isView(m.bytes))) throw new Error('load needs bytes');
          const v = m.bytes as ArrayBuffer | ArrayBufferView;
          const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
          return reply({ ok: await api.load(bytes, String(m.name ?? 'document.odt')) });
        }
        case 'new':
          api.newDocument(typeof m.name === 'string' ? m.name : undefined);
          return reply({ ok: true });
        case 'export': {
          if (m.format !== 'odt' && m.format !== 'docx' && m.format !== 'pdf') throw new Error('export needs format odt, docx or pdf');
          const out = await api.exportAs(m.format);
          const buffer = out.bytes.buffer.slice(out.bytes.byteOffset, out.bytes.byteOffset + out.bytes.byteLength) as ArrayBuffer;
          return reply({ ok: true, bytes: buffer, mime: out.mime, name: out.name }, [buffer]);
        }
        case 'markSaved':
          api.markSaved();
          return reply({ ok: true });
        default:
          throw new Error(`unknown message ${msg.type}`);
      }
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
  // No document data rides on it, so it goes out before the host has introduced itself.
  window.parent.postMessage({ edentext: PROTOCOL, type: 'ready', version: __APP_VERSION__ }, '*');
}
