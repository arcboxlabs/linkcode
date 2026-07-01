import { defineInvokes } from '@moeru/eventa';
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer';
import type { IpcRenderer } from 'electron';
import type { SystemBridge } from './bridge';
import type { DesktopSettings, UpdaterStatus } from './context';
import {
  SETTINGS_OPEN_CHANNEL,
  SETTINGS_SNAPSHOT_CHANNEL,
  systemIpcEvents,
  UPDATER_STATUS_CHANNEL,
  WINDOW_MAXIMIZED_CHANGED_CHANNEL,
} from './events';

type EventaRendererIpc = Parameters<typeof createRendererContext>[0];
type IpcRendererListener = Parameters<IpcRenderer['on']>[1];

// This module is bundled into the sandboxed preload, where `require('zod')` is unavailable — so it must
// stay zod-free. The main process already validates settings/status, so the renderer trusts the IPC data.
const FALLBACK_SETTINGS: DesktopSettings = {
  theme: 'system',
  locale: null,
  daemonUrl: 'http://127.0.0.1:4317',
};

export function createElectronSystemBridge(ipcRenderer: IpcRenderer): SystemBridge {
  const { context } = createRendererContext(toEventaRendererIpc(ipcRenderer));
  const invoke = defineInvokes(context, systemIpcEvents);

  return {
    window: {
      minimize: () => invoke.windowMinimize(),
      toggleMaximize: () => invoke.windowToggleMaximize(),
      close: () => invoke.windowClose(),
      isMaximized: () => invoke.windowIsMaximized(),
      onMaximizedChange(cb) {
        const handler: IpcRendererListener = (_event, value: unknown) => {
          if (typeof value === 'boolean') cb(value);
        };
        ipcRenderer.on(WINDOW_MAXIMIZED_CHANGED_CHANNEL, handler);
        return () => ipcRenderer.removeListener(WINDOW_MAXIMIZED_CHANGED_CHANNEL, handler);
      },
    },
    fs: {
      pickFile: (opts) => invoke.fsPickFile(opts),
    },
    app: {
      version: () => invoke.appVersion(),
      platform: () => invoke.appPlatform(),
      checkForUpdates: () => invoke.appCheckForUpdates(),
      onUpdaterStatus(cb) {
        const handler: IpcRendererListener = (_event, value: unknown) => {
          if (typeof value === 'string') cb(value as UpdaterStatus);
        };
        ipcRenderer.on(UPDATER_STATUS_CHANNEL, handler);
        return () => ipcRenderer.removeListener(UPDATER_STATUS_CHANNEL, handler);
      },
      onOpenSettings(cb) {
        const handler: IpcRendererListener = () => cb();
        ipcRenderer.on(SETTINGS_OPEN_CHANNEL, handler);
        return () => ipcRenderer.removeListener(SETTINGS_OPEN_CHANNEL, handler);
      },
    },
    settings: {
      get: () => invoke.settingsGet(),
      set: (patch) => invoke.settingsSet(patch),
      // Trust the main-validated snapshot; fall back to defaults if it's unavailable at boot.
      snapshot: () =>
        (ipcRenderer.sendSync(SETTINGS_SNAPSHOT_CHANNEL) as DesktopSettings | undefined) ??
        FALLBACK_SETTINGS,
    },
  };
}

function toEventaRendererIpc(ipcRenderer: unknown): EventaRendererIpc {
  return ipcRenderer as EventaRendererIpc;
}
