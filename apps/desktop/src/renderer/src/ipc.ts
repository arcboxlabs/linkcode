import { type IpcCallEnvelope, type SystemRouter, ipcLink } from '@linkcode/ipc';
import { createTRPCClient } from '@trpc/client';

declare global {
  interface Window {
    linkcodeIpc: { invoke: (call: IpcCallEnvelope) => Promise<unknown> };
  }
}

/**
 * System bridge client: the renderer's entry point to the default tRPC implementation of TypeSafe IPC (PLAN §4.5).
 * End-to-end types come from SystemRouter; transported over the invoke channel exposed by the preload.
 */
export const systemBridge = createTRPCClient<SystemRouter>({
  links: [ipcLink((call) => window.linkcodeIpc.invoke(call))],
});
