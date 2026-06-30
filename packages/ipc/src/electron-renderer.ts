import { defineInvokes } from '@moeru/eventa';
import { createContext as createRendererContext } from '@moeru/eventa/adapters/electron/renderer';
import type { IpcRenderer } from 'electron';
import type { SystemBridge } from './bridge';
import { DesktopSettingsSchema, UpdaterStatusSchema } from './context';
import {
  SETTINGS_OPEN_CHANNEL,
  SETTINGS_SNAPSHOT_CHANNEL,
  systemIpcEvents,
  UPDATER_STATUS_CHANNEL,
  WINDOW_MAXIMIZED_CHANGED_CHANNEL,
} from './events';

type EventaRendererIpc = Parameters<typeof createRendererContext>[0];
type IpcRendererListener = Parameters<IpcRenderer['on']>[1];

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
          const parsed = UpdaterStatusSchema.safeParse(value);
          if (parsed.success) cb(parsed.data);
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
      // Validate at the boundary; fall back to schema defaults if the snapshot is unavailable.
      snapshot: () =>
        DesktopSettingsSchema.parse(ipcRenderer.sendSync(SETTINGS_SNAPSHOT_CHANNEL) ?? {}),
    },
  };
}

function toEventaRendererIpc(ipcRenderer: unknown): EventaRendererIpc {
  return ipcRenderer as EventaRendererIpc;
}
