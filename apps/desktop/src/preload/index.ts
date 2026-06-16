import type { IpcCallEnvelope } from '@linkcode/ipc';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * 预加载：通过 contextBridge 暴露一个**仅系统 / UI**的最小 invoke 通道。
 * 渲染层在其上用 tRPC 客户端（ipcLink）获得端到端类型安全（PLAN §4.5）。
 */
const api = {
  invoke: (call: IpcCallEnvelope): Promise<unknown> => ipcRenderer.invoke('linkcode:ipc', call),
};

contextBridge.exposeInMainWorld('linkcodeIpc', api);

export type LinkcodeIpcApi = typeof api;
