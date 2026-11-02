// AGPL-3.0-only with an additional term under section 7(b): see NOTICE.md.
// EdenText embed helper: puts the editor in an iframe and drives it over postMessage.
// Usage and messages: docs/architecture/embed.md. Load it as a module from the same
// EdenText instance the iframe shows, e.g. import { EdenTextFrame } from '…/embed.js'.
const PROTOCOL = 1;

export class EdenTextFrame {
  #frame;
  #origin;
  #next = 0;
  #pending = new Map();
  #listeners = new Map();
  #dispose;

  /**
   * @param {HTMLElement} container where the iframe goes
   * @param {{ url?: string, user?: string, locale?: string, theme?: string, chrome?: string, name?: string }} [options]
   *   `url`: the EdenText instance, by default the one serving this file.
   */
  constructor(container, { url, ...settings } = {}) {
    const src = new URL(url ?? new URL('./', import.meta.url), location.href);
    src.searchParams.set('embed', '1');
    this.#origin = src.origin;
    const frame = document.createElement('iframe');
    frame.src = src.href;
    frame.title = 'EdenText';
    frame.allow = 'clipboard-read; clipboard-write; local-fonts';
    frame.style.cssText = 'border:0;width:100%;height:100%;display:block';
    this.#frame = frame;
    /** Resolves once the editor is up and has taken `settings`. */
    this.ready = new Promise((resolve, reject) => {
      const onMessage = (e) => {
        const m = e.data;
        if (e.source !== frame.contentWindow || e.origin !== this.#origin || m?.edentext !== PROTOCOL) return;
        if (m.type === 'ready') {
          this.version = m.version;
          this.#send('init', settings).then(() => resolve(this), reject);
        } else if (m.type === 'response') {
          const p = this.#pending.get(m.id);
          if (!p) return;
          this.#pending.delete(m.id);
          if (m.error !== undefined) p.reject(new Error(m.error));
          else p.resolve(m);
        } else {
          for (const fn of this.#listeners.get(m.type) ?? []) fn(m);
        }
      };
      addEventListener('message', onMessage);
      this.#dispose = () => removeEventListener('message', onMessage);
    });
    container.append(frame);
  }

  #send(type, data = {}, transfer = []) {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#frame.contentWindow.postMessage({ ...data, edentext: PROTOCOL, type, id }, this.#origin, transfer);
    });
  }

  /** Change user, locale, theme ('light'|'dark'|'allBlack'|'auto'), chrome ('ribbon'|'modern') or name. */
  async configure(settings) {
    await this.#send('configure', settings);
  }

  /**
   * Open a document (.odt, .ott, .docx or .dotx; the name's extension picks the reader).
   * Resolves false when the reader backed out, e.g. at a password prompt.
   * @param {Blob | ArrayBuffer | Uint8Array} data
   */
  async load(data, name = data instanceof File ? data.name : 'document.odt') {
    const bytes = data instanceof Blob ? await data.arrayBuffer()
      : data instanceof ArrayBuffer ? data.slice(0)
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const r = await this.#send('load', { bytes, name }, [bytes]);
    return r.ok;
  }

  /**
   * The document as a file to store. It stays "changed" until `markSaved()`.
   * @param {'odt' | 'docx' | 'pdf'} format
   * @returns {Promise<File>}
   */
  async export(format) {
    const r = await this.#send('export', { format });
    return new File([r.bytes], r.name, { type: r.mime });
  }

  /** The exported file has been stored: the document counts as unchanged from here. */
  async markSaved() {
    await this.#send('markSaved');
  }

  /**
   * 'dirty' ({dirty}), 'saveRequest' (the reader pressed Save or Ctrl+S), 'warning' ({warnings}).
   * @returns {() => void} unsubscribe
   */
  on(type, fn) {
    const set = this.#listeners.get(type) ?? new Set();
    this.#listeners.set(type, set);
    set.add(fn);
    return () => set.delete(fn);
  }

  destroy() {
    this.#dispose?.();
    for (const p of this.#pending.values()) p.reject(new Error('destroyed'));
    this.#pending.clear();
    this.#frame.remove();
  }
}
