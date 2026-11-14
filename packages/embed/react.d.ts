import type { ForwardRefExoticComponent, HTMLAttributes, RefAttributes } from 'react';
import type { EdenTextFrame, EdenTextSettings } from './index.js';

export interface EdenTextProps extends EdenTextSettings, Omit<HTMLAttributes<HTMLDivElement>, keyof EdenTextSettings | 'onError'> {
  /** The EdenText instance, '/edentext/' by default. A new url starts a new editor. */
  url?: string;
  onReady?: (editor: EdenTextFrame) => void;
  onDirty?: (dirty: boolean) => void;
  /** The reader pressed Save or Ctrl+S. */
  onSaveRequest?: () => void;
  /** What an import could not keep. */
  onWarning?: (warnings: string[]) => void;
  /** The editor turned the page away or speaks another protocol. */
  onError?: (error: Error) => void;
}

export type EdenTextHandle = Pick<EdenTextFrame, 'ready' | 'version' | 'configure' | 'load' | 'newDocument' | 'export' | 'markSaved'>;

export const EdenText: ForwardRefExoticComponent<EdenTextProps & RefAttributes<EdenTextHandle>>;
