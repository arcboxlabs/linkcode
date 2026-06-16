import { z } from 'zod';

/**
 * TypeSafe IPC carries only system / UI capabilities and **never carries business data** (PLAN §2.3 / §4.5).
 * SystemContext is the injection point for the implementation of these capabilities: the Electron main
 * process provides the real implementation, and the abstraction layer (the tRPC router) is decoupled from
 * it, so this package does not depend on electron.
 */
export interface SystemContext {
  window: {
    minimize(): void;
    toggleMaximize(): void;
    close(): void;
    isMaximized(): boolean;
  };
  dialog: {
    pickFile(opts?: PickFileOptions): Promise<string | null>;
  };
  app: {
    getVersion(): string;
    getPlatform(): string;
  };
}

export const PickFileOptionsSchema = z.object({
  title: z.string().optional(),
  /** Whether to select a directory rather than a file. */
  directory: z.boolean().optional(),
});
export type PickFileOptions = z.infer<typeof PickFileOptionsSchema>;

/** Envelope for a single renderer → main-process call (the IPC transport boundary format). */
export interface IpcCallEnvelope {
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  input: unknown;
}

/** Transport function injected by the renderer: sends a single call to the main process and returns the result. */
export type IpcInvoke = (call: IpcCallEnvelope) => Promise<unknown>;
