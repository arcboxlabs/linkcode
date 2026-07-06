import { setupRenderer } from '@better-auth/electron/preload';
import { createElectronSystemBridge } from '@linkcode/ipc/electron-renderer';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload: exposes a minimal, system / UI only bridge via contextBridge.
 * Eventa stays behind this boundary and never carries business data.
 */
const systemBridge = createElectronSystemBridge(ipcRenderer);

contextBridge.exposeInMainWorld('linkcodeSystem', systemBridge);

// LinkCode Cloud auth bridges (window.requestAuth / onAuthenticated / signOut / …). This is the
// better-auth electron plugin's own contextBridge surface — system-plane by nature (open browser,
// keychain-backed session) and sandbox-safe (electron IPC only), so it coexists with the bridge above.
setupRenderer();

export type LinkcodeSystemApi = typeof systemBridge;
