import { setupRenderer } from '@better-auth/electron/preload';
import { createElectronSystemBridge } from '@linkcode/ipc/electron-renderer';
import { contextBridge, ipcRenderer } from 'electron';
import {
  CLOUD_CLAIM_DEEP_LINK_CHANNEL,
  CLOUD_IM_BINDINGS_CHANNEL,
  CLOUD_IM_CREATE_BINDING_CHANNEL,
  CLOUD_IM_DELETE_BINDING_CHANNEL,
  CLOUD_IM_GET_PREFERENCES_CHANNEL,
  CLOUD_IM_LINK_TELEGRAM_CHANNEL,
  CLOUD_IM_OVERVIEW_CHANNEL,
  CLOUD_IM_SET_PREFERENCES_CHANNEL,
  CLOUD_IM_UNLINK_TELEGRAM_CHANNEL,
  CLOUD_IM_UPDATE_BINDING_CHANNEL,
  CLOUD_LIST_HOSTS_CHANNEL,
} from '../shared/cloud';

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
  claimDeepLink: () => ipcRenderer.invoke(CLOUD_CLAIM_DEEP_LINK_CHANNEL),
  im: {
    overview: () => ipcRenderer.invoke(CLOUD_IM_OVERVIEW_CHANNEL),
    bindings: () => ipcRenderer.invoke(CLOUD_IM_BINDINGS_CHANNEL),
    linkTelegram: (code: string) => ipcRenderer.invoke(CLOUD_IM_LINK_TELEGRAM_CHANNEL, code),
    unlinkTelegram: () => ipcRenderer.invoke(CLOUD_IM_UNLINK_TELEGRAM_CHANNEL),
    createBinding: (input: unknown) => ipcRenderer.invoke(CLOUD_IM_CREATE_BINDING_CHANNEL, input),
    updateBinding: (sessionId: string, patch: unknown) =>
      ipcRenderer.invoke(CLOUD_IM_UPDATE_BINDING_CHANNEL, sessionId, patch),
    deleteBinding: (sessionId: string) =>
      ipcRenderer.invoke(CLOUD_IM_DELETE_BINDING_CHANNEL, sessionId),
    preferences: () => ipcRenderer.invoke(CLOUD_IM_GET_PREFERENCES_CHANNEL),
    setPreferences: (pref: unknown) => ipcRenderer.invoke(CLOUD_IM_SET_PREFERENCES_CHANNEL, pref),
  },
});

export type LinkcodeSystemApi = typeof systemBridge;
