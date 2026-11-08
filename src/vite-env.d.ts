/// <reference types="svelte" />
/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_EDENTEXT_ATTRIBUTION?: string;
  readonly VITE_EMBED_ORIGINS?: string;
  readonly VITE_COLLAB_RELAY?: string;
}
