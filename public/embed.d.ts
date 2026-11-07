// Types for embed.js, the EdenText embed helper; see docs/architecture/embed.md.

/** Every setting holds for the page it was sent to and is never stored: send them with each `init`. */
export interface EdenTextSettings {
  /** The name on comments and recorded changes. */
  user?: string;
  /** A UI language code, e.g. 'en' or 'de'. */
  locale?: string;
  theme?: 'light' | 'dark' | 'allBlack' | 'auto';
  chrome?: 'ribbon' | 'modern';
  /** The host's file name for the document; not an edit. */
  name?: string;
  /** 'slate' | 'blue' | 'teal' | 'green' | 'violet' | 'berry' | 'graphite', or a '#rrggbb' colour. */
  accent?: string;
  /**
   * false hides the AI assistant and its settings; true leaves the choice to the user.
   * The assistant is on by default and sends document text to a provider the user enters,
   * so a host that must keep documents in-house sends `ai: false` with every `init`.
   */
  ai?: boolean;
}

export interface EdenTextOptions extends EdenTextSettings {
  /** The EdenText instance, by default the one serving embed.js. */
  url?: string;
}

export interface EdenTextEvents {
  dirty: { type: 'dirty'; dirty: boolean };
  /** The reader pressed Save or Ctrl+S. */
  saveRequest: { type: 'saveRequest' };
  warning: { type: 'warning'; warnings: string[] };
}

export class EdenTextFrame {
  constructor(container: HTMLElement, options?: EdenTextOptions);
  /** Resolves once the editor is up and has taken the settings. */
  readonly ready: Promise<EdenTextFrame>;
  /** The EdenText version, set once `ready` resolves. */
  version?: string;
  configure(settings: EdenTextSettings): Promise<void>;
  /** Resolves false when the reader backed out, e.g. at a password prompt. */
  load(data: Blob | ArrayBuffer | Uint8Array, name?: string): Promise<boolean>;
  newDocument(name?: string): Promise<void>;
  /** The document stays changed until `markSaved()`. */
  export(format: 'odt' | 'docx' | 'pdf'): Promise<File>;
  markSaved(): Promise<void>;
  on<K extends keyof EdenTextEvents>(type: K, fn: (message: EdenTextEvents[K]) => void): () => void;
  destroy(): void;
}
