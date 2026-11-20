// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Steffen Becker
import type { EdenTextEvents, EdenTextFrame, EdenTextSettings } from './index.js';

/**
 * `<eden-text url="/edentext/" user="Jane Doe" locale="de" ai="false">`. Attributes are
 * the options (`ai="false"` hides the assistant); a changed attribute is sent as `configure`.
 */
export class EdenTextElement extends HTMLElement {
  readonly ready: Promise<EdenTextFrame>;
  readonly version?: string;
  configure(settings: EdenTextSettings): Promise<void>;
  load(data: Blob | ArrayBuffer | Uint8Array, name?: string): Promise<boolean>;
  newDocument(name?: string): Promise<void>;
  export(format: 'odt' | 'docx' | 'pdf'): Promise<File>;
  markSaved(): Promise<void>;
}

export interface EdenTextElementEventMap extends HTMLElementEventMap {
  dirty: CustomEvent<EdenTextEvents['dirty']>;
  saveRequest: CustomEvent<EdenTextEvents['saveRequest']>;
  warning: CustomEvent<EdenTextEvents['warning']>;
  ready: CustomEvent<{ version?: string }>;
  error: CustomEvent<{ error: Error }>;
}

export interface EdenTextElement {
  addEventListener<K extends keyof EdenTextElementEventMap>(type: K, listener: (this: EdenTextElement, ev: EdenTextElementEventMap[K]) => unknown, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'eden-text': EdenTextElement;
  }
}
