import { setupRenderer } from '@better-auth/electron/preload';
import { createElectronSystemBridge } from '@linkcode/ipc/electron-renderer';
import { contextBridge, ipcRenderer } from 'electron';
import {
  CLOUD_CLAIM_DEEP_LINK_CHANNEL,
  CLOUD_CREATE_GATEWAY_KEY_CHANNEL,
  CLOUD_GET_BILLING_SUMMARY_CHANNEL,
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
  CLOUD_OPEN_HOSTED_BILLING_CHANNEL,
} from '../shared/cloud';
import type { ConfigBridge } from '../shared/config';
import {
  CONFIG_ANALYTICS_CONSENT_CHANNEL,
  CONFIG_HOT_UPDATE_CHANNEL,
  CONFIG_REFRESH_CHANNEL,
  CONFIG_SNAPSHOT_CHANNEL,
  CONFIG_SNAPSHOT_INFO_CHANNEL,
} from '../shared/config';

/**
 * Preload: exposes a minimal, system / UI only bridge via contextBridge.
 * Eventa stays behind this boundary and never carries business data.
 */
const systemBridge = createElectronSystemBridge(ipcRenderer, process.platform);

contextBridge.exposeInMainWorld('linkcodeSystem', systemBridge);

const configBridge: ConfigBridge = {
  effectiveSnapshot: () => ipcRenderer.sendSync(CONFIG_SNAPSHOT_CHANNEL),
  snapshotInfo: () => ipcRenderer.sendSync(CONFIG_SNAPSHOT_INFO_CHANNEL),
  refresh: () => ipcRenderer.invoke(CONFIG_REFRESH_CHANNEL),
  onHotUpdate(callback) {
    const handler = (_event: Electron.IpcRendererEvent, keys: unknown): void => {
      if (Array.isArray(keys) && keys.every((key) => typeof key === 'string')) callback(keys);
    };
    ipcRenderer.on(CONFIG_HOT_UPDATE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(CONFIG_HOT_UPDATE_CHANNEL, handler);
  },
  notifyAnalyticsConsent: (enabled) => ipcRenderer.send(CONFIG_ANALYTICS_CONSENT_CHANNEL, enabled),
};

contextBridge.exposeInMainWorld('linkcodeConfig', configBridge);

// LinkCode Cloud auth bridges (window.requestAuth / onAuthenticated / signOut / …): the better-auth
// plugin's own contextBridge surface — system-plane and sandbox-safe (electron IPC only), so it
// coexists with the bridge above.
setupRenderer();

// Cloud data bridge: main holds the keychain session for these account-scoped requests. Kept off
// the SystemBridge — this is Cloud account data, not a window/OS capability.
contextBridge.exposeInMainWorld('linkcodeCloud', {
  listHosts: () => ipcRenderer.invoke(CLOUD_LIST_HOSTS_CHANNEL),
  billingSummary: () => ipcRenderer.invoke(CLOUD_GET_BILLING_SUMMARY_CHANNEL),
  claimDeepLink: () => ipcRenderer.invoke(CLOUD_CLAIM_DEEP_LINK_CHANNEL),
  openHostedBilling: () => ipcRenderer.invoke(CLOUD_OPEN_HOSTED_BILLING_CHANNEL),
  createGatewayKey: (name: string) => ipcRenderer.invoke(CLOUD_CREATE_GATEWAY_KEY_CHANNEL, name),
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
