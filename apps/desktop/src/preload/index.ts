import type { IpcCallEnvelope } from '@linkcode/ipc';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload: exposes a minimal, **system / UI only** invoke channel via contextBridge.
 * On top of it the renderer uses a tRPC client (ipcLink) for end-to-end type safety (PLAN §4.5).
 */
const api = {
  invoke: (call: IpcCallEnvelope): Promise<unknown> => ipcRenderer.invoke('linkcode:ipc', call),
};

contextBridge.exposeInMainWorld('linkcodeIpc', api);

export type LinkcodeIpcApi = typeof api;
