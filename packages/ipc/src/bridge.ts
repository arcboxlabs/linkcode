import type { PickFileOptions } from './context';

/**
 * SystemBridge: the capability contract of TypeSafe IPC (PLAN §6) — system / UI capabilities only.
 * Business data always goes through the transport and is **forbidden from this channel** (PLAN §2.3).
 *
 * The default implementation is tRPC: the renderer obtains an end-to-end type-safe call proxy equivalent
 * to this interface via `createTRPCClient<SystemRouter>({ links: [ipcLink(...)] })`. This interface serves
 * as the capability inventory and a reference for alternative implementations.
 */
export interface SystemBridge {
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
    isMaximized(): Promise<boolean>;
  };
  fs: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
  };
}
