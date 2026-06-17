import { createElectronSystemBridge } from '@linkcode/ipc/electron-renderer';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload: exposes a minimal, system / UI only bridge via contextBridge.
 * Eventa stays behind this boundary and never carries business data.
 */
const systemBridge = createElectronSystemBridge(ipcRenderer);

contextBridge.exposeInMainWorld('linkcodeSystem', systemBridge);

export type LinkcodeSystemApi = typeof systemBridge;
