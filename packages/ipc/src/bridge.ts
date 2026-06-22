import type { PickFileOptions } from './context';

/**
 * SystemBridge: the capability contract of TypeSafe IPC (PLAN §6) — system / UI capabilities only.
 * Business data always goes through the transport and is **forbidden from this channel** (PLAN §2.3).
 */
export interface SystemBridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
    onMaximizedChange?(cb: (value: boolean) => void): () => void;
  };
  fs: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
  };
}
