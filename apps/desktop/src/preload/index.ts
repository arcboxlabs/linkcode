import { setupRenderer } from '@better-auth/electron/preload';
import { createElectronSystemBridge } from '@linkcode/ipc/electron-renderer';
import { contextBridge, ipcRenderer } from 'electron';
import { CLOUD_LIST_HOSTS_CHANNEL } from '../shared/cloud';

/**
 * Preload: exposes a minimal, system / UI only bridge via contextBridge.
 * Eventa stays behind this boundary and never carries business data.
 */
const systemBridge = createElectronSystemBridge(ipcRenderer, process.platform);

contextBridge.exposeInMainWorld('linkcodeSystem', systemBridge);

// LinkCode Cloud auth bridges (window.requestAuth / onAuthenticated / signOut / …). This is the
// better-auth electron plugin's own contextBridge surface — system-plane by nature (open browser,
// keychain-backed session) and sandbox-safe (electron IPC only), so it coexists with the bridge above.
setupRenderer();

// Cloud data bridge: the renderer lists the account's online hosts through main (which holds the
// keychain session). Kept off the SystemBridge — it's cloud-account data, not a window/OS capability.
contextBridge.exposeInMainWorld('linkcodeCloud', {
  listHosts: () => ipcRenderer.invoke(CLOUD_LIST_HOSTS_CHANNEL),
});

export type LinkcodeSystemApi = typeof systemBridge;
