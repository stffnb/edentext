/*! EdenText embed helper | MIT License | Copyright (c) 2026 Steffen Becker */
// <eden-text>: the editor as a custom element. Attributes are the options, the methods
// sit on the element, and dirty, saveRequest, warning, ready and error are DOM events.
import { EdenTextFrame } from './index.js';

const SETTINGS = ['user', 'locale', 'theme', 'chrome', 'name', 'accent', 'ai'];
const EVENTS = ['dirty', 'saveRequest', 'warning'];

const value = (name, raw) => (name === 'ai' ? raw !== 'false' : raw);

// Module evaluation must not fail where there is no DOM (server-side rendering).
const Base = globalThis.HTMLElement ?? class {};

export class EdenTextElement extends Base {
  static observedAttributes = SETTINGS;
  #frame = null;

  connectedCallback() {
    if (this.#frame) return;
    if (!this.style.display) this.style.display = 'block';
    const settings = {};
    for (const name of SETTINGS) if (this.hasAttribute(name)) settings[name] = value(name, this.getAttribute(name));
    const frame = new EdenTextFrame(this, { url: this.getAttribute('url') ?? undefined, ...settings });
    this.#frame = frame;
    for (const type of EVENTS) frame.on(type, (m) => this.dispatchEvent(new CustomEvent(type, { detail: m })));
    frame.ready.then(
      () => this.#frame === frame && this.dispatchEvent(new CustomEvent('ready', { detail: { version: frame.version } })),
      (error) => this.#frame === frame && this.dispatchEvent(new CustomEvent('error', { detail: { error } })),
    );
  }

  // Taking the element out of the page ends the editor, and its document with it.
  disconnectedCallback() {
    const frame = this.#frame;
    this.#frame = null;
    frame?.destroy();
  }

  attributeChangedCallback(name, old, raw) {
    const frame = this.#frame;
    if (!frame || old === raw) return;
    frame.ready.then(() => frame.configure({ [name]: raw === null ? undefined : value(name, raw) }), () => {});
  }

  #need() {
    if (!this.#frame) throw new Error('<eden-text> is not in the page');
    return this.#frame;
  }

  get ready() { return this.#need().ready; }
  get version() { return this.#frame?.version; }
  configure(settings) { return this.#need().configure(settings); }
  load(data, name) { return this.#need().load(data, name); }
  newDocument(name) { return this.#need().newDocument(name); }
  export(format) { return this.#need().export(format); }
  markSaved() { return this.#need().markSaved(); }
}

if (globalThis.customElements && !customElements.get('eden-text')) customElements.define('eden-text', EdenTextElement);
